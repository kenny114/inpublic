/**
 * Types for Visual Re-entry.
 *
 * Zod schemas are the source of truth here (same posture as
 * lib/math/types.ts, the only other schema-validated domain in this
 * codebase): a settled thought is symbolic/textual input, the decision's
 * intent is validated output, and neither ever carries a pixel coordinate —
 * geometry belongs to lib/visualReentry/render.ts alone.
 *
 * Both branches parse with `.strict()` — an unexpected/extra field
 * (e.g. a stray `x`/`y`) fails validation outright rather than being
 * silently stripped, per the "malformed data -> none" rule this schema is
 * deliberately small enough to enforce by construction. There is no branch
 * that reaches Beat/Artist's free-form action shape (lib/types.ts's
 * `BeatAction`/canvas actions) — a settled thought either fits the one
 * supported visual family exactly, or it gets `none`. Nothing here ever
 * falls back to a free-form Artist action.
 *
 * Only one visual family survives here: cause_effect (box-and-arrow). The
 * enumeration/quantitative_change/sequence/comparison families, and the
 * local note/relation fallback, were deliberately removed — one visual
 * language, not six.
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

/** The branches that actually render — i.e. VisualReentryIntent minus "none". */
export const VisualReentrySpecSchema = CauseEffectIntentSchema;
export type VisualReentrySpec = z.infer<typeof VisualReentrySpecSchema>;

export const VisualReentryIntentSchema = z.union([NoneIntentSchema, CauseEffectIntentSchema]);
export type VisualReentryIntent = z.infer<typeof VisualReentryIntentSchema>;

export function fallbackNone(reason: string): NoneIntent {
  return { type: "none", reason };
}
