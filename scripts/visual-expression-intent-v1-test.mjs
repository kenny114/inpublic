import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ExpressionLiveController } from "../lib/expression/live.ts";
import { PresentationIntentSchema } from "../lib/expression/presentation/intent.ts";
import { createVisualActionDispatcher, VisualActionSchema } from "../lib/visual-actions/index.ts";
import { runCommunicator } from "../lib/communicator/index.ts";

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function harness() {
  const state = {
    sceneRevision: 0,
    elements: [],
    traces: [],
    viewport: { scrollX: 0, scrollY: 0, zoom: 1, width: 1280, height: 720 },
  };
  const observe = () => ({
    elements: structuredClone(state.elements),
    selection: { elementIds: [], groupIds: [] },
    viewport: { ...state.viewport },
    revisions: { scene: `scene-${state.sceneRevision}`, selection: "selection-0", viewport: "viewport-0" },
  });
  const canvas = {
    presence: { setState() {}, clear() {}, getSnapshot() { return {}; }, subscribe() { return () => {}; }, noteHumanInteraction() {}, setReducedMotion() {}, tick() {} },
    attach() {}, async preload() {}, applyElements() {}, readViewport() { return { ...state.viewport }; },
    applyViewport(viewport) { state.viewport = { ...state.viewport, ...viewport }; },
    observe, async applyExpression() { throw new Error("unused"); }, resetExpressionIdentity() {},
  };
  const controller = new ExpressionLiveController({
    debounceMs: 0,
    extract: async () => ({ entities: [], relations: [], claims: [], interpretation: "" }),
    onUpdate: async ({ trace }) => {
      state.traces.push(trace);
      state.sceneRevision += 1;
      state.elements = trace.scene.objects.map((object, order) => ({
        id: object.id, type: "rectangle", x: object.x, y: object.y,
        width: object.w, height: object.h, angle: 0, groupIds: [], frameId: null,
        containerId: null, revision: state.sceneRevision, order,
        semanticEntityId: object.entityId,
      }));
    },
  });
  const dispatcher = createVisualActionDispatcher(controller, canvas);
  return {
    state, controller, dispatcher,
    source: { getWorld: () => controller.getWorld(), getScene: () => controller.getScene(), observe },
  };
}

const seed = {
  entities: [
    { id: "users", type: "concept", label: "users increased" },
    { id: "usage", type: "concept", label: "usage increased" },
    { id: "cost", type: "concept", label: "cost increased", quantity: { value: 20, unit: "growth index" } },
    { id: "revenue", type: "concept", label: "revenue slower", quantity: { value: 5, unit: "growth index" } },
    { id: "weakness", type: "state", label: "financial weakness" },
  ],
  relations: [
    { id: "users-before-usage", source: "users", type: "precedes", target: "usage", step: 0 },
    { id: "usage-before-cost", source: "usage", type: "precedes", target: "cost", step: 1 },
    { id: "users-enable-usage", source: "users", type: "enables", target: "usage" },
    { id: "usage-causes-cost", source: "usage", type: "causes", target: "cost" },
    { id: "cost-causes-weakness", source: "cost", type: "causes", target: "weakness" },
  ],
  claims: [],
  interpretation: "Users and usage grow, driving cost faster than revenue grows.",
};

// Same WorldState, four presentation forms, four deterministic expressions.
{
  const h = harness();
  const firstPresentation = { form: "existing", scope: { entityIds: ["users-increased", "usage-increased", "cost-increased", "financial-weakness"] } };
  const first = await h.dispatcher.dispatch({ type: "express", meaning: seed, presentation: firstPresentation });
  assert.equal(first.status, "applied");
  const frozenHash = hash(h.controller.getWorld());
  const frozenIds = h.controller.getWorld().entities.map((entity) => entity.id);
  const frozenRelations = structuredClone(h.controller.getWorld().relations);
  const renders = [{ form: "existing", grammar: first.expressionTrace.plan.grammar, scene: first.after.scene }];

  const requested = [
    { form: "process", scope: { entityIds: ["users-increased", "usage-increased", "cost-increased"] } },
    { form: "magnitude", scope: { entityIds: ["cost-increased", "revenue-slower"] } },
    { form: "comparison", scope: { entityIds: ["cost-increased", "revenue-slower"] } },
  ];
  for (const presentation of requested) {
    const form = presentation.form;
    const result = await h.dispatcher.dispatch({ type: "recompose_expression", presentation });
    assert.equal(result.status, "applied", `${form} should produce a new ScenePlan`);
    assert.equal(hash(h.controller.getWorld()), frozenHash, `${form} changed WorldState`);
    assert.deepEqual(h.controller.getWorld().entities.map((entity) => entity.id), frozenIds);
    assert.deepEqual(h.controller.getWorld().relations, frozenRelations);
    renders.push({ form, grammar: result.expressionTrace.plan.grammar, scene: result.after.scene });
  }
  assert.deepEqual(renders.map((entry) => entry.grammar), ["cause_effect", "sequence", "quantity", "comparison"]);
  assert.equal(new Set(renders.map((entry) => hash(entry.scene))).size, 4);
  console.log("PASS: one frozen WorldState produces existing/process/magnitude/comparison expressions");
}

// Incompatible forms fall back honestly; presentation-level distance adds no located_at fact.
{
  const h = harness();
  await h.dispatcher.dispatch({
    type: "express",
    meaning: { entities: [{ id: "a", type: "concept", label: "Alpha" }, { id: "b", type: "concept", label: "Beta" }], relations: [], claims: [], interpretation: "Two independent concerns." },
  });
  const before = hash(h.controller.getWorld());
  for (const form of ["magnitude", "causal"]) {
    const result = await h.dispatcher.dispatch({ type: "recompose_expression", presentation: { form } });
    assert.equal(result.expressionTrace.plan.grammar, "relationship");
    assert.equal(hash(h.controller.getWorld()), before);
  }
  const spatial = await h.dispatcher.dispatch({
    type: "recompose_expression",
    presentation: { form: "spatial", scope: { entityIds: ["a", "b"] }, spatial: { arrangement: "separated" } },
  });
  assert.equal(spatial.expressionTrace.plan.grammar, "relationship");
  assert.equal(hash(h.controller.getWorld()), before);
  assert.equal(h.controller.getWorld().relations.some((relation) => relation.type === "located_at"), false);
  console.log("PASS: incompatible forms fall back without fabricated quantity, causation, or location");
}

// Strict schemas expose no raw geometry.
{
  assert.equal(PresentationIntentSchema.safeParse({ form: "comparison", x: 12 }).success, false);
  assert.equal(VisualActionSchema.safeParse({ type: "recompose_expression", presentation: { form: "spatial", width: 400 } }).success, false);
  console.log("PASS: presentation and recomposition reject geometry");
}

// Exact repeated speech receives one explicit correction, then stalls if repeated again.
{
  const h = harness();
  const contexts = [];
  const result = await runCommunicator(
    { userMessage: "Explain it", communicationGoal: "Explain it" },
    {
      source: h.source,
      dispatcher: h.dispatcher,
      maxSteps: 4,
      decisionProvider: async (context) => {
        contexts.push(structuredClone(context));
        return { type: "speak", message: "The same answer." };
      },
    },
  );
  assert.equal(result.status, "stalled");
  assert.equal(result.trace.steps[1].outcome.reason, "This message has already been delivered.");
  assert.equal(contexts[2].progress.feedback, "This message has already been delivered.");
  assert.deepEqual(contexts[2].progress.messagesSpoken, ["The same answer."]);
  assert.equal(result.trace.shapingCalls, 0);
  console.log("PASS: repeated speech is rejected once and then terminates as stalled");
}

// Existing identities survive a two-turn semantic update followed by true recomposition.
{
  const h = harness();
  await h.dispatcher.dispatch({
    type: "express",
    meaning: {
      entities: [{ id: "revenue", type: "concept", label: "Revenue" }, { id: "cost", type: "concept", label: "Cost" }],
      relations: [{ id: "concerns", source: "revenue", type: "contrasts_with", target: "cost" }],
      claims: [], interpretation: "Revenue and cost are the two major concerns.",
    },
    presentation: { form: "comparison" },
  });
  await h.dispatcher.dispatch({ type: "update_entity", entityId: "revenue", changes: { quantity: { value: 20, unit: "USD" } } });
  await h.dispatcher.dispatch({ type: "update_entity", entityId: "cost", changes: { quantity: { value: 80, unit: "USD" } } });
  const before = hash(h.controller.getWorld());
  const recomposed = await h.dispatcher.dispatch({
    type: "recompose_expression",
    presentation: { form: "magnitude", scope: { entityIds: ["revenue", "cost"] }, emphasis: { primaryEntityIds: ["cost"] } },
  });
  assert.equal(recomposed.status, "applied");
  assert.equal(recomposed.expressionTrace.plan.grammar, "quantity");
  assert.equal(hash(h.controller.getWorld()), before);
  assert.deepEqual(h.controller.getWorld().entities.map((entity) => entity.id).sort(), ["cost", "revenue"]);
  console.log("PASS: turn-two magnitude recomposition preserves Revenue and Cost identity without duplication");
}

console.log("Visual Expression Intent V1: 5 groups passed, 0 failed");
