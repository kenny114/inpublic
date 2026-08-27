/**
 * Local Ollama model comparison — qwen3:4b vs qwen3:1.7b (or whatever local
 * candidates are actually installed; this never pulls a model itself).
 *
 * Opt-in, local-only, zero cost: runs the same fixed prompt through the four
 * real call shapes InPublic actually uses (meaning extraction, communicator
 * decision, visual shaping, agent decision) against each installed candidate,
 * and records exactly the fields the spec asks for: prompt/output tokens,
 * load/prompt-eval/generation/total durations (from Ollama's own response
 * metadata via lib/llm.ts's CompletionUsage), whether the result actually
 * validates against the real zod schema, and the semantic result itself.
 *
 * Run: RUN_OLLAMA_MODEL_COMPARISON=1 node --import ./scripts/ts-register.mjs scripts/ollama-model-comparison-eval.mjs
 */

import fs from "node:fs";
import path from "node:path";

if (process.env.RUN_OLLAMA_MODEL_COMPARISON !== "1") {
  console.log("Ollama model comparison skipped (set RUN_OLLAMA_MODEL_COMPARISON=1 to run)");
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
process.env.LLM_PROVIDER = "ollama";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const CANDIDATES = (process.env.OLLAMA_COMPARISON_MODELS || "qwen3:4b,qwen3:1.7b").split(",").map((s) => s.trim()).filter(Boolean);

async function installedModels() {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
  if (!res.ok) throw new Error(`GET /api/tags ${res.status}`);
  const json = await res.json();
  return new Set((json.models ?? []).map((m) => m.name));
}

const EMPTY_WORLD = { entities: [], relations: [], claims: [], salience: [], sequence: 0 };
const EMPTY_CANVAS = {
  revisions: { scene: "scene-0", selection: "selection-0", viewport: "viewport-0" },
  elements: [],
  selection: { elementIds: [], groupIds: [] },
  viewport: { scrollX: 0, scrollY: 0, zoom: 1, width: 1280, height: 720 },
};

async function runAgainst(model) {
  process.env.OLLAMA_MODEL = model;

  // Fresh imports per model would re-evaluate module-level MODEL constants
  // that are already provider-agnostic (they only pick which role reads
  // which env var; the actual provider/model routing happens inside
  // complete() at call time via OLLAMA_MODEL) — so a single static import
  // set, read once, is correct for every candidate in this loop.
  const results = [];

  const record = async (kind, run) => {
    let usage = null;
    const startedAt = Date.now();
    let value;
    let error = null;
    try {
      value = await run((u) => {
        usage = u;
      });
    } catch (err) {
      error = String(err);
    }
    results.push({ kind, model, wallMs: Date.now() - startedAt, usage, value, error });
  };

  const { extractMeaning } = await import("../lib/expression/meaning/extract.ts");
  const { MeaningDeltaSchema } = await import("../lib/expression/schemas.ts");
  await record("expression_extract", async (onUsage) => {
    const delta = await extractMeaning("Traffic increased from 200 to 500 while conversion stayed flat.", [], onUsage);
    return { schemaValid: MeaningDeltaSchema.safeParse(delta).success, semanticResult: delta };
  });

  const { decideWithCommunicatorModel } = await import("../lib/communicator/model.ts");
  const { CommunicationDecisionSchema } = await import("../lib/communicator/types.ts");
  await record("communicator_decision", async (onUsage) => {
    const raw = await decideWithCommunicatorModel(
      {
        userMessage: "Explain why an AI startup can gain users while becoming financially weaker.",
        communicationGoal: "Show the trade-off between growth and burn.",
        world: EMPTY_WORLD,
        canvas: EMPTY_CANVAS,
        history: [],
        step: 1,
        remainingSteps: 6,
      },
      onUsage,
    );
    const parsed = CommunicationDecisionSchema.safeParse(raw);
    return { schemaValid: parsed.success, semanticResult: parsed.success ? parsed.data : raw };
  });

  const { shapeVisualIntent } = await import("../lib/communicator/shape.ts");
  await record("communicator_shaping", async (onUsage) => {
    const delta = await shapeVisualIntent(
      { goal: "Model costs are growing faster than revenue.", form: "tension" },
      { world: EMPTY_WORLD, onUsage },
    );
    return { schemaValid: MeaningDeltaSchema.safeParse(delta).success, semanticResult: delta };
  });

  const { decideWithVisualAgentModel } = await import("../lib/agent/model.ts");
  const { AgentDecisionSchema } = await import("../lib/agent/types.ts");
  await record("agent_decision", async (onUsage) => {
    const raw = await decideWithVisualAgentModel(
      {
        instruction: "Draw a box labelled 'revenue'.",
        world: EMPTY_WORLD,
        canvas: EMPTY_CANVAS,
        step: 1,
        remainingSteps: 6,
      },
      onUsage,
    );
    const parsed = AgentDecisionSchema.safeParse(raw);
    return { schemaValid: parsed.success, semanticResult: parsed.success ? parsed.data : raw };
  });

  return results.map((r) => ({
    kind: r.kind,
    model: r.model,
    wallMs: r.wallMs,
    error: r.error,
    schemaValid: r.value?.schemaValid ?? false,
    semanticResult: r.value?.semanticResult ?? null,
    promptTokens: r.usage?.inputTokens ?? null,
    outputTokens: r.usage?.outputTokens ?? null,
    loadDurationMs: r.usage?.loadDurationMs ?? null,
    promptEvalDurationMs: r.usage?.promptEvalDurationMs ?? null,
    evalDurationMs: r.usage?.evalDurationMs ?? null,
    totalDurationMs: r.usage?.totalDurationMs ?? null,
  }));
}

console.log("=== Ollama model comparison ===");
let installed;
try {
  installed = await installedModels();
} catch (err) {
  console.error(`Could not reach Ollama at ${OLLAMA_BASE_URL}: ${err}`);
  process.exit(1);
}

const candidates = CANDIDATES.filter((m) => installed.has(m));
const skipped = CANDIDATES.filter((m) => !installed.has(m));
if (skipped.length) console.log(`Skipping not-installed candidates (never auto-pulled): ${skipped.join(", ")}`);
if (!candidates.length) {
  console.error(`None of the candidate models (${CANDIDATES.join(", ")}) are installed. Run 'ollama pull <model>' first.`);
  process.exit(1);
}

const report = { generatedAt: new Date().toISOString(), ollamaBaseUrl: OLLAMA_BASE_URL, candidates, models: {} };
for (const model of candidates) {
  console.log(`\n-- ${model} --`);
  report.models[model] = await runAgainst(model);
  for (const r of report.models[model]) {
    console.log(`  ${r.kind}: schemaValid=${r.schemaValid} wallMs=${r.wallMs} totalDurationMs=${r.totalDurationMs} promptTokens=${r.promptTokens} outputTokens=${r.outputTokens}`);
  }
}

const outPath = path.resolve(process.cwd(), "evaluation/reports/ollama-model-comparison-raw.json");
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`\nWrote raw trace to ${outPath}`);
