/**
 * Regression for live eval #3's second root cause: `express_uncertainty`
 * (the intent the classifier emits when nothing else scored higher —
 * lib/expression/intent/classify.ts's own priority list ranks it
 * second-to-last) used to map to the `relationship` grammar's normal,
 * world-importance-ranked entity selection. That let a stretch of weak or
 * disfluent speech drag old, unrelated high-importance entities back onto a
 * canvas that had moved on to something else entirely. See
 * docs/EXPRESSION-ENGINE-LIVE-EVAL-3-REPORT.md and
 * lib/expression/planner/plan.ts's weakConfidenceFallback.
 *
 *   node --no-warnings --import ./scripts/ts-register.mjs scripts/expression-intent-fallback-test.mjs
 */

import { EMPTY_WORLD_STATE, ExpressionPlanSchema } from "../lib/expression/schemas.ts";
import { applyDelta } from "../lib/expression/world/apply.ts";
import { classifyIntent } from "../lib/expression/intent/classify.ts";
import { planExpression } from "../lib/expression/planner/plan.ts";
import { ExpressionSession } from "../lib/expression/pipeline.ts";

let pass = 0;
const failures = [];
const check = (name, condition, detail = "") => {
  if (condition) pass += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
};

const idOf = (w, label) => w.entities.find((e) => e.label === label)?.id;
// Matches lib/expression/grammars/index.ts's REGION_BUDGET — used only to
// bound the accumulation assertion in Part B, not asserted directly (scene
// budget is out of scope this pass).
const REGION_BUDGET_HINT = 8;

// ── Part A: direct, hand-constructed express_uncertainty intent ──
//
// A world with an old, structurally-important entity (importance: primary,
// via a high-degree neighborhood) established several turns ago, then one
// fresh entity introduced this round. Forces express_uncertainty as the
// primary intent to isolate the planner's response from classify.ts's own
// scoring — that scoring is untouched this pass.

{
  const setup = {
    entities: [
      { id: "old-anchor", type: "concept", label: "old anchor" },
      { id: "old-neighbor-a", type: "concept", label: "old neighbor a" },
      { id: "old-neighbor-b", type: "concept", label: "old neighbor b" },
      { id: "old-neighbor-c", type: "concept", label: "old neighbor c" },
    ],
    relations: [
      { id: "r-a", source: "old-anchor", type: "relates_to", target: "old-neighbor-a" },
      { id: "r-b", source: "old-anchor", type: "relates_to", target: "old-neighbor-b" },
      { id: "r-c", source: "old-anchor", type: "relates_to", target: "old-neighbor-c" },
    ],
    claims: [],
    interpretation: "old topic",
  };
  let world = applyDelta(EMPTY_WORLD_STATE, setup, 0).world;
  // High degree relative to the rest of the (tiny) world is enough for
  // recomputeImportance-adjacent logic elsewhere to treat it as important;
  // this test only needs it to be canvas-eligible and NOT newly touched.
  const oldAnchorId = idOf(world, "old anchor");

  const freshDelta = {
    entities: [{ id: "fresh-thing", type: "concept", label: "a fresh thing just mentioned" }],
    relations: [],
    claims: [{ id: "c-hedge", text: "maybe this fresh thing matters", uncertain: true }],
    interpretation: "current, weak evidence",
  };
  world = applyDelta(world, freshDelta, 1).world;
  const freshId = idOf(world, "a fresh thing just mentioned");

  const intent = { primary: "express_uncertainty", secondary: [], strength: 0.1, reason: "test" };
  const plan = planExpression(world, intent, { newEntityIds: [freshId], previousVisibleIds: [] });
  const planIds = new Set(plan.regions.map((r) => r.entityId).filter(Boolean));

  console.log(`Part A — plan.grammar=${plan.grammar} plan.reason="${plan.reason}"`);
  console.log(`Part A — regions: ${[...planIds].join(", ")}`);

  check("the fresh entity this round is on the plan", planIds.has(freshId));
  check(
    "the old, unrelated, never-previously-shown entities are NOT pulled in — no importance-based reselection",
    !planIds.has(oldAnchorId) && !planIds.has("old-neighbor-a") && !planIds.has("old-neighbor-b") && !planIds.has("old-neighbor-c"),
    `got ${[...planIds].join(", ")}`,
  );
  check("plan validates against ExpressionPlanSchema", ExpressionPlanSchema.safeParse(plan).success);
  check("the fallback identifies itself in the reason text", plan.reason.includes("low-confidence fallback"));
}

// ── Part A2: the same old entities, but already visible — must be kept,
// not dropped, proving this is "preserve the existing scene", not "wipe
// everything not new". ──

{
  const setup = {
    entities: [
      { id: "kept-a", type: "concept", label: "kept a" },
      { id: "kept-b", type: "concept", label: "kept b" },
    ],
    relations: [],
    claims: [],
    interpretation: "already on screen",
  };
  const world = applyDelta(EMPTY_WORLD_STATE, setup, 0).world;
  const keptAId = idOf(world, "kept a");
  const keptBId = idOf(world, "kept b");

  const intent = { primary: "express_uncertainty", secondary: [], strength: 0.1, reason: "test" };
  const plan = planExpression(world, intent, { newEntityIds: [], previousVisibleIds: [keptAId, keptBId] });
  const planIds = new Set(plan.regions.map((r) => r.entityId).filter(Boolean));

  check(
    "entities already on the previous scene are preserved, not wiped, by a low-confidence round",
    planIds.has(keptAId) && planIds.has(keptBId),
    `got ${[...planIds].join(", ")}`,
  );
}

// ── Part B: accumulation across many consecutive weak-confidence turns ──
//
// The real pipeline, end to end (ExpressionSession, no model — fixture
// deltas), each round hedged enough to keep landing on express_uncertainty,
// each introducing one small new topic-B entity. Fresh-topic entities must
// ACCUMULATE across the run, not rotate one-in/one-out against each other
// or against anything stale.

{
  const session = new ExpressionSession({ extract: async () => ({ entities: [], relations: [], claims: [], interpretation: "" }) });
  const topicBIds = [];
  const intentsSeen = [];

  for (let i = 0; i < 6; i += 1) {
    const delta = {
      entities: [{ id: `t${i}`, type: "concept", label: `topic b detail ${i}` }],
      relations: [],
      // A hedged claim every round, so `uncertain` keeps outscoring the
      // thin per-round structure and express_uncertainty keeps winning —
      // this is the "heavily disfluent speech, uncertain across many
      // consecutive turns" case the brief asked for, reproduced
      // deterministically via fixture deltas rather than real disfluent
      // audio.
      claims: [{ id: `c${i}`, text: `maybe detail ${i} matters`, uncertain: true }],
      interpretation: `disfluent turn ${i}`,
    };
    const segment = { id: `seg-${i}`, source: "human_text", text: `disfluent turn ${i}`, seq: i };
    const trace = await session.ingestDelta(segment, delta);
    intentsSeen.push(trace.intent.primary);
    const mintedId = idOf(trace.world, `topic b detail ${i}`);
    if (mintedId) topicBIds.push(mintedId);
  }

  console.log(`Part B — intents across 6 turns: ${intentsSeen.join(", ")}`);
  const finalTrace = await session.ingestDelta(
    { id: "seg-final", source: "human_text", text: "final check", seq: 6 },
    { entities: [], relations: [], claims: [{ id: "c-final", text: "still not sure", uncertain: true }], interpretation: "final" },
  );
  const finalIds = new Set(finalTrace.plan.regions.map((r) => r.entityId).filter(Boolean));
  console.log(`Part B — final plan regions: ${[...finalIds].join(", ")}`);

  check(
    "every consecutive turn actually landed on express_uncertainty (the scenario this fix targets)",
    intentsSeen.every((i) => i === "express_uncertainty"),
    `got ${intentsSeen.join(", ")}`,
  );
  check(
    "topic-B entities accumulate across consecutive uncertain turns rather than one-in/one-out rotating",
    topicBIds.filter((id) => finalIds.has(id)).length >= Math.min(topicBIds.length, REGION_BUDGET_HINT),
    `${topicBIds.filter((id) => finalIds.has(id)).length} of ${topicBIds.length} survived to the final plan`,
  );
}

console.log("\n" + "═".repeat(80));
if (failures.length) {
  console.log(`${pass}/${pass + failures.length} checks passed`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log(`${pass}/${pass} checks passed`);
}
