/**
 * Pure, deterministic per-beat evidence detectors — no model, no network.
 *
 * Both functions here run after the Artist's batch for this beat has already
 * been applied (see the call sites in components/Board.tsx's runBeat, right
 * after `applyActions`), so every candidate concept is either already a real
 * `Concept` or it isn't, with zero extra round trips spent finding out. That
 * is also why neither can ever introduce a *new* concept: a comparison or a
 * process signal is only recognized between things that already exist — reuse,
 * never duplicate, and false-positive movement is worse than a missed one.
 *
 * `detectComparison` recognizes a comparison in one shot from a single beat's
 * transcript. `detectProcessSignal` recognizes only one directed edge per
 * beat — a process (a chain of 3+ ordered concepts) requires multiple edges
 * observed across multiple beats, which is why the accumulation lives one
 * level up in lib/directorState.ts rather than here.
 */

import { extractConcepts } from "./sketch";
import { similarity, type Concept, type SemanticBoard } from "./semantic";

export interface ComparisonEvidence {
  leftConceptId: string;
  rightConceptId: string;
  /** The marker word/phrase that signalled the comparison, lowercased. */
  relationshipLabel: string;
  /** The transcript text this was recognized from, for logging/debugging. */
  evidence: string;
  confidence: number;
}

/**
 * Real clause-boundary contrast markers. Deliberately not just "but" — Part
 * 18 requires semantic evidence beyond the word alone, which is why a marker
 * match is necessary but never sufficient here: both sides still have to
 * resolve to distinct, already-existing concepts before anything fires.
 */
const MARKER_RE =
  /\b(compared with|compared to|on the other hand|however|whereas|unlike|versus|vs\.?|while|but)\b/i;

/** Both clause->concept matches must be at least this strong to count as evidence. */
export const MIN_COMPARISON_CONFIDENCE = 0.5;

/** Order-independent identity for a pair, so the same comparison never re-triggers. */
export function comparisonPairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

/**
 * Resolve a clause to the board concept it's most likely referring to.
 *
 * `extractConcepts` is tuned for streaming dedupe (it needs a `seen` set and
 * splits on filler words), not exact phrase boundaries, so a phrase it
 * extracts is tried first but the whole clause is always tried too — a short
 * clause like "product" or "the second option" may not survive
 * `extractConcepts`'s stopword/length filters at all.
 */
function bestConceptMatch(clause: string, board: SemanticBoard): { concept: Concept; score: number } | null {
  const phrases = extractConcepts(clause, new Set<string>());
  const attempts = phrases.length ? [...phrases, clause] : [clause];
  let best: { concept: Concept; score: number } | null = null;
  for (const phrase of attempts) {
    const concept = board.match(phrase);
    if (!concept) continue;
    const score = similarity(phrase, concept.label);
    if (!best || score > best.score) best = { concept, score };
  }
  return best;
}

/**
 * `sourceText` is the finalized transcript text a beat just consumed (the
 * same string `applyActions` was called with) — not an interim, so a clause
 * boundary found here is real, not a guess about where the speaker will stop.
 */
/**
 * "unlike"/"compared to"/"compared with" normally lead the sentence and
 * introduce BOTH things being compared after themselves, separated by a
 * comma ("Unlike traditional search, this works visually") — there is no
 * clause before the marker to be one side of the comparison, unlike
 * "but"/"however"/"while", which sit between two clauses.
 */
const LEADING_MARKERS = new Set(["unlike", "compared with", "compared to"]);

export function detectComparison(
  sourceText: string,
  board: SemanticBoard,
  alreadyPaired: Set<string>,
): ComparisonEvidence | null {
  const match = MARKER_RE.exec(sourceText);
  if (!match || match.index === undefined) return null;

  const marker = match[0];
  const before = sourceText.slice(0, match.index).trim();
  let left: string;
  let right: string;
  if (LEADING_MARKERS.has(marker.toLowerCase()) && !before) {
    const rest = sourceText.slice(match.index + marker.length);
    const commaIndex = rest.indexOf(",");
    if (commaIndex === -1) return null;
    left = rest.slice(0, commaIndex).trim();
    right = rest.slice(commaIndex + 1).trim();
  } else {
    left = before;
    right = sourceText.slice(match.index + marker.length).trim();
  }
  if (!left || !right) return null;

  const leftMatch = bestConceptMatch(left, board);
  const rightMatch = bestConceptMatch(right, board);
  if (!leftMatch || !rightMatch) return null;
  if (leftMatch.concept.conceptId === rightMatch.concept.conceptId) return null;

  const confidence = Math.min(leftMatch.score, rightMatch.score);
  if (confidence < MIN_COMPARISON_CONFIDENCE) return null;

  const key = comparisonPairKey(leftMatch.concept.conceptId, rightMatch.concept.conceptId);
  if (alreadyPaired.has(key)) return null;

  return {
    leftConceptId: leftMatch.concept.conceptId,
    rightConceptId: rightMatch.concept.conceptId,
    relationshipLabel: marker.toLowerCase(),
    evidence: sourceText,
    confidence,
  };
}

// --- process signal ---------------------------------------------------

export interface ProcessSignalEvidence {
  fromConceptId: string;
  toConceptId: string;
  /** The marker word/phrase that signalled the ordering, lowercased. */
  marker: string;
  /** The transcript text this was recognized from, for logging/debugging. */
  evidence: string;
  confidence: number;
}

/**
 * Sequence/order markers. Keywords are evidence, not commands — hearing
 * "then" does not by itself mean a process exists; it only yields one
 * directed edge between two concepts already on the board. Whether enough
 * edges accumulate into an actual process is lib/directorState.ts's job.
 */
const PROCESS_MARKER_RE =
  /\b(then|next|after that|afterward|afterwards|eventually|subsequently|passes through|becomes|turns into|produces|leads to|results in|followed by)\b/i;

/** Both clause->concept matches must be at least this strong to count as evidence. */
export const MIN_PROCESS_SIGNAL_CONFIDENCE = 0.5;

/**
 * Resolve one directed "X -> Y" edge from a single beat's transcript, mid-
 * sentence only (no leading-marker shape like comparison's "unlike X, Y" —
 * process markers naturally sit between two clauses: "X, then Y"). A beat
 * like "Then it becomes the output", spoken on its own with no left-hand
 * clause, deliberately does not resolve: favoring a false negative here over
 * guessing which earlier concept "it" refers to.
 *
 * Only the first marker match in the text is used — a single beat only ever
 * yields one edge, which is exactly why a process (3+ ordered concepts)
 * requires evidence gathered across multiple beats.
 */
export function detectProcessSignal(sourceText: string, board: SemanticBoard): ProcessSignalEvidence | null {
  const match = PROCESS_MARKER_RE.exec(sourceText);
  if (!match || match.index === undefined) return null;

  const marker = match[0];
  const left = sourceText.slice(0, match.index).trim();
  const right = sourceText.slice(match.index + marker.length).trim();
  if (!left || !right) return null;

  const leftMatch = bestConceptMatch(left, board);
  const rightMatch = bestConceptMatch(right, board);
  if (!leftMatch || !rightMatch) return null;
  if (leftMatch.concept.conceptId === rightMatch.concept.conceptId) return null;

  const confidence = Math.min(leftMatch.score, rightMatch.score);
  if (confidence < MIN_PROCESS_SIGNAL_CONFIDENCE) return null;

  return {
    fromConceptId: leftMatch.concept.conceptId,
    toConceptId: rightMatch.concept.conceptId,
    marker: marker.toLowerCase(),
    evidence: sourceText,
    confidence,
  };
}
