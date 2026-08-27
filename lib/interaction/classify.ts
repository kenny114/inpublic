import type { LiveInteractionClassification } from "./types";

const REFERENCE = /\b(?:that|this|those|these|it|previous|above|below|first|second|third|last one|these two|the other)\b/i;
const IMPERATIVE_PREFIX = /^(?:please\s+|can you\s+|could you\s+|would you\s+|will you\s+)?/i;
const MANIPULATION = /^(?:remove|delete|erase|drop|forget|connect|link|relate|disconnect|change|rename|replace|swap|reverse|redirect|move|put)\b/i;
const PRESENTATION = /^(?:focus(?:\s+on)?|zoom(?:\s+(?:in|out))?|centre|center|frame|show me|take me to|look at)\b/i;
const CORRECTION = /^(?:actually|no\b|correction\b|instead\b)/i;

/** Conservative, deterministic routing. Ambiguous speech stays on the proven Expression path. */
export function classifyLiveInteraction(text: string): LiveInteractionClassification {
  const clean = text.trim();
  if (!clean) return { intent: "ignore", reason: "empty settled input" };
  const command = clean.replace(IMPERATIVE_PREFIX, "");
  if (PRESENTATION.test(command)) {
    return { intent: "present", reason: "explicit presentation request" };
  }
  if (MANIPULATION.test(command)) {
    return { intent: "manipulate", reason: "explicit existing-world operation" };
  }
  if (CORRECTION.test(clean) && (REFERENCE.test(clean) || /\b(?:wrong|not|rather than|instead of|other way)\b/i.test(clean))) {
    return { intent: "manipulate", reason: "explicit correction of existing content" };
  }
  if (/\b(?:this|that)\s+arrow\b.*\b(?:other way|backwards|reverse|opposite)\b/i.test(clean)) {
    return { intent: "manipulate", reason: "explicit relation-direction correction" };
  }
  return { intent: "express", reason: "ordinary new meaning is the safe default" };
}
