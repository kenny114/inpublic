/**
 * Presentation Agent + tighter Clean + Draw quality gates.
 *
 *   node --no-warnings --import ./scripts/ts-register.mjs scripts/expression-presentation-test.mjs
 */

import { EMPTY_WORLD_STATE, PresentationPlanSchema, ScenePlanSchema } from "../lib/expression/schemas.ts";
import { applyDelta } from "../lib/expression/world/apply.ts";
import { ExpressionSession } from "../lib/expression/pipeline.ts";
import { EMPTY_BOARD_SNAPSHOT } from "../lib/expression/clean/snapshot.ts";
import { planClean, PREFERRED_CLEAN_NODES, MAX_CLEAN_NODES } from "../lib/expression/clean/plan.ts";
import { planComposition } from "../lib/expression/composition/plan.ts";
import { planPresentation } from "../lib/expression/presentation/plan.ts";
import { constrainPresentationScene } from "../lib/expression/presentation/apply.ts";
import { classifyIntent } from "../lib/expression/intent/classify.ts";
import { sketchLooksAbstract, sketchRejectionReason, MAX_SKETCH_STROKES } from "../lib/expression/draw/schemas.ts";

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

function idOf(world, label) {
  const needle = label.toLowerCase();
  return world.entities.find((e) => e.label.toLowerCase() === needle || e.id === needle)?.id;
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
  check(
    "presentation plan validates",
    PresentationPlanSchema.safeParse({
      layout: "vertical-spine",
      emphasis: { primary: "heavy", support: "medium", periphery: "light" },
      simplifications: [],
      notes: "test",
    }).success,
  );
}

section("startup story: one centre, one flow, family light");

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

  check("settled run produced a presentation plan", Boolean(trace.presentation?.layout), JSON.stringify(trace.presentation));
  check(
    "layout is a directed spine",
    trace.presentation?.layout === "vertical-spine" || trace.presentation?.layout === "left-to-right",
    trace.presentation?.layout,
  );
  check("exactly one heavy centre", trace.scene.objects.filter((o) => o.weight >= 3).length === 1, trace.scene.objects.map((o) => `${o.label}:${o.weight}`).join(", "));
  check("Kenny is heavy", byEntity.get(kenny)?.weight === 3, String(byEntity.get(kenny)?.weight));
  check("family is light, not a peer", byEntity.get(family)?.weight === 0, String(byEntity.get(family)?.weight));
  check("startup and life remain on the board", Boolean(byEntity.get(startup) && byEntity.get(life)));
  check("scene validates", ScenePlanSchema.safeParse(trace.scene).success);
  check(
    "clean keep is at most the hard cap",
    (trace.clean?.keep.length ?? 0) <= MAX_CLEAN_NODES,
    String(trace.clean?.keep.length),
  );
  const ys = [kenny, startup, life].map((id) => byEntity.get(id)?.y).filter((y) => y !== undefined);
  const xs = [kenny, startup, life].map((id) => byEntity.get(id)?.x).filter((x) => x !== undefined);
  const vertical = Math.max(...ys) - Math.min(...ys) > Math.max(...xs) - Math.min(...xs);
  const horizontal = Math.max(...xs) - Math.min(...xs) > Math.max(...ys) - Math.min(...ys);
  check(
    "the spine is a readable path, not a pile",
    trace.presentation.layout === "vertical-spine" ? vertical : horizontal || vertical,
    `layout=${trace.presentation.layout} dx=${Math.max(...xs) - Math.min(...xs)} dy=${Math.max(...ys) - Math.min(...ys)}`,
  );
}

section("sequence reads left to right");

{
  const session = new ExpressionSession({ extract: async () => ({ entities: [], relations: [], claims: [], interpretation: "" }) });
  const trace = await session.ingestDelta(
    { id: "s0", source: "human_text", text: "First we sign in, then we load projects, then we open the dashboard.", seq: 0 },
    {
      entities: [
        { id: "s1", type: "action", label: "sign in" },
        { id: "s2", type: "action", label: "load projects" },
        { id: "s3", type: "action", label: "open dashboard" },
      ],
      relations: [
        { id: "r1", source: "s1", type: "precedes", target: "s2", step: 0 },
        { id: "r2", source: "s2", type: "precedes", target: "s3", step: 1 },
      ],
      claims: [],
      interpretation: "",
    },
  );
  check("sequence chooses left-to-right", trace.presentation?.layout === "left-to-right", trace.presentation?.layout);
  const byEntity = new Map(trace.scene.objects.filter((o) => o.entityId).map((o) => [o.entityId, o]));
  const a = byEntity.get("sign-in") ?? [...byEntity.values()].find((o) => /sign/i.test(o.label ?? ""));
  const b = byEntity.get("load-projects") ?? [...byEntity.values()].find((o) => /load/i.test(o.label ?? ""));
  const c = byEntity.get("open-dashboard") ?? [...byEntity.values()].find((o) => /dashboard/i.test(o.label ?? ""));
  check("three steps are drawn", Boolean(a && b && c), [...byEntity.values()].map((o) => o.label).join(", "));
  if (a && b && c) {
    check("steps advance to the right", a.x < b.x && b.x < c.x, `${a.x} ${b.x} ${c.x}`);
  }
}

section("hierarchy stays a tree");

{
  const session = new ExpressionSession({ extract: async () => ({ entities: [], relations: [], claims: [], interpretation: "" }) });
  const trace = await session.ingestDelta(
    { id: "h0", source: "human_text", text: "The company contains engineering, sales and marketing.", seq: 0 },
    {
      entities: [
        { id: "company", type: "group", label: "the company" },
        { id: "eng", type: "group", label: "engineering" },
        { id: "sales", type: "group", label: "sales" },
        { id: "marketing", type: "group", label: "marketing" },
      ],
      relations: [
        { id: "r1", source: "company", type: "contains", target: "eng" },
        { id: "r2", source: "company", type: "contains", target: "sales" },
        { id: "r3", source: "company", type: "contains", target: "marketing" },
      ],
      claims: [],
      topicEntityId: "company",
      interpretation: "",
    },
  );
  check("containment chooses hierarchy", trace.presentation?.layout === "hierarchy", trace.presentation?.layout);
  check("the company remains on the board", trace.scene.objects.some((o) => /company/i.test(o.label ?? "")));
}

section("single-figure: I and Kenny are not two people");

{
  const session = new ExpressionSession({ extract: async () => ({ entities: [], relations: [], claims: [], interpretation: "" }) });
  const trace = await session.ingestDelta(
    { id: "f0", source: "human_text", text: "I, Kenny, want a startup.", seq: 0 },
    {
      entities: [
        { id: "i", type: "person", label: "I" },
        { id: "kenny", type: "person", label: "Kenny" },
        { id: "startup", type: "concept", label: "startup" },
      ],
      relations: [
        { id: "r1", source: "i", type: "wants", target: "startup" },
        { id: "r2", source: "kenny", type: "wants", target: "startup" },
      ],
      claims: [],
      interpretation: "",
    },
  );
  const figures = trace.scene.objects.filter((o) => o.primitive === "figure");
  check("at most one figure is drawn", figures.length <= 1, figures.map((o) => o.label).join(", "));
}

section("clean prefers fewer, stronger marks");

{
  const applied = worldFrom({
    entities: [
      { id: "i", type: "person", label: "I" },
      { id: "a", type: "concept", label: "startup" },
      { id: "b", type: "concept", label: "house" },
      { id: "c", type: "concept", label: "car" },
      { id: "d", type: "concept", label: "boat" },
    ],
    relations: [
      { id: "r1", source: "i", type: "wants", target: "a" },
      { id: "r2", source: "i", type: "wants", target: "b" },
      { id: "r3", source: "i", type: "wants", target: "c" },
      { id: "r4", source: "i", type: "wants", target: "d" },
    ],
    claims: [],
    interpretation: "",
  });
  const composition = planComposition({
    snapshot: EMPTY_BOARD_SNAPSHOT,
    delta: {
      entities: applied.world.entities.map((e) => ({ id: e.id, type: e.type, label: e.label })),
      relations: applied.world.relations.map((r) => ({ id: r.id, source: r.source, type: r.type, target: r.target })),
      claims: [],
      interpretation: "",
    },
    world: applied.world,
    idMap: applied.idMap,
    newEntityIds: applied.world.entities.map((e) => e.id),
  });
  const clean = planClean({
    snapshot: {
      primary: { id: "old-note", label: "old note", size: 200 },
      nodes: [
        { id: "old-note", label: "old note", role: "primary", size: 200 },
        { id: "i", label: "I", role: "support", size: 80 },
      ],
      connectors: [],
      nodeCount: 2,
      connectorCount: 0,
    },
    delta: {
      entities: applied.world.entities.map((e) => ({ id: e.id, type: e.type, label: e.label })),
      relations: applied.world.relations.map((r) => ({ id: r.id, source: r.source, type: r.type, target: r.target })),
      claims: [],
      interpretation: "",
    },
    world: applied.world,
    idMap: applied.idMap,
    newEntityIds: applied.world.entities.map((e) => e.id),
    composition,
  });
  check("does not keep the leftover competing centre", !clean.keep.includes("old-note"), clean.keep.join(","));
  check("stays within the hard cap", clean.keep.length <= MAX_CLEAN_NODES, String(clean.keep.length));
  check("preferred occupancy is 4", PREFERRED_CLEAN_NODES === 4);
  const intent = classifyIntent(applied.world, { entities: [], relations: [], claims: [], interpretation: "" });
  const presentation = planPresentation({
    snapshot: EMPTY_BOARD_SNAPSHOT,
    world: applied.world,
    intent,
    composition,
    clean,
  });
  check("presentation validates", PresentationPlanSchema.safeParse(presentation).success);
  check("off-spine fans are simplified or demoted, not equal centres", presentation.layout === "vertical-spine" || presentation.layout === "central-primary" || presentation.layout === "left-to-right");
}

section("draw quality: busy sketches fall back");

{
  check("the stroke cap is 20", MAX_SKETCH_STROKES === 20);
  check(
    "21 strokes are rejected",
    sketchLooksAbstract({
      strokes: Array.from({ length: 21 }, (_, i) => ({ points: [[10, 10 + i], [90, 10 + i]] })),
    }),
  );
  check(
    "a 12-stroke contour is kept",
    !sketchLooksAbstract({
      strokes: Array.from({ length: 12 }, (_, i) => ({
        points: [[15, 15 + i * 6], [85, 15 + i * 6]],
      })),
    }),
  );
  check("rejection names the cap", sketchRejectionReason({
    strokes: Array.from({ length: 21 }, (_, i) => ({ points: [[10, 10 + i], [90, 10 + i]] })),
  })?.includes("20") === true);
}

section("presentation constrain never invents a second centre");

{
  const scene = {
    objects: [
      { id: "o-a", entityId: "a", regionId: "r-a", primitive: "node", label: "A", x: 0, y: 0, w: 80, h: 40, weight: 3 },
      { id: "o-b", entityId: "b", regionId: "r-b", primitive: "node", label: "B", x: 100, y: 0, w: 80, h: 40, weight: 3 },
    ],
    connectors: [],
    width: 200,
    height: 40,
  };
  const next = constrainPresentationScene(
    scene,
    {
      layout: "vertical-spine",
      emphasis: { primary: "heavy", support: "medium", periphery: "light" },
      simplifications: [],
      notes: "test",
    },
    { primaryId: "a", composition: { spine: [{ from: "a", to: "b" }], allowed: ["a", "b"], demote: [], remove: [], reason: "t" } },
  );
  check("exactly one heavy after constrain", next.objects.filter((o) => o.weight >= 3).length === 1);
  check("the named primary stays heavy", next.objects.find((o) => o.entityId === "a")?.weight === 3);
}

if (failures.length) {
  console.log(`\n${failures.length} failed, ${pass} passed`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\n${pass} passed`);
