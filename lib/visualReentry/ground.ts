/**
 * Grounds a model's visual-re-entry intent against the settled thought it
 * was supposedly extracted from — the same purpose lib/math/ground.ts's
 * groundEquationInSource serves for a claimed equation. Every non-`none`
 * intent carries its own `evidence` (lib/visualReentry/types.ts) — the
 * phrase(s) the model claims justify the extraction — and an enumeration's
 * `items`, or a quantitative_change's `unit`/`fromLabel`/`toLabel`, are
 * checked individually too, so a partly-fabricated result can't slip
 * through just because its evidence phrase was real.
 *
 * Normalization is deliberately harmless-differences-only: casing, simple
 * plural/singular, and punctuation are ignored, but nothing is stemmed hard
 * enough to make an invented category match a real one. If ANY item or
 * evidence phrase fails to ground, the WHOLE intent downgrades to `none`
 * rather than the unsupported item being silently dropped — this codebase's
 * existing convention (groundEquationInSource fails the whole equation, not
 * just the unrecognised term) is "fail the visual, never silently change
 * what the speaker is understood to have said."
 *
 * A downgraded intent is never rejected/retried: silence is always a safe
 * fallback here (invariant #12/#18 in the Visual Re-entry brief), never an
 * error, and never a fallback to a free-form Artist action.
 */

import { extractSpokenNumbers } from "../math/ground";
import { parseExplicitCauseEffect } from "./cause";
import { EXPLICIT_COMPARISON_CUE, parseExplicitComparison } from "./comparison";
import type { QuantitativeQualifier, SettledThought, VisualReentryIntent } from "./types";

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

const EXPLICIT_SEQUENCE_ORDER = /(?:\bfirst(?:ly)?\b[\s\S]{0,500}\b(?:then|next|second(?:ly)?|finally)\b|\bstep\s+(?:one|1)\b[\s\S]{0,500}\bstep\s+(?:two|2)\b|\bthen\b[\s\S]{1,240}\bthen\b|\bthe\s+way\s+(?:i|we)\s+(?:usually\s+)?do\s+it\b[\s\S]{0,500}\b(?:once[\s\S]{0,160}(?:done|finished|complete)|only\s+after\s+that|followed\s+by)\b)/i;

function groundedPhraseStart(phrase: string, source: string[], after: number): number | null {
  const target = words(phrase);
  if (!target.length) return null;
  for (let start = after + 1; start <= source.length - target.length; start += 1) {
    if (target.every((word, offset) => source[start + offset] === word)) return start;
  }
  return null;
}

export interface GroundingResult {
  grounded: boolean;
  reason?: string;
}

const UNGROUNDED: VisualReentryIntent = { type: "none", reason: "grounding failed" };

const SUPPORTED_QUALIFIERS = new Set<QuantitativeQualifier>(["about", "around", "roughly", "approximately"]);
const NUMBER_WORDS = new Set([
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
  "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "thousand",
]);

type SourceModality = QuantitativeQualifier | "unsupported" | null;
interface NumberOccurrence { value: number; start: number; end: number; modality: SourceModality }

function precedingModality(tokens: string[], numberStart: number): SourceModality {
  const previous = tokens[numberStart - 1];
  if (SUPPORTED_QUALIFIERS.has(previous as QuantitativeQualifier)) return previous as QuantitativeQualifier;
  if (["nearly", "almost", "over", "under"].includes(previous)) return "unsupported";
  const pair = tokens.slice(Math.max(0, numberStart - 2), numberStart).join(" ");
  if (["more than", "less than", "at least", "at most"].includes(pair)) return "unsupported";
  return null;
}

/** Locate each claimed value in source order and retain the literal modality immediately attached to it. */
function numberOccurrences(sourceText: string, targets: Set<number>): NumberOccurrence[] {
  const tokens = [...sourceText.toLowerCase().matchAll(/[a-z]+(?:-[a-z]+)?|-?\d[\d,]*(?:\.\d+)?/g)].map((match) => match[0]);
  const occurrences: NumberOccurrence[] = [];
  const seen = new Set<string>();
  for (let start = 0; start < tokens.length; start++) {
    if (!/^-?\d/.test(tokens[start]) && !NUMBER_WORDS.has(tokens[start])) continue;
    for (let end = start; end < Math.min(tokens.length, start + 3); end++) {
      const found = extractSpokenNumbers(tokens.slice(start, end + 1).join(" "));
      for (const value of targets) {
        if (!found.has(value)) continue;
        const key = `${value}:${start}`;
        if (seen.has(key)) continue;
        seen.add(key);
        occurrences.push({ value, start, end, modality: precedingModality(tokens, start) });
      }
    }
  }
  return occurrences.sort((a, b) => a.start - b.start || a.end - b.end);
}

function modalityMatches(expected: QuantitativeQualifier | undefined, actual: SourceModality): boolean {
  return expected ? actual === expected : actual === null;
}

/**
 * Checks an intent's claimed content against the thought it was spoken in.
 * An evidence phrase that wasn't actually said, an enumeration item that
 * doesn't map onto the source (beyond casing/plural/punctuation), or a
 * before/after number never actually said, all downgrade the whole intent
 * to `none` rather than letting an invented visual — or a partially
 * invented one — reach the canvas.
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

  if (intent.type === "enumeration") {
    // Evidence being real doesn't guarantee every item is — a model can cite
    // a genuine phrase and still add a category the speaker never mentioned
    // (the live-caught case: evidence "speed, accuracy and presentation",
    // items ["Speed","Accuracy","Design"]). Check each item independently.
    const ungroundedItem = intent.items.find((item) => !phraseGroundedInSource(item, sourceWords));
    if (ungroundedItem) {
      return {
        decision: UNGROUNDED,
        result: { grounded: false, reason: `enumeration item not found in source: "${ungroundedItem}"` },
      };
    }
    return { decision: intent, result: { grounded: true } };
  }

  if (intent.type === "sequence") {
    const orderedSourceText = thought.sourceSegments.length > 0 ? thought.sourceSegments.join(" ") : thought.text;
    if (!EXPLICIT_SEQUENCE_ORDER.test(orderedSourceText)) {
      return {
        decision: UNGROUNDED,
        result: { grounded: false, reason: "sequence ordering cues not found in source" },
      };
    }
    const sourceSequence = words(orderedSourceText);
    let priorStart = -1;
    for (const step of intent.steps) {
      const start = groundedPhraseStart(step, sourceSequence, priorStart);
      if (start === null) {
        return {
          decision: UNGROUNDED,
          result: { grounded: false, reason: `sequence step not found in source order: "${step}"` },
        };
      }
      priorStart = start;
    }
    return { decision: intent, result: { grounded: true } };
  }

  if (intent.type === "cause_effect") {
    const fullParse = parseExplicitCauseEffect(thought.sourceSegments.length > 0 ? thought.sourceSegments.join(" ") : thought.text);
    if (!fullParse.intent) {
      return { decision: UNGROUNDED, result: { grounded: false, reason: `source causal assertion is unsafe: ${fullParse.reason}` } };
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
      const edgeParse = parseExplicitCauseEffect(edge.evidence);
      if (!edgeParse.intent || edgeParse.intent.edges.length !== 1) {
        return { decision: UNGROUNDED, result: { grounded: false, reason: `cause_effect edge ${index} lacks one literal directed causal clause` } };
      }
      const parsedEdge = edgeParse.intent.edges[0];
      const parsedSource = edgeParse.intent.nodes[parsedEdge.from];
      const parsedTarget = edgeParse.intent.nodes[parsedEdge.to];
      if (!sameConcept(source, parsedSource) || !sameConcept(target, parsedTarget)) {
        return { decision: UNGROUNDED, result: { grounded: false, reason: `cause_effect edge ${index} direction/endpoints do not match its evidence` } };
      }
    }
    return { decision: intent, result: { grounded: true } };
  }

  if (intent.type === "comparison") {
    const orderedSourceText = thought.sourceSegments.length > 0 ? thought.sourceSegments.join(" ") : thought.text;
    const sourceSequence = words(orderedSourceText);
    const labelGrounded = (label: string) => phraseGroundedInSource(label, sourceWords) || new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(orderedSourceText);
    if (!labelGrounded(intent.leftLabel) || !labelGrounded(intent.rightLabel)) {
      return { decision: UNGROUNDED, result: { grounded: false, reason: "comparison subject label not found in source" } };
    }
    const parsed = parseExplicitComparison(orderedSourceText);
    if (!parsed.intent && !EXPLICIT_COMPARISON_CUE.test(orderedSourceText)) {
      return { decision: UNGROUNDED, result: { grounded: false, reason: "explicit comparison/contrast evidence not found in source" } };
    }
    for (const [rowIndex, row] of intent.rows.entries()) {
      for (const [side, claim] of [["left", row.left], ["right", row.right]] as const) {
        if (!claim) continue;
        if (groundedPhraseStart(claim, sourceSequence, -1) === null) {
          return { decision: UNGROUNDED, result: { grounded: false, reason: `comparison row ${rowIndex} ${side} claim not found literally in source: "${claim}"` } };
        }
      }
      for (const evidence of row.evidence) {
        if (!phraseGroundedInSource(evidence, sourceWords)) {
          return { decision: UNGROUNDED, result: { grounded: false, reason: `comparison row ${rowIndex} evidence not found in source` } };
        }
      }
    }
    return { decision: intent, result: { grounded: true } };
  }

  // quantitative_change: evidence grounded above, plus both numbers must be
  // traceable to numbers actually present in the source text (handles
  // "twenty thousand"-style figures too, see extractSpokenNumbers).
  const spoken = extractSpokenNumbers(sourceText);
  const missing = [intent.from, intent.to].filter((n) => !spoken.has(n));
  if (missing.length > 0) {
    return {
      decision: UNGROUNDED,
      result: {
        grounded: false,
        reason: `quantitative_change claims ${missing.join(", ")}, not found in what was actually said`,
      },
    };
  }

  const occurrences = numberOccurrences(sourceText, new Set([intent.from, intent.to]));
  const modalityPairGrounded = occurrences.some((fromOccurrence) =>
    fromOccurrence.value === intent.from &&
    modalityMatches(intent.fromQualifier, fromOccurrence.modality) &&
    occurrences.some((toOccurrence) =>
      toOccurrence.start > fromOccurrence.end &&
      toOccurrence.value === intent.to &&
      modalityMatches(intent.toQualifier, toOccurrence.modality),
    ),
  );
  if (!modalityPairGrounded) {
    const fromClaim = intent.fromQualifier ? `${intent.fromQualifier} ${intent.from}` : `${intent.from} exact`;
    const toClaim = intent.toQualifier ? `${intent.toQualifier} ${intent.to}` : `${intent.to} exact`;
    return {
      decision: UNGROUNDED,
      result: { grounded: false, reason: `quantitative_change modality/order mismatch for ${fromClaim} -> ${toClaim}` },
    };
  }

  // A model-supplied unit or time/context label is free text, not a number
  // — it gets the same phrase-grounding treatment as evidence, so "users"
  // or "last week" must have actually been said, not just plausible-sounding.
  for (const [field, value] of [
    ["unit", intent.unit],
    ["fromLabel", intent.fromLabel],
    ["toLabel", intent.toLabel],
  ] as const) {
    if (value && !phraseGroundedInSource(value, sourceWords)) {
      return {
        decision: UNGROUNDED,
        result: { grounded: false, reason: `quantitative_change's ${field} ("${value}") not found in what was actually said` },
      };
    }
  }

  return { decision: intent, result: { grounded: true } };
}
