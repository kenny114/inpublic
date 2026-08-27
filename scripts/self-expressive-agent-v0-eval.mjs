/**
 * Self-Expressive Visual Agent V0 — dev-only demonstration.
 *
 * Opt-in, paid, live-model evaluation of lib/communicator/ against a
 * synthetic in-memory canvas (same harness shape as
 * scripts/live-v0-validation-eval.mjs), exercising the real
 * ExpressionLiveController, real VisualActionDispatcher, and the new
 * runCommunicator loop with two real model calls per visual step (decision +
 * shaping). Not wired into any production path — see
 * planning/specs/SELF-EXPRESSIVE-AGENT-V0.md.
 *
 * Run: RUN_SELF_EXPRESSIVE_V0=1 node --import ./scripts/ts-register.mjs scripts/self-expressive-agent-v0-eval.mjs
 */

import fs from "node:fs";
import path from "node:path";

if (process.env.RUN_SELF_EXPRESSIVE_V0 !== "1") {
  console.log("Self-Expressive Agent V0 demo skipped (set RUN_SELF_EXPRESSIVE_V0=1 to run paid calls)");
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

const { ExpressionLiveController } = await import("../lib/expression/live.ts");
const { extractMeaning, EXPRESSION_MODEL } = await import("../lib/expression/meaning/extract.ts");
const { createVisualActionDispatcher } = await import("../lib/visual-actions/index.ts");
const { runCommunicator, decideWithCommunicatorModel, COMMUNICATOR_MODEL, SHAPING_MODEL } = await import("../lib/communicator/index.ts");

const APPROX_PRICING_PER_MTOK = {
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
};
function approxCostUsd(model, usage) {
  const rate = APPROX_PRICING_PER_MTOK[model];
  if (!rate || !usage) return null;
  return ((usage.inputTokens ?? 0) / 1_000_000) * rate.input + ((usage.outputTokens ?? 0) / 1_000_000) * rate.output;
}

const callLog = [];
function record(kind, model, usage) {
  callLog.push({ kind, model, ...usage, approxCostUsd: approxCostUsd(model, usage) });
}

function makeHarness(label) {
  const state = {
    elements: [],
    sceneRevision: 0,
    viewportRevision: 0,
    viewport: { scrollX: 0, scrollY: 0, zoom: 1, width: 1280, height: 720 },
  };
  const events = [];
  const t0 = Date.now();
  const log = (event, data) => events.push({ atMs: Date.now() - t0, event, ...data });

  const observe = () => ({
    elements: structuredClone(state.elements),
    selection: { elementIds: [], groupIds: [] },
    viewport: { ...state.viewport },
    revisions: { scene: `scene-${state.sceneRevision}`, selection: "selection-0", viewport: `viewport-${state.viewportRevision}` },
  });

  const canvas = {
    presence: { setState() {}, clear() {}, getSnapshot() { return {}; }, subscribe() { return () => {}; }, noteHumanInteraction() {}, setReducedMotion() {}, tick() {} },
    attach() {}, async preload() {}, applyElements() {}, readViewport() { return { ...state.viewport }; },
    applyViewport(viewport) { state.viewport = { ...state.viewport, ...viewport }; state.viewportRevision += 1; log("camera_move", { viewport: state.viewport }); },
    observe,
    async applyExpression() { throw new Error("not used by this harness"); },
    resetExpressionIdentity() {},
  };

  const controller = new ExpressionLiveController({
    debounceMs: 0,
    // Matches components/Board.tsx's real live configuration.
    enableIdentityLayer: true,
    extract: async (text, recentContext) => {
      const delta = await extractMeaning(text, recentContext, (u) => record("expression_extract", EXPRESSION_MODEL, u));
      return delta;
    },
    onUpdate: async ({ trace }) => {
      state.sceneRevision += 1;
      state.elements = trace.scene.objects.flatMap((object, order) => [
        { id: object.id, type: "rectangle", x: object.x, y: object.y, width: object.w, height: object.h, angle: 0, groupIds: [], frameId: null, containerId: null, revision: state.sceneRevision, order: order * 2, semanticEntityId: object.entityId },
        { id: `${object.id}-label`, type: "text", x: object.x, y: object.y, width: object.w, height: object.h, angle: 0, text: object.label, groupIds: [], frameId: null, containerId: null, revision: state.sceneRevision, order: order * 2 + 1, semanticEntityId: object.entityId },
      ]);
      log("scene_update", {
        objects: trace.scene.objects.length,
        revision: state.sceneRevision,
        grammar: trace.plan.grammar,
        intent: trace.intent.primary,
        changed: trace.changed,
      });
    },
    onNoChange: (trace) => log("no_change", { grammar: trace.plan.grammar, intent: trace.intent.primary }),
  });

  const dispatcher = createVisualActionDispatcher(controller, canvas);

  return {
    label, state, controller, events, log, dispatcher,
    source: { getWorld: () => controller.getWorld(), getScene: () => controller.getScene(), observe },
  };
}

function grammarSequenceFrom(events) {
  return events.filter((e) => e.event === "scene_update").map((e) => ({ atMs: e.atMs, grammar: e.grammar, intent: e.intent, objects: e.objects }));
}

const report = { generatedAt: new Date().toISOString(), scenarios: [] };

async function runScenario(id, prompt) {
  const h = makeHarness(id);
  const decisionProvider = async (context) => {
    const raw = await decideWithCommunicatorModel(context, (u) => record("communicator_decision", COMMUNICATOR_MODEL, u));
    h.log("decision", { raw });
    return raw;
  };
  const result = await runCommunicator(
    { userMessage: prompt, communicationGoal: prompt },
    {
      source: h.source,
      dispatcher: h.dispatcher,
      decisionProvider,
      onShapingUsage: (usage) => record("communicator_shaping", SHAPING_MODEL, usage),
      onStep: (step) => h.log("communicator_step", { step: step.step, decision: step.decision, outcome: step.outcome }),
    },
  );

  const world = h.controller.getWorld();
  const scenario = {
    id,
    prompt,
    status: result.status,
    reason: result.status === "blocked" || result.status === "stalled" ? result.reason : undefined,
    decisionCalls: result.trace.decisionCalls,
    shapingCalls: result.trace.shapingCalls,
    steps: result.trace.steps,
    grammarSequence: grammarSequenceFrom(h.events),
    finalWorld: {
      entities: world.entities.map((e) => ({ id: e.id, type: e.type, label: e.label })),
      relations: world.relations.map((r) => ({ source: r.source, type: r.type, target: r.target, spatial: r.spatial, magnitude: r.magnitude })),
    },
    finalElementCount: h.state.elements.length,
    events: h.events,
  };
  report.scenarios.push(scenario);
  return h;
}

console.log("=== Self-Expressive Visual Agent V0 — dev-only demonstration ===");
console.log(`decision model: ${COMMUNICATOR_MODEL}, shaping model: ${SHAPING_MODEL}, expression model: ${EXPRESSION_MODEL}`);

await runScenario("demo1-ai-startup-tradeoff", "Explain why an AI startup can gain users while becoming financially weaker.");
console.log("demo1 done");
await runScenario("demo2-silent-teams", "Explain why three teams that do not communicate create organizational problems.");
console.log("demo2 done");
await runScenario("demo3-speed-vs-accuracy", "Explain the trade-off between moving quickly and maintaining accuracy.");
console.log("demo3 done");

report.callLog = callLog;
report.costSummary = {
  totalCalls: callLog.length,
  decisionCalls: callLog.filter((c) => c.kind === "communicator_decision").length,
  shapingCalls: callLog.filter((c) => c.kind === "communicator_shaping").length,
  expressionExtractCalls: callLog.filter((c) => c.kind === "expression_extract").length,
  totalInputTokens: callLog.reduce((s, c) => s + (c.inputTokens ?? 0), 0),
  totalOutputTokens: callLog.reduce((s, c) => s + (c.outputTokens ?? 0), 0),
  approxTotalCostUsd: callLog.reduce((s, c) => s + (c.approxCostUsd ?? 0), 0),
};

// A local (LLM_PROVIDER=ollama) rerun writes to its own file rather than
// overwriting the cloud baseline, so the two remain comparable side by side.
const outSuffix = process.env.LLM_PROVIDER === "ollama" ? "-ollama" : "";
const outPath = path.resolve(process.cwd(), `evaluation/reports/self-expressive-agent-v0-raw${outSuffix}.json`);
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`\nWrote raw trace to ${outPath}`);
console.log(JSON.stringify(report.costSummary, null, 2));
