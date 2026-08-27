/** Five deterministic Phase 10 end-to-end evaluation scenarios. No paid model calls. */

import assert from "node:assert/strict";
import fs from "node:fs";
import { createVisualAgent } from "../lib/agent/index.ts";
import { ExpressionLiveController } from "../lib/expression/live.ts";
import { createLiveInteractionOrchestrator } from "../lib/interaction/index.ts";
import { createVisualActionDispatcher } from "../lib/visual-actions/index.ts";

const scenarios = JSON.parse(fs.readFileSync(new URL("../evaluation/scenarios/live-interaction.json", import.meta.url), "utf8"));

const BUILD = {
  entities: [
    { id: "release", type: "concept", label: "Release" },
    { id: "testing", type: "concept", label: "Testing" },
    { id: "observability", type: "concept", label: "Observability" },
    { id: "rollback", type: "concept", label: "Rollback" },
  ],
  relations: [
    { id: "r-test", source: "testing", type: "supports", target: "release" },
    { id: "r-observe", source: "observability", type: "supports", target: "release" },
    { id: "r-rollback", source: "rollback", type: "supports", target: "release" },
  ], claims: [], interpretation: "Testing, observability, and rollback support a release.",
};

function makeHarness() {
  const state = {
    elements: [], sceneRevision: 0, viewportRevision: 0, observations: 0,
    viewport: { scrollX: 0, scrollY: 0, zoom: 1, width: 1280, height: 720 },
  };
  const observe = () => {
    state.observations += 1;
    return {
      elements: structuredClone(state.elements), selection: { elementIds: [], groupIds: [] }, viewport: { ...state.viewport },
      revisions: { scene: `scene-${state.sceneRevision}`, selection: "selection-0", viewport: `viewport-${state.viewportRevision}` },
    };
  };
  const canvas = {
    presence: { setState() {}, clear() {}, getSnapshot() { return {}; }, subscribe() { return () => {}; }, noteHumanInteraction() {}, setReducedMotion() {}, tick() {} },
    attach() {}, async preload() {}, applyElements() {}, readViewport() { return { ...state.viewport }; },
    applyViewport(viewport) { state.viewport = { ...state.viewport, ...viewport }; state.viewportRevision += 1; },
    observe, async applyExpression() { throw new Error("not used by evaluation harness"); }, resetExpressionIdentity() {},
  };
  const controller = new ExpressionLiveController({
    debounceMs: 0,
    onUpdate: async ({ trace }) => {
      state.sceneRevision += 1;
      state.elements = trace.scene.objects.flatMap((object, order) => [
        { id: object.id, type: "rectangle", x: object.x, y: object.y, width: object.w, height: object.h, angle: 0, groupIds: [], frameId: null, containerId: null, revision: state.sceneRevision, order: order * 2 },
        { id: `${object.id}-label`, type: "text", x: object.x, y: object.y, width: object.w, height: object.h, angle: 0, text: object.label, groupIds: [], frameId: null, containerId: null, revision: state.sceneRevision, order: order * 2 + 1 },
      ]);
    },
  });
  const dispatcher = createVisualActionDispatcher(controller, canvas);
  const agent = createVisualAgent({
    source: { getWorld: () => controller.getWorld(), getScene: () => controller.getScene(), observe },
    dispatcher,
  });
  const orchestrator = createLiveInteractionOrchestrator({
    agent,
    express: (input) => controller.express({ id: input.id, text: input.text, delta: input.meaning, source: "human_speech" }),
  });
  const express = (id, text, meaning) => orchestrator.submit({ id, text, meaning, source: "speech", settledAtMs: Date.now() });
  const agentTurn = (id, text, decisions, inspect) => {
    let index = 0;
    return orchestrator.submit({ id, text, source: "speech", settledAtMs: Date.now() }, {
      decisionProvider: async (context) => {
        inspect?.(context, index);
        return decisions[index++];
      },
    });
  };
  return { state, controller, orchestrator, express, agentTurn };
}

const reports = [];
const baseReport = (scenario) => ({
  id: scenario.id,
  category: scenario.category,
  transcript: scenario.transcript,
  route: null,
  modelCalls: 0,
  visualActions: [],
  actionResults: [],
  agentSteps: 0,
  terminalStatus: null,
  terminalReason: null,
  canvasRevisions: [],
  elapsedLatency: {},
  quality: {
    continuationTurns: 0,
    unnecessaryActions: 0,
    rejectedActions: 0,
    stalledRuns: 0,
    clipping: false,
    incorrectConnection: false,
    unexpectedDeletion: false,
    unexpectedCameraMovement: false,
  },
  finalSemanticResult: "",
  finalCanvasResult: "",
  issues: [],
  gates: {
    routeCorrect: false, semanticCorrect: false, targetIdentityCorrect: false, visualCompletion: false,
    zeroDraw: false, invalidTarget: false, unintendedDeletion: false, persistentClipping: false,
    stalledLoop: false, unexpectedCameraMovement: false, humanInterruptionRecovery: true,
  },
});

for (const scenario of scenarios) {
  const h = makeHarness();
  const report = baseReport(scenario);
  try {
    let result;
    if (scenario.id === "build") {
      result = await h.express("build", scenario.transcript, BUILD);
      report.gates.semanticCorrect = h.controller.getWorld().entities.length === 4;
    } else if (scenario.id === "connect") {
      await h.express("seed", "Latency, cost, and security are release problems.", {
        entities: [
          { id: "latency", type: "concept", label: "Latency" },
          { id: "cost", type: "concept", label: "Cost" },
          { id: "security", type: "concept", label: "Security" },
        ], relations: [], claims: [], interpretation: "Latency, cost, and security are problems.",
      });
      const entities = h.controller.getWorld().entities;
      const security = entities.find((entity) => entity.label === "Security").id;
      const cost = entities.find((entity) => entity.label === "Cost").id;
      result = await h.agentTurn("connect", scenario.transcript, [
        { type: "act", action: { type: "relate_entities", sourceEntityId: security, targetEntityId: cost, relation: { type: "relates_to" } } },
        { type: "done" },
      ]);
      report.gates.semanticCorrect = h.controller.getWorld().relations.some((relation) => relation.source === security && relation.target === cost);
      report.gates.targetIdentityCorrect = report.gates.semanticCorrect;
    } else if (scenario.id === "correct") {
      await h.express("seed", "Alice leads the team.", { entities: [{ id: "alice", type: "person", label: "Alice" }], relations: [], claims: [], interpretation: "Alice leads." });
      const alice = h.controller.getWorld().entities.find((entity) => entity.label === "Alice").id;
      result = await h.agentTurn("correct", scenario.transcript, [
        { type: "act", action: { type: "update_entity", entityId: alice, changes: { label: "Alicia" } } },
        { type: "done" },
      ]);
      report.gates.semanticCorrect = h.controller.getWorld().entities.filter((entity) => entity.id === alice && entity.label === "Alicia").length === 1;
      report.gates.targetIdentityCorrect = report.gates.semanticCorrect;
    } else if (scenario.id === "remove") {
      await h.express("seed", "The reasons are latency, cost, and complexity.", {
        entities: [
          { id: "latency", type: "concept", label: "Latency" },
          { id: "cost", type: "concept", label: "Cost" },
          { id: "complexity", type: "concept", label: "Complexity" },
        ], relations: [], claims: [], interpretation: "There are three reasons.",
      });
      const before = h.controller.getWorld().entities;
      const cost = before.find((entity) => entity.label === "Cost").id;
      result = await h.agentTurn("remove", scenario.transcript, [
        { type: "act", action: { type: "remove_entity", entityId: cost } },
        { type: "done" },
      ]);
      const after = h.controller.getWorld().entities;
      report.gates.semanticCorrect = !after.some((entity) => entity.id === cost);
      report.gates.targetIdentityCorrect = report.gates.semanticCorrect;
      report.gates.unintendedDeletion = after.length !== before.length - 1;
    } else {
      const first = await h.express("continue-build", "The checkout flow has a payment problem.", {
        entities: [
          { id: "checkout", type: "action", label: "Checkout" },
          { id: "payment", type: "concept", label: "Payment" },
          { id: "security", type: "concept", label: "Security" },
        ], relations: [{ id: "r-pay", source: "checkout", type: "contains", target: "payment" }], claims: [], interpretation: "Checkout has a payment problem.",
      });
      const payment = h.controller.getWorld().entities.find((entity) => entity.label === "Payment").id;
      const security = h.controller.getWorld().entities.find((entity) => entity.label === "Security").id;
      const paymentObject = h.controller.getScene().objects.find((object) => object.entityId === payment);
      const moved = h.state.elements.find((element) => element.id === paymentObject.id);
      moved.x += 175;
      h.state.sceneRevision += 1;
      let observedManualMove = false;
      result = await h.agentTurn("continue-connect", "Connect this to the security issue.", [
        { type: "act", action: { type: "relate_entities", sourceEntityId: payment, targetEntityId: security, relation: { type: "relates_to" } } },
        { type: "done" },
      ], (context, index) => {
        if (index !== 0) return;
        observedManualMove = context.canvas.elements.some((element) => element.semanticEntityId === payment && element.bounds.x === moved.x);
      });
      report.gates.semanticCorrect = h.controller.getWorld().relations.some((relation) => relation.source === payment && relation.target === security);
      report.gates.targetIdentityCorrect = report.gates.semanticCorrect;
      report.gates.humanInterruptionRecovery = observedManualMove;
      report.route = [first.intent, result.intent];
    }

    const trace = result.trace;
    report.terminalStatus = result.status;
    report.terminalReason = result.reason ?? result.agent?.reason ?? null;
    report.route ??= trace.intent;
    report.modelCalls = trace.metrics.modelCalls;
    report.agentSteps = trace.metrics.agentSteps;
    report.visualActions = trace.agent?.steps.flatMap((step) => step.decision.type === "act" ? [step.decision.action] : []) ?? [];
    report.actionResults = trace.agent?.steps.flatMap((step) => step.actionResult ? [step.actionResult] : []) ?? [];
    report.canvasRevisions = trace.agent?.steps.flatMap((step) => [step.observed.scene, ...(step.resulting ? [step.resulting.scene] : [])]) ?? [h.state.sceneRevision];
    report.elapsedLatency = trace.metrics;
    report.finalSemanticResult = `${h.controller.getWorld().entities.length} entities, ${h.controller.getWorld().relations.length} relations`;
    report.finalCanvasResult = `${h.state.elements.length} live elements, revision scene-${h.state.sceneRevision}`;
    report.gates.routeCorrect = scenario.expectedRoute === "mixed" ? Array.isArray(report.route) && report.route.join(",") === "express,manipulate" : report.route === scenario.expectedRoute;
    report.gates.visualCompletion = h.state.elements.length > 0;
    report.gates.zeroDraw = !report.gates.visualCompletion;
    report.gates.invalidTarget = report.actionResults.some((item) => item.status === "rejected" && item.code === "unknown_entity");
    report.gates.persistentClipping = h.state.elements.some((element) => element.x < -h.state.viewport.scrollX || element.y < -h.state.viewport.scrollY);
    report.gates.stalledLoop = trace.agentStatus === "stalled";
    report.gates.unexpectedCameraMovement = h.state.viewportRevision !== 0;
    report.quality.continuationTurns = Math.max(0, report.modelCalls - report.agentSteps);
    report.quality.unnecessaryActions = report.actionResults.filter((item) => item.status === "noop").length;
    report.quality.rejectedActions = report.actionResults.filter((item) => item.status === "rejected").length;
    report.quality.stalledRuns = trace.agentStatus === "stalled" ? 1 : 0;
    report.quality.clipping = report.gates.persistentClipping;
    report.quality.incorrectConnection = ["connect", "continue"].includes(scenario.id) && !report.gates.semanticCorrect;
    report.quality.unexpectedDeletion = report.gates.unintendedDeletion;
    report.quality.unexpectedCameraMovement = report.gates.unexpectedCameraMovement;
    if (scenario.id === "build") report.gates.targetIdentityCorrect = true;
    for (const [gate, value] of Object.entries(report.gates)) {
      const failureWhenTrue = ["zeroDraw", "invalidTarget", "unintendedDeletion", "persistentClipping", "stalledLoop", "unexpectedCameraMovement"].includes(gate);
      if ((failureWhenTrue && value) || (!failureWhenTrue && !value)) report.issues.push(gate);
    }
  } catch (error) {
    report.issues.push(error instanceof Error ? error.message : String(error));
  }
  reports.push(report);
}

for (const report of reports) console.log(JSON.stringify(report));
const failed = reports.filter((report) => report.issues.length);
assert.equal(failed.length, 0, `${failed.map((report) => `${report.id}: ${report.issues.join(", ")}`).join("; ")}`);
console.log(`Live interaction evaluation: ${reports.length} passed, 0 failed`);
