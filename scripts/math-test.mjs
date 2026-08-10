/**
 * The math domain layer, tested directly.
 *
 *   node --import ./scripts/ts-register.mjs scripts/math-test.mjs
 *
 * No network, no canvas, no API keys — verification is deterministic, so it
 * must be testable without any of those.
 */

import { fAdd, fEquals, fraction, fSub, parseFraction } from "../lib/math/fraction.ts";
import { equationToString, parseEquation, parseLinearExpr, solveForX } from "../lib/math/parse.ts";
import {
  applyOperationToEquation,
  equationsStructurallyEqual,
  verifyArithmetic,
  verifyFraction,
  verifyLinearStep,
  verifySlopeIntercept,
  verifyStepContinuity,
  verifyTransformStep,
} from "../lib/math/verify.ts";
import { evalArithmetic } from "../lib/math/arithmetic.ts";
import { parseMathAction } from "../lib/math/actions.ts";
import { MathActionSchema } from "../lib/math/actions.ts";
import { extractSpokenNumbers, groundEquationInSource } from "../lib/math/ground.ts";
import {
  digitsOf,
  measureLongMultiplication,
  measureMathStepBox,
  placeDigitsAtColumn,
  wrapMathTextPreservingLines,
} from "../lib/math/visuals.ts";
import { willOverflow, newPagePen, place } from "../lib/ops.ts";

let pass = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    pass += 1;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n── ${title}`);
}

// --------------------------------------------------------------- fractions

section("fraction arithmetic");

check("1/2 reduces from 2/4", fEquals(fraction(2, 4), fraction(1, 2)));
check("adds 1/2 + 1/3 = 5/6", fEquals(fAdd(fraction(1, 2), fraction(1, 3)), fraction(5, 6)));
check("subtracts 3/4 - 1/4 = 1/2", fEquals(fSub(fraction(3, 4), fraction(1, 4)), fraction(1, 2)));
check("parses '3/4'", fEquals(parseFraction("3/4"), fraction(3, 4)));
check("parses '-3/4'", fEquals(parseFraction("-3/4"), fraction(-3, 4)));
check("parses a decimal '0.5'", fEquals(parseFraction("0.5"), fraction(1, 2)));
check("rejects garbage", parseFraction("abc") === null);

// ---------------------------------------------------------- expr / equation

section("linear expression parsing");

const e1 = parseLinearExpr("2x + 4");
check("parses '2x + 4'", e1 && e1.coefX.num === 2 && e1.coefX.den === 1 && e1.constant.num === 4);

const e2 = parseLinearExpr("10");
check("parses a bare constant", e2 && e2.coefX.num === 0 && e2.constant.num === 10);

const eq1 = parseEquation("2x + 4 = 10");
check("parses a full equation", eq1 !== null);
check("equationToString round-trips", equationToString(eq1) === "2x + 4 = 10");

check("solveForX finds x = 3", (() => {
  const sol = solveForX(eq1);
  return sol && fEquals(sol, fraction(3));
})());

check("unparsable equation returns null", parseEquation("this is not math") === null);

// ------------------------------------------------------------- arithmetic

section("arithmetic evaluator");

check("2 + 3 * 4 = 14", fEquals(evalArithmetic("2 + 3 * 4"), fraction(14)));
check("(2 + 3) * 4 = 20", fEquals(evalArithmetic("(2 + 3) * 4"), fraction(20)));
check("1/2 + 1/3 via string = 5/6", fEquals(evalArithmetic("1/2 + 1/3"), fraction(5, 6)));
check("unparsable expr returns null", evalArithmetic("two plus three") === null);

// --------------------------------------------------------- linear step verification

section("linear equation step verification — the worked example from the brief");

// 2x + 4 = 10  --subtract 4 from both sides-->  2x = 6
const step1 = verifyLinearStep("2x + 4 = 10", "subtract", 4, "2x = 6");
check("correct subtract step verifies", step1.verified, step1.message);

// 2x = 6  --divide both sides by 2-->  x = 3
const step2 = verifyLinearStep("2x = 6", "divide", 2, "x = 3");
check("correct divide step verifies", step2.verified, step2.message);

// A wrong claim must fail, with the correct answer surfaced.
const wrong = verifyLinearStep("2x + 4 = 10", "subtract", 4, "2x = 4");
check("incorrect subtract step is rejected", !wrong.verified);
check("rejected step surfaces the correct expected result", wrong.expected === "2x = 6", wrong.expected);

// Sides swapped should still verify — "6 = 2x" is the same equation as "2x = 6".
const swapped = verifyLinearStep("2x + 4 = 10", "subtract", 4, "6 = 2x");
check("swapped-side equivalent equation still verifies", swapped.verified, swapped.message);

check(
  "applying divide by zero is rejected, not silently accepted",
  applyOperationToEquation(parseEquation("2x = 6"), "divide", fraction(0)) === null,
);

check(
  "equationsStructurallyEqual treats swapped sides as equal",
  equationsStructurallyEqual(parseEquation("2x = 6"), parseEquation("6 = 2x")),
);
check(
  "equationsStructurallyEqual rejects a genuinely different equation",
  !equationsStructurallyEqual(parseEquation("2x = 6"), parseEquation("2x = 8")),
);

// ----------------------------------------------------------- self-correction

section("self-correction — 'the answer should be negative'");

// A student claims x = 3 for "2x = -6"; the correction should verify against
// the corrected claim, not silently keep the wrong one.
const negFix = verifyLinearStep("2x = -6", "divide", 2, "x = -3");
check("corrected negative-answer step verifies", negFix.verified, negFix.message);
const stillWrong = verifyLinearStep("2x = -6", "divide", 2, "x = 3");
check("the original (uncorrected) claim is rejected", !stillWrong.verified);

// ----------------------------------------------------------------- fractions

section("fraction operation verification");

check("1/2 + 1/3 = 5/6 verifies", verifyFraction("add", "1/2", "1/3", "5/6").verified);
check("1/2 + 1/3 = 1/2 is rejected", !verifyFraction("add", "1/2", "1/3", "1/2").verified);
check("2/4 simplifies to 1/2", verifyFraction("simplify", "2/4", undefined, "1/2").verified);
check("3/4 * 2/3 = 1/2 verifies", verifyFraction("multiply", "3/4", "2/3", "1/2").verified);

// ------------------------------------------------------------------- arithmetic claim

section("arithmetic claim verification");

check("2 + 2 = 4 verifies", verifyArithmetic("2 + 2", 4).verified);
check("2 + 2 = 5 is rejected", !verifyArithmetic("2 + 2", 5).verified);

// ------------------------------------------------------------ slope/intercept

section("slope/intercept verification — coordinate graphs");

check(
  "slope 2, intercept 0 verifies from (0,0) and (2,4)",
  verifySlopeIntercept([{ x: 0, y: 0 }, { x: 2, y: 4 }], 2, 0).verified,
);
check(
  "wrong claimed slope is rejected",
  !verifySlopeIntercept([{ x: 0, y: 0 }, { x: 2, y: 4 }], 3, 0).verified,
);
check(
  "a third non-collinear point is caught",
  !verifySlopeIntercept([{ x: 0, y: 0 }, { x: 2, y: 4 }, { x: 5, y: 1 }], 2, 0).verified,
);
check(
  "a vertical line (undefined slope) is rejected rather than silently computed",
  !verifySlopeIntercept([{ x: 3, y: 0 }, { x: 3, y: 5 }], 0, 0).verified,
);

// ----------------------------------------------- continuity (live-caught bug)

section("step continuity — 'before' must match the board, not just be internally consistent");

// This is the exact sequence a live session produced against the real model:
// speak "2x + 4 = 10", subtract 4 (board now shows "2x = 6"), then divide —
// but the model's claimed "before" for the divide step was the ORIGINAL
// equation, not the board's current "2x = 6". verifyLinearStep alone passes
// this (the arithmetic really is internally consistent), which is exactly
// the gap verifyTransformStep/verifyStepContinuity closes.
check(
  "verifyLinearStep alone is fooled by a stale 'before' — arithmetic is internally consistent",
  verifyLinearStep("2x + 4 = 10", "divide", 2, "x + 2 = 5").verified,
);
check(
  "verifyStepContinuity catches the same step as discontinuous with the board",
  !verifyStepContinuity("2x = 6", "2x + 4 = 10").verified,
);
check(
  "verifyTransformStep rejects the full step once continuity is checked",
  !verifyTransformStep("2x = 6", "divide", 2, "2x + 4 = 10", "x + 2 = 5").verified,
);
check(
  "verifyTransformStep accepts the correct continuation from the actual board state",
  verifyTransformStep("2x = 6", "divide", 2, "2x = 6", "x = 3").verified,
);
check(
  "verifyStepContinuity is not fooled by cosmetic differences (swapped sides)",
  verifyStepContinuity("2x = 6", "6 = 2x").verified,
);
check(
  "verifyStepContinuity falls back to string comparison when a side won't parse (e.g. fraction domain)",
  !verifyStepContinuity("1/2", "1/3").verified,
);

// ------------------------------------------- grounding (live-caught bug #2)

section("create_equation grounding — the extraction must match what was said");

// The exact live sequence: spoken "three x plus five equals twenty" came
// back from the model as the expression "5 = 20" — the "3x +" term
// vanished. There is no prior board state to check continuity against (this
// is the FIRST equation, not a derived step), so lib/math/verify.ts's
// checks don't apply here — groundEquationInSource is the equivalent guard.
check(
  "spoken number extraction handles digits and number words",
  (() => {
    const nums = extractSpokenNumbers("three x plus five equals twenty");
    return nums.has(3) && nums.has(5) && nums.has(20);
  })(),
);
check(
  "spoken number extraction handles compound tens (e.g. 'twenty one')",
  extractSpokenNumbers("twenty one").has(21),
);
check(
  "the correct extraction ('3x + 5 = 20') grounds against what was actually said",
  groundEquationInSource("3x + 5 = 20", "three x plus five equals twenty").grounded,
);
check(
  "the live-caught bad extraction ('5 = 20', dropping the 3x term) is caught as ungrounded",
  !groundEquationInSource("5 = 20", "three x plus five equals twenty").grounded,
);
check(
  "an equation using a variable never mentioned in speech is caught",
  !groundEquationInSource("3y + 5 = 20", "three x plus five equals twenty").grounded,
);
check(
  "an equation with a fabricated number not in the transcript is caught",
  !groundEquationInSource("3x + 7 = 20", "three x plus five equals twenty").grounded,
);
check(
  "an unparsable expression is never silently trusted",
  !groundEquationInSource("not an equation", "three x plus five equals twenty").grounded,
);
check(
  "nothing to check against (empty transcript) does not block — mirrors groundedInSource's posture",
  groundEquationInSource("3x + 5 = 20", "").grounded,
);
check(
  "coefficient of 1 is not required to appear as a spoken number (unspoken: 'x', not 'one x')",
  groundEquationInSource("x + 5 = 20", "x plus five equals twenty").grounded,
);

// -------------------------------------------------------------- action schema

section("math action schema validation");

check(
  "a well-formed create_equation action parses",
  parseMathAction({ type: "create_equation", conceptId: "eq1", expression: "2x + 4 = 10", domain: "linear_equation" }) !== null,
);
check(
  "a create_equation missing 'expression' is dropped, not thrown",
  parseMathAction({ type: "create_equation", conceptId: "eq1", domain: "linear_equation" }) === null,
);
check(
  "an unknown action type is dropped",
  parseMathAction({ type: "not_a_real_action", conceptId: "eq1" }) === null,
);
check(
  "a transform_equation with a well-formed step parses",
  parseMathAction({
    type: "transform_equation",
    conceptId: "eq1",
    step: { operation: "subtract", value: 4, from: "both sides", reason: "isolate x", before: "2x + 4 = 10", result: "2x = 6" },
  }) !== null,
);
check("schema exposes exactly six math action types", MathActionSchema.options.length === 6);

// ------------------------------------------------- line-preserving wrapping
//
// Real model output, captured during the audio-replay audit against
// "Math - Long Multiplication.mp4": wrapToWidth's old `/\s+/` split treated
// the model's own `\n` line breaks as ordinary whitespace, collapsing
// "39 × 8\n        2  (carry 7)" into one flat line "39 × 8 2 (carry 7)".

section("wrapMathTextPreservingLines — explicit line structure survives wrapping");

{
  const { lines } = wrapMathTextPreservingLines("39 × 8\n        2  (carry 7)", 22, 460);
  check("two explicit lines in stay two lines out", lines.length === 2, JSON.stringify(lines));
  check("the base equation is not merged with the carry annotation", lines[0].trim() === "39 × 8", JSON.stringify(lines));
  check("the carry annotation keeps its own line", lines[1].includes("carry 7"), JSON.stringify(lines));
  check("no line joins the two original lines into one", !lines.some((l) => l.includes("39") && l.includes("carry")));
}

{
  const text = "76 × 52\n    152  (76 × 2)\n+ 3800  (76 × 50)";
  const { lines } = wrapMathTextPreservingLines(text, 22, 460);
  check("three explicit lines in stay (at least) three lines out", lines.length >= 3, JSON.stringify(lines));
  check("the base equation is on its own line", lines[0].trim() === "76 × 52", JSON.stringify(lines));
  check(
    "the first partial product's parenthetical is never split across lines (structural boundary, not arbitrary whitespace)",
    lines.some((l) => l.includes("(76 × 2)")),
    JSON.stringify(lines),
  );
  check(
    "the second partial product's parenthetical is never split across lines",
    lines.some((l) => l.includes("(76 × 50)")),
    JSON.stringify(lines),
  );
  check(
    "no line merges two different mathematical rows (e.g. the base equation and a partial product)",
    !lines.some((l) => l.includes("76 × 52") && l.includes("152")),
    JSON.stringify(lines),
  );
}

check("normalizes \\r\\n to \\n before splitting", wrapMathTextPreservingLines("a\r\nb", 22, 460).lines.length === 2);
check("preserves an explicit blank line rather than dropping it", wrapMathTextPreservingLines("a\n\nb", 22, 460).lines.length === 3);
check(
  "a single line still soft-wraps when it alone exceeds the width budget",
  wrapMathTextPreservingLines("this is a very long single line of reasoning text that should still wrap", 22, 300).lines.length > 1,
);
check(
  "a short label that fits is not needlessly split",
  wrapMathTextPreservingLines("2x + 4 = 10", 22, 460).lines.length === 1,
);

// ---------------------------------------------------- long multiplication
//
// Column alignment is done by placing one text element per digit at a fixed
// per-column x offset — never by padding a string with spaces, which cannot
// reliably align anything in a proportional font (verified against real
// model output: literal space-padded carry annotations rendered with no
// alignment at all once wrapped).

section("long multiplication — deterministic column alignment");

{
  const rightEdge = 500;
  const y = 100;
  const size = 26;
  // "39" anchored at column 0 (ones=col0, tens=col1) and a lone carry "7" at
  // column 1 must land at the SAME x as the tens digit of "39" — that's what
  // "carries anchored above the relevant digit" means geometrically.
  const multiplicand = placeDigitsAtColumn("39", 0, rightEdge, y, size, "#000");
  const carry = placeDigitsAtColumn("7", 1, rightEdge, y - 20, size, "#000");
  const tensDigitOf39 = multiplicand.find((el) => el.text === "3");
  check("the carry digit aligns exactly over the tens digit it was carried into", tensDigitOf39.x === carry[0].x, JSON.stringify({ tensDigitOf39, carry }));
}

{
  const rightEdge = 500;
  const size = 26;
  // Two different-length values anchored at the same column must still line
  // up at that column, regardless of how many digits precede it.
  const a = placeDigitsAtColumn("312", 0, rightEdge, 100, size, "#000");
  const b = placeDigitsAtColumn("2", 0, rightEdge, 140, size, "#000");
  const lastOfA = a[a.length - 1];
  const onlyOfB = b[0];
  check(
    "column 0 (ones place) lands at the same x for both a 3-digit and a 1-digit value",
    lastOfA.x === onlyOfB.x,
    JSON.stringify({ lastOfA, onlyOfB }),
  );
}

check("digitsOf strips non-digit characters", digitsOf("3,952") === "3952");
check("digitsOf handles a plain integer", digitsOf("312") === "312");

{
  const { w, h } = measureLongMultiplication({
    type: "long_multiplication",
    multiplicand: "39",
    multiplier: "8",
    carries: [{ value: "7", column: 1 }],
    partialProducts: [{ value: "312", shift: 0, explanation: "8×9=72, write 2 carry 7; 8×3=24, +7=31" }],
    result: "312",
  });
  check("measured width is positive and bounded", w > 0 && w <= 460, w);
  check("measured height accounts for carries + product + result rows", h > 100, h);
}

{
  // More partial-product rows must measure taller — proves the box isn't a
  // fixed-size placeholder that would clip a longer derivation.
  const short = measureLongMultiplication({
    type: "long_multiplication", multiplicand: "39", multiplier: "8", carries: [],
    partialProducts: [{ value: "312", shift: 0 }], result: "312",
  });
  const long = measureLongMultiplication({
    type: "long_multiplication", multiplicand: "369", multiplier: "43", carries: [],
    partialProducts: [{ value: "1107", shift: 0 }, { value: "14760", shift: 1 }], result: "15867",
  });
  check("more partial-product rows measure a taller box", long.h > short.h, JSON.stringify({ short, long }));
}

// -------------------------------------------------- math-specific pagination
//
// The Scribe and structured-diagram paths already checked willOverflow()
// before placing; the math handlers in Board.tsx did not, so math content
// accumulated on one page indefinitely. This proves the underlying
// measure+willOverflow combination Board.tsx now calls before every math
// commit actually detects overflow for a realistic run of steps — the same
// primitive the Scribe path has always used.

section("math pagination — willOverflow correctly fires for an accumulating derivation");

{
  const pen = newPagePen(0);
  let overflowedAt = -1;
  const oneDerivation = [
    "39 × 8", "39 × 8\n        2  (carry 7)", "39 × 8\n     312",
    "56 × 9", "56 × 9\n   4  (carry 5)", "56 × 9\n   504",
    "76 × 52", "76 × 52\n    152  (76 × 2)", "76 × 52\n    152  (76 × 2)\n+ 3800  (76 × 50)", "76 × 52 = 3,952",
    "369 × 43", "369 × 43\n  1107  (369 × 3)", "369 × 43\n   1107  (369 × 3)\n+14760  (369 × 40)", "369 × 43 = 15,867",
  ];
  // A real 385s lecture works through many more problems than fit in one
  // burst — repeat the sequence enough times to guarantee it eventually
  // outgrows a single page's content height, not just its width.
  const labels = Array.from({ length: 8 }, () => oneDerivation).flat();
  for (let i = 0; i < labels.length; i++) {
    const size = measureMathStepBox(labels[i]);
    if (willOverflow(pen, size.w, size.h)) {
      overflowedAt = i;
      break;
    }
    // The real production call (buildMathStepBox) advances the pen via
    // place() — use the same function here rather than approximating it, so
    // this test exercises exactly what Board.tsx does.
    place(pen, size.w, size.h);
  }
  check(
    "a long enough run of real math steps eventually overflows the page (so Board.tsx has something to react to)",
    overflowedAt >= 0,
    `overflowed at index ${overflowedAt}`,
  );
}

// ------------------------------------------------------------------- results

console.log(`\n${"─".repeat(60)}`);
if (failures.length === 0) {
  console.log(`✓ ${pass} checks passed`);
} else {
  console.log(`${pass} passed, ${failures.length} FAILED:\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exitCode = 1;
}
