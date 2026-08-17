/**
 * Grounds a starting equation against the transcript it was supposedly
 * extracted from — the same purpose `groundedInSource` (lib/vocab.ts) serves
 * for Scribe marks, applied to the one math action that has no prior board
 * state to verify continuity against: `create_equation` is the axiom, not a
 * derived claim, so `lib/math/verify.ts`'s step-to-step checks don't apply
 * to it. Caught live: a spoken "three x plus five equals twenty" came back
 * from the model as the expression "5 = 20" — the "3x +" term vanished
 * entirely, and nothing in the pipeline noticed because there was no
 * verification layer for a FIRST equation, only for steps built on top of
 * one. This closes that gap the same way Scribe marks are already guarded:
 * by word/number overlap with the actual transcript, not by trusting the
 * model's extraction at face value.
 */

import { parseEquation, type Equation, type LinearExpr } from "./parse";
import { fToNumber } from "./fraction";

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};

/**
 * "twenty thousand" -> 20000, "three hundred" -> 300, "twenty one thousand"
 * -> 21000. Deliberately not a general number-language parser (no compound
 * "twelve thousand five hundred", no millions) — just enough for the
 * revenue/count-style figures Visual Re-entry's quantitative_change needs
 * (docs/VISUAL-REENTRY-V1.md), which the two-digit-only pass above was never
 * meant to cover (see its own doc comment). Additive to that pass, not a
 * replacement: the plain "twenty" in "twenty thousand" still gets added on
 * its own by the loop above too, which is harmless — grounding only checks
 * whether a specific target number is present in the set, so an extra,
 * smaller value sitting alongside the real one never causes a false match.
 */
const MULTIPLIERS: Record<string, number> = { hundred: 100, thousand: 1000 };

/**
 * Spoken numbers found in free text — digits directly, plus number words up
 * to "ninety nine" (this milestone's arithmetic doesn't go past two-digit
 * coefficients/constants in practice; larger numbers still match via digits),
 * plus simple hundred/thousand multiples (see MULTIPLIERS above).
 */
export function extractSpokenNumbers(text: string): Set<number> {
  const found = new Set<number>();
  for (const m of text.matchAll(/-?\d+(?:\.\d+)?/g)) found.add(Number(m[0]));

  const words = text.toLowerCase().replace(/[^a-z\s-]/g, " ").split(/[\s-]+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w in ONES) { found.add(ONES[w]); continue; }
    if (w in TENS) {
      const next = words[i + 1];
      if (next && next in ONES && ONES[next] < 10) {
        found.add(TENS[w] + ONES[next]);
        i += 1;
      } else {
        found.add(TENS[w]);
      }
    }
  }

  for (let i = 0; i < words.length; i++) {
    const multiplier = MULTIPLIERS[words[i]];
    if (!multiplier) continue;
    let amount = 1;
    let j = i - 1;
    if (j >= 0 && words[j] in ONES) {
      amount = ONES[words[j]];
      j -= 1;
      if (j >= 0 && words[j] in TENS) amount += TENS[words[j]];
    } else if (j >= 0 && words[j] in TENS) {
      amount = TENS[words[j]];
    }
    found.add(amount * multiplier);
  }
  return found;
}

/** The nonzero literal numbers a linear equation is built from, as a speaker would say them. */
function requiredNumbers(eq: Equation): number[] {
  const nums: number[] = [];
  const fromExpr = (e: LinearExpr) => {
    if (e.coefX.num !== 0) {
      const abs = Math.abs(fToNumber(e.coefX));
      // Coefficient 1 is normally unspoken ("x", not "one x").
      if (abs !== 1) nums.push(abs);
    }
    if (e.constant.num !== 0) nums.push(Math.abs(fToNumber(e.constant)));
  };
  fromExpr(eq.left);
  fromExpr(eq.right);
  return nums;
}

function hasVariable(eq: Equation): string | null {
  return eq.left.variable ?? eq.right.variable ?? null;
}

/**
 * Common single-letter algebra variables, spoken as a standalone letter.
 * Deliberately excludes "a" and "i" — the only single letters that are also
 * ordinary English words, so "a" in "a number" or "I" wouldn't misfire as a
 * claimed variable.
 */
const VARIABLE_CANDIDATES = /\b(x|y|z|n|t|k|m|b|c)\b/gi;

/**
 * Finds a spoken variable letter the transcript names but the equation
 * doesn't use — the direction `requiredNumbers`/the numbers check above
 * can't catch, since a term (like "3x") going missing entirely leaves
 * nothing in the equation to flag as extra. This is precisely the live-
 * caught bug: "three x plus five equals twenty" -> "5 = 20" passes the
 * numbers check (5 and 20 are both genuinely spoken) while silently
 * dropping the "3x" term altogether.
 */
function droppedVariable(eq: Equation, sourceText: string): string | null {
  const used = hasVariable(eq);
  const spoken = [...sourceText.matchAll(VARIABLE_CANDIDATES)].map((m) => m[0].toLowerCase());
  const missing = spoken.find((v) => v !== (used ?? "").toLowerCase());
  return missing ?? null;
}

export interface GroundingResult {
  grounded: boolean;
  message?: string;
}

/**
 * Checks a claimed starting equation against the transcript it was spoken
 * in. Mirrors `groundedInSource`'s posture: nothing to check against means
 * nothing to block on, and a partial match (variable present, all numbers
 * present) passes — this is a hallucination guard, not a transcription
 * grader.
 */
export function groundEquationInSource(expression: string, sourceText: string): GroundingResult {
  if (!sourceText.trim()) return { grounded: true }; // nothing to check against; don't block

  const eq = parseEquation(expression);
  if (!eq) return { grounded: false, message: `"${expression}" does not parse as a linear equation` };

  const spoken = extractSpokenNumbers(sourceText);
  const missingNumbers = requiredNumbers(eq).filter((n) => !spoken.has(n));
  if (missingNumbers.length > 0) {
    return {
      grounded: false,
      message: `"${expression}" claims ${missingNumbers.join(", ")}, not found in what was actually said`,
    };
  }

  const variable = hasVariable(eq);
  if (variable) {
    const mentioned = new RegExp(`\\b${variable}\\b`, "i").test(sourceText);
    if (!mentioned) {
      return { grounded: false, message: `"${expression}" uses "${variable}", not mentioned in what was said` };
    }
  }

  const dropped = droppedVariable(eq, sourceText);
  if (dropped) {
    return {
      grounded: false,
      message: `"${expression}" doesn't use "${dropped}", which was mentioned in what was said — a term may have been dropped`,
    };
  }

  return { grounded: true };
}
