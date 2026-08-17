import { extractSpokenNumbers } from "../math/ground";
import { evaluateVisualCandidate, type VisualCandidateFamily } from "./candidate";
import { causeEdgesFormChain, parseExplicitCauseEffect } from "./cause";
import { EXPLICIT_COMPARISON_CUE, parseComparisonOpener, parseExplicitComparison } from "./comparison";
import type { SettledThought } from "./types";

export const VISUAL_EVIDENCE_MAX_AGE_MS = 12_000;
export const VISUAL_EVIDENCE_MAX_THOUGHTS = 2;
export const VISUAL_EVIDENCE_MAX_CHARS = 600;
export const SEQUENCE_EVIDENCE_MAX_AGE_MS = 20_000;
export const SEQUENCE_EVIDENCE_MAX_THOUGHTS = 5;
export const SEQUENCE_EVIDENCE_MAX_CHARS = 900;
export const CAUSE_EVIDENCE_MAX_AGE_MS = 16_000;
export const CAUSE_EVIDENCE_MAX_THOUGHTS = 4;
export const CAUSE_EVIDENCE_MAX_CHARS = 720;
export const COMPARISON_EVIDENCE_MAX_AGE_MS = 16_000;
export const COMPARISON_EVIDENCE_MAX_THOUGHTS = 4;
export const COMPARISON_EVIDENCE_MAX_CHARS = 720;

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
  sequenceEvidence?: "opened" | "extended" | "completed";
  causeEvidence?: "opened" | "extended" | "completed";
  comparisonEvidence?: "opened" | "extended" | "completed";
}

const EXPLICIT_LIST_CUE = /\b(?:two|three|four|five|2|3|4|5)\s+(?:things|reasons|steps|priorities|goals|items|ways|areas|features|benefits|problems|options|parts|principles|changes|improvements)\b/i;
const PRESENTATION_CUE = /\b(?:the\s+following|(?:our|my)\s+(?:top|main)\s+(?:priorities|goals|reasons|options))\b/i;
const ORDERED_PAIR = /\b(?:first|firstly)\b[\s\S]{0,240}\b(?:second|secondly)\b/i;
const PERIOD_CUE = /\b(?:last|this|previous|current|next)\s+(?:week|month|quarter|year)\b|\b(?:before|after|then|now|today|yesterday)\b/i;
const SEQUENCE_OPENER = /^(?:\s*)(?:first(?:ly)?\b|step\s+(?:one|1)\b|the\s+process\s+is\b|there\s+are\s+(?:two|three|four|five|2|3|4|5)\s+steps\b|the\s+way\s+(?:i|we)\s+(?:usually\s+)?do\s+it\b)/i;
const SEQUENCE_CONTINUATION = /^(?:\s*)(?:then\b|next\b|after\s+that\b|finally\b|second(?:ly)?\b|third(?:ly)?\b|step\s+(?:one|two|three|four|five|[1-5])\b|once\s+(?:that(?:'s|\s+is)|this\s+is)\s+(?:done|finished|complete)\b|only\s+after\s+that\b)/i;
const SEQUENCE_TERMINAL = /\b(?:finally|last(?:ly)?|final\s+step|step\s+(?:five|5))\b/i;
const STEP_MARKER = /\b(?:step\s+(?:one|two|three|four|five|[1-5])|first(?:ly)?|second(?:ly)?|third(?:ly)?|fourth(?:ly)?|fifth(?:ly)?)\b/gi;
const STEP_COUNTS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, "2": 2, "3": 3, "4": 4, "5": 5 };

function firstSentence(text: string): string {
  return text.split(/[.!?](?:\s|$)/, 1)[0]?.trim() ?? "";
}

/** A deliberately narrow flat-list signal, not a general noun-sequence parser. */
function hasFlatListPayload(text: string): boolean {
  const lead = firstSentence(text);
  const hasComma = lead.includes(",");
  const hasIntroducedPair = lead.includes(":") && /\b(?:and|or)\b/i.test(lead);
  if (!hasComma && !hasIntroducedPair) return false;
  const pieces = lead
    .split(/,|\b(?:and|or)\b/i)
    .map((part) => part.trim())
    .filter(Boolean);
  return pieces.length >= (hasIntroducedPair ? 2 : 3) && pieces.length <= 6;
}

function isIncompleteEnumeration(text: string): boolean {
  const hasCue = EXPLICIT_LIST_CUE.test(text) || PRESENTATION_CUE.test(text);
  return hasCue && !ORDERED_PAIR.test(text) && !hasFlatListPayload(text);
}

function pendingFamily(text: string): VisualCandidateFamily | null {
  if (SEQUENCE_OPENER.test(text)) return "sequence";
  if (isIncompleteEnumeration(text)) return "enumeration";
  const numbers = extractSpokenNumbers(text);
  if (numbers.size === 1 && PERIOD_CUE.test(text)) return "quantitative_change";
  if (parseComparisonOpener(text) || /\bsolve(?:s|d)?\s+(?:the\s+problem\s+)?differently\b/i.test(text)) return "comparison";
  return null;
}

function declaredSequenceCount(text: string): number | null {
  const match = /\b(?:there\s+are|here\s+are)\s+(two|three|four|five|2|3|4|5)\s+steps\b/i.exec(text);
  return match ? STEP_COUNTS[match[1].toLowerCase()] ?? null : null;
}

function sequenceStepMarkerCount(text: string): number {
  return [...text.matchAll(STEP_MARKER)].length;
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

function isUsable(entry: VisualEvidenceEntry, thought: SettledThought): boolean {
  return entry.thought.page === thought.page &&
    thought.settledAt - entry.thought.settledAt <= VISUAL_EVIDENCE_MAX_AGE_MS;
}

/**
 * Completes only the two supported families across a tiny, same-page window.
 * It never accumulates arbitrary prose: one incomplete opener is retained,
 * and an unrelated next thought clears it.
 */
export function advanceVisualEvidence(
  window: VisualEvidenceEntry[],
  thought: SettledThought,
): VisualEvidenceDecision {
  const comparisonWindow = window.filter((entry) => entry.family === "comparison");
  const comparisonRetained = comparisonWindow.length > 0 &&
    comparisonWindow.every((entry) => entry.thought.page === thought.page) &&
    thought.settledAt - comparisonWindow[0].thought.settledAt <= COMPARISON_EVIDENCE_MAX_AGE_MS
    ? comparisonWindow.slice(-(COMPARISON_EVIDENCE_MAX_THOUGHTS - 1))
    : [];
  const causeWindow = window.filter((entry) => entry.family === "cause_effect");
  const causeRetained = causeWindow.length > 0 &&
    causeWindow.every((entry) => entry.thought.page === thought.page) &&
    thought.settledAt - causeWindow[0].thought.settledAt <= CAUSE_EVIDENCE_MAX_AGE_MS
    ? causeWindow.slice(-(CAUSE_EVIDENCE_MAX_THOUGHTS - 1))
    : [];
  const sequenceWindow = window.filter((entry) => entry.family === "sequence");
  const sequenceRetained = sequenceWindow.length > 0 &&
    sequenceWindow.every((entry) => entry.thought.page === thought.page) &&
    thought.settledAt - sequenceWindow[0].thought.settledAt <= SEQUENCE_EVIDENCE_MAX_AGE_MS
    ? sequenceWindow.slice(-(SEQUENCE_EVIDENCE_MAX_THOUGHTS - 1))
    : [];
  const retained = window
    .filter((entry) => entry.family !== "sequence" && entry.family !== "cause_effect" && entry.family !== "comparison" && isUsable(entry, thought))
    .slice(-(VISUAL_EVIDENCE_MAX_THOUGHTS - 1));
  const single = evaluateVisualCandidate(thought.text);

  if (comparisonRetained.length > 0) {
    const entries = [...comparisonRetained, { thought, family: "comparison" as const }];
    const joined = combine(entries.map((entry) => entry.thought));
    const parsed = parseExplicitComparison(joined.text);
    if (joined.text.length <= COMPARISON_EVIDENCE_MAX_CHARS && entries.length <= COMPARISON_EVIDENCE_MAX_THOUGHTS && parsed.intent) {
      const leftClaims = parsed.intent.rows.filter((row) => row.left).length;
      const rightClaims = parsed.intent.rows.filter((row) => row.right).length;
      if (entries.length < 3 && leftClaims !== rightClaims) {
        return {
          status: "pending", candidate: null, next: entries, family: "comparison",
          reason: "held an uneven comparison briefly for a literal continuation", comparisonEvidence: "extended",
        };
      }
      return {
        status: "candidate", candidate: joined, next: [], family: "comparison",
        reason: `completed comparison across ${entries.length} settled thoughts`, comparisonEvidence: "completed",
      };
    }
    const stillForming = joined.text.length <= COMPARISON_EVIDENCE_MAX_CHARS && entries.length < COMPARISON_EVIDENCE_MAX_THOUGHTS &&
      (EXPLICIT_COMPARISON_CUE.test(joined.text) || entries.some((entry) => Boolean(parseComparisonOpener(entry.thought.text))));
    if (stillForming) {
      return {
        status: "pending", candidate: null, next: entries, family: "comparison",
        reason: `extended bounded comparison evidence to ${entries.length} settled thoughts`, comparisonEvidence: "extended",
      };
    }
    return { status: "rejected", candidate: null, next: [], family: "comparison", reason: "unrelated or unsafe thought closed pending comparison evidence" };
  }

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

  if (single.candidate && !isIncompleteEnumeration(thought.text)) {
    return { status: "candidate", candidate: thought, next: [], reason: single.reason, family: single.family };
  }

  if (sequenceRetained.length > 0) {
    if (!SEQUENCE_CONTINUATION.test(thought.text)) {
      return { status: "rejected", candidate: null, next: [], reason: "unrelated thought closed pending sequence evidence", family: "sequence" };
    }
    const entries = [...sequenceRetained, { thought, family: "sequence" as const }];
    const joined = combine(entries.map((entry) => entry.thought));
    const declared = declaredSequenceCount(joined.text);
    const declaredComplete = declared !== null && sequenceStepMarkerCount(joined.text) >= declared;
    const terminal = SEQUENCE_TERMINAL.test(thought.text) || declaredComplete;
    if (joined.text.length > SEQUENCE_EVIDENCE_MAX_CHARS || entries.length > SEQUENCE_EVIDENCE_MAX_THOUGHTS) {
      return { status: "rejected", candidate: null, next: [], reason: "sequence evidence exceeded its bounded window", family: "sequence" };
    }
    if (terminal) {
      const joinedDecision = evaluateVisualCandidate(joined.text);
      if (joinedDecision.candidate && joinedDecision.family === "sequence") {
        return {
          status: "candidate",
          candidate: joined,
          next: [],
          reason: `completed sequence evidence across ${entries.length} settled thoughts`,
          family: "sequence",
          sequenceEvidence: "completed",
        };
      }
    }
    return {
      status: "pending",
      candidate: null,
      next: entries,
      reason: `extended bounded sequence evidence to ${entries.length} settled thoughts`,
      family: "sequence",
      sequenceEvidence: "extended",
    };
  }

  const prior = retained[retained.length - 1];
  if (prior) {
    const joined = combine([prior.thought, thought]);
    const joinedDecision = evaluateVisualCandidate(joined.text);
    const complete = joined.text.length <= VISUAL_EVIDENCE_MAX_CHARS &&
      joinedDecision.candidate &&
      joinedDecision.family === prior.family &&
      (prior.family !== "enumeration" || hasFlatListPayload(thought.text));
    if (complete) {
      return {
        status: "candidate",
        candidate: joined,
        next: [],
        reason: `completed ${prior.family} evidence across 2 settled thoughts`,
        family: prior.family,
      };
    }
  }

  const family = pendingFamily(thought.text);
  if (family && thought.text.length <= VISUAL_EVIDENCE_MAX_CHARS) {
    if (family === "sequence" && thought.text.length <= SEQUENCE_EVIDENCE_MAX_CHARS) {
      return {
        status: "pending",
        candidate: null,
        next: [{ thought, family }],
        reason: "opened bounded same-page sequence evidence",
        family,
        sequenceEvidence: "opened",
      };
    }
    if (family === "comparison" && thought.text.length <= COMPARISON_EVIDENCE_MAX_CHARS) {
      return {
        status: "pending", candidate: null, next: [{ thought, family }], reason: "opened bounded same-page comparison evidence",
        family, comparisonEvidence: "opened",
      };
    }
    return {
      status: "pending",
      candidate: null,
      next: [{ thought, family }],
      reason: `incomplete ${family} evidence retained briefly`,
      family,
    };
  }

  return {
    status: "rejected",
    candidate: null,
    next: [],
    reason: single.reason || "no complete supported visual pattern in the bounded evidence window",
  };
}

/** Flushes a valid uneven comparison after its brief continuation window expires. */
export function completePendingComparisonEvidence(window: VisualEvidenceEntry[]): VisualEvidenceDecision | null {
  const entries = window.filter((entry) => entry.family === "comparison");
  if (entries.length < 2) return null;
  const joined = combine(entries.map((entry) => entry.thought));
  const parsed = parseExplicitComparison(joined.text);
  if (!parsed.intent) return null;
  return {
    status: "candidate", candidate: joined, next: [], family: "comparison",
    reason: "completed comparison after bounded continuation delay", comparisonEvidence: "completed",
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
