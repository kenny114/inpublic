/**
 * When to turn the page, and why.
 *
 * The old rule was "turn when the sheet is full", where full meant either the
 * pen ran off the bottom or twenty-two marks had landed. Measured against a
 * real session, 11 of 18 turns happened while the speaker was mid-sentence:
 * the mark cap is hit by the Scribe, which fires on a *fragment*, so the sheet
 * flipped in the middle of a thought and the speaker's next words appeared on
 * a different page from the words they belonged to.
 *
 * The fix is not to turn less. It is to separate the two triggers:
 *
 *   - **Hard overflow** — the next block genuinely does not fit. Turning is
 *     the only option; not turning means drawing off the sheet.
 *   - **Soft capacity** — the sheet is at its readable limit but the block in
 *     hand still fits. This can wait for the end of the thought, and now does.
 *
 * Everything here is pure so it can be tested without a canvas.
 */

export type PageTurnReason =
  /** The block in hand does not fit on the sheet. Unavoidable. */
  | "overflow"
  /** The sheet reached its readable mark limit. Deferrable. */
  | "sheet-full"
  /** A thought or section finished and the sheet was nearly done. */
  | "completed-section"
  /** The speaker announced a new topic. */
  | "topic-change"
  /** "clear the board" — the speaker asked for a fresh sheet. */
  | "explicit-clear"
  /** Switching into Story Mode intentionally reserves one clean scene page. */
  | "story-mode"
  /** Returning to Standard Mode starts a deliberate explanation sheet. */
  | "standard-mode"
  /** A single utterance is longer than one sheet. */
  | "long-utterance";

export interface PageTurnDecision {
  turn: boolean;
  reason: PageTurnReason;
  /** True when a soft trigger was held back because a thought was in flight. */
  deferred: boolean;
  /** One clause, for the log. */
  why: string;
}

/**
 * Words that leave a sentence hanging. A page must not turn on one of these:
 * whatever comes next belongs with what came before.
 */
const DANGLING = new Set(
  `a an the and or but so if of to in on at for with from by as that which who
   is are was were be been being am will would can could shall should may might
   must do does did have has had into over under between through before after
   during while when where than then because although unless until about`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * Pronouns count as dangling too — but only here, and only because this check
 * is reached solely when the utterance carries NO terminal punctuation.
 * "people like me." ends the thought and never gets this far. "AI agents, when
 * they" does, and it is plainly still in flight.
 */
const TRAILING_PRONOUN = new Set(
  "i we they he she it you them us this these those there".split(" "),
);

/**
 * Has the speaker finished a thought?
 *
 * Not "is this a grammatical sentence" — live speech rarely is. The question
 * is only whether cutting here would strand a fragment on the previous sheet.
 */
export function isThoughtComplete(text: string): boolean {
  const clean = text.trim();
  if (!clean) return true; // nothing in flight
  if (/[.!?]["')\]]?$/.test(clean)) return true;
  const words = clean.toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const last = words[words.length - 1];
  if (DANGLING.has(last) || TRAILING_PRONOUN.has(last)) return false;
  // A comma is a breath, not an ending.
  if (/,$/.test(clean)) return false;
  // Short trailing runs are usually a restart in progress.
  return words.length >= 3;
}

export interface PageTurnInput {
  /** What asked for the turn. */
  trigger:
    | "overflow"
    | "capacity"
    | "section"
    | "clear"
    | "long-utterance";
  /** Marks placed on the current sheet. */
  marks: number;
  /** The readable limit for one sheet. */
  maxMarks: number;
  /** Text of the utterance in progress; empty when nothing is being spoken. */
  liveText: string;
  /**
   * How long a soft turn has already been held back, in ms. A deferral that
   * never resolves is just a broken page system, so it expires.
   */
  deferredForMs: number;
}

/**
 * The first-minute composition hold may delay aesthetic/semantic turns,
 * never a hard containment turn.
 */
export function suppressPageTurnDuringInitialComposition(
  trigger: PageTurnInput["trigger"],
  withinInitialWindow: boolean,
): boolean {
  return withinInitialWindow &&
    (trigger === "capacity" || trigger === "section" || trigger === "long-utterance");
}

/** How long a soft page turn may wait for the speaker to finish a thought. */
export const MAX_DEFER_MS = 6000;
/**
 * Once the sheet is this far past its limit, turn regardless — an extra mark
 * or two beyond the readable limit is fine, a dozen is not.
 */
export const CAPACITY_GRACE = 4;

export function decidePageTurn(input: PageTurnInput): PageTurnDecision {
  const { trigger, marks, maxMarks, liveText, deferredForMs } = input;

  // Hard triggers. Nothing waits for these.
  if (trigger === "overflow") {
    return {
      turn: true,
      reason: "overflow",
      deferred: false,
      why: "block does not fit on the sheet",
    };
  }
  if (trigger === "long-utterance") {
    return {
      turn: true,
      reason: "long-utterance",
      deferred: false,
      why: "utterance is longer than one sheet",
    };
  }
  if (trigger === "clear") {
    return {
      turn: true,
      reason: "explicit-clear",
      deferred: false,
      why: "speaker asked for a fresh sheet",
    };
  }
  if (trigger === "section") {
    return {
      turn: true,
      reason: "topic-change",
      deferred: false,
      why: "speaker moved to a new topic",
    };
  }

  // Soft capacity. This is the one that used to cut thoughts in half.
  const complete = isThoughtComplete(liveText);
  const overdue = deferredForMs >= MAX_DEFER_MS;
  const wayOver = marks >= maxMarks + CAPACITY_GRACE;

  if (complete) {
    return {
      turn: true,
      reason: marks >= maxMarks ? "sheet-full" : "completed-section",
      deferred: false,
      why: `sheet at ${marks}/${maxMarks} marks and the thought finished`,
    };
  }
  if (wayOver || overdue) {
    return {
      turn: true,
      reason: "sheet-full",
      deferred: false,
      why: wayOver
        ? `sheet at ${marks}/${maxMarks} marks, past the grace of ${CAPACITY_GRACE}`
        : `held ${Math.round(deferredForMs)}ms for an unfinished thought, turning anyway`,
    };
  }

  return {
    turn: false,
    reason: "sheet-full",
    deferred: true,
    why: "thought unfinished; holding the page",
  };
}
