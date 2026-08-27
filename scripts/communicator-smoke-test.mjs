/** Deterministic smoke test for lib/communicator/, no paid calls. Not part of npm test yet — this is a dev-only experimental layer. */
import assert from "node:assert/strict";
import { ExpressionLiveController } from "../lib/expression/live.ts";
import { createVisualActionDispatcher } from "../lib/visual-actions/index.ts";
import { runCommunicator } from "../lib/communicator/index.ts";

function makeHarness() {
  const state = { elements: [], sceneRevision: 0, viewportRevision: 0, viewport: { scrollX: 0, scrollY: 0, zoom: 1, width: 1280, height: 720 } };
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
      state.sceneRevision += 1;
      state.elements = trace.scene.objects.map((o) => ({ id: o.id, type: "rectangle", x: o.x, y: o.y, width: o.w, height: o.h, angle: 0, groupIds: [], frameId: null, containerId: null, revision: state.sceneRevision, order: 0, semanticEntityId: o.entityId }));
    },
  });
  const dispatcher = createVisualActionDispatcher(controller, canvas);
  return { controller, dispatcher, source: { getWorld: () => controller.getWorld(), getScene: () => controller.getScene(), observe } };
}

// 1. "speak" then "done" -> completed, no canvas mutation, zero shaping calls.
{
  const h = makeHarness();
  let i = 0;
  const decisions = [{ type: "speak", message: "hello" }, { type: "done" }];
  const result = await runCommunicator({ userMessage: "hi", communicationGoal: "greet" }, {
    source: h.source, dispatcher: h.dispatcher, decisionProvider: async () => decisions[i++],
  });
  assert.equal(result.status, "completed");
  assert.equal(result.trace.shapingCalls, 0);
  assert.equal(h.controller.getWorld().entities.length, 0);
  console.log("PASS: speak then done completes with no mutation");
}

// 2. "visualize" dispatches through the real VisualAction path and shapes a MeaningDelta via a scripted shape provider... but shapeVisualIntent isn't injectable, so this scripted test instead checks that an invalid decision blocks cleanly.
{
  const h = makeHarness();
  const result = await runCommunicator({ userMessage: "hi", communicationGoal: "x" }, {
    source: h.source, dispatcher: h.dispatcher, decisionProvider: async () => ({ type: "not_a_real_type" }),
  });
  assert.equal(result.status, "blocked");
  console.log("PASS: invalid decision blocks without dispatching");
}

// 3. "emphasize" on an unknown entity id is rejected by the existing dispatcher, cleanly, without throwing.
{
  const h = makeHarness();
  let i = 0;
  const decisions = [{ type: "emphasize", target: "nonexistent" }, { type: "done" }];
  const result = await runCommunicator({ userMessage: "hi", communicationGoal: "x" }, {
    source: h.source, dispatcher: h.dispatcher, decisionProvider: async () => decisions[i++],
  });
  assert.equal(result.trace.steps[0].outcome.status, "rejected");
  console.log("PASS: emphasize on an unknown entity rejects cleanly through the existing dispatcher");
}

console.log("communicator smoke test: 3 passed, 0 failed");
