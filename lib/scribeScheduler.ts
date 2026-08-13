/**
 * When the Scribe is worth waking.
 *
 * The old rule was a stopwatch and nothing else: one call per
 * SCRIBE_INTERVAL_MS, whatever had accumulated. That interval was raised from
 * 700ms to 5250ms to stay under a server limit of 12 calls/minute, and the
 * cost was paid entirely in responsiveness — the board went quiet for up to
 * five seconds after every sentence.
 *
 * Lowering the interval alone would just trade responsiveness for spend. The
 * fix is to make the scheduler *event-aware*, so a shorter interval does not
 * mean proportionally more calls: most wake-ups are refused because there is
 * nothing new to draw, and the ones that survive are the ones that would have
 * produced a mark anyway.
 *
 *     settled speech
 *          ↓
 *     meaningful new information?   ← this file
 *          ↓ yes
 *     cooldown available?           ← lib/requestScheduling.ts
 *          ↓ yes
 *     run Scribe
 *
 * Pure and synchronous by design: it never blocks writeLive, and every rule
 * below is directly testable.
 */

/** Why a wake-up was refused. Logged, so a quiet board is explainable. */
export type ScribeSkipReason =
  | "no-fresh-text"
  | "no-new-words"
  | "punctuation-only"
  | "already-on-page"
  | "in-flight"
  | "attention-budget-full";

export interface ScribeWakeInput {
  /** Words settled since the last Scribe call. */
  fresh: string;
  /** What was sent last time, to detect a no-op re-send. */
  lastSent: string;
  /** Marks already lettered on the current page. */
  onPage: string[];
  /** A request is already open; the queue flag handles the follow-up. */
  inFlight: boolean;
  /** The page is already carrying as many temporary marks as it should. */
  attentionBudgetFull: boolean;
}

export interface ScribeWakeDecision {
  wake: boolean;
  reason: ScribeSkipReason | "new-content";
  /** The words that justified waking, normalised. Empty when not waking. */
  payload: string;
}

/**
 * Words that carry no drawable meaning on their own.
 *
 * Intentionally much smaller than lib/sketch.ts's stoplist. That one decides
 * what to *draw*; this one only decides whether a fragment is worth spending a
 * model call on. Being too aggressive here silently drops real content, so it
 * contains only words that cannot be the subject of a mark.
 */
const FILLER = new Set([
  "um", "uh", "er", "ah", "oh", "mm", "hmm", "yeah", "yep", "nope", "okay",
  "ok", "right", "so", "and", "but", "or", "the", "a", "an", "is", "are",
  "was", "were", "be", "to", "of", "in", "on", "it", "that", "this", "you",
  "i", "we", "they", "he", "she", "like", "just", "well", "then", "now",
]);

export function normalizeScribeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Letters and digits only, for comparing meaning rather than punctuation. */
function semanticKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function contentWords(text: string): string[] {
  return semanticKey(text)
    .split(" ")
    .filter((word) => word.length > 1 && !FILLER.has(word));
}

/**
 * True when every content word is already lettered on the page.
 *
 * Substring matching in both directions, because the Scribe writes "AI agents"
 * where the speaker said "agents" and either should count as covered. This is
 * the rule that stops a speaker circling back to the same point from
 * redrawing it every few seconds.
 */
function alreadyRepresented(words: string[], onPage: string[]): boolean {
  if (!words.length) return false;
  const page = onPage.map((label) => semanticKey(label)).filter(Boolean);
  if (!page.length) return false;
  return words.every((word) =>
    page.some((label) => label.includes(word) || word.includes(label)),
  );
}

export function shouldWakeScribe(input: ScribeWakeInput): ScribeWakeDecision {
  const fresh = normalizeScribeText(input.fresh);
  if (!fresh) return { wake: false, reason: "no-fresh-text", payload: "" };

  // An open request already owns this text; runScribe's queue flag will bring
  // us straight back here when it lands.
  if (input.inFlight) return { wake: false, reason: "in-flight", payload: "" };

  // Punctuation and capitalisation churn between interims is not new speech.
  // smart_format revises these constantly, and each revision used to look like
  // fresh material worth a model call.
  const key = semanticKey(fresh);
  if (key && key === semanticKey(input.lastSent)) {
    return { wake: false, reason: "punctuation-only", payload: "" };
  }

  const words = contentWords(fresh);
  if (!words.length) return { wake: false, reason: "no-new-words", payload: "" };

  if (alreadyRepresented(words, input.onPage)) {
    return { wake: false, reason: "already-on-page", payload: "" };
  }

  // Checked last on purpose. A full page is a reason to stop adding marks, but
  // the cheaper refusals above should absorb most wake-ups before we get here,
  // and ordering it last keeps the logged reason the most specific one.
  if (input.attentionBudgetFull) {
    return { wake: false, reason: "attention-budget-full", payload: "" };
  }

  return { wake: true, reason: "new-content", payload: fresh };
}
