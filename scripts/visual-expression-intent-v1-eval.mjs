/** Local-only behavioral evaluation for Visual Expression Intent V1. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

if (process.env.RUN_VISUAL_EXPRESSION_INTENT_V1 !== "1") {
  console.log("Visual Expression Intent V1 eval skipped (set RUN_VISUAL_EXPRESSION_INTENT_V1=1)");
  process.exit(0);
}
if (process.env.LLM_PROVIDER !== "ollama") throw new Error("V1 evaluation is local-only: set LLM_PROVIDER=ollama");

const { ExpressionLiveController } = await import("../lib/expression/live.ts");
const { createVisualActionDispatcher } = await import("../lib/visual-actions/index.ts");
const { runCommunicator, decideWithCommunicatorModel } = await import("../lib/communicator/index.ts");
const { getRemoteCallCount, resetRemoteCallCount, OLLAMA_MODEL } = await import("../lib/llm.ts");

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function makeHarness(label) {
  const state = {
    label, sceneRevision: 0, viewportRevision: 0, elements: [], traces: [],
    viewport: { scrollX: 0, scrollY: 0, zoom: 1, width: 1280, height: 720 },
  };
  const observe = () => ({
    elements: structuredClone(state.elements),
    selection: { elementIds: [], groupIds: [] },
    viewport: { ...state.viewport },
    revisions: { scene: `scene-${state.sceneRevision}`, selection: "selection-0", viewport: `viewport-${state.viewportRevision}` },
  });
  const canvas = {
    presence: { setState() {}, clear() {}, getSnapshot() { return {}; }, subscribe() { return () => {}; }, noteHumanInteraction() {}, setReducedMotion() {}, tick() {} },
    attach() {}, async preload() {}, applyElements() {}, readViewport() { return { ...state.viewport }; },
    applyViewport(viewport) { state.viewport = { ...state.viewport, ...viewport }; state.viewportRevision += 1; },
    observe, async applyExpression() { throw new Error("unused"); }, resetExpressionIdentity() {},
  };
  const controller = new ExpressionLiveController({
    debounceMs: 0,
    enableIdentityLayer: true,
    extract: async () => ({ entities: [], relations: [], claims: [], interpretation: "" }),
    onUpdate: async ({ trace }) => {
      state.traces.push(trace);
      state.sceneRevision += 1;
      state.elements = trace.scene.objects.flatMap((object, order) => [
        { id: object.id, type: "rectangle", x: object.x, y: object.y, width: object.w, height: object.h, angle: 0, groupIds: [], frameId: null, containerId: null, revision: state.sceneRevision, order: order * 2, semanticEntityId: object.entityId },
        { id: `${object.id}-label`, type: "text", x: object.x, y: object.y, width: object.w, height: object.h, angle: 0, text: object.label, groupIds: [], frameId: null, containerId: null, revision: state.sceneRevision, order: order * 2 + 1, semanticEntityId: object.entityId },
      ]);
    },
  });
  const dispatcher = createVisualActionDispatcher(controller, canvas);
  return { state, controller, dispatcher, source: { getWorld: () => controller.getWorld(), getScene: () => controller.getScene(), observe } };
}

async function establish(h, id, label) {
  await h.dispatcher.dispatch({
    type: "express",
    meaning: { entities: [{ id, type: "concept", label }], relations: [], claims: [], interpretation: label },
    presentation: { form: "existing" },
  });
}

function summarizeRun(id, prompt, h, before, result) {
  const after = h.controller.getWorld();
  const visualSteps = result.trace.steps.filter((step) => step.visualCommunicationIntent);
  const renderedSteps = visualSteps.filter((step) => step.chosenGrammar);
  return {
    id,
    prompt,
    status: result.status,
    reason: result.reason,
    didVisualize: visualSteps.some((step) => step.outcome?.status === "applied"),
    completed: result.status === "completed",
    chosenForms: visualSteps.map((step) => step.visualCommunicationIntent.form),
    actualRenderedGrammars: visualSteps.map((step) => step.chosenGrammar),
    presentationReachedRenderer: visualSteps.every(
      (step) => step.presentationIntent?.form === step.visualCommunicationIntent.form && Boolean(step.chosenGrammar),
    ),
    semanticTruthful: renderedSteps.every(
      (step) => (step.inventedRelationIds?.length ?? 0) === 0 && (step.semanticPreservation ?? 0) === 1,
    ),
    repeatedSpeech: result.trace.steps.some((step) => step.outcome?.reason === "This message has already been delivered."),
    worldHashBefore: hash(before),
    worldHashAfter: hash(after),
    semanticIdsBefore: before.entities.map((entity) => entity.id),
    semanticIdsAfter: after.entities.map((entity) => entity.id),
    relationsBefore: before.relations,
    relationsAfter: after.relations,
    communicationTrace: result.trace,
  };
}

async function runPrompt(id, prompt, seed) {
  const h = makeHarness(id);
  await establish(h, seed.id, seed.label);
  const before = structuredClone(h.controller.getWorld());
  const result = await runCommunicator(
    { userMessage: prompt, communicationGoal: prompt },
    { source: h.source, dispatcher: h.dispatcher, decisionProvider: decideWithCommunicatorModel, maxSteps: 6 },
  );
  return summarizeRun(id, prompt, h, before, result);
}

resetRemoteCallCount();
const startedAt = new Date().toISOString();
const report = { generatedAt: startedAt, provider: "ollama", model: OLLAMA_MODEL, scenarios: [] };

if (process.env.V1_EVAL_ONLY !== "two-turn") report.scenarios.push(await runPrompt(
  "ai-startup-financial-weakness",
  "Explain why an AI startup can gain users while becoming financially weaker.",
  { id: "startup", label: "AI startup" },
));
console.log("scenario 1 complete");
if (process.env.V1_EVAL_ONLY !== "two-turn") report.scenarios.push(await runPrompt(
  "silent-teams",
  "Explain why three teams that do not communicate create organizational problems.",
  { id: "organization", label: "Organization" },
));
console.log("scenario 2 complete");
if (process.env.V1_EVAL_ONLY !== "two-turn") report.scenarios.push(await runPrompt(
  "speed-accuracy-tradeoff",
  "Explain the trade-off between moving quickly and maintaining accuracy.",
  { id: "delivery", label: "Delivery quality" },
));
console.log("scenario 3 complete");

// Two natural turns on one persistent visual world; no visual form is named.
if (process.env.V1_EVAL_ONLY !== "scenarios") {
  const h = makeHarness("two-turn-recomposition");
  const turns = [];
  for (const prompt of [
    "Revenue and cost are the two major concerns.",
    "Actually cost is four times larger than revenue.",
  ]) {
    const before = structuredClone(h.controller.getWorld());
    const result = await runCommunicator(
      { userMessage: prompt, communicationGoal: prompt },
      { source: h.source, dispatcher: h.dispatcher, decisionProvider: decideWithCommunicatorModel, maxSteps: 6 },
    );
    turns.push(summarizeRun(`turn-${turns.length + 1}`, prompt, h, before, result));
  }
  const finalWorld = h.controller.getWorld();
  report.twoTurn = {
    turns,
    revenueIds: finalWorld.entities.filter((entity) => /revenue/i.test(entity.label)).map((entity) => entity.id),
    costIds: finalWorld.entities.filter((entity) => /cost/i.test(entity.label)).map((entity) => entity.id),
    finalWorld,
  };
}
console.log("two-turn scenario complete");

report.remoteCallCount = getRemoteCallCount();
report.finishedAt = new Date().toISOString();
if (report.remoteCallCount !== 0) throw new Error(`paid/remote calls detected: ${report.remoteCallCount}`);
const modelSlug = OLLAMA_MODEL.replaceAll(":", "-");
const out = path.resolve(process.cwd(), `evaluation/reports/visual-expression-intent-v1-raw-${modelSlug}.json`);
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`wrote ${out}`);
