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
 *   CompositionPlan   -> lib/expression/composition/plan.ts  [deterministic]
 *   CleanPlan         -> lib/expression/clean/plan.ts        [deterministic]
 *   PresentationPlan  -> lib/expression/presentation/plan.ts [deterministic]
 *   ExpressionPlan    -> lib/expression/planner/plan.ts      [deterministic]
 *   ScenePlan         -> lib/expression/compose/compose.ts   [deterministic]
 *   RenderPatch       -> lib/expression/render/*             [deterministic]
 *   EvaluationResult  -> lib/expression/evaluate/evaluate.ts [deterministic]
 *   RepairPlan        -> lib/expression/evaluate/repair.ts   [deterministic]
 */

import { z } from "zod";

/** kebab-case slug. Ids are human-readable so a debug panel and a log line are the same thing. */
const ID = /^[a-z][a-z0-9_-]{0,47}$/;
export const IdSchema = z.string().regex(ID, "id must be a short kebab-case slug");

// ───────────────────────────────────────────────────────────── input

/**
 * The one place the outside world enters. `source` is the only field that
 * differs between a typed sentence, a settled speech thought, and an AI
 * agent submitting meaning directly — every layer below is identical for
 * all three, which is the whole point of the agent-input milestone.
 *
 * `speakerId` and `timestamp` are caller-supplied session metadata, never
 * something the model infers from text — a speech adapter already knows
 * which mic/track an utterance came from, the same way it already knows
 * `source`. They exist here, not on MeaningDelta, for the same reason
 * `source` does: identity and timing are about where the words came from,
 * which is a fact about the world, not part of what the words mean.
 */
export const InputSegmentSchema = z
  .object({
    id: z.string().min(1).max(64),
    source: z.enum(["human_text", "human_speech", "ai_agent"]),
    text: z.string().min(1).max(4000),
    /** Monotonic ordering hint; not a wall clock, so replays are deterministic. */
    seq: z.number().int().nonnegative(),
    /** Stable id for who said this — a slug like "sarah", "kenny", "spk_2". Never inferred from the text itself. */
    speakerId: z.string().max(48).optional(),
    /** Wall-clock or meeting-relative time, in whatever unit the caller uses consistently. Carried, never interpreted, this far down. */
    timestamp: z.number().finite().optional(),
  })
  .strict();
export type InputSegment = z.infer<typeof InputSegmentSchema>;

/**
 * Where one semantic fact came from: who said it, when, and which raw
 * segment(s) it traces back to. Attached to WorldEntity / WorldRelation /
 * WorldClaim by lib/expression/world/apply.ts ONLY — the model never
 * produces this, and it never reaches ExpressionPlan or ScenePlan. Identity
 * and provenance are deliberately separate: the same entity merges across
 * speakers exactly as it always has (lib/expression/world/apply.ts's
 * resolveMention does not look at who is speaking), and provenance is a
 * bounded append-only log of who has touched it, not a second identity key.
 */
export const ProvenanceSchema = z
  .object({
    speakerId: z.string().max(48).optional(),
    timestamp: z.number().finite().optional(),
    /** InputSegment id(s) this touch traces back to — usually one, occasionally more if a round merged several. */
    sourceSegmentIds: z.array(z.string().max(64)).max(4),
  })
  .strict();
export type Provenance = z.infer<typeof ProvenanceSchema>;

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

/**
 * A metric — spoken quantitative information about a NAMED thing being
 * measured over time, not a count of items. "200 visitors last week, 500
 * this week" is one metric (traffic) with two points; it is deliberately
 * NOT modelled as `EntitySchema.quantity`, which means "there are N of
 * these things" (extent, drawn as repeated marks) — a metric's number is a
 * MEASUREMENT, and drawing "500" as five hundred marks would be exactly the
 * caption-box failure this representation exists to prevent.
 */
export const MetricUnitSchema = z.enum(["count", "percent", "currency", "ratio"]);
export type MetricUnit = z.infer<typeof MetricUnitSchema>;

export const MetricPointSchema = z
  .object({
    value: z.number().finite(),
    /** The time/category dimension: "last week", "today", "Q3" — never required, but almost always what makes a series a series. */
    label: z.string().max(40).optional(),
    /** "around 500", "roughly 10%", "maybe $20k" — preserved, not rounded away or silently dropped. */
    approximate: z.boolean().optional(),
  })
  .strict();
export type MetricPoint = z.infer<typeof MetricPointSchema>;

export const MetricSchema = z
  .object({
    unit: MetricUnitSchema,
    /** currency unit only, e.g. "USD" or "$". */
    currency: z.string().max(8).optional(),
    /**
     * This segment's own point(s), oldest first — a single value, or a
     * before/after pair stated in the same breath. The world layer APPENDS
     * these onto the entity's accumulated history; it never replaces it, so
     * "conversion was 10%, then 4%, then 6%" builds one ordered series
     * across three turns rather than three unrelated numbers.
     *
     * May be EMPTY — "our target is 12% conversion" states a target with no
     * fresh value at all, and the model does not know the current value well
     * enough to be trusted to restate it (it never sees the world). Forcing
     * at least one point here would mean either inventing one or repeating
     * whatever was last said, and a repeated point would double-count in the
     * history. `superRefine` below is what actually stops an empty metric:
     * at least one of points/target/direction/changePercent must carry
     * something.
     */
    points: z.array(MetricPointSchema).max(6),
    /** A stated goal or threshold: "our target is 12% conversion". */
    target: MetricPointSchema.optional(),
    /** Qualitative direction stated without necessarily giving both numbers: "traffic increased", "users fell". */
    direction: z.enum(["increase", "decrease", "flat"]).optional(),
    /** A stated relative change: "doubled" -> 100, "fell by about 20%" -> -20. Independent of `points` — the speaker may give only one of the two. */
    changePercent: z.number().finite().optional(),
  })
  .strict()
  .superRefine((metric, ctx) => {
    if (!metric.points.length && !metric.target && metric.direction === undefined && metric.changePercent === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a metric must state at least one of points/target/direction/changePercent" });
    }
  });
export type Metric = z.infer<typeof MetricSchema>;

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
    /** Set whenever the speaker stated a measurement — see MetricSchema. Mutually exclusive with `quantity` in practice: one is extent, the other is a measurement over time. */
    metric: MetricSchema.optional(),
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
  // intentional
  "wants",
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
    // A want is a directed tie between someone and a thing, with no sign,
    // no order and no structure to it — the same shape `relates_to` has,
    // and the same one the `relationship` grammar draws as a labelled link.
    // It is a separate VERB rather than a `relates_to` because "wants" is
    // what has to appear on the arrow; the family is what the classifier
    // and the grammars read, and associative is what this behaves like.
    case "wants":
    case "relates_to":
      return "associative";
  }
}

/**
 * "I agree" / "that's not right" — a claim's stance toward an earlier one.
 * `targetSurface` is the model's own words for what is being agreed or
 * disputed (a quote or paraphrase, exactly like `supersededMentions` names a
 * retraction in the speaker's own words) — never a world claim id. Resolving
 * it to an actual WorldClaim is lib/expression/world/apply.ts's job, using
 * the same deterministic text-matching resolveTopicRecall already does
 * (lib/expression/world/references.ts), because "what claim does this
 * paraphrase best match" is exactly that search over a different pool.
 */
export const ClaimStanceSchema = z
  .object({
    type: z.enum(["agrees", "disagrees"]),
    targetSurface: z.string().min(1).max(160),
  })
  .strict();
export type ClaimStance = z.infer<typeof ClaimStanceSchema>;

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
    /** Set only when this claim explicitly agrees or disagrees with an earlier one. */
    stance: ClaimStanceSchema.optional(),
  })
  .strict();
export type Claim = z.infer<typeof ClaimSchema>;

/**
 * A mention the extractor recognised as pointing at something already
 * discussed, by POSITION ("the second option", "the last idea", "the other
 * one") or by TOPIC ("go back to the pricing problem", "what we said
 * earlier about funding") rather than by pronoun or a restated name. The
 * extractor's job stops at flagging which kind of pointer this is and what
 * was said — resolving it against history is the deterministic world
 * layer's job (lib/expression/world/references.ts), the same division of
 * labour as pronouns: the model recognises the grammar, the world model
 * decides the referent.
 */
export const ReferenceKindSchema = z.enum(["ordinal", "topic_recall"]);
export type ReferenceKind = z.infer<typeof ReferenceKindSchema>;

export const ReferenceMentionSchema = z
  .object({
    /** One of this delta's own entity ids — a placeholder standing in for whatever gets resolved. */
    entityId: IdSchema,
    /** The phrase actually spoken, verbatim: "the second option", "the original problem". */
    surface: z.string().min(1).max(80),
    kind: ReferenceKindSchema,
    /** ordinal only. 0-based position: "the first" = 0, "the second" = 1. Omit for "the last" / "the other". */
    ordinalIndex: z.number().int().min(0).max(9).optional(),
    /** ordinal only. "the last one" / "the last idea" — counts from the end of the group instead of ordinalIndex. */
    ordinalFromEnd: z.boolean().optional(),
    /** ordinal only. "the other one" — the non-current member of a two-item group. */
    ordinalOther: z.boolean().optional(),
    /** topic_recall only. What is being recalled, e.g. "funding", "the pricing problem". Falls back to `surface` when absent. */
    topicHint: z.string().max(80).optional(),
    /** topic_recall only. A speaker named in the recall itself — "what SARAH said earlier about onboarding". The exact word used, not a resolved speakerId. */
    speakerHint: z.string().max(48).optional(),
  })
  .strict();
export type ReferenceMention = z.infer<typeof ReferenceMentionSchema>;

/**
 * "Let's set that aside", "actually, forget the creator idea", "go back to
 * fundraising" — a discourse act names WHICH lifecycle transition the
 * speaker just performed and WHAT it targets, in the speaker's own words.
 * Same discipline as everywhere else in this file: the model identifies the
 * grammar, never a world id — lib/expression/world/apply.ts resolves
 * `targetSurface` deterministically (reusing the same text-matching
 * resolveTopicRecall uses) and performs the actual state transition.
 */
export const DiscourseActTypeSchema = z.enum(["reject", "suspend", "deemphasize", "invalidate", "supersede", "reactivate"]);
export type DiscourseActType = z.infer<typeof DiscourseActTypeSchema>;

export const DiscourseActSchema = z
  .object({
    type: DiscourseActTypeSchema,
    /** The model's own words for what this act targets — a claim's content for "invalidate", an entity's description for everything else. Never a world id. */
    targetSurface: z.string().min(1).max(160),
    /** supersede only: which of THIS delta's own entities is the replacement — a local id, resolved the same way MeaningDelta's other local-id fields are. */
    supersededByLocalId: z.string().max(48).optional(),
  })
  .strict();
export type DiscourseAct = z.infer<typeof DiscourseActSchema>;

/**
 * What ONE input segment contributed. Ids here are local to this extraction
 * and are never persisted — the world model mints its own global ids
 * (lib/expression/world/apply.ts), which is what lets it decide "this is
 * the Mariam we already know" instead of the extractor deciding it blind.
 */
/**
 * The plain object shape, kept as its own export because `.shape` is only
 * available on a ZodObject — sanitizeDelta (lib/expression/meaning/extract.ts)
 * validates one entity/relation/claim at a time via
 * `MeaningDeltaShape.shape.entities.element`, and wrapping the schema below
 * in `.superRefine` turns it into a ZodEffects that no longer exposes
 * `.shape` at all.
 */
export const MeaningDeltaShape = z.object({
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
  /** Ordinal and topic-recall pointers this segment made — see ReferenceMentionSchema. */
  referenceMentions: z.array(ReferenceMentionSchema).max(4).optional(),
  /** Conversational revisions this segment performed — see DiscourseActSchema. */
  discourseActs: z.array(DiscourseActSchema).max(4).optional(),
  interpretation: z.string().max(240),
}).strict();

export const MeaningDeltaSchema = MeaningDeltaShape.superRefine((delta, ctx) => {
  const entityIds = new Set(delta.entities.map((e) => e.id));
  delta.referenceMentions?.forEach((mention, i) => {
    if (!entityIds.has(mention.entityId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["referenceMentions", i, "entityId"],
        message: "referenceMentions.entityId must be one of this delta's own entities",
      });
    }
  });
  delta.discourseActs?.forEach((act, i) => {
    if (act.supersededByLocalId && !entityIds.has(act.supersededByLocalId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discourseActs", i, "supersededByLocalId"],
        message: "discourseActs.supersededByLocalId must be one of this delta's own entities",
      });
    }
  });
});
export type MeaningDelta = z.infer<typeof MeaningDeltaSchema>;

export const EMPTY_MEANING_DELTA: MeaningDelta = {
  entities: [],
  relations: [],
  claims: [],
  interpretation: "",
};

// ─────────────────────────────────────────────────────────── world

/**
 * The lifecycle a concept moves through as the conversation revises it —
 * the reason "supersession" used to be the answer to every kind of
 * retraction. A caption system only ever accumulates; a thought system
 * changes its mind, and these are the distinct ways it does that:
 *
 *   active        the default — under current consideration.
 *   deemphasized  still valid, still true, just no longer a priority. The
 *                 ONLY status that stays "live" (drawable, holds its
 *                 relations) — see isLiveEntityStatus. Distinct from a low
 *                 `importance` tier: importance is recomputed from the graph
 *                 every round, deemphasized is an explicit, sticky decision
 *                 recomputeImportance must not silently undo.
 *   suspended     preserved, but pulled out of current focus — "let's park
 *                 that for now". Recoverable, expected to possibly return.
 *   rejected      the speaker no longer accepts or is proposing it —
 *                 "actually, forget that". Recoverable in principle (see
 *                 `reactivate`), but nothing assumes it will be.
 *   superseded    replaced by a SPECIFIC newer entity — see
 *                 `WorldEntity.supersededByEntityId`. The one status that
 *                 names its own replacement.
 *
 * suspended/rejected/superseded are all "archived": hidden from expression
 * exactly like the old binary status already hid a superseded entity, never
 * deleted, and reachable again — lib/expression/world/apply.ts resolves
 * "reactivate" and topic-recall the same way regardless of which of the
 * three archived it.
 */
export const EntityStatusSchema = z.enum(["active", "deemphasized", "suspended", "rejected", "superseded"]);
export type EntityStatus = z.infer<typeof EntityStatusSchema>;

/**
 * The single predicate every grammar, the composer's inputs, salience, and
 * importance recomputation share for "does this participate in expression
 * right now". Centralised because this exact question used to be answered
 * by nine separate `status !== "superseded"` checks scattered across the
 * engine — fine while there were only two statuses, a correctness bug
 * waiting to happen the moment a third one existed.
 */
export function isLiveEntityStatus(status: EntityStatus): boolean {
  return status === "active" || status === "deemphasized";
}

export const ImportanceSchema = z.enum(["primary", "supporting", "detail"]);
export type Importance = z.infer<typeof ImportanceSchema>;

/**
 * An entity as the world holds it: the extracted shape plus the bookkeeping
 * only the world model can know — when it was first seen, when it was last
 * touched (which drives pronoun resolution and emphasis decay), and whether
 * the speaker has since revised it away.
 */
/**
 * A bounded, append-only log of who has touched this fact — never a second
 * identity key. Two speakers asserting the same thing still merge into ONE
 * entity/claim (identity resolution never looks at speakerId); this is
 * where the record of "Sarah AND Kenny both touched this" lives once they
 * have. Capped and oldest-evicted exactly like `aliases`, for the same
 * reason: a fact's provenance history is evidence, not the fact itself, and
 * does not need to grow without bound to stay useful.
 */
const WorldProvenance = z.array(ProvenanceSchema).max(6).optional();

/**
 * The world's own shape for a metric — an ACCUMULATED, ordered `history`
 * rather than one segment's `points`. Every settled thought that mentions
 * "conversion" again appends to this same array (lib/expression/world/apply.ts)
 * instead of replacing it, which is the whole mechanism behind "10% ->
 * 4% -> 6%" surviving as one series across three separate turns.
 */
export const WorldMetricSchema = z
  .object({
    unit: MetricUnitSchema,
    currency: z.string().max(8).optional(),
    history: z.array(MetricPointSchema).max(12),
    target: MetricPointSchema.optional(),
    direction: z.enum(["increase", "decrease", "flat"]).optional(),
    changePercent: z.number().finite().optional(),
  })
  .strict();
export type WorldMetric = z.infer<typeof WorldMetricSchema>;

export const WorldEntitySchema = EntitySchema.extend({
  status: EntityStatusSchema,
  importance: ImportanceSchema,
  firstSeenSeq: z.number().int().nonnegative(),
  lastTouchedSeq: z.number().int().nonnegative(),
  /** Surface forms this entity has been called, lowercased — the matcher's memory of "my mother" and "Mariam" being one person. */
  aliases: z.array(z.string().max(60)).max(12),
  provenance: WorldProvenance,
  /** Set only when status is "superseded" — which entity replaced this one. */
  supersededByEntityId: IdSchema.optional(),
  /** Overrides EntitySchema's per-segment `metric` with the world's accumulated shape — see WorldMetricSchema. */
  metric: WorldMetricSchema.optional(),
}).strict();
export type WorldEntity = z.infer<typeof WorldEntitySchema>;

export const WorldRelationSchema = RelationSchema.extend({
  firstSeenSeq: z.number().int().nonnegative(),
  lastTouchedSeq: z.number().int().nonnegative(),
  provenance: WorldProvenance,
}).strict();
export type WorldRelation = z.infer<typeof WorldRelationSchema>;

export const WorldClaimSchema = ClaimSchema.extend({
  importance: ImportanceSchema,
  firstSeenSeq: z.number().int().nonnegative(),
  lastTouchedSeq: z.number().int().nonnegative(),
  provenance: WorldProvenance,
  /** Resolved counterpart to `stance.targetSurface` — absent when unresolved, exactly like ReferenceMention.chosenId. */
  stanceTargetClaimId: IdSchema.optional(),
  /** Set by an "invalidate" discourse act ("no, that's wrong"). The claim is kept, not deleted — same "archived, not erased" rule as entity status. */
  invalidated: z.boolean().optional(),
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
  | { kind: "REMOVE_ENTITY"; entityId: string }
  | { kind: "SUPERSEDE_ENTITY"; entityId: string }
  | { kind: "ADD_RELATION"; relation: WorldRelation }
  | { kind: "UPDATE_RELATION"; relation: WorldRelation; prev: WorldRelation }
  | { kind: "REMOVE_RELATION"; relationId: string }
  | { kind: "ADD_CLAIM"; claim: WorldClaim }
  | { kind: "UPDATE_CLAIM"; claim: WorldClaim; prev: WorldClaim };

/**
 * One candidate considered while resolving a ReferenceMention, kept whether
 * or not it won — the instrumentation this exists for is as much about
 * SECOND place (why something was NOT chosen, or why the choice was only
 * "medium") as about first.
 */
export interface ReferenceCandidate {
  id: string;
  label: string;
  score: number;
  reason: string;
}

/**
 * The outcome of resolving one ReferenceMention against WorldState —
 * produced by lib/expression/world/references.ts, carried on
 * ExpressionTrace for the debug panel. `chosenId: null` means the mention
 * was deliberately left unattached rather than guessed: see the module doc
 * for why "low confidence" and "not resolved" are the same outcome here.
 */
export interface ReferenceResolution {
  surface: string;
  kind: ReferenceKind;
  candidates: ReferenceCandidate[];
  chosenId: string | null;
  confidence: Confidence;
  reason: string;
}

/**
 * The outcome of resolving one DiscourseAct — produced by
 * lib/expression/world/apply.ts, carried on ExpressionTrace. `applied:
 * false` means the target could not be confidently resolved, so — same rule
 * as everywhere else reference resolution runs — nothing changed rather
 * than changing the wrong thing.
 */
export interface DiscourseActResolution {
  type: DiscourseActType;
  targetSurface: string;
  candidates: ReferenceCandidate[];
  targetId: string | null;
  confidence: Confidence;
  applied: boolean;
  reason: string;
}

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

// ─────────────────────────────────────────────────────────── clean

/**
 * What the Clean Agent is allowed to say about a relation that may remain
 * visible. Entity ids, not region ids — this constraint is about the world
 * the picture is allowed to show, not about a particular layout.
 */
export const CleanRelationSchema = z
  .object({
    from: IdSchema,
    to: IdSchema,
    label: z.string().max(32).optional(),
  })
  .strict();
export type CleanRelation = z.infer<typeof CleanRelationSchema>;

/**
 * The Clean Agent's decision: what the board is allowed to look like after
 * this thought. No geometry. The planner, composer and renderer may only
 * realise this set — they must not add or keep anything it rejected.
 *
 * `reason` is diagnostic (debug panel / trace), the same category as
 * ExpressionPlan.reason: the picture does not depend on it.
 */
export const CleanPlanSchema = z
  .object({
    /** Absent only when there is nothing live to organise around. */
    primaryId: IdSchema.optional(),
    keep: z.array(IdSchema).max(6),
    demote: z.array(IdSchema).max(24),
    remove: z.array(IdSchema).max(48),
    promote: z.array(IdSchema).max(6),
    allowedRelations: z.array(CleanRelationSchema).max(16),
    maxNodes: z.literal(6),
    reason: z.string().max(200),
  })
  .strict();
export type CleanPlan = z.infer<typeof CleanPlanSchema>;

export const EMPTY_CLEAN_PLAN: CleanPlan = {
  keep: [],
  demote: [],
  remove: [],
  promote: [],
  allowedRelations: [],
  maxNodes: 6,
  reason: "nothing to clean",
};

// ──────────────────────────────────────────────────── composition

/**
 * One hop on the story spine. Entity ids, not region ids — this is the
 * path the viewer should follow, decided before any grammar or layout.
 */
export const CompositionEdgeSchema = z
  .object({
    from: IdSchema,
    to: IdSchema,
    label: z.string().max(32).optional(),
  })
  .strict();
export type CompositionEdge = z.infer<typeof CompositionEdgeSchema>;

/**
 * The Composition Agent's decision: the single story of this thought.
 * One primary, one spine. Everything else is attached to that spine,
 * demoted, or removed. Clean and the renderer may only realise this set.
 *
 * No geometry. `reason` is diagnostic, same category as CleanPlan.reason.
 */
export const CompositionPlanSchema = z
  .object({
    /** Absent only when there is nothing live to organise a story around. */
    primaryId: IdSchema.optional(),
    /** The one main path, usually 1–3 edges (2–4 nodes). */
    spine: z.array(CompositionEdgeSchema).max(4),
    allowed: z.array(IdSchema).max(12),
    demote: z.array(IdSchema).max(24),
    remove: z.array(IdSchema).max(48),
    reason: z.string().max(200),
  })
  .strict();
export type CompositionPlan = z.infer<typeof CompositionPlanSchema>;

export const EMPTY_COMPOSITION_PLAN: CompositionPlan = {
  spine: [],
  allowed: [],
  demote: [],
  remove: [],
  reason: "nothing to compose",
};

// ────────────────────────────────────────────────── presentation

/**
 * How the story should be SHOWN — still no coordinates. The composer
 * realises `layout`; the renderer realises `emphasis`. Neither may add
 * a node this plan dropped for clarity.
 */
export const PresentationLayoutSchema = z.enum(["vertical-spine", "left-to-right", "central-primary", "hierarchy"]);
export type PresentationLayout = z.infer<typeof PresentationLayoutSchema>;

export const PresentationWeightSchema = z.enum(["heavy", "medium", "light"]);
export type PresentationWeight = z.infer<typeof PresentationWeightSchema>;

export const PresentationEmphasisSchema = z
  .object({
    primary: PresentationWeightSchema,
    support: PresentationWeightSchema,
    periphery: PresentationWeightSchema,
  })
  .strict();
export type PresentationEmphasis = z.infer<typeof PresentationEmphasisSchema>;

export const PresentationPlanSchema = z
  .object({
    layout: PresentationLayoutSchema,
    emphasis: PresentationEmphasisSchema,
    /** Entity ids dropped for visual clarity — a subset of what Clean kept. */
    simplifications: z.array(IdSchema).max(12),
    notes: z.string().max(200),
  })
  .strict();
export type PresentationPlan = z.infer<typeof PresentationPlanSchema>;

export const EMPTY_PRESENTATION_PLAN: PresentationPlan = {
  layout: "central-primary",
  emphasis: { primary: "heavy", support: "medium", periphery: "light" },
  simplifications: [],
  notes: "nothing to present",
};

export const DEFAULT_PRESENTATION_EMPHASIS: PresentationEmphasis = {
  primary: "heavy",
  support: "medium",
  periphery: "light",
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
  /**
   * The metric vocabulary — deliberately three, not "one per chart type".
   * metric_value covers both a single number AND a before/after pair (one
   * or two points read inline, "200 -> 500"); metric_series is an ordered
   * run of three or more; metric_gauge is the one shape that needs its own
   * drawing because a target makes it a comparison against a threshold, not
   * a value. Two-metric comparison is not a fourth primitive — it is two of
   * these placed as poles by the existing `comparison` grammar.
   */
  "metric_value",
  "metric_series",
  "metric_gauge",
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
    /**
     * Set when the entity behind this object carries `confidence: "low"` —
     * a hedge ("maybe", "hypothetically") the speaker made explicit. Computed
     * here from WorldEntity.confidence, never from a model at this layer:
     * the same "style hint, not geometry" category as `weight`. Renderers
     * read it to draw dashed/faint rather than solid.
     */
    tentative: z.boolean().optional(),
    /**
     * Set only for metric_value / metric_series / metric_gauge — the actual
     * numbers to draw. Not geometry: a value, a unit and a target are
     * content the same way `label` and `count` already are, and this is
     * still the composer choosing WHAT to hand the renderer, never a
     * coordinate. Trimmed from WorldMetric.history to whatever the chosen
     * primitive actually displays (compose.ts).
     */
    metric: WorldMetricSchema.optional(),
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

/**
 * How a connector is DRAWN, which is a semantic decision the composer makes
 * — not a stylistic one a renderer may reinterpret.
 *
 * `tension` is the opposition mark: a symmetric zigzag between two things
 * the speaker set against each other. It exists because neither of the two
 * existing symmetric options can carry a contrast. Nothing at all leans on
 * the poles happening to sit in a row — true for the comparison layout,
 * false the moment the same contrast turns up inside a scene — and a plain
 * line says only "these are connected", which is exactly as true of two
 * things that agree. An arrow is not available to it: `contrasts_with` has
 * no direction, and drawing one would assert a claim the speaker never made.
 */
export const ConnectorStyleSchema = z.enum(["arrow", "line", "bracket", "tension", "none"]);
export type ConnectorStyle = z.infer<typeof ConnectorStyleSchema>;

export const SceneConnectorSchema = z
  .object({
    id: IdSchema,
    relationId: IdSchema,
    fromObjectId: IdSchema,
    toObjectId: IdSchema,
    style: ConnectorStyleSchema,
    label: z.string().max(32).optional(),
    /** Set when the world relation behind this connector carries `confidence: "low"`. Same rationale as SceneObject.tentative. */
    tentative: z.boolean().optional(),
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
