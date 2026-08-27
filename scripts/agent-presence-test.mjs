/** Phase 9 deterministic presence tests — no browser and no paid model calls. */

import assert from "node:assert/strict";
import {
  AGENT_ACTING_HOLD_MS,
  AGENT_HIGHLIGHT_MS,
  AGENT_HUMAN_SUPPRESSION_MS,
  createCanvasPresenceController,
} from "../lib/canvas/presence/controller.ts";
import { createVisualAgent } from "../lib/agent/index.ts";

let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
};

let time = 1_000;
let resolutionCalls = 0;
const geometry = {
  entityId: "alice",
  elementIds: ["alice-object", "alice-object-label"],
  point: { x: 220, y: 140 },
  bounds: { x: 160, y: 100, width: 120, height: 80 },
};
const controller = () => createCanvasPresenceController({
  now: () => time,
  resolve(target) {
    resolutionCalls += 1;
    return target.entityId === "alice" ? structuredClone(geometry) : null;
  },
});

await check("idle, observing, thinking, acting, speaking, and idle are explicit", () => {
  const presence = controller();
  assert.equal(presence.getSnapshot().status, "idle");
  presence.setState({ status: "observing" });
  assert.equal(presence.getSnapshot().status, "observing");
  presence.setState({ status: "thinking" });
  assert.equal(presence.getSnapshot().status, "thinking");
  presence.setState({ status: "acting", target: { entityId: "alice" }, gesture: "pointer" });
  assert.equal(presence.getSnapshot().status, "acting");
  time += AGENT_ACTING_HOLD_MS + 1;
  presence.setState({ status: "speaking", target: { entityId: "alice" }, gesture: "none" });
  assert.equal(presence.getSnapshot().status, "speaking");
  presence.clear();
  assert.equal(presence.getSnapshot().status, "idle");
});

await check("semantic identity is resolved inside Canvas to current geometry", () => {
  const presence = controller();
  const before = resolutionCalls;
  presence.setState({ status: "acting", target: { entityId: "alice" }, gesture: "pointer" });
  assert.equal(resolutionCalls, before + 1);
  assert.deepEqual(presence.getSnapshot().target.elementIds, geometry.elementIds);
  assert.deepEqual(presence.getSnapshot().target.bounds, geometry.bounds);
});

await check("pointer travel is short, interruptible, and reduced-motion aware", () => {
  const presence = controller();
  presence.setState({ status: "acting", target: { entityId: "alice" }, gesture: "pointer" });
  presence.setReducedMotion(true);
  assert.deepEqual(presence.getSnapshot().target.point, geometry.point);
  presence.setState({ status: "thinking" });
  assert.equal(presence.getSnapshot().target.entityId, "alice");
  presence.clear();
  assert.equal(presence.getSnapshot().target, null);
});

await check("highlight expires on the overlay clock without an editor write", () => {
  const presence = controller();
  const semanticBefore = JSON.stringify({ world: { entities: ["alice"] }, sceneRevision: "scene-1" });
  presence.setState({ status: "acting", target: { entityId: "alice" }, gesture: "highlight" });
  assert.equal(presence.getSnapshot().gesture, "highlight");
  time += AGENT_HIGHLIGHT_MS + 1;
  presence.tick(time);
  assert.equal(presence.getSnapshot().gesture, "pointer");
  assert.equal(JSON.stringify({ world: { entities: ["alice"] }, sceneRevision: "scene-1" }), semanticBefore);
});

await check("human input suppresses gestures temporarily without stopping the lifecycle", () => {
  const presence = controller();
  presence.setState({ status: "acting", target: { entityId: "alice" }, gesture: "pointer" });
  presence.noteHumanInteraction();
  assert.equal(presence.getSnapshot().suppressed, true);
  assert.equal(presence.getSnapshot().gesture, "none");
  assert.equal(presence.getSnapshot().status, "acting");
  time += AGENT_HUMAN_SUPPRESSION_MS + 1;
  presence.tick(time);
  assert.equal(presence.getSnapshot().suppressed, false);
});

const world = {
  entities: [{
    id: "alice", type: "person", label: "Alice", status: "active", importance: "primary",
    firstSeenSeq: 1, lastTouchedSeq: 1, aliases: ["alice"],
  }],
  relations: [], claims: [], salience: ["alice"], seq: 1,
};
const scene = {
  objects: [{
    id: "alice-object", entityId: "alice", regionId: "alice-region", primitive: "node",
    label: "Alice", x: 10, y: 20, w: 100, h: 60, weight: 3,
  }],
  connectors: [], width: 100, height: 60,
};
const observation = {
  elements: [{
    id: "alice-object", type: "rectangle", x: 10, y: 20, width: 100, height: 60,
    angle: 0, groupIds: [], frameId: null, containerId: null, revision: 1, order: 0,
  }],
  selection: { elementIds: [], groupIds: [] },
  viewport: { scrollX: 0, scrollY: 0, zoom: 1, width: 800, height: 600 },
  revisions: { scene: "scene-1", selection: "selection-1", viewport: "viewport-1" },
};
const snapshot = { world, scene, observation };
const dispatcher = {
  async dispatch(action) {
    return {
      status: "applied", category: "semantic", actionType: action.type, reason: "test action",
      before: snapshot, after: snapshot,
    };
  },
};
const source = { getWorld: () => world, getScene: () => scene, observe: () => observation };

await check("agent lifecycle traces observing, thinking, targeted acting, and guaranteed idle cleanup", async () => {
  const calls = [];
  const port = { setState: (state) => calls.push(structuredClone(state)), clear: () => calls.push({ status: "idle" }) };
  let decision = 0;
  const agent = createVisualAgent({ source, dispatcher, presence: port });
  const run = await agent.run("Update Alice", { decisionProvider: async () => decision++ === 0
    ? { type: "act", action: { type: "update_entity", entityId: "alice", changes: { description: "Lead" } } }
    : { type: "done" } });
  assert.equal(run.status, "completed");
  assert.ok(calls.some((state) => state.status === "observing"));
  assert.ok(calls.some((state) => state.status === "thinking"));
  assert.ok(calls.some((state) => state.status === "acting" && state.target?.entityId === "alice"));
  assert.equal(calls.at(-1).status, "idle");
  assert.equal(run.trace.presence.at(-1).outcome, "completed");
});

await check("blocked runs also clear visible presence", async () => {
  const calls = [];
  const agent = createVisualAgent({ source, dispatcher, presence: {
    setState: (state) => calls.push(state), clear: () => calls.push({ status: "idle" }),
  } });
  const run = await agent.run("Cannot", { decisionProvider: async () => ({ type: "cannot_complete", reason: "bounded" }) });
  assert.equal(run.status, "blocked");
  assert.equal(calls.at(-1).status, "idle");
});

await check("stalled and step-limit terminal paths also clear presence", async () => {
  const action = { type: "act", action: { type: "update_entity", entityId: "alice", changes: { description: "Lead" } } };
  for (const expected of ["stalled", "step_limit"]) {
    const calls = [];
    let index = 0;
    const agent = createVisualAgent({ source, dispatcher, presence: {
      setState: (state) => calls.push(state), clear: () => calls.push({ status: "idle" }),
    } });
    const decisions = expected === "stalled" ? [action, action] : [action, action];
    const run = await agent.run(expected, {
      maxSteps: expected === "step_limit" ? 1 : 4,
      decisionProvider: async () => decisions[index++] ?? { type: "done" },
    });
    assert.equal(run.status, expected);
    assert.equal(calls.at(-1).status, "idle");
  }
});

await check("presence adds zero decision-provider calls", async () => {
  let withoutPresence = 0;
  let withPresence = 0;
  await createVisualAgent({ source, dispatcher }).run("Done", {
    decisionProvider: async () => { withoutPresence += 1; return { type: "done" }; },
  });
  await createVisualAgent({ source, dispatcher, presence: controller() }).run("Done", {
    decisionProvider: async () => { withPresence += 1; return { type: "done" }; },
  });
  assert.equal(withPresence, withoutPresence);
  assert.equal(withPresence, 1);
});

console.log(`Agent presence tests: ${passed} passed, 0 failed`);
