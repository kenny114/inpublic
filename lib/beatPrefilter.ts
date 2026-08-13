/**
 * A local, free, instant answer to the question the Beat is asked.
 *
 * The Beat spends ~1s of Haiku deciding "has a meaningful thought landed, and
 * is it worth drawing?" In three recorded demo runs, 4 of 11 of those calls
 * came back `skip` — a full second, and a billable request, spent producing
 * nothing. A good share of that decision is mechanical: whether a sentence
 * finished, whether its nouns are already on the board, whether there is
 * enough content to draw at all.
 *
 * ## This does not replace the Beat
 *
 * It runs in shadow mode: every candidate is classified locally AND sent to
 * the model, and the two answers are logged side by side. Nothing is bypassed
 * until the agreement data says which verdicts are safe to trust. That
 * sequencing is deliberate and load-bearing — a false local `skip` silently
 * destroys a user's idea, with no error, no retry, and no trace on the canvas.
 *
 * ## The three verdicts
 *
 * - `draw`      — confident there is new, complete, drawable content.
 * - `skip`      — confident there is not.
 * - `uncertain` — anything else, which is most things.
 *
 * `uncertain` is the default and should stay the majority verdict. A
 * classifier that is rarely uncertain is a classifier that is about to lose
 * someone's sentence.
 */

import { isThoughtComplete } from "./pagination";
import { isObviouslyIncomplete } from "./liveSpeech";

export type LocalBeatVerdict = "draw" | "skip" | "uncertain";

export interface LocalBeatDecision {
  verdict: LocalBeatVerdict;
  reason: string;
}

export interface LocalBeatInput {
  /** Transcript accumulated since the last drawing. */
  pendingText: string;
  /** Labels of concepts already on the semantic board. */
  existingConcepts: string[];
  /** Loose words the Scribe has lettered on the page. */
  looseWords: string[];
  /** Consecutive skips before this call. */
  skipStreak: number;
}

/** Below this there is not enough material for a diagram under any reading. */
const MIN_CONTENT_WORDS = 4;

/**
 * Words that signal structure rather than narration.
 *
 * These are the reason a sentence is worth drawing: they assert a relation
 * between two things, which is exactly what the board renders as an arrow.
 */
const RELATION_CUES = [
  "because", "so that", "leads to", "causes", "results in", "drives",
  "depends on", "feeds", "produces", "creates", "turns into", "becomes",
  "then", "therefore", "which means", "so we", "so our", "means that",
  "first", "second", "third", "finally", "next",
  "versus", "compared to", "instead of", "rather than",
  "the problem is", "the solution is", "the goal is", "the reason",
];

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can",
  "did", "do", "does", "for", "from", "get", "got", "had", "has", "have",
  "he", "her", "him", "his", "how", "i", "if", "in", "into", "is", "it",
  "its", "just", "like", "me", "more", "most", "my", "no", "not", "now",
  "of", "off", "on", "one", "only", "or", "our", "out", "over", "own",
  "she", "so", "some", "such", "than", "that", "the", "their", "them",
  "then", "there", "these", "they", "this", "those", "to", "too", "up",
  "us", "very", "was", "we", "were", "what", "when", "where", "which",
  "while", "who", "why", "will", "with", "would", "you", "your",
  "um", "uh", "er", "ah", "oh", "yeah", "okay", "ok", "right", "well",
  "going", "gonna", "really", "actually", "basically", "literally",
]);

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").replace(/\s+/g, " ").trim();
}

function contentWords(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

function hasRelationCue(text: string): boolean {
  const clean = normalize(text);
  return RELATION_CUES.some((cue) => clean.includes(cue));
}

/**
 * How much of this speech is already represented on the board.
 *
 * Substring matching both ways, matching lib/scribeScheduler.ts: the board
 * says "AI agents" where the speaker said "agents", and either direction
 * should count as covered.
 */
function novelRatio(words: string[], known: string[]): number {
  if (!words.length) return 0;
  const haystack = known.map((label) => normalize(label)).filter(Boolean);
  if (!haystack.length) return 1;
  const novel = words.filter(
    (word) => !haystack.some((label) => label.includes(word) || word.includes(label)),
  );
  return novel.length / words.length;
}

export function localBeatDecision(input: LocalBeatInput): LocalBeatDecision {
  const pending = input.pendingText.trim();
  if (!pending) return { verdict: "skip", reason: "nothing pending" };

  const words = contentWords(pending);

  // Not enough material for any diagram. This is the safest skip there is:
  // the Beat's own caller already refuses to fire below MIN_WORDS, so this
  // agrees with existing behaviour rather than introducing new judgement.
  if (words.length < MIN_CONTENT_WORDS) {
    return { verdict: "skip", reason: `only ${words.length} content words` };
  }

  // A sentence still in flight. Not a skip — the words are real and will
  // finish. Hand it to the model, which can read intent from a fragment far
  // better than this can.
  if (isObviouslyIncomplete(pending) || !isThoughtComplete(pending)) {
    return { verdict: "uncertain", reason: "thought still in flight" };
  }

  const known = [...input.existingConcepts, ...input.looseWords];
  const novel = novelRatio(words, known);

  // Everything here is already on the board. This is the case the Beat spends
  // a second saying "restatement" about.
  if (novel === 0) {
    return { verdict: "skip", reason: "every concept already on the board" };
  }

  // A long skip streak means the model has repeatedly judged this material not
  // worth drawing. Agreeing locally would compound its error and could bury a
  // topic change, so defer.
  if (input.skipStreak >= 3) {
    return { verdict: "uncertain", reason: `deferring after ${input.skipStreak} skips` };
  }

  // A complete sentence, mostly new, asserting a relation between things. This
  // is the shape the Artist draws well.
  if (novel >= 0.5 && hasRelationCue(pending)) {
    return { verdict: "draw", reason: "complete thought, new content, relation stated" };
  }

  // Substantially new complete content, but no explicit structure. The model
  // is much better than this at deciding whether that is a diagram or just
  // narration.
  return {
    verdict: "uncertain",
    reason: novel >= 0.5 ? "new content, no explicit relation" : "mostly restatement",
  };
}

export interface BeatAgreement {
  local: LocalBeatVerdict;
  model: string;
  agreement: boolean;
  /** A local skip the model would have drawn. The dangerous quadrant. */
  falseSkip: boolean;
  /** A local draw the model would have skipped. Wasteful, not destructive. */
  falseDraw: boolean;
  reason: string;
}

/**
 * Score one shadow-mode pair.
 *
 * `uncertain` is never counted as agreement or disagreement — it is an
 * explicit deferral, and folding it into either bucket would make the
 * agreement rate meaningless. Only decisive local verdicts are scored.
 */
export function scoreBeatAgreement(
  local: LocalBeatDecision,
  modelAction: string,
): BeatAgreement {
  const modelWouldDraw = modelAction !== "skip";
  const decisive = local.verdict !== "uncertain";
  const localWouldDraw = local.verdict === "draw";
  return {
    local: local.verdict,
    model: modelAction,
    agreement: decisive ? localWouldDraw === modelWouldDraw : true,
    falseSkip: local.verdict === "skip" && modelWouldDraw,
    falseDraw: local.verdict === "draw" && !modelWouldDraw,
    reason: local.reason,
  };
}
