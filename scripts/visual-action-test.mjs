/** Phase 7 deterministic VisualAction contract tests — no model or browser. */

import assert from "node:assert/strict";
import { ExpressionLiveController } from "../lib/expression/live.ts";
import { createVisualActionDispatcher, VisualActionSchema } from "../lib/visual-actions/index.ts";

let passed = 0;
const check = async (name, fn) => {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
};

const canvasState = {
  elements: [],
  viewport: { scrollX: 900, scrollY: 700, zoom: 0.7, width: 1280, height: 720 },
  sceneRevision: 0,
  viewportRevision: 0,
  writes: 0,
};

const observation = () => ({
  elements: canvasState.elements,
  selection: { elementIds: [], groupIds: [] },
  viewport: { ...canvasState.viewport },
  revisions: {
    scene: `scene-${canvasState.sceneRevision}`,
    selection: "selection-0",
    viewport: `viewport-${canvasState.viewportRevision}`,
  },
});

const fakeCanvas = {
  attach() {},
  async preload() {},
  applyElements() { canvasState.writes += 1; },
  readViewport() { return { ...canvasState.viewport }; },
  applyViewport(viewport) {
    canvasState.writes += 1;
    canvasState.viewport = { ...canvasState.viewport, ...viewport };
    canvasState.viewportRevision += 1;
  },
  observe: observation,
  async applyExpression() { throw new Error("not used by deterministic action harness"); },
  resetExpressionIdentity() {},
};

let lastTrace = null;
const controller = new ExpressionLiveController({
  debounceMs: 0,
  onUpdate: async ({ trace }) => {
    lastTrace = trace;
    canvasState.elements = trace.scene.objects.flatMap((object, order) => [
      {
        id: object.id,
        type: "rectangle",
        x: object.x,
        y: object.y,
        width: object.w,
        height: object.h,
        angle: 0,
        groupIds: [],
        frameId: null,
        containerId: null,
        revision: canvasState.sceneRevision + 1,
        order: order * 2,
      },
      {
        id: `${object.id}-label`,
        type: "text",
        x: object.x,
        y: object.y,
        width: object.w,
        height: object.h,
        angle: 0,
        text: object.label,
        groupIds: [],
        frameId: null,
        containerId: null,
        revision: canvasState.sceneRevision + 1,
        order: order * 2 + 1,
      },
    ]);
    canvasState.sceneRevision += 1;
    canvasState.writes += 1;
  },
});
const dispatcher = createVisualActionDispatcher(controller, fakeCanvas);

const initialMeaning = {
  entities: [
    { id: "a", type: "person", label: "Alice" },
    { id: "x", type: "concept", label: "Project X" },
    { id: "d", type: "person", label: "David" },
  ],
  relations: [{ id: "r1", source: "a", type: "role_of", target: "x", role: "manager" }],
  claims: [{ id: "c1", text: "Project X matters", about: ["x"] }],
  topicEntityId: "a",
  interpretation: "Alice manages Project X and knows David.",
};

await check("VisualAction schema rejects raw geometry", async () => {
  assert.equal(VisualActionSchema.safeParse({ type: "focus", entityId: "alice", x: 500, y: 300 }).success, false);
  assert.equal(VisualActionSchema.safeParse({ type: "create_rectangle", x: 1, y: 2 }).success, false);
});

let result = await dispatcher.dispatch({ type: "express", meaning: initialMeaning });
await check("express reuses MeaningDelta and produces semantic and visual output", async () => {
  assert.equal(result.status, "applied");
  assert.equal(result.category, "semantic");
  assert.equal(result.after.world.entities.length, 3);
  assert.ok(result.after.scene.objects.length > 0);
  assert.ok(result.after.observation.elements.length > 0);
});

const aliceId = controller.getWorld().entities.find((entity) => entity.label === "Alice").id;
const projectId = controller.getWorld().entities.find((entity) => entity.label === "Project X").id;
const davidId = controller.getWorld().entities.find((entity) => entity.label === "David").id;

result = await dispatcher.dispatch({
  type: "update_entity",
  entityId: aliceId,
  changes: { label: "Alice Chen", attributes: [{ key: "role", value: "lead" }] },
});
await check("update preserves stable identity and changes semantic and scene content", async () => {
  assert.equal(result.status, "applied");
  const alice = result.after.world.entities.find((entity) => entity.id === aliceId);
  assert.equal(alice.label, "Alice Chen");
  assert.equal(alice.attributes[0].value, "lead");
  assert.equal(result.after.scene.objects.find((object) => object.entityId === aliceId).label, "Alice Chen");
  assert.ok(lastTrace.patch.updated.some(({ object }) => object.entityId === aliceId));
});

const updateSeq = controller.getWorld().seq;
result = await dispatcher.dispatch({
  type: "update_entity",
  entityId: aliceId,
  changes: { label: "Alice Chen", attributes: [{ key: "role", value: "lead" }] },
});
await check("identical update is an idempotent noop", async () => {
  assert.equal(result.status, "noop");
  assert.equal(controller.getWorld().seq, updateSeq);
});

result = await dispatcher.dispatch({
  type: "relate_entities",
  sourceEntityId: aliceId,
  targetEntityId: davidId,
  relation: { type: "depends_on", confidence: "high" },
});
const reportsRelationId = controller.getWorld().relations.find(
  (relation) => relation.source === aliceId && relation.target === davidId && relation.type === "depends_on",
)?.id;
await check("relationship action updates WorldState before Expression represents it", async () => {
  assert.equal(result.status, "applied");
  assert.ok(reportsRelationId);
  assert.ok(result.after.scene.connectors.some((connector) => connector.relationId === reportsRelationId));
  assert.equal(lastTrace.world.relations.some((relation) => relation.id === reportsRelationId), true);
});

const relationSeq = controller.getWorld().seq;
result = await dispatcher.dispatch({
  type: "relate_entities",
  sourceEntityId: aliceId,
  targetEntityId: davidId,
  relation: { type: "depends_on", confidence: "high" },
});
await check("duplicate relationship is an idempotent noop", async () => {
  assert.equal(result.status, "noop");
  assert.equal(controller.getWorld().seq, relationSeq);
});

result = await dispatcher.dispatch({ type: "remove_relation", relationId: reportsRelationId });
await check("remove_relation removes semantic relationship and connector", async () => {
  assert.equal(result.status, "applied");
  assert.equal(result.after.world.relations.some((relation) => relation.id === reportsRelationId), false);
  assert.equal(result.after.scene.connectors.some((connector) => connector.relationId === reportsRelationId), false);
});

result = await dispatcher.dispatch({ type: "remove_relation", relationId: reportsRelationId });
await check("repeated relation removal is a noop", async () => assert.equal(result.status, "noop"));

const beforeInvalidWorld = JSON.stringify(controller.getWorld());
const beforeInvalidScene = observation().revisions.scene;
const beforeInvalidWrites = canvasState.writes;
result = await dispatcher.dispatch({ type: "update_entity", entityId: "missing-entity", changes: { label: "Wrong" } });
await check("unknown semantic identity is rejected without changing world or canvas", async () => {
  assert.equal(result.status, "rejected");
  assert.equal(result.code, "unknown_entity");
  assert.equal(JSON.stringify(controller.getWorld()), beforeInvalidWorld);
  assert.equal(observation().revisions.scene, beforeInvalidScene);
  assert.equal(canvasState.writes, beforeInvalidWrites);
});

const projectObjectId = controller.getScene().objects.find((object) => object.entityId === projectId)?.id;
result = await dispatcher.dispatch({ type: "remove_entity", entityId: projectId });
await check("remove_entity cascades semantic references and produces visual removal", async () => {
  assert.equal(result.status, "applied");
  assert.equal(result.after.world.entities.some((entity) => entity.id === projectId), false);
  assert.equal(result.after.world.relations.some((relation) => relation.source === projectId || relation.target === projectId), false);
  assert.equal(result.after.world.claims.some((claim) => claim.about?.includes(projectId)), false);
  assert.equal(lastTrace.patch.removed.includes(projectObjectId), true);
  assert.equal(result.after.observation.elements.some((element) => element.id === projectObjectId || element.id.startsWith(`${projectObjectId}-`)), false);
});

result = await dispatcher.dispatch({ type: "remove_entity", entityId: projectId });
await check("repeated entity removal is a noop", async () => assert.equal(result.status, "noop"));

const worldBeforeFocus = JSON.stringify(controller.getWorld());
const sceneBeforeFocus = JSON.stringify(controller.getScene());
const viewportBeforeFocus = observation().revisions.viewport;
result = await dispatcher.dispatch({ type: "focus", entityId: aliceId });
await check("focus changes only viewport through Canvas", async () => {
  assert.equal(result.status, "applied");
  assert.equal(JSON.stringify(controller.getWorld()), worldBeforeFocus);
  assert.equal(JSON.stringify(controller.getScene()), sceneBeforeFocus);
  assert.notEqual(result.after.observation.revisions.viewport, viewportBeforeFocus);
});

result = await dispatcher.dispatch({ type: "focus", entityId: aliceId });
await check("repeated focus at the deterministic camera target is a noop", async () => assert.equal(result.status, "noop"));

const invalid = await dispatcher.dispatch({ type: "focus", entityId: davidId, x: 10 });
await check("strict dispatcher rejects extra coordinate fields", async () => {
  assert.equal(invalid.status, "rejected");
  assert.equal(invalid.category, "validation");
});

console.log(`VisualAction tests: ${passed} passed, 0 failed`);
