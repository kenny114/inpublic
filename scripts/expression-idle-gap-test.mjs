/**
 * Regression for live eval #3's root cause: CURRENT_WINDOW/PERSIST_WINDOW
 * (lib/expression/planner/visibility.ts) age entities by ingested-turn
 * count, which is blind to a session that sat idle — a 40-real-minute gap
 * with no intervening turns looks, to a turn counter, like almost no time
 * passed at all. See docs/EXPRESSION-ENGINE-LIVE-EVAL-3-REPORT.md.
 *
 * Deterministic: no real sleeps. Wall-clock is entirely simulated via
 * InputSegment/Provenance.timestamp, exactly as a real session would
 * supply it (lib/expression/live.ts stamps Date.now() on every segment).
 *
 *   node --no-warnings --import ./scripts/ts-register.mjs scripts/expression-idle-gap-test.mjs
 */

import { EMPTY_WORLD_STATE } from "../lib/expression/schemas.ts";
import { applyDelta } from "../lib/expression/world/apply.ts";
import { assignVisibility } from "../lib/expression/planner/visibility.ts";
import { planExpression } from "../lib/expression/planner/plan.ts";

let pass = 0;
const failures = [];
const check = (name, condition, detail = "") => {
  if (condition) pass += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
};

const T0 = 1_000_000_000; // an arbitrary epoch-ms anchor
const IDLE_GAP_MS = 40 * 60 * 1000; // 40 wall-clock minutes
const T1 = T0 + IDLE_GAP_MS;

// Round 0 (seq 0): topic A — two ordinary supporting entities, plus one
// durable decision (a stated target — an active goal, per
// visibility.ts's hasMetricSignal).
const deltaA = {
  entities: [
    { id: "review-budget", type: "action", label: "review the budget" },
    { id: "draft-proposal", type: "action", label: "draft the proposal" },
    {
      id: "ship-by-friday",
      type: "action",
      label: "ship by Friday",
      metric: { unit: "percent", points: [], target: { value: 100 } },
    },
  ],
  relations: [],
  claims: [],
  interpretation: "topic A",
};

let world = applyDelta(EMPTY_WORLD_STATE, deltaA, 0, { timestamp: T0, sourceSegmentIds: ["seg-0"] }).world;

// Entity ids are minted by the world layer from the label (slugified —
// lib/expression/world/apply.ts), not the delta-local id supplied above, so
// look them up by label rather than assuming the supplied id survived.
const idOf = (w, label) => w.entities.find((e) => e.label === label)?.id;
const reviewBudgetId = idOf(world, "review the budget");
const draftProposalId = idOf(world, "draft the proposal");
const shipByFridayId = idOf(world, "ship by Friday");
if (!reviewBudgetId || !draftProposalId || !shipByFridayId) {
  throw new Error("setup failed: could not find minted entity ids");
}

// Round 1 (seq 1): topic B begins, 40 real minutes later. A single fresh
// entity — the ordinary case, nothing durable about it.
const deltaB = {
  entities: [{ id: "onboarding-flow", type: "concept", label: "the onboarding flow" }],
  relations: [],
  claims: [],
  interpretation: "topic B",
};
world = applyDelta(world, deltaB, 1, { timestamp: T1, sourceSegmentIds: ["seg-1"] }).world;
const onboardingId = idOf(world, "the onboarding flow");
if (!onboardingId) throw new Error("setup failed: could not find minted topic-B entity id");

console.log(`world.seq=${world.seq}, entities=${world.entities.map((e) => e.id).join(", ")}`);

// ── with wall-clock awareness (nowMs supplied, matching the real pipeline) ──

const visWithClock = assignVisibility(world, {
  newEntityIds: [onboardingId],
  previousVisibleIds: [],
  nowMs: T1,
});

check(
  "ordinary topic-A entity (review the budget) is no longer persist-eligible after a 40-minute idle gap",
  !visWithClock.persistIds.has(reviewBudgetId),
  `tier=${visWithClock.tier.get(reviewBudgetId)}`,
);
check(
  "ordinary topic-A entity (draft the proposal) is no longer persist-eligible after a 40-minute idle gap",
  !visWithClock.persistIds.has(draftProposalId),
);
check(
  "ordinary topic-A entities fall to historical tier, not contextual — they don't compete for the current working canvas",
  visWithClock.tier.get(reviewBudgetId) === "historical" && visWithClock.tier.get(draftProposalId) === "historical",
);
check(
  "the durable decision (a stated target) remains persist-eligible across the same idle gap",
  visWithClock.persistIds.has(shipByFridayId),
  `tier=${visWithClock.tier.get(shipByFridayId)}`,
);
check(
  "the durable decision's tier is supporting, not demoted",
  visWithClock.tier.get(shipByFridayId) === "supporting",
);
check(
  "the new topic-B entity is visibility-eligible immediately",
  visWithClock.tier.get(onboardingId) === "primary" || visWithClock.tier.get(onboardingId) === "contextual",
  `tier=${visWithClock.tier.get(onboardingId)}`,
);

// ── control: same world, no nowMs — must reproduce the OLD turn-only
// behavior exactly, proving this is a wall-clock-gated addition, not a
// general "expire old entities" change. seq distance is only 1, so both
// ordinary entities are trivially still inside PERSIST_WINDOW (36).

const visNoClock = assignVisibility(world, {
  newEntityIds: [onboardingId],
  previousVisibleIds: [],
});

check(
  "control (no nowMs): the same ordinary entities ARE persist-eligible — turn-count behavior is unchanged when no wall-clock signal exists",
  visNoClock.persistIds.has(reviewBudgetId) && visNoClock.persistIds.has(draftProposalId),
);

// ── end-to-end: planExpression must not let the stale topic-A entities
// dominate a fresh topic-B plan after the gap.

const intent = {
  primary: "describe",
  secondary: [],
  focusEntityId: onboardingId,
  strength: 1,
  reason: "test",
};
const plan = planExpression(world, intent, {
  newEntityIds: [onboardingId],
  previousVisibleIds: [],
  nowMs: T1,
});
const planEntityIds = new Set(plan.regions.map((r) => r.entityId).filter(Boolean));
console.log(`plan.regions entityIds: ${[...planEntityIds].join(", ")}`);

check("the fresh topic-B entity is on the plan", planEntityIds.has(onboardingId));
check(
  "ordinary topic-A entities do not dominate the fresh-topic plan",
  !planEntityIds.has(reviewBudgetId) && !planEntityIds.has(draftProposalId),
);

console.log("\n" + "═".repeat(80));
if (failures.length) {
  console.log(`${pass}/${pass + failures.length} checks passed`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log(`${pass}/${pass} checks passed`);
}
