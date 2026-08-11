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

