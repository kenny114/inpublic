/**
 * Display-label compression for Visual Re-entry.
 *
 * Grounding has already proved every word was said. This step only drops
 * words. A node that cannot be said in five content words is treated as a
 * failed visual — same fail-closed posture as grounding.
 */

import type { VisualReentryIntent, VisualReentrySpec } from "./types";
import { fallbackNone } from "./types";

const MAX_CONTENT_WORDS = 5;

const ARTICLES = new Set(["the", "a", "an", "our", "my", "their", "its", "we", "i"]);

const STOPWORDS = new Set([
  ...ARTICLES,
  "and", "or", "but", "of", "to", "in", "on", "for",
  "with", "is", "are", "was", "were", "it", "that", "this", "as", "at",
  "by", "be", "we", "i", "you", "they", "he", "she", "from",
]);

const FILLERS = new Set([
  "who", "which", "whom", "whose", "something", "like", "really", "just",
  "actually", "basically", "literally", "maybe", "kind", "sort", "does",
  "do", "doing", "did", "after", "before", "when", "while", "because",
]);

export const REASON_LABELS_TOO_LONG = "a label could not be compressed to five content words";

export function displayLabel(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return `${trimmed[0].toUpperCase()}${trimmed.slice(1)}`;
}

function tokenize(text: string): string[] {
  return text
    .trim()
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 || /^\d$/.test(word));
}

function isNoise(word: string): boolean {
  const key = word.toLowerCase();
  return STOPWORDS.has(key) || FILLERS.has(key);
}

function contentCount(words: string[]): number {
  return words.filter((word) => !isNoise(word)).length;
}

/**
 * Short grounded phrase, or null if the source cannot be said in five
 * content words without inventing any.
 */
export function compressLabel(phrase: string, maxContentWords = MAX_CONTENT_WORDS): string | null {
  const raw = phrase.trim().replace(/^[\s,;:.-]+|[\s,;:.!?-]+$/g, "");
  if (!raw) return null;

  const words = tokenize(raw);
  if (words.length === 0) return null;
  if (contentCount(words) === 0) return null;

  if (words.length <= maxContentWords) {
    const withoutArticles = words.filter((word) => !ARTICLES.has(word.toLowerCase()));
    const kept = withoutArticles.length > 0 && withoutArticles.length < words.length ? withoutArticles : words;
    return displayLabel(kept.join(" "));
  }

  const stripped = words.filter((word) => !isNoise(word));
  if (stripped.length === 0 || stripped.length > maxContentWords) return null;
  return displayLabel(stripped.join(" "));
}

function compressOptional(value: string | undefined): { ok: true; value?: string } | { ok: false } {
  if (!value) return { ok: true };
  const compressed = compressLabel(value);
  if (!compressed) return { ok: false };
  return { ok: true, value: compressed };
}

function compressRequired(value: string): string | null {
  return compressLabel(value);
}

export type CompressResult =
  | { ok: true; spec: VisualReentrySpec }
  | { ok: false; reason: string };

/** Compress every display label on a grounded spec. Evidence is left verbatim. */
export function compressSpec(spec: VisualReentrySpec): CompressResult {
  const nodes = spec.nodes.map(compressRequired);
  if (nodes.some((node) => !node)) return { ok: false, reason: REASON_LABELS_TOO_LONG };
  const title = compressOptional(spec.title);
  if (!title.ok) return { ok: false, reason: REASON_LABELS_TOO_LONG };
  return { ok: true, spec: { ...spec, nodes: nodes as string[], title: title.value } };
}

export function compressedOrNone(intent: VisualReentryIntent): VisualReentryIntent {
  if (intent.type === "none") return intent;
  const result = compressSpec(intent);
  if (!result.ok) return fallbackNone(result.reason);
  return result.spec;
}
