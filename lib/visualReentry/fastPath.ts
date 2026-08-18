import { evaluateVisualCandidate, parseOpenEnumeration } from "./candidate";
import { parseExplicitCauseEffect } from "./cause";
import { parseExplicitComparison } from "./comparison";
import type { QuantitativeChangeIntent, QuantitativeQualifier, SequenceIntent, SettledThought, VisualReentrySpec } from "./types";

export type VisualDecisionSource = "deterministic_fast_path" | "model_fallback";

export interface DeterministicVisualIntentResult {
  intent: VisualReentrySpec | null;
  reason: string;
}

const COUNT_VALUES: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
};

const COUNTED_LIST = /\b(two|three|four|five|2|3|4|5)\s+(things|reasons|priorities|goals|items|ways|areas|features|benefits|problems|options|parts|principles|changes|improvements)\b/i;
const ENUMERATION_UNCERTAINTY = /\b(?:about|approximately|around|roughly|nearly|almost|maybe|perhaps|possibly|probably|kind\s+of|sort\s+of|something\s+like)\b/i;
const SUPPORTED_QUALIFIER_SOURCE = "(about|around|roughly|approximately)";
const SUPPORTED_QUALIFIER = new RegExp(`\\b${SUPPORTED_QUALIFIER_SOURCE}\\b`, "i");
const UNSUPPORTED_QUANTITATIVE_MODALITY = /\b(?:nearly|almost|maybe|perhaps|possibly|probably|more\s+than|less\s+than|at\s+least|at\s+most|over|under|between|roughly\s+twice|approximately\s+twice|about\s+twice|around\s+twice)\b/i;
const HIERARCHY_OR_PROCESS = /\b(?:reports?\s+to|managed\s+by|department|division|organi[sz]ation(?:al)?|hierarchy|workflow|process|sequence|then\s+next)\b/i;
const NUMBER_LITERAL = /\b\d[\d,]*(?:\.\d+)?\b/g;
const NUMBER_SOURCE = "(\\d[\\d,]*(?:\\.\\d+)?)";
const WORD = "([a-z][a-z-]*)";
const PERIOD_LABEL = "((?:last|this|previous|current|next)\\s+(?:week|month|quarter|year))";
const SEQUENCE_UNCERTAINTY = /\b(?:maybe|perhaps|possibly|probably|might|could|may)\b/i;
const EXPLICIT_STEP_MARKER = /\b(?:first(?:ly)?|second(?:ly)?|third(?:ly)?|fourth(?:ly)?|fifth(?:ly)?|then|next|after\s+that|finally|step\s+(?:one|two|three|four|five|[1-5]))\b[:,]?/gi;

function firstSentence(text: string): string {
  return text.split(/[.!?](?:\s|$)/, 1)[0]?.trim() ?? "";
}

function cleanItem(value: string): string {
  return value.trim().replace(/^[\s:;-]+|[\s.!?;:]+$/g, "");
}

function parseLiteralList(payload: string, expected: number): string[] | null {
  const sentence = firstSentence(payload);
  if (!sentence || ENUMERATION_UNCERTAINTY.test(sentence)) return null;
  const pieces = sentence
    .split(/\s*,\s*|\s+and\s+/i)
    .map(cleanItem)
    .filter(Boolean);
  if (pieces.length !== expected) return null;
  if (pieces.some((item) => item.length > 48 || item.split(/\s+/).length > 7 || /[,;:]/.test(item))) return null;
  return pieces;
}

function tryEnumeration(thought: SettledThought): DeterministicVisualIntentResult {
  const text = thought.text.trim();
  const open = parseOpenEnumeration(text);
  if (open) {
    return {
      intent: { type: "enumeration", items: open, evidence: [open.join(" ")] },
      reason: `open list of ${open.length} short items`,
    };
  }
  const cue = COUNTED_LIST.exec(text);
  if (!cue) return { intent: null, reason: "no explicit counted-list cue" };
  if (ENUMERATION_UNCERTAINTY.test(text)) return { intent: null, reason: "uncertainty language cannot be represented exactly" };
  if (HIERARCHY_OR_PROCESS.test(text)) return { intent: null, reason: "possible hierarchy/process semantics" };

  const expected = COUNT_VALUES[cue[1].toLowerCase()];
  const afterCue = text.slice((cue.index ?? 0) + cue[0].length);
  let payload = "";
  const colon = afterCue.indexOf(":");
  if (colon >= 0) {
    payload = afterCue.slice(colon + 1);
  } else {
    const are = /^\s+(?:we\s+need\s+to\s+\w+\s*)?are\s+/i.exec(afterCue);
    if (are) payload = afterCue.slice(are[0].length);
    else {
      const sentenceEnd = afterCue.search(/[.!?](?:\s|$)/);
      if (sentenceEnd >= 0) payload = afterCue.slice(sentenceEnd + 1);
    }
  }

  const items = parseLiteralList(payload, expected);
  if (!items) return { intent: null, reason: "count or literal item boundaries are not exceptionally explicit" };
  return {
    intent: { type: "enumeration", items, evidence: [items.join(" ")] },
    reason: `explicit count ${expected} with exactly ${expected} literal flat-list items`,
  };
}

function numericValue(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

function qualifier(raw?: string): QuantitativeQualifier | undefined {
  return raw?.toLowerCase() as QuantitativeQualifier | undefined;
}

function compatibleUnit(fromUnit?: string, toUnit?: string): string | null | undefined {
  // Conjunctions and vague trailing words are not units. In speech such as
  // "about 400 and something", "about" already carries the representable
  // approximation; treating "and" as a unit would create a false mismatch.
  const reserved = new Set(["and", "or", "something", "last", "this", "previous", "current", "next"]);
  const from = fromUnit && !reserved.has(fromUnit.toLowerCase()) ? fromUnit.toLowerCase() : undefined;
  const to = toUnit && !reserved.has(toUnit.toLowerCase()) ? toUnit.toLowerCase() : undefined;
  if (from && to && from !== to) return null;
  return from ?? to;
}

function quantitativeIntent(
  text: string,
  fromRaw: string,
  fromQualifierRaw: string | undefined,
  fromUnit: string | undefined,
  toRaw: string,
  toQualifierRaw: string | undefined,
  toUnit: string | undefined,
  labels?: { fromLabel: string; toLabel: string },
): QuantitativeChangeIntent | null {
  const from = numericValue(fromRaw);
  const to = numericValue(toRaw);
  const unit = compatibleUnit(fromUnit, toUnit);
  if (!Number.isFinite(from) || !Number.isFinite(to) || unit === null) return null;
  return {
    type: "quantitative_change",
    from,
    to,
    ...(fromQualifierRaw ? { fromQualifier: qualifier(fromQualifierRaw) } : {}),
    ...(toQualifierRaw ? { toQualifier: qualifier(toQualifierRaw) } : {}),
    ...(unit ? { unit } : {}),
    ...(labels ?? {}),
    evidence: [text],
  };
}

function tryQuantitative(thought: SettledThought): DeterministicVisualIntentResult {
  const text = thought.text.trim();
  if (UNSUPPORTED_QUANTITATIVE_MODALITY.test(text)) return { intent: null, reason: "unsupported quantitative modality cannot be represented without strengthening the claim" };
  const literals = [...text.matchAll(NUMBER_LITERAL)];
  if (literals.length !== 2) return { intent: null, reason: "requires exactly two literal numerical anchors" };

  const fromTo = new RegExp(`\\bfrom\\s+(?:${SUPPORTED_QUALIFIER_SOURCE}\\s+)?${NUMBER_SOURCE}(?:\\s+${WORD})?[\\s\\S]{0,100}?\\bto\\s+(?:${SUPPORTED_QUALIFIER_SOURCE}\\s+)?${NUMBER_SOURCE}(?:\\s+${WORD})?`, "i").exec(text);
  if (fromTo) {
    const intent = quantitativeIntent(text, fromTo[2], fromTo[1], fromTo[3], fromTo[5], fromTo[4], fromTo[6]);
    if (!intent) return { intent: null, reason: "from/to units are incompatible or a numerical anchor is invalid" };
    return {
      intent,
      reason: SUPPORTED_QUALIFIER.test(text) ? "literal from/to pair with preserved approximation and compatible units" : "literal from/to pair with compatible units",
    };
  }

  const startedReached = new RegExp(`\\bstarted\\s+at\\s+(?:${SUPPORTED_QUALIFIER_SOURCE}\\s+)?${NUMBER_SOURCE}(?:\\s+${WORD})?[\\s\\S]{0,100}?\\breached\\s+(?:${SUPPORTED_QUALIFIER_SOURCE}\\s+)?${NUMBER_SOURCE}(?:\\s+${WORD})?`, "i").exec(text);
  if (startedReached) {
    const intent = quantitativeIntent(text, startedReached[2], startedReached[1], startedReached[3], startedReached[5], startedReached[4], startedReached[6]);
    if (!intent) return { intent: null, reason: "started/reached units are incompatible or a numerical anchor is invalid" };
    return { intent, reason: "literal started/reached pair with preserved source modality and compatible units" };
  }

  const paired = new RegExp(`(?:${SUPPORTED_QUALIFIER_SOURCE}\\s+)?${NUMBER_SOURCE}\\s+${WORD}\\s+${PERIOD_LABEL}[\\s\\S]{0,100}?(?:${SUPPORTED_QUALIFIER_SOURCE}\\s+)?${NUMBER_SOURCE}\\s+${WORD}\\s+${PERIOD_LABEL}`, "i").exec(text);
  if (!paired) return { intent: null, reason: "numbers lack an explicit from/to or compatible paired-period context" };
  const fromLabel = paired[4].toLowerCase();
  const toLabel = paired[8].toLowerCase();
  if (fromLabel === toLabel) {
    return { intent: null, reason: "paired numerical anchors are not compatible and distinct" };
  }
  const intent = quantitativeIntent(text, paired[2], paired[1], paired[3], paired[6], paired[5], paired[7], { fromLabel, toLabel });
  if (!intent) return { intent: null, reason: "paired numerical anchors are not compatible and distinct" };
  return {
    intent,
    reason: "two literal anchors with the same unit, preserved source modality, and distinct paired-period labels",
  };
}

function cleanSequencePhrase(value: string): string {
  return value
    .trim()
    .replace(/^[\s,;:.-]+|[\s,;:.!?-]+$/g, "")
    .split(/[.!?](?:\s|$)/, 1)[0]
    ?.trim() ?? "";
}

function normalizeSequenceStep(value: string): string {
  const literal = cleanSequencePhrase(value).replace(/^(?:we|i)\s+/i, "");
  return literal ? `${literal[0].toUpperCase()}${literal.slice(1)}` : "";
}

function trySequence(thought: SettledThought): DeterministicVisualIntentResult {
  const text = thought.text.trim();
  if (SEQUENCE_UNCERTAINTY.test(text)) {
    return { intent: null, reason: "sequence uncertainty cannot be preserved by the V2 schema" };
  }
  const markers = [...text.matchAll(EXPLICIT_STEP_MARKER)];
  if (markers.length < 2) return { intent: null, reason: "sequence lacks exceptionally explicit step boundaries" };

  const literalSteps: string[] = [];
  const firstMarker = markers[0];
  if (/^then\b/i.test(firstMarker[0])) {
    const prefix = cleanSequencePhrase(text.slice(0, firstMarker.index));
    if (prefix) literalSteps.push(prefix);
  }
  for (let index = 0; index < markers.length; index += 1) {
    const start = (markers[index].index ?? 0) + markers[index][0].length;
    const end = markers[index + 1]?.index ?? text.length;
    const phrase = cleanSequencePhrase(text.slice(start, end));
    if (phrase) literalSteps.push(phrase);
  }
  if (literalSteps.length < 2 || literalSteps.length > 5) {
    return { intent: null, reason: "explicit sequence must contain two to five complete literal steps" };
  }
  if (literalSteps.some((step) => step.length > 90 || step.split(/\s+/).length > 14)) {
    return { intent: null, reason: "sequence step boundaries are too broad for safe deterministic extraction" };
  }
  const steps = literalSteps.map(normalizeSequenceStep);
  if (steps.some((step) => !step)) return { intent: null, reason: "sequence contains an empty step" };
  const intent: SequenceIntent = { type: "sequence", steps, evidence: literalSteps };
  return { intent, reason: `${steps.length} explicit ordered markers with literal grounded step boundaries` };
}

/**
 * Exceptionally conservative extraction for the two already-supported visual
 * families. Returning null is side-effect free and means "use the model".
 */
export function tryDeterministicVisualIntent(thought: SettledThought): DeterministicVisualIntentResult {
  const family = evaluateVisualCandidate(thought.text).family;
  if (family === "quantitative_change") return tryQuantitative(thought);
  if (family === "sequence") return trySequence(thought);
  if (family === "cause_effect") {
    if (/\bthe\s+reason\b[\s\S]{1,180}\bwas\s+that\b/i.test(thought.text)) {
      return { intent: null, reason: "explicit causal framing requires syntactic model fallback" };
    }
    const parsed = parseExplicitCauseEffect(thought.text);
    return { intent: parsed.intent, reason: parsed.reason };
  }
  if (family === "comparison") {
    if (/\bsolve(?:s|d)?\s+(?:the\s+problem\s+)?differently\b/i.test(thought.text)) {
      return { intent: null, reason: "explicit diffuse comparison requires syntactic model fallback" };
    }
    const parsed = parseExplicitComparison(thought.text);
    return { intent: parsed.intent, reason: parsed.reason };
  }
  if (family === "enumeration") return tryEnumeration(thought);
  return { intent: null, reason: "no supported candidate family owns this source structure" };
}
