/**
 * Local end-to-end plumbing check: Ollama reachable, the Moonshine bridge
 * process runs and emits normalized line events, and a real Ollama-backed
 * extractMeaning + communicator decision round trip happens with zero
 * remote (Anthropic/Google) calls.
 *
 * This is a PLUMBING check, not an accuracy check: there is no microphone in
 * this environment, so the Moonshine half runs against a synthetic WAV (a
 * tone, not speech) purely to prove the process starts, segments audio, and
 * emits well-formed events over stdout — see local/moonshine-bridge/README.md
 * for what real accuracy evaluation would require. The Ollama half is
 * independent: it runs the real extractMeaning/communicator call chain
 * against a fixed real sentence, not whatever (if anything) the synthetic
 * WAV transcribes to.
 *
 * Run: RUN_LOCAL_E2E=1 node --import ./scripts/ts-register.mjs scripts/local-e2e-eval.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

if (process.env.RUN_LOCAL_E2E !== "1") {
  console.log("Local e2e check skipped (set RUN_LOCAL_E2E=1 to run)");
  process.exit(0);
}

function loadDotEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotEnvLocal();

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
let failed = false;
function step(name, ok, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
}

// ------------------------------------------------------------- Ollama reachable

console.log("=== Local end-to-end plumbing check ===\n");

let ollamaModels = [];
try {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
  const json = await res.json();
  ollamaModels = (json.models ?? []).map((m) => m.name);
  step("Ollama is reachable", res.ok, `${OLLAMA_BASE_URL}, models: ${ollamaModels.join(", ") || "(none)"}`);
} catch (err) {
  step("Ollama is reachable", false, String(err));
}

// -------------------------------------------------------- Moonshine bridge

function writeToneWav(filePath, seconds = 2) {
  const sampleRate = 16000;
  const samples = Math.floor(seconds * sampleRate);
  const pcm = new Int16Array(samples);
  for (let i = 0; i < samples; i += 1) {
    const t = i / sampleRate;
    const burst = (t % 0.4) < 0.3 ? 1 : 0;
    pcm[i] = Math.round(0.2 * 32767 * Math.sin(2 * Math.PI * 220 * t) * burst);
  }
  const dataSize = pcm.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  Buffer.from(pcm.buffer).copy(buf, 44);
  fs.writeFileSync(filePath, buf);
}

const bridgeDir = path.resolve(process.cwd(), "local/moonshine-bridge");
const pythonBin = process.platform === "win32" ? path.join(bridgeDir, ".venv", "Scripts", "python.exe") : path.join(bridgeDir, ".venv", "bin", "python");
const wavPath = path.join(bridgeDir, "_e2e-check.wav");

let bridgeEvents = [];
if (!fs.existsSync(pythonBin)) {
  step("Moonshine bridge venv present", false, `expected ${pythonBin} — see local/moonshine-bridge/README.md setup`);
} else {
  writeToneWav(wavPath);
  // moonshine/tiny for a fast plumbing check — moonshine/base is the more
  // accurate default for real use but is a larger first-run download.
  const result = spawnSync(pythonBin, ["server.py", "--test-file", wavPath, "--model", "moonshine/tiny"], {
    cwd: bridgeDir,
    encoding: "utf8",
    timeout: 180_000,
  });
  fs.rmSync(wavPath, { force: true });
  const lines = (result.stdout || "").split("\n").map((l) => l.trim()).filter(Boolean);
  bridgeEvents = lines.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter(Boolean);
  step("Moonshine bridge process exits cleanly", result.status === 0, result.status === 0 ? "" : (result.stderr || "").slice(-500));
  step(
    "Moonshine bridge emits at least one line_started and one line_completed event",
    bridgeEvents.some((e) => e.type === "line_started") && bridgeEvents.some((e) => e.type === "line_completed"),
    JSON.stringify(bridgeEvents),
  );
}

// --------------------------------------------------------- Ollama round trip

process.env.LLM_PROVIDER = "ollama";
const { resetRemoteCallCount, getRemoteCallCount } = await import("../lib/llm.ts");
resetRemoteCallCount();

const { extractMeaning } = await import("../lib/expression/meaning/extract.ts");
const { MeaningDeltaSchema } = await import("../lib/expression/schemas.ts");

let delta = null;
let extractError = null;
try {
  delta = await extractMeaning("Traffic increased from 200 to 500 while conversion stayed flat.", []);
} catch (err) {
  extractError = String(err);
}
step("extractMeaning runs against Ollama without throwing", extractError === null, extractError ?? "");
step("the extracted delta validates against MeaningDeltaSchema", Boolean(delta && MeaningDeltaSchema.safeParse(delta).success), JSON.stringify(delta));
// extractMeaning never throws (a provider failure silently collapses to
// EMPTY_MEANING_DELTA, which is itself schema-valid) — so the schema check
// above alone cannot prove Ollama was actually reached. A non-empty entities
// array can only come from a real parsed model response.
step(
  "the delta contains real extracted content, not the empty-fallback (proves Ollama was actually reached)",
  Boolean(delta && delta.entities.length > 0),
  JSON.stringify(delta),
);

const { decideWithCommunicatorModel } = await import("../lib/communicator/model.ts");
const { CommunicationDecisionSchema } = await import("../lib/communicator/types.ts");

let decision = null;
let decisionError = null;
try {
  decision = await decideWithCommunicatorModel({
    userMessage: "Explain why an AI startup can gain users while becoming financially weaker.",
    communicationGoal: "Show the trade-off between growth and burn.",
    world: { entities: [], relations: [], claims: [], salience: [], sequence: 0 },
    canvas: {
      revisions: { scene: "scene-0", selection: "selection-0", viewport: "viewport-0" },
      elements: [],
      selection: { elementIds: [], groupIds: [] },
      viewport: { scrollX: 0, scrollY: 0, zoom: 1, width: 1280, height: 720 },
    },
    history: [],
    step: 1,
    remainingSteps: 6,
  });
} catch (err) {
  decisionError = String(err);
}
step("decideWithCommunicatorModel runs against Ollama without throwing", decisionError === null, decisionError ?? "");
step(
  "the communicator decision validates against CommunicationDecisionSchema",
  Boolean(decision && CommunicationDecisionSchema.safeParse(decision).success),
  JSON.stringify(decision),
);

step("zero remote (Anthropic/Google) calls occurred", getRemoteCallCount() === 0, `remoteCallCount=${getRemoteCallCount()}`);

console.log(`\n${failed ? "FAILED" : "OK"}`);
process.exitCode = failed ? 1 : 0;
