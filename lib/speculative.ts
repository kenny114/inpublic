/**
 * Standard Mode's speculative visual layer — tier 2.
 *
 * Tier 1 (writeLive) letters your words in 1–6ms. Tier 3 (Scribe, Beat,
 * Artist) makes them into structure in 1–5 seconds. Between those sits a gap
 * where the board knows a great deal and does nothing with it, and this module
 * is what fills it: a local, deterministic, immediately-reversible reaction to
 * speech that is still being spoken.
 *
 * ## What makes this safe
 *
 * Everything here is a guess, and it says so — the caller renders these at
 * reduced opacity and can retract any of them for free. Three rules keep the
 * guesses cheap:
 *
 * 1. **Settled words only.** The caller feeds this the prefix that two
 *    consecutive interims agreed on, never the raw live transcript. Deepgram
 *    revises its tail constantly; drawing that tail is how you get flicker.
 * 2. **Deterministic recognisers only.** No model, no network. If a rule below
 *    cannot be certain from the words alone, it emits nothing.
 * 3. **Emit once.** A key that has been emitted, or that is already on the
 *    board, never produces a second event. This is what stops a speaker
 *    circling a topic from stacking six copies of it.
 *
 * ## What it does NOT do
 *
 * No artistic interpretation, no layout decisions, no relationships more
 * complex than a single explicit arrow. Those belong to the Artist, which is
 * far better at them and is already running. This tier exists to make the
 * board *move* while that happens.
 */

import { detectGesture, extractConcepts } from "./sketch";

export type SpeculativeKind = "title" | "concept" | "count" | "trend" | "contrast" | "cause";

export interface SpeculativeEvent {
  kind: SpeculativeKind;
  /** Stable identity, so the same guess is never drawn twice. */
  key: string;
  /** What to letter. */
  text: string;
  /** The settled speech this came from, for grounding and reconciliation. */
  source: string;
  /**
   * A `"concept"` the emphasis recognizer flagged as stressed ("the MOST
   * important thing is X"). Deliberately not a distinct kind — see Part 7's
   * scoping note near EMPHASIS_RE below — so the renderer can give it a
   * slightly less-faint treatment without inventing a new visual.
   */
  emphasis?: boolean;
}

export interface SpeculativeState {
  /**
   * Keys that are DONE — either actually drawn, or permanently and
   * deliberately never going to be (superseded already, failed to build, or
   * retried past `MAX_DEFERRED_ATTEMPTS`). Never re-proposed.
   */
  emitted: Set<string>;
  /**
   * Keys that have been proposed but not yet confirmed drawn — blocked by
   * pointer lock, `sketchBusyRef`, or the outstanding-guess cap when the
   * caller last tried. Kept here (not `emitted`) specifically so a concept
   * that was only ever *temporarily* undrawable gets proposed again on the
   * next settled-interim tick rather than being lost. See
   * `applySpeculativeOutcome`, which is what moves a key out of this map.
   */
  deferred: Map<string, SpeculativeEvent>;
  /** Retry count per deferred key, so a permanently-blocked guess (e.g. the
   *  user drawing for 30s) eventually gives up instead of retrying forever. */
  deferredAttempts: Map<string, number>;
  /** Concept-extraction memory, shared across calls so phrases don't repeat. */
  seen: Set<string>;
  /** Gestures already performed (greeting, title). */
  gestures: Set<string>;
}

/** How many times a blocked guess retries before being dropped for good. */
export const MAX_DEFERRED_ATTEMPTS = 5;

export function emptySpeculativeState(): SpeculativeState {
  return {
    emitted: new Set(),
    deferred: new Map(),
    deferredAttempts: new Map(),
    seen: new Set(),
    gestures: new Set(),
  };
}

/** What happened when the caller actually tried to draw a proposed event. */
export type SpeculativeOutcome = "rendered" | "blocked" | "dropped";

/**
 * Fold the caller's render attempt back into state.
 *
 * This is the other half of the fix for the "lost speculative event" hazard:
 * `recognizeSpeculative` no longer commits a key to `emitted` just because it
 * proposed it — only this function does, and only once the caller reports
 * what actually happened.
 *
 * - `"rendered"` — drawn. Done, never proposed again.
 * - `"dropped"` — permanently undrawable (already superseded by a real mark,
 *   or failed to build). Also done, never proposed again — retrying a build
 *   failure would just fail again.
 * - `"blocked"` — temporarily undrawable (pointer lock, busy sketch, cap).
 *   Stays deferred and will be retried on the next tick, up to
 *   `MAX_DEFERRED_ATTEMPTS`, after which it is given up on (moved to
 *   `emitted`) rather than retried forever.
 */
export function applySpeculativeOutcome(
  state: SpeculativeState,
  outcomes: Map<string, SpeculativeOutcome>,
): SpeculativeState {
  if (!outcomes.size) return state;
  const emitted = new Set(state.emitted);
  const deferred = new Map(state.deferred);
  const deferredAttempts = new Map(state.deferredAttempts);
  for (const [key, outcome] of outcomes) {
    if (outcome === "rendered" || outcome === "dropped") {
      deferred.delete(key);
      deferredAttempts.delete(key);
      emitted.add(key);
      continue;
    }
    const attempts = (deferredAttempts.get(key) ?? 0) + 1;
    if (attempts >= MAX_DEFERRED_ATTEMPTS) {
      deferred.delete(key);
      deferredAttempts.delete(key);
      emitted.add(key);
    } else {
      deferredAttempts.set(key, attempts);
    }
  }
  return { ...state, emitted, deferred, deferredAttempts };
}

export interface SpeculativeInput {
  /** Words newly settled since the last call. */
  settledText: string;
  /** Everything settled in this utterance so far, for phrase-level rules. */
  utteranceText: string;
  /** Deepgram's confidence for the interim these words came from, 0..1. */
  confidence: number;
  /** Marks and concepts already on the board; nothing here is re-emitted. */
  onBoard: string[];
}

/**
 * Confidence floor.
 *
 * Deliberately not the only gate, and deliberately not high. Settled-word
 * agreement across two interims is the stronger signal — it is what proves
 * Deepgram has stopped revising — and confidence alone is a poor predictor of
 * whether a word is *drawable*. This exists to drop the genuinely mangled
 * results, not to be the primary filter.
 */
export const MIN_SPECULATIVE_CONFIDENCE = 0.6;

/** Below this a phrase is too thin to be worth a mark of its own. */
const MIN_CONCEPT_LENGTH = 4;

const NUMBER_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
};

/**
 * "There are three reasons", "we have four options", "two problems here".
 * A count is one of the few things speech states unambiguously, and a bare
 * "3 REASONS" heading is almost always right when the phrasing matches.
 */
const COUNT_RE =
  /\b(?:there\s+(?:are|were)|we\s+have|i\s+have|that'?s|here\s+are)\s+(two|three|four|five|six|seven)\s+([a-z]{3,20}s)\b/i;

/**
 * "Revenue increased", "churn went up", "costs are falling".
 * Direction is the whole content of these sentences and it renders as one
 * glyph, so getting it wrong is both unlikely and trivially undone.
 */
const TREND_RE =
  /\b([a-z][a-z\s]{2,24}?)\s+(?:has\s+|have\s+|is\s+|are\s+|was\s+|were\s+)?(increased|increases|rose|grew|went\s+up|is\s+up|jumped|climbed|doubled|decreased|decreases|fell|dropped|went\s+down|is\s+down|declined|shrank|halved)\b/i;

const UP = /increase|rose|grew|up|jump|climb|double/i;

/**
 * "The MOST important thing is distribution", "the biggest problem is churn".
 * Deliberately narrow — a fixed short list of stress words plus an optional
 * "thing is/about" bridge, not a general emphasis detector — because a wrong
 * bold mark on the wrong phrase is more visible than a missed one.
 */
const EMPHASIS_RE =
  /\b(?:the\s+)?(?:most\s+important|biggest|critical|crucial|key)\s+(?:thing\s+(?:is|about)\s+)?(?:is\s+)?([a-z][a-z']{2,24}(?:\s+[a-z][a-z']{2,24}){0,2})\b/i;

/**
 * "But…", "however…", "on the other hand…" — matched against the freshly
 * SETTLED chunk only (not the whole utterance), and only when it's the start
 * of that chunk. A settled chunk beginning with a contrast marker is a real
 * clause boundary; the same word mid-sentence ("not now but later") is not,
 * which is why this isn't a bare word-boundary match against the utterance.
 */
const CONTRAST_RE = /^(?:but|however|on\s+the\s+other\s+hand)\b/i;

/**
 * Explicit causal language only. Both a subject and object phrase must be
 * captured, and — per Part 7 of the brief — the renderer additionally
 * requires BOTH to already be on the board before drawing anything, so this
 * never introduces content the speaker hasn't already established.
 */
const CAUSE_FORWARD_RE =
  /\b([a-z][a-z\s]{2,30}?)\s+(?:causes?|leads?\s+to|results?\s+in)\s+([a-z][a-z\s]{2,30})\b/i;
/** "Distribution problems happen because of low retention." — reversed order. */
const CAUSE_BECAUSE_RE =
  /\b([a-z][a-z\s]{2,30})\s+(?:happen(?:s|ed)?\s+)?because(?:\s+of)?\s+([a-z][a-z\s]{2,30})\b/i;

function normalizeKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function titleCase(phrase: string): string {
  return phrase
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Already lettered, in either direction — see scribeScheduler for why both. */
function onBoardAlready(key: string, onBoard: string[]): boolean {
  if (!key) return true;
  return onBoard
    .map(normalizeKey)
    .filter(Boolean)
    .some((label) => label.includes(key) || key.includes(label));
}

/**
 * The inverse check `cause` needs: is this concept already established on the
 * board? (`onBoardAlready` returns `true` for an empty key, which is right
 * for "don't re-propose this" but wrong for "is this a real, known concept".)
 */
function foundOnBoard(key: string, onBoard: string[]): boolean {
  if (!key) return false;
  return onBoard
    .map(normalizeKey)
    .filter(Boolean)
    .some((label) => label.includes(key) || key.includes(label));
}

const RELATION_STOPWORDS = /^(?:and|but|so|the|our|their|it|that|this|a|an)\s+/i;

/**
 * Recognise what can be drawn right now from settled speech.
 *
 * Returns a NEW state plus the events to render. Ordered by how confident the
 * rule is: a stated count or trend is near-certain, a title is likely, a bare
 * concept is a guess. The caller may render all of them — they are all
 * retractable — but the ordering matters if it ever wants to render fewer.
 */
export function recognizeSpeculative(
  state: SpeculativeState,
  input: SpeculativeInput,
): { state: SpeculativeState; events: SpeculativeEvent[] } {
  const emitted = new Set(state.emitted);
  const deferred = new Map(state.deferred);
  const deferredAttempts = new Map(state.deferredAttempts);
  const seen = new Set(state.seen);
  const gestures = new Set(state.gestures);

  // Anything still waiting from a previous tick is retried unconditionally —
  // it already passed the checks below once; only whether it could be DRAWN
  // was ever in question, and that is the caller's concern
  // (applySpeculativeOutcome), not this function's. This is the fix for the
  // "lost speculative event" hazard: a concept that was merely blocked (a
  // pointer lock, a busy sketch, a full cap) must keep being offered rather
  // than silently becoming permanently ineligible.
  const events: SpeculativeEvent[] = [...deferred.values()];

  const settled = input.settledText.trim();
  const gated = input.confidence > 0 && input.confidence < MIN_SPECULATIVE_CONFIDENCE;

  if (settled && !gated) {
    const consider = (kind: SpeculativeKind, rawKey: string, text: string, emphasis = false) => {
      const key = `${kind}:${normalizeKey(rawKey)}`;
      if (emitted.has(key) || deferred.has(key)) return;
      if (onBoardAlready(normalizeKey(rawKey), input.onBoard)) return;
      const event: SpeculativeEvent = { kind, key, text, source: settled, ...(emphasis ? { emphasis: true } : {}) };
      deferred.set(key, event);
      events.push(event);
    };

    // Relationship-kind events (contrast/cause) aren't "already lettered
    // concepts" in the onBoardAlready sense — a "but" marker or a cause
    // arrow between two things that already exist isn't itself a concept
    // that could collide with one — so this skips that check but keeps the
    // same emitted/deferred dedup everything else uses.
    const considerRelation = (kind: SpeculativeKind, rawKey: string, text: string) => {
      const key = `${kind}:${normalizeKey(rawKey)}`;
      if (emitted.has(key) || deferred.has(key)) return;
      const event: SpeculativeEvent = { kind, key, text, source: settled };
      deferred.set(key, event);
      events.push(event);
    };

    // Phrase-level rules read the whole utterance, because "there are three
    // reasons" arrives across several settled chunks and would never match a
    // single one of them.
    const utterance = input.utteranceText.trim() || settled;

    const count = utterance.match(COUNT_RE);
    if (count) {
      const n = NUMBER_WORDS[count[1].toLowerCase()];
      if (n) consider("count", `${n} ${count[2]}`, `${n} ${count[2].toUpperCase()}`);
    }

    const trend = utterance.match(TREND_RE);
    if (trend) {
      const subject = trend[1].trim().replace(/^(?:and|but|so|the|our|their)\s+/i, "");
      if (subject.length >= 3) {
        const arrow = UP.test(trend[2]) ? "↑" : "↓";
        consider("trend", `${subject} ${arrow}`, `${titleCase(subject)} ${arrow}`);
      }
    }

    // "The MOST important thing is X" — same "concept" kind as a bare noun
    // phrase, just flagged. See the SpeculativeEvent.emphasis doc.
    const emphasis = utterance.match(EMPHASIS_RE);
    if (emphasis) {
      const subject = emphasis[1].trim().replace(RELATION_STOPWORDS, "");
      if (subject.length >= 3) consider("concept", subject, titleCase(subject), true);
    }

    // A contrast marker at the start of the freshly-settled chunk — a real
    // clause boundary, not a mid-sentence "but". Not gated on onBoard state:
    // "something is about to contrast" is true regardless of what's drawn.
    if (CONTRAST_RE.test(settled)) {
      considerRelation("contrast", `contrast ${normalizeKey(settled)}`, "⟷");
    }

    // Cause: both ends must already be known concepts on the board — this is
    // an annotation on established content, never a way to introduce a new
    // one. See CAUSE_FORWARD_RE/CAUSE_BECAUSE_RE docs above.
    const causeForward = utterance.match(CAUSE_FORWARD_RE);
    const causeBecause = !causeForward ? utterance.match(CAUSE_BECAUSE_RE) : null;
    const causePair = causeForward
      ? { from: causeForward[1], to: causeForward[2] }
      : causeBecause
        ? { from: causeBecause[2], to: causeBecause[1] } // "X because Y" => Y causes X
        : null;
    if (causePair) {
      // The BECAUSE pattern's leading phrase is captured greedily (so it
      // isn't cut short at the first word boundary, the same bug the FORWARD
      // pattern had) but that means it can swallow the optional
      // "happen(s/ed)" bridge word when that word is what let the rest of
      // the pattern match at all — strip it back off.
      const trailingHappen = /\s+happen(?:s|ed)?$/i;
      const from = causePair.from.trim().replace(RELATION_STOPWORDS, "").replace(trailingHappen, "");
      const to = causePair.to.trim().replace(RELATION_STOPWORDS, "").replace(trailingHappen, "");
      const fromKey = normalizeKey(from);
      const toKey = normalizeKey(to);
      if (
        from.length >= 3 &&
        to.length >= 3 &&
        fromKey !== toKey &&
        foundOnBoard(fromKey, input.onBoard) &&
        foundOnBoard(toKey, input.onBoard)
      ) {
        considerRelation("cause", `${fromKey} -> ${toKey}`, `${titleCase(from)} → ${titleCase(to)}`);
      }
    }

    // A title is a once-per-session gesture and lib/sketch.ts already owns the
    // patterns for it.
    const gesture = detectGesture(utterance, gestures);
    if (gesture && gesture.kind === "title") {
      gestures.add("title");
      consider("title", gesture.text, gesture.text);
    }

    // Bare concepts last, and only from the newly settled words — running the
    // extractor over the whole utterance every time would re-propose phrases
    // that were considered and rejected on the previous call.
    //
    // `isInterim: true` holds back the trailing run: mid-utterance the last
    // phrase is still being spoken, and emitting it early turns "beat
    // detector" into a lone "Beat" that then blocks the real phrase as a
    // duplicate.
    for (const phrase of extractConcepts(settled, seen, true)) {
      if (phrase.length < MIN_CONCEPT_LENGTH) continue;
      consider("concept", phrase, phrase);
    }
  }

  return { state: { emitted, deferred, deferredAttempts, seen, gestures }, events };
}

/**
 * Does a real mark from the Scribe or the Artist supersede this guess?
 *
 * Matched on normalised text in both directions, so the Scribe lettering
 * "AI Agents" retires a speculative "agents" rather than sitting next to it.
 * This is the function that prevents duplicates, which is the single most
 * visible way a speculative layer can fail.
 */
export function supersedes(realText: string, speculativeText: string): boolean {
  const real = normalizeKey(realText);
  const spec = normalizeKey(speculativeText);
  if (!real || !spec) return false;
  return real === spec || real.includes(spec) || spec.includes(real);
}

/**
 * Is this guess still supported by what was finally transcribed?
 *
 * Called with the final transcript for the utterance. A guess whose words
 * survived into the final is confirmed; one whose words were revised away was
 * a mishearing and must be retracted. This is the cheap-to-be-wrong promise
 * being kept.
 */
export function confirmedByFinal(source: string, finalText: string): boolean {
  const spoken = normalizeKey(finalText);
  const guessed = normalizeKey(source);
  if (!guessed) return false;
  // Every content word of the guess has to appear in the final. Substring on
  // the whole string would let a reordered sentence pass.
  return guessed.split(" ").every((word) => word.length < 3 || spoken.includes(word));
}
