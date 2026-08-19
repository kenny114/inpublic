import { parseExplicitCauseEffect } from "./cause";

export type VisualCandidateFamily = "cause_effect";

export interface VisualCandidateDecision {
  candidate: boolean;
  family?: VisualCandidateFamily;
  reason: string;
}

/**
 * Cheap, deliberately conservative prefilter. It only admits the one
 * supported structure (an explicit causal assertion) that cause_effect can
 * represent; ordinary noun sequences, relationships, hierarchies, lists, and
 * number mentions all stay text-only.
 */
export function evaluateVisualCandidate(text: string): VisualCandidateDecision {
  const spoken = text.trim();
  if (!spoken) return { candidate: false, reason: "empty thought" };

  const causal = parseExplicitCauseEffect(spoken);
  if (causal.intent) {
    return { candidate: true, family: "cause_effect", reason: causal.reason };
  }

  return { candidate: false, reason: causal.reason };
}
