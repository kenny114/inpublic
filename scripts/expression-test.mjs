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

import { WorldStateSchema, ExpressionPlanSchema, ScenePlanSchema, MeaningDeltaSchema, EMPTY_WORLD_STATE } from "../lib/expression/schemas.ts";
import { applyDelta, normalizeMention, resolveMention, slugify } from "../lib/expression/world/apply.ts";
import { classifyIntent, longestPath } from "../lib/expression/intent/classify.ts";
import { planExpression } from "../lib/expression/planner/plan.ts";
import { compose } from "../lib/expression/compose/compose.ts";
import { evaluateScene, recoverRelations } from "../lib/expression/evaluate/evaluate.ts";
import { planRepair } from "../lib/expression/evaluate/repair.ts";
import { diffScenes, describePatch } from "../lib/expression/render/core.ts";
import { SvgRenderer } from "../lib/expression/render/svg.ts";
import { ExpressionSession, segmentText } from "../lib/expression/pipeline.ts";
import { sanitizeDelta, extractJsonObject } from "../lib/expression/meaning/extract.ts";
import { ExpressionLiveController } from "../lib/expression/live.ts";
import { skeletonsForScene } from "../lib/expression/render/excalidraw.ts";
import { planCanvasDiff, createExpressionIdentity, syncExpressionCanvas } from "../lib/expression/render/excalidrawSync.ts";
import { newPen } from "../lib/ops.ts";
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
