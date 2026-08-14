/**
 * Runs the corpus through one Deepgram configuration and writes a raw result
 * file. One variable per run, on purpose — see PHASE 8 of the audit brief.
 *
 *   node --env-file=.env.local scripts/stt/run.mjs A
 *
 * Configs live in CONFIGS below. Raw output goes to scripts/stt/results/<name>.json
 * and contains every message Deepgram sent, so a later question ("what did the
 * third interim say?") is answered from the file rather than by re-spending.
 */
import fs from "node:fs";
import path from "node:path";
import { CORPUS, TEST_KEYTERMS } from "./corpus.mjs";
import { streamFile, finalTranscript } from "./stream.mjs";

const AUDIO = path.join(process.cwd(), "scripts", "stt", "audio");
const RESULTS = path.join(process.cwd(), "scripts", "stt", "results");

export const CONFIGS = {
  // A: exactly what production sends today, minus the keyterm list (which in
  // production is board-dependent and usually empty at the start of a take).
  A: { label: "production, no keyterms", opts: {} },
  // B: production + the vocabulary a keyterm feature would supply.
  B: { label: "production + keyterms", opts: { keyterm: TEST_KEYTERMS } },
  // C: smart_format off, everything else production.
  C: { label: "smart_format off", opts: { smart_format: false } },
  // D: relaxed endpointing.
  D: { label: "endpointing 400", opts: { endpointing: 400 } },
  // E: production keyterm list as it exists TODAY (SEED_TERMS), which contains
  // "Airline" rather than "Aline". This is the hypothesis under test.
  E: {
    label: "current SEED_TERMS (contains 'Airline')",
    opts: {
      keyterm: ["Airline", "AI agents", "Affiliate Capital", "InPublic", "ClickLabs", "Excalidraw",
        "Deepgram", "Anthropic", "Claude", "Trinidad and Tobago", "Kenny Farmer", "sketchnote",
        "keyterm", "agentic", "LLM"],
    },
  },
};

const name = process.argv[2];
const config = CONFIGS[name];
if (!config) {
  console.error(`usage: run.mjs <${Object.keys(CONFIGS).join("|")}>`);
  process.exit(1);
}

fs.mkdirSync(RESULTS, { recursive: true });
const only = process.argv[3] ? process.argv[3].split(",") : null;
const entries = CORPUS.filter((e) => !only || only.includes(e.id));

const out = { config: name, label: config.label, opts: config.opts, runAt: new Date().toISOString(), items: [] };

for (const entry of entries) {
  const file = path.join(AUDIO, `${entry.id}.wav`);
  if (!fs.existsSync(file)) {
    console.warn(`skip ${entry.id}: no audio`);
    continue;
  }
  process.stdout.write(`${name} ${entry.id} … `);
  try {
    const { messages, durationMs } = await streamFile(file, config.opts);
    const hyp = finalTranscript(messages);
    out.items.push({ id: entry.id, cat: entry.cat, reference: entry.reference ?? entry.text, keyterms: entry.keyterms ?? [], durationMs, messages, hypothesis: hyp });
    console.log(hyp.slice(0, 70) || "(nothing)");
  } catch (err) {
    console.log(`ERROR ${err.message}`);
    out.items.push({ id: entry.id, cat: entry.cat, reference: entry.reference ?? entry.text, error: String(err.message) });
  }
}

const file = path.join(RESULTS, `${name}.json`);
fs.writeFileSync(file, JSON.stringify(out));
console.log(`\nwrote ${file} (${out.items.length} items)`);
