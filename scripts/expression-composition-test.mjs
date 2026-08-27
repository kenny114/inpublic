/**
 * Composition Agent: one primary, one spine, attachments demoted or dropped.
 *
 *   node --no-warnings --import ./scripts/ts-register.mjs scripts/expression-composition-test.mjs
 */

import { EMPTY_WORLD_STATE, CompositionPlanSchema, ScenePlanSchema } from "../lib/expression/schemas.ts";
import { applyDelta } from "../lib/expression/world/apply.ts";
import { ExpressionSession } from "../lib/expression/pipeline.ts";
import { snapshotBoard, EMPTY_BOARD_SNAPSHOT } from "../lib/expression/clean/snapshot.ts";
import { planComposition, shouldCompose } from "../lib/expression/composition/plan.ts";
import { applyCompositionToPlan, constrainCompositionScene } from "../lib/expression/composition/apply.ts";
import { classifyIntent } from "../lib/expression/intent/classify.ts";
import { planExpression } from "../lib/expression/planner/plan.ts";
import { compose } from "../lib/expression/compose/compose.ts";

let pass = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) pass += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

function section(title) {
  console.log(`\n── ${title}`);
}

function worldFrom(delta, seq = 0, prev = EMPTY_WORLD_STATE) {
  return applyDelta(prev, delta, seq);
}

function byLabel(world, label) {
  const needle = label.toLowerCase();
  return world.entities.find((e) => e.label.toLowerCase() === needle || e.id === needle);
}

function idOf(world, label) {
  return byLabel(world, label)?.id;
}

const STARTUP_FAMILY = {
  entities: [
    { id: "kenny", type: "person", label: "Kenny" },
    { id: "startup", type: "concept", label: "startup" },
    { id: "life", type: "concept", label: "interesting life" },
    { id: "family", type: "group", label: "family" },
  ],
  relations: [
    { id: "r1", source: "kenny", type: "wants", target: "startup" },
    { id: "r2", source: "startup", type: "enables", target: "life" },
    { id: "r3", source: "kenny", type: "wants", target: "family" },
  ],
  claims: [],
  interpretation: "Kenny wants a startup to fund an interesting life and take care of family.",
  topicEntityId: "kenny",
};

section("contracts");

{
  check("empty composition plan validates", CompositionPlanSchema.safeParse({
    spine: [],
    allowed: [],
    demote: [],
    remove: [],
    reason: "nothing to compose",
  }).success);
}

section("startup funds a life: one spine, family demoted");

{
  const applied = worldFrom(STARTUP_FAMILY);
  const kenny = idOf(applied.world, "Kenny");
  const startup = idOf(applied.world, "startup");
  const life = idOf(applied.world, "interesting life");
  const family = idOf(applied.world, "family");
  const composition = planComposition({
    snapshot: EMPTY_BOARD_SNAPSHOT,
    delta: STARTUP_FAMILY,
    world: applied.world,
    idMap: applied.idMap,
    newEntityIds: applied.world.entities.map((e) => e.id),
  });

  check("composition plan validates", CompositionPlanSchema.safeParse(composition).success, JSON.stringify(CompositionPlanSchema.safeParse(composition).error?.issues?.[0]));
  check("exactly one primary — the person who wants", composition.primaryId === kenny, composition.primaryId);
  check(
    "spine is Kenny → startup → interesting life",
    composition.spine.length === 2 &&
      composition.spine[0].from === kenny &&
      composition.spine[0].to === startup &&
      composition.spine[1].from === startup &&
      composition.spine[1].to === life,
    JSON.stringify(composition.spine),
  );
  check("spine labels the wants hop", composition.spine[0]?.label === "wants", composition.spine[0]?.label);
  check("spine labels the enables hop", composition.spine[1]?.label === "enables", composition.spine[1]?.label);
  check("family is allowed to attach", composition.allowed.includes(family), composition.allowed.join(","));
  check("family is demoted, not on the spine", composition.demote.includes(family) && !composition.spine.some((e) => e.from === family || e.to === family), composition.demote.join(","));
  check("spine nodes are not demoted", !composition.demote.includes(kenny) && !composition.demote.includes(startup) && !composition.demote.includes(life));
  check("family is not removed", !composition.remove.includes(family));
}

section("pipeline: the scene obeys the story");

{
  const session = new ExpressionSession({ extract: async () => ({ entities: [], relations: [], claims: [], interpretation: "" }) });
  const trace = await session.ingestDelta(
    { id: "t0", source: "human_text", text: "I want to build a startup to fund an interesting life and take care of my family.", seq: 0 },
    STARTUP_FAMILY,
  );
  const kenny = idOf(trace.world, "Kenny");
  const startup = idOf(trace.world, "startup");
  const life = idOf(trace.world, "interesting life");
  const family = idOf(trace.world, "family");
  const byEntity = new Map(trace.scene.objects.filter((o) => o.entityId).map((o) => [o.entityId, o]));

  check("settled run produced a composition plan", Boolean(trace.composition?.primaryId), JSON.stringify(trace.composition));
  check("clean keep is a subset of composition allowed", (trace.clean?.keep ?? []).every((id) => trace.composition.allowed.includes(id)), `${trace.clean?.keep} vs ${trace.composition?.allowed}`);
  check("clean primary matches composition", trace.clean?.primaryId === trace.composition?.primaryId, `${trace.clean?.primaryId} vs ${trace.composition?.primaryId}`);
  check("scene validates", ScenePlanSchema.safeParse(trace.scene).success);
  check("Kenny is the dominant node", byEntity.get(kenny)?.weight === 3, [...byEntity.values()].map((o) => `${o.label}:${o.weight}`).join(", "));
  check("exactly one dominant node", trace.scene.objects.filter((o) => o.weight >= 3).length === 1);
  check("family is on the board but smaller than the spine", Boolean(byEntity.get(family)) && byEntity.get(family).weight < (byEntity.get(startup)?.weight ?? 9) && byEntity.get(family).weight < (byEntity.get(kenny)?.weight ?? 9), `family=${byEntity.get(family)?.weight} startup=${byEntity.get(startup)?.weight}`);
  check("family is periphery", byEntity.get(family)?.weight === 0, String(byEntity.get(family)?.weight));
  check(
    "the drawn path includes Kenny → startup → life",
    Boolean(byEntity.get(kenny) && byEntity.get(startup) && byEntity.get(life)),
    trace.scene.objects.map((o) => o.label).join(", "),
  );
  const entityOf = new Map(trace.scene.objects.filter((o) => o.entityId).map((o) => [o.id, o.entityId]));
  const pairs = trace.scene.connectors.map((c) => `${entityOf.get(c.fromObjectId)}->${entityOf.get(c.toObjectId)}`);
  check("spine connectors are drawn", pairs.some((p) => p === `${kenny}->${startup}`) && pairs.some((p) => p === `${startup}->${life}`), pairs.join("  "));
  check("grammar is a directed flow", ["cause_effect", "process", "sequence"].includes(trace.plan.grammar), trace.plan.grammar);
}

section("continuity: the previous primary stays unless the thought shifts");

{
  const session = new ExpressionSession({ extract: async () => ({ entities: [], relations: [], claims: [], interpretation: "" }) });
  const first = await session.ingestDelta(
    { id: "c0", source: "human_text", text: "I want to build a startup.", seq: 0 },
    {
      entities: [
        { id: "kenny", type: "person", label: "Kenny" },
        { id: "startup", type: "concept", label: "startup" },
      ],
      relations: [{ id: "r1", source: "kenny", type: "wants", target: "startup" }],
      claims: [],
      interpretation: "Kenny wants a startup.",
      topicEntityId: "kenny",
    },
  );
  const second = await session.ingestDelta(
    { id: "c1", source: "human_text", text: "to fund an interesting life and take care of my family.", seq: 1 },
    {
      entities: [
        { id: "startup", type: "concept", label: "startup" },
        { id: "life", type: "concept", label: "interesting life" },
        { id: "family", type: "group", label: "family" },
      ],
      relations: [
        { id: "r2", source: "startup", type: "enables", target: "life" },
        { id: "r3", source: "kenny", type: "wants", target: "family" },
      ],
      claims: [],
      interpretation: "The startup funds an interesting life; Kenny also takes care of family.",
    },
  );
  const kenny = idOf(second.world, "Kenny");
  const startup = idOf(second.world, "startup");
  const life = idOf(second.world, "interesting life");
  const family = idOf(second.world, "family");

  check("first thought names Kenny as primary", first.composition?.primaryId === kenny, first.composition?.primaryId);
  check("second thought keeps Kenny as primary", second.composition?.primaryId === kenny, second.composition?.primaryId);
  check(
    "second thought extends the spine through startup to life",
    second.composition.spine.some((e) => e.from === kenny && e.to === startup) &&
      second.composition.spine.some((e) => e.from === startup && e.to === life),
    JSON.stringify(second.composition.spine),
  );
  check("family is still demoted after the second thought", second.composition.demote.includes(family), second.composition.demote.join(","));
}

section("topic shift: a new chain can take the board");

{
  const session = new ExpressionSession({ extract: async () => ({ entities: [], relations: [], claims: [], interpretation: "" }) });
  await session.ingestDelta(
    { id: "s0", source: "human_text", text: "Rain causes flooding.", seq: 0 },
    {
      entities: [
        { id: "rain", type: "event", label: "rain" },
        { id: "flood", type: "event", label: "flooding" },
      ],
      relations: [{ id: "r1", source: "rain", type: "causes", target: "flood" }],
      claims: [],
      interpretation: "",
    },
  );
  const shifted = await session.ingestDelta(
    { id: "s1", source: "human_text", text: "Hiring is slow because the pipeline is empty.", seq: 1 },
    {
      entities: [
        { id: "pipeline", type: "concept", label: "empty pipeline" },
        { id: "hiring", type: "state", label: "slow hiring" },
      ],
      relations: [{ id: "r2", source: "pipeline", type: "causes", target: "hiring" }],
      claims: [],
      interpretation: "",
    },
  );
  const rain = idOf(shifted.world, "rain");
  const pipeline = idOf(shifted.world, "empty pipeline");
  const hiring = idOf(shifted.world, "slow hiring");
  check("a disconnected new chain does not keep the old primary", shifted.composition.primaryId !== rain, shifted.composition.primaryId);
  check(
    "the new spine is the new chain",
    shifted.composition.spine.some((e) => e.from === pipeline && e.to === hiring) ||
      shifted.composition.allowed.includes(pipeline) && shifted.composition.primaryId === pipeline,
    JSON.stringify(shifted.composition),
  );
  check("the old story is not kept as an equal", !shifted.composition.allowed.includes(rain) || shifted.composition.demote.includes(rain) || shifted.composition.remove.includes(rain), shifted.composition.allowed.join(","));
}

section("apply: plan and scene cannot keep what composition dropped");

{
  const applied = worldFrom({
    entities: [
      { id: "a", type: "event", label: "rain" },
      { id: "b", type: "event", label: "flood" },
      { id: "c", type: "concept", label: "old note" },
    ],
    relations: [
      { id: "r1", source: "a", type: "causes", target: "b" },
      { id: "r2", source: "a", type: "relates_to", target: "c" },
    ],
    claims: [],
    interpretation: "",
  });
  const intent = classifyIntent(applied.world, { entities: [], relations: [], claims: [], interpretation: "" });
  const raw = planExpression(applied.world, intent);
  const composition = {
    primaryId: "rain",
    spine: [{ from: "rain", to: "flood", label: "causes" }],
    allowed: ["rain", "flood"],
    demote: [],
    remove: ["old-note"],
    reason: "test",
  };
  const plan = applyCompositionToPlan(raw, composition, applied.world);
  check(
    "plan keeps only allowed entities",
    plan.regions.filter((r) => r.entityId).every((r) => composition.allowed.includes(r.entityId)),
    plan.regions.map((r) => r.entityId).join(","),
  );
  check("plan names the composition primary", plan.focusEntityId === "rain", plan.focusEntityId);
  const scene = constrainCompositionScene(compose(applied.world, plan), composition);
  check("scene has no rejected entities", scene.objects.filter((o) => o.entityId).every((o) => composition.allowed.includes(o.entityId)));
  check("exactly one dominant node after apply", scene.objects.filter((o) => o.weight >= 3).length === 1);
}

section("cadence: settled composes, reflex does not");

{
  const session = new ExpressionSession({ extract: async () => ({ entities: [], relations: [], claims: [], interpretation: "" }) });
  const reflex = await session.ingestDelta(
    { id: "reflex-0", source: "human_speech", text: "I", seq: 0 },
    { entities: [{ id: "i", type: "person", label: "I" }], relations: [], claims: [], interpretation: "I" },
    { contextless: true },
  );
  check("reflex does not run composition", reflex.composition === null);
  check(
    "anticipation on a tidy board without a story is skipped",
    shouldCompose({ contextless: true, segmentId: "anticipate-1", snapshot: EMPTY_BOARD_SNAPSHOT }) === false,
  );
  check(
    "anticipation with a directed story is composed",
    shouldCompose({
      contextless: true,
      segmentId: "anticipate-1",
      snapshot: EMPTY_BOARD_SNAPSHOT,
      delta: {
        entities: [
          { id: "a", type: "concept", label: "costs" },
          { id: "b", type: "action", label: "cut" },
          { id: "c", type: "state", label: "slow" },
        ],
        relations: [
          { id: "r1", source: "a", type: "causes", target: "b" },
          { id: "r2", source: "b", type: "causes", target: "c" },
        ],
        claims: [],
        interpretation: "",
      },
    }) === true,
  );
  check(
    "settled always composes",
    shouldCompose({ contextless: false, segmentId: "t1", snapshot: EMPTY_BOARD_SNAPSHOT }) === true,
  );
}

if (failures.length) {
  console.log(`\n${failures.length} failed, ${pass} passed`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\n${pass} passed`);
