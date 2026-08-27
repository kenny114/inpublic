/**
 * InPublic Live Validation — V0 Reality Test.
 *
 * Opt-in, paid, live-model evaluation. Feeds natural-language "settled
 * thought" text directly into the real ExpressionLiveController (real
 * meaning extraction) and the real LiveInteractionOrchestrator (real
 * deterministic routing, real VisualAgent decisions), against a synthetic
 * in-memory canvas (same shape the deterministic live-interaction-eval.mjs
 * harness uses) rather than a real mounted Excalidraw/browser instance.
 *
 * Run: RUN_LIVE_V0_VALIDATION=1 node --import ./scripts/ts-register.mjs scripts/live-v0-validation-eval.mjs
 */

import fs from "node:fs";
import path from "node:path";

if (process.env.RUN_LIVE_V0_VALIDATION !== "1") {
  console.log("Live V0 validation skipped (set RUN_LIVE_V0_VALIDATION=1 to run paid calls)");
  process.exit(0);
}

// .env.local is not auto-loaded by the ts-register loader, and the model
// constants below read process.env at import time, so this must run before
// any dynamic import of lib/llm.ts or anything that transitively imports it.
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

const { createVisualAgent } = await import("../lib/agent/index.ts");
const { decideWithVisualAgentModel, VISUAL_AGENT_MODEL } = await import("../lib/agent/model.ts");
const { ExpressionLiveController } = await import("../lib/expression/live.ts");
const { extractMeaning, EXPRESSION_MODEL } = await import("../lib/expression/meaning/extract.ts");
const { createLiveInteractionOrchestrator } = await import("../lib/interaction/index.ts");
const { createVisualActionDispatcher } = await import("../lib/visual-actions/index.ts");

// Public Anthropic list pricing (USD per million tokens), used only as an
// approximation — the app's real billed rate lives in Supabase
// provider_rate_cards and is not reachable from this standalone script.
const APPROX_PRICING_PER_MTOK = {
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
};

function approxCostUsd(model, usage) {
  const rate = APPROX_PRICING_PER_MTOK[model];
  if (!rate || !usage) return null;
  const inputCost = ((usage.inputTokens ?? 0) / 1_000_000) * rate.input;
  const outputCost = ((usage.outputTokens ?? 0) / 1_000_000) * rate.output;
  return inputCost + outputCost;
}

// ---------------------------------------------------------------------------
// Model-call ledger, shared across every scenario in this run.
// ---------------------------------------------------------------------------
const callLog = [];
function record(kind, model, usage) {
  const cost = approxCostUsd(model, usage);
  callLog.push({ kind, model, ...usage, approxCostUsd: cost });
}

// ---------------------------------------------------------------------------
// Synthetic canvas harness — same shape as evaluation/scenarios' deterministic
// harness (scripts/live-interaction-eval.mjs), so results are comparable.
// No real Excalidraw/browser is mounted; geometry is a flat rectangle+label
// per semantic object, laid out by ScenePlan order.
// ---------------------------------------------------------------------------
function makeHarness(label) {
  const state = {
    elements: [],
    sceneRevision: 0,
    viewportRevision: 0,
    observations: 0,
    manualEdits: [],
    viewport: { scrollX: 0, scrollY: 0, zoom: 1, width: 1280, height: 720 },
  };
  const events = [];
  const t0 = Date.now();
  const log = (event, data) => events.push({ atMs: Date.now() - t0, event, ...data });

  const observe = () => {
    state.observations += 1;
    return {
      elements: structuredClone(state.elements),
      selection: { elementIds: state.selection ?? [], groupIds: [] },
      viewport: { ...state.viewport },
      revisions: {
        scene: `scene-${state.sceneRevision}`,
        selection: `selection-${state.selectionRevision ?? 0}`,
        viewport: `viewport-${state.viewportRevision}`,
      },
    };
  };

  const canvas = {
    presence: {
      setState(s) { log("presence", { state: s }); },
      clear() {},
      getSnapshot() { return {}; },
      subscribe() { return () => {}; },
      noteHumanInteraction() {},
      setReducedMotion() {},
      tick() {},
    },
    attach() {},
    async preload() {},
    applyElements() {},
    readViewport() { return { ...state.viewport }; },
    applyViewport(viewport) {
      state.viewport = { ...state.viewport, ...viewport };
      state.viewportRevision += 1;
      log("camera_move", { viewport: state.viewport });
    },
    observe,
    async applyExpression() { throw new Error("not used by evaluation harness"); },
    resetExpressionIdentity() {},
  };

  const controller = new ExpressionLiveController({
    debounceMs: 0,
    // Matches components/Board.tsx's real live configuration: stage-1
    // identity resolution on, no identity/target judge (abstain default, no
    // extra model call). Running without this in the first pass produced a
    // duplicate-concept false alarm that the real product does not have.
    enableIdentityLayer: true,
    extract: async (text, recentContext) => {
      const started = Date.now();
      let usage;
      const delta = await extractMeaning(text, recentContext, (u) => { usage = u; });
      record("expression_extract", EXPRESSION_MODEL, usage);
      log("model_call_expression", { text: text.slice(0, 120), ms: Date.now() - started, usage });
      return delta;
    },
    onUpdate: async ({ trace }) => {
      state.sceneRevision += 1;
      state.elements = trace.scene.objects.flatMap((object, order) => [
        {
          id: object.id, type: "rectangle", x: object.x, y: object.y, width: object.w, height: object.h,
          angle: 0, groupIds: [], frameId: null, containerId: null, revision: state.sceneRevision, order: order * 2,
          semanticEntityId: object.entityId,
        },
        {
          id: `${object.id}-label`, type: "text", x: object.x, y: object.y, width: object.w, height: object.h,
          angle: 0, text: object.label, groupIds: [], frameId: null, containerId: null, revision: state.sceneRevision,
          order: order * 2 + 1, semanticEntityId: object.entityId,
        },
      ]);
      log("scene_update", { objects: trace.scene.objects.length, revision: state.sceneRevision });
    },
  });

  const dispatcher = createVisualActionDispatcher(controller, canvas);
  const agent = createVisualAgent({
    source: { getWorld: () => controller.getWorld(), getScene: () => controller.getScene(), observe },
    dispatcher,
    decisionProvider: async (context) => {
      const started = Date.now();
      let usage;
      const raw = await decideWithVisualAgentModel(context, (u) => { usage = u; });
      record("agent_decision", VISUAL_AGENT_MODEL, usage);
      log("model_call_agent", { ms: Date.now() - started, usage, decision: raw });
      return raw;
    },
  });

  const orchestrator = createLiveInteractionOrchestrator({
    agent,
    express: (input) => controller.express({ id: input.id, text: input.text, source: "human_speech" }),
    onTrace: (trace) => log("route_trace", { id: trace.id, intent: trace.intent, status: trace.status, reason: trace.routingReason }),
  });

  return {
    label, state, controller, orchestrator, events, log,
    async say(id, text) {
      log("speech_settled", { id, text });
      const startedAt = Date.now();
      const result = await orchestrator.submit({ id, text, source: "speech", settledAtMs: startedAt });
      log("turn_result", {
        id, intent: result.intent, status: result.status,
        elapsedMs: Date.now() - startedAt,
        firstVisualLatencyMs: result.trace.metrics.speechFinalToFirstVisualChangeMs,
        modelCalls: result.trace.metrics.modelCalls,
        agentSteps: result.trace.metrics.agentSteps,
      });
      return result;
    },
    manualMove(entityLabel, dx, dy) {
      const scene = controller.getScene();
      const object = scene.objects.find((o) => o.label === entityLabel);
      if (!object) { log("manual_move_failed", { entityLabel }); return null; }
      const element = state.elements.find((e) => e.semanticEntityId === object.entityId && e.type === "rectangle");
      if (!element) { log("manual_move_failed", { entityLabel }); return null; }
      element.x += dx; element.y += dy;
      state.sceneRevision += 1;
      state.manualEdits.push({ entityLabel, dx, dy, atMs: Date.now() - t0 });
      log("manual_move", { entityLabel, dx, dy, newX: element.x, newY: element.y });
      return element;
    },
    manualSelect(entityLabel) {
      const scene = controller.getScene();
      const object = scene.objects.find((o) => o.label === entityLabel);
      if (!object) return;
      state.selection = [object.id];
      state.selectionRevision = (state.selectionRevision ?? 0) + 1;
      log("manual_select", { entityLabel });
    },
    manualPanZoom(dx, dy, zoomDelta) {
      state.viewport = {
        ...state.viewport,
        scrollX: state.viewport.scrollX + dx,
        scrollY: state.viewport.scrollY + dy,
        zoom: Math.max(0.1, state.viewport.zoom + zoomDelta),
      };
      state.viewportRevision += 1;
      log("manual_pan_zoom", { dx, dy, zoomDelta, viewport: state.viewport });
    },
  };
}

function clippingCheck(h) {
  return h.state.elements.some((el) => el.x < -h.state.viewport.scrollX - 4000 || el.y < -h.state.viewport.scrollY - 4000);
}
function overlapCheck(h) {
  const rects = h.state.elements.filter((e) => e.type === "rectangle");
  let overlaps = 0;
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i]; const b = rects[j];
      const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
      const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      if (overlapX > 4 && overlapY > 4) overlaps += 1;
    }
  }
  return overlaps;
}
function duplicateLabelCheck(h) {
  const world = h.controller.getWorld();
  const counts = new Map();
  for (const e of world.entities) counts.set(e.label.toLowerCase(), (counts.get(e.label.toLowerCase()) ?? 0) + 1);
  return [...counts.entries()].filter(([, n]) => n > 1);
}

// ---------------------------------------------------------------------------
// Report accumulation
// ---------------------------------------------------------------------------
const report = { generatedAt: new Date().toISOString(), scenarios: [] };

async function runEval1() {
  const h = makeHarness("eval1-pure-expression");
  const lines = [
    "We're redesigning the onboarding flow for new customers.",
    "The first step is account creation, where someone picks a workspace name and invites a couple of teammates.",
    "After that comes a short product tour that highlights the three main modules: the dashboard, the reporting view, and the settings panel.",
    "Then we ask them to connect a data source, usually a spreadsheet import or a direct database connection.",
    "Once a data source is connected, we run a validation check that looks for missing columns and obvious formatting problems.",
    "If validation passes, the user lands on a starter dashboard that's pre-populated with a few sample charts so the product doesn't feel empty.",
    "The whole thing is meant to take under five minutes for a technical user and under ten for someone non-technical.",
  ];
  const before = Date.now();
  const results = [];
  for (const [i, text] of lines.entries()) {
    const result = await h.say(`e1-${i}`, text);
    results.push(result);
  }
  const totalMs = Date.now() - before;
  const world = h.controller.getWorld();
  const scenario = {
    id: "eval1-pure-expression",
    description: "60-90s natural speech, mostly new meaning",
    routeDecisions: results.map((r) => r.intent),
    zeroDrawEvents: results.filter((r) => !r.trace?.changed).length,
    concepts: world.entities.length,
    relationships: world.relations.length,
    clipping: clippingCheck(h),
    overlaps: overlapCheck(h),
    duplicateConcepts: duplicateLabelCheck(h),
    unexpectedAgentInvocation: results.filter((r) => r.intent !== "express").map((r) => r.intent),
    cameraMovement: h.state.viewportRevision,
    firstVisualLatencyMs: results.map((r) => r.trace.metrics.speechFinalToFirstVisualChangeMs ?? r.trace.metrics.expressRouteToFirstVisualChangeMs ?? null),
    totalWallMs: totalMs,
    finalWorld: { entities: world.entities.map((e) => ({ id: e.id, type: e.type, label: e.label })), relations: world.relations.map((r) => ({ source: r.source, type: r.type, target: r.target })) },
    events: h.events,
  };
  report.scenarios.push(scenario);
  return h;
}

async function runEval2(seedHarness) {
  const h = seedHarness ?? makeHarness("eval2-manipulation");
  if (!seedHarness) {
    await h.say("seed", "The release has three risks: latency, cost overruns, and a security review that's still pending.");
  }
  const world = h.controller.getWorld();
  const turns = [
    { kind: "connect", text: "Connect the security review to the cost overruns." },
    { kind: "update", text: "Change latency to Latency Regression." },
    { kind: "correct", text: "Actually, that should be the security review, not latency." },
    { kind: "remove", text: "Remove the cost overruns risk." },
    { kind: "focus", text: "Focus on the security review." },
  ];
  const turnReports = [];
  for (const [i, turn] of turns.entries()) {
    const before = h.controller.getWorld();
    const result = await h.say(`e2-${i}-${turn.kind}`, turn.text);
    const after = h.controller.getWorld();
    turnReports.push({
      kind: turn.kind, text: turn.text, route: result.intent, status: result.status,
      agentStatus: result.agent?.status, agentSteps: result.trace.metrics.agentSteps,
      visualActions: result.agent?.trace.steps.flatMap((s) => s.decision.type === "act" ? [s.decision.action] : []) ?? [],
      actionResults: result.agent?.trace.steps.flatMap((s) => s.actionResult ? [s.actionResult] : []) ?? [],
      entitiesBefore: before.entities.length, entitiesAfter: after.entities.length,
      relationsBefore: before.relations.length, relationsAfter: after.relations.length,
    });
  }
  report.scenarios.push({
    id: "eval2-existing-world-manipulation",
    description: "connect/update/correct/remove/focus against existing content",
    seedWorld: { entities: world.entities.map((e) => ({ id: e.id, label: e.label })) },
    turns: turnReports,
    finalWorld: { entities: h.controller.getWorld().entities.map((e) => ({ id: e.id, type: e.type, label: e.label })), relations: h.controller.getWorld().relations.map((r) => ({ source: r.source, type: r.type, target: r.target })) },
    events: h.events,
  });
  return h;
}

async function runEval3() {
  const h = makeHarness("eval3-references");
  await h.say("seed", "There are three blockers: a flaky test suite, an unreviewed pull request, and a missing staging environment.");
  const tests = [
    { ref: "this", text: "Focus on this." },
    { ref: "that", text: "Remove that." },
    { ref: "first", text: "Connect the first blocker to the staging environment." },
    { ref: "second", text: "Rename the second one to Code Review Backlog." },
    { ref: "last one", text: "Focus on the last one." },
    { ref: "those two", text: "Connect those two blockers together." },
  ];
  const results = [];
  for (const [i, t] of tests.entries()) {
    const beforeWorld = h.controller.getWorld();
    const result = await h.say(`e3-${i}`, t.text);
    const afterWorld = h.controller.getWorld();
    const resolvedTargets = result.agent?.trace.steps.flatMap((s) => {
      const d = s.decision;
      if (d.type !== "act") return [];
      const a = d.action;
      const id = a.entityId ?? a.sourceEntityId ?? a.targetEntityId ?? null;
      const label = id ? beforeWorld.entities.find((e) => e.id === id)?.label ?? afterWorld.entities.find((e) => e.id === id)?.label : null;
      return [{ actionType: a.type, id, label }];
    }) ?? [];
    results.push({
      ref: t.ref, text: t.text, route: result.intent, status: result.status, agentStatus: result.agent?.status,
      resolvedTargets, rejectedActions: result.agent?.trace.steps.filter((s) => s.actionResult?.status === "rejected").length ?? 0,
    });
  }
  report.scenarios.push({
    id: "eval3-references",
    description: "resolution of this/that/first/second/last one/those two against existing content",
    seedWorld: { entities: h.controller.getWorld().entities.map((e) => ({ id: e.id, label: e.label })) },
    results,
    events: h.events,
  });
  return h;
}

async function runEval4() {
  const h = makeHarness("eval4-human-canvas-edits");
  await h.say("seed", "The migration has two phases: schema changes and data backfill.");
  const world = h.controller.getWorld();
  const schemaObj = world.entities.find((e) => e.label.toLowerCase().includes("schema"));
  h.manualMove(schemaObj.label, 220, -80);
  h.manualSelect(schemaObj.label);
  h.manualPanZoom(50, 30, 0.1);
  const beforeAgentObservation = h.controller.getScene().objects.find((o) => o.entityId === schemaObj.id);
  const movedElement = h.state.elements.find((e) => e.semanticEntityId === schemaObj.id && e.type === "rectangle");
  const result = await h.say("e4-0", "Connect the schema changes to the data backfill.");
  let observedMovedPosition = null;
  const firstStep = result.agent?.trace.steps[0];
  if (firstStep) {
    const el = firstStep.observed;
    observedMovedPosition = { revisionsMatch: el != null };
  }
  const canvasElementInFinalObservation = result.agent?.final.canvas.elements.find((e) => e.semanticEntityId === schemaObj.id);
  report.scenarios.push({
    id: "eval4-human-canvas-edits",
    description: "manual move/select/pan then a world-aware command; agent must observe current canvas, not original layout",
    manualEdits: h.state.manualEdits,
    manualEditPosition: movedElement ? { x: movedElement.x, y: movedElement.y } : null,
    agentFinalObservedPosition: canvasElementInFinalObservation ? { x: canvasElementInFinalObservation.bounds.x, y: canvasElementInFinalObservation.bounds.y } : null,
    positionsMatch: movedElement && canvasElementInFinalObservation ? movedElement.x === canvasElementInFinalObservation.bounds.x && movedElement.y === canvasElementInFinalObservation.bounds.y : null,
    route: result.intent, status: result.status, agentStatus: result.agent?.status,
    events: h.events,
  });
  return h;
}

async function runEval5() {
  const h = makeHarness("eval5-corrections");
  await h.say("seed", "Alice manages Bob on the platform team.");
  const world0 = h.controller.getWorld();
  const turns = [
    { text: "Actually that's wrong." },
    { text: "Remove that." },
    { text: "Bob now reports to Carol instead. No, connect it to Carol instead." },
    { text: "Alice doesn't manage Bob anymore." },
  ];
  const results = [];
  let prevEntityCount = world0.entities.length;
  for (const [i, t] of turns.entries()) {
    const before = h.controller.getWorld();
    const result = await h.say(`e5-${i}`, t.text);
    const after = h.controller.getWorld();
    results.push({
      text: t.text, route: result.intent, status: result.status, agentStatus: result.agent?.status,
      entitiesBefore: before.entities.length, entitiesAfter: after.entities.length,
      relationsBefore: before.relations.length, relationsAfter: after.relations.length,
      duplicateConceptsAfter: duplicateLabelCheck({ controller: h.controller }),
      visualActions: result.agent?.trace.steps.flatMap((s) => s.decision.type === "act" ? [s.decision.action] : []) ?? [],
    });
    prevEntityCount = after.entities.length;
  }
  report.scenarios.push({
    id: "eval5-corrections",
    description: "in-place corrections must edit existing meaning, not duplicate or stray-delete",
    seedWorld: { entities: h.controller.getWorld().entities.map((e) => ({ id: e.id, label: e.label })) },
    results,
    events: h.events,
  });
  return h;
}

async function runEval6() {
  const h = makeHarness("eval6-five-minute-run");
  // Natural continuous narration, not artificial tool commands. Includes new
  // meaning, relationships, examples, callbacks, corrections, references,
  // deletion, presentation/focus, and one manual canvas edit mid-run.
  const script = [
    { type: "speech", text: "I want to walk through our support ticket pipeline end to end." },
    { type: "speech", text: "Tickets come in from three channels: email, chat, and the API." },
    { type: "speech", text: "Every ticket gets triaged by a classifier that assigns a priority and routes it to a queue." },
    { type: "speech", text: "There are two queues today, a standard queue and an urgent queue for anything flagged high severity." },
    { type: "speech", text: "The urgent queue connects directly to on-call, which pages an engineer within five minutes." },
    { type: "speech", text: "For example, a customer reporting total data loss would land straight in the urgent queue." },
    { type: "speech", text: "Actually, the classifier isn't quite right, let me fix that. It's a rules engine right now, not a real classifier." },
    { type: "speech", text: "Connect the rules engine to both queues, since it feeds both of them." },
    { type: "manual_move", label: "Rules Engine", dx: 260, dy: -120 },
    { type: "speech", text: "Focus on the urgent queue for a second." },
    { type: "speech", text: "Going back to the earlier idea about on-call, we should also log every page to an incident channel." },
    { type: "speech", text: "Remove the incident channel idea actually, we're not ready to commit to that yet." },
    { type: "speech", text: "The standard queue is worked by a rotating team of five support engineers during business hours." },
    { type: "speech", text: "Rename the standard queue to Business Hours Queue." },
    { type: "speech", text: "This whole pipeline should handle roughly two hundred tickets a day at current volume." },
    { type: "speech", text: "Connect this volume figure to the business hours queue, since that's what it's sized against." },
  ];
  const timeline = [];
  const runStart = Date.now();
  for (const step of script) {
    if (step.type === "speech") {
      const result = await h.say(`e6-${timeline.length}`, step.text);
      timeline.push({
        type: "speech", text: step.text, atMs: Date.now() - runStart,
        route: result.intent, status: result.status, agentStatus: result.agent?.status,
        modelCalls: result.trace.metrics.modelCalls, agentSteps: result.trace.metrics.agentSteps,
        firstVisualLatencyMs: result.trace.metrics.speechFinalToFirstVisualChangeMs ?? result.trace.metrics.expressRouteToFirstVisualChangeMs ?? null,
      });
    } else if (step.type === "manual_move") {
      const el = h.manualMove(step.label, step.dx, step.dy);
      timeline.push({ type: "manual_move", label: step.label, atMs: Date.now() - runStart, applied: Boolean(el) });
    }
  }
  const world = h.controller.getWorld();
  report.scenarios.push({
    id: "eval6-five-minute-run",
    description: "continuous natural run: new meaning, relationships, examples, callbacks, corrections, references, deletion, presentation, one manual edit",
    timeline,
    totalWallMs: Date.now() - runStart,
    finalWorld: { entities: world.entities.map((e) => ({ id: e.id, type: e.type, label: e.label })), relations: world.relations.map((r) => ({ source: r.source, type: r.type, target: r.target })) },
    duplicateConcepts: duplicateLabelCheck(h),
    clipping: clippingCheck(h),
    overlaps: overlapCheck(h),
    cameraMovement: h.state.viewportRevision,
    events: h.events,
  });
  return h;
}

console.log("=== InPublic Live V0 Validation — running paid live-model scenarios ===");
console.log(`expression model: ${EXPRESSION_MODEL}, agent model: ${VISUAL_AGENT_MODEL}`);

await runEval1();
console.log("eval1 done");
await runEval2();
console.log("eval2 done");
await runEval3();
console.log("eval3 done");
await runEval4();
console.log("eval4 done");
await runEval5();
console.log("eval5 done");
await runEval6();
console.log("eval6 done");

report.callLog = callLog;
report.costSummary = {
  totalCalls: callLog.length,
  expressionCalls: callLog.filter((c) => c.kind === "expression_extract").length,
  agentCalls: callLog.filter((c) => c.kind === "agent_decision").length,
  totalInputTokens: callLog.reduce((s, c) => s + (c.inputTokens ?? 0), 0),
  totalOutputTokens: callLog.reduce((s, c) => s + (c.outputTokens ?? 0), 0),
  totalCacheCreationTokens: callLog.reduce((s, c) => s + (c.cacheCreationInputTokens ?? 0), 0),
  totalCacheReadTokens: callLog.reduce((s, c) => s + (c.cacheReadInputTokens ?? 0), 0),
  approxTotalCostUsd: callLog.reduce((s, c) => s + (c.approxCostUsd ?? 0), 0),
};

const outPath = path.resolve(process.cwd(), "evaluation/reports/live-v0-validation-raw.json");
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`\nWrote raw trace to ${outPath}`);
console.log(JSON.stringify(report.costSummary, null, 2));
