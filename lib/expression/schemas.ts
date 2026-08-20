/**
 * Runtime contracts for the Expression Engine: meaning -> visual expression.
 *
 * One file, because these types are a single chain of custody and reading
 * them in order IS the architecture. Each schema is `.strict()`; Zod is the
 * source of truth and the inferred TS type is derived, the same posture
 * lib/meaning/types.ts and lib/math/types.ts already take in this codebase.
 *
 * The hard invariant, enforced by construction rather than by convention:
 * NOTHING from InputSegment through ExpressionPlan carries geometry. There
 * is no x, no y, no width, no colour, no shape name anywhere above
 * ScenePlan. A model is only ever allowed to produce a MeaningDelta; every
 * layer below that is deterministic TypeScript. If a coordinate ever
 * appears in a model's output schema, this design has failed.
 *
 * Where the layers live:
 *   InputSegment      -> lib/expression/pipeline.ts (adapters)
 *   MeaningDelta      -> lib/expression/meaning/extract.ts   [model]
 *   WorldState        -> lib/expression/world/apply.ts       [deterministic]
 *   ExpressionIntent  -> lib/expression/intent/classify.ts   [deterministic]
 *   ExpressionPlan    -> lib/expression/planner/plan.ts      [deterministic]
 *   ScenePlan         -> lib/expression/compose/compose.ts   [deterministic]
 *   RenderPatch       -> lib/expression/render/*             [deterministic]
 *   EvaluationResult  -> lib/expression/evaluate/evaluate.ts [deterministic]
 *   RepairPlan        -> lib/expression/evaluate/repair.ts   [deterministic]
 */

import { z } from "zod";

/** kebab-case slug. Ids are human-readable so a debug panel and a log line are the same thing. */
const ID = /^[a-z][a-z0-9_-]{0,47}$/;
const IdSchema = z.string().regex(ID, "id must be a short kebab-case slug");

// ───────────────────────────────────────────────────────────── input

/**
 * The one place the outside world enters. `source` is the only field that
 * differs between a typed sentence, a settled speech thought, and an AI
 * agent submitting meaning directly — every layer below is identical for
 * all three, which is the whole point of the agent-input milestone.
 */
export const InputSegmentSchema = z
  .object({
    id: z.string().min(1).max(64),
    source: z.enum(["human_text", "human_speech", "ai_agent"]),
    text: z.string().min(1).max(4000),
    /** Monotonic ordering hint; not a wall clock, so replays are deterministic. */
    seq: z.number().int().nonnegative(),
  })
  .strict();
export type InputSegment = z.infer<typeof InputSegmentSchema>;

// ─────────────────────────────────────────────────────────── meaning

/**
 * What KIND of thing this is — the distinction lib/meaning/types.ts's
 * untyped `Concept` never made, and the reason "a family of five" could
 * not previously resolve to anything but another labelled box. The
 * primitive resolver (lib/expression/primitives/resolve.ts) reads this and
 * nothing else about the entity's wording.
 */
export const EntityTypeSchema = z.enum([
  "person",
  "group",
  "place",
  "object",
  "concept",
  "action",
  "event",
  "state",
  "time",
  "quantity",
]);
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const QuantitySchema = z
  .object({
    value: z.number().finite(),
    unit: z.string().max(24).optional(),
    /** "about five", "at least three" — the speaker's own hedging, preserved rather than rounded away. */
    approximate: z.boolean().optional(),
  })
  .strict();
export type Quantity = z.infer<typeof QuantitySchema>;

export const AttributeSchema = z
  .object({
    key: z.string().min(1).max(32),
    value: z.string().min(1).max(80),
  })
  .strict();
export type Attribute = z.infer<typeof AttributeSchema>;

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const EntitySchema = z
  .object({
    id: IdSchema,
    type: EntityTypeSchema,
    /** A NAME, 1-4 words. Never a clause — a clause belongs in `description`. */
    label: z.string().min(1).max(60),
    description: z.string().max(160).optional(),
    /** Set whenever the speaker counted something. A group of five is a group WITH a quantity, not five entities. */
    quantity: QuantitySchema.optional(),
    attributes: z.array(AttributeSchema).max(8).optional(),
    confidence: ConfidenceSchema.optional(),
  })
  .strict();
export type Entity = z.infer<typeof EntitySchema>;

/**
 * The relation vocabulary, grouped into families by `relationFamily()`
 * below. The grouping is load-bearing: the intent classifier and the
 * grammar registry both key off the FAMILY, never off an individual verb,
 * so adding a new relation type extends the system without touching either.
 *
 * Deliberately world-shaped rather than discourse-shaped. `originates_from`
 * and `member_of` and `role_of` exist because "I'm from Trinidad", "I have
 * a family of five" and "my mother's name is Mariam" are ordinary human
 * sentences, and a vocabulary that can only say `related_to` about them is
 * not a meaning representation.
 */
export const RelationTypeSchema = z.enum([
  // causal
  "causes",
  "enables",
  "prevents",
  "depends_on",
  // temporal
  "precedes",
  "transforms_into",
  // structural
  "contains",
  "part_of",
  "member_of",
  "instance_of",
  // attributive / identity
  "has_property",
  "role_of",
  "originates_from",
  "located_at",
  // comparative
  "contrasts_with",
  "greater_than",
  "less_than",
  "equivalent_to",
  // argumentative
  "supports",
  "refutes",
  // last resort
  "relates_to",
]);
export type RelationType = z.infer<typeof RelationTypeSchema>;

export const RelationFamilySchema = z.enum([
  "causal",
  "temporal",
  "structural",
  "attributive",
  "spatial",
  "comparative",
  "argumentative",
  "associative",
]);
export type RelationFamily = z.infer<typeof RelationFamilySchema>;

/** Qualifies `located_at` into a real spatial arrangement the composer can honour. */
export const SpatialRelationSchema = z.enum([
  "near",
  "beside",
  "above",
  "below",
  "behind",
  "in_front_of",
  "inside",
  "on",
]);
export type SpatialRelation = z.infer<typeof SpatialRelationSchema>;

export const RelationSchema = z
  .object({
    id: IdSchema,
    source: IdSchema,
    type: RelationTypeSchema,
    target: IdSchema,
    /**
     * The named role for `role_of` — "mother", "teacher", "founder". This is
     * what keeps kinship generic: one relation type plus an open role string,
     * rather than a `mother_of` enum member per human relationship.
     */
    role: z.string().max(32).optional(),
    /** Only meaningful when type is `located_at`. */
    spatial: SpatialRelationSchema.optional(),
    /** "twice as fast", "three times more" — a comparison's magnitude, when stated. */
    magnitude: z.number().finite().optional(),
    /** Ordinal for `precedes` chains, so a sequence survives array reordering. */
    step: z.number().int().nonnegative().optional(),
    confidence: ConfidenceSchema.optional(),
  })
  .strict();
export type Relation = z.infer<typeof RelationSchema>;

export function relationFamily(type: RelationType): RelationFamily {
  switch (type) {
    case "causes":
    case "enables":
    case "prevents":
    case "depends_on":
      return "causal";
    case "precedes":
    case "transforms_into":
      return "temporal";
    case "contains":
    case "part_of":
    case "member_of":
    case "instance_of":
      return "structural";
    case "located_at":
      return "spatial";
    case "has_property":
    case "role_of":
    case "originates_from":
      return "attributive";
    case "contrasts_with":
    case "greater_than":
    case "less_than":
    case "equivalent_to":
      return "comparative";
    case "supports":
    case "refutes":
      return "argumentative";
    case "relates_to":
      return "associative";
  }
}

/**
 * Meaning that is real but not structural — a reflection, an evaluation, an
 * uncertainty. Kept as a first-class output rather than forced into a fake
 * edge between two invented nouns. (This one idea is carried over from
 * lib/meaning/types.ts's `Claim`, which got it right.)
 */
export const ClaimSchema = z
  .object({
    id: IdSchema,
    text: z.string().min(1).max(160),
    about: z.array(IdSchema).max(5).optional(),
    /** Hedged speech ("maybe", "I think") marks the claim rather than being dropped. */
    uncertain: z.boolean().optional(),
    confidence: ConfidenceSchema.optional(),
  })
  .strict();
export type Claim = z.infer<typeof ClaimSchema>;

/**
 * What ONE input segment contributed. Ids here are local to this extraction
 * and are never persisted — the world model mints its own global ids
 * (lib/expression/world/apply.ts), which is what lets it decide "this is
 * the Mariam we already know" instead of the extractor deciding it blind.
 */
export const MeaningDeltaSchema = z
  .object({
    entities: z.array(EntitySchema).max(12),
    relations: z.array(RelationSchema).max(16),
    claims: z.array(ClaimSchema).max(8),
    /**
     * Which entity this segment is ABOUT — the pronoun antecedent for the
     * next segment, and the default focus for the expression planner.
     */
    topicEntityId: z.string().max(48).optional(),
    /** The speaker's own emphasis, if any: "the big thing is...", "what really matters". */
    emphasisEntityIds: z.array(z.string().max(48)).max(4).optional(),
    /**
     * Surface forms the speaker just took back ("actually, not the road — the
     * bridge"). Resolved against the world by the same matcher that resolves
     * every other mention, and marked superseded rather than deleted, so the
     * revision stays inspectable instead of silently rewriting history.
     */
    supersededMentions: z.array(z.string().max(60)).max(4).optional(),
    interpretation: z.string().max(240),
  })
  .strict();
export type MeaningDelta = z.infer<typeof MeaningDeltaSchema>;

export const EMPTY_MEANING_DELTA: MeaningDelta = {
  entities: [],
  relations: [],
  claims: [],
  interpretation: "",
};

// ─────────────────────────────────────────────────────────── world

export const EntityStatusSchema = z.enum(["active", "superseded"]);
export type EntityStatus = z.infer<typeof EntityStatusSchema>;

export const ImportanceSchema = z.enum(["primary", "supporting", "detail"]);
export type Importance = z.infer<typeof ImportanceSchema>;

/**
 * An entity as the world holds it: the extracted shape plus the bookkeeping
 * only the world model can know — when it was first seen, when it was last
 * touched (which drives pronoun resolution and emphasis decay), and whether
 * the speaker has since revised it away.
 */
export const WorldEntitySchema = EntitySchema.extend({
  status: EntityStatusSchema,
  importance: ImportanceSchema,
  firstSeenSeq: z.number().int().nonnegative(),
  lastTouchedSeq: z.number().int().nonnegative(),
  /** Surface forms this entity has been called, lowercased — the matcher's memory of "my mother" and "Mariam" being one person. */
  aliases: z.array(z.string().max(60)).max(12),
}).strict();
export type WorldEntity = z.infer<typeof WorldEntitySchema>;

export const WorldRelationSchema = RelationSchema.extend({
  firstSeenSeq: z.number().int().nonnegative(),
  lastTouchedSeq: z.number().int().nonnegative(),
}).strict();
export type WorldRelation = z.infer<typeof WorldRelationSchema>;

export const WorldClaimSchema = ClaimSchema.extend({
  importance: ImportanceSchema,
  firstSeenSeq: z.number().int().nonnegative(),
  lastTouchedSeq: z.number().int().nonnegative(),
}).strict();
export type WorldClaim = z.infer<typeof WorldClaimSchema>;

/**
 * Everything InPublic currently believes exists in this conversation.
 *
 * `salience` is the ordered list of recently-mentioned entity ids, most
 * recent first — the antecedent stack that resolves "she" to Mariam rather
 * than inventing a second woman. It is state, not a heuristic applied at
 * read time, because the ordering depends on the whole history.
 */
export const WorldStateSchema = z
  .object({
    topic: z.string().max(80).optional(),
    interpretation: z.string().max(240).optional(),
    entities: z.array(WorldEntitySchema).max(64),
    relations: z.array(WorldRelationSchema).max(128),
    claims: z.array(WorldClaimSchema).max(48),
    salience: z.array(IdSchema).max(16),
    /** Highest segment seq folded in so far; the clock every lastTouchedSeq is measured against. */
    seq: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((state, ctx) => {
    const ids = new Set<string>();
    for (const entity of state.entities) {
      if (ids.has(entity.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["entities"], message: `duplicate entity id "${entity.id}"` });
      }
      ids.add(entity.id);
    }
    state.relations.forEach((rel, i) => {
      if (!ids.has(rel.source) || !ids.has(rel.target) || rel.source === rel.target) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["relations", i],
          message: "relation endpoints must be two distinct existing entities",
        });
      }
    });
    state.claims.forEach((claim, i) => {
      for (const about of claim.about ?? []) {
        if (!ids.has(about)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["claims", i, "about"], message: `unknown entity "${about}"` });
        }
      }
    });
    for (const id of state.salience) {
      if (!ids.has(id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["salience"], message: `salience references unknown entity "${id}"` });
      }
    }
  });
export type WorldState = z.infer<typeof WorldStateSchema>;

export const EMPTY_WORLD_STATE: WorldState = {
  entities: [],
  relations: [],
  claims: [],
  salience: [],
  seq: 0,
};

/**
 * The minimum set of semantic changes one delta made to the world. Not a
 * canvas instruction set — the composer recomputes the whole ScenePlan from
 * the world directly. These exist so a debug panel can show WHAT changed,
 * and so a caller can tell a no-op round from a real one.
 */
export type WorldOp =
  | { kind: "ADD_ENTITY"; entity: WorldEntity }
  | { kind: "UPDATE_ENTITY"; entity: WorldEntity; prev: WorldEntity }
  | { kind: "SUPERSEDE_ENTITY"; entityId: string }
  | { kind: "ADD_RELATION"; relation: WorldRelation }
  | { kind: "UPDATE_RELATION"; relation: WorldRelation; prev: WorldRelation }
  | { kind: "REMOVE_RELATION"; relationId: string }
  | { kind: "ADD_CLAIM"; claim: WorldClaim }
  | { kind: "UPDATE_CLAIM"; claim: WorldClaim; prev: WorldClaim };

// ─────────────────────────────────────────────────────────── intent

/**
 * What the speaker is TRYING TO DO. Decided from the shape of the meaning,
 * never from keywords in the transcript — "so", "because" and "therefore"
 * are not evidence of causality, a causal relation in the world is.
 */
export const IntentTypeSchema = z.enum([
  "introduce",
  "describe",
  "explain_causality",
  "show_sequence",
  "show_hierarchy",
  "show_relationships",
  "compare",
  "show_quantity",
  "show_spatial",
  "show_transformation",
  "argue",
  "narrate",
  "define",
  "express_uncertainty",
]);
export type IntentType = z.infer<typeof IntentTypeSchema>;

export const ExpressionIntentSchema = z
  .object({
    primary: IntentTypeSchema,
    /** Intents also present but not dominant — the planner may express these as secondary regions. */
    secondary: z.array(IntentTypeSchema).max(3),
    /** The entity the expression should be organised around. Absent when the meaning has no single subject. */
    focusEntityId: IdSchema.optional(),
    /** 0-1. Low strength is a legitimate signal to express less, not to guess harder. */
    strength: z.number().min(0).max(1),
    reason: z.string().max(200),
  })
  .strict();
export type ExpressionIntent = z.infer<typeof ExpressionIntentSchema>;

// ───────────────────────────────────────────────────── expression plan

/**
 * A visual grammar is a way a semantic structure can become visually
 * understandable. It is NOT a diagram type and carries no geometry — it
 * names the spatial logic the composer must then realise.
 */
export const GrammarIdSchema = z.enum([
  "scene",
  "relationship",
  "cause_effect",
  "sequence",
  "comparison",
  "hierarchy",
  "grouping",
  "process",
  "quantity",
  "spatial",
]);
export type GrammarId = z.infer<typeof GrammarIdSchema>;

/** What a region is FOR, which is what lets the composer rank it without re-reading the meaning. */
export const RegionRoleSchema = z.enum([
  "primary_subject",
  "chain_step",
  "sequence_step",
  "comparison_pole",
  "hierarchy_root",
  "hierarchy_child",
  "group_member",
  "context",
  "annotation",
]);
export type RegionRole = z.infer<typeof RegionRoleSchema>;

export const RegionSchema = z
  .object({
    id: IdSchema,
    role: RegionRoleSchema,
    /** The entity this region expresses. Absent only for an annotation region backed by a claim. */
    entityId: IdSchema.optional(),
    claimId: IdSchema.optional(),
    /** Set when this region is a container whose children are laid out inside it. */
    childRegionIds: z.array(IdSchema).max(12).optional(),
    /** Ordinal within its role — chain position, sequence step, comparison pole 0/1. */
    order: z.number().int().nonnegative().optional(),
  })
  .strict();
export type Region = z.infer<typeof RegionSchema>;

export const ConnectionKindSchema = z.enum(["flow", "link", "containment", "comparison"]);
export type ConnectionKind = z.infer<typeof ConnectionKindSchema>;

export const ConnectionSchema = z
  .object({
    id: IdSchema,
    fromRegionId: IdSchema,
    toRegionId: IdSchema,
    /** The world relation this connection is accountable to. The evaluator reads this to check nothing was invented. */
    relationId: IdSchema,
    kind: ConnectionKindSchema,
    /** Only when the relation type cannot be read off the arrangement alone (e.g. a named role). */
    label: z.string().max(32).optional(),
  })
  .strict();
export type Connection = z.infer<typeof ConnectionSchema>;

export const EmphasisSchema = z
  .object({
    regionId: IdSchema,
    /** 1 = slight, 3 = dominant. Ranked, not boolean, so the composer can build a real hierarchy. */
    weight: z.number().int().min(1).max(3),
    reason: z.string().max(120),
  })
  .strict();
export type Emphasis = z.infer<typeof EmphasisSchema>;

/**
 * How the meaning should be SEEN — still with no geometry. This is the last
 * layer that is about communication rather than about pixels; everything
 * below is mechanical.
 */
export const ExpressionPlanSchema = z
  .object({
    grammar: GrammarIdSchema,
    intent: IntentTypeSchema,
    focusEntityId: IdSchema.optional(),
    regions: z.array(RegionSchema).max(24),
    connections: z.array(ConnectionSchema).max(32),
    emphasis: z.array(EmphasisSchema).max(6),
    reason: z.string().max(200),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const regionIds = new Set(plan.regions.map((r) => r.id));
    plan.connections.forEach((c, i) => {
      if (!regionIds.has(c.fromRegionId) || !regionIds.has(c.toRegionId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["connections", i], message: "connection endpoints must be existing regions" });
      }
    });
    plan.emphasis.forEach((e, i) => {
      if (!regionIds.has(e.regionId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["emphasis", i], message: "emphasis must target an existing region" });
      }
    });
  });
export type ExpressionPlan = z.infer<typeof ExpressionPlanSchema>;

export const EMPTY_EXPRESSION_PLAN: ExpressionPlan = {
  grammar: "relationship",
  intent: "describe",
  regions: [],
  connections: [],
  emphasis: [],
  reason: "nothing to express",
};

// ──────────────────────────────────────────────────────── primitives

/**
 * How a thing is DRAWN, chosen from the entity's type and role — not from
 * its wording. `figure` is a person because the entity's type is person,
 * not because the label matched a name list. This is the line between
 * visual expression and keyword illustration.
 */
export const VisualPrimitiveSchema = z.enum([
  "figure",
  "figure_group",
  "place_marker",
  "object_glyph",
  "node",
  "container",
  "quantity_array",
  "state_marker",
  "moment",
  "text_label",
]);
export type VisualPrimitive = z.infer<typeof VisualPrimitiveSchema>;

// ─────────────────────────────────────────────────────────── scene

/**
 * The first layer allowed to have coordinates — and it computes them
 * deterministically from the ExpressionPlan, never from a model.
 * Renderer-independent: an SVG renderer and an Excalidraw renderer consume
 * exactly this and must produce the same picture.
 */
export const SceneObjectSchema = z
  .object({
    id: IdSchema,
    /** Traceability back up the chain — the evaluator and the patcher both need it. */
    entityId: IdSchema.optional(),
    claimId: IdSchema.optional(),
    regionId: IdSchema,
    primitive: VisualPrimitiveSchema,
    label: z.string().max(60).optional(),
    /**
     * Deterministic cache key for the Drawing Agent (lib/expression/draw/),
     * derived from the entity's type and label the same way every time —
     * never model-supplied, so this is a lookup key and not geometry. Set
     * only for primitives worth illustrating (currently "node"); absent
     * means "draw the plain shape", the same fallback a cache miss produces.
     */
    sketchKey: z.string().optional(),
    /** For quantity_array / figure_group: how many marks to draw. */
    count: z.number().int().min(1).max(24).optional(),
    x: z.number().finite(),
    y: z.number().finite(),
    w: z.number().finite().positive(),
    h: z.number().finite().positive(),
    /** 0 = background context, 3 = the thing you look at first. Drives stroke weight and size, not colour alone. */
    weight: z.number().int().min(0).max(3),
    /** Set when this object is drawn inside another (enclosure grammar). */
    parentObjectId: IdSchema.optional(),
  })
  .strict();
export type SceneObject = z.infer<typeof SceneObjectSchema>;

export const ConnectorStyleSchema = z.enum(["arrow", "line", "bracket", "none"]);
export type ConnectorStyle = z.infer<typeof ConnectorStyleSchema>;

export const SceneConnectorSchema = z
  .object({
    id: IdSchema,
    relationId: IdSchema,
    fromObjectId: IdSchema,
    toObjectId: IdSchema,
    style: ConnectorStyleSchema,
    label: z.string().max(32).optional(),
    /** Start and end in scene coordinates; the composer routes, the renderer only draws. */
    points: z.array(z.tuple([z.number().finite(), z.number().finite()])).min(2).max(6),
  })
  .strict();
export type SceneConnector = z.infer<typeof SceneConnectorSchema>;

export const ScenePlanSchema = z
  .object({
    objects: z.array(SceneObjectSchema).max(48),
    connectors: z.array(SceneConnectorSchema).max(48),
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative(),
    /** What the camera should frame. Absent means "frame everything". */
    focusObjectId: IdSchema.optional(),
  })
  .strict();
export type ScenePlan = z.infer<typeof ScenePlanSchema>;

export const EMPTY_SCENE_PLAN: ScenePlan = { objects: [], connectors: [], width: 0, height: 0 };

// ─────────────────────────────────────────────────────────── render

/**
 * What a renderer must do to move the canvas from the previous scene to
 * this one. Expressed as a patch, never a replacement — "do not wipe the
 * board and regenerate everything" is a contract, not a guideline, so the
 * type simply cannot express a full redraw.
 */
export interface RenderPatch {
  added: SceneObject[];
  moved: Array<{ object: SceneObject; prev: SceneObject }>;
  updated: Array<{ object: SceneObject; prev: SceneObject }>;
  removed: string[];
  connectorsAdded: SceneConnector[];
  connectorsRemoved: string[];
  /** Connectors whose endpoints moved and must be re-routed even though the relation is unchanged. */
  connectorsRerouted: SceneConnector[];
}

export interface Renderer<TOutput> {
  readonly name: string;
  render(scene: ScenePlan, patch: RenderPatch): TOutput;
}

// ─────────────────────────────────────────────────────── evaluation

export const ProblemTypeSchema = z.enum([
  "missing_entity",
  "missing_relation",
  "false_relation",
  "ambiguous_relation",
  "unreadable_hierarchy",
  "clutter",
  "overlap",
  "unexpressed_quantity",
  "no_focus",
]);
export type ProblemType = z.infer<typeof ProblemTypeSchema>;

export const ProblemSchema = z
  .object({
    type: ProblemTypeSchema,
    detail: z.string().max(200),
    entityIds: z.array(IdSchema).max(6).optional(),
    relationId: IdSchema.optional(),
    /** 0-1 — how much this problem costs comprehension, used to rank repairs. */
    severity: z.number().min(0).max(1),
  })
  .strict();
export type Problem = z.infer<typeof ProblemSchema>;

/**
 * The result of reading the scene BACK and comparing what it says to what
 * was meant. `recoveredRelationIds` is the actual reverse interpretation —
 * the relations a viewer could reconstruct from the arrangement alone — not
 * a self-assessment of whether the drawing looks nice.
 */
/**
 * One dimension of meaning, scored on its own.
 *
 * `score` is null when the dimension does not apply — an utterance with no
 * numbers in it has not "preserved quantity perfectly", it has nothing to
 * say about quantity, and scoring that as 1.0 would quietly inflate every
 * average. `lost` names what actually went missing, because a bare number
 * tells you a picture is wrong without telling you what to fix.
 */
export const DimensionScoreSchema = z
  .object({
    /** How many facts of this kind the scene was responsible for. */
    applicable: z.number().int().nonnegative(),
    preserved: z.number().int().nonnegative(),
    /** preserved / applicable, or null when applicable is 0. */
    score: z.number().min(0).max(1).nullable(),
    /** Human-readable, one per lost fact. */
    lost: z.array(z.string().max(160)).max(8),
  })
  .strict();
export type DimensionScore = z.infer<typeof DimensionScoreSchema>;

/**
 * The round-trip comparison, dimension by dimension:
 *
 *   OriginalMeaning -> ExpressionPlan -> Scene -> RecoveredMeaning
 *
 * Kept as seven separate readings rather than one number because they fail
 * for different reasons and are fixed at different layers. A scene can
 * preserve every entity and still lose every causal direction; averaging
 * those into "0.7" hides which of the two happened, and the whole point of
 * this layer is to say which one.
 */
export const PreservationSchema = z
  .object({
    /** Did the things being talked about reach the canvas at all? */
    entity: DimensionScoreSchema,
    /** Are the relations between them recoverable from the arrangement? */
    relation: DimensionScoreSchema,
    /** Is causal DIRECTION recoverable — not just that two things are linked? */
    causal: DimensionScoreSchema,
    /** Are stated numbers drawn as extent rather than lost or written as digits? */
    quantity: DimensionScoreSchema,
    /** Does the visual order of a sequence match the order that was described? */
    ordering: DimensionScoreSchema,
    /** Can "prevents" still be told apart from "causes", and "less" from "more"? */
    polarity: DimensionScoreSchema,
    /** Is hedged meaning still marked as hedged? */
    uncertainty: DimensionScoreSchema,
  })
  .strict();
export type Preservation = z.infer<typeof PreservationSchema>;

export const EvaluationResultSchema = z
  .object({
    /**
     * The headline number, kept for the live log and for repair's
     * accept/reject decision. It is a summary of `preservation`, not a
     * replacement for it — read the dimensions to find out what went wrong.
     */
    semanticPreservation: z.number().min(0).max(1),
    preservation: PreservationSchema,
    recoveredRelationIds: z.array(IdSchema).max(64),
    /** Relations the scene implies that the world never asserted — the expensive kind of error. */
    inventedRelations: z.array(z.string().max(120)).max(16),
    problems: z.array(ProblemSchema).max(16),
    repairRequired: z.boolean(),
  })
  .strict();
export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

// ─────────────────────────────────────────────────────────── repair

export const RepairActionSchema = z.enum([
  "strengthen_connector",
  "label_connector",
  "change_grammar",
  "promote_emphasis",
  "drop_detail",
  "expose_relation",
  "separate_overlap",
  "express_quantity",
  "establish_focus",
]);
export type RepairAction = z.infer<typeof RepairActionSchema>;

export const RepairStepSchema = z
  .object({
    action: RepairActionSchema,
    /** Region, relation or entity the action applies to, depending on the action. */
    targetId: z.string().max(48).optional(),
    /** Only for change_grammar. */
    grammar: GrammarIdSchema.optional(),
    reason: z.string().max(160),
  })
  .strict();
export type RepairStep = z.infer<typeof RepairStepSchema>;

export const RepairPlanSchema = z
  .object({
    steps: z.array(RepairStepSchema).max(8),
    /** True when the steps change the plan's grammar and the scene must be recomposed rather than adjusted. */
    recomposeRequired: z.boolean(),
  })
  .strict();
export type RepairPlan = z.infer<typeof RepairPlanSchema>;

export const EMPTY_REPAIR_PLAN: RepairPlan = { steps: [], recomposeRequired: false };
