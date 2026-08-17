import { extractSpokenNumbers } from "../math/ground";
import { parseExplicitCauseEffect } from "./cause";
import { parseExplicitComparison } from "./comparison";

export type VisualCandidateFamily = "enumeration" | "quantitative_change" | "sequence" | "cause_effect" | "comparison";

export interface VisualCandidateDecision {
  candidate: boolean;
  family?: VisualCandidateFamily;
  reason: string;
}

const CHANGE_CUE = /\b(?:from\b[\s\S]{0,100}\bto|started\s+at\b[\s\S]{0,100}\breached|grew|rose|fell|dropped|climbed|increas(?:e|ed|ing)|decreas(?:e|ed|ing)|declined|reduced|doubled|tripled|compared\s+(?:with|to)|versus|vs\.?|last\s+(?:week|month|quarter|year)[\s\S]{0,80}this\s+(?:week|month|quarter|year)|before[\s\S]{0,80}after)\b/i;
const EXPLICIT_LIST_CUE = /\b(?:two|three|four|five|2|3|4|5)\s+(?:things|reasons|priorities|goals|items|ways|areas|features|benefits|problems|options|parts|principles|changes|improvements)\b/i;
const ORDERED_LIST_CUE = /\b(?:first|firstly)\b[\s\S]{0,240}\b(?:second|secondly)\b/i;
const PRESENTATION_CUE = /\b(?:the\s+following|our\s+(?:top|main)\s+(?:priorities|goals|reasons|options)|my\s+(?:top|main)\s+(?:priorities|goals|reasons|options))\b/i;
const EXPLICIT_SEQUENCE_PAIR = /(?:\bfirst(?:ly)?\b[\s\S]{0,320}\b(?:then|next|second(?:ly)?|finally)\b|\bstep\s+(?:one|1)\b[\s\S]{0,320}\bstep\s+(?:two|2)\b|\bthen\b[\s\S]{1,200}\bthen\b)/i;
const PROCESS_FRAMING = /\b(?:the\s+process\s+is|there\s+are\s+(?:two|three|four|five|2|3|4|5)\s+steps|the\s+way\s+(?:i|we)\s+(?:usually\s+)?do\s+it|workflow|followed\s+by)\b/i;
const PROCESS_TRANSITION = /\b(?:next|after\s+that|once\s+(?:that(?:'s|\s+is)|this\s+is)\s+(?:done|finished|complete)|only\s+after\s+that|followed\s+by|finally)\b/gi;
const TOO_MANY_STEPS = /\b(?:six|seven|eight|nine|ten|[6-9]|10)\s+steps\b/i;

/**
 * Cheap, deterministic, deliberately conservative prefilter. It only admits
 * structures that one of the three supported renderers can represent; ordinary noun
 * sequences, relationships, hierarchies and number mentions stay text-only.
 */
export function evaluateVisualCandidate(text: string): VisualCandidateDecision {
  const spoken = text.trim();
  if (!spoken) return { candidate: false, reason: "empty thought" };

  const numbers = extractSpokenNumbers(spoken);
  if (numbers.size >= 2 && CHANGE_CUE.test(spoken)) {
    return { candidate: true, family: "quantitative_change", reason: "two grounded number mentions plus an explicit change/comparison cue" };
  }

  const causal = parseExplicitCauseEffect(spoken);
  if (causal.intent) {
    return { candidate: true, family: "cause_effect", reason: causal.reason };
  }

  const comparison = parseExplicitComparison(spoken);
  if (comparison.intent) {
    return { candidate: true, family: "comparison", reason: comparison.reason };
  }
  if (/\bsolve(?:s|d)?\s+(?:the\s+problem\s+)?differently\b/i.test(spoken) && /\bclaude\b/i.test(spoken) && /\bgemini\b/i.test(spoken)) {
    return { candidate: true, family: "comparison", reason: "explicit diffuse contrast with exactly two named subjects" };
  }

  if (TOO_MANY_STEPS.test(spoken)) {
    return { candidate: false, reason: "explicit process exceeds the compact five-step sequence limit" };
  }

  const transitionCount = [...spoken.matchAll(PROCESS_TRANSITION)].length;
  if (EXPLICIT_SEQUENCE_PAIR.test(spoken) || (PROCESS_FRAMING.test(spoken) && transitionCount >= 1)) {
    return { candidate: true, family: "sequence", reason: "explicit ordered-process semantics" };
  }

  if (EXPLICIT_LIST_CUE.test(spoken) || ORDERED_LIST_CUE.test(spoken) || PRESENTATION_CUE.test(spoken)) {
    return { candidate: true, family: "enumeration", reason: "explicit flat-list presentation cue" };
  }

  const meaningfulRejection = comparison.rejection && comparison.rejection !== "subjects" ? comparison.reason : causal.reason;
  return { candidate: false, reason: meaningfulRejection === "no explicit causal cue" ? "no supported enumeration, quantitative-change, ordered-process, explicit-causality, or two-sided-comparison signal" : meaningfulRejection };
}
