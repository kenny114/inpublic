/** Phase 8 deterministic VisualAgent loop tests — no paid model calls. */

import assert from "node:assert/strict";
import { createScriptedDecisionProvider, createVisualAgent } from "../lib/agent/index.ts";
import { ExpressionLiveController } from "../lib/expression/live.ts";
import { createVisualActionDispatcher } from "../lib/visual-actions/index.ts";

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

const INITIAL_MEANING = {
  entities: [
    { id: "a", type: "person", label: "Alice" },
    { id: "x", type: "concept", label: "Project X" },
  ],
  relations: [],
  claims: [],
  topicEntityId: "a",
  interpretation: "Alice and Project X.",
};

async function harness() {
  const state = {
    elements: [],
    viewport: { scrollX: 800, scrollY: 600, zoom: 0.7, width: 1280, height: 720 },
    sceneRevision: 0,
    viewportRevision: 0,
    observations: 0,
    writes: 0,
  };
  const observe = () => {
    state.observations += 1;
    return {
      elements: state.elements,
      selection: { elementIds: [], groupIds: [] },
      viewport: { ...state.viewport },
      revisions: {
        scene: `scene-${state.sceneRevision}`,
        selection: "selection-0",
        viewport: `viewport-${state.viewportRevision}`,
      },
    };
  };
  const canvas = {
    attach() {},
    async preload() {},
    applyElements() { state.writes += 1; },
    readViewport() { return { ...state.viewport }; },
    applyViewport(viewport) {
      state.viewport = { ...state.viewport, ...viewport };
      state.viewportRevision += 1;
      state.writes += 1;
    },
    observe,
    async applyExpression() { throw new Error("not used by deterministic agent harness"); },
    resetExpressionIdentity() {},
  };
  const controller = new ExpressionLiveController({
    debounceMs: 0,
    onUpdate: async ({ trace }) => {
      state.sceneRevision += 1;
      state.elements = trace.scene.objects.flatMap((object, order) => [
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
          revision: state.sceneRevision,
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
          revision: state.sceneRevision,
          order: order * 2 + 1,
        },
      ]);
      state.writes += 1;
    },
  });
  const dispatcher = createVisualActionDispatcher(controller, canvas);
  const seeded = await dispatcher.dispatch({ type: "express", meaning: INITIAL_MEANING });
  assert.equal(seeded.status, "applied");
  const source = {
    getWorld: () => controller.getWorld(),
    getScene: () => controller.getScene(),
    observe,
  };
  const agent = createVisualAgent({ source, dispatcher });
  const aliceId = controller.getWorld().entities.find((entity) => entity.label === "Alice").id;
  const projectId = controller.getWorld().entities.find((entity) => entity.label === "Project X").id;
  return { state, controller, dispatcher, source, agent, aliceId, projectId };
}

const updateAlice = (aliceId, description = "Leads the project") => ({
  type: "act",
  action: { type: "update_entity", entityId: aliceId, changes: { description } },
});

await check("one semantic action then done updates WorldState and canvas", async () => {
  const h = await harness();
  const beforeScene = h.state.sceneRevision;
  const run = await h.agent.run("Describe Alice", {
    decisionProvider: createScriptedDecisionProvider([updateAlice(h.aliceId), { type: "done" }]),
  });
  assert.equal(run.status, "completed");
  assert.equal(run.steps, 1);
  assert.equal(h.controller.getWorld().entities.find((entity) => entity.id === h.aliceId).description, "Leads the project");
  assert.ok(h.state.sceneRevision > beforeScene);
  assert.equal(run.trace.steps[0].actionResult.status, "applied");
});

await check("the model context contains compact semantic identity and actual canvas bounds", async () => {
  const h = await harness();
  const run = await h.agent.run("Inspect the world", {
    decisionProvider: async (context) => {
      const alice = context.world.entities.find((entity) => entity.id === h.aliceId);
      const mark = context.canvas.elements.find((element) => element.semanticEntityId === h.aliceId);
      assert.equal(alice.label, "Alice");
      assert.equal("aliases" in alice, false);
      assert.equal("provenance" in alice, false);
      assert.ok(Number.isFinite(mark.bounds.x));
      assert.equal(typeof context.canvas.revisions.scene, "string");
      return { type: "done" };
    },
  });
  assert.equal(run.status, "completed");
});

await check("multiple actions receive a fresh resulting observation between decisions", async () => {
  const h = await harness();
  const contexts = [];
  const scripted = createScriptedDecisionProvider([
    updateAlice(h.aliceId),
    {
      type: "act",
      action: {
        type: "relate_entities",
        sourceEntityId: h.aliceId,
        targetEntityId: h.projectId,
        relation: { type: "role_of", role: "manager" },
      },
    },
    { type: "done" },
  ]);
  const run = await h.agent.run("Alice manages Project X", {
    decisionProvider: async (context) => {
      contexts.push(context);
      return scripted(context);
    },
  });
  assert.equal(run.status, "completed");
  assert.equal(run.steps, 2);
  assert.notEqual(contexts[0].canvas.revisions.scene, contexts[1].canvas.revisions.scene);
  assert.equal(contexts[1].previousResult.status, "applied");
  assert.equal(contexts[2].previousResult.actionType, "relate_entities");
  assert.ok(h.controller.getWorld().relations.some((relation) => relation.source === h.aliceId && relation.target === h.projectId));
});

await check("presentation action changes viewport without semantic corruption", async () => {
  const h = await harness();
  const beforeWorld = JSON.stringify(h.controller.getWorld());
  const beforeViewport = h.state.viewportRevision;
  const run = await h.agent.run("Focus Alice", {
    decisionProvider: createScriptedDecisionProvider([
      { type: "act", action: { type: "focus", entityId: h.aliceId } },
      { type: "done" },
    ]),
  });
  assert.equal(run.status, "completed");
  assert.equal(JSON.stringify(h.controller.getWorld()), beforeWorld);
  assert.ok(h.state.viewportRevision > beforeViewport);
  assert.equal(run.trace.steps[0].actionResult.changed.world, false);
  assert.equal(run.trace.steps[0].actionResult.changed.viewport, true);
});

await check("rejected action feeds bounded recovery into the next decision", async () => {
  const h = await harness();
  const contexts = [];
  const scripted = createScriptedDecisionProvider([
    { type: "act", action: { type: "update_entity", entityId: "missing", changes: { label: "Wrong" } } },
    updateAlice(h.aliceId, "Recovered"),
    { type: "done" },
  ]);
  const run = await h.agent.run("Update Alice", {
    decisionProvider: async (context) => {
      contexts.push(context);
      return scripted(context);
    },
  });
  assert.equal(run.status, "completed");
  assert.equal(run.steps, 2);
  assert.equal(contexts[1].previousResult.status, "rejected");
  assert.equal(contexts[1].previousResult.code, "unknown_entity");
});

await check("one noop is fed back and may be followed by done", async () => {
  const h = await harness();
  const noop = updateAlice(h.aliceId, undefined);
  noop.action.changes = { label: "Alice" };
  const run = await h.agent.run("Keep Alice named Alice", {
    decisionProvider: createScriptedDecisionProvider([noop, { type: "done" }]),
  });
  assert.equal(run.status, "completed");
  assert.equal(run.trace.steps[0].actionResult.status, "noop");
});

await check("repeated identical noop at the same revision stalls", async () => {
  const h = await harness();
  const noop = { type: "act", action: { type: "update_entity", entityId: h.aliceId, changes: { label: "Alice" } } };
  const run = await h.agent.run("Keep repeating", {
    decisionProvider: createScriptedDecisionProvider([noop, noop, { type: "done" }]),
  });
  assert.equal(run.status, "stalled");
  assert.equal(run.steps, 2);
  assert.match(run.reason, /repeated noop/);
});

await check("repeated identical rejection at the same revision stalls", async () => {
  const h = await harness();
  const rejected = { type: "act", action: { type: "remove_entity", entityId: "missing" } };
  // Removal of an absent entity is a safe noop, so use a state-invalid exact update.
  rejected.action = { type: "update_entity", entityId: "missing", changes: { label: "Wrong" } };
  const run = await h.agent.run("Keep rejecting", {
    decisionProvider: createScriptedDecisionProvider([rejected, rejected, { type: "done" }]),
  });
  assert.equal(run.status, "stalled");
  assert.equal(run.steps, 2);
  assert.match(run.reason, /repeated rejected/);
});

await check("two applied results without semantic or canvas progress stall", async () => {
  const h = await harness();
  const inertDispatcher = {
    async dispatch(input) {
      const snapshot = {
        world: h.controller.getWorld(),
        scene: h.controller.getScene(),
        observation: h.source.observe(),
      };
      return {
        status: "applied",
        category: "semantic",
        actionType: input.type,
        reason: "reported applied without a state change",
        before: snapshot,
        after: snapshot,
      };
    },
  };
  const agent = createVisualAgent({ source: h.source, dispatcher: inertDispatcher });
  const action = updateAlice(h.aliceId, "Never applied");
  const run = await agent.run("Detect false progress", {
    decisionProvider: createScriptedDecisionProvider([action, action, { type: "done" }]),
  });
  assert.equal(run.status, "stalled");
  assert.equal(run.steps, 2);
  assert.match(run.reason, /without changing/);
});

await check("step budget exhaustion is structured and does not execute an extra action", async () => {
  const h = await harness();
  const first = updateAlice(h.aliceId, "First");
  const second = updateAlice(h.aliceId, "Second");
  const run = await h.agent.run("Do too much", {
    maxSteps: 1,
    decisionProvider: createScriptedDecisionProvider([first, second]),
  });
  assert.equal(run.status, "step_limit");
  assert.equal(run.steps, 1);
  assert.equal(h.controller.getWorld().entities.find((entity) => entity.id === h.aliceId).description, "First");
});

await check("invalid structured model output blocks without dispatch", async () => {
  const h = await harness();
  const beforeWorld = JSON.stringify(h.controller.getWorld());
  const beforeWrites = h.state.writes;
  const run = await h.agent.run("Invalid output", {
    decisionProvider: createScriptedDecisionProvider([{ type: "act", actions: [], x: 10 }]),
  });
  assert.equal(run.status, "blocked");
  assert.equal(run.steps, 0);
  assert.equal(run.trace.steps[0].decision.type, "invalid_decision");
  assert.equal(JSON.stringify(h.controller.getWorld()), beforeWorld);
  assert.equal(h.state.writes, beforeWrites);
});

await check("done immediately completes without action", async () => {
  const h = await harness();
  const run = await h.agent.run("Already satisfied", {
    decisionProvider: createScriptedDecisionProvider([{ type: "done" }]),
  });
  assert.equal(run.status, "completed");
  assert.equal(run.steps, 0);
});

await check("cannot_complete returns a structured blocked result", async () => {
  const h = await harness();
  const run = await h.agent.run("Move Alice to raw coordinates", {
    decisionProvider: createScriptedDecisionProvider([{ type: "cannot_complete", reason: "raw geometry is unsupported" }]),
  });
  assert.equal(run.status, "blocked");
  assert.equal(run.steps, 0);
  assert.equal(run.reason, "raw geometry is unsupported");
});

await check("the loop is serialized and refuses a concurrent run", async () => {
  const h = await harness();
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const first = h.agent.run("Wait", { decisionProvider: async () => pending });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const second = await h.agent.run("Race", {
    decisionProvider: createScriptedDecisionProvider([{ type: "done" }]),
  });
  assert.equal(second.status, "blocked");
  assert.match(second.reason, /already running/);
  release({ type: "done" });
  assert.equal((await first).status, "completed");
});

console.log(`VisualAgent tests: ${passed} passed, 0 failed`);
