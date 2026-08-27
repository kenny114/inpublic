/**
 * Regression for the live-eval #1 bug: a plan's diagnostic `reason` string
 * grew past ExpressionPlanSchema's 200-character cap as
 * attachRelatedEntities's "attached X, Y, Z..." list lengthened, so the
 * whole otherwise-valid plan failed schema validation and the canvas lost
 * several seconds of content mid-thought. See
 * docs/EXPRESSION-ENGINE-LIVE-EVAL-1-REPORT.md, finding #1.
 *
 * Forces the same shape deliberately: a short causal spine (2 entities, via
 * `causes`) plus 7 more entities connected to the spine by non-causal
 * relations, each with a maximally long id — so cause_effect's own regions
 * stay small, and attachRelatedEntities has to attach most of the 7,
 * producing a long "attached ..." list the same way a real, busy world does.
 *
 *   node --no-warnings --import ./scripts/ts-register.mjs scripts/expression-plan-reason-bound-test.mjs
 */

import { EMPTY_WORLD_STATE, ExpressionPlanSchema } from "../lib/expression/schemas.ts";
import { applyDelta } from "../lib/expression/world/apply.ts";
import { planExpression } from "../lib/expression/planner/plan.ts";

let pass = 0;
const failures = [];
const check = (name, condition, detail = "") => {
  if (condition) pass += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
};

// Entity ids are minted by the world layer from the label, slugified and
// capped at 40 chars (lib/expression/world/apply.ts's slugify) — NOT the
// delta-local id supplied here. So reproducing the real bug (a long
// "attached ..." list) means long LABELS, matching what a real transcript
// actually produces ("the initial motivation for building InPublic was a
// desire to..." was 60+ characters in the live session that hit this).
const causeLabel = "the initial motivation for building the product";
const effectLabel = "the resulting product now exists in the world";
const attachedLabels = [
  "a very long supporting detail about the first thing mentioned",
  "a very long supporting detail about the second thing mentioned",
  "a very long supporting detail about the third thing mentioned",
  "a very long supporting detail about the fourth thing mentioned",
  "a very long supporting detail about the fifth thing mentioned",
  "a very long supporting detail about the sixth thing mentioned",
  "a very long supporting detail about the seventh thing mentioned",
];

const causeId = "cause";
const effectId = "effect";
const attachedIds = attachedLabels.map((_, i) => `att-${i}`);

const delta = {
  entities: [
    { id: causeId, type: "concept", label: causeLabel },
    { id: effectId, type: "concept", label: effectLabel },
    ...attachedIds.map((id, i) => ({ id, type: "concept", label: attachedLabels[i] })),
  ],
  relations: [
    { id: "r-causes", source: causeId, type: "causes", target: effectId },
    // Non-causal, so cause_effect's own branch logic (causal-only) leaves
    // these to attachRelatedEntities instead of drawing them into the spine.
    ...attachedIds.map((id, i) => ({ id: `r-att-${i}`, source: causeId, type: "relates_to", target: id })),
  ],
  claims: [],
  interpretation: "test",
};

const world = applyDelta(EMPTY_WORLD_STATE, delta, 0).world;
const mintedFocusId = world.entities.find((e) => e.label === causeLabel).id;

const intent = {
  primary: "explain_causality",
  secondary: [],
  focusEntityId: mintedFocusId,
  strength: 1,
  reason: "test",
};

const plan = planExpression(world, intent);

console.log(`plan.grammar:        ${plan.grammar}`);
console.log(`plan.regions.length: ${plan.regions.length}`);
console.log(`plan.reason.length:  ${plan.reason.length}`);
console.log(`plan.reason:         ${plan.reason}`);

check("plan is the real cause_effect plan, not the invalid-plan/empty fallback", plan.grammar === "cause_effect", `got grammar=${plan.grammar}`);
check(
  "attachRelatedEntities actually attached several entities (the scenario reproduces the growth that caused the bug)",
  plan.regions.length >= 6,
  `got ${plan.regions.length} regions`,
);
check("reason stays within ExpressionPlanSchema's 200-char cap", plan.reason.length <= 200, `got ${plan.reason.length} chars`);
check("plan validates against ExpressionPlanSchema", ExpressionPlanSchema.safeParse(plan).success);

console.log("\n" + "═".repeat(80));
if (failures.length) {
  console.log(`${pass}/${pass + failures.length} checks passed`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log(`${pass}/${pass} checks passed`);
}
