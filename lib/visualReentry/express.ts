/**
 * Local visual expression for settled thoughts that did not earn a family.
 *
 * No model. If a thought can be said as a short note or a two-mark relation
 * from words that were actually spoken, it folds into the sketchnote. If not,
 * the sentence stays. Same fail-closed posture as Visual Re-entry.
 */

import { compressLabel, displayLabel } from "./compress";
import type { NoteIntent, RelationIntent, VisualReentrySpec } from "./types";

const NOTE_MAX_WORDS = 6;
const THIN = /^(?:ok|okay|yes|yeah|yep|no|nope|simple|right|sure|well|so|and|but)$/i;

const SPEECH_FRAME = new RegExp(
  "^(?:" +
    "(?:so|and|but|well|anyway),?\\s+" +
    "|(?:i(?:'m|\\s+am)?|we(?:'re|\\s+are)?)\\s+(?:just\\s+)?(?:think(?:ing)?|mean|guess|feel)\\s+(?:that\\s+)?" +
    "|(?:the\\s+(?:basic\\s+)?idea\\s+is(?:\\s+that)?|this\\s+is|that(?:'s|\\s+is)|it(?:'s|\\s+is))\\s+" +
    ")?",
  "i",
);

export interface ExpressResult {
  spec: VisualReentrySpec | null;
  reason: string;
}

function clean(text: string): string {
  return text.trim().replace(/^[\s,;:.-]+|[\s,;:.!?-]+$/g, "");
}

function firstClause(text: string): string {
  return clean(text.split(/[.!?]/, 1)[0] ?? text);
}

function clauses(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(clean)
    .filter((part) => part.length >= 4);
}

function skipClause(text: string): boolean {
  if (/^(?:i|we)\s+want\b/i.test(text) && !/(?:don['’]t|do\s+not)\s+want/i.test(text)) return true;
  if (/^(?:that(?:'s|\s+is)|this\s+is\s+something|how\s+the|what\s+happens)\b/i.test(text)) return true;
  if (/^(?:and\s+)?begins\b/i.test(text)) return true;
  if (/\bspeaking normally\b/i.test(text)) return true;
  return false;
}

function notPhrase(body: string): string | null {
  const compressed = compressLabel(body, NOTE_MAX_WORDS);
  if (!compressed || THIN.test(compressed)) return null;
  if (/^not\b/i.test(compressed)) return compressed;
  return displayLabel(`Not ${compressed[0].toLowerCase()}${compressed.slice(1)}`);
}

function note(text: string, source: string, emphasis = false): NoteIntent | null {
  const compressed = compressLabel(text, NOTE_MAX_WORDS);
  if (!compressed || THIN.test(compressed) || compressed.split(/\s+/).length < 1) return null;
  if (compressed.length < 4) return null;
  return { type: "note", text: compressed, emphasis: emphasis || undefined, evidence: [source] };
}

function payloadHead(text: string): string {
  return firstClause(text).split(/\b(?:what|that|which|who|whom|behind|because|while)\b/i)[0] ?? text;
}

function insteadOf(text: string): RelationIntent | null {
  const match =
    /instead\s+of\s+(.+?)[,;]\s*(.+)$/i.exec(text) ||
    /^(.+?)\s+instead\s+of\s+(.+)$/i.exec(text);
  if (!match) return null;
  const from = compressLabel(payloadHead(match[1]), NOTE_MAX_WORDS);
  const to = compressLabel(payloadHead(match[2]), NOTE_MAX_WORDS);
  if (!from || !to || from.toLowerCase() === to.toLowerCase()) return null;
  return { type: "relation", from, to, label: "instead", evidence: [text] };
}

function notClaim(text: string): NoteIntent | null {
  const isnt = /(?:isn['’]t|is\s+not|aren['’]t|are\s+not)\s+(?:just\s+)?(.+)$/i.exec(firstClause(text));
  if (isnt) {
    const phrase = notPhrase(isnt[1]);
    if (phrase) return { type: "note", text: phrase, emphasis: true, evidence: [text] };
  }
  const dontWant = /(?:don['’]t|do\s+not)\s+want\s+(?:just\s+)?(.+)$/i.exec(firstClause(text));
  if (dontWant) {
    const phrase = notPhrase(dontWant[1]);
    if (phrase) return { type: "note", text: phrase, emphasis: true, evidence: [text] };
  }
  return null;
}

/**
 * Turn a settled thought into a sketchnote mark. Returns null when the
 * sentence should stay as handwriting.
 */
export function expressThought(text: string): ExpressResult {
  const spoken = text.trim();
  if (!spoken) return { spec: null, reason: "empty thought" };
  if (/\?$/.test(spoken)) return { spec: null, reason: "questions stay as speech" };

  const relation = insteadOf(spoken);
  if (relation) return { spec: relation, reason: "instead-of contrast" };

  for (const clause of clauses(spoken)) {
    const negated = notClaim(clause);
    if (negated) return { spec: negated, reason: "negated or wanted claim" };
  }

  for (const clause of clauses(spoken)) {
    if (skipClause(clause)) continue;
    const stripped = clean(clause.replace(SPEECH_FRAME, "")) || clause;
    if (stripped.length < 8) continue;
    const emphasis = /\b(?:hardest|important|key|actually|interesting)\b/i.test(clause);
    const made = note(stripped, spoken, emphasis);
    if (!made) continue;
    const words = made.text.split(/\s+/);
    if (words.length === 1 && (/ing$/i.test(made.text) || made.text.length < 7)) continue;
    if (/\bbecomes\b/i.test(made.text) && /\bcan\b/i.test(made.text)) continue;
    return { spec: made, reason: "lettered note" };
  }

  return { spec: null, reason: "could not letter a short grounded phrase" };
}
