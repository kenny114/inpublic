/**
 * Adversarial tests for the evaluator itself.
 *
 *   node --no-warnings --import ./scripts/ts-register.mjs scripts/expression-evaluator-test.mjs
 *
 * Deliberately separate from the renderer and corpus suites, because it asks
 * the opposite question. Those ask "does the engine produce good output?".
 * This asks "would the engine NOTICE bad output?" — and it answers by
 * handing the evaluator scenes that were broken on purpose.
 *
 * That distinction matters more than it sounds. An evaluator is the only
 * thing standing between "the picture is wrong" and "nobody finds out", and
 * an evaluator that returns a confident number for a scene missing half its
 * meaning is worse than no evaluator: it converts an obvious failure into a
 * hidden one. Every case here is a scene a careless composer could plausibly
 * emit, paired with the specific loss the evaluator must report.
 *
 * Scenes are built BY HAND rather than by the composer. If the composer
 * built them they would be correct, and there would be nothing to detect.
 */

import { EMPTY_WORLD_STATE } from "../lib/expression/schemas.ts";
import { applyDelta } from "../lib/expression/world/apply.ts";
import { evaluateScene } from "../lib/expression/evaluate/evaluate.ts";
import { planRepair } from "../lib/expression/evaluate/repair.ts";
import { classifyIntent } from "../lib/expression/intent/classify.ts";
import { planExpression } from "../lib/expression/planner/plan.ts";
import { compose } from "../lib/expression/compose/compose.ts";

let pass = 0;
const failures = [];
const check = (name, condition, detail = "") => {
  if (condition) pass += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
};
const section = (title) => console.log(`\n── ${title}`);

/** Builds a world from one delta, the same way the pipeline would. */
function worldOf(delta) {
  return applyDelta(EMPTY_WORLD_STATE, { claims: [], ...delta }, 0).world;
}

const obj = (entityId, x, y, extra = {}) => ({
  id: `o-${entityId}`,
  entityId,
  regionId: `r-${entityId}`,
  primitive: "node",
  label: entityId,
  x,
  y,
  w: 200,
  h: 72,
  weight: 1,
  ...extra,
});

const arrow = (relationId, from, to, points, extra = {}) => ({
  id: `k-${relationId}`,
  relationId,
  fromObjectId: `o-${from}`,
  toObjectId: `o-${to}`,
  style: "arrow",
  points,
  ...extra,
});

const scene = (objects, connectors = []) => ({
  objects,
  connectors,
  width: 900,
  height: 900,
});

// ════════════════════════════════════ 1. a dropped link in a chain

section("a causal chain drawn one link short");

{
  // A causes B causes C. The scene draws only A -> B.
  const world = worldOf({
    entities: [
      { id: "a", type: "event", label: "a" },
      { id: "b", type: "event", label: "b" },
      { id: "c", type: "event", label: "c" },
    ],
    relations: [
      { id: "r1", source: "a", type: "causes", target: "b" },
      { id: "r2", source: "b", type: "causes", target: "c" },
    ],
    interpretation: "",
  });

  const broken = scene(
    [obj("a", 0, 0), obj("b", 0, 200), obj("c", 0, 400)],
    [arrow("a-causes-b", "a", "b", [[100, 72], [100, 200]])],
  );
  const evaluation = evaluateScene(world, broken);

  check(
    "the missing link is reported",
    evaluation.problems.some((p) => p.type === "missing_relation" && p.relationId === "b-causes-c"),
    JSON.stringify(evaluation.problems.map((p) => `${p.type}:${p.relationId ?? ""}`)),
  );
  check("causal preservation is exactly one half", evaluation.preservation.causal.score === 0.5, String(evaluation.preservation.causal.score));
  check("and it names which link was lost", evaluation.preservation.causal.lost.some((l) => l.includes("b") && l.includes("c")), evaluation.preservation.causal.lost.join("; "));
  check("the headline score drops below the repair threshold", evaluation.semanticPreservation < 0.85, String(evaluation.semanticPreservation));
  check("repair is requested", evaluation.repairRequired);

  // The whole chain drawn correctly must NOT be reported — an evaluator that
  // fires on good output is as useless as one that never fires.
  // The head carries weight 2, as the composer's emphasis pass would give it.
  // A hand-built scene with uniform weights is legitimately flagged `no_focus`,
  // which is the evaluator being right rather than the fixture being correct.
  const whole = scene(
    [obj("a", 0, 0, { weight: 2 }), obj("b", 0, 200), obj("c", 0, 400)],
    [
      arrow("a-causes-b", "a", "b", [[100, 72], [100, 200]]),
      arrow("b-causes-c", "b", "c", [[100, 272], [100, 400]]),
    ],
  );
  const clean = evaluateScene(world, whole);
  check("the complete chain reports nothing", !clean.problems.length && clean.semanticPreservation === 1, `${clean.semanticPreservation} ${JSON.stringify(clean.problems)}`);
}

// ═══════════════════════════ 2. a relationship with no visible relation

section("two people near each other with nothing said between them");

{
  // Mariam is Kenny's mother. The scene shows both, adjacent, unconnected.
  const world = worldOf({
    entities: [
      { id: "kenny", type: "person", label: "Kenny" },
      { id: "mariam", type: "person", label: "Mariam" },
    ],
    relations: [{ id: "r1", source: "mariam", type: "role_of", target: "kenny", role: "mother" }],
    interpretation: "",
  });

  const adjacent = scene([obj("kenny", 0, 0, { primitive: "figure" }), obj("mariam", 300, 0, { primitive: "figure" })]);
  const evaluation = evaluateScene(world, adjacent);

  check(
    "proximity alone is reported as ambiguous",
    evaluation.problems.some((p) => p.type === "ambiguous_relation"),
    JSON.stringify(evaluation.problems.map((p) => p.type)),
  );
  check(
    "the ambiguity names the role that cannot be read",
    evaluation.problems.some((p) => p.type === "ambiguous_relation" && p.detail.includes("mother")),
  );
  check("repair is requested", evaluation.repairRequired);

  // An unlabelled LINE is still not enough: it says they are connected, not
  // that one is the other's mother.
  const unlabelled = scene(
    [obj("kenny", 0, 0, { primitive: "figure" }), obj("mariam", 300, 0, { primitive: "figure" })],
    [{ id: "k-1", relationId: "mariam-role_of-kenny", fromObjectId: "o-mariam", toObjectId: "o-kenny", style: "line", points: [[300, 36], [200, 36]] }],
  );
  const stillAmbiguous = evaluateScene(world, unlabelled);
  check(
    "an unlabelled line is still ambiguous",
    stillAmbiguous.problems.some((p) => p.type === "ambiguous_relation"),
    JSON.stringify(stillAmbiguous.problems.map((p) => p.type)),
  );
  check("and repair proposes writing the role down", planRepair(stillAmbiguous, { grammar: "scene", intent: "introduce", regions: [], connections: [{ id: "c1", fromRegionId: "r-mariam", toRegionId: "r-kenny", relationId: "mariam-role_of-kenny", kind: "link" }], emphasis: [], reason: "" }, world).steps.some((s) => s.action === "label_connector"));

  // Labelled: the role is readable, so nothing should be reported.
  const labelled = scene(
    [obj("kenny", 0, 0, { primitive: "figure" }), obj("mariam", 300, 0, { primitive: "figure" })],
    [{ id: "k-1", relationId: "mariam-role_of-kenny", fromObjectId: "o-mariam", toObjectId: "o-kenny", style: "line", label: "mother", points: [[300, 36], [200, 36]] }],
  );
  check("a labelled relation is accepted", !evaluateScene(world, labelled).problems.some((p) => p.type === "ambiguous_relation"));
}

// ═════════════════════════════════════════ 3. half of a trade-off

section("a trade-off drawn as a one-sided win");

{
  // Plan A costs MORE and is faster. A scene that shows only the advantage
  // has turned a trade-off into an endorsement.
  const world = worldOf({
    entities: [
      { id: "a", type: "concept", label: "Plan A" },
      { id: "b", type: "concept", label: "Plan B" },
      { id: "cost", type: "concept", label: "cost" },
      { id: "speed", type: "concept", label: "speed" },
    ],
    relations: [
      { id: "r1", source: "a", type: "greater_than", target: "b", magnitude: 2 },
      { id: "r2", source: "a", type: "has_property", target: "speed" },
      { id: "r3", source: "a", type: "has_property", target: "cost" },
    ],
    interpretation: "",
  });

  // Only the speed advantage is drawn; the cost is nowhere.
  const oneSided = scene(
    [obj("a", 0, 0, { weight: 2 }), obj("b", 300, 0), obj("speed", 0, 200)],
    [{ id: "k-1", relationId: "plan-a-has_property-speed", fromObjectId: "o-a", toObjectId: "o-speed", style: "line", points: [[100, 72], [100, 200]] }],
  );
  const evaluation = evaluateScene(world, oneSided);

  check(
    "the omitted half of the trade-off is reported",
    evaluation.problems.some((p) => p.type === "missing_entity") || evaluation.preservation.entity.score < 1,
    `entity ${evaluation.preservation.entity.score}; ${JSON.stringify(evaluation.problems.map((p) => p.type))}`,
  );
  check(
    "the cost is named as what went missing",
    evaluation.preservation.entity.lost.some((l) => l.includes("cost")),
    evaluation.preservation.entity.lost.join("; "),
  );
  check("the headline reflects the loss", evaluation.semanticPreservation < 0.85, String(evaluation.semanticPreservation));
}

// ═══════════════════════════════════ 4. polarity: a negation drawn bare

section("a negation drawn as a bare arrow");

{
  // "Rest prevents burnout" drawn as an unlabelled arrow is indistinguishable
  // from "rest causes burnout" — the picture states the opposite claim.
  const world = worldOf({
    entities: [
      { id: "rest", type: "concept", label: "rest" },
      { id: "burnout", type: "state", label: "burnout" },
    ],
    relations: [{ id: "r1", source: "rest", type: "prevents", target: "burnout" }],
    interpretation: "",
  });

  const bare = scene(
    [obj("rest", 0, 0), obj("burnout", 0, 200)],
    [arrow("rest-prevents-burnout", "rest", "burnout", [[100, 72], [100, 200]])],
  );
  const evaluation = evaluateScene(world, bare);
  check("polarity is scored as lost", evaluation.preservation.polarity.score === 0, String(evaluation.preservation.polarity.score));
  check(
    "and the reason says it reads as its own opposite",
    evaluation.preservation.polarity.lost.some((l) => l.includes("opposite")),
    evaluation.preservation.polarity.lost.join("; "),
  );

  const labelled = scene(
    [obj("rest", 0, 0), obj("burnout", 0, 200)],
    [arrow("rest-prevents-burnout", "rest", "burnout", [[100, 72], [100, 200]], { label: "prevents" })],
  );
  check("a labelled negation preserves polarity", evaluateScene(world, labelled).preservation.polarity.score === 1);
}

// ══════════════════════════════════ 5. ordering: a sequence drawn backwards

section("a sequence drawn in the wrong order");

{
  const world = worldOf({
    entities: [
      { id: "one", type: "action", label: "first" },
      { id: "two", type: "action", label: "second" },
    ],
    relations: [{ id: "r1", source: "one", type: "precedes", target: "two", step: 0 }],
    interpretation: "",
  });

  // Every relation is drawn, correctly, with an arrow — and the steps are
  // stacked in the wrong order. Only the ordering dimension can see this.
  const backwards = scene(
    [obj("first", 0, 400), obj("second", 0, 0)],
    [arrow("first-precedes-second", "first", "second", [[100, 400], [100, 72]])],
  );
  const evaluation = evaluateScene(world, backwards);
  check("ordering is scored as lost", evaluation.preservation.ordering.score === 0, String(evaluation.preservation.ordering.score));
  check("while the relation itself still reads fine", evaluation.preservation.relation.score === 1);
  check(
    "so the report points at placement, not at the connector",
    evaluation.preservation.ordering.lost.some((l) => l.includes("placed before")),
    evaluation.preservation.ordering.lost.join("; "),
  );

  const forwards = scene(
    [obj("first", 0, 0), obj("second", 0, 400)],
    [arrow("first-precedes-second", "first", "second", [[100, 72], [100, 400]])],
  );
  check("the right order scores full marks", evaluateScene(world, forwards).preservation.ordering.score === 1);
}

// ═════════════════════════════════ 6. invented structure beats omission

section("structure nobody claimed");

{
  const world = worldOf({
    entities: [
      { id: "alpha", type: "concept", label: "alpha" },
      { id: "beta", type: "concept", label: "beta" },
    ],
    relations: [{ id: "r1", source: "alpha", type: "relates_to", target: "beta" }],
    interpretation: "",
  });

  // beta sits inside alpha, which reads as containment nobody asserted.
  const invented = scene([
    obj("alpha", 0, 0, { primitive: "container", w: 500, h: 400, weight: 2 }),
    obj("beta", 40, 60),
  ]);
  const evaluation = evaluateScene(world, invented);
  check("accidental enclosure is caught", evaluation.inventedRelations.length === 1, JSON.stringify(evaluation.inventedRelations));
  check("and is penalised as a false relation", evaluation.problems.some((p) => p.type === "false_relation" && p.severity >= 0.8));
  check("invention costs more than omission", evaluation.semanticPreservation <= 0.75, String(evaluation.semanticPreservation));
}

// ══════════════════════════════ 7. the score may never contradict itself

section("the headline agrees with the breakdown");

{
  // The specific regression: dropping an entity used to REMOVE its relations
  // from the denominator, so a scene that lost a third of its subjects scored
  // a clean 1.0. Losing content must never raise the score.
  const world = worldOf({
    entities: [
      { id: "subject", type: "concept", label: "subject" },
      { id: "x", type: "concept", label: "x" },
      { id: "y", type: "concept", label: "y" },
    ],
    relations: [
      { id: "r1", source: "x", type: "greater_than", target: "y" },
      { id: "r2", source: "x", type: "refutes", target: "subject" },
    ],
    interpretation: "",
  });

  const dropsSubject = scene(
    [obj("x", 0, 0), obj("y", 300, 0)],
    [{ id: "k-1", relationId: "x-greater_than-y", fromObjectId: "o-x", toObjectId: "o-y", style: "line", label: "more", points: [[200, 36], [300, 36]] }],
  );
  const evaluation = evaluateScene(world, dropsSubject);
  check("entity preservation registers the loss", evaluation.preservation.entity.score < 1, String(evaluation.preservation.entity.score));
  check(
    "and the headline cannot sit at 1.0 while it does",
    evaluation.semanticPreservation < 1,
    `headline ${evaluation.semanticPreservation} vs entity ${evaluation.preservation.entity.score}`,
  );

  // Generalised: for every corpus-shaped world, a severe problem must never
  // coexist with a near-perfect score.
  const severe = evaluation.problems.filter((p) => p.severity >= 0.6);
  check("a severe problem never coexists with a near-perfect score", !(severe.length && evaluation.semanticPreservation >= 0.95));
}

// ═════════════════════════════ 8. dimensions that do not apply score null

section("dimensions that do not apply are not scored as perfect");

{
  const world = worldOf({
    entities: [{ id: "solo", type: "person", label: "Solo" }],
    relations: [],
    interpretation: "",
  });
  const intent = classifyIntent(world, { entities: [], relations: [], claims: [], interpretation: "" });
  const built = compose(world, planExpression(world, intent));
  const evaluation = evaluateScene(world, built);

  check("an utterance with no numbers scores quantity as null", evaluation.preservation.quantity.score === null);
  check("an utterance with no sequence scores ordering as null", evaluation.preservation.ordering.score === null);
  check("an utterance with no negation scores polarity as null", evaluation.preservation.polarity.score === null);
  check("but the entity dimension still applies", evaluation.preservation.entity.score === 1);
  check("and null dimensions do not inflate the headline", evaluation.semanticPreservation === 1);
}

// ─────────────────────────────────────────────────────────── results

console.log(`\n${"─".repeat(64)}`);
if (!failures.length) {
  console.log(`✓ ${pass} evaluator checks passed — broken output is detected, correct output is not flagged`);
} else {
  console.log(`${pass} passed, ${failures.length} FAILED:\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exitCode = 1;
}
