/** Phase 10 deterministic live interaction orchestration tests — no paid model calls. */

import assert from "node:assert/strict";
import { createVisualAgent } from "../lib/agent/index.ts";
import { classifyLiveInteraction, createLiveInteractionOrchestrator } from "../lib/interaction/index.ts";

let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
};

const world = {
  entities: [
    { id: "alice", type: "person", label: "Alice", status: "active", importance: "primary", firstSeenSeq: 1, lastTouchedSeq: 1, aliases: ["alice"] },
    { id: "security", type: "concept", label: "Security", status: "active", importance: "supporting", firstSeenSeq: 1, lastTouchedSeq: 1, aliases: ["security"] },
  ],
  relations: [], claims: [], salience: ["alice", "security"], seq: 1,
};
const scene = {
  objects: [
    { id: "alice-object", entityId: "alice", regionId: "alice-region", primitive: "node", label: "Alice", x: 10, y: 20, w: 100, h: 60, weight: 3 },
    { id: "security-object", entityId: "security", regionId: "security-region", primitive: "node", label: "Security", x: 220, y: 20, w: 100, h: 60, weight: 1 },
  ],
  connectors: [], width: 320, height: 80,
};

function harness() {
  let revision = 1;
  let providerCalls = 0;
  let dispatches = 0;
  const presence = [];
  const observe = () => ({
    elements: scene.objects.map((object, order) => ({
      id: object.id, type: "rectangle", x: object.x + (revision - 1) * 40, y: object.y,
      width: object.w, height: object.h, angle: 0, groupIds: [], frameId: null,
      containerId: null, revision, order,
    })),
    selection: { elementIds: [], groupIds: [] },
    viewport: { scrollX: 0, scrollY: 0, zoom: 1, width: 800, height: 600 },
    revisions: { scene: `scene-${revision}`, selection: "selection-1", viewport: "viewport-1" },
  });
  const source = { getWorld: () => world, getScene: () => scene, observe };
  const dispatcher = {
    async dispatch(action) {
      dispatches += 1;
      const before = { world, scene, observation: observe() };
      revision += 1;
      return {
        status: "applied", category: action.type === "focus" ? "presentation" : "semantic",
        actionType: action.type, reason: "deterministic test action", before,
        after: { world, scene, observation: observe() },
      };
    },
  };
  const agent = createVisualAgent({
    source,
    dispatcher,
    presence: { setState: (state) => presence.push(state), clear: () => presence.push({ status: "idle" }) },
  });
  return {
    agent, observe, presence,
    moveCanvas: () => { revision += 1; },
    counts: () => ({ providerCalls, dispatches }),
    provider: (decisions) => async (context) => {
      providerCalls += 1;
      const next = decisions.shift();
      return typeof next === "function" ? next(context) : next;
    },
  };
}

await check("routing categories stay small and conservative", () => {
  assert.equal(classifyLiveInteraction("The API talks to the database.").intent, "express");
  assert.equal(classifyLiveInteraction("There are three reasons this failed.").intent, "express");
  assert.equal(classifyLiveInteraction("Remove that.").intent, "manipulate");
  assert.equal(classifyLiveInteraction("Connect those two.").intent, "manipulate");
  assert.equal(classifyLiveInteraction("Actually that's wrong.").intent, "manipulate");
  assert.equal(classifyLiveInteraction("No, Alice manages Bob, not David.").intent, "manipulate");
  assert.equal(classifyLiveInteraction("Focus on the second idea.").intent, "present");
  assert.equal(classifyLiveInteraction("Show me the payment flow.").intent, "present");
  assert.equal(classifyLiveInteraction("This API is fast.").intent, "express", "a pronoun alone must not invoke the agent");
  assert.equal(classifyLiveInteraction("  ").intent, "ignore");
});

await check("ordinary settled meaning uses Expression and invokes no VisualAgent", async () => {
  const h = harness();
  let expressionCalls = 0;
  const orchestrator = createLiveInteractionOrchestrator({
    agent: h.agent,
    express: async () => { expressionCalls += 1; return { status: "updated", consumedIds: ["new"] }; },
  });
  const result = await orchestrator.submit({ id: "new", text: "Revenue increased while costs stayed flat.", settledAtMs: Date.now(), meaning: { entities: [], relations: [], claims: [], interpretation: "Revenue changed." } });
  assert.equal(result.intent, "express");
  assert.equal(expressionCalls, 1);
  assert.equal(h.counts().providerCalls, 0);
  assert.equal(result.trace.metrics.routingModelCalls, 0);
  assert.equal(result.trace.metrics.modelCalls, 0);
});

await check("explicit manipulation and presentation use the VisualAgent", async () => {
  const h = harness();
  let expressionCalls = 0;
  const orchestrator = createLiveInteractionOrchestrator({ agent: h.agent, express: async () => { expressionCalls += 1; return { status: "updated", consumedIds: [] }; } });
  const manipulated = await orchestrator.submit({ id: "m", text: "Remove that.", settledAtMs: Date.now() }, {
    decisionProvider: h.provider([{ type: "done" }]),
  });
  const presented = await orchestrator.submit({ id: "p", text: "Focus on the second idea.", settledAtMs: Date.now() }, {
    decisionProvider: h.provider([{ type: "done" }]),
  });
  assert.equal(manipulated.intent, "manipulate");
  assert.equal(presented.intent, "present");
  assert.equal(expressionCalls, 0);
  assert.equal(h.counts().providerCalls, 2);
});

await check("VisualAgent cancellation stops a provider result before it can become an action and clears presence", async () => {
  const h = harness();
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const run = h.agent.run("Remove that", { decisionProvider: async () => pending });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(h.agent.cancel("new speech arrived"), true);
  release({ type: "act", action: { type: "remove_entity", entityId: "alice" } });
  const result = await run;
  assert.equal(result.status, "cancelled");
  assert.equal(result.reason, "new speech arrived");
  assert.equal(h.counts().dispatches, 0);
  assert.equal(h.presence.at(-1).status, "idle");
});

await check("one active agent plus one latest pending instruction bounds interruption", async () => {
  const h = harness();
  let release;
  const pendingDecision = new Promise((resolve) => { release = resolve; });
  const orchestrator = createLiveInteractionOrchestrator({ agent: h.agent, express: async () => ({ status: "updated", consumedIds: [] }) });
  const first = orchestrator.submit({ id: "one", text: "Remove that." }, { decisionProvider: async () => pendingDecision });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const second = orchestrator.submit({ id: "two", text: "Connect those two." }, { decisionProvider: async () => ({ type: "done" }) });
  const third = orchestrator.submit({ id: "three", text: "Focus on the second idea." }, { decisionProvider: async () => ({ type: "done" }) });
  assert.equal((await second).status, "cancelled");
  release({ type: "done" });
  assert.equal((await first).status, "cancelled");
  assert.equal((await third).status, "completed");
  assert.equal(orchestrator.traces().length, 3);
});

await check("a continuing agent step sees a human's latest canvas observation", async () => {
  const h = harness();
  let decision = 0;
  const orchestrator = createLiveInteractionOrchestrator({ agent: h.agent, express: async () => ({ status: "updated", consumedIds: [] }) });
  const result = await orchestrator.submit({ id: "stale", text: "Connect those two." }, {
    decisionProvider: async (context) => {
      if (decision++ === 0) {
        h.moveCanvas();
        return { type: "act", action: { type: "focus", entityId: "alice" } };
      }
      assert.equal(context.canvas.revisions.scene, "scene-3");
      assert.equal(context.canvas.elements.find((element) => element.semanticEntityId === "alice").bounds.x, 90);
      return { type: "done" };
    },
  });
  assert.equal(result.status, "completed");
  assert.equal(result.agent.trace.steps[1].observed.scene, "scene-3");
});

await check("route and visual-change metrics are captured without a routing model call", async () => {
  const h = harness();
  let release;
  const expression = new Promise((resolve) => { release = resolve; });
  let clock = 1_000;
  const orchestrator = createLiveInteractionOrchestrator({ agent: h.agent, now: () => clock, express: async () => expression });
  const pending = orchestrator.submit({ id: "metrics", text: "A new concept appears.", settledAtMs: 990, meaning: { entities: [], relations: [], claims: [], interpretation: "New." } });
  clock = 1_040;
  orchestrator.noteVisualChange(["metrics"]);
  release({ status: "updated", consumedIds: ["metrics"] });
  const result = await pending;
  assert.equal(result.trace.metrics.speechFinalToRouteMs, 10);
  assert.equal(result.trace.metrics.speechFinalToFirstVisualChangeMs, 50);
  assert.equal(result.trace.metrics.expressRouteToFirstVisualChangeMs, 40);
  assert.equal(result.trace.metrics.routingModelCalls, 0);
});

console.log(`Live interaction tests: ${passed} passed, 0 failed`);
