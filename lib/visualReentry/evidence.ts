import { evaluateVisualCandidate, type VisualCandidateFamily } from "./candidate";
import { causeEdgesFormChain, parseExplicitCauseEffect } from "./cause";
import type { SettledThought } from "./types";

export const CAUSE_EVIDENCE_MAX_AGE_MS = 16_000;
export const CAUSE_EVIDENCE_MAX_THOUGHTS = 4;
export const CAUSE_EVIDENCE_MAX_CHARS = 720;

export interface VisualEvidenceEntry {
  thought: SettledThought;
  family: VisualCandidateFamily;
}

export interface VisualEvidenceDecision {
  status: "candidate" | "pending" | "rejected";
  candidate: SettledThought | null;
  next: VisualEvidenceEntry[];
  reason: string;
  family?: VisualCandidateFamily;
  causeEvidence?: "opened" | "extended" | "completed";
}

function combine(thoughts: SettledThought[]): SettledThought {
  const newest = thoughts[thoughts.length - 1];
  const regions = thoughts.flatMap((thought) => thought.sourceRegion ? [thought.sourceRegion] : []);
  return {
    id: `evidence:${thoughts.map((thought) => thought.id).join("+")}`,
    text: thoughts.map((thought) => thought.text.trim()).filter(Boolean).join(" "),
    sourceSegments: thoughts.flatMap((thought) => thought.sourceSegments),
    page: newest.page,
    startedAt: Math.min(...thoughts.map((thought) => thought.startedAt ?? thought.settledAt)),
    settledAt: newest.settledAt,
    sessionGeneration: newest.sessionGeneration,
    sourceRegion: regions.length ? {
      audioStartMs: Math.min(...regions.map((region) => region.audioStartMs)),
      audioEndMs: Math.max(...regions.map((region) => region.audioEndMs)),
    } : undefined,
    participantThoughtIds: thoughts.flatMap((thought) => thought.participantThoughtIds ?? [thought.id]),
  };
}

/**
 * Completes only the one supported family (cause_effect) across a tiny,
 * same-page window. It never accumulates arbitrary prose: one incomplete
 * causal opener is retained, and an unrelated next thought clears it.
 */
export function advanceVisualEvidence(
  window: VisualEvidenceEntry[],
  thought: SettledThought,
): VisualEvidenceDecision {
  const causeWindow = window.filter((entry) => entry.family === "cause_effect");
  const causeRetained = causeWindow.length > 0 &&
    causeWindow.every((entry) => entry.thought.page === thought.page) &&
    thought.settledAt - causeWindow[0].thought.settledAt <= CAUSE_EVIDENCE_MAX_AGE_MS
    ? causeWindow.slice(-(CAUSE_EVIDENCE_MAX_THOUGHTS - 1))
    : [];
  const single = evaluateVisualCandidate(thought.text);

  if (causeRetained.length > 0) {
    const entries = [...causeRetained, { thought, family: "cause_effect" as const }];
    const joined = combine(entries.map((entry) => entry.thought));
    const parsed = parseExplicitCauseEffect(joined.text);
    if (joined.text.length <= CAUSE_EVIDENCE_MAX_CHARS && entries.length <= CAUSE_EVIDENCE_MAX_THOUGHTS && parsed.intent && causeEdgesFormChain(parsed.intent)) {
      return {
        status: "candidate", candidate: joined, next: [], family: "cause_effect",
        reason: `completed causal chain across ${entries.length} settled thoughts`, causeEvidence: "completed",
      };
    }
    return { status: "rejected", candidate: null, next: [], family: "cause_effect", reason: "unrelated or unsafe thought closed pending causal evidence" };
  }

  if (single.candidate && single.family === "cause_effect") {
    const parsed = parseExplicitCauseEffect(thought.text);
    if (parsed.intent?.edges.length === 1 && thought.text.length <= CAUSE_EVIDENCE_MAX_CHARS) {
      return {
        status: "pending", candidate: null, next: [{ thought, family: "cause_effect" }], family: "cause_effect",
        reason: "opened bounded same-page causal evidence", causeEvidence: "opened",
      };
    }
    return { status: "candidate", candidate: thought, next: [], reason: single.reason, family: single.family, causeEvidence: "completed" };
  }

  if (single.candidate) {
    // The deterministic grammar found no complete edge, but the loosened
    // candidate.ts prefilter still thinks this is a plausible clause — pass
    // it straight through as a single-thought candidate rather than folding
    // it into the multi-thought causal evidence window (that window only
    // exists to stitch together a chain the deterministic grammar already
    // recognizes one edge of). The model in lib/visualReentry/decide.ts
    // decides on this thought's full text alone, via
    // lib/visualReentry/orchestrate.ts's fast-path-then-model-fallback flow.
    return { status: "candidate", candidate: thought, next: [], reason: single.reason };
  }

  return {
    status: "rejected",
    candidate: null,
    next: [],
    reason: single.reason || "no complete supported visual pattern in the bounded evidence window",
  };
}

/** Flushes a one-edge causal opener after a short collection delay so a standalone assertion is never lost. */
export function completePendingCauseEvidence(window: VisualEvidenceEntry[]): VisualEvidenceDecision | null {
  const causes = window.filter((entry) => entry.family === "cause_effect");
  if (causes.length !== 1) return null;
  const parsed = parseExplicitCauseEffect(causes[0].thought.text);
  if (!parsed.intent || parsed.intent.edges.length !== 1) return null;
  return {
    status: "candidate", candidate: causes[0].thought, next: [], family: "cause_effect",
    reason: "completed standalone causal evidence after bounded collection delay", causeEvidence: "completed",
  };
}
