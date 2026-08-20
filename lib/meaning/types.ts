/**
 * Types for the Meaning Engine — the persistent "what does InPublic
 * currently believe the speaker means" model, sitting between the settled
 * transcript and anything that draws.
 *
 * Same posture as lib/visualReentry/types.ts and lib/math/types.ts: Zod
 * schemas are the source of truth, both branches are `.strict()`, and
 * nothing here ever carries a pixel coordinate — geometry is decided later,
 * in lib/meaning/apply.ts, from the state directly, never by the model
 * itself.
 *
 * `id` is the one field that matters most: the model is told to reuse an
 * existing concept's id when a new sentence refers to the same thing, and to
 * mint a fresh id only for something genuinely new. That id is what lets
 * lib/meaning/reconcile.ts tell an update apart from a new node, and what
 * lib/meaning/apply.ts uses to look up the stable concept-id -> Excalidraw
 * element-id mapping (the "semantic ID <-> canvas ID" pairing called for by
 * the rebuild brief) instead of creating a duplicate box.
 *
 * Not everything the speaker says resolves into a NODE -> EDGE -> NODE
 * structure right away. `claims` hold meaning that is real and worth
 * keeping but not yet (or not ever) structural — a reflection, a
 * realization, an evaluation — until later context makes its relationship
 * to the rest of the state clearer. This is what lets the engine represent
 * "that really opened my eyes" without forcing it into a fake edge between
 * two invented named things.
 */

import { z } from "zod";

export const ConceptImportanceSchema = z.enum(["primary", "supporting", "detail"]);
export type ConceptImportance = z.infer<typeof ConceptImportanceSchema>;

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

/**
 * A concept whose status is "superseded" was a real, correct interpretation
 * at the time but has since been revised or replaced by the speaker
 * ("actually, no — the bigger thing was..."). It stays in the list (not
 * deleted) so the semantic history remains inspectable, but a consumer
 * building a visual should treat it as background, not current — Part 9's
 * "do not create two equal competing main ideas."
 */
export const ConceptStatusSchema = z.enum(["active", "superseded"]);
export type ConceptStatus = z.infer<typeof ConceptStatusSchema>;

/** kebab-case, short — human-readable ids double as a debugging aid in logs. */
const ID_PATTERN = /^[a-z][a-z0-9_-]{0,39}$/;

export const QuantitySchema = z
  .object({
    value: z.number().finite(),
    unit: z.string().max(24).optional(),
  })
  .strict();
export type Quantity = z.infer<typeof QuantitySchema>;

export const ConceptSchema = z
  .object({
    id: z.string().regex(ID_PATTERN, "id must be a short kebab-case slug"),
    label: z.string().min(1).max(60),
    /** A short clarifying phrase when the label alone would be ambiguous — optional, not a summary of everything said about it. */
    description: z.string().max(160).optional(),
    /** Named number when the speaker's point is quantitative — enables comparison/scale without stuffing digits into the label. */
    quantity: QuantitySchema.optional(),
    importance: ConceptImportanceSchema,
    /** Defaults to "active" when omitted — see ConceptStatusSchema's doc comment. */
    status: ConceptStatusSchema.optional(),
    confidence: ConfidenceSchema.optional(),
    /** Which settled-thought ids contributed to this concept, oldest first — the audit trail back to what was actually said. */
    sourceThoughtIds: z.array(z.string()).max(20).optional(),
  })
  .strict();
export type Concept = z.infer<typeof ConceptSchema>;

export const RelationshipTypeSchema = z.enum([
  "causes",
  "leads_to",
  "supports",
  "contrasts",
  "contains",
  "example_of",
  "part_of",
  "depends_on",
  "related_to",
]);
export type RelationshipType = z.infer<typeof RelationshipTypeSchema>;

export const RelationshipSchema = z
  .object({
    id: z.string().regex(ID_PATTERN, "id must be a short kebab-case slug"),
    from: z.string().regex(ID_PATTERN),
    to: z.string().regex(ID_PATTERN),
    type: RelationshipTypeSchema,
    label: z.string().max(40).optional(),
    confidence: ConfidenceSchema.optional(),
    sourceThoughtIds: z.array(z.string()).max(20).optional(),
  })
  .strict();
export type Relationship = z.infer<typeof RelationshipSchema>;

/**
 * Meaning that is real but not (yet, or ever) structural — see the module
 * doc comment. `about` optionally names which existing concepts this claim
 * relates to, without asserting a specific relationship type between them.
 */
export const ClaimSchema = z
  .object({
    id: z.string().regex(ID_PATTERN, "id must be a short kebab-case slug"),
    text: z.string().min(1).max(160),
    about: z.array(z.string().regex(ID_PATTERN)).max(5).optional(),
    importance: ConceptImportanceSchema,
    confidence: ConfidenceSchema.optional(),
    sourceThoughtIds: z.array(z.string()).max(20).optional(),
  })
  .strict();
export type Claim = z.infer<typeof ClaimSchema>;

/**
 * Semantic caps (24 concepts / 40 relationships / 30 claims).
 *
 * V1 shipped with 7/12/10 — a "one main concept, 3-7 supporting concepts"
 * budget copied straight from the eventual CANVAS's visual restraint. That
 * conflated two different layers: the semantic engine's job is to
 * *understand* everything meaningful the speaker says, while a future
 * visual-planning layer's job is to *choose* a small subset of that worth
 * drawing. A 7-concept cap made the semantic layer forget real information
 * the moment a long talk got past its first minute (see the semantic
 * accumulation audit, 2026-08-19: real voice-note replay retained only
 * ~1/3 of meaningful content, and the cap was one of the mechanisms found
 * pruning it — see decideCore.ts's `sanitizeForSchema` doc comment).
 *
 * Raised to 24/40/30: generous enough to hold a multi-minute conversation's
 * full understanding without truncating mid-session, while still bounded
 * (not unlimited) as a token/sanity safety net. Visual restraint belongs to
 * lib/meaning/plan.ts, which chooses a smaller display subset and a visual
 * family from this richer semantic state — it must not be enforced here again.
 */
export const SemanticStateSchema = z
  .object({
    topic: z.string().max(80).optional(),
    /** The model's own one-sentence narrative of what it currently believes the speaker means — the "why" behind the structural add/update/remove ops, since those are computed mechanically (lib/meaning/reconcile.ts) and can't recover a narrative like "merged X and Y" or "corrected the earlier claim" on their own. */
    currentInterpretation: z.string().max(240).optional(),
    concepts: z.array(ConceptSchema).max(24),
    relationships: z.array(RelationshipSchema).max(40),
    claims: z.array(ClaimSchema).max(30),
  })
  .strict()
  .superRefine((state, ctx) => {
    const ids = new Set(state.concepts.map((c) => c.id));
    const dupes = new Set<string>();
    for (const c of state.concepts) {
      if (dupes.has(c.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["concepts"], message: `duplicate concept id "${c.id}"` });
      dupes.add(c.id);
    }
    state.relationships.forEach((rel, index) => {
      if (!ids.has(rel.from) || !ids.has(rel.to) || rel.from === rel.to) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["relationships", index], message: "relationship endpoints must reference two distinct existing concepts" });
      }
    });
    state.claims.forEach((claim, index) => {
      for (const aboutId of claim.about ?? []) {
        if (!ids.has(aboutId)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["claims", index, "about"], message: `claim references unknown concept id "${aboutId}"` });
        }
      }
    });
  });
export type SemanticState = z.infer<typeof SemanticStateSchema>;

export const EMPTY_SEMANTIC_STATE: SemanticState = { concepts: [], relationships: [], claims: [] };

/**
 * The visual-planning layer's decision: which form carries this meaning, and
 * which subset is worth drawing. Computed deterministically from
 * SemanticState (lib/meaning/plan.ts) — never by the model, never carrying
 * geometry. Family is a drawing decision; it does not belong on SemanticState.
 */
export const VisualFamilySchema = z.enum(["causal_chain", "comparison", "hierarchy", "concept_network"]);
export type VisualFamily = z.infer<typeof VisualFamilySchema>;

export const VisualPlanSchema = z
  .object({
    family: VisualFamilySchema,
    /** Display budget, ordered (spine order for chains). */
    focusConceptIds: z.array(z.string()).max(6),
    focusRelationshipIds: z.array(z.string()).max(16),
    /** Claims to show as notes on focused concepts, never as boxes. */
    annotationClaimIds: z.array(z.string()).max(8),
    /** Why this family won — debug only. */
    reason: z.string().max(200),
  })
  .strict();
export type VisualPlan = z.infer<typeof VisualPlanSchema>;

export const EMPTY_VISUAL_PLAN: VisualPlan = {
  family: "concept_network",
  focusConceptIds: [],
  focusRelationshipIds: [],
  annotationClaimIds: [],
  reason: "empty state",
};

/** Where an expression input comes from — kept open-ended so a future
 * `source: "ai_agent"` slots in without touching the engine's shape. */
export interface ExpressionInput {
  source: "human_speech" | "ai_agent";
  content: string;
  /** The source's own id for this input (e.g. a SettledThought's id) — lets a caller know which inputs a given MeaningUpdate actually consumed, for transcript lifecycle purposes (see lib/meaning/engine.ts's MeaningUpdate.consumedIds). Optional: a caller with no natural id (or that doesn't care about lifecycle) can omit it. */
  id?: string;
}

/**
 * Stage 1 of the two-stage decision (see lib/meaning/decideCore.ts's module
 * doc comment for the full architecture rationale). LocalMeaning answers
 * "what new meaning does this speech contain," decided BEFORE the existing
 * SemanticState is allowed to bias the reading — the fix for early-
 * abstraction lock-in (semantic accumulation audit, 2026-08-19).
 *
 * Deliberately a much smaller/looser shape than SemanticState: ids here are
 * only scoped to this one extraction (never persisted, never compared
 * across rounds), so stage 2 (reconciliation) is free to match a
 * LocalConcept against an existing global concept, mint a new global id, or
 * drop it — none of that is stage 1's job.
 */
const LOCAL_ID_PATTERN = /^[a-z][a-z0-9_-]{0,39}$/;

export const LocalConceptSchema = z
  .object({
    id: z.string().regex(LOCAL_ID_PATTERN),
    label: z.string().min(1).max(60),
    description: z.string().max(160).optional(),
    quantity: QuantitySchema.optional(),
  })
  .strict();
export type LocalConcept = z.infer<typeof LocalConceptSchema>;

export const LocalClaimSchema = z
  .object({
    text: z.string().min(1).max(160),
    /** Local concept ids (from this same extraction's `concepts`) this claim relates to, if any — not a global concept id. */
    about: z.array(z.string()).max(5).optional(),
  })
  .strict();
export type LocalClaim = z.infer<typeof LocalClaimSchema>;

export const LocalRelationshipSchema = z
  .object({
    from: z.string().regex(LOCAL_ID_PATTERN),
    to: z.string().regex(LOCAL_ID_PATTERN),
    type: RelationshipTypeSchema,
    label: z.string().max(40).optional(),
  })
  .strict();
export type LocalRelationship = z.infer<typeof LocalRelationshipSchema>;

export const LocalMeaningSchema = z
  .object({
    concepts: z.array(LocalConceptSchema).max(10),
    claims: z.array(LocalClaimSchema).max(8),
    relationships: z.array(LocalRelationshipSchema).max(10),
    /** One-sentence statement of what THIS speech alone means — not yet reconciled against currentState. */
    interpretation: z.string().max(240),
  })
  .strict();
export type LocalMeaning = z.infer<typeof LocalMeaningSchema>;

export const EMPTY_LOCAL_MEANING: LocalMeaning = { concepts: [], claims: [], relationships: [], interpretation: "" };
