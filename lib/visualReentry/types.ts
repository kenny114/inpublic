/**
 * Types for Visual Re-entry, including the Sequence V2 extension.
 *
 * Zod schemas are the source of truth here (same posture as
 * lib/math/types.ts, the only other schema-validated domain in this
 * codebase): a settled thought is symbolic/textual input, the model's
 * intent is validated output, and neither ever carries a pixel coordinate —
 * geometry belongs to lib/visualReentry/render.ts alone.
 *
 * All three branches parse with `.strict()` — an unexpected/extra field
 * (e.g. a stray `x`/`y`, or a field that belongs to a different branch)
 * fails validation outright rather than being silently stripped, per the
 * "malformed data -> none" rule this schema is deliberately small enough to
 * enforce by construction. There is no branch that reaches Beat/Artist's
 * free-form action shape (lib/types.ts's `BeatAction`/canvas actions) — a
 * settled thought either fits one of these three visual families exactly, or
 * it gets `none`. Nothing here ever falls back to a free-form Artist action.
 */

import { z } from "zod";

/**
 * "A V2 thought has finished presenting" — the one thing V2 hands
 * downstream. Constructed only in components/Board.tsx's handleFinal, at
 * the exact point pushStructuralSegment (lib/liveSpeech.ts) reports a
 * completed thought under V2.
 */
export interface SettledThought {
  id: string;
  text: string;
  sourceSegments: string[];
  page: number;
  /** Session-clock time at which the first contributing final was received. */
  startedAt?: number;
  settledAt: number;
  sessionGeneration?: number;
  sourceRegion?: {
    audioStartMs: number;
    audioEndMs: number;
  };
  /** Present on combined evidence sources; single thoughts implicitly contain their own id. */
  participantThoughtIds?: string[];
}

export const NoneIntentSchema = z
  .object({
    type: z.literal("none"),
    reason: z.string().min(1),
  })
  .strict();
export type NoneIntent = z.infer<typeof NoneIntentSchema>;

export const EnumerationIntentSchema = z
  .object({
    type: z.literal("enumeration"),
    title: z.string().optional(),
    /** 2-5 per V1's brief. A model that tries to send more (or fewer) fails validation outright rather than being silently truncated — see lib/visualReentry/ground.ts's doc comment. */
    items: z.array(z.string().min(1)).min(2).max(5),
    /** Verbatim-or-near-verbatim phrase(s) from the source text this item list was extracted from — what lib/visualReentry/ground.ts checks before this intent is allowed to render. */
    evidence: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type EnumerationIntent = z.infer<typeof EnumerationIntentSchema>;

export const QuantitativeQualifierSchema = z.enum(["about", "around", "roughly", "approximately"]);
export type QuantitativeQualifier = z.infer<typeof QuantitativeQualifierSchema>;

export const QuantitativeChangeIntentSchema = z
  .object({
    type: z.literal("quantitative_change"),
    from: z.number(),
    to: z.number(),
    /** Literal source modality for this anchor. Omitted means the speaker stated an exact value. */
    fromQualifier: QuantitativeQualifierSchema.optional(),
    /** Literal source modality for this anchor. Omitted means the speaker stated an exact value. */
    toQualifier: QuantitativeQualifierSchema.optional(),
    unit: z.string().optional(),
    fromLabel: z.string().optional(),
    toLabel: z.string().optional(),
    /** Verbatim-or-near-verbatim phrase(s) from the source text this from/to pair was extracted from. */
    evidence: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type QuantitativeChangeIntent = z.infer<typeof QuantitativeChangeIntentSchema>;

export const SequenceIntentSchema = z
  .object({
    type: z.literal("sequence"),
    title: z.string().optional(),
    /** V2 stays compact: never silently truncate a longer process. */
    steps: z.array(z.string().min(1)).min(2).max(5),
    /** Verbatim-or-near-verbatim source phrases supporting the ordered steps. */
    evidence: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type SequenceIntent = z.infer<typeof SequenceIntentSchema>;

export const CauseEffectEdgeSchema = z
  .object({
    from: z.number().int().min(0).max(3),
    to: z.number().int().min(0).max(3),
    /** Literal causal clause retaining source, target, cue, and direction. */
    evidence: z.string().min(1),
  })
  .strict();
export type CauseEffectEdge = z.infer<typeof CauseEffectEdgeSchema>;

export const CauseEffectIntentSchema = z
  .object({
    type: z.literal("cause_effect"),
    title: z.string().optional(),
    nodes: z.array(z.string().min(1)).min(2).max(4),
    edges: z.array(CauseEffectEdgeSchema).min(1).max(3),
    evidence: z.array(z.string().min(1)).min(1),
  })
  .strict()
  .superRefine((intent, ctx) => {
    for (const [index, edge] of intent.edges.entries()) {
      if (edge.from >= intent.nodes.length || edge.to >= intent.nodes.length || edge.from === edge.to) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["edges", index], message: "edge endpoints must reference two distinct nodes" });
      }
    }
    const visiting = new Set<number>();
    const visited = new Set<number>();
    const visit = (node: number): boolean => {
      if (visiting.has(node)) return true;
      if (visited.has(node)) return false;
      visiting.add(node);
      for (const edge of intent.edges) if (edge.from === node && visit(edge.to)) return true;
      visiting.delete(node);
      visited.add(node);
      return false;
    };
    if (intent.nodes.some((_, index) => visit(index))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["edges"], message: "cause_effect must be acyclic" });
    }
  });
export type CauseEffectIntent = z.infer<typeof CauseEffectIntentSchema>;

export const ComparisonRowSchema = z
  .object({
    left: z.string().min(1).optional(),
    right: z.string().min(1).optional(),
    evidence: z.array(z.string().min(1)).min(1),
  })
  .strict()
  .refine((row) => Boolean(row.left || row.right), { message: "comparison row requires at least one supported claim" });
export type ComparisonRow = z.infer<typeof ComparisonRowSchema>;

export const ComparisonIntentSchema = z
  .object({
    type: z.literal("comparison"),
    leftLabel: z.string().min(1),
    rightLabel: z.string().min(1),
    rows: z.array(ComparisonRowSchema).min(1).max(4),
    evidence: z.array(z.string().min(1)).min(1),
  })
  .strict()
  .refine((intent) => intent.leftLabel.trim().toLowerCase() !== intent.rightLabel.trim().toLowerCase(), {
    message: "comparison requires two distinct subjects",
    path: ["rightLabel"],
  });
export type ComparisonIntent = z.infer<typeof ComparisonIntentSchema>;

/** Deterministic sketchnote lettering — never emitted by the model. */
export const NoteIntentSchema = z
  .object({
    type: z.literal("note"),
    text: z.string().min(1),
    emphasis: z.boolean().optional(),
    evidence: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type NoteIntent = z.infer<typeof NoteIntentSchema>;

/** Two short marks with a labelled connector — never emitted by the model. */
export const RelationIntentSchema = z
  .object({
    type: z.literal("relation"),
    from: z.string().min(1),
    to: z.string().min(1),
    label: z.string().optional(),
    evidence: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type RelationIntent = z.infer<typeof RelationIntentSchema>;

/** The branches that actually render — i.e. VisualReentryIntent minus "none", plus local expression. */
export const VisualReentrySpecSchema = z.union([
  EnumerationIntentSchema,
  QuantitativeChangeIntentSchema,
  SequenceIntentSchema,
  CauseEffectIntentSchema,
  ComparisonIntentSchema,
  NoteIntentSchema,
  RelationIntentSchema,
]);
export type VisualReentrySpec = z.infer<typeof VisualReentrySpecSchema>;

export const VisualReentryIntentSchema = z.union([
  NoneIntentSchema,
  EnumerationIntentSchema,
  QuantitativeChangeIntentSchema,
  SequenceIntentSchema,
  CauseEffectIntentSchema,
  ComparisonIntentSchema,
]);
export type VisualReentryIntent = z.infer<typeof VisualReentryIntentSchema>;

/**
 * Fallback-`none` reason sentinels — shared by the server side
 * (lib/visualReentry/decide.ts) and the client side
 * (lib/visualReentry/client.ts) so lib/visualReentry/orchestrate.ts can log
 * WHY a `none` happened (a model genuinely deciding none vs. the pipeline
 * failing to get a usable decision at all) without threading a second
 * result type through the whole chain. Defined here, not in decide.ts,
 * because decide.ts is server-only and client.ts must never import it.
 */
export const REASON_MODEL_UNAVAILABLE = "model call failed or returned nothing";
export const REASON_PARSE_FAILED = "response did not parse as a valid intent";
export const REASON_REQUEST_REJECTED = "request rejected (guard/rate-limit/network)";

export function fallbackNone(reason: string): NoneIntent {
  return { type: "none", reason };
}
