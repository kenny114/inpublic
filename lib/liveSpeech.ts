import { isThoughtComplete } from "./pagination";

export type LocalVoiceCommand = "undo" | "new-page";

/** Closed, deterministic command lane. Narration never reaches this matcher. */
export function localVoiceCommand(text: string): LocalVoiceCommand | null {
  const clean = text.trim().toLowerCase().replace(/[.!?]+$/g, "").trim();
  if (clean === "scratch that" || clean === "remove that" || clean === "undo") {
    return "undo";
  }
  if (clean === "new page" || clean === "new scene") return "new-page";
  return null;
}

/**
 * The same command lane, fired from settled interim words instead of a final.
 *
 * Waiting for the final costs 150–600ms of endpointing on every command, which
 * is the difference between the board reacting with you and reacting after
 * you. Because the matcher is a closed set of exact phrases, running it early
 * is safe in a way that no open-ended interpretation would be.
 *
 * Two guards make it safe, and both are load-bearing:
 *
 * 1. **The whole settled utterance must be the command, exactly.** Not a
 *    prefix, not a substring. "scratch" is not "scratch that"; "scratch that
 *    idea" is a sentence about an idea and must not erase anything. This is
 *    why the check delegates to `localVoiceCommand` on the full string rather
 *    than testing for a leading match.
 * 2. **The words must be settled** — agreed by two consecutive interims —
 *    which is the caller's job and is what stops a half-heard "under…" from
 *    ever reaching this function as "undo".
 *
 * The asymmetry of the risk is the whole argument. Firing a command 300ms
 * early is a small win; firing one that was never spoken destroys work the
 * speaker cannot see was destroyed. So the bar is exact equality, and anything
 * ambiguous simply waits for the final, which is the behaviour we had anyway.
 */
export function earlyVoiceCommand(settledText: string): LocalVoiceCommand | null {
  const clean = settledText.trim();
  if (!clean) return null;
  // A trailing comma means the speaker is still going — "undo, and then…".
  if (/[,;:]$/.test(clean)) return null;
  return localVoiceCommand(clean);
}

const INCOMPLETE_ENDINGS = new Set([
  "toward", "towards", "from", "to", "because", "with", "and", "but",
  "if", "when", "that", "need", "needs",
]);

export interface StructuralThoughtState {
  text: string;
  rawSegments: string[];
  heldSince: number;
}

export interface StructuralThoughtResult {
  state: StructuralThoughtState;
  thought: string | null;
  held: boolean;
}

export const EMPTY_THOUGHT: StructuralThoughtState = {
  text: "",
  rawSegments: [],
  heldSince: 0,
};

export const STRUCTURAL_HOLD_MS = 1600;

export function isObviouslyIncomplete(text: string): boolean {
  const clean = text.trim();
  if (!clean) return false;
  if (/[,;:]$/.test(clean)) return true;
  const words = clean.toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").split(/\s+/).filter(Boolean);
  return words.length > 0 && INCOMPLETE_ENDINGS.has(words[words.length - 1]);
}

/**
 * Adds one exact provider segment and emits only a coherent structural thought.
 * Rendering remains immediate; this helper is for the semantic lane only.
 */
export function pushStructuralSegment(
  prior: StructuralThoughtState,
  rawSegment: string,
  at: number,
): StructuralThoughtResult {
  const segment = rawSegment.trim();
  if (!segment) return { state: prior, thought: null, held: Boolean(prior.text) };
  const text = `${prior.text} ${segment}`.trim();
  const state = {
    text,
    rawSegments: [...prior.rawSegments, rawSegment],
    heldSince: prior.heldSince || at,
  };
  if (isObviouslyIncomplete(text) || !isThoughtComplete(text)) {
    return { state, thought: null, held: true };
  }
  return { state: EMPTY_THOUGHT, thought: text, held: false };
}

/**
 * What is left of the pending buffer once a beat has consumed part of it.
 *
 * The beat is asked about a snapshot of the buffer, then the model call and
 * the Artist call together take the best part of eight seconds. People do not
 * stop talking for eight seconds, so by the time the drawing lands the buffer
 * usually holds a NEWER sentence than the one that was just drawn. Retiring
 * the whole buffer therefore threw away the next thought — reliably the last
 * one in an explanation, because nothing came after it to trigger another
 * beat. Only the consumed prefix is retired.
 *
 * If the buffer no longer starts with what was sent (the word cap dropped the
 * front of it, or a command reset it mid-flight), there is no safe way to say
 * what is left over, so it retires entirely — the old behaviour.
 */
export function retirePending(buffer: string, consumed: string): string {
  const remaining = buffer.trim();
  const used = consumed.trim();
  if (!used) return remaining;
  return remaining.startsWith(used) ? remaining.slice(used.length).trim() : "";
}

export function flushStructuralThought(state: StructuralThoughtState): StructuralThoughtResult {
  return {
    state: EMPTY_THOUGHT,
    thought: state.text.trim() || null,
    held: false,
  };
}

