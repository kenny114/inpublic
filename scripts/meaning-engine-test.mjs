/**
 * Meaning Engine V1 (features.meaningEngineV1) tested directly: schema
 * validation, reconciliation (diffSemanticState), and the cadence
 * controller's debounce/coalesce/in-flight behavior. Fixture-over-network
 * for requestMeaning, same posture as visual-reentry-test.mjs.
 *
 *   node --import ./scripts/ts-register.mjs scripts/meaning-engine-test.mjs
 */

import { SemanticStateSchema, EMPTY_SEMANTIC_STATE, LocalMeaningSchema } from "../lib/meaning/types.ts";
import { diffSemanticState } from "../lib/meaning/reconcile.ts";
import { MeaningEngineController } from "../lib/meaning/engine.ts";
import { computeHierarchicalLayout, computeCausalChainLayout, computeComparisonLayout, computeMeaningLayout, NODE_W, NODE_H, V_GUTTER, COMPARISON_COLUMN_GAP } from "../lib/meaning/layout.ts";
import { displayConceptLabel } from "../lib/meaning/display.ts";
import { keepTextBindings } from "../lib/meaning/apply.ts";
import { sanitizeForSchema, sanitizeLocalMeaning, slugifyId } from "../lib/meaning/decideCore.ts";
import { assertGoldTalk } from "./fixtures/meaning-gold.mjs";
import { planMeaning } from "../lib/meaning/plan.ts";
import { VisualPlanSchema, EMPTY_VISUAL_PLAN } from "../lib/meaning/types.ts";

let pass = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    pass += 1;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n── ${title}`);
}

// --------------------------------------------------------------- schema

section("schema validation (strict — the model never emits geometry)");

check("accepts an empty state", SemanticStateSchema.safeParse(EMPTY_SEMANTIC_STATE).success);
check(
  "accepts a small valid state",
  SemanticStateSchema.safeParse({
    topic: "AI and software",
    concepts: [
      { id: "ai", label: "AI", importance: "primary" },
      { id: "app-creation", label: "Easier app creation", importance: "supporting" },
    ],
    relationships: [{ id: "ai-enables-apps", from: "ai", to: "app-creation", type: "leads_to" }],
    claims: [],
  }).success,
);
check(
  "rejects a relationship whose endpoint isn't a listed concept",
  !SemanticStateSchema.safeParse({
    concepts: [{ id: "ai", label: "AI", importance: "primary" }],
    relationships: [{ id: "r1", from: "ai", to: "ghost", type: "causes" }],
  }).success,
);
check(
  "rejects a relationship endpoint pointing at itself",
  !SemanticStateSchema.safeParse({
    concepts: [{ id: "ai", label: "AI", importance: "primary" }],
    relationships: [{ id: "r1", from: "ai", to: "ai", type: "causes" }],
  }).success,
);
check(
  "rejects a duplicate concept id",
  !SemanticStateSchema.safeParse({
    concepts: [
      { id: "ai", label: "AI", importance: "primary" },
      { id: "ai", label: "AI (again)", importance: "detail" },
    ],
    relationships: [],
  }).success,
);
check(
  "rejects model-owned coordinates on a concept",
  !SemanticStateSchema.safeParse({
    concepts: [{ id: "ai", label: "AI", importance: "primary", x: 10 }],
    relationships: [],
  }).success,
);
check("rejects more than 24 concepts", !SemanticStateSchema.safeParse({
  concepts: Array.from({ length: 25 }, (_, i) => ({ id: `c${i}`, label: `C${i}`, importance: "detail" })),
  relationships: [],
}).success);
check("rejects an unknown relationship type", !SemanticStateSchema.safeParse({
  concepts: [{ id: "a", label: "A", importance: "primary" }, { id: "b", label: "B", importance: "detail" }],
  relationships: [{ id: "r", from: "a", to: "b", type: "orbits" }],
}).success);

// --------------------------------------------------------------- reconciliation

section("reconciliation — the brief's own AI -> apps -> trust example");

{
  // "AI is making software easier to create."
  const s1 = {
    concepts: [
      { id: "ai", label: "AI", importance: "primary" },
      { id: "app-creation", label: "Easier app creation", importance: "supporting" },
    ],
    relationships: [{ id: "ai-apps", from: "ai", to: "app-creation", type: "leads_to" }],
  };
  const opsFromEmpty = diffSemanticState(EMPTY_SEMANTIC_STATE, s1);
  check(
    "a fresh state produces exactly ADD_NODE x2 + ADD_EDGE x1, nodes before edges",
    opsFromEmpty.length === 3 &&
      opsFromEmpty[0].kind === "ADD_NODE" &&
      opsFromEmpty[1].kind === "ADD_NODE" &&
      opsFromEmpty[2].kind === "ADD_EDGE",
    JSON.stringify(opsFromEmpty.map((o) => o.kind)),
  );

  // "That means we're going to get way more apps."
  const s2 = {
    concepts: [...s1.concepts, { id: "more-apps", label: "More applications", importance: "supporting" }],
    relationships: [...s1.relationships, { id: "apps-more", from: "app-creation", to: "more-apps", type: "leads_to" }],
  };
  const opsAdd = diffSemanticState(s1, s2);
  check(
    "continuing the thought only adds the new node/edge — existing concepts are never re-added",
    opsAdd.length === 2 && opsAdd[0].kind === "ADD_NODE" && opsAdd[0].concept.id === "more-apps" && opsAdd[1].kind === "ADD_EDGE",
    JSON.stringify(opsAdd),
  );

  // "But now users don't know which apps they can trust."
  const s3 = {
    concepts: [...s2.concepts, { id: "trust-problem", label: "Trust problem", importance: "supporting" }],
    relationships: [...s2.relationships, { id: "more-apps-trust", from: "more-apps", to: "trust-problem", type: "causes" }],
  };
  const opsFinal = diffSemanticState(s2, s3);
  check(
    "the third continuation again only appends — three thoughts never re-touch the first two concepts",
    opsFinal.length === 2 && opsFinal[0].concept?.id === "trust-problem" && opsFinal[1].relationship?.id === "more-apps-trust",
  );

  check("the identical state diffed against itself produces no operations", diffSemanticState(s3, s3).length === 0);
}

section("reconciliation — rename/merge and removal");

{
  const before = {
    concepts: [
      { id: "ai", label: "AI", importance: "primary" },
      { id: "old-label", label: "Faster coding", importance: "supporting" },
    ],
    relationships: [{ id: "r1", from: "ai", to: "old-label", type: "leads_to" }],
  };
  const renamed = {
    concepts: [
      { id: "ai", label: "AI", importance: "primary" },
      { id: "old-label", label: "Easier software creation", importance: "supporting" },
    ],
    relationships: [{ id: "r1", from: "ai", to: "old-label", type: "leads_to" }],
  };
  const ops = diffSemanticState(before, renamed);
  check(
    "a relabeled concept (same id) is UPDATE_NODE, never a second ADD_NODE",
    ops.length === 1 && ops[0].kind === "UPDATE_NODE" && ops[0].concept.id === "old-label",
    JSON.stringify(ops),
  );
}

{
  const before = {
    concepts: [
      { id: "a", label: "A", importance: "primary" },
      { id: "b", label: "B", importance: "detail" },
    ],
    relationships: [{ id: "r1", from: "a", to: "b", type: "related_to" }],
  };
  const removed = { concepts: [{ id: "a", label: "A", importance: "primary" }], relationships: [] };
  const ops = diffSemanticState(before, removed);
  check(
    "removing a concept removes its edge FIRST, then the node — never leaves a dangling edge op after its node",
    ops.length === 2 && ops[0].kind === "REMOVE_EDGE" && ops[1].kind === "REMOVE_NODE" && ops[1].conceptId === "b",
    JSON.stringify(ops),
  );
}

{
  const before = {
    concepts: [{ id: "a", label: "A", importance: "supporting" }],
    relationships: [],
  };
  const promoted = {
    concepts: [{ id: "a", label: "A", importance: "primary" }],
    relationships: [],
  };
  const ops = diffSemanticState(before, promoted);
  check("an importance-only change (no label change) still produces UPDATE_NODE", ops.length === 1 && ops[0].kind === "UPDATE_NODE");
}

{
  const before = {
    concepts: [
      { id: "a", label: "A", importance: "primary" },
      { id: "b", label: "B", importance: "detail" },
    ],
    relationships: [{ id: "r1", from: "a", to: "b", type: "related_to" }],
  };
  const retyped = {
    ...before,
    relationships: [{ id: "r1", from: "a", to: "b", type: "causes" }],
  };
  const ops = diffSemanticState(before, retyped);
  check("a relationship whose type changed (same id/endpoints) is UPDATE_EDGE, not a duplicate", ops.length === 1 && ops[0].kind === "UPDATE_EDGE");
}

// --------------------------------------------------------------- cadence controller

section("cadence controller — debounce, coalescing, in-flight guard (Part 7: avoid LLM thrashing)");

{
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  const seenTexts = [];
  globalThis.fetch = async (_url, init) => {
    fetchCalls += 1;
    const body = JSON.parse(init.body);
    seenTexts.push(body.newText);
    return {
      ok: true,
      json: async () => ({
        concepts: [{ id: "ai", label: "AI", importance: "primary" }],
        relationships: [],
        claims: [],
      }),
    };
  };
  try {
    const updates = [];
    const controller = new MeaningEngineController({ debounceMs: 20, onUpdate: (u) => updates.push(u) });
    controller.submit({ source: "human_speech", content: "AI is" });
    controller.submit({ source: "human_speech", content: "making software easier." });
    await new Promise((resolve) => setTimeout(resolve, 60));
    check("two settled thoughts arriving inside the debounce window produce exactly one model call", fetchCalls === 1, `fetchCalls=${fetchCalls}`);
    check("the coalesced call carries both thoughts' text, joined", seenTexts[0] === "AI is making software easier.", seenTexts[0]);
    check("a real state change produces exactly one onUpdate", updates.length === 1);
    check("getState() reflects the resolved state", controller.getState().concepts[0]?.id === "ai");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  // In-flight guard: a thought that settles WHILE a call is running must not
  // fire a second concurrent request — it buffers and flushes after.
  const originalFetch = globalThis.fetch;
  let concurrentInFlight = 0;
  let maxConcurrent = 0;
  let calls = 0;
  globalThis.fetch = async () => {
    concurrentInFlight += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrentInFlight);
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 30));
    concurrentInFlight -= 1;
    return { ok: true, json: async () => ({ concepts: [], relationships: [], claims: [] }) };
  };
  try {
    const controller = new MeaningEngineController({ debounceMs: 5, onUpdate: () => {} });
    controller.submit({ source: "human_speech", content: "first thought" });
    await new Promise((resolve) => setTimeout(resolve, 15)); // let the first call start
    controller.submit({ source: "human_speech", content: "second thought, arrives mid-flight" });
    await new Promise((resolve) => setTimeout(resolve, 120)); // let both rounds finish
    check("at most one meaning call is ever in flight at a time", maxConcurrent === 1, `maxConcurrent=${maxConcurrent}`);
    check("a thought that settles mid-flight is not dropped — it triggers a follow-up call", calls === 2, `calls=${calls}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  // Fails closed: a network failure never throws, and never corrupts state.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("network unavailable"); };
  try {
    const updates = [];
    const controller = new MeaningEngineController({ debounceMs: 5, onUpdate: (u) => updates.push(u) });
    controller.submit({ source: "human_speech", content: "anything" });
    await new Promise((resolve) => setTimeout(resolve, 40));
    check("a failed request produces no update and leaves state at empty", updates.length === 0 && controller.getState().concepts.length === 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  // reset() forgets state and cancels a pending debounce.
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return { ok: true, json: async () => ({ concepts: [{ id: "x", label: "X", importance: "primary" }], relationships: [], claims: [] }) };
  };
  try {
    const controller = new MeaningEngineController({ debounceMs: 30, onUpdate: () => {} });
    controller.submit({ source: "human_speech", content: "something" });
    controller.reset();
    await new Promise((resolve) => setTimeout(resolve, 60));
    check("reset() cancels a pending debounced call before it fires", fetchCalls === 0);
    check("reset() clears any resolved state back to empty", controller.getState().concepts.length === 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  check("submit() ignores blank input", true); // sanity placeholder for the guard below
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; return { ok: true, json: async () => EMPTY_SEMANTIC_STATE }; };
  try {
    const controller = new MeaningEngineController({ debounceMs: 5, onUpdate: () => {} });
    controller.submit({ source: "human_speech", content: "   " });
    await new Promise((resolve) => setTimeout(resolve, 30));
    check("whitespace-only input never schedules a call", fetchCalls === 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// --------------------------------------------------------------- hierarchical layout

section("hierarchical layout — the actual fix for long cross-canvas arrows");

{
  const empty = computeHierarchicalLayout(EMPTY_SEMANTIC_STATE);
  check("an empty state lays out to nothing", empty.boxes.size === 0 && empty.width === 0 && empty.height === 0);
}

{
  // Meeting -> Objective -> Test InPublic (a straight chain, brief's own example)
  const state = {
    concepts: [
      { id: "meeting", label: "Meeting today", importance: "primary" },
      { id: "objective", label: "Objective", importance: "supporting" },
      { id: "test", label: "Test InPublic", importance: "detail" },
    ],
    relationships: [
      { id: "r1", from: "meeting", to: "objective", type: "part_of" },
      { id: "r2", from: "objective", to: "test", type: "leads_to" },
    ],
  };
  const layout = computeHierarchicalLayout(state);
  const meeting = layout.boxes.get("meeting");
  const objective = layout.boxes.get("objective");
  const test = layout.boxes.get("test");
  check("every concept gets a box", layout.boxes.size === 3);
  check("a parent sits directly above its child (same x-center)", meeting.x + meeting.w / 2 === objective.x + objective.w / 2);
  check("depth increases strictly down a chain", meeting.y < objective.y && objective.y < test.y);
  check("a straight 3-deep chain is exactly one column wide", layout.width === NODE_W);
  check("chain height matches 3 levels", layout.height === 3 * NODE_H + 2 * V_GUTTER);
}

{
  // A parent with two children: siblings must be centered under the parent, not stacked on top of each other.
  const state = {
    concepts: [
      { id: "meeting", label: "Meeting", importance: "primary" },
      { id: "user", label: "User context", importance: "supporting" },
      { id: "outcome", label: "Outcome", importance: "supporting" },
    ],
    relationships: [
      { id: "r1", from: "meeting", to: "user", type: "part_of" },
      { id: "r2", from: "meeting", to: "outcome", type: "part_of" },
    ],
  };
  const layout = computeHierarchicalLayout(state);
  const meeting = layout.boxes.get("meeting");
  const user = layout.boxes.get("user");
  const outcome = layout.boxes.get("outcome");
  check("two siblings never overlap horizontally", user.x + user.w <= outcome.x || outcome.x + outcome.w <= user.x);
  check("the parent is horizontally centered over its two children", Math.abs((meeting.x + meeting.w / 2) - ((user.x + user.w / 2 + outcome.x + outcome.w / 2) / 2)) < 1);
  check("siblings share the same depth row", user.y === outcome.y);
  check("children sit one level below their parent", user.y === meeting.y + NODE_H + V_GUTTER);
}

{
  // A relationship into a concept that already has a parent must not steal it (first relationship wins) and must never create a cycle.
  const state = {
    concepts: [
      { id: "a", label: "A", importance: "primary" },
      { id: "b", label: "B", importance: "supporting" },
      { id: "c", label: "C", importance: "detail" },
    ],
    relationships: [
      { id: "r1", from: "a", to: "b", type: "leads_to" },
      { id: "r2", from: "c", to: "b", type: "related_to" }, // b already has a parent (a) — this must be ignored for layout purposes
      { id: "r3", from: "b", to: "a", type: "related_to" }, // would cycle back to the root — must be ignored
    ],
  };
  const layout = computeHierarchicalLayout(state);
  check("every concept still gets exactly one box even with rejected/cyclic relationships", layout.boxes.size === 3);
  const a = layout.boxes.get("a");
  const b = layout.boxes.get("b");
  check("the first relationship to claim a child wins (b stays under a, not c)", b.y === a.y + NODE_H + V_GUTTER);
}

{
  // A concept nothing points to and that points to nothing becomes its own root rather than being dropped.
  const state = {
    concepts: [
      { id: "a", label: "A", importance: "primary" },
      { id: "b", label: "B", importance: "supporting" },
      { id: "isolated", label: "Unrelated aside", importance: "detail" },
    ],
    relationships: [{ id: "r1", from: "a", to: "b", type: "leads_to" }],
  };
  const layout = computeHierarchicalLayout(state);
  check("a disconnected concept still receives a box (never silently dropped)", layout.boxes.has("isolated"));
  const isolated = layout.boxes.get("isolated");
  check("a disconnected concept becomes its own top-level root (depth 0)", isolated.y === 0);
}

{
  // Determinism: identical input twice must produce byte-identical layout, same invariant visual-reentry-test.mjs holds its renderer to.
  const state = {
    concepts: [
      { id: "a", label: "A", importance: "primary" },
      { id: "b", label: "B", importance: "supporting" },
    ],
    relationships: [{ id: "r1", from: "a", to: "b", type: "leads_to" }],
  };
  const l1 = computeHierarchicalLayout(state);
  const l2 = computeHierarchicalLayout(state);
  check("layout is deterministic for identical input", JSON.stringify([...l1.boxes]) === JSON.stringify([...l2.boxes]));
}

// --------------------------------------------------------------- transcript lifecycle (consumedIds)

section("transcript lifecycle — consumedIds only ever names inputs whose round actually changed something");

{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ concepts: [{ id: "ai", label: "AI", importance: "primary" }], relationships: [], claims: [] }),
  });
  try {
    const updates = [];
    const controller = new MeaningEngineController({ debounceMs: 5, onUpdate: (u) => updates.push(u) });
    controller.submit({ source: "human_speech", content: "AI is interesting.", id: "thought-1" });
    controller.submit({ source: "human_speech", content: "It changes everything.", id: "thought-2" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    check("a successful update reports every buffered input's id as consumed", JSON.stringify(updates[0]?.consumedIds.sort()) === JSON.stringify(["thought-1", "thought-2"]));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  // The model returns the SAME state back (nothing worth representing) — no
  // update fires at all, so nothing is ever reported as consumed, and the
  // caller's transcript ink for that thought is left alone.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => EMPTY_SEMANTIC_STATE });
  try {
    const updates = [];
    const controller = new MeaningEngineController({ debounceMs: 5, onUpdate: (u) => updates.push(u) });
    controller.submit({ source: "human_speech", content: "just some filler talk", id: "thought-filler" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    check("a no-op decision never fires onUpdate, so the filler thought is never marked consumed", updates.length === 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  // An input with no id (e.g. a caller that doesn't care about lifecycle) never shows up in consumedIds.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ concepts: [{ id: "x", label: "X", importance: "primary" }], relationships: [], claims: [] }),
  });
  try {
    const updates = [];
    const controller = new MeaningEngineController({ debounceMs: 5, onUpdate: (u) => updates.push(u) });
    controller.submit({ source: "human_speech", content: "something with no id" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    check("an id-less input never appears in consumedIds", updates[0]?.consumedIds.length === 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// --------------------------------------------------------------- claim reconciliation

section("claim reconciliation — meaning that isn't (yet) NODE -> EDGE -> NODE");

{
  const before = { concepts: [{ id: "user", label: "Real user", importance: "supporting" }], relationships: [], claims: [] };
  const after = {
    concepts: before.concepts,
    relationships: [],
    claims: [{ id: "eyes-opened", text: "Real-user feedback changed the speaker's perspective", about: ["user"], importance: "primary" }],
  };
  const ops = diffSemanticState(before, after);
  check("a new claim produces exactly one ADD_CLAIM", ops.length === 1 && ops[0].kind === "ADD_CLAIM" && ops[0].claim.id === "eyes-opened", JSON.stringify(ops));
}

{
  const before = { concepts: [], relationships: [], claims: [{ id: "c1", text: "Old wording", importance: "supporting" }] };
  const after = { concepts: [], relationships: [], claims: [{ id: "c1", text: "Revised wording", importance: "supporting" }] };
  const ops = diffSemanticState(before, after);
  check("a reworded claim (same id) is UPDATE_CLAIM, never a duplicate", ops.length === 1 && ops[0].kind === "UPDATE_CLAIM", JSON.stringify(ops));
}

{
  const before = { concepts: [], relationships: [], claims: [{ id: "c1", text: "X", importance: "detail" }] };
  const after = { concepts: [], relationships: [], claims: [] };
  const ops = diffSemanticState(before, after);
  check("a dropped claim produces REMOVE_CLAIM", ops.length === 1 && ops[0].kind === "REMOVE_CLAIM" && ops[0].claimId === "c1");
}

{
  // reconcile.ts must tolerate hand-built fixtures that predate `claims` (defensive ?? [])
  const before = { concepts: [{ id: "a", label: "A", importance: "primary" }], relationships: [] };
  const after = { concepts: [{ id: "a", label: "A", importance: "primary" }], relationships: [] };
  check("diffSemanticState tolerates a state object with no claims array at all", diffSemanticState(before, after).length === 0);
}

{
  const before = { concepts: [{ id: "a", label: "A", importance: "primary", status: "active" }], relationships: [], claims: [] };
  const after = { concepts: [{ id: "a", label: "A", importance: "primary", status: "superseded" }], relationships: [], claims: [] };
  const ops = diffSemanticState(before, after);
  check("a status-only change (active -> superseded) still produces UPDATE_NODE", ops.length === 1 && ops[0].kind === "UPDATE_NODE");
}

// --------------------------------------------------------------- rolling context window

section("rolling context window — Part 3: no settled thought is evaluated in isolation");

{
  const originalFetch = globalThis.fetch;
  const seenContexts = [];
  let call = 0;
  globalThis.fetch = async (_url, init) => {
    call += 1;
    const body = JSON.parse(init.body);
    seenContexts.push(body.recentContext);
    return {
      ok: true,
      json: async () => ({
        concepts: [{ id: `c${call}`, label: `Concept ${call}`, importance: "detail" }],
        relationships: [],
        claims: [],
      }),
    };
  };
  try {
    const controller = new MeaningEngineController({ debounceMs: 5, onUpdate: () => {} });
    controller.submit({ source: "human_speech", content: "I finally had someone actually use the product." });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.submit({ source: "human_speech", content: "That really opened my eyes." });
    await new Promise((resolve) => setTimeout(resolve, 20));
    check("the first round sends an empty context window (nothing said yet)", JSON.stringify(seenContexts[0]) === "[]");
    check("the second round's context window contains the first round's raw text", seenContexts[1]?.includes("I finally had someone actually use the product."), JSON.stringify(seenContexts[1]));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  // The context window advances even on a no-op round — the text was still really said.
  const originalFetch = globalThis.fetch;
  const seenContexts = [];
  let call = 0;
  globalThis.fetch = async (_url, init) => {
    call += 1;
    const body = JSON.parse(init.body);
    seenContexts.push(body.recentContext);
    if (call === 1) return { ok: true, json: async () => EMPTY_SEMANTIC_STATE }; // no-op round
    return { ok: true, json: async () => ({ concepts: [{ id: "x", label: "X", importance: "primary" }], relationships: [], claims: [] }) };
  };
  try {
    const controller = new MeaningEngineController({ debounceMs: 5, onUpdate: () => {} });
    controller.submit({ source: "human_speech", content: "just some filler" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.submit({ source: "human_speech", content: "the actual point" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    check("a no-op round still advances the context window for the next call", seenContexts[1]?.includes("just some filler"), JSON.stringify(seenContexts[1]));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  // The window is capped rather than growing unboundedly across a long session.
  const originalFetch = globalThis.fetch;
  let lastContext = null;
  globalThis.fetch = async (_url, init) => {
    lastContext = JSON.parse(init.body).recentContext;
    return { ok: true, json: async () => EMPTY_SEMANTIC_STATE };
  };
  try {
    const controller = new MeaningEngineController({ debounceMs: 1, contextWindowSize: 3, onUpdate: () => {} });
    for (let i = 0; i < 6; i += 1) {
      controller.submit({ source: "human_speech", content: `thought number ${i}` });
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    check("the rolling context window never exceeds its configured cap", lastContext.length <= 3, `length=${lastContext?.length}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// --------------------------------------------------------------- debug snapshot (Part 10)

section("debug snapshot — inspectable without looking at the canvas");

{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      topic: "Real-user testing",
      currentInterpretation: "The speaker ran a real-user test and is reflecting on it.",
      concepts: [{ id: "meeting", label: "Meeting", importance: "primary" }],
      relationships: [],
      claims: [{ id: "c1", text: "It was humbling", importance: "supporting" }],
    }),
  });
  try {
    const snapshots = [];
    const controller = new MeaningEngineController({ debounceMs: 5, onUpdate: () => {}, onDebug: (s) => snapshots.push(s) });
    controller.submit({ source: "human_speech", content: "We ran a real-user test." });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const snap = snapshots[0];
    check("onDebug fires with the full Part-10 shape", Boolean(snap) && snap.event === "decide-completed" && snap.changed === true);
    check("debug snapshot carries the new thought's raw text", snap?.newThought === "We ran a real-user test.");
    check("debug snapshot carries topic/currentInterpretation/concepts/claims/relationships", snap?.topic === "Real-user testing" && snap?.currentInterpretation.includes("real-user test") && snap?.concepts.length === 1 && snap?.claims.length === 1);
    check("debug snapshot carries human-readable semantic-ops descriptions", snap?.semanticOps.some((s) => s.includes("add concept")) && snap?.semanticOps.some((s) => s.includes("add claim")));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => EMPTY_SEMANTIC_STATE });
  try {
    const snapshots = [];
    const controller = new MeaningEngineController({ debounceMs: 5, onUpdate: () => {}, onDebug: (s) => snapshots.push(s) });
    controller.submit({ source: "human_speech", content: "um, so, yeah" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    check("a no-op round still fires onDebug (visibility even when nothing changed)", snapshots[0]?.event === "decide-no-change" && snapshots[0]?.changed === false);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// --------------------------------------------------------------- schema sanitization regression

section("schema sanitization — a single overlong field must never discard an otherwise-correct response (found via live replay against session-2026-08-19T16-59-33-764Z.json)");

{
  // The exact real-world case: an otherwise perfectly valid response was
  // being discarded wholesale because one relationship label ran 10 chars
  // over its cap — the model's genuine understanding of the FIRST, richest
  // thought in the replayed session was silently thrown away as a result.
  const raw = {
    topic: "User onboarding and product-market fit",
    concepts: [{ id: "meeting-today", label: "Meeting today", importance: "primary" }],
    relationships: [
      { id: "r1", from: "meeting-today", to: "meeting-today", type: "leads_to", label: "Real usage reveals whether fit exists" }, // 38 chars, was over the old 24-char cap
    ],
    claims: [],
  };
  const sanitized = sanitizeForSchema(raw);
  check("an overlong relationship label is truncated, not the whole object rejected", sanitized.relationships[0].label.length <= 40);
  check("truncation doesn't touch fields that were already within limits", sanitized.concepts[0].label === "Meeting today" && sanitized.topic === raw.topic);
}

{
  const raw = {
    concepts: [{ id: "a", label: "x".repeat(90), description: "y".repeat(200), importance: "primary" }],
    relationships: [],
    claims: [{ id: "c1", text: "z".repeat(200), importance: "detail" }],
  };
  const sanitized = sanitizeForSchema(raw);
  check("an overlong concept label is clamped to the schema's 60-char cap", sanitized.concepts[0].label.length === 60);
  check("an overlong concept description is clamped to the schema's 160-char cap", sanitized.concepts[0].description.length === 160);
  check("an overlong claim text is clamped to the schema's 160-char cap", sanitized.claims[0].text.length === 160);
  check("a sanitized-but-still-well-formed response now validates successfully", SemanticStateSchema.safeParse(sanitized).success);
}

{
  // Sanitization must never paper over a genuinely malformed shape — only string-length overflow.
  const malformed = { concepts: "not an array", relationships: [], claims: [] };
  const sanitized = sanitizeForSchema(malformed);
  check("sanitization leaves a structurally wrong shape structurally wrong (still fails validation)", !SemanticStateSchema.safeParse(sanitized).success);
}

{
  check("sanitization is a no-op on non-object input", sanitizeForSchema(null) === null && sanitizeForSchema("plain string") === "plain string");
}

{
  check("slugifyId leaves a valid kebab id alone", slugifyId("trust-problem") === "trust-problem");
  check("slugifyId rewrites an arrow id into a kebab slug", slugifyId("Proliferation->Trust") === "proliferation-trust");
  const raw = {
    concepts: [
      { id: "AI", label: "AI", importance: "primary" },
      { id: "Trust Problem", label: "Trust problem", importance: "supporting" },
    ],
    relationships: [{ id: "Proliferation->Trust", from: "AI", to: "Trust Problem", type: "causes" }],
    claims: [],
  };
  const sanitized = sanitizeForSchema(raw);
  const parsed = SemanticStateSchema.safeParse(sanitized);
  check("a CamelCase / arrow-id response is repaired instead of discarded", parsed.success, JSON.stringify(parsed.success ? sanitized.relationships : parsed.error.issues));
  check("repaired relationship still connects the same two concepts", parsed.success && sanitized.relationships[0].from === "ai" && sanitized.relationships[0].to === "trust-problem");
}

// --------------------------------------------------------------- schema array-cap trim regression

section("schema sanitization — array-cap overflow must trim, not discard the whole response (found via real voice-note replay, 2026-08-19: a currentState near the concept cap plus one genuinely new concept could exceed it and silently freeze the conversation's understanding for the rest of a session — caps later raised from 7/12/10 to 24/40/30 as part of the semantic-accumulation fix, but trimming-not-discarding must still hold at the new caps)");

{
  // Generalized pattern: currentState already has the max concepts allowed,
  // and the model's response adds one more genuinely new one. This must
  // survive as a real update (trimming the least important concept), never
  // discard the whole round.
  const tooManyConcepts = Array.from({ length: 25 }, (_, i) => ({
    id: `c${i}`,
    label: `Concept ${i}`,
    importance: i === 0 ? "primary" : i < 15 ? "supporting" : "detail",
  }));
  const raw = { concepts: tooManyConcepts, relationships: [], claims: [] };
  const sanitized = sanitizeForSchema(raw);
  check("a 25-concept response is trimmed to the 24-concept cap, not rejected wholesale", sanitized.concepts.length === 24);
  check("trimming drops from the lowest importance tier first (details before supporting/primary)", !sanitized.concepts.some((c) => c.id === "c24"), JSON.stringify(sanitized.concepts.map((c) => c.id)));
  check("the sole primary concept always survives a trim", sanitized.concepts.some((c) => c.id === "c0"));
  check("a sanitized 25-into-24 trim now validates successfully", SemanticStateSchema.safeParse(sanitized).success);
}

{
  // Trimming concepts must not leave a dangling relationship or claim reference.
  const raw = {
    concepts: Array.from({ length: 25 }, (_, i) => ({ id: `c${i}`, label: `Concept ${i}`, importance: i < 23 ? "supporting" : "detail" })),
    relationships: [
      { id: "r-keep", from: "c0", to: "c1", type: "related_to" },
      { id: "r-drop", from: "c0", to: "c24", type: "related_to" }, // c24 is the lowest-priority concept, expected to be trimmed
    ],
    claims: [{ id: "claim-1", text: "spans a kept and a dropped concept", about: ["c0", "c24"], importance: "supporting" }],
  };
  const sanitized = sanitizeForSchema(raw);
  const survivingIds = new Set(sanitized.concepts.map((c) => c.id));
  check("a relationship whose endpoint got trimmed is dropped, not left dangling", sanitized.relationships.every((r) => survivingIds.has(r.from) && survivingIds.has(r.to)), JSON.stringify(sanitized.relationships));
  check("a relationship between two surviving concepts is kept", sanitized.relationships.some((r) => r.id === "r-keep"));
  check("a claim's dangling `about` entry is pruned, not the whole claim", sanitized.claims.length === 1 && !(sanitized.claims[0].about ?? []).includes("c24"));
  check("a fully repaired response validates successfully end to end", SemanticStateSchema.safeParse(sanitized).success);
}

{
  // Relationships/claims overflowing their own caps (40 / 30) are trimmed too.
  const manyRelationships = Array.from({ length: 42 }, (_, i) => ({ id: `r${i}`, from: "a", to: "b", type: "related_to" }));
  const sanitized = sanitizeForSchema({ concepts: [{ id: "a", label: "A", importance: "primary" }, { id: "b", label: "B", importance: "supporting" }], relationships: manyRelationships, claims: [] });
  check("relationships exceeding the 40-item cap are trimmed, not rejected wholesale", sanitized.relationships.length === 40);
}

{
  const manyClaims = Array.from({ length: 32 }, (_, i) => ({ id: `claim-${i}`, text: `Claim ${i}`, importance: i === 0 ? "primary" : "detail" }));
  const sanitized = sanitizeForSchema({ concepts: [], relationships: [], claims: manyClaims });
  check("claims exceeding the 30-item cap are trimmed by importance, not rejected wholesale", sanitized.claims.length === 30 && sanitized.claims.some((c) => c.id === "claim-0"));
}

{
  // A response already within every cap must pass through completely unchanged in structure.
  const raw = { concepts: [{ id: "a", label: "A", importance: "primary" }], relationships: [], claims: [] };
  const sanitized = sanitizeForSchema(raw);
  check("a response already within caps is untouched by trimming", sanitized.concepts.length === 1 && sanitized.concepts[0].id === "a");
}

// --------------------------------------------------------------- local meaning (two-stage architecture, semantic accumulation fix 2026-08-19)

section("LocalMeaning — stage 1 of the two-stage decision (extract before reconciling)");

{
  check(
    "accepts a minimal local meaning",
    LocalMeaningSchema.safeParse({ concepts: [], claims: [], relationships: [], interpretation: "" }).success,
  );
  check(
    "accepts a concrete extraction: a new concept, a claim about it, and a relationship between two local concepts",
    LocalMeaningSchema.safeParse({
      concepts: [
        { id: "participant", label: "Participant" },
        { id: "video-workflow", label: "Video/content workflow" },
      ],
      claims: [{ text: "Participant demonstrated his content workflow", about: ["participant"] }],
      relationships: [{ from: "participant", to: "video-workflow", type: "related_to" }],
      interpretation: "The participant showed the speaker his video-editing workflow.",
    }).success,
  );
  check(
    "rejects a relationship type outside the shared vocabulary",
    !LocalMeaningSchema.safeParse({
      concepts: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      claims: [],
      relationships: [{ from: "a", to: "b", type: "orbits" }],
      interpretation: "x",
    }).success,
  );
  check(
    "local concepts carry no importance/status/confidence — those are stage-2 (reconciliation) concerns, not stage-1 extraction concerns",
    !LocalMeaningSchema.safeParse({
      concepts: [{ id: "a", label: "A", importance: "primary" }],
      claims: [],
      relationships: [],
      interpretation: "x",
    }).success,
  );
}

section("sanitizeLocalMeaning — same trim-not-discard posture as sanitizeForSchema, sized for stage-1's smaller caps");

{
  const raw = {
    concepts: Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, label: `x`.repeat(90) })),
    claims: Array.from({ length: 10 }, (_, i) => ({ text: `y`.repeat(200) })),
    relationships: Array.from({ length: 12 }, (_, i) => ({ from: "c0", to: "c1", type: "related_to" })),
    interpretation: "z".repeat(300),
  };
  const sanitized = sanitizeLocalMeaning(raw);
  check("concepts overflowing the 10-item cap are trimmed", sanitized.concepts.length === 10);
  check("claims overflowing the 8-item cap are trimmed", sanitized.claims.length === 8);
  check("relationships overflowing the 10-item cap are trimmed", sanitized.relationships.length === 10);
  check("an overlong concept label is clamped to 60 chars", sanitized.concepts[0].label.length === 60);
  check("an overlong claim text is clamped to 160 chars", sanitized.claims[0].text.length === 160);
  check("an overlong interpretation is clamped to 240 chars", sanitized.interpretation.length === 240);
  check("a fully sanitized stage-1 overflow now validates successfully", LocalMeaningSchema.safeParse(sanitized).success);
}

{
  // A relationship endpoint that got trimmed away (or was never a real local concept id) must be dropped, not left dangling.
  const raw = {
    concepts: [{ id: "kept", label: "Kept" }],
    claims: [{ text: "spans a kept and a missing concept", about: ["kept", "ghost"] }],
    relationships: [{ from: "kept", to: "ghost", type: "related_to" }],
    interpretation: "x",
  };
  const sanitized = sanitizeLocalMeaning(raw);
  check("a relationship pointing at an unknown local id is dropped", sanitized.relationships.length === 0);
  check("a claim's dangling `about` entry is pruned, not the whole claim", sanitized.claims.length === 1 && !(sanitized.claims[0].about ?? []).includes("ghost"));
}

{
  check("sanitizeLocalMeaning defaults a missing interpretation to an empty string rather than leaving it undefined", sanitizeLocalMeaning({}).interpretation === "");
}

// --------------------------------------------------------------- gold talk assertions (Phase 1 — shape, no model)

section("gold talk assertions — the bar the live engine must hit");

{
  const trust = {
    topic: "AI and software",
    currentInterpretation: "Easier AI-built software creates too many apps and a trust problem.",
    concepts: [
      { id: "ai", label: "AI", importance: "primary" },
      { id: "easier-building", label: "Easier app creation", importance: "supporting" },
      { id: "more-apps", label: "Thousands of apps", importance: "supporting" },
      { id: "choices", label: "Too many choices", importance: "supporting" },
      { id: "trust", label: "Trust problem", importance: "supporting" },
    ],
    relationships: [
      { id: "r1", from: "ai", to: "easier-building", type: "leads_to" },
      { id: "r2", from: "easier-building", to: "more-apps", type: "leads_to" },
      { id: "r3", from: "more-apps", to: "choices", type: "causes" },
      { id: "r4", from: "choices", to: "trust", type: "causes" },
    ],
    claims: [{ id: "c1", text: "People don't know which apps are legitimate", about: ["trust"], importance: "supporting" }],
  };
  const verdict = assertGoldTalk("trust-problem", trust);
  check("canonical 4-step trust chain passes gold", verdict.ok, verdict.failures.join("; "));
}

{
  // Live-shaped: AI supports building rather than sitting on the causes/leads_to spine.
  const liveShaped = {
    concepts: [
      { id: "ai", label: "AI", importance: "primary" },
      { id: "app-building", label: "building apps", importance: "primary" },
      { id: "app-proliferation", label: "proliferation of thousands of apps", importance: "supporting" },
      { id: "trust-problem", label: "Trust problem", importance: "supporting" },
    ],
    relationships: [
      { id: "r1", from: "ai", to: "app-building", type: "supports" },
      { id: "r2", from: "app-building", to: "app-proliferation", type: "leads_to" },
      { id: "r3", from: "app-proliferation", to: "trust-problem", type: "causes" },
    ],
    claims: [{ id: "c1", text: "People don't know which apps are legitimate", about: ["trust-problem"], importance: "supporting" }],
  };
  const verdict = assertGoldTalk("trust-problem", liveShaped);
  check("AI-supports-building plus a 3-step causal spine still passes gold", verdict.ok, verdict.failures.join("; "));
}

{
  const liveHaiku = {
    concepts: [
      { id: "ai", label: "AI", importance: "primary" },
      { id: "app_building", label: "building apps", importance: "supporting" },
      { id: "ease_of_development", label: "ease of development", importance: "supporting" },
      { id: "app_proliferation", label: "proliferation of apps", importance: "supporting" },
      { id: "trust_problem", label: "Trust problem", importance: "supporting" },
      { id: "app_legitimacy", label: "App legitimacy", importance: "supporting" },
      { id: "user_uncertainty", label: "User uncertainty", importance: "supporting" },
    ],
    relationships: [
      { id: "r1", from: "ai", to: "ease_of_development", type: "causes" },
      { id: "r2", from: "ease_of_development", to: "app_building", type: "supports" },
      { id: "r3", from: "ease_of_development", to: "app_proliferation", type: "leads_to" },
      { id: "r4", from: "app_proliferation", to: "trust_problem", type: "causes" },
      { id: "r5", from: "trust_problem", to: "user_uncertainty", type: "contains" },
      { id: "r6", from: "user_uncertainty", to: "app_legitimacy", type: "related_to" },
    ],
    claims: [{ id: "c1", text: "People lack reliable ways to distinguish legitimate apps from illegitimate ones", about: ["user_uncertainty"], importance: "supporting" }],
  };
  const verdict = assertGoldTalk("trust-problem", liveHaiku);
  check("live Haiku trust-problem shape (AI → ease → proliferation → trust) passes gold", verdict.ok, verdict.failures.join("; "));
}

{
  const liveHaikuIncrease = {
    ...{
      concepts: [
        { id: "ai", label: "AI", importance: "primary" },
        { id: "ease_of_development", label: "ease of development", importance: "supporting" },
        { id: "app_proliferation", label: "massive increase in apps", importance: "supporting" },
        { id: "trust_problem", label: "Trust problem", importance: "supporting" },
      ],
      relationships: [
        { id: "r1", from: "ai", to: "ease_of_development", type: "causes" },
        { id: "r2", from: "ease_of_development", to: "app_proliferation", type: "leads_to" },
        { id: "r3", from: "app_proliferation", to: "trust_problem", type: "causes" },
      ],
      claims: [{ id: "c1", text: "People don't know which apps are legitimate", about: ["trust_problem"], importance: "supporting" }],
    },
  };
  const verdict = assertGoldTalk("trust-problem", liveHaikuIncrease);
  check("live wording 'massive increase in apps' still passes gold", verdict.ok, verdict.failures.join("; "));
}

{
  const collapsed = {
    concepts: [{ id: "ai-trust", label: "AI trust problem", importance: "primary" }],
    relationships: [],
    claims: [],
  };
  const verdict = assertGoldTalk("trust-problem", collapsed);
  check("a single mixed AI+trust concept fails gold (collapse)", !verdict.ok);
}

{
  const comparison = {
    concepts: [
      { id: "napkin", label: "Napkin", importance: "supporting" },
      { id: "inpublic", label: "InPublic", importance: "primary" },
    ],
    relationships: [{ id: "r1", from: "napkin", to: "inpublic", type: "contrasts" }],
    claims: [],
  };
  check("Napkin vs InPublic contrast passes comparison gold", assertGoldTalk("comparison", comparison).ok);
}

{
  const process = {
    concepts: [
      { id: "words", label: "Words land as you speak", importance: "supporting" },
      { id: "meaning", label: "Understand what was meant", importance: "primary" },
      { id: "form", label: "Choose a visual form", importance: "supporting" },
      { id: "canvas", label: "Canvas expresses it", importance: "supporting" },
    ],
    relationships: [
      { id: "r1", from: "words", to: "meaning", type: "leads_to" },
      { id: "r2", from: "meaning", to: "form", type: "leads_to" },
      { id: "r3", from: "form", to: "canvas", type: "leads_to" },
    ],
    claims: [],
  };
  check("speech → understand → express process passes gold", assertGoldTalk("process", process).ok);
}

{
  const reflective = {
    concepts: [],
    relationships: [],
    claims: [{ id: "c1", text: "The experience was humbling for the speaker", importance: "primary" }],
  };
  check("claim-only reflection passes gold", assertGoldTalk("reflective", reflective).ok);
}

{
  const invented = {
    concepts: [
      { id: "that", label: "That", importance: "primary" },
      { id: "eyes", label: "Eyes", importance: "supporting" },
    ],
    relationships: [{ id: "r1", from: "that", to: "eyes", type: "causes" }],
    claims: [{ id: "c1", text: "It's humbling", importance: "detail" }],
  };
  check("invented eyes←that edge fails reflective gold", !assertGoldTalk("reflective", invented).ok);
}

section("display labels — boxes get names, not clauses");

{
  check("a short name is unchanged", displayConceptLabel("Trust problem") === "Trust problem");
  check("a clause is cut to four words", displayConceptLabel("the 10 apples are what must be added") === "the 10 apples are");
  check("an empty label stays empty", displayConceptLabel("   ") === "");
  check("a quantity prefixes the name when the digits are not already in it", displayConceptLabel("apples", { value: 5 }) === "5 apples");
  check("keepTextBindings preserves label refs and drops arrows", JSON.stringify(keepTextBindings([{ id: "t1", type: "text" }, { id: "a1", type: "arrow" }])) === JSON.stringify([{ id: "t1", type: "text" }]));
  check("keepTextBindings on empty is empty", keepTextBindings(undefined).length === 0);
}

// --------------------------------------------------------------- visual planner (Phase 2)

section("visual planner — form follows meaning, no model");

{
  check("empty state plans as an empty concept_network", planMeaning(EMPTY_SEMANTIC_STATE).family === "concept_network" && planMeaning(EMPTY_SEMANTIC_STATE).focusConceptIds.length === 0);
  check("empty plan matches EMPTY_VISUAL_PLAN family", planMeaning(EMPTY_SEMANTIC_STATE).family === EMPTY_VISUAL_PLAN.family);
  check("VisualPlan schema accepts a planner result", VisualPlanSchema.safeParse(planMeaning(EMPTY_SEMANTIC_STATE)).success);
}

{
  const s3 = {
    concepts: [
      { id: "ai", label: "AI", importance: "primary" },
      { id: "app-creation", label: "Easier app creation", importance: "supporting" },
      { id: "more-apps", label: "More applications", importance: "supporting" },
      { id: "trust-problem", label: "Trust problem", importance: "supporting" },
    ],
    relationships: [
      { id: "ai-apps", from: "ai", to: "app-creation", type: "leads_to" },
      { id: "apps-more", from: "app-creation", to: "more-apps", type: "leads_to" },
      { id: "more-apps-trust", from: "more-apps", to: "trust-problem", type: "causes" },
    ],
    claims: [],
  };
  const plan = planMeaning(s3);
  check("canonical trust fixture plans as causal_chain", plan.family === "causal_chain", plan.reason);
  check(
    "causal focus is the spine in order",
    JSON.stringify(plan.focusConceptIds) === JSON.stringify(["ai", "app-creation", "more-apps", "trust-problem"]),
    JSON.stringify(plan.focusConceptIds),
  );
  check("causal plan has three spine edges", plan.focusRelationshipIds.length === 3);
}

{
  const liveHaiku = {
    concepts: [
      { id: "ai", label: "AI", importance: "primary" },
      { id: "app_building", label: "building apps", importance: "supporting" },
      { id: "ease_of_development", label: "ease of development", importance: "supporting" },
      { id: "app_proliferation", label: "thousands of apps", importance: "supporting" },
      { id: "trust_problem", label: "Trust problem", importance: "supporting" },
      { id: "user_uncertainty", label: "User uncertainty", importance: "supporting" },
    ],
    relationships: [
      { id: "r1", from: "ai", to: "ease_of_development", type: "causes" },
      { id: "r2", from: "ease_of_development", to: "app_building", type: "supports" },
      { id: "r3", from: "ease_of_development", to: "app_proliferation", type: "leads_to" },
      { id: "r4", from: "app_proliferation", to: "trust_problem", type: "causes" },
      { id: "r5", from: "trust_problem", to: "user_uncertainty", type: "contains" },
    ],
    claims: [{ id: "c1", text: "People don't know which apps are legitimate", about: ["trust_problem"], importance: "supporting" }],
  };
  const plan = planMeaning(liveHaiku);
  check("live Haiku trust talk plans as causal_chain", plan.family === "causal_chain", plan.reason);
  check(
    "live spine is AI → ease → thousands → trust (building apps stays off-canvas)",
    JSON.stringify(plan.focusConceptIds) === JSON.stringify(["ai", "ease_of_development", "app_proliferation", "trust_problem"]),
    JSON.stringify(plan.focusConceptIds),
  );
  check("legitimacy claim is an annotation, not a focus node", plan.annotationClaimIds.includes("c1") && !plan.focusConceptIds.includes("user_uncertainty"));
}

{
  const comparison = {
    concepts: [
      { id: "napkin", label: "Napkin", importance: "primary" },
      { id: "inpublic", label: "InPublic", importance: "supporting" },
      { id: "async-mode", label: "asynchronous mode", importance: "supporting" },
      { id: "live-mode", label: "live mode", importance: "supporting" },
    ],
    relationships: [
      { id: "r1", from: "napkin", to: "inpublic", type: "contrasts" },
      { id: "r2", from: "napkin", to: "async-mode", type: "example_of" },
      { id: "r3", from: "inpublic", to: "live-mode", type: "example_of" },
    ],
    claims: [],
  };
  const plan = planMeaning(comparison);
  check("Napkin vs InPublic plans as comparison", plan.family === "comparison", plan.reason);
  check("comparison focus leads with the two poles", plan.focusConceptIds[0] === "napkin" && plan.focusConceptIds[1] === "inpublic");
}

{
  const process = {
    concepts: [
      { id: "words", label: "Words land as you speak", importance: "supporting" },
      { id: "meaning", label: "Understand what was meant", importance: "primary" },
      { id: "form", label: "Choose a visual form", importance: "supporting" },
      { id: "canvas", label: "Canvas expresses it", importance: "supporting" },
    ],
    relationships: [
      { id: "r1", from: "words", to: "meaning", type: "leads_to" },
      { id: "r2", from: "meaning", to: "form", type: "leads_to" },
      { id: "r3", from: "form", to: "canvas", type: "leads_to" },
    ],
    claims: [],
  };
  check("an ordered process is causal_chain (same renderer, leads_to labels)", planMeaning(process).family === "causal_chain");
}

{
  const two = {
    concepts: [
      { id: "speech", label: "Speech", importance: "primary" },
      { id: "understanding", label: "Understanding", importance: "supporting" },
    ],
    relationships: [{ id: "r1", from: "speech", to: "understanding", type: "leads_to" }],
    claims: [],
  };
  check("a two-step process without quantities is a causal_chain", planMeaning(two).family === "causal_chain");
}

{
  const counted = {
    concepts: [
      { id: "apples", label: "apples", importance: "primary", quantity: { value: 5 } },
      { id: "children", label: "children", importance: "supporting", quantity: { value: 10 } },
    ],
    relationships: [],
    claims: [],
  };
  const plan = planMeaning(counted);
  check("two quantities with no causal spine plan as comparison", plan.family === "comparison");
  check("quantity comparison leads with the two counted concepts", plan.focusConceptIds[0] === "apples" && plan.focusConceptIds[1] === "children");
}

{
  const reflective = {
    concepts: [{ id: "speaker-insight", label: "Speaker's moment of insight", importance: "primary" }],
    relationships: [],
    claims: [{ id: "c1", text: "The experience was humbling for the speaker", about: ["speaker-insight"], importance: "primary" }],
  };
  const plan = planMeaning(reflective);
  check("reflective speech plans as concept_network, not a fake chain", plan.family === "concept_network");
  check("reflective claim is an annotation", plan.annotationClaimIds.includes("c1"));
}

{
  const hierarchy = {
    concepts: [
      { id: "company", label: "Company", importance: "primary" },
      { id: "eng", label: "Engineering", importance: "supporting" },
      { id: "sales", label: "Sales", importance: "supporting" },
    ],
    relationships: [
      { id: "r1", from: "company", to: "eng", type: "contains" },
      { id: "r2", from: "company", to: "sales", type: "contains" },
    ],
    claims: [],
  };
  const plan = planMeaning(hierarchy);
  check("a container with two children plans as hierarchy", plan.family === "hierarchy", plan.reason);
  check("hierarchy focus is root then children", plan.focusConceptIds[0] === "company" && plan.focusConceptIds.includes("eng") && plan.focusConceptIds.includes("sales"));
}

{
  const snapshots = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      concepts: [
        { id: "ai", label: "AI", importance: "primary" },
        { id: "apps", label: "More apps", importance: "supporting" },
        { id: "trust", label: "Trust problem", importance: "supporting" },
      ],
      relationships: [
        { id: "r1", from: "ai", to: "apps", type: "leads_to" },
        { id: "r2", from: "apps", to: "trust", type: "causes" },
      ],
      claims: [],
    }),
  });
  try {
    const updates = [];
    const controller = new MeaningEngineController({
      debounceMs: 5,
      onUpdate: (u) => updates.push(u),
      onDebug: (s) => snapshots.push(s),
    });
    controller.submit({ source: "human_speech", content: "AI makes more apps which creates a trust problem." });
    await new Promise((resolve) => setTimeout(resolve, 30));
    check("onUpdate carries a causal_chain plan", updates[0]?.plan?.family === "causal_chain", JSON.stringify(updates[0]?.plan));
    check("onDebug snapshot includes family + focus", snapshots[0]?.family === "causal_chain" && snapshots[0]?.focusConceptIds?.length === 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// --------------------------------------------------------------- causal chain layout (Phase 3)

section("causal chain layout — a chain is a sentence, not a tree");

{
  const state = {
    concepts: [
      { id: "ai", label: "AI", importance: "primary" },
      { id: "apps", label: "More applications", importance: "supporting" },
      { id: "trust", label: "Trust problem", importance: "supporting" },
    ],
    relationships: [
      { id: "r1", from: "ai", to: "apps", type: "leads_to" },
      { id: "r2", from: "apps", to: "trust", type: "causes" },
    ],
    claims: [],
  };
  const plan = planMeaning(state);
  const layout = computeCausalChainLayout(state, plan);
  const ai = layout.boxes.get("ai");
  const apps = layout.boxes.get("apps");
  const trust = layout.boxes.get("trust");
  check("every spine concept gets a box", layout.boxes.size === 3);
  check("a causal chain is one column (shared x)", ai.x === apps.x && apps.x === trust.x);
  check("spine order is top to bottom", ai.y < apps.y && apps.y < trust.y);
  check("chain width is one node", layout.width === NODE_W);
  check("chain height is 3 nodes + 2 gutters", layout.height === 3 * NODE_H + 2 * V_GUTTER);
}

{
  const s3 = {
    concepts: [
      { id: "ai", label: "AI", importance: "primary" },
      { id: "apps", label: "More applications", importance: "supporting" },
      { id: "trust", label: "Trust problem", importance: "supporting" },
    ],
    relationships: [
      { id: "r1", from: "ai", to: "apps", type: "leads_to" },
      { id: "r2", from: "apps", to: "trust", type: "causes" },
    ],
    claims: [],
  };
  const s4 = {
    concepts: [...s3.concepts, { id: "aside", label: "A side note", importance: "detail" }],
    relationships: [...s3.relationships, { id: "r3", from: "ai", to: "aside", type: "related_to" }],
    claims: [],
  };
  const a = computeCausalChainLayout(s3, planMeaning(s3));
  const b = computeCausalChainLayout(s4, planMeaning(s4));
  check("an off-spine detail does not enter the causal layout", !b.boxes.has("aside") && b.boxes.size === 3);
  check(
    "adding an off-spine detail does not move spine nodes",
    JSON.stringify([...a.boxes]) === JSON.stringify([...b.boxes]),
  );
}

// --------------------------------------------------------------- comparison layout (Phase 5a)

section("comparison layout — two poles, not a tree");

{
  const state = {
    concepts: [
      { id: "napkin", label: "Napkin", importance: "primary" },
      { id: "inpublic", label: "InPublic", importance: "supporting" },
      { id: "async-mode", label: "asynchronous mode", importance: "supporting" },
      { id: "live-mode", label: "live mode", importance: "supporting" },
    ],
    relationships: [
      { id: "r1", from: "napkin", to: "inpublic", type: "contrasts" },
      { id: "r2", from: "napkin", to: "async-mode", type: "example_of" },
      { id: "r3", from: "inpublic", to: "live-mode", type: "example_of" },
    ],
    claims: [],
  };
  const plan = planMeaning(state);
  const layout = computeComparisonLayout(state, plan);
  const napkin = layout.boxes.get("napkin");
  const inpublic = layout.boxes.get("inpublic");
  const asyncMode = layout.boxes.get("async-mode");
  const liveMode = layout.boxes.get("live-mode");
  check("comparison plans as comparison before layout", plan.family === "comparison");
  check("all four focus concepts get a box", layout.boxes.size === 4);
  check("poles sit on the same row", napkin.y === inpublic.y);
  check("poles sit in two columns, left then right", napkin.x < inpublic.x);
  check("right pole is one node + gap from the left", inpublic.x === napkin.x + NODE_W + COMPARISON_COLUMN_GAP);
  check("async hangs under Napkin, not under InPublic", asyncMode.x === napkin.x && asyncMode.y > napkin.y);
  check("live hangs under InPublic, not under Napkin", liveMode.x === inpublic.x && liveMode.y > inpublic.y);
  check("columns do not overlap", napkin.x + napkin.w <= inpublic.x);
  check("comparison width is two columns plus gap", layout.width === NODE_W * 2 + COMPARISON_COLUMN_GAP);
  check("computeMeaningLayout dispatches comparison", computeMeaningLayout(state, plan).width === layout.width);
}

{
  const network = {
    concepts: [
      { id: "a", label: "A", importance: "primary" },
      { id: "b", label: "B", importance: "supporting" },
    ],
    relationships: [{ id: "r1", from: "a", to: "b", type: "related_to" }],
    claims: [],
  };
  const plan = planMeaning(network);
  const layout = computeMeaningLayout(network, plan);
  check("a related_to pair is concept_network, laid out as a column not a tree", plan.family === "concept_network" && layout.width === NODE_W && layout.boxes.get("b").y > layout.boxes.get("a").y);
}

{
  const hierarchy = {
    concepts: [
      { id: "company", label: "Company", importance: "primary" },
      { id: "eng", label: "Engineering", importance: "supporting" },
      { id: "sales", label: "Sales", importance: "supporting" },
    ],
    relationships: [
      { id: "r1", from: "company", to: "eng", type: "contains" },
      { id: "r2", from: "company", to: "sales", type: "contains" },
    ],
    claims: [],
  };
  const plan = planMeaning(hierarchy);
  const layout = computeMeaningLayout(hierarchy, plan);
  const company = layout.boxes.get("company");
  const eng = layout.boxes.get("eng");
  const sales = layout.boxes.get("sales");
  check("hierarchy plans as enclosure, not a chain of arrows", plan.family === "hierarchy");
  check("children sit inside the parent region", eng.x >= company.x && eng.x + eng.w <= company.x + company.w && eng.y >= company.y && eng.y + eng.h <= company.y + company.h);
  check("siblings share a row inside the container", eng.y === sales.y && eng.x < sales.x);
  check("the parent box is larger than a single child", company.w > NODE_W && company.h > NODE_H);
}

{
  const family = {
    concepts: [
      { id: "household", label: "Household", importance: "primary" },
      { id: "mother", label: "Mother", importance: "supporting" },
      { id: "father", label: "Father", importance: "supporting" },
      { id: "older", label: "Older brother", importance: "supporting" },
      { id: "younger", label: "Younger brother", importance: "supporting" },
    ],
    relationships: [
      { id: "r1", from: "household", to: "mother", type: "contains" },
      { id: "r2", from: "household", to: "father", type: "contains" },
      { id: "r3", from: "household", to: "older", type: "contains" },
      { id: "r4", from: "household", to: "younger", type: "contains" },
    ],
    claims: [],
  };
  const layout = computeMeaningLayout(family, planMeaning(family));
  const house = layout.boxes.get("household");
  const mother = layout.boxes.get("mother");
  const father = layout.boxes.get("father");
  const older = layout.boxes.get("older");
  const younger = layout.boxes.get("younger");
  check("a family of four wraps to two rows inside the household", mother.y === father.y && older.y === younger.y && older.y > mother.y);
  check("no child overlaps the household title band", mother.y >= house.y + 40);
  check("every member still sits inside the household", [mother, father, older, younger].every((b) => b.x >= house.x && b.x + b.w <= house.x + house.w && b.y + b.h <= house.y + house.h));
}

// --------------------------------------------------------------- visual grammar corpus (synthetic states, no API)

section("visual grammar corpus — meaning chooses form, space encodes the relation");

{
  const ideaToSimplify = {
    concepts: [
      { id: "idea", label: "Idea", importance: "primary" },
      { id: "prototype", label: "Prototype", importance: "supporting" },
      { id: "confusion", label: "User confusion", importance: "supporting" },
      { id: "simplify", label: "Simplification", importance: "supporting" },
    ],
    relationships: [
      { id: "r1", from: "idea", to: "prototype", type: "leads_to" },
      { id: "r2", from: "prototype", to: "confusion", type: "leads_to" },
      { id: "r3", from: "confusion", to: "simplify", type: "causes" },
    ],
    claims: [],
  };
  const plan = planMeaning(ideaToSimplify);
  const layout = computeMeaningLayout(ideaToSimplify, plan);
  check("idea→prototype→confusion→simplify is a causal_chain", plan.family === "causal_chain");
  check("that chain is one column in spoken order", layout.boxes.get("idea").x === layout.boxes.get("simplify").x && layout.boxes.get("idea").y < layout.boxes.get("prototype").y);
}

{
  const revenue = {
    concepts: [
      { id: "revenue", label: "Revenue", importance: "primary", quantity: { value: 1 } },
      { id: "costs", label: "Costs", importance: "supporting", quantity: { value: 1 } },
    ],
    relationships: [{ id: "r1", from: "revenue", to: "costs", type: "contrasts" }],
    claims: [],
  };
  check("revenue vs costs is a comparison, not two stacked boxes", planMeaning(revenue).family === "comparison");
}

{
  const reasons = {
    concepts: [
      { id: "no-aha", label: "No aha moment", importance: "primary" },
      { id: "clicks", label: "People are clicking", importance: "supporting" },
      { id: "demand", label: "Demand is not the issue", importance: "supporting" },
    ],
    relationships: [
      { id: "r1", from: "clicks", to: "no-aha", type: "supports" },
      { id: "r2", from: "demand", to: "no-aha", type: "supports" },
    ],
    claims: [],
  };
  const plan = planMeaning(reasons);
  const layout = computeMeaningLayout(reasons, plan);
  check("a claim with two reasons is enclosed, not a loose network", plan.family === "hierarchy" && plan.focusConceptIds[0] === "no-aha");
  const root = layout.boxes.get("no-aha");
  const a = layout.boxes.get("clicks");
  check("reasons sit inside the claim", a.x >= root.x && a.x + a.w <= root.x + root.w && a.y >= root.y);
}

{
  const filler = {
    concepts: [{ id: "look", label: "take a look", importance: "detail" }],
    relationships: [],
    claims: [],
  };
  check("an unstructured aside draws nothing", planMeaning(filler).focusConceptIds.length === 0);
}

{
  const definition = {
    concepts: [{ id: "photosynthesis", label: "Photosynthesis", importance: "primary" }],
    relationships: [],
    claims: [{ id: "c1", text: "Plants convert light into chemical energy", about: ["photosynthesis"], importance: "supporting" }],
  };
  check("a named definition may appear as a single card", planMeaning(definition).focusConceptIds[0] === "photosynthesis");
}

{
  const s1 = {
    concepts: [
      { id: "ai", label: "AI", importance: "primary" },
      { id: "apps", label: "More apps", importance: "supporting" },
    ],
    relationships: [{ id: "r1", from: "ai", to: "apps", type: "leads_to" }],
    claims: [],
  };
  const s2 = {
    concepts: [
      ...s1.concepts,
      { id: "trust", label: "Trust problem", importance: "supporting" },
    ],
    relationships: [...s1.relationships, { id: "r2", from: "apps", to: "trust", type: "causes" }],
    claims: [],
  };
  check("after two thoughts the same ids remain the spine (continuous talk, not a reset)", planMeaning(s2).focusConceptIds[0] === "ai" && planMeaning(s2).focusConceptIds.includes("trust") && planMeaning(s1).focusConceptIds[0] === "ai");
}

// --------------------------------------------------------------- summary

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
