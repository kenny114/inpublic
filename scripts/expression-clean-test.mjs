/**
 * Clean Agent: occupancy, one primary, relation discipline, renderer gate.
 *
 *   node --no-warnings --import ./scripts/ts-register.mjs scripts/expression-clean-test.mjs
 */

import { EMPTY_WORLD_STATE, CleanPlanSchema, ScenePlanSchema } from "../lib/expression/schemas.ts";
import { applyDelta } from "../lib/expression/world/apply.ts";
import { classifyIntent } from "../lib/expression/intent/classify.ts";
import { planExpression } from "../lib/expression/planner/plan.ts";
import { compose } from "../lib/expression/compose/compose.ts";
import { diffScenes } from "../lib/expression/render/core.ts";
import { ExpressionSession } from "../lib/expression/pipeline.ts";
import { snapshotBoard, EMPTY_BOARD_SNAPSHOT } from "../lib/expression/clean/snapshot.ts";
import { planClean, shouldPoliceVisual, MAX_CLEAN_NODES } from "../lib/expression/clean/plan.ts";
import { applyCleanToPlan, constrainScene, constrainPatch } from "../lib/expression/clean/apply.ts";

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

section("snapshot");

{
  const empty = snapshotBoard(null);
  check("empty scene is an empty snapshot", empty.nodeCount === 0 && empty.primary === null);
  check("empty snapshot is the exported constant shape", empty.nodes.length === EMPTY_BOARD_SNAPSHOT.nodes.length);

  const applied = worldFrom({
    entities: [
      { id: "i", type: "person", label: "I" },
      { id: "startup", type: "concept", label: "startup" },
    ],
    relations: [{ id: "r1", source: "i", type: "wants", target: "startup" }],
    claims: [],
    interpretation: "I want a startup",
  });
  const intent = classifyIntent(applied.world, { entities: [], relations: [], claims: [], interpretation: "" });
  const plan = planExpression(applied.world, intent, { newEntityIds: applied.ops.filter((o) => o.kind === "ADD_ENTITY").map((o) => o.entity.id) });
  const scene = compose(applied.world, plan);
  const snap = snapshotBoard(scene, plan.focusEntityId);
  check("snapshot node ids are entity ids", snap.nodes.every((n) => applied.world.entities.some((e) => e.id === n.id)));
  check("snapshot counts match", snap.nodeCount === snap.nodes.length && snap.connectorCount === snap.connectors.length);
  check("snapshot names a primary", Boolean(snap.primary?.id), JSON.stringify(snap.primary));
}

section("one primary, occupancy cap");

{
  const first = worldFrom({
    entities: [
      { id: "i", type: "person", label: "I" },
      { id: "a", type: "concept", label: "startup" },
      { id: "b", type: "concept", label: "funding" },
      { id: "c", type: "concept", label: "life" },
      { id: "d", type: "concept", label: "house" },
      { id: "e", type: "concept", label: "car" },
      { id: "f", type: "concept", label: "travel" },
      { id: "g", type: "concept", label: "team" },
    ],
    relations: [
      { id: "r1", source: "i", type: "wants", target: "a" },
      { id: "r2", source: "i", type: "wants", target: "b" },
      { id: "r3", source: "i", type: "wants", target: "c" },
      { id: "r4", source: "i", type: "wants", target: "d" },
      { id: "r5", source: "i", type: "wants", target: "e" },
      { id: "r6", source: "i", type: "wants", target: "f" },
      { id: "r7", source: "i", type: "wants", target: "g" },
    ],
    claims: [],
    interpretation: "I want many things",
  });
  const idMap = first.idMap;
  const snap = snapshotBoard(null);
  const clean = planClean({
    snapshot: snap,
    delta: {
      entities: first.world.entities.map((e) => ({ id: e.id, type: e.type, label: e.label })),
      relations: first.world.relations.map((r) => ({ id: r.id, source: r.source, type: r.type, target: r.target })),
      claims: [],
      interpretation: "",
    },
    world: first.world,
    idMap,
    newEntityIds: first.world.entities.map((e) => e.id),
  });
  check("clean plan validates", CleanPlanSchema.safeParse(clean).success, JSON.stringify(CleanPlanSchema.safeParse(clean).error?.issues?.[0]));
  check("at most six nodes", clean.keep.length <= MAX_CLEAN_NODES, String(clean.keep.length));
  check("exactly one primary", Boolean(clean.primaryId) && clean.keep.includes(clean.primaryId), clean.primaryId);
  check("maxNodes is 6", clean.maxNodes === 6);
}

section("distance and stale wants fans");

{
  let applied = worldFrom({
    entities: [
      { id: "i", type: "person", label: "I" },
      { id: "s", type: "concept", label: "startup" },
      { id: "f", type: "concept", label: "funding" },
    ],
    relations: [
      { id: "r1", source: "i", type: "wants", target: "s" },
      { id: "r2", source: "i", type: "wants", target: "f" },
    ],
    claims: [],
    interpretation: "I want a startup and funding",
  });
  const scene1 = compose(
    applied.world,
    planExpression(applied.world, classifyIntent(applied.world, { entities: [], relations: [], claims: [], interpretation: "" })),
  );
  applied = worldFrom(
    {
      entities: [
        { id: "s", type: "concept", label: "startup" },
        { id: "rev", type: "quantity", label: "100k" },
      ],
      relations: [{ id: "r3", source: "s", type: "has_property", target: "rev" }],
      claims: [],
      interpretation: "the startup makes 100k",
    },
    1,
    applied.world,
  );
  applied = worldFrom(
    {
      entities: [
        { id: "rev", type: "quantity", label: "100k" },
        { id: "life", type: "concept", label: "the life I want" },
      ],
      relations: [{ id: "r4", source: "rev", type: "enables", target: "life" }],
      claims: [],
      interpretation: "that funds the life I want",
    },
    2,
    applied.world,
  );

  const snap = snapshotBoard(scene1, "i");
  const clean = planClean({
    snapshot: snap,
    delta: {
      entities: [
        { id: "rev", type: "quantity", label: "100k" },
        { id: "life", type: "concept", label: "the life I want" },
      ],
      relations: [{ id: "r4", source: "rev", type: "enables", target: "life" }],
      claims: [],
      interpretation: "that funds the life I want",
    },
    world: applied.world,
    idMap: applied.idMap,
    newEntityIds: applied.ops.filter((o) => o.kind === "ADD_ENTITY").map((o) => o.entity.id),
    previousFocusId: "startup",
    focusHint: "startup",
  });

  check("primary stays the elaborated subject", clean.primaryId === "startup", clean.primaryId);
  check("1-hop current property is kept", clean.keep.some((id) => /100k|rev/.test(id)), clean.keep.join(","));
  check(
    "stale wants fan is not an allowed relation",
    !clean.allowedRelations.some((r) => r.label === "wants" && (r.to === "funding" || r.from === "funding")),
    JSON.stringify(clean.allowedRelations),
  );
  check("at most six after a growing story", clean.keep.length <= 6, clean.keep.join(","));
}

section("apply: plan, scene, patch obey the clean plan");

{
  const applied = worldFrom({
    entities: [
      { id: "a", type: "event", label: "rain" },
      { id: "b", type: "event", label: "flood" },
      { id: "c", type: "event", label: "evacuation" },
      { id: "d", type: "concept", label: "old note" },
    ],
    relations: [
      { id: "r1", source: "a", type: "causes", target: "b" },
      { id: "r2", source: "b", type: "causes", target: "c" },
      { id: "r3", source: "a", type: "relates_to", target: "d" },
    ],
    claims: [],
    interpretation: "",
  });
  const intent = classifyIntent(applied.world, { entities: [], relations: [], claims: [], interpretation: "" });
  const raw = planExpression(applied.world, intent);
  const clean = {
    primaryId: "rain",
    keep: ["rain", "flood"],
    demote: ["evacuation"],
    remove: ["old-note", "evacuation"],
    promote: ["rain"],
    allowedRelations: [{ from: "rain", to: "flood" }],
    maxNodes: 6,
    reason: "test",
  };
  const plan = applyCleanToPlan(raw, clean, applied.world);
  check("plan keeps only allowed entities", plan.regions.filter((r) => r.entityId).every((r) => clean.keep.includes(r.entityId)), plan.regions.map((r) => r.entityId).join(","));
  check("plan names the clean primary", plan.focusEntityId === "rain", plan.focusEntityId);
  check("only one emphasis, on the primary", plan.emphasis.length === 1 && plan.emphasis[0].weight === 3);
  check(
    "rejected relations are gone",
    plan.connections.every((c) => {
      const from = plan.regions.find((r) => r.id === c.fromRegionId)?.entityId;
      const to = plan.regions.find((r) => r.id === c.toRegionId)?.entityId;
      return from === "rain" && to === "flood";
    }),
    plan.connections.map((c) => c.relationId).join(","),
  );

  const scene = constrainScene(compose(applied.world, plan), clean);
  check("scene validates", ScenePlanSchema.safeParse(scene).success);
  check(
    "scene has no rejected entities",
    scene.objects.filter((o) => o.entityId).every((o) => clean.keep.includes(o.entityId)),
    scene.objects.map((o) => o.entityId).join(","),
  );
  check("exactly one dominant node", scene.objects.filter((o) => o.weight >= 3).length === 1, scene.objects.map((o) => `${o.label}:${o.weight}`).join(","));

  const prev = {
    objects: [
      { id: "o-r-old-note", entityId: "old-note", regionId: "r-old-note", primitive: "node", label: "old note", x: 0, y: 0, w: 80, h: 40, weight: 3 },
      { id: "o-r-rain", entityId: "rain", regionId: "r-rain", primitive: "node", label: "rain", x: 100, y: 0, w: 80, h: 40, weight: 1 },
    ],
    connectors: [{ id: "k-x", relationId: "r3", fromObjectId: "o-r-rain", toObjectId: "o-r-old-note", style: "line", points: [[0, 0], [1, 1]] }],
    width: 200,
    height: 80,
  };
  const rawPatch = diffScenes(prev, {
    ...scene,
    objects: [
      ...scene.objects,
      { id: "o-r-ghost", entityId: "old-note", regionId: "r-old-note", primitive: "node", label: "old note", x: 0, y: 0, w: 80, h: 40, weight: 2 },
    ],
  });
  const patch = constrainPatch(rawPatch, clean, prev);
  check("patch cannot add a rejected entity", !patch.added.some((o) => o.entityId === "old-note"), patch.added.map((o) => o.entityId).join(","));
  check("patch removes what the clean plan named", patch.removed.includes("o-r-old-note"), patch.removed.join(","));
}

section("pipeline: settled is policed, reflex is not");

{
  const session = new ExpressionSession({ extract: async () => ({ entities: [], relations: [], claims: [], interpretation: "" }) });
  const trace = await session.ingestDelta(
    { id: "t0", source: "human_text", text: "Rising costs push teams to consolidate tools.", seq: 0 },
    {
      entities: [
        { id: "costs", type: "concept", label: "rising costs" },
        { id: "consol", type: "action", label: "tool consolidation" },
        { id: "slow", type: "state", label: "slower releases" },
      ],
      relations: [
        { id: "r1", source: "costs", type: "causes", target: "consol" },
        { id: "r2", source: "consol", type: "causes", target: "slow" },
      ],
      claims: [],
      interpretation: "Rising costs drive consolidation, which slows releases.",
    },
  );
  check("settled run produced a clean plan", Boolean(trace.clean?.primaryId), JSON.stringify(trace.clean));
  check("settled scene stays within six entity nodes", trace.scene.objects.filter((o) => o.entityId).length <= 6, String(trace.scene.objects.length));
  check("settled scene has one primary-weight object", trace.scene.objects.filter((o) => o.weight >= 3).length <= 1, trace.scene.objects.map((o) => `${o.label}:${o.weight}`).join(","));
  check("board snapshot is on the trace", trace.board.nodeCount === 0, String(trace.board.nodeCount));
}

{
  const session = new ExpressionSession({ extract: async () => ({ entities: [], relations: [], claims: [], interpretation: "" }) });
  const trace = await session.ingestDelta(
    { id: "reflex-0", source: "human_speech", text: "I", seq: 0 },
    {
      entities: [{ id: "i", type: "person", label: "I" }],
      relations: [],
      claims: [],
      interpretation: "I",
    },
    { contextless: true },
  );
  check("reflex is not policed", trace.clean === null);
  check("reflex still draws", trace.scene.objects.length >= 1, String(trace.scene.objects.length));
}

{
  check(
    "anticipation on a tidy board is not policed",
    shouldPoliceVisual({ contextless: true, segmentId: "anticipate-1", snapshot: EMPTY_BOARD_SNAPSHOT }) === false,
  );
  check(
    "anticipation on an overcrowded board is policed",
    shouldPoliceVisual({
      contextless: true,
      segmentId: "anticipate-1",
      snapshot: {
        primary: { id: "a", label: "A", size: 100 },
        nodes: Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, label: `n${i}`, role: "support", size: 80 })),
        connectors: [],
        nodeCount: 8,
        connectorCount: 0,
      },
    }) === true,
  );
  check(
    "settled is always policed",
    shouldPoliceVisual({ contextless: false, segmentId: "t1", snapshot: EMPTY_BOARD_SNAPSHOT }) === true,
  );
}

section("a current chain stays whole under the cap");

{
  const session = new ExpressionSession({ extract: async () => ({ entities: [], relations: [], claims: [], interpretation: "" }) });
  await session.ingestDelta(
    { id: "s0", source: "human_text", text: "First the user signs in, then we load projects.", seq: 0 },
    {
      entities: [
        { id: "s1", type: "action", label: "sign in" },
        { id: "s2", type: "action", label: "load projects" },
      ],
      relations: [{ id: "r1", source: "s1", type: "precedes", target: "s2", step: 0 }],
      claims: [],
      interpretation: "",
    },
  );
  await session.ingestDelta(
    { id: "s1", source: "human_text", text: "Then we open the dashboard.", seq: 1 },
    {
      entities: [{ id: "s3", type: "action", label: "open dashboard" }],
      relations: [{ id: "r2", source: "load-projects", type: "precedes", target: "open-dashboard", step: 1 }],
      claims: [],
      interpretation: "",
    },
  );
  const third = await session.ingestDelta(
    { id: "s2", source: "human_text", text: "Finally we show the report.", seq: 2 },
    {
      entities: [{ id: "s4", type: "action", label: "show the report" }],
      relations: [{ id: "r3", source: "open-dashboard", type: "precedes", target: "show-the-report", step: 2 }],
      claims: [],
      interpretation: "",
    },
  );
  const labels = third.scene.objects.map((o) => o.label);
  check("a four-step sequence is still drawn whole", third.scene.objects.length === 4, labels.join(", "));
  check("the chain's original subject remains primary", third.clean.primaryId === "sign-in" || third.plan.focusEntityId === "sign-in", third.clean?.primaryId);
}

section("no competing centres across a wants list");

{
  const session = new ExpressionSession({ extract: async () => ({ entities: [], relations: [], claims: [], interpretation: "" }) });
  const wants = ["startup", "funding", "house", "car", "travel", "team", "freedom"];
  let trace = null;
  for (let i = 0; i < wants.length; i += 1) {
    const id = wants[i];
    trace = await session.ingestDelta(
      { id: `t${i}`, source: "human_text", text: `I want a ${id}`, seq: i },
      {
        entities: [
          { id: "i", type: "person", label: "I" },
          { id, type: "concept", label: id },
        ],
        relations: [{ id: `r${i}`, source: "i", type: "wants", target: id }],
        claims: [],
        interpretation: `I want a ${id}`,
      },
    );
  }
  const entityNodes = trace.scene.objects.filter((o) => o.entityId);
  check("a long wants list never exceeds six nodes", entityNodes.length <= 6, entityNodes.map((o) => o.label).join(", "));
  check("one dominant centre", entityNodes.filter((o) => o.weight >= 3).length <= 1, entityNodes.map((o) => `${o.label}:${o.weight}`).join(", "));
  check("clean plan kept at most six", trace.clean.keep.length <= 6, trace.clean.keep.join(","));
}

if (failures.length) {
  console.log(`\n${failures.length} failed, ${pass} passed`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\n${pass} passed`);
