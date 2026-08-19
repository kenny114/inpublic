import { evaluateVisualCandidate } from "./candidate";
import { parseExplicitCauseEffect } from "./cause";
import type { SettledThought, VisualReentrySpec } from "./types";

export type VisualDecisionSource = "deterministic_fast_path" | "model_fallback";

export interface DeterministicVisualIntentResult {
  intent: VisualReentrySpec | null;
  reason: string;
}

/**
 * Exceptionally conservative extraction for the one supported visual family.
 * Returning null means "cause.ts's deterministic grammar found nothing" —
 * lib/visualReentry/orchestrate.ts falls back to the narrow model call in
 * lib/visualReentry/decide.ts, but only when
 * lib/visualReentry/candidate.ts's loosened prefilter still thinks the
 * clause is worth asking about.
 */
export function tryDeterministicVisualIntent(thought: SettledThought): DeterministicVisualIntentResult {
  const family = evaluateVisualCandidate(thought.text).family;
  if (family !== "cause_effect") return { intent: null, reason: "no supported candidate family owns this source structure" };
  const parsed = parseExplicitCauseEffect(thought.text);
  return { intent: parsed.intent, reason: parsed.reason };
}
