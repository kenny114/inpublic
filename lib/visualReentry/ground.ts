/**
 * Grounds a cause_effect intent against the settled thought it was
 * supposedly extracted from — the same purpose lib/math/ground.ts's
 * groundEquationInSource serves for a claimed equation. Every non-`none`
 * intent carries its own `evidence` (lib/visualReentry/types.ts) — the
 * phrase(s) that justify the extraction — and each edge's own literal
 * evidence is checked individually too, so a partly-fabricated result can't
 * slip through just because its top-level evidence phrase was real.
 *
 * Normalization is deliberately harmless-differences-only: casing, simple
 * plural/singular, and punctuation are ignored, but nothing is stemmed hard
 * enough to make an invented category match a real one. If ANY evidence
 * phrase or edge fails to ground, the WHOLE intent downgrades to `none`
 * rather than the unsupported part being silently dropped — this codebase's
 * existing convention (groundEquationInSource fails the whole equation, not
 * just the unrecognised term) is "fail the visual, never silently change
 * what the speaker is understood to have said."
 *
 * An edge's endpoints and its own evidence phrase must always be literally
 * (or near-literally) present in the source — that check never weakens,
 * regardless of which tier decided the intent. When cause.ts's deterministic
 * grammar can ALSO independently parse an edge's evidence clause (the common
 * case — "X causes Y", "because X, Y"), its parsed direction is cross-checked
 * against the claimed edge as a second opinion; a mismatch there is a strong
 * signal of a bad edge and fails the intent. When the grammar recognizes
 * nothing in that clause — expected for the relationship language it was
 * never taught, which is the entire reason lib/visualReentry/decide.ts's
 * model fallback exists — there is nothing to cross-check against, and the
 * edge stands on its literal grounding alone. Requiring the deterministic
 * grammar to independently re-derive every model-sourced edge would make the
 * model fallback unable to ever contribute anything the grammar didn't
 * already catch, defeating its purpose.
 *
 * A downgraded intent is never rejected/retried: silence is always a safe
 * fallback here (invariant #12/#18 in the Visual Re-entry brief), never an
 * error, and never a fallback to a free-form Artist action.
 */

import { parseExplicitCauseEffect } from "./cause";
import type { SettledThought, VisualReentryIntent } from "./types";

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for",
  "with", "is", "are", "was", "were", "it", "that", "this", "as", "at",
  "by", "be", "we", "i", "you", "they", "he", "she",
]);

/** Crude, deliberately conservative singular/plural fold — only strips a trailing "s" off a word long enough that doing so can't turn one real word into another ("accuracy" untouched; "reasons" -> "reason"; "is"/"was" already filtered as stopwords). */
function foldPlural(word: string): string {
  return word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word;
}

/** Lowercase, strip punctuation, drop stopwords, fold harmless plurals — casing/plural/punctuation are "harmless differences"; nothing here invents a match a human wouldn't recognize as the same word. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w))
    .map(foldPlural);
}

/** Every meaningful (normalized) word of `phrase` must appear in `sourceWords` — a direct-quote-shaped check, not a loose overlap check. */
function phraseGroundedInSource(phrase: string, sourceWords: Set<string>): boolean {
  const phraseWords = words(phrase);
  if (phraseWords.length === 0) return false;
  return phraseWords.every((w) => sourceWords.has(w));
}

export interface GroundingResult {
  grounded: boolean;
  reason?: string;
}

const UNGROUNDED: VisualReentryIntent = { type: "none", reason: "grounding failed" };

/**
 * Checks a cause_effect intent's claimed content against the thought it was
 * spoken in. An evidence phrase that wasn't actually said, or an edge whose
 * endpoints/direction don't match its own literal evidence, downgrades the
 * whole intent to `none` rather than letting an invented — or a partially
 * invented — visual reach the canvas.
 */
export function groundDecision(
  intent: VisualReentryIntent,
  thought: SettledThought,
): { decision: VisualReentryIntent; result: GroundingResult } {
  if (intent.type === "none") {
    return { decision: intent, result: { grounded: true } };
  }

  const sourceText = [thought.text, ...thought.sourceSegments].join(" ");
  const sourceWords = new Set(words(sourceText));

  const ungroundedEvidence = intent.evidence.find((phrase) => !phraseGroundedInSource(phrase, sourceWords));
  if (ungroundedEvidence) {
    return {
      decision: UNGROUNDED,
      result: { grounded: false, reason: `evidence not found in source: "${ungroundedEvidence}"` },
    };
  }

  const sameConcept = (claimed: string, parsed: string): boolean => {
    const claimedWords = words(claimed);
    const parsedWords = new Set(words(parsed));
    return claimedWords.length > 0 && claimedWords.every((word) => parsedWords.has(word));
  };
  for (const [index, edge] of intent.edges.entries()) {
    const source = intent.nodes[edge.from];
    const target = intent.nodes[edge.to];
    if (!source || !target || !phraseGroundedInSource(source, sourceWords) || !phraseGroundedInSource(target, sourceWords)) {
      return { decision: UNGROUNDED, result: { grounded: false, reason: `cause_effect edge ${index} has an ungrounded endpoint` } };
    }
    if (!phraseGroundedInSource(edge.evidence, sourceWords)) {
      return { decision: UNGROUNDED, result: { grounded: false, reason: `cause_effect edge ${index} evidence not found in source: "${edge.evidence}"` } };
    }
    const edgeParse = parseExplicitCauseEffect(edge.evidence);
    if (edgeParse.intent && edgeParse.intent.edges.length === 1) {
      const parsedEdge = edgeParse.intent.edges[0];
      const parsedSource = edgeParse.intent.nodes[parsedEdge.from];
      const parsedTarget = edgeParse.intent.nodes[parsedEdge.to];
      if (!sameConcept(source, parsedSource) || !sameConcept(target, parsedTarget)) {
        return { decision: UNGROUNDED, result: { grounded: false, reason: `cause_effect edge ${index} direction/endpoints do not match its evidence` } };
      }
    }
  }
  return { decision: intent, result: { grounded: true } };
}
