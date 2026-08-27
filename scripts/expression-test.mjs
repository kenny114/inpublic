/**
 * The Expression Engine's offline test: every deterministic layer, plus the
 * whole pipeline over the 100-case corpus.
 *
 *   node --no-warnings --import ./scripts/ts-register.mjs scripts/expression-test.mjs
 *
 * No network and no API key: the extractor is the only non-deterministic
 * layer and the corpus supplies its output as fixtures. What is being
 * tested here is everything downstream of understanding one sentence —
 * which is where every visual decision in this system actually lives.
 *
 * The corpus assertions are deliberately about MEANING SURVIVAL rather than
 * about specific pictures. "Preservation >= threshold" and "no relation was
 * invented" hold whatever the composer does with its pixels; asserting
 * coordinates would freeze the layout and stop it from ever improving.
 */

import { WorldStateSchema, ExpressionPlanSchema, ScenePlanSchema, MeaningDeltaSchema, CleanPlanSchema, CompositionPlanSchema, PresentationPlanSchema, EMPTY_WORLD_STATE, EMPTY_CLEAN_PLAN, EMPTY_COMPOSITION_PLAN, EMPTY_PRESENTATION_PLAN } from "../lib/expression/schemas.ts";
import { applyDelta, normalizeMention, resolveMention, slugify } from "../lib/expression/world/apply.ts";
import { classifyIntent, longestPath } from "../lib/expression/intent/classify.ts";
import { planExpression } from "../lib/expression/planner/plan.ts";
import { assignVisibility } from "../lib/expression/planner/visibility.ts";
import { compose, isContinuation } from "../lib/expression/compose/compose.ts";
import { evaluateScene, recoverRelations } from "../lib/expression/evaluate/evaluate.ts";
import { planRepair } from "../lib/expression/evaluate/repair.ts";
import { diffScenes, describePatch } from "../lib/expression/render/core.ts";
import { SvgRenderer } from "../lib/expression/render/svg.ts";
import { ExpressionSession, segmentText } from "../lib/expression/pipeline.ts";
import { snapshotBoard } from "../lib/expression/clean/snapshot.ts";
import { planClean, shouldPoliceVisual, MAX_CLEAN_NODES } from "../lib/expression/clean/plan.ts";
import { applyCleanToPlan, constrainPatch } from "../lib/expression/clean/apply.ts";
import { sanitizeDelta, extractJsonObject } from "../lib/expression/meaning/extract.ts";
import { ExpressionLiveController } from "../lib/expression/live.ts";
import { reflexDelta } from "../lib/expression/fast/reflex.ts";
import { createExpressionEntry } from "../lib/expression/entry.ts";
import { createExpressTool, EXPRESS_TOOL_NAME } from "../lib/expression/tool.ts";
import { skeletonsForScene } from "../lib/canvas/excalidraw/conversion.ts";
import { planCanvasDiff, createExpressionIdentity, syncExpressionCanvas, decideExpressionOverflow } from "../lib/canvas/excalidraw/sync.ts";
import { sketchLooksAbstract, sketchRejectionReason } from "../lib/expression/draw/schemas.ts";
import { pendingSketchKeys } from "../lib/expression/draw/client.ts";
import { newPen, PAGE_H, PAGE_PAD, PAGE_W, LIVE_CAPTION_RAIL_W } from "../lib/ops.ts";
import { CORPUS, CORPUS_CATEGORIES } from "./fixtures/expression-corpus.mjs";

let pass = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) pass += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

function section(title) {
  console.log(`\n── ${title}`);
}

const svg = new SvgRenderer();

// ─────────────────────────────────────────────────────────── schemas

section("contracts");

check("empty world validates", WorldStateSchema.safeParse(EMPTY_WORLD_STATE).success);
check("empty clean plan validates", CleanPlanSchema.safeParse(EMPTY_CLEAN_PLAN).success);
check("empty composition plan validates", CompositionPlanSchema.safeParse(EMPTY_COMPOSITION_PLAN).success);
check("empty presentation plan validates", PresentationPlanSchema.safeParse(EMPTY_PRESENTATION_PLAN).success);
check(
  "a world with a dangling relation is rejected",
  !WorldStateSchema.safeParse({
    ...EMPTY_WORLD_STATE,
    entities: [{ id: "a", type: "person", label: "A", status: "active", importance: "primary", firstSeenSeq: 0, lastTouchedSeq: 0, aliases: [] }],
    relations: [{ id: "r", source: "a", type: "causes", target: "ghost", firstSeenSeq: 0, lastTouchedSeq: 0 }],
  }).success,
);
check(
  "a meaning delta carrying geometry is rejected",
  !MeaningDeltaSchema.safeParse({ entities: [{ id: "a", type: "person", label: "A", x: 10 }], relations: [], claims: [], interpretation: "" }).success,
);
check(
  "an expression plan connecting a non-existent region is rejected",
  !ExpressionPlanSchema.safeParse({
    grammar: "scene",
    intent: "describe",
    regions: [{ id: "r-a", role: "primary_subject", entityId: "a" }],
    connections: [{ id: "c", fromRegionId: "r-a", toRegionId: "r-ghost", relationId: "x", kind: "link" }],
    emphasis: [],
    reason: "",
  }).success,
);

// ───────────────────────────────────────────────────── world model

section("world model: identity and reference");

check("normalizeMention strips possessives", normalizeMention("My mother") === "mother");
check("normalizeMention strips stacked determiners", normalizeMention("the my  Family!") === "family");
check("slugify produces a legal id", /^[a-z][a-z0-9_-]*$/.test(slugify("Trinidad and Tobago")));

{
  const delta = {
    entities: [{ id: "k", type: "person", label: "Kenny Farmer" }],
    relations: [],
    claims: [],
    interpretation: "",
  };
  const first = applyDelta(EMPTY_WORLD_STATE, delta, 0);
  check("a new entity is added", first.ops.filter((o) => o.kind === "ADD_ENTITY").length === 1);
  check("the world validates after apply", WorldStateSchema.safeParse(first.world).success);

  // Same person, shorter surface form.
  const second = applyDelta(first.world, { ...delta, entities: [{ id: "m", type: "person", label: "Kenny" }] }, 1);
  check("a shorter name matches the same person", second.world.entities.length === 1, JSON.stringify(second.world.entities.map((e) => e.label)));
  check("the fuller name is kept", second.world.entities[0].label === "Kenny Farmer");

  // Pronoun.
  const third = applyDelta(second.world, { entities: [{ id: "p", type: "person", label: "he" }], relations: [], claims: [], interpretation: "" }, 2);
  check("a pronoun resolves to the salient person rather than creating one", third.world.entities.length === 1);

  // Unresolvable pronoun.
  const orphan = applyDelta(EMPTY_WORLD_STATE, { entities: [{ id: "p", type: "person", label: "she" }], relations: [], claims: [], interpretation: "" }, 0);
  check("an unresolvable pronoun creates nothing", orphan.world.entities.length === 0);
}

{
  // Found live: the same thing typed differently across two sentences must
  // not fork into two entities. "Traffic" came back as a state, then as an
  // event, and the causal chain split in half.
  const first = applyDelta(
    EMPTY_WORLD_STATE,
    {
      entities: [
        { id: "f", type: "event", label: "road flooding" },
        { id: "t", type: "state", label: "traffic" },
      ],
      relations: [{ id: "r1", source: "f", type: "causes", target: "t" }],
      claims: [],
      interpretation: "",
    },
    0,
  );
  const second = applyDelta(
    first.world,
    {
      entities: [
        { id: "t", type: "event", label: "traffic" },
        { id: "l", type: "state", label: "being late" },
      ],
      relations: [{ id: "r1", source: "t", type: "causes", target: "l" }],
      claims: [],
      interpretation: "",
    },
    1,
  );
  check(
    "the same thing typed differently is one entity, not two",
    second.world.entities.filter((e) => e.label === "traffic").length === 1,
    second.world.entities.map((e) => `${e.id}:${e.type}`).join(", "),
  );
  const chain = longestPath(second.world.relations, (r) => r.type === "causes");
  check("so the causal chain stays whole", chain.length === 3, chain.join(" -> "));
  check(
    "but a person and a place sharing a name stay distinct",
    applyDelta(
      EMPTY_WORLD_STATE,
      {
        entities: [
          { id: "a", type: "person", label: "Washington" },
          { id: "b", type: "place", label: "Washington" },
        ],
        relations: [],
        claims: [],
        interpretation: "",
      },
      0,
    ).world.entities.length === 2,
  );
}

{
  // Retraction.
  const built = applyDelta(
    EMPTY_WORLD_STATE,
    {
      entities: [
        { id: "b", type: "object", label: "the bridge" },
        { id: "f", type: "event", label: "flooding" },
      ],
      relations: [{ id: "r0", source: "f", type: "causes", target: "b" }],
      claims: [],
      interpretation: "",
    },
    0,
  );
  const corrected = applyDelta(
    built.world,
    { entities: [{ id: "r", type: "object", label: "the road" }], relations: [], claims: [], supersededMentions: ["the bridge"], interpretation: "" },
    1,
  );
  const bridge = corrected.world.entities.find((e) => e.label === "the bridge");
  check("a retracted entity is superseded, not deleted", bridge && bridge.status === "superseded");
  check("relations into a superseded entity are dropped", corrected.world.relations.length === 0);
  check("the correction is present", corrected.world.entities.some((e) => e.label === "the road"));
}

{
  // Importance is recomputed from structure, not taken from the extractor.
  let world = EMPTY_WORLD_STATE;
  world = applyDelta(world, { entities: [{ id: "a", type: "concept", label: "aside" }], relations: [], claims: [], interpretation: "" }, 0).world;
  world = applyDelta(
    world,
    {
      entities: [
        { id: "h", type: "concept", label: "hub" },
        { id: "x", type: "concept", label: "spoke one" },
        { id: "y", type: "concept", label: "spoke two" },
      ],
      relations: [
        { id: "r1", source: "h", type: "causes", target: "x" },
        { id: "r2", source: "h", type: "causes", target: "y" },
      ],
      claims: [],
      interpretation: "",
    },
    1,
  ).world;
  const primary = world.entities.find((e) => e.importance === "primary");
  check("the most connected thing becomes primary", primary && primary.label === "hub", primary?.label);
  check("exactly one entity is primary", world.entities.filter((e) => e.importance === "primary").length === 1);
}

section("world model: regressions found by the discovery corpus");

{
  // A pronoun resolves to the NEAREST antecedent, not to whatever the
  // utterance is broadly about. Said as one paragraph the topic is Kenny, so
  // a topic-first salience stack hung the teaching on the wrong person — and
  // the multi-turn form, where the topic happened to be Mariam, passed.
  const world = applyDelta(
    EMPTY_WORLD_STATE,
    {
      entities: [
        { id: "k", type: "person", label: "Kenny" },
        { id: "m", type: "person", label: "Mariam" },
      ],
      relations: [{ id: "r1", source: "m", type: "role_of", target: "k", role: "mother" }],
      claims: [],
      topicEntityId: "k",
      interpretation: "",
    },
    0,
  ).world;
  const after = applyDelta(
    world,
    {
      entities: [{ id: "s", type: "person", label: "she", attributes: [{ key: "occupation", value: "teacher" }] }],
      relations: [],
      claims: [],
      interpretation: "",
    },
    1,
  ).world;
  const teacher = after.entities.find((e) => (e.attributes ?? []).some((a) => a.key === "occupation"));
  check("a pronoun resolves to the nearest mention, not the topic", teacher?.label === "Mariam", teacher?.label);
  check("and no second person is invented", after.entities.length === 2);
}

{
  // A correction replaces, it does not accumulate. Two contradictory roles
  // between the same pair would put both on the canvas.
  let world = applyDelta(
    EMPTY_WORLD_STATE,
    {
      entities: [
        { id: "j", type: "person", label: "John" },
        { id: "s", type: "person", label: "Sarah" },
      ],
      relations: [{ id: "r1", source: "j", type: "role_of", target: "s", role: "brother" }],
      claims: [],
      interpretation: "",
    },
    0,
  ).world;
  world = applyDelta(
    world,
    {
      entities: [
        { id: "j", type: "person", label: "John" },
        { id: "s", type: "person", label: "Sarah" },
      ],
      relations: [{ id: "r1", source: "j", type: "role_of", target: "s", role: "cousin" }],
      claims: [],
      interpretation: "",
    },
    1,
  ).world;
  const roles = world.relations.filter((r) => r.type === "role_of").map((r) => r.role);
  check("a corrected role replaces the wrong one", roles.length === 1 && roles[0] === "cousin", roles.join(", "));

  // Contradictory types retire each other too.
  let poles = applyDelta(
    EMPTY_WORLD_STATE,
    {
      entities: [
        { id: "a", type: "concept", label: "alpha" },
        { id: "b", type: "concept", label: "beta" },
      ],
      relations: [{ id: "r1", source: "a", type: "greater_than", target: "b" }],
      claims: [],
      interpretation: "",
    },
    0,
  ).world;
  poles = applyDelta(
    poles,
    {
      entities: [
        { id: "a", type: "concept", label: "alpha" },
        { id: "b", type: "concept", label: "beta" },
      ],
      relations: [{ id: "r1", source: "a", type: "less_than", target: "b" }],
      claims: [],
      interpretation: "",
    },
    1,
  ).world;
  check("a contradicting relation retires its opposite", poles.relations.length === 1 && poles.relations[0].type === "less_than", poles.relations.map((r) => r.type).join(", "));

  // But genuinely multi-valued types still accumulate.
  let multi = applyDelta(
    EMPTY_WORLD_STATE,
    {
      entities: [
        { id: "a", type: "concept", label: "cause" },
        { id: "b", type: "concept", label: "one" },
        { id: "c", type: "concept", label: "two" },
      ],
      relations: [
        { id: "r1", source: "a", type: "causes", target: "b" },
        { id: "r2", source: "a", type: "causes", target: "c" },
      ],
      claims: [],
      interpretation: "",
    },
    0,
  ).world;
  check("one thing can still cause several others", multi.relations.length === 2);
}

section("planner: nothing the speaker connected is silently dropped");

{
  // A second, disconnected component is content, not clutter. The hierarchy
  // grammar draws one root; the planner must fill the remaining budget with
  // the other tree rather than deleting it.
  const world = applyDelta(
    EMPTY_WORLD_STATE,
    {
      entities: [
        { id: "p", type: "group", label: "platform" },
        { id: "i", type: "group", label: "infra" },
        { id: "t", type: "group", label: "tooling" },
        { id: "pr", type: "group", label: "product" },
        { id: "w", type: "group", label: "web" },
      ],
      relations: [
        { id: "r1", source: "p", type: "contains", target: "i" },
        { id: "r2", source: "p", type: "contains", target: "t" },
        { id: "r3", source: "pr", type: "contains", target: "w" },
      ],
      claims: [],
      interpretation: "",
    },
    0,
  ).world;
  const plan = planExpression(world, classifyIntent(world, { entities: [], relations: [], claims: [], interpretation: "" }));
  const drawn = new Set(plan.regions.map((r) => r.entityId));
  check("the second tree reaches the canvas", drawn.has("product") && drawn.has("web"), [...drawn].join(", "));
  check(
    "and its own relation comes with it",
    plan.connections.some((c) => c.relationId === "product-contains-web"),
    plan.connections.map((c) => c.relationId).join(", "),
  );
}

section("planner: visibility horizon, not degree-primary occupancy");

{
  // A standing decision must survive a later topic, and the rejected
  // alternative must not keep competing for the same slots.
  let world = applyDelta(
    EMPTY_WORLD_STATE,
    {
      entities: [
        { id: "fix", type: "action", label: "fix step four" },
        { id: "rebuild", type: "action", label: "full rebuild" },
        { id: "drop", type: "concept", label: "drop-off" },
      ],
      relations: [
        { id: "r1", source: "fix", type: "contrasts_with", target: "rebuild" },
        { id: "r2", source: "fix", type: "causes", target: "drop" },
      ],
      claims: [{ id: "c1", text: "ship the step-four fix, not the rebuild", about: ["fix", "rebuild"] }],
      interpretation: "",
    },
    0,
  ).world;
  world = applyDelta(
    world,
    {
      entities: [],
      relations: [],
      claims: [],
      discourseActs: [{ type: "suspend", targetSurface: "full rebuild" }],
      interpretation: "",
    },
    1,
  ).world;
  world = applyDelta(
    world,
    {
      entities: [{ id: "tier", type: "object", label: "$15 tier" }],
      relations: [],
      claims: [{ id: "c2", text: "adding the $15 tier", about: ["tier"] }],
      interpretation: "",
    },
    20,
  ).world;

  const vis = assignVisibility(world, { newEntityIds: ["e-15-tier"] });
  check("the current object is visual primary", vis.focusId === "e-15-tier" || vis.tier.get("e-15-tier") === "primary" || vis.tier.get("e-15-tier") === "supporting", `focus=${vis.focusId} tier=${vis.tier.get("e-15-tier")}`);
  check("the standing decision stays supporting or primary", vis.tier.get("fix-step-four") === "supporting" || vis.tier.get("fix-step-four") === "primary", vis.tier.get("fix-step-four"));
  check("the suspended alternative is archived, not competing", vis.tier.get("full-rebuild") === "archived" || vis.tier.get("rebuild") === "archived" || world.entities.find((e) => /rebuild/.test(e.id))?.status === "suspended", world.entities.find((e) => /rebuild/.test(e.id))?.status);

  const plan = planExpression(world, classifyIntent(world, { entities: [], relations: [], claims: [], interpretation: "" }), { newEntityIds: ["e-15-tier"] });
  const drawn = new Set(plan.regions.map((r) => r.entityId));
  const rebuildId = world.entities.find((e) => /rebuild/.test(e.id))?.id;
  const fixId = world.entities.find((e) => /fix/.test(e.id))?.id;
  const tierId = world.entities.find((e) => /tier|15/.test(e.id))?.id;
  check("the new decision is on the canvas", drawn.has(tierId), [...drawn].join(", "));
  check("the prior decision persisted", drawn.has(fixId), [...drawn].join(", "));
  check("the parked alternative is not on the canvas", !drawn.has(rebuildId), [...drawn].join(", "));
}

{
  // A later topic must organise the picture. Degree-primary of an earlier
  // cluster must not keep the grammar's subject after the conversation moved.
  let world = EMPTY_WORLD_STATE;
  world = applyDelta(
    world,
    {
      entities: [
        { id: "fix", type: "action", label: "fix step four" },
        { id: "a", type: "concept", label: "onboarding" },
        { id: "b", type: "concept", label: "signup" },
      ],
      relations: [
        { id: "r1", source: "fix", type: "relates_to", target: "a" },
        { id: "r2", source: "fix", type: "relates_to", target: "b" },
      ],
      claims: [],
      interpretation: "",
    },
    0,
  ).world;
  world = applyDelta(
    world,
    {
      entities: [{ id: "hire", type: "event", label: "hiring" }, { id: "dana", type: "person", label: "Dana" }],
      relations: [{ id: "r3", source: "dana", type: "role_of", target: "hire", role: "candidate" }],
      claims: [],
      interpretation: "",
    },
    30,
  ).world;
  const vis = assignVisibility(world, { newEntityIds: ["hiring", "dana"] });
  check("visual focus follows the current topic, not the densest old cluster", vis.focusId === "hiring" || vis.focusId === "dana", vis.focusId);
  const plan = planExpression(world, classifyIntent(world, { entities: [], relations: [], claims: [], interpretation: "" }), { newEntityIds: ["hiring", "dana"] });
  check("the current topic is the planned focus", plan.focusEntityId === "hiring" || plan.focusEntityId === "dana", plan.focusEntityId);
}

section("primitives: a stated count is extent, whatever was counted");

{
  const objects = applyDelta(
    EMPTY_WORLD_STATE,
    {
      entities: [{ id: "c", type: "object", label: "chairs", quantity: { value: 6 } }],
      relations: [],
      claims: [],
      interpretation: "",
    },
    0,
  ).world;
  const scene = compose(objects, planExpression(objects, classifyIntent(objects, { entities: [], relations: [], claims: [], interpretation: "" })));
  const chairs = scene.objects.find((o) => o.entityId === "chairs");
  check("six chairs are drawn as six marks, not one glyph", chairs?.count === 6, `${chairs?.primitive} count=${chairs?.count}`);
}

section("composition: the layout may not contradict what was said");

{
  // The bird is BENEATH the tree, in a scene whose grammar is a sequence and
  // therefore knows nothing about space.
  const world = applyDelta(
    EMPTY_WORLD_STATE,
    {
      entities: [
        { id: "a", type: "action", label: "walking" },
        { id: "b", type: "event", label: "finding" },
        { id: "bird", type: "object", label: "bird" },
        { id: "tree", type: "object", label: "tree" },
      ],
      relations: [
        { id: "r1", source: "a", type: "precedes", target: "b", step: 0 },
        { id: "r2", source: "bird", type: "located_at", target: "tree", spatial: "below" },
      ],
      claims: [],
      interpretation: "",
    },
    0,
  ).world;
  const scene = compose(world, planExpression(world, classifyIntent(world, { entities: [], relations: [], claims: [], interpretation: "" })));
  const bird = scene.objects.find((o) => o.entityId === "bird");
  const tree = scene.objects.find((o) => o.entityId === "tree");
  check("both are on the canvas", Boolean(bird && tree));
  check(
    "and the bird is placed below the tree, as described",
    bird && tree && bird.y > tree.y,
    bird && tree ? `bird y=${bird.y}, tree y=${tree.y}` : "missing",
  );
}

// ────────────────────────────────────────────────────────── intent

section("intent: read from structure, never from words");

{
  const causal = applyDelta(
    EMPTY_WORLD_STATE,
    {
      entities: [
        { id: "a", type: "event", label: "rain" },
        { id: "b", type: "event", label: "flood" },
        { id: "c", type: "event", label: "traffic" },
      ],
      relations: [
        { id: "r1", source: "a", type: "causes", target: "b" },
        { id: "r2", source: "b", type: "causes", target: "c" },
      ],
      claims: [],
      interpretation: "",
    },
    0,
  ).world;
  const intent = classifyIntent(causal, { entities: [], relations: [], claims: [], interpretation: "" });
  check("a causal chain is explain_causality", intent.primary === "explain_causality", intent.primary);
  check("the chain head is the focus", intent.focusEntityId === "rain", intent.focusEntityId);

  // Same words, no causal relation: the intent must change.
  const flat = applyDelta(
    EMPTY_WORLD_STATE,
    {
      entities: [
        { id: "a", type: "event", label: "rain" },
        { id: "b", type: "event", label: "flood" },
      ],
      relations: [{ id: "r1", source: "a", type: "relates_to", target: "b" }],
      claims: [],
      interpretation: "",
    },
    0,
  ).world;
  check(
    "the same nouns with no causal relation are not causal",
    classifyIntent(flat, { entities: [], relations: [], claims: [], interpretation: "" }).primary !== "explain_causality",
  );
}

// ────────────────────────────────────────────────── grammar + compose

section("grammar and composition");

{
  const world = applyDelta(
    EMPTY_WORLD_STATE,
    {
      entities: [
        { id: "c", type: "group", label: "the company" },
        { id: "e", type: "group", label: "engineering" },
        { id: "s", type: "group", label: "sales" },
      ],
      relations: [
        { id: "r1", source: "c", type: "contains", target: "e" },
        { id: "r2", source: "c", type: "contains", target: "s" },
      ],
      claims: [],
      interpretation: "",
    },
    0,
  ).world;
  const intent = classifyIntent(world, { entities: [], relations: [], claims: [], interpretation: "" });
  const plan = planExpression(world, intent);
  const scene = compose(world, plan);
  check("containment produces an enclosure grammar", ["hierarchy", "grouping"].includes(plan.grammar), plan.grammar);

  const parent = scene.objects.find((o) => o.entityId === "company");
  const child = scene.objects.find((o) => o.entityId === "engineering");
  check(
    "children are laid out inside the parent's box",
    parent && child && child.x >= parent.x && child.x + child.w <= parent.x + parent.w && child.y >= parent.y,
    parent && child ? `parent ${parent.x},${parent.y},${parent.w}x${parent.h} child ${child.x},${child.y}` : "missing objects",
  );
  check("the containment connector is drawn as nothing — the enclosure says it", scene.connectors.every((c) => c.style === "none"));
}

{
  // A counted group becomes marks, not a number in a box.
  const world = applyDelta(
    EMPTY_WORLD_STATE,
    {
      entities: [
        { id: "k", type: "person", label: "Kenny" },
        { id: "f", type: "group", label: "family", quantity: { value: 5 } },
      ],
      relations: [{ id: "r1", source: "k", type: "member_of", target: "f" }],
      claims: [],
      interpretation: "",
    },
    0,
  ).world;
  const plan = planExpression(world, classifyIntent(world, { entities: [], relations: [], claims: [], interpretation: "" }));
  const scene = compose(world, plan);
  const family = scene.objects.find((o) => o.entityId === "family");
  check("a counted group is drawn as repeated marks", family && family.count === 5, JSON.stringify(family && { p: family.primitive, c: family.count }));
  const kenny = scene.objects.find((o) => o.entityId === "kenny");
  check("a person is drawn as a figure", kenny && kenny.primitive === "figure", kenny?.primitive);
  const markup = svg.render(scene, diffScenes(null, scene));
  check("the svg renderer produces a document", markup.startsWith("<svg") && markup.includes("</svg>"));
  check("the count is not also written as a numeral", !/>5</.test(markup));
}

{
  // Nothing may overlap.
  const world = applyDelta(
    EMPTY_WORLD_STATE,
    {
      entities: Array.from({ length: 6 }, (_, i) => ({ id: `e${i}`, type: "concept", label: `thing ${i}` })),
      relations: Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, source: "e0", type: "relates_to", target: `e${i + 1}` })),
      claims: [],
      interpretation: "",
    },
    0,
  ).world;
  const plan = planExpression(world, classifyIntent(world, { entities: [], relations: [], claims: [], interpretation: "" }));
  const scene = compose(world, plan);
  const evaluation = evaluateScene(world, scene);
  check("a busy scene has no overlaps", !evaluation.problems.some((p) => p.type === "overlap"), JSON.stringify(evaluation.problems.filter((p) => p.type === "overlap")));
  check("scene plans validate", ScenePlanSchema.safeParse(scene).success);
}

section("incremental expression: the board extends, it does not redraw");

/**
 * A multi-turn session, driven exactly the way lib/expression/pipeline.ts
 * drives one: each turn folds a delta into the world, plans against the
 * previous round's visible ids, and composes against the previous scene.
 */
function liveSession() {
  let world = EMPTY_WORLD_STATE;
  let previous = null;
  let previousGrammar = null;
  let previousFocusId;
  let seq = 0;
  return (delta) => {
    const applied = applyDelta(world, delta, seq);
    world = applied.world;
    const intent = classifyIntent(world, delta);
    const newEntityIds = applied.ops.filter((op) => op.kind === "ADD_ENTITY").map((op) => op.entity.id);
    const previousVisibleIds = (previous?.objects ?? []).map((o) => o.entityId).filter(Boolean);
    // Threaded exactly as ExpressionSession threads it (pipeline.ts's
    // lastFocusId). Without it the subject cannot hold across turns, and
    // this harness would be testing a caller nothing in the product is.
    const plan = planExpression(world, intent, { newEntityIds, previousVisibleIds, previousFocusId });
    const options = { previous, previousGrammar };
    const scene = compose(world, plan, options);
    const patch = diffScenes(previous, scene);
    const mode = isContinuation(plan, options) ? "patch" : "full";
    previous = scene;
    previousGrammar = plan.grammar;
    previousFocusId = plan.focusEntityId;
    seq += 1;
    return { world, plan, scene, patch, mode };
  };
}

const at = (scene, label) => scene.objects.find((o) => o.label === label);
const samePlace = (a, b) => Boolean(a && b && a.x === b.x && a.y === b.y);
const centreX = (o) => o.x + o.w / 2;

{
  // Causal: turn 1 establishes A -> B, turn 2 adds B -> C.
  const speak = liveSession();
  const first = speak({
    entities: [
      { id: "a", type: "event", label: "marketing" },
      { id: "b", type: "event", label: "traffic" },
    ],
    relations: [{ id: "r1", source: "a", type: "causes", target: "b" }],
    claims: [],
    interpretation: "",
  });
  const second = speak({
    entities: [{ id: "c", type: "event", label: "signups" }],
    relations: [{ id: "r2", source: "traffic", type: "causes", target: "signups" }],
    claims: [],
    interpretation: "",
  });

  check("the first turn of a session is a full compose", first.mode === "full", first.mode);
  check("extending the same grammar is a patch", second.mode === "patch", second.mode);
  check(
    "the head of the chain is still on the canvas",
    Boolean(at(second.scene, "marketing")),
    second.scene.objects.map((o) => o.label).join(", "),
  );
  check("the chain is drawn whole", second.plan.reason.includes("marketing -> traffic -> signups"), second.plan.reason);
  check("the established steps do not move", samePlace(at(first.scene, "marketing"), at(second.scene, "marketing")) && samePlace(at(first.scene, "traffic"), at(second.scene, "traffic")),
    `${JSON.stringify(at(second.scene, "marketing"))} / ${JSON.stringify(at(second.scene, "traffic"))}`);
  check("nothing is reported as moved", second.patch.moved.length === 0, describePatch(second.patch).join(" | "));
  check("only the new step is added", second.patch.added.length === 1 && second.patch.added[0].label === "signups", describePatch(second.patch).join(" | "));
  check("and its edge is the only new connector", second.patch.connectorsAdded.length === 1);
  check("the first turn's edge is not redrawn as a new one", !second.patch.connectorsAdded.some((c) => c.relationId.includes("marketing")));
}

{
  // Sequence: a third step joins a chain built over two earlier turns.
  const speak = liveSession();
  speak({
    entities: [
      { id: "s1", type: "action", label: "sign in" },
      { id: "s2", type: "action", label: "load projects" },
    ],
    relations: [{ id: "r1", source: "s1", type: "precedes", target: "s2", step: 0 }],
    claims: [],
    interpretation: "",
  });
  const second = speak({
    entities: [{ id: "s3", type: "action", label: "open dashboard" }],
    relations: [{ id: "r2", source: "load-projects", type: "precedes", target: "open-dashboard", step: 1 }],
    claims: [],
    interpretation: "",
  });
  const third = speak({
    entities: [{ id: "s4", type: "action", label: "show the report" }],
    relations: [{ id: "r3", source: "open-dashboard", type: "precedes", target: "show-the-report", step: 2 }],
    claims: [],
    interpretation: "",
  });

  check("a four-step sequence is drawn whole", third.scene.objects.length === 4, String(third.scene.objects.length));
  check(
    "steps established two turns ago stay exactly put",
    samePlace(at(second.scene, "sign in"), at(third.scene, "sign in")) &&
      samePlace(at(second.scene, "load projects"), at(third.scene, "load projects")),
  );
  check("the new step lands at the end of the chain", at(third.scene, "show the report").y > at(third.scene, "open dashboard").y);
  check("only the new step is added", third.patch.added.length === 1 && third.patch.added[0].label === "show the report", describePatch(third.patch).join(" | "));
  check("no step is reported as moved", third.patch.moved.length === 0, describePatch(third.patch).join(" | "));
}

{
  // Comparison: a second turn hangs another dimension under one pole.
  const speak = liveSession();
  const first = speak({
    entities: [
      { id: "a", type: "concept", label: "Plan A" },
      { id: "b", type: "concept", label: "Plan B" },
      { id: "ac", type: "quantity", label: "A cost" },
      { id: "bc", type: "quantity", label: "B cost" },
    ],
    relations: [
      { id: "r1", source: "a", type: "contrasts_with", target: "b" },
      { id: "r2", source: "a", type: "has_property", target: "ac" },
      { id: "r3", source: "b", type: "has_property", target: "bc" },
      { id: "r4", source: "ac", type: "greater_than", target: "bc" },
    ],
    claims: [],
    interpretation: "",
  });
  const second = speak({
    entities: [{ id: "ad", type: "quantity", label: "A duration" }],
    relations: [{ id: "r5", source: "plan-a", type: "has_property", target: "a-duration" }],
    claims: [],
    interpretation: "",
  });

  check("both poles are still poles a turn later", second.plan.reason.includes("poles plan-a vs plan-b"), second.plan.reason);
  const poleA = [at(first.scene, "Plan A"), at(second.scene, "Plan A")];
  const poleB = [at(first.scene, "Plan B"), at(second.scene, "Plan B")];
  check("the poles keep their row", poleA[0].y === poleA[1].y && poleB[0].y === poleB[1].y, `${poleA[1].y} / ${poleB[1].y}`);
  check(
    "and their columns — a pole that shrinks back from emphasis does so about its own centre",
    centreX(poleA[0]) === centreX(poleA[1]) && centreX(poleB[0]) === centreX(poleB[1]),
    `${centreX(poleA[0])}->${centreX(poleA[1])}, ${centreX(poleB[0])}->${centreX(poleB[1])}`,
  );
  check(
    "a dimension nobody touched does not move at all",
    samePlace(at(first.scene, "B cost"), at(second.scene, "B cost")),
    `${JSON.stringify(at(first.scene, "B cost"))} -> ${JSON.stringify(at(second.scene, "B cost"))}`,
  );
  check("the new dimension lands under its own pole", Math.abs(centreX(at(second.scene, "A duration")) - centreX(poleA[1])) <= 1);
  check("only the new dimension is added", second.patch.added.length === 1 && second.patch.added[0].label === "A duration", describePatch(second.patch).join(" | "));
  check("nothing is reported as moved", second.patch.moved.length === 0, describePatch(second.patch).join(" | "));
}

{
  // A grammar change is a legitimate rebuild — and must be reported as one.
  const speak = liveSession();
  speak({
    entities: [
      { id: "a", type: "concept", label: "one plan" },
      { id: "b", type: "concept", label: "the other plan" },
    ],
    relations: [{ id: "r1", source: "a", type: "contrasts_with", target: "b" }],
    claims: [],
    interpretation: "",
  });
  const second = speak({
    entities: [
      { id: "c", type: "group", label: "the company" },
      { id: "d", type: "group", label: "engineering" },
      { id: "e", type: "group", label: "sales" },
    ],
    relations: [
      { id: "r2", source: "c", type: "contains", target: "d" },
      { id: "r3", source: "c", type: "contains", target: "e" },
    ],
    claims: [],
    interpretation: "",
  });
  check("a grammar shift is reported as a full compose", second.mode === "full", `${second.plan.grammar} / ${second.mode}`);
  check("the shifted grammar is the enclosure one", ["hierarchy", "grouping"].includes(second.plan.grammar), second.plan.grammar);
}

{
  // Anchoring is a translation and nothing else: composing with a previous
  // scene must never change WHICH objects are drawn or how they relate.
  const world = applyDelta(
    EMPTY_WORLD_STATE,
    {
      entities: [
        { id: "a", type: "event", label: "rain" },
        { id: "b", type: "event", label: "flood" },
      ],
      relations: [{ id: "r1", source: "a", type: "causes", target: "b" }],
      claims: [],
      interpretation: "",
    },
    0,
  ).world;
  const plan = planExpression(world, classifyIntent(world, { entities: [], relations: [], claims: [], interpretation: "" }));
  const bare = compose(world, plan);
  const shifted = compose(world, plan, {
    previous: { ...bare, objects: bare.objects.map((o) => ({ ...o, x: o.x + 500, y: o.y + 300 })) },
    previousGrammar: plan.grammar,
  });
  check("anchoring moves the whole scene together", shifted.objects.every((o, i) => o.x - bare.objects[i].x === 500 && o.y - bare.objects[i].y === 300));
  check("it draws exactly the same objects", shifted.objects.map((o) => o.id).join() === bare.objects.map((o) => o.id).join());
  check("and preserves the same meaning", evaluateScene(world, shifted).semanticPreservation === evaluateScene(world, bare).semanticPreservation);
  const negative = compose(world, plan, {
    previous: { ...bare, objects: bare.objects.map((o) => ({ ...o, x: o.x - 9000, y: o.y - 9000 })) },
    previousGrammar: plan.grammar,
  });
  check("and never anchors the scene off the top-left of its own viewport", negative.objects.every((o) => o.x >= 0 && o.y >= 0));
  const unrelated = compose(world, plan, { previous: bare, previousGrammar: "comparison" });
  check("a different previous grammar is not anchored against", unrelated.objects[0].x === bare.objects[0].x && unrelated.objects[0].y === bare.objects[0].y);
}

section("form fidelity: the arrangement has to argue the idea");

{
  // A causal explanation is a graph. The branch ("more supply holds prices
  // down") must read as hanging off the step it acts on, not as a second
  // stack of its own beside the story.
  const world = applyDelta(
    EMPTY_WORLD_STATE,
    {
      entities: [
        { id: "d", type: "event", label: "demand rises" },
        { id: "p", type: "event", label: "prices rise" },
        { id: "i", type: "event", label: "inflation" },
        { id: "s", type: "event", label: "supply rises" },
      ],
      relations: [
        { id: "r1", source: "d", type: "causes", target: "p" },
        { id: "r2", source: "p", type: "causes", target: "i" },
        { id: "r3", source: "s", type: "prevents", target: "p" },
      ],
      claims: [],
      interpretation: "",
    },
    0,
  ).world;
  const plan = planExpression(world, classifyIntent(world, { entities: [], relations: [], claims: [], interpretation: "" }));
  const scene = compose(world, plan);
  check("a causal graph is drawn by the cause_effect grammar", plan.grammar === "cause_effect", plan.grammar);

  const byLabel = (label) => scene.objects.find((o) => o.label === label);
  const [demand, prices, inflation, supply] = ["demand rises", "prices rise", "inflation", "supply rises"].map(byLabel);
  check("the spine is a single column", demand && prices && inflation && Math.abs(demand.x + demand.w / 2 - inflation.x - inflation.w / 2) <= 1);
  check(
    "the spine runs downward in causal order",
    demand && prices && inflation && demand.y < prices.y && prices.y < inflation.y,
    demand && prices && inflation ? `${demand.y} ${prices.y} ${inflation.y}` : "missing",
  );
  check(
    "a branch sits on the row of the step it acts on",
    supply && prices && Math.abs(supply.y + supply.h / 2 - (prices.y + prices.h / 2)) <= 4,
    supply && prices ? `branch centre ${supply.y + supply.h / 2}, step centre ${prices.y + prices.h / 2}` : "missing",
  );
  const spineLeft = Math.min(demand?.x ?? 0, prices?.x ?? 0, inflation?.x ?? 0);
  const spineRight = Math.max(...[demand, prices, inflation].map((o) => (o ? o.x + o.w : 0)));
  check(
    "and clear of the spine column, so the story still reads as one line",
    supply && (supply.x >= spineRight || supply.x + supply.w <= spineLeft),
    supply ? `branch ${supply.x}..${supply.x + supply.w}, spine ${spineLeft}..${spineRight}` : "missing",
  );
  const preventsId = world.relations.find((r) => r.type === "prevents").id;
  check("the branch keeps its own arrow", scene.connectors.some((c) => c.relationId === preventsId && c.style === "arrow"));
  check("nothing overlaps", !evaluateScene(world, scene).problems.some((p) => p.type === "overlap"));
}

{
  // A claim standing on its reasons is a tree, not a box with reasons in it:
  // a reason is not a PART of the conclusion it supports.
  const world = applyDelta(
    EMPTY_WORLD_STATE,
    {
      entities: [
        { id: "c", type: "concept", label: "ship on Friday" },
        { id: "r1e", type: "concept", label: "the tests pass" },
        { id: "r2e", type: "concept", label: "the customer is waiting" },
      ],
      relations: [
        { id: "r1", source: "r1e", type: "supports", target: "c" },
        { id: "r2", source: "r2e", type: "supports", target: "c" },
      ],
      claims: [],
      interpretation: "",
    },
    0,
  ).world;
  const plan = planExpression(world, classifyIntent(world, { entities: [], relations: [], claims: [], interpretation: "" }));
  const scene = compose(world, plan);
  check("a backed claim is a hierarchy", plan.grammar === "hierarchy", plan.grammar);

  const claim = scene.objects.find((o) => o.label === "ship on Friday");
  const reasons = scene.objects.filter((o) => o.label !== "ship on Friday" && o.entityId);
  check("the claim sits above its reasons", claim && reasons.length === 2 && reasons.every((r) => claim.y + claim.h <= r.y));
  check("the reasons sit side by side on one row", reasons.length === 2 && Math.abs(reasons[0].y - reasons[1].y) <= 1);
  check(
    "a reason is not drawn inside the claim it backs",
    reasons.every((r) => !r.parentObjectId && !(r.x >= claim.x && r.x + r.w <= claim.x + claim.w && r.y >= claim.y && r.y + r.h <= claim.y + claim.h)),
  );
  const supportIds = world.relations.filter((r) => r.type === "supports").map((r) => r.id);
  check(
    "each reason is joined to the claim by a real line",
    supportIds.length === 2 && supportIds.every((id) => scene.connectors.some((c) => c.relationId === id && c.style === "line")),
  );
  const evaluation = evaluateScene(world, scene);
  check("the tree invents no containment", !evaluation.problems.some((p) => p.type === "false_relation"), JSON.stringify(evaluation.problems));
  check("and the argument survives whole", evaluation.semanticPreservation === 1, String(evaluation.semanticPreservation));
}

{
  // Two poles measured on the same dimensions: the dimensions have to line
  // up row by row, or the columns cannot be read against each other.
  const world = applyDelta(
    EMPTY_WORLD_STATE,
    {
      entities: [
        { id: "a", type: "concept", label: "Plan A" },
        { id: "b", type: "concept", label: "Plan B" },
        { id: "ac", type: "quantity", label: "A cost" },
        { id: "bc", type: "quantity", label: "B cost" },
        { id: "as", type: "quantity", label: "A duration" },
      ],
      relations: [
        { id: "r1", source: "a", type: "contrasts_with", target: "b" },
        { id: "r2", source: "a", type: "has_property", target: "ac" },
        { id: "r3", source: "a", type: "has_property", target: "as" },
        { id: "r4", source: "b", type: "has_property", target: "bc" },
        { id: "r5", source: "ac", type: "greater_than", target: "bc" },
      ],
      claims: [],
      interpretation: "",
    },
    0,
  ).world;
  const plan = planExpression(world, classifyIntent(world, { entities: [], relations: [], claims: [], interpretation: "" }));
  const scene = compose(world, plan);
  check("two poles produce the comparison grammar", plan.grammar === "comparison", plan.grammar);

  const byLabel = (label) => scene.objects.find((o) => o.label === label);
  const [poleA, poleB, aCost, bCost, aDuration] = ["Plan A", "Plan B", "A cost", "B cost", "A duration"].map(byLabel);
  check("both poles sit on the same row", poleA && poleB && poleA.y === poleB.y);
  check(
    "compared dimensions share a row",
    aCost && bCost && Math.abs(aCost.y - bCost.y) <= 1,
    aCost && bCost ? `${aCost.y} vs ${bCost.y}` : "missing",
  );
  check(
    "an unmatched dimension takes a row of its own beneath",
    aDuration && aCost && aDuration.y > aCost.y,
    aDuration && aCost ? `${aDuration.y} vs ${aCost.y}` : "missing",
  );
  check(
    "each dimension stays in its own pole's column",
    aCost && poleA && bCost && poleB &&
      Math.abs(aCost.x + aCost.w / 2 - (poleA.x + poleA.w / 2)) <= 1 &&
      Math.abs(bCost.x + bCost.w / 2 - (poleB.x + poleB.w / 2)) <= 1,
    aCost && poleA ? `A cost centre ${aCost.x + aCost.w / 2}, pole A centre ${poleA.x + poleA.w / 2}` : "missing",
  );
  check("the comparison survives whole", evaluateScene(world, scene).semanticPreservation === 1);
}

{
  // has_property is membership, not a directed arrow. The extractor emits
  // both `plan-a → plan-a-duration` and `plan-a-duration → plan-a` for the
  // same fact; either orientation (and both at once) must hang the duration
  // under Plan A, not park it as a straggler or promote it to a pole.
  const orientations = [
    { name: "plan-a → plan-a-duration", edges: [{ source: "a", target: "ad" }] },
    { name: "plan-a-duration → plan-a", edges: [{ source: "ad", target: "a" }] },
    {
      name: "both orientations",
      edges: [
        { source: "a", target: "ad" },
        { source: "ad", target: "a" },
      ],
    },
  ];
  for (const orientation of orientations) {
    const world = applyDelta(
      EMPTY_WORLD_STATE,
      {
        entities: [
          { id: "a", type: "concept", label: "Plan A" },
          { id: "b", type: "concept", label: "Plan B" },
          { id: "ad", type: "quantity", label: "Plan A duration" },
        ],
        relations: [
          { id: "r1", source: "a", type: "contrasts_with", target: "b" },
          ...orientation.edges.map((edge, i) => ({
            id: `hp${i + 1}`,
            source: edge.source,
            type: "has_property",
            target: edge.target,
          })),
        ],
        claims: [],
        interpretation: "",
      },
      0,
    ).world;
    const plan = planExpression(world, classifyIntent(world, { entities: [], relations: [], claims: [], interpretation: "" }));
    const scene = compose(world, plan);
    check(
      `${orientation.name}: poles stay the plans`,
      plan.grammar === "comparison" && plan.reason.includes("poles plan-a vs plan-b"),
      `${plan.grammar} / ${plan.reason}`,
    );
    const poleA = plan.regions.find((r) => r.entityId === "plan-a");
    const durationRegion = plan.regions.find((r) => r.entityId === "plan-a-duration");
    check(
      `${orientation.name}: duration is a member of Plan A's column`,
      Boolean(poleA && durationRegion && (poleA.childRegionIds ?? []).includes(durationRegion.id)),
      JSON.stringify(poleA && { children: poleA.childRegionIds, duration: durationRegion && durationRegion.id }),
    );
    const byLabel = (label) => scene.objects.find((o) => o.label === label);
    const [poleAObj, durationObj] = ["Plan A", "Plan A duration"].map(byLabel);
    check(
      `${orientation.name}: duration lands under Plan A`,
      poleAObj && durationObj && Math.abs(poleAObj.x + poleAObj.w / 2 - (durationObj.x + durationObj.w / 2)) <= 1 && durationObj.y > poleAObj.y,
      poleAObj && durationObj
        ? `pole ${poleAObj.x + poleAObj.w / 2},${poleAObj.y} duration ${durationObj.x + durationObj.w / 2},${durationObj.y}`
        : "missing",
    );
  }
}

{
  // A contrast is a real claim and cannot depend on the poles happening to
  // sit in a row: it gets its own symmetric mark.
  const world = applyDelta(
    EMPTY_WORLD_STATE,
    {
      entities: [
        { id: "sp", type: "concept", label: "moving fast" },
        { id: "sa", type: "concept", label: "staying safe" },
      ],
      relations: [{ id: "r1", source: "sp", type: "contrasts_with", target: "sa" }],
      claims: [],
      interpretation: "",
    },
    0,
  ).world;
  const plan = planExpression(world, classifyIntent(world, { entities: [], relations: [], claims: [], interpretation: "" }));
  const scene = compose(world, plan);
  const contrastId = world.relations.find((r) => r.type === "contrasts_with").id;
  const tension = scene.connectors.find((c) => c.relationId === contrastId);
  check("an explicit contrast is drawn as a tension mark", tension && tension.style === "tension", tension && tension.style);
  check("the tension mark is a zigzag, not a straight line", tension && tension.points.length === 5, tension && String(tension.points.length));
  check(
    "it is symmetric — it asserts no direction",
    tension &&
      Math.abs(
        Math.hypot(tension.points[1][0] - tension.points[0][0], tension.points[1][1] - tension.points[0][1]) -
          Math.hypot(tension.points[3][0] - tension.points[4][0], tension.points[3][1] - tension.points[4][1]),
      ) <= 2,
  );
  const edges = recoverRelations(scene);
  check(
    "a viewer reads it as two things set in parallel",
    edges.some((e) => e.reading === "parallel" && ((e.from === "moving-fast" && e.to === "staying-safe") || (e.from === "staying-safe" && e.to === "moving-fast"))),
  );
  check("and never as a direction", !edges.some((e) => e.reading === "directed"));
  const markup = svg.render(scene, diffScenes(null, scene));
  check("the svg renderer draws every point of it", markup.includes(`M ${tension.points[0][0]} ${tension.points[0][1]} L`));
  check(
    "and excalidraw draws it as an undirected line",
    skeletonsForScene(scene, { x: 0, y: 0 }).some((sk) => sk.id === tension.id && sk.type === "line" && sk.points.length === 5),
  );
}

{
  // What just happened has to be the thing your eye lands on — in size AND
  // in stroke, so the hierarchy survives both a greyscale print and a glance.
  const world = applyDelta(
    EMPTY_WORLD_STATE,
    {
      entities: [
        { id: "old", type: "concept", label: "standing topic" },
        { id: "fresh", type: "concept", label: "just said" },
      ],
      relations: [{ id: "r1", source: "old", type: "relates_to", target: "fresh" }],
      claims: [],
      interpretation: "",
    },
    0,
  ).world;
  const intent = classifyIntent(world, { entities: [], relations: [], claims: [], interpretation: "" });
  const plan = planExpression(world, intent, { newEntityIds: ["just-said"] });
  const scene = compose(world, plan);
  // The board has exactly ONE dominant element and it is the subject.
  // Recency used to be encoded as size too, which meant the largest box
  // was whatever the last clause mentioned and the subject sat beneath it
  // — two claims on the eye, which is a tie rather than a hierarchy. New
  // ink still announces itself by appearing; it no longer competes.
  const subject = scene.objects.find((o) => o.entityId === plan.focusEntityId);
  const other = scene.objects.find((o) => o.entityId !== plan.focusEntityId);
  check("the subject carries top emphasis", subject && subject.weight === 3, subject && String(subject.weight));
  check(
    "nothing else is emphasised alongside it",
    scene.objects.filter((o) => o.weight === 3).length === 1,
    scene.objects.map((o) => `${o.label}:${o.weight}`).join(", "),
  );
  check(
    "and is drawn distinctly larger than the rest",
    subject && other && subject.w > other.w * 1.15,
    subject && other ? `${subject.w} vs ${other.w}` : "missing",
  );
  const skeletons = skeletonsForScene(scene, { x: 0, y: 0 });
  const freshSkeleton = skeletons.find((sk) => sk.id === subject.id);
  const oldSkeleton = skeletons.find((sk) => sk.id === other.id);
  check(
    "excalidraw gives the subject a heavier stroke than everything else",
    freshSkeleton && oldSkeleton && freshSkeleton.strokeWidth > oldSkeleton.strokeWidth,
    freshSkeleton && oldSkeleton ? `${freshSkeleton.strokeWidth} vs ${oldSkeleton.strokeWidth}` : "missing",
  );
}

// ─────────────────────────────────────────────────────── evaluation

section("evaluation: reverse interpretation");

{
  const world = applyDelta(
    EMPTY_WORLD_STATE,
    {
      entities: [
        { id: "a", type: "event", label: "rain" },
        { id: "b", type: "event", label: "flood" },
      ],
      relations: [{ id: "r1", source: "a", type: "causes", target: "b" }],
      claims: [],
      interpretation: "",
    },
    0,
  ).world;
  const plan = planExpression(world, classifyIntent(world, { entities: [], relations: [], claims: [], interpretation: "" }));
  const scene = compose(world, plan);
  const edges = recoverRelations(scene);
  check("an arrow is recovered as a directed reading", edges.some((e) => e.reading === "directed" && e.from === "rain" && e.to === "flood"));

  // Strip the arrow: the causal claim must stop being recoverable.
  const stripped = { ...scene, connectors: scene.connectors.map((c) => ({ ...c, style: "none" })) };
  const evaluation = evaluateScene(world, stripped);
  check("removing the arrow loses the causal relation", evaluation.semanticPreservation < 1, String(evaluation.semanticPreservation));
  check("and it is reported as a missing relation", evaluation.problems.some((p) => p.type === "missing_relation"));
  check("and repair proposes strengthening the connector", planRepair(evaluation, plan, world).steps.some((s) => s.action === "strengthen_connector" || s.action === "change_grammar"));
}

{
  // Invented containment must be caught even though every connector is legitimate.
  const world = applyDelta(
    EMPTY_WORLD_STATE,
    {
      entities: [
        { id: "a", type: "concept", label: "alpha" },
        { id: "b", type: "concept", label: "beta" },
      ],
      relations: [{ id: "r1", source: "a", type: "relates_to", target: "b" }],
      claims: [],
      interpretation: "",
    },
    0,
  ).world;
  const scene = {
    objects: [
      { id: "o-a", entityId: "alpha", regionId: "r-a", primitive: "container", x: 0, y: 0, w: 400, h: 300, weight: 2 },
      { id: "o-b", entityId: "beta", regionId: "r-b", primitive: "node", x: 40, y: 60, w: 120, h: 60, weight: 1 },
    ],
    connectors: [],
    width: 400,
    height: 300,
  };
  const evaluation = evaluateScene(world, scene);
  check("accidental enclosure is caught as a false relation", evaluation.inventedRelations.length === 1, JSON.stringify(evaluation.inventedRelations));
  check("a false relation is penalised heavily", evaluation.semanticPreservation <= 0.75, String(evaluation.semanticPreservation));
}

{
  // A scene that draws its relations perfectly but omits the subject the
  // conversation is now about must not score 1.0. Found by a live run, where
  // a stale sequence scored clean next to a severity-0.9 problem.
  const world = applyDelta(
    EMPTY_WORLD_STATE,
    {
      entities: [
        { id: "a", type: "event", label: "alpha" },
        { id: "b", type: "event", label: "beta" },
        { id: "c", type: "group", label: "the subject" },
        { id: "d", type: "object", label: "delta" },
        { id: "e", type: "object", label: "epsilon" },
      ],
      relations: [
        { id: "r1", source: "a", type: "precedes", target: "b" },
        { id: "r2", source: "c", type: "contains", target: "d" },
        { id: "r3", source: "c", type: "contains", target: "e" },
      ],
      claims: [],
      interpretation: "",
    },
    0,
  ).world;
  const primary = world.entities.find((e) => e.importance === "primary");
  // Draw only the two events, deliberately leaving the primary subject out.
  const partial = compose(world, {
    grammar: "sequence",
    intent: "show_sequence",
    regions: [
      { id: "r-a", role: "sequence_step", entityId: "alpha", order: 0 },
      { id: "r-b", role: "sequence_step", entityId: "beta", order: 1 },
    ],
    connections: [{ id: "c1", fromRegionId: "r-a", toRegionId: "r-b", relationId: "r1", kind: "flow" }],
    emphasis: [],
    reason: "",
  });
  const evaluation = evaluateScene(world, partial);
  check("the primary subject is the-subject", primary && primary.id === "subject", primary?.id);
  check("every drawn relation is readable", evaluation.recoveredRelationIds.length === 1);
  check(
    "but omitting the primary subject costs the score",
    evaluation.semanticPreservation < 0.85,
    `got ${evaluation.semanticPreservation}`,
  );
  check("and it is reported", evaluation.problems.some((p) => p.type === "missing_entity"));
}

{
  // A person cannot precede an event: "Priya joined last month" is not a
  // three-step sequence, and letting that through pinned a live conversation
  // to show_sequence for every subsequent sentence.
  const cleaned = sanitizeDelta({
    entities: [
      { id: "priya", type: "person", label: "Priya" },
      { id: "joining", type: "event", label: "joining" },
      { id: "month", type: "time", label: "last month" },
    ],
    relations: [
      { source: "priya", type: "precedes", target: "joining" },
      { source: "joining", type: "precedes", target: "month" },
    ],
    claims: [],
    interpretation: "",
  });
  check("a person cannot precede anything", !cleaned.relations.some((r) => r.source === "priya"));
  check("a genuine temporal relation survives", cleaned.relations.length === 1, JSON.stringify(cleaned.relations));
}

// ──────────────────────────────────────────────────────── rendering

section("render patch: the board is never wiped");

{
  const sceneA = { objects: [{ id: "o-1", regionId: "r-1", primitive: "node", x: 0, y: 0, w: 100, h: 50, weight: 1, label: "one" }], connectors: [], width: 100, height: 50 };
  const sceneB = {
    objects: [
      { id: "o-1", regionId: "r-1", primitive: "node", x: 0, y: 120, w: 100, h: 50, weight: 1, label: "one" },
      { id: "o-2", regionId: "r-2", primitive: "node", x: 0, y: 0, w: 100, h: 50, weight: 1, label: "two" },
    ],
    connectors: [],
    width: 100,
    height: 170,
  };
  const patch = diffScenes(sceneA, sceneB);
  check("an existing object moves rather than being re-created", patch.moved.length === 1 && patch.added.length === 1);
  check("nothing is removed when nothing went away", patch.removed.length === 0);
  check("the patch describes itself", describePatch(patch).length === 2);
}

// ──────────────────────────────────────────────── live speech cadence

section("live cadence: bursts coalesce, runs never race");

{
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const runs = [];
  let inFlightPeak = 0;
  let active = 0;

  const controller = new ExpressionLiveController({
    debounceMs: 15,
    extract: async (text) => {
      active += 1;
      inFlightPeak = Math.max(inFlightPeak, active);
      await sleep(25);
      active -= 1;
      runs.push(text);
      // One entity per run, named after the batch, so every run changes the world.
      return {
        entities: [{ id: "e", type: "concept", label: `run ${runs.length}` }],
        relations: [],
        claims: [],
        interpretation: text,
      };
    },
    onUpdate: (update) => updates.push(update),
  });
  const updates = [];

  // A burst: three thoughts inside one debounce window.
  controller.submit({ id: "t1", text: "AI makes apps easier to build." });
  controller.submit({ id: "t2", text: "So there will be thousands of apps." });
  controller.submit({ id: "t3", text: "Which creates a trust problem." });
  await sleep(80);

  check("a burst inside one window is one run, not three", runs.length === 1, `${runs.length} runs`);
  check("the batch is joined into one utterance", runs[0].includes("AI makes") && runs[0].includes("trust problem"));
  check("every buffered thought is reported as consumed", updates[0]?.consumedIds.join(",") === "t1,t2,t3", JSON.stringify(updates[0]?.consumedIds));

  // A thought arriving mid-run must be buffered, not raced.
  controller.submit({ id: "t4", text: "Fourth." });
  await sleep(5);
  controller.submit({ id: "t5", text: "Fifth." });
  await sleep(120);

  check("at most one run is ever in flight", inFlightPeak === 1, `peak ${inFlightPeak}`);
  check("thoughts that settle mid-run are not dropped", runs.length === 2 && runs[1].includes("Fifth"), JSON.stringify(runs));

  controller.reset();
  check("reset clears the world", controller.getWorld().entities.length === 0);
}

{
  // A run that changes nothing must not report consumption — the caller uses
  // that to decide whether to fade the speaker's transcript ink, and fading
  // ink for meaning that was never represented loses it silently.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const updates = [];
  const traces = [];
  const controller = new ExpressionLiveController({
    debounceMs: 10,
    extract: async () => ({ entities: [], relations: [], claims: [], interpretation: "" }),
    onUpdate: (u) => updates.push(u),
    onTrace: (t) => traces.push(t),
  });
  controller.submit({ id: "t1", text: "um, so, yeah." });
  await sleep(60);
  check("a no-change run reports no update", updates.length === 0);
  check("but it is still traced, so silence is distinguishable from breakage", traces.length === 1);
}

section("reflex: the canvas answers the first word, not the first clause");

{
  // The detector, on its own. A closed list, and everything outside it is
  // the extractor's job — a reflex that guessed would be drawing something
  // the next clause could contradict.
  check("\"I\" is recognised", reflexDelta("i")?.entities[0]?.id === "speaker");
  check("so is a contraction", reflexDelta("i'm")?.entities[0]?.id === "speaker");
  check("and a possessive mid-sentence", reflexDelta("so my team")?.entities[0]?.id === "speaker");
  check("first person plural is its own referent", reflexDelta("we")?.entities[0]?.id === "speaker-group");
  check("a sentence with no first person reflexes nothing", reflexDelta("the costs went up") === null);
  check("the reflex never invents a relation", reflexDelta("i was a teacher")?.relations.length === 0);
}

{
  // What the speaker HAS is the second thing fixed before the clause ends.
  // The determiner names the owner outright, so neither the thing nor its
  // tie to the speaker is waiting on the rest of the sentence.
  const mother = reflexDelta("so my mother");
  check("a possessed person is drawn with the speaker", mother?.entities.map((e) => e.id).join(",") === "speaker,mother");
  check("and the possessive itself is the relation", mother?.relations[0]?.type === "role_of" && mother?.relations[0]?.role === "mother");
  check("pointing from the person to the speaker", mother?.relations[0]?.source === "mother" && mother?.relations[0]?.target === "speaker");

  const team = reflexDelta("our team");
  check("a possessed group makes the speaker a member of it", team?.relations[0]?.type === "member_of");
  check("under the plural speaker, since that is who said it", team?.relations[0]?.source === "speaker-group");
  check("and it is typed as a group, not a person", team?.entities.find((e) => e.id === "team")?.type === "group");

  check("an adjective does not lose the noun behind it", reflexDelta("my old boss")?.entities[1]?.label === "my old boss");
  check("but the reach is finite", reflexDelta("my very very very old boss")?.entities.length === 1);
  check("two possessives in one breath are not cross-wired", reflexDelta("my team and our investors")?.relations.length === 2);

  // The closed list is the whole safety argument. A noun whose meaning is
  // what the speaker is ABOUT to say stays with the extractor.
  check("a noun the sentence has yet to define is left alone", reflexDelta("my point is")?.entities.length === 1);
  check("as is anything not owned at all", reflexDelta("the team shipped it") === null);

  // And it must still merge, not duplicate, when the settled run says the
  // same thing in its own words.
  const drawn = applyDelta(EMPTY_WORLD_STATE, reflexDelta("my team"), 0).world;
  const settled = applyDelta(drawn, {
    entities: [{ id: "t", type: "group", label: "the team" }],
    relations: [], claims: [], interpretation: "The team.",
  }, 1).world;
  check("the settled run adopts the reflex's group instead of minting a second", settled.entities.filter((e) => e.type === "group").length === 1, JSON.stringify(settled.entities.map((e) => e.id)));
}

{
  // "I" used to be dropped by applyDelta as an unresolvable pronoun, which
  // meant the world stayed empty and the canvas stayed blank. The speaker is
  // not an antecedent problem.
  const { world } = applyDelta(EMPTY_WORLD_STATE, reflexDelta("i"), 0);
  check("the speaker enters the world on the word alone", world.entities.length === 1, JSON.stringify(world.entities));
  check("under a stable id, so every later \"I\" is the same person", world.entities[0].id === "speaker");
  check("as the subject, so a grammar can build on it", world.entities[0].importance === "primary");

  // The second and third mention must not mint a second speaker.
  const two = applyDelta(world, reflexDelta("my team and i"), 1).world;
  check("a re-mention resolves to the same speaker", two.entities.filter((e) => e.id === "speaker").length === 1);

  // And "I" must never be resolved to whichever other person is salient.
  const withOther = applyDelta(EMPTY_WORLD_STATE, {
    entities: [{ id: "m", type: "person", label: "Mariam" }],
    relations: [], claims: [], interpretation: "Mariam.",
  }, 0).world;
  const after = applyDelta(withOther, reflexDelta("i"), 1).world;
  check("\"I\" is not absorbed by another person in the world", after.entities.some((e) => e.id === "speaker") && after.entities.some((e) => e.id === "mariam"), JSON.stringify(after.entities.map((e) => e.id)));
}

{
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const updates = [];
  let extracts = 0;
  const controller = new ExpressionLiveController({
    debounceMs: 900,
    // Deliberately slow: this is the window the reflex exists to draw inside.
    extract: async () => {
      extracts += 1;
      await sleep(300);
      return {
        entities: [
          { id: "me", type: "person", label: "I" },
          { id: "teacher", type: "concept", label: "teacher" },
        ],
        relations: [{ id: "r1", source: "me", type: "role_of", target: "teacher" }],
        claims: [], topicEntityId: "me", interpretation: "The speaker was a teacher.",
      };
    },
    onUpdate: (u) => updates.push(u),
  });

  const startedAt = Date.now();
  controller.reflex("i");
  await sleep(30);

  check("the first word draws before the debounce has even started counting", updates.length === 1, `${updates.length} updates`);
  check("and it draws the speaker", updates[0]?.trace.scene.objects.length === 1 && updates[0]?.trace.scene.objects[0].label === "I");
  check("well inside a spoken breath", Date.now() - startedAt < 200, `${Date.now() - startedAt}ms`);
  check("consuming nothing, so the transcript ink does not fade mid-sentence", updates[0]?.consumedIds.length === 0);
  check("and calling no model", extracts === 0);

  // Interims repeat several times a second. An unchanged reading must not
  // re-fold the world — that is what would turn a live board into a
  // flickering one.
  controller.reflex("i");
  controller.reflex("i was");
  controller.reflex("i was a");
  await sleep(30);
  check("repeated interims of the same reading cost nothing", updates.length === 1, `${updates.length} updates`);

  // The settled thought now arrives and must GROW what the reflex drew,
  // not duplicate it.
  controller.submit({ id: "t1", text: "I was a teacher" });
  await sleep(1400);

  check("the settled thought still runs", extracts === 1);
  check("and consumes its own thought", updates[updates.length - 1]?.consumedIds.join(",") === "t1");
  const world = controller.getWorld();
  check("the slow pass adopts the reflex's speaker instead of minting a second", world.entities.filter((e) => e.type === "person").length === 1, JSON.stringify(world.entities.map((e) => e.id)));
  check("and the picture grew around it", updates[updates.length - 1]?.trace.patch.added.length >= 1 && updates[updates.length - 1]?.trace.patch.removed.length === 0);

  controller.reset();
  check("reset clears the reflex's memory too", controller.getWorld().entities.length === 0);
}

section("anticipation: the board grows while the sentence is still being spoken");

{
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const updates = [];
  const asked = [];
  const reading = {
    entities: [
      { id: "costs", type: "concept", label: "rising costs" },
      { id: "team", type: "group", label: "the team" },
    ],
    relations: [{ id: "r1", source: "costs", type: "causes", target: "team" }],
    claims: [{ id: "c1", text: "this is a problem", about: ["costs"] }],
    referenceMentions: [],
    topicEntityId: "costs",
    interpretation: "Rising costs are pressuring the team.",
  };
  const controller = new ExpressionLiveController({
    debounceMs: 900,
    anticipateMs: 60,
    anticipateMinWords: 3,
    anticipateMaxPerUtterance: 2,
    extract: async (text) => {
      asked.push(text);
      await sleep(20);
      return reading;
    },
    onUpdate: (u) => updates.push(u),
  });

  controller.anticipate("the costs are");
  await sleep(120);

  check("a partial sentence reaches the canvas without waiting for the thought", updates.length === 1, `${updates.length} updates`);
  check("by asking the same extractor the settled run asks", asked[0] === "the costs are");
  check("and it draws the nouns", controller.getWorld().entities.length === 2, JSON.stringify(controller.getWorld().entities.map((e) => e.id)));
  // The whole safety argument for reading an unfinished clause: what it
  // says EXISTS is nearly always still true when the clause ends; what it
  // says CONNECTS is exactly what the rest of the clause decides.
  check("but never the structure — that stays the settled run's to own", controller.getWorld().relations.length === 0);
  check("nor the conclusions", controller.getWorld().claims.length === 0);
  check("consuming nothing, so the transcript ink does not fade mid-sentence", updates[0]?.consumedIds.length === 0);

  // Rationed, not debounced: a model call per interim would be several a
  // second, and every one of them would be reading the same words again.
  controller.anticipate("the costs are rising");
  check("a word or two more is not worth another call", asked.length === 1, `${asked.length} calls`);
  controller.anticipate("the costs are rising much faster now");
  await sleep(120);
  check("a whole new clause is", asked.length === 2, `${asked.length} calls`);
  controller.anticipate("the costs are rising much faster now than anyone expected");
  check("but one long sentence cannot run up an unbounded bill", asked.length === 2, `${asked.length} calls`);

  // And it must get out of the way the moment the real thing is coming.
  controller.endReflexUtterance();
  controller.submit({ id: "t1", text: "The costs are rising much faster than anyone expected" });
  controller.anticipate("and that is squeezing the whole team");
  check("a buffered thought stands the anticipation down", asked.length === 2, `${asked.length} calls`);

  await sleep(1400);
  check("the settled thought still runs", asked.length === 3);
  check("and consumes its own thought", updates[updates.length - 1]?.consumedIds.join(",") === "t1");
  const world = controller.getWorld();
  check("adopting what anticipation drew instead of duplicating it", world.entities.length === 2, JSON.stringify(world.entities.map((e) => e.id)));
  check("and finally adding the structure it was not allowed to guess", world.relations.length === 1);

  // Off means off: no request, no fold, no cost.
  const disabled = new ExpressionLiveController({
    anticipateMs: 0,
    extract: async () => { throw new Error("the anticipation pass must not call the extractor when it is off"); },
    onUpdate: () => {},
  });
  disabled.anticipate("the costs are rising much faster now");
  await sleep(50);
  check("and switching it off calls nothing at all", disabled.getWorld().entities.length === 0);
}

section("agent input: the same engine, a different caller");

/**
 * An agent-driven board, with the extractor stubbed the way the live
 * controller test above stubs it. `extracted` counts how many times the
 * extractor was reached at all, which is how the structured path proves it
 * skipped /api/express rather than merely ignoring the answer.
 */
function agentBoard(extract) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const events = [];
  const submitted = [];
  const controller = new ExpressionLiveController({
    debounceMs: 10,
    extract,
    onUpdate: (u) => events.push({ event: "updated", consumedIds: u.consumedIds, trace: u.trace }),
    onNoChange: (t) => events.push({ event: "noop", trace: t }),
    onError: (e, ids) => events.push({ event: "failed", error: e, consumedIds: ids }),
  });
  const entry = createExpressionEntry(controller, { onSubmit: (accepted) => submitted.push(accepted) });
  return { controller, entry, events, submitted, sleep };
}

const CAUSAL_DELTA = {
  entities: [
    { id: "ai", type: "concept", label: "AI" },
    { id: "apps", type: "concept", label: "thousands of apps" },
    { id: "trust", type: "concept", label: "a trust problem" },
  ],
  relations: [
    { id: "r1", source: "ai", type: "causes", target: "apps" },
    { id: "r2", source: "apps", type: "causes", target: "trust" },
  ],
  claims: [],
  interpretation: "AI makes apps easy to build, which creates a trust problem.",
};

{
  // Text in, exactly like a settled thought — the caller just has words.
  let extracted = 0;
  const board = agentBoard(async (text) => {
    extracted += 1;
    return { ...CAUSAL_DELTA, interpretation: text };
  });

  const result = await board.entry.express({ text: "AI is making it easier to build apps, so we end up with thousands of apps, which creates a trust problem." });

  check("an agent request runs the pipeline", result.status === "updated", `${result.status} ${result.error ?? ""}`);
  check("through the real extractor, since the caller supplied only words", extracted === 1, String(extracted));
  check("the segment is marked as coming from an agent", result.trace.input.source === "ai_agent", result.trace?.input.source);
  check("the same grammars are available to it", result.grammar === "cause_effect", result.grammar);
  check("the first agent turn is a full compose", result.mode === "full", result.mode);
  check("it drew the whole chain", result.objects === 3 && result.connectors === 2, `${result.objects}/${result.connectors}`);
  check("the caller gets an id back", result.id === result.trace.input.id);
  check("the outcome reached the Phase 0 update event too", board.events.at(-1)?.event === "updated");
  check("and the submitted hook fired once, before any pipeline work", board.submitted.length === 1 && board.submitted[0].structured === false);
}

{
  // Structured meaning in — the agent already knows what it means.
  let extracted = 0;
  const board = agentBoard(async () => {
    extracted += 1;
    return { entities: [], relations: [], claims: [], interpretation: "" };
  });

  const result = await board.entry.express({ delta: CAUSAL_DELTA, speakerId: "codex" });

  check("a structured request never reaches the extractor", extracted === 0, String(extracted));
  check("and still produces a scene", result.status === "updated" && result.objects === 3, `${result.status} ${result.objects}`);
  check("the delta's interpretation stands in for the text", result.trace.input.text === CAUSAL_DELTA.interpretation, result.trace?.input.text);
  check("the caller is recorded as the speaker", result.trace.input.speakerId === "codex", result.trace?.input.speakerId);
  check("the submitted hook says the meaning was structured", board.submitted[0]?.structured === true);
}

{
  // Two sequential agent calls behave exactly like Track B's multi-turn
  // speech: the board extends rather than redrawing.
  const board = agentBoard(async (text) =>
    text.includes("signups")
      ? { entities: [{ id: "signups", type: "event", label: "signups" }], relations: [{ id: "r2", source: "traffic", type: "causes", target: "signups" }], claims: [], interpretation: text }
      : {
          entities: [
            { id: "marketing", type: "event", label: "marketing" },
            { id: "traffic", type: "event", label: "traffic" },
          ],
          relations: [{ id: "r1", source: "marketing", type: "causes", target: "traffic" }],
          claims: [],
          interpretation: text,
        },
  );

  const first = await board.entry.express({ text: "Marketing creates traffic." });
  const second = await board.entry.express({ text: "And traffic creates signups." });

  check("the second agent turn is a patch, not a redraw", second.mode === "patch", `${first.mode} then ${second.mode}`);
  check("the chain the agent built earlier is still whole", second.reason.includes("marketing -> traffic -> signups"), second.reason);
  const before = first.trace.scene.objects.find((o) => o.entityId === "marketing");
  const after = second.trace.scene.objects.find((o) => o.entityId === "marketing");
  check("and what it drew first has not moved", before.x === after.x && before.y === after.y, `${before?.x},${before?.y} -> ${after?.x},${after?.y}`);
  check("only the new step is added to the canvas", second.trace.patch.added.length === 1 && second.trace.patch.moved.length === 0, describePatch(second.trace.patch).join(" | "));
}

{
  // Agent and speech share one conversation, not two.
  const board = agentBoard(async (text) => ({
    entities: [{ id: "traffic", type: "event", label: "traffic" }],
    relations: [],
    claims: [],
    interpretation: text,
  }));

  board.controller.submit({ id: "spoken-1", text: "Traffic is what we care about." });
  await board.sleep(60);
  const result = await board.entry.express({
    delta: {
      entities: [
        { id: "traffic", type: "event", label: "traffic" },
        { id: "signups", type: "event", label: "signups" },
      ],
      relations: [{ id: "r1", source: "traffic", type: "causes", target: "signups" }],
      claims: [],
      interpretation: "traffic creates signups",
    },
  });

  check("an agent extends the world speech built", result.status === "updated", result.status);
  check(
    "and does not fork it — one entity, mentioned by both",
    board.controller.getWorld().entities.filter((e) => e.id === "traffic").length === 1,
    board.controller.getWorld().entities.map((e) => e.id).join(", "),
  );
}

{
  // A delta submission is its own run: two deltas cannot be concatenated the
  // way two sentences can, so coalescing them would be inventing meaning.
  const board = agentBoard(async (text) => ({ entities: [{ id: "e", type: "concept", label: text.slice(0, 20) }], relations: [], claims: [], interpretation: text }));
  board.controller.submit({ id: "spoken", text: "A spoken clause." });
  void board.entry.express({ delta: CAUSAL_DELTA });
  await board.sleep(120);

  const runs = board.events.filter((e) => e.event === "updated");
  check("a delta is never batched with the text around it", runs.length === 2, `${runs.length} runs`);
  check("and the spoken clause still ran on its own", runs[0].consumedIds.join(",") === "spoken", JSON.stringify(runs[0]?.consumedIds));
}

{
  // Rejected requests: the entry is the boundary, so nothing malformed and
  // nothing carrying geometry can reach the world through it.
  const board = agentBoard(async () => ({ entities: [], relations: [], claims: [], interpretation: "" }));

  const geometric = await board.entry.express({
    delta: { entities: [{ id: "a", type: "concept", label: "A", x: 10, y: 20 }], relations: [], claims: [], interpretation: "drawn here" },
  });
  check("a delta carrying coordinates is refused", geometric.status === "failed", geometric.status);
  check("with a reason the caller can act on", Boolean(geometric.error), geometric.error);

  const empty = await board.entry.express({});
  check("a request with neither text nor meaning is refused", empty.status === "failed", empty.status);

  check("a refused request never reaches the pipeline", board.events.length === 0, JSON.stringify(board.events.map((e) => e.event)));
  check("and is never logged as submitted", board.submitted.length === 0);
  check("the world is untouched", board.controller.getWorld().entities.length === 0);
}

{
  // A caller that waits must always be answered — including when the run
  // fails, and including when the session is reset out from under it.
  const board = agentBoard(async () => {
    throw new Error("extractor unavailable");
  });
  const failedRun = await board.entry.express({ text: "Anything at all." });
  check("a run that throws resolves as failed rather than hanging", failedRun.status === "failed", failedRun.status);
  check("and carries the error through", failedRun.error?.includes("unavailable"), failedRun.error);
  check("the Phase 0 failure event still fires", board.events.at(-1)?.event === "failed");

  const pending = board.entry.express({ text: "Buffered when the session goes away." });
  board.controller.reset();
  const abandoned = await pending;
  check("a submission dropped by reset is settled, not left pending", abandoned.status === "failed", abandoned.status);
}

section("agent tool: the same entry point, over a wire");

/** The board an external agent reaches: one tool, over one entry, over one controller. */
function agentToolBoard(extract) {
  const board = agentBoard(extract);
  return { ...board, tool: createExpressTool(board.entry) };
}

{
  const board = agentToolBoard(async (text) => ({ ...CAUSAL_DELTA, interpretation: text }));
  const { definition } = board.tool;

  check("the tool has the published name", definition.name === EXPRESS_TOOL_NAME && definition.name === "express_meaning", definition.name);
  check("its description tells the agent to submit meaning, not shapes", definition.description.includes("Submit MEANING, not shapes"));
  check("the input schema offers exactly text / delta / speakerId", Object.keys(definition.inputSchema.properties).sort().join(",") === "delta,speakerId,text", Object.keys(definition.inputSchema.properties).join(","));
  check("and nothing else — an unlisted key is not a private extension point", definition.inputSchema.additionalProperties === false);
  check("there is no way to name a form", !JSON.stringify(definition.inputSchema).includes("diagramType"));
  check("the relation vocabulary is published, not guessed at", definition.inputSchema.properties.delta.properties.relations.items.properties.type.enum.includes("causes"));
}

{
  // The text path: words in, a drawing out — the call an agent makes when it
  // has a paragraph rather than a graph.
  let extracted = 0;
  const board = agentToolBoard(async (text) => {
    extracted += 1;
    return { ...CAUSAL_DELTA, interpretation: text };
  });

  const result = await board.tool.call({
    text: "AI is making it easier to build apps, so we end up with thousands of apps, which creates a trust problem.",
    speakerId: "claude-code",
  });

  check("a tool call runs the pipeline", result.status === "updated" && result.ok, `${result.status} ${result.error ?? ""}`);
  check("through the extractor, since the agent supplied only words", extracted === 1, String(extracted));
  check("the engine chose the form", result.grammar === "cause_effect", result.grammar);
  check("and the agent is told what got drawn", result.objects === 3 && result.connectors === 2, `${result.objects}/${result.connectors}`);
  check("the answer carries no trace — an agent gets an answer, not a debugger", !("trace" in result));
  check("the caller is recorded as the speaker", board.events.at(-1)?.trace.input.speakerId === "claude-code");
  check("and the turn is marked as coming from an agent", board.events.at(-1)?.trace.input.source === "ai_agent");
}

{
  // The delta path: structured meaning goes straight into the world fold.
  let extracted = 0;
  const board = agentToolBoard(async () => {
    extracted += 1;
    return { entities: [], relations: [], claims: [], interpretation: "" };
  });

  const result = await board.tool.call({ delta: CAUSAL_DELTA });
  check("structured meaning never reaches the extractor", extracted === 0, String(extracted));
  check("and still produces a scene", result.status === "updated" && result.objects === 3, `${result.status} ${result.objects}`);

  // Second turn, same world: the board extends rather than redrawing, which
  // is the property that makes a multi-turn agent conversation coherent.
  const second = await board.tool.call({
    delta: {
      entities: [
        { id: "trust", type: "concept", label: "a trust problem" },
        { id: "review", type: "concept", label: "review costs" },
      ],
      relations: [{ id: "r3", source: "trust", type: "causes", target: "review" }],
      claims: [],
      interpretation: "the trust problem drives review costs",
    },
  });
  check("a second call extends what the first drew", second.status === "updated" && second.mode === "patch", `${second.status} ${second.mode}`);
}

{
  // The boundary. Everything here must come back as a `failed` result the
  // agent can read — never a throw, and never a shape reaching the world.
  const board = agentToolBoard(async () => ({ entities: [], relations: [], claims: [], interpretation: "" }));

  const geometric = await board.tool.call({
    delta: { entities: [{ id: "a", type: "concept", label: "A", x: 10, y: 20 }], relations: [], claims: [], interpretation: "drawn here" },
  });
  check("a delta carrying coordinates is refused", geometric.status === "failed" && geometric.ok === false, geometric.status);
  check("and told which key was the problem", geometric.error?.includes('"x"') && geometric.error.includes("geometry rejected"), geometric.error);

  const elements = await board.tool.call({
    delta: { entities: [], relations: [], claims: [], interpretation: "here is the picture", elements: [{ type: "rectangle" }] },
  });
  check("so is a delta carrying canvas elements", elements.status === "failed", elements.status);

  const nested = await board.tool.call({
    delta: { entities: [{ id: "a", type: "concept", label: "A", quantity: { value: 3, width: 120 } }], relations: [], claims: [], interpretation: "three of them" },
  });
  check("geometry buried deeper in the delta is found too", nested.status === "failed" && nested.error.includes("width"), nested.error);

  const unknownKey = await board.tool.call({ text: "Fine.", grammar: "cause_effect" });
  check("an agent may not name the grammar", unknownKey.status === "failed", unknownKey.status);

  const empty = await board.tool.call({});
  check("a call with neither text nor meaning is refused", empty.status === "failed", empty.status);
  check("with the fix stated", empty.error?.includes("`text`"), empty.error);

  const malformed = await board.tool.call({ delta: { entities: "not an array", relations: [], claims: [], interpretation: "x" } });
  check("a malformed delta is refused by the same schema the model's output goes through", malformed.status === "failed", malformed.status);

  const notObject = await board.tool.call("draw me a flowchart");
  check("a call that is not even an object is answered, not thrown", notObject.status === "failed", notObject.status);

  check("no rejected call reached the pipeline", board.events.length === 0, JSON.stringify(board.events.map((e) => e.event)));
  check("and the world is untouched", board.controller.getWorld().entities.length === 0);
}

{
  // A run the engine understood but had nothing to draw for stays
  // distinguishable from a rejection — an agent that conflates them retries
  // the wrong one.
  const board = agentToolBoard(async () => ({ entities: [], relations: [], claims: [], interpretation: "" }));
  const result = await board.tool.call({ text: "Um, so, yeah." });
  check("an understood-but-empty run is a noop, not a failure", result.status === "noop", result.status);
  check("and is still reported as ok — nothing was rejected", result.ok === true);
}

section("canvas sync: patched, never wiped");

{
  const scene = {
    objects: [
      { id: "o-a", entityId: "alpha", regionId: "r-a", primitive: "node", label: "Alpha", x: 0, y: 0, w: 200, h: 72, weight: 2 },
      { id: "o-b", entityId: "beta", regionId: "r-b", primitive: "node", label: "Beta", x: 0, y: 160, w: 200, h: 72, weight: 1 },
    ],
    connectors: [],
    width: 200,
    height: 232,
  };
  const origin = { x: 100, y: 50 };
  const first = skeletonsForScene(scene, origin);

  check("every element the region owns has a derived id", first.every((s) => typeof s.id === "string" && s.id.length));
  check(
    "conversion is idempotent — same scene, byte-identical skeletons",
    JSON.stringify(first) === JSON.stringify(skeletonsForScene(scene, origin)),
  );
  check("labels are standalone text with a derived id, never bound", first.some((s) => s.id === "o-a-label" && s.type === "text") && first.every((s) => s.label === undefined));

  const identity = createExpressionIdentity();
  const emptyPatch = { added: [], moved: [], updated: [], removed: [], connectorsAdded: [], connectorsRemoved: [], connectorsRerouted: [] };

  // First pass: everything is new.
  const fresh = planCanvasDiff(first, [], identity, emptyPatch);
  check("a first pass adds everything", fresh.addedIds.length === first.length && fresh.updatedIds.length === 0);

  // Pretend it was written.
  const written = first.map((s) => ({ id: String(s.id), type: s.type, x: s.x, y: s.y, width: s.width ?? 0, height: s.height ?? 0, opacity: 100 }));
  for (const s of first) identity.signatureByElementId.set(String(s.id), JSON.stringify(s));

  const again = planCanvasDiff(first, written, identity, emptyPatch);
  check("re-syncing an unchanged scene touches nothing", again.rebuild.length === 0 && again.removedIds.length === 0, JSON.stringify(again.addedIds.concat(again.updatedIds)));

  // Move one object; the other must be left strictly alone.
  const moved = { ...scene, objects: [scene.objects[0], { ...scene.objects[1], y: 300 }], height: 372 };
  const movedSkeletons = skeletonsForScene(moved, origin);
  const afterMove = planCanvasDiff(movedSkeletons, written, identity, emptyPatch);
  check("a moved object is updated in place, keeping its id", afterMove.updatedIds.includes("o-b") && !afterMove.addedIds.includes("o-b"));
  check("the object that did not move is not touched", !afterMove.updatedIds.includes("o-a") && !afterMove.addedIds.includes("o-a"), JSON.stringify(afterMove.updatedIds));

  // Drop an object; its elements must be removed, not orphaned.
  const dropped = { ...scene, objects: [scene.objects[0]], height: 72 };
  const afterDrop = planCanvasDiff(skeletonsForScene(dropped, origin), written, identity, emptyPatch);
  check("a dropped object's elements are removed", afterDrop.removedIds.includes("o-b") && afterDrop.removedIds.includes("o-b-label"), JSON.stringify(afterDrop.removedIds));
  check("and the surviving object is still not touched", !afterDrop.updatedIds.includes("o-a"));
}

section("canvas sync: the Drawing Agent reaches the live board");

{
  // Break C: sketchKey was on every scene object and the Excalidraw renderer
  // ignored it, so the live canvas only ever drew rounded rects while the
  // lab's SVG drew icons from the same scene.
  const sketchScene = {
    objects: [
      { id: "o-a", entityId: "alpha", regionId: "r-a", primitive: "node", label: "Alpha", sketchKey: "concept:alpha", x: 0, y: 0, w: 200, h: 100, weight: 2 },
      { id: "o-b", entityId: "beta", regionId: "r-b", primitive: "node", label: "Beta", sketchKey: "concept:beta", x: 0, y: 160, w: 200, h: 100, weight: 1 },
    ],
    connectors: [],
    width: 200,
    height: 260,
  };
  const origin = { x: 100, y: 50 };
  // Two strokes spanning the full unit square, so scaling errors are visible.
  const sketch = { strokes: [{ points: [[0, 0], [100, 100]] }, { points: [[100, 0], [0, 100]] }] };
  const sketches = new Map([["concept:alpha", sketch]]);

  const without = skeletonsForScene(sketchScene, origin);
  const withSketch = skeletonsForScene(sketchScene, origin, sketches);

  check("without a sketch, a node is still a rounded rect", without.some((s) => s.id === "o-a" && s.type === "rectangle"));
  check("with a sketch, the rect is replaced by stroke lines", withSketch.some((s) => s.id === "o-a-sketch-0" && s.type === "line") && !withSketch.some((s) => s.id === "o-a"));
  check("one stroke becomes exactly one element", withSketch.filter((s) => String(s.id).startsWith("o-a-sketch-")).length === sketch.strokes.length);
  check("a sketched node keeps its label", withSketch.some((s) => s.id === "o-a-label" && s.type === "text"));
  check("an object with no sketch in the map keeps its fallback", withSketch.some((s) => s.id === "o-b" && s.type === "rectangle"));

  // Geometry: strokes must land inside the box the composer reserved, at the
  // page origin — the same 100x100 -> box mapping the SVG renderer uses.
  const strokes = withSketch.filter((s) => String(s.id).startsWith("o-a-sketch-"));
  const inBox = strokes.every((s) => {
    const absolute = s.points.map(([px, py]) => [s.x + px, s.y + py]);
    return absolute.every(([px, py]) => px >= origin.x && px <= origin.x + 200 && py >= origin.y && py <= origin.y + 100);
  });
  check("stroke geometry lands inside the object's reserved box, at the page origin", inBox, JSON.stringify(strokes.map((s) => [s.x, s.y, s.points])));

  check(
    "sketched conversion is idempotent — same scene and sketches, byte-identical skeletons",
    JSON.stringify(withSketch) === JSON.stringify(skeletonsForScene(sketchScene, origin, sketches)),
  );

  // applyStableIds requires 1:1 skeleton->element; a sketch must not break it.
  check("every sketch skeleton carries a derived id", withSketch.every((s) => typeof s.id === "string" && s.id.length));

  // A sketch arriving late must dirty exactly the node it belongs to.
  const identity = createExpressionIdentity();
  const emptyPatch = { added: [], moved: [], updated: [], removed: [], connectorsAdded: [], connectorsRemoved: [], connectorsRerouted: [] };
  const written = without.map((s) => ({ id: String(s.id), type: s.type, x: s.x, y: s.y, width: s.width ?? 0, height: s.height ?? 0, opacity: 100 }));
  for (const s of without) identity.signatureByElementId.set(String(s.id), JSON.stringify(s));
  const afterSketch = planCanvasDiff(withSketch, written, identity, emptyPatch);
  check("a late sketch removes the placeholder rect", afterSketch.removedIds.includes("o-a"), JSON.stringify(afterSketch.removedIds));
  check("and adds the strokes", afterSketch.addedIds.includes("o-a-sketch-0"), JSON.stringify(afterSketch.addedIds));
  check("while the un-sketched node is left strictly alone", !afterSketch.updatedIds.includes("o-b") && !afterSketch.addedIds.includes("o-b"));

  // R1 two-phase render: the first frame is drawn from the sketch cache as it
  // stands, NOT from an empty map. A concept drawn earlier in the session
  // costs nothing to include, so waiting for it would be waiting for nothing.
  // Only keys the cache has never seen defer to the second commit.
  const warmCache = new Map([["concept:alpha", sketch]]);
  const deferred = pendingSketchKeys(sketchScene.objects, warmCache);
  check("a half-warm scene defers only the keys it has never seen", deferred.length === 1 && deferred[0] === "concept:beta", deferred.join(","));

  const phaseOne = skeletonsForScene(sketchScene, origin, warmCache);
  check("the structural frame already carries the cached sketch", phaseOne.some((s) => s.id === "o-a-sketch-0"));
  check("and a plain node for the one still being drawn", phaseOne.some((s) => s.id === "o-b" && s.type === "rectangle"));

  const twoPhaseIdentity = createExpressionIdentity();
  const phaseOneWritten = phaseOne.map((s) => ({ id: String(s.id), type: s.type, x: s.x, y: s.y, width: s.width ?? 0, height: s.height ?? 0, opacity: 100 }));
  for (const s of phaseOne) twoPhaseIdentity.signatureByElementId.set(String(s.id), JSON.stringify(s));

  const bothSketches = new Map([["concept:alpha", sketch], ["concept:beta", sketch]]);
  const phaseTwo = planCanvasDiff(skeletonsForScene(sketchScene, origin, bothSketches), phaseOneWritten, twoPhaseIdentity, emptyPatch);
  check("the second commit upgrades the node whose sketch just arrived", phaseTwo.removedIds.includes("o-b") && phaseTwo.addedIds.includes("o-b-sketch-0"), JSON.stringify(phaseTwo.addedIds));
  check(
    "and does not touch the node that was already sketched in phase one",
    !phaseTwo.updatedIds.includes("o-a-sketch-0") && !phaseTwo.addedIds.includes("o-a-sketch-0") && !phaseTwo.removedIds.includes("o-a-sketch-0"),
    JSON.stringify({ u: phaseTwo.updatedIds, a: phaseTwo.addedIds, r: phaseTwo.removedIds }),
  );
  check(
    "a second commit with nothing new resolved is a no-op",
    planCanvasDiff(skeletonsForScene(sketchScene, origin, warmCache), phaseOneWritten, twoPhaseIdentity, emptyPatch).rebuild.length === 0,
  );
}

{
  // An empty scene is "nothing new worth showing", never "erase the board".
  const identity = createExpressionIdentity();
  const existing = [{ id: "o-a", type: "rectangle", x: 0, y: 0, width: 10, height: 10, opacity: 100 }];
  const result = await syncExpressionCanvas(
    { objects: [], connectors: [], width: 0, height: 0 },
    { added: [], moved: [], updated: [], removed: [], connectorsAdded: [], connectorsRemoved: [], connectorsRerouted: [] },
    existing,
    newPen(0, 0),
    0,
    identity,
  );
  check("an empty scene leaves the sheet alone", result.elements === existing && !result.removedIds.length);
}

{
  // Live eval #1, finding #6: an unrelated page turn (Tier 1's own
  // "long-utterance" turn, or anything else) can leave `identity.originPage`
  // stale relative to the current page BEFORE the expression engine's next
  // round runs. That round may carry an EMPTY RenderPatch (no semantic
  // change) even though the scene's own footprint no longer fits the old
  // region — and previously that alone was enough to fire onOverflow and
  // silently re-anchor (and thus redraw) the whole unchanged scene. The
  // invariant: no meaningful visual delta, no automatic page turn, no redraw.
  const scene = {
    objects: [{ id: "o-a", entityId: "alpha", regionId: "r-a", primitive: "node", label: "Alpha", x: 0, y: 0, w: 200, h: 72, weight: 2 }],
    connectors: [],
    width: 200,
    height: 72,
  };
  const emptyPatch = { added: [], moved: [], updated: [], removed: [], connectorsAdded: [], connectorsRemoved: [], connectorsRerouted: [] };
  const nonEmptyPatch = { ...emptyPatch, added: [{ id: "o-a", entityId: "alpha", regionId: "r-a", primitive: "node", x: 0, y: 0, w: 200, h: 72, weight: 2 }] };

  const identity = createExpressionIdentity();
  identity.origin = { x: 100, y: 50 };
  identity.originPage = 0;
  identity.regionW = 1; // deliberately smaller than the scene, so needsRegion would be true
  identity.regionH = 1;
  const existing = [{ id: "o-a", type: "rectangle", x: 100, y: 50, width: 200, height: 72, opacity: 100 }];

  // Wrapped in try/catch, not because a healthy run needs it (the patch-is-
  // empty short circuit returns long before any @excalidraw/excalidraw
  // import — see the empty-scene test above for why that import is
  // unavailable here), but so that a REGRESSION reports as a failed check
  // rather than crashing the whole suite: without the fix, an empty patch no
  // longer stops a re-anchor, so this call reaches the very import this test
  // file otherwise avoids on purpose.
  let overflowFired = false;
  let resultNoDelta = null;
  try {
    resultNoDelta = await syncExpressionCanvas(
      scene,
      emptyPatch,
      existing,
      newPen(0, 0),
      1, // page already turned since the region was reserved — the stale condition
      identity,
      () => { overflowFired = true; },
    );
  } catch {
    /* a regression here throws — treated as failure below, not a crash */
  }
  check("no page turn when the patch is empty, even with a stale page and an undersized region", !overflowFired);
  check("no redraw when the patch is empty", resultNoDelta !== null && resultNoDelta.elements === existing && !resultNoDelta.addedIds.length && !resultNoDelta.updatedIds.length);
  check("the region is left exactly as it was — no silent re-anchor", identity.originPage === 0 && identity.regionW === 1);

  // Past the onOverflow call, syncExpressionCanvas needs the real (browser-
  // only) @excalidraw/excalidraw package to convert skeletons — unavailable
  // in this plain-node test, same limitation the empty-scene test above
  // sidesteps by construction. onOverflow itself fires synchronously before
  // that import, so the assertion below is unaffected by the rejection.
  // Pen positioned far down an otherwise-empty page so the needed region
  // genuinely cannot fit — newPen(0, 0) has an entire fresh page of room and
  // would never overflow regardless of this fix, so it can't tell "overflow
  // suppressed" apart from "overflow was never going to happen anyway".
  const overflowingPen = { originX: 0, originY: 0, x: 0, y: 100000, lineH: 0 };
  try {
    await syncExpressionCanvas(scene, nonEmptyPatch, existing, overflowingPen, 1, identity, () => { overflowFired = true; });
  } catch {
    /* expected in this environment — see comment above */
  }
  check("a genuine content change with a stale/undersized region still turns the page", overflowFired);
}

{
  // Same-topic occupancy at capacity must grow in place, not flip the sheet.
  const stay = decideExpressionOverflow({
    neededW: 900,
    neededH: 900,
    alreadyOnThisPage: true,
    topicChanged: false,
    msSincePreviousTurn: 4000,
    fitsBlankPage: true,
  });
  check("same-topic overflow on the current page does not turn", !stay.turn, stay.reason);

  const stayOnTopicShift = decideExpressionOverflow({
    neededW: 900,
    neededH: 900,
    alreadyOnThisPage: true,
    topicChanged: true,
    msSincePreviousTurn: 20_000,
    fitsBlankPage: true,
  });
  check("even a focus change does not flip a sheet the diagram already owns", !stayOnTopicShift.turn, stayOnTopicShift.reason);

  const tooBig = decideExpressionOverflow({
    neededW: 900,
    neededH: 900,
    alreadyOnThisPage: false,
    topicChanged: true,
    msSincePreviousTurn: null,
    fitsBlankPage: false,
  });
  check("a scene bigger than a blank page does not thrash into a turn", !tooBig.turn, tooBig.reason);

  const cooldown = decideExpressionOverflow({
    neededW: 400,
    neededH: 400,
    alreadyOnThisPage: false,
    topicChanged: false,
    msSincePreviousTurn: 3000,
    fitsBlankPage: true,
  });
  check("same-topic overflow inside the cooldown does not turn", !cooldown.turn, cooldown.reason);

  const topicShift = decideExpressionOverflow({
    neededW: 400,
    neededH: 400,
    alreadyOnThisPage: false,
    topicChanged: true,
    msSincePreviousTurn: 20_000,
    fitsBlankPage: true,
  });
  check("a real topic change on a full sheet still turns", topicShift.turn, topicShift.reason);
}

{
  // Already on this page with a scene taller than the sheet: grow the
  // reserved region, never fire onOverflow. This is the occupancy storm.
  const tall = {
    objects: Array.from({ length: 8 }, (_, i) => ({
      id: `o-${i}`,
      entityId: `e${i}`,
      regionId: `r-${i}`,
      primitive: "node",
      label: `N${i}`,
      x: 0,
      y: i * 140,
      w: 200,
      h: 72,
      weight: i === 0 ? 2 : 1,
    })),
    connectors: [],
    width: 200,
    height: 8 * 140,
  };
  const growingPatch = {
    added: [tall.objects[7]],
    moved: [],
    updated: [],
    removed: [],
    connectorsAdded: [],
    connectorsRemoved: [],
    connectorsRerouted: [],
  };
  const identity = createExpressionIdentity();
  identity.origin = { x: 72, y: 16 };
  identity.originPage = 0;
  identity.regionW = 320;
  identity.regionH = 200;
  let overflowFired = false;
  try {
    await syncExpressionCanvas(
      tall,
      growingPatch,
      [],
      newPen(0, 0),
      0,
      identity,
      () => { overflowFired = true; },
      undefined,
      { topicChanged: false, msSincePreviousTurn: 1000, insetRight: LIVE_CAPTION_RAIL_W },
    );
  } catch {
    /* conversion import is browser-only; overflow is decided before it */
  }
  check("growing a same-page scene does not page-turn", !overflowFired);
  check("the reserved region grew in place instead", identity.originPage === 0 && identity.regionH > 200, `h=${identity.regionH}`);
}

section("sketch quality: noisy glyphs fall back to a labelled node");

{
  check("a one-stroke scribble is abstract", sketchLooksAbstract({ strokes: [{ points: [[10, 10], [12, 11]] }] }));
  check(
    "a tight cluster is abstract",
    sketchLooksAbstract({
      strokes: [
        { points: [[50, 50], [51, 50], [51, 51]] },
        { points: [[50, 50], [50, 51]] },
      ],
    }),
  );
  const readable = {
    strokes: [
      { points: [[10, 80], [20, 20], [30, 80]] },
      { points: [[15, 50], [25, 50]] },
      { points: [[40, 80], [40, 20], [55, 20], [55, 80], [40, 80]] },
    ],
  };
  check("a spread, structured glyph is kept", !sketchLooksAbstract(readable));

  const tooBusy = {
    strokes: Array.from({ length: 24 }, (_, i) => ({
      points: [[10, 10 + i * 3], [90, 10 + i * 3]],
    })),
  };
  check("more than 20 strokes is too busy for a node-sized drawing", sketchLooksAbstract(tooBusy));
  check(
    "the busy-sketch reason names the cap",
    sketchRejectionReason(tooBusy)?.startsWith("too many strokes") === true,
    String(sketchRejectionReason(tooBusy)),
  );
  check(
    "short marks with no contour under them are still rejected",
    sketchRejectionReason({
      strokes: Array.from({ length: 12 }, (_, i) => ({
        points: [[10 + i * 6, 10 + i * 5], [12 + i * 6, 12 + i * 5]],
      })),
    })?.startsWith("no contour") === true,
  );
  check("every rejection names its reason", sketchRejectionReason({ strokes: [{ points: [[1, 1], [2, 2]] }] }) === "single stroke");
}

section("sketch resolution: which keys would cost a model call");

{
  const objects = [
    { sketchKey: "concept:trust", label: "trust" },
    { sketchKey: "concept:trust", label: "trust" },
    { sketchKey: "object:knife", label: "knife" },
    { label: "no key at all" },
  ];
  const cache = new Map([["concept:trust", { strokes: [{ points: [[0, 0], [1, 1]] }] }]]);
  const pending = pendingSketchKeys(objects, cache);
  check("a cached key is not pending", !pending.includes("concept:trust"));
  check("an unseen key is pending exactly once", pending.filter((k) => k === "object:knife").length === 1);
  check("an object with no sketchKey is not pending", pending.length === 1, pending.join(","));
  check("a fully cached scene has nothing to defer", pendingSketchKeys([objects[0]], cache).length === 0);
}

section("live cadence: pending work is observable");

{
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const controller = new ExpressionLiveController({
    debounceMs: 40,
    extract: async () => {
      await sleep(30);
      return { entities: [], relations: [], claims: [], interpretation: "" };
    },
    onUpdate: () => {},
  });
  check("idle controller is not pending", !controller.hasPending());
  controller.submit({ id: "p1", text: "Rising costs push teams to consolidate tools." });
  check("a buffered submission is pending", controller.hasPending());
  await sleep(120);
  check("a finished run is no longer pending", !controller.hasPending());
}

{
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const noops = [];
  const controller = new ExpressionLiveController({
    debounceMs: 10,
    extract: async () => ({ entities: [], relations: [], claims: [], interpretation: "" }),
    onUpdate: () => {},
    onNoChange: (t, ids) => noops.push({ reason: t.plan.reason, ids }),
  });
  controller.submit({ id: "n1", text: "um, so, yeah." });
  await sleep(60);
  check("noop reports the consumed thought ids", noops.length === 1 && noops[0].ids?.[0] === "n1", JSON.stringify(noops[0]));
}

section("live experience: multi-minute same-topic occupancy");

{
  // A long narrative on one topic, occupancy at the page budget. Before the
  // overflow policy, every round whose scene grew past the reserved region
  // would have turned the page. After: same-topic rounds stay.
  const speak = liveSession();
  const maxContentH = PAGE_H - PAGE_PAD * 2;
  const maxContentW = PAGE_W - PAGE_PAD * 2 - LIVE_CAPTION_RAIL_W;
  let occupancyMax = 0;
  let preservationSum = 0;
  let patchTurns = 0;
  let wouldTurnLegacy = 0;
  let wouldTurnNow = 0;
  let lastHeight = 0;
  let lastTopic = undefined;
  const turns = 16;
  for (let i = 0; i < turns; i += 1) {
    const id = `step-${i}`;
    const prev = i === 0 ? null : `step-${i - 1}`;
    // The previous beat is RE-DECLARED, which is what the extractor is
    // instructed to do (meaning/extract.ts: "a relation can only join two
    // of THIS extraction's own local ids"). Without it applyDelta drops
    // every relation as unresolvable, and this scenario silently became 16
    // disconnected beats — which then filled the page only because
    // attachRelatedEntities used to pad the budget with unconnected boxes.
    // The chain is the whole point of the scenario, so it has to exist.
    const result = speak({
      entities: prev
        ? [{ id: prev, type: "event", label: `beat ${i - 1}` }, { id, type: "event", label: `beat ${i}` }]
        : [{ id, type: "event", label: `beat ${i}` }],
      relations: prev ? [{ id: `r-${i}`, source: prev, type: "causes", target: id }] : [],
      claims: [],
      interpretation: `beat ${i} follows`,
    });
    occupancyMax = Math.max(occupancyMax, result.scene.objects.length);
    const evaluation = evaluateScene(result.world, result.scene);
    preservationSum += evaluation.semanticPreservation;
    if (result.mode === "patch") patchTurns += 1;
    const neededH = Math.ceil(result.scene.height * 1.12);
    const neededW = Math.ceil(result.scene.width * 1.12);
    const grew = result.scene.height > lastHeight;
    lastHeight = result.scene.height;
    const topic = result.plan.focusEntityId ?? result.plan.regions[0]?.entityId;
    const topicChanged = lastTopic !== undefined && topic !== lastTopic;
    lastTopic = topic;
    // Legacy: any growth that exceeded the sheet turned.
    if (grew && (neededH > maxContentH || neededW > maxContentW || result.scene.objects.length >= 8)) {
      wouldTurnLegacy += 1;
    }
    const decision = decideExpressionOverflow({
      neededW,
      neededH,
      alreadyOnThisPage: i > 0,
      topicChanged,
      msSincePreviousTurn: i === 0 ? null : 4000,
      fitsBlankPage: neededH <= maxContentH && neededW <= maxContentW,
    });
    if (decision.turn) wouldTurnNow += 1;
  }
  const meanPreservation = preservationSum / turns;
  check("a long same-topic narrative mostly patches", patchTurns >= turns - 2, `patches=${patchTurns}/${turns}`);
  check("occupancy stays at the page budget rather than exploding", occupancyMax <= 12, `max=${occupancyMax}`);
  check("legacy overflow would have turned at least once as the chain grew", wouldTurnLegacy >= 1, `legacyTurns=${wouldTurnLegacy}`);
  check("the new policy does not turn while the scene already owns the page", wouldTurnNow === 0, `newTurns=${wouldTurnNow}`);
  check("preservation stays readable across the narrative", meanPreservation >= 0.5, `mean=${meanPreservation.toFixed(3)}`);
  console.log(
    `  narrative ${turns} turns: occupancyMax=${occupancyMax} patches=${patchTurns} preservation=${meanPreservation.toFixed(3)} pageTurns legacy=${wouldTurnLegacy} now=${wouldTurnNow}`,
  );
}

section("clean agent: occupancy police");

{
  const session = new ExpressionSession({ extract: async () => ({ entities: [], relations: [], claims: [], interpretation: "" }) });
  const wants = ["startup", "funding", "house", "car", "travel", "team"];
  let last = null;
  for (let i = 0; i < wants.length; i += 1) {
    last = await session.ingestDelta(
      { id: `c${i}`, source: "human_text", text: `I want a ${wants[i]}`, seq: i },
      {
        entities: [
          { id: "i", type: "person", label: "I" },
          { id: wants[i], type: "concept", label: wants[i] },
        ],
        relations: [{ id: `rw${i}`, source: "i", type: "wants", target: wants[i] }],
        claims: [],
        interpretation: `I want a ${wants[i]}`,
      },
    );
  }
  const nodes = last.scene.objects.filter((o) => o.entityId);
  check("a wants list is capped at six nodes", nodes.length <= MAX_CLEAN_NODES, nodes.map((o) => o.label).join(", "));
  check("the clean plan is on the settled trace", Boolean(last.clean?.primaryId), JSON.stringify(last.clean && { primary: last.clean.primaryId, keep: last.clean.keep }));
  check("exactly one dominant node", nodes.filter((o) => o.weight >= 3).length <= 1, nodes.map((o) => `${o.label}:${o.weight}`).join(", "));
  check("the snapshot is entity-keyed", last.board.nodes.every((n) => typeof n.id === "string" && n.size > 0));
}

{
  const session = new ExpressionSession({ extract: async () => ({ entities: [], relations: [], claims: [], interpretation: "" }) });
  const reflex = await session.ingestDelta(
    { id: "reflex-clean", source: "human_speech", text: "I", seq: 0 },
    { entities: [{ id: "i", type: "person", label: "I" }], relations: [], claims: [], interpretation: "I" },
    { contextless: true },
  );
  check("reflex skips the clean agent", reflex.clean === null);
  check(
    "anticipation on an empty board also skips",
    shouldPoliceVisual({ contextless: true, segmentId: "anticipate-0", snapshot: snapshotBoard(null) }) === false,
  );
}

{
  const applied = applyDelta(
    EMPTY_WORLD_STATE,
    {
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
    },
    0,
  );
  const raw = planExpression(applied.world, classifyIntent(applied.world, { entities: [], relations: [], claims: [], interpretation: "" }));
  const clean = planClean({
    snapshot: snapshotBoard(null),
    delta: { entities: applied.world.entities.map((e) => ({ id: e.id, type: e.type, label: e.label })), relations: [], claims: [], interpretation: "" },
    world: applied.world,
    newEntityIds: applied.world.entities.map((e) => e.id),
  });
  const plan = applyCleanToPlan(raw, clean, applied.world);
  check("clean plan validates", CleanPlanSchema.safeParse(clean).success);
  check("applying it does not invent regions", plan.regions.filter((r) => r.entityId).every((r) => clean.keep.includes(r.entityId)));
  const prev = compose(applied.world, raw);
  const next = compose(applied.world, plan);
  const patch = constrainPatch(diffScenes(prev, next), clean, prev);
  check(
    "the renderer cannot add a rejected entity",
    !patch.added.some((o) => o.entityId && !clean.keep.includes(o.entityId)),
    patch.added.map((o) => o.entityId).join(","),
  );
}

// ──────────────────────────────────────────────────── extractor guards

section("extractor sanitisation");

check("json is recovered from a fenced response", Boolean(extractJsonObject('```json\n{"a":1}\n```')));
check("a brace inside a string does not end the object", JSON.stringify(extractJsonObject('{"a":"}"}')) === '{"a":"}"}');
{
  const cleaned = sanitizeDelta({
    entities: [{ id: "Kenny Farmer!", type: "person", label: "Kenny Farmer" }],
    relations: [{ source: "Kenny Farmer!", type: "causes", target: "ghost" }],
    claims: [],
    interpretation: "x",
  });
  check("ids are slugged", cleaned.entities[0].id === "kenny-farmer", cleaned.entities[0].id);
  check("a relation to a non-existent entity is dropped, not repaired into a guess", cleaned.relations.length === 0);
}

// ─────────────────────────────────────────────────────────── corpus

section(`corpus: ${CORPUS.length} cases across ${CORPUS_CATEGORIES.length} categories`);

const stats = { preservation: [], intents: new Map(), grammars: new Map(), repaired: 0, repairsKept: 0 };
const perCategory = new Map();

for (const testCase of CORPUS) {
  const session = new ExpressionSession({ extract: async () => ({ entities: [], relations: [], claims: [], interpretation: "" }) });
  let trace = null;
  let failed = null;

  for (const [index, turn] of testCase.turns.entries()) {
    const parsedDelta = MeaningDeltaSchema.safeParse(turn.delta);
    if (!parsedDelta.success) {
      failed = `turn ${index} fixture is not a valid MeaningDelta: ${parsedDelta.error.issues[0]?.message}`;
      break;
    }
    trace = await session.ingestDelta({ id: `t${index}`, source: "human_text", text: turn.text, seq: index }, parsedDelta.data);
  }

  if (failed) {
    failures.push(`${testCase.name} — ${failed}`);
    continue;
  }

  const { world, plan, scene, evaluation, intent, repair, repairOutcome } = trace;
  const expect = testCase.expect ?? {};
  const label = `[${testCase.category}] ${testCase.name}`;

  check(`${label}: world validates`, WorldStateSchema.safeParse(world).success);
  check(`${label}: plan validates`, ExpressionPlanSchema.safeParse(plan).success);
  check(`${label}: scene validates`, ScenePlanSchema.safeParse(scene).success);
  check(`${label}: nothing was invented`, evaluation.inventedRelations.length === 0, evaluation.inventedRelations.join("; "));
  check(`${label}: nothing overlaps`, !evaluation.problems.some((p) => p.type === "overlap"));

  const threshold = expect.minPreservation ?? 0.85;
  check(
    `${label}: meaning survives (>= ${threshold})`,
    evaluation.semanticPreservation >= threshold,
    `got ${evaluation.semanticPreservation}; ${evaluation.problems.map((p) => `${p.type}:${p.detail}`).join(" | ")}`,
  );

  if (expect.intent) {
    const allowed = Array.isArray(expect.intent) ? expect.intent : [expect.intent];
    check(`${label}: intent is ${allowed.join("/")}`, allowed.includes(intent.primary), `${intent.primary} (${intent.reason})`);
  }
  if (expect.grammar) {
    const allowed = Array.isArray(expect.grammar) ? expect.grammar : [expect.grammar];
    check(`${label}: grammar is ${allowed.join("/")}`, allowed.includes(plan.grammar), `${plan.grammar} (${plan.reason})`);
  }
  // The two things actually set against each other. Asserted by region role
  // rather than by the plan's reason string, so this checks what gets DRAWN.
  if (expect.comparisonPoles) {
    const poles = plan.regions.filter((r) => r.role === "comparison_pole").map((r) => r.entityId).sort();
    const wanted = [...expect.comparisonPoles].sort();
    check(
      `${label}: poles are ${wanted.join(" vs ")}`,
      poles.length === wanted.length && poles.every((id, i) => id === wanted[i]),
      `got ${poles.join(" vs ") || "none"} (${plan.reason})`,
    );
  }
  if (expect.entitiesDrawn) {
    for (const id of expect.entitiesDrawn) {
      check(`${label}: "${id}" is on the canvas`, scene.objects.some((o) => o.entityId === id), scene.objects.map((o) => o.entityId).join(","));
    }
  }
  if (expect.noAmbiguity) {
    check(
      `${label}: no ambiguous relation`,
      !evaluation.problems.some((p) => p.type === "ambiguous_relation"),
      evaluation.problems.filter((p) => p.type === "ambiguous_relation").map((p) => p.detail).join("; "),
    );
  }
  if (expect.entityCount !== undefined) {
    check(`${label}: ${expect.entityCount} entities`, world.entities.length === expect.entityCount, `got ${world.entities.length}: ${world.entities.map((e) => e.label).join(", ")}`);
  }
  if (expect.finalEntityCount !== undefined) {
    check(
      `${label}: ${expect.finalEntityCount} entities after all turns`,
      world.entities.length === expect.finalEntityCount,
      `got ${world.entities.length}: ${world.entities.map((e) => e.label).join(", ")}`,
    );
  }
  if (expect.supersededEntities !== undefined) {
    check(
      `${label}: ${expect.supersededEntities} superseded`,
      world.entities.filter((e) => e.status === "superseded").length === expect.supersededEntities,
    );
  }

  // The renderer must survive every scene the composer can produce.
  const markup = svg.render(scene, diffScenes(null, scene));
  check(`${label}: renders`, markup.includes("<svg"));

  stats.preservation.push(evaluation.semanticPreservation);
  stats.intents.set(intent.primary, (stats.intents.get(intent.primary) ?? 0) + 1);
  stats.grammars.set(plan.grammar, (stats.grammars.get(plan.grammar) ?? 0) + 1);
  if (repair.steps.length) stats.repaired += 1;
  if (repairOutcome?.kept) stats.repairsKept += 1;

  const bucket = perCategory.get(testCase.category) ?? [];
  bucket.push(evaluation.semanticPreservation);
  perCategory.set(testCase.category, bucket);
}

// ────────────────────────────────────────────────────────── report

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

section("corpus report");
console.log(`  cases                 ${CORPUS.length}`);
console.log(`  mean preservation     ${mean(stats.preservation).toFixed(3)}`);
console.log(`  perfect (1.0)         ${stats.preservation.filter((p) => p === 1).length}`);
console.log(`  below 0.85            ${stats.preservation.filter((p) => p < 0.85).length}`);
console.log(`  repairs attempted     ${stats.repaired}`);
console.log(`  repairs kept          ${stats.repairsKept}`);
console.log(`  intents used          ${[...stats.intents.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`);
console.log(`  grammars used         ${[...stats.grammars.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`);
console.log("  by category:");
for (const [category, values] of [...perCategory.entries()].sort()) {
  console.log(`    ${category.padEnd(14)} ${values.length.toString().padStart(3)} cases   mean ${mean(values).toFixed(3)}`);
}

console.log(`\n${pass} checks passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures.slice(0, 40)) console.log(`  ✗ ${failure}`);
  if (failures.length > 40) console.log(`  ... and ${failures.length - 40} more`);
  process.exit(1);
}
