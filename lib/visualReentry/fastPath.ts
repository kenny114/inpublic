import { evaluateVisualCandidate } from "./candidate";
import { parseExplicitCauseEffect } from "./cause";
import type { SettledThought, VisualReentrySpec } from "./types";

export type VisualDecisionSource = "deterministic_fast_path";

export interface DeterministicVisualIntentResult {
  intent: VisualReentrySpec | null;
  reason: string;
}

/**
 * Exceptionally conservative extraction for the one supported visual family.
 * Returning null means "no visual" — there is no model fallback left to try.
 */
export function tryDeterministicVisualIntent(thought: SettledThought): DeterministicVisualIntentResult {
  const family = evaluateVisualCandidate(thought.text).family;
  if (family !== "cause_effect") return { intent: null, reason: "no supported candidate family owns this source structure" };
  const parsed = parseExplicitCauseEffect(thought.text);
  return { intent: parsed.intent, reason: parsed.reason };
}
