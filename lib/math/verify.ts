/**
 * Deterministic verification, no LLM involved.
 *
 * A step the model proposes is a claim: "starting from X, doing OP produces
 * Y." This module recomputes what OP actually produces from X and compares it
 * — structurally, on exact fractions, not by string match — to what was
 * claimed. A mismatch is never silently accepted; the caller marks the step
 * unverified rather than rendering it with confidence.
 */

import { fEquals, fraction, parseFraction, type Fraction } from "./fraction";
import { evalArithmetic } from "./arithmetic";
import {
  equationToString,
  parseEquation,
  type Equation,
  type LinearExpr,
} from "./parse";

export interface VerifyResult {
  verified: boolean;
  expected?: string;
  message?: string;
}

function sideEqual(a: LinearExpr, b: LinearExpr): boolean {
  return fEquals(a.coefX, b.coefX) && fEquals(a.constant, b.constant);
}

export function equationsStructurallyEqual(a: Equation, b: Equation): boolean {
  return (
    (sideEqual(a.left, b.left) && sideEqual(a.right, b.right)) ||
    (sideEqual(a.left, b.right) && sideEqual(a.right, b.left))
  );
}

function scaleExpr(e: LinearExpr, k: Fraction, op: "mul" | "div"): LinearExpr {
  const apply = (f: Fraction): Fraction =>
    op === "mul"
      ? fraction(f.num * k.num, f.den * k.den)
      : fraction(f.num * k.den, f.den * k.num);
  return { coefX: apply(e.coefX), constant: apply(e.constant), variable: e.variable };
}

function shiftExpr(e: LinearExpr, k: Fraction, op: "add" | "sub"): LinearExpr {
  const sign = op === "add" ? 1 : -1;
  const shifted = fraction(
    e.constant.num * k.den + sign * k.num * e.constant.den,
    e.constant.den * k.den,
  );
  return { coefX: e.coefX, constant: shifted, variable: e.variable };
}

export type LinearOperation = "add" | "subtract" | "multiply" | "divide";

/**
 * Applies OP with VALUE to both sides of an equation — the only "from" this
 * milestone supports (per the brief's own worked example). Returns null for
 * divide-by-zero or a value that fails to parse.
 */
export function applyOperationToEquation(
  eq: Equation,
  operation: LinearOperation,
  value: Fraction,
): Equation | null {
  switch (operation) {
    case "add":
      return { left: shiftExpr(eq.left, value, "add"), right: shiftExpr(eq.right, value, "add") };
    case "subtract":
      return { left: shiftExpr(eq.left, value, "sub"), right: shiftExpr(eq.right, value, "sub") };
    case "multiply":
      return { left: scaleExpr(eq.left, value, "mul"), right: scaleExpr(eq.right, value, "mul") };
    case "divide":
      if (value.num === 0) return null;
      return { left: scaleExpr(eq.left, value, "div"), right: scaleExpr(eq.right, value, "div") };
    default:
      return null;
  }
}

/**
 * The core check for a MathReasoningStep on a linear equation: recompute the
 * result of applying `operation`/`value` to `before`, and diff it against
 * `after` structurally. On mismatch, `expected` carries what the operation
 * actually produces, so the caller can show a correction rather than a bare
 * rejection.
 */
export function verifyLinearStep(
  beforeStr: string,
  operation: LinearOperation,
  valueRaw: string | number,
  afterStr: string,
): VerifyResult {
  const before = parseEquation(beforeStr);
  if (!before) return { verified: false, message: `could not parse "${beforeStr}" as a linear equation` };

  const after = parseEquation(afterStr);
  if (!after) return { verified: false, message: `could not parse "${afterStr}" as a linear equation` };

  const value = typeof valueRaw === "number" ? fraction(valueRaw) : parseFraction(String(valueRaw));
  if (!value) return { verified: false, message: `could not parse value "${valueRaw}"` };

  const expected = applyOperationToEquation(before, operation, value);
  if (!expected) return { verified: false, message: `cannot ${operation} by ${valueRaw}` };

  if (equationsStructurallyEqual(expected, after)) {
    return { verified: true };
  }
  return {
    verified: false,
    expected: equationToString(expected),
    message: `${operation} ${valueRaw} on "${beforeStr}" gives "${equationToString(expected)}", not "${afterStr}"`,
  };
}

/**
 * Checks that a step's claimed starting point actually matches what's on the
 * board — structurally, not by string match, so "2x = 6" and "6 = 2x" aren't
 * falsely flagged. This is a DIFFERENT failure mode from a wrong operation:
 * `verifyLinearStep` only checks "does OP applied to `before` produce
 * `after`" — it has no way to know `before` itself is stale, so a model that
 * re-derives a later step from the ORIGINAL equation instead of the board's
 * current one will still verify as arithmetically correct while silently
 * skipping an intermediate step. Caught live: dividing "2x + 4 = 10" by 2
 * correctly gives "x + 2 = 5" — that arithmetic checks out — while the board
 * had already moved on to "2x = 6" after a prior subtract step. Falls back
 * to a trimmed string comparison when either side fails to parse (e.g. a
 * fraction-domain claim), so continuity is still checked outside the linear
 * case rather than silently skipped.
 */
export function verifyStepContinuity(boardExpression: string, claimedBefore: string): VerifyResult {
  const boardEq = parseEquation(boardExpression);
  const claimedEq = parseEquation(claimedBefore);
  const continuous =
    boardEq && claimedEq
      ? equationsStructurallyEqual(boardEq, claimedEq)
      : boardExpression.trim() === claimedBefore.trim();
  if (continuous) return { verified: true };
  return {
    verified: false,
    message: `step claims to start from "${claimedBefore}" but the board currently shows "${boardExpression}"`,
  };
}

/**
 * The full check for one transform_equation action: continuity first (does
 * `before` match the board?), then arithmetic (does `operation`/`value`
 * applied to `before` actually produce `result`?). Continuity failing short-
 * circuits — there is no point checking arithmetic against a starting point
 * the board never had.
 */
export function verifyTransformStep(
  boardExpression: string,
  operation: string,
  value: string | number | undefined,
  before: string,
  result: string,
): VerifyResult {
  const continuity = verifyStepContinuity(boardExpression, before);
  if (!continuity.verified) return continuity;

  if (operation !== "add" && operation !== "subtract" && operation !== "multiply" && operation !== "divide") {
    return { verified: false, message: `unsupported operation "${operation}"` };
  }
  return verifyLinearStep(before, operation, value ?? "", result);
}

/** Verifies a claimed arithmetic result, e.g. "2 + 3 * 4" -> 14. */
export function verifyArithmetic(expr: string, claimed: string | number): VerifyResult {
  const actual = evalArithmetic(expr);
  if (!actual) return { verified: false, message: `could not evaluate "${expr}"` };
  const claimedFrac = typeof claimed === "number" ? fraction(claimed) : evalArithmetic(String(claimed));
  if (!claimedFrac) return { verified: false, message: `could not parse claimed result "${claimed}"` };
  if (fEquals(actual, claimedFrac)) return { verified: true };
  return {
    verified: false,
    expected: String(actual.den === 1 ? actual.num : `${actual.num}/${actual.den}`),
    message: `"${expr}" evaluates to ${actual.num}/${actual.den}, not ${claimed}`,
  };
}

export type FractionOperation = "add" | "subtract" | "multiply" | "divide" | "simplify";

/** Verifies a claimed fraction operation, e.g. 1/2 + 1/3 = 5/6. */
export function verifyFraction(
  operation: FractionOperation,
  a: string,
  b: string | undefined,
  claimed: string,
): VerifyResult {
  const fa = parseFraction(a);
  const claimedF = parseFraction(claimed);
  if (!fa) return { verified: false, message: `could not parse "${a}"` };
  if (!claimedF) return { verified: false, message: `could not parse claimed result "${claimed}"` };

  if (operation === "simplify") {
    const reduced = fraction(fa.num, fa.den);
    return fEquals(reduced, claimedF)
      ? { verified: true }
      : {
          verified: false,
          expected: reduced.den === 1 ? String(reduced.num) : `${reduced.num}/${reduced.den}`,
          message: `"${a}" simplifies to ${reduced.num}/${reduced.den}, not ${claimed}`,
        };
  }

  const fb = b ? parseFraction(b) : null;
  if (!fb) return { verified: false, message: `could not parse "${b}"` };

  const expr = `(${a}) ${operation === "add" ? "+" : operation === "subtract" ? "-" : operation === "multiply" ? "*" : "/"} (${b})`;
  const actual = evalArithmetic(expr);
  if (!actual) return { verified: false, message: `could not evaluate "${expr}"` };
  if (fEquals(actual, claimedF)) return { verified: true };
  return {
    verified: false,
    expected: actual.den === 1 ? String(actual.num) : `${actual.num}/${actual.den}`,
    message: `${a} ${operation} ${b} = ${actual.num}/${actual.den}, not ${claimed}`,
  };
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Verifies a claimed slope/intercept against two or more points. Requires the
 * points to be exactly collinear — a "roughly fits" line is exactly the kind
 * of confident-but-wrong output this layer exists to catch.
 */
export function verifySlopeIntercept(
  points: Point[],
  claimedSlope: number,
  claimedIntercept: number,
): VerifyResult {
  if (points.length < 2) return { verified: false, message: "need at least two points" };
  const [p0, p1] = points;
  if (p1.x === p0.x) return { verified: false, message: "vertical line has no defined slope" };
  const actualSlope = (p1.y - p0.y) / (p1.x - p0.x);
  const actualIntercept = p0.y - actualSlope * p0.x;

  for (const p of points.slice(2)) {
    const expectedY = actualSlope * p.x + actualIntercept;
    if (Math.abs(expectedY - p.y) > 1e-9) {
      return { verified: false, message: `point (${p.x}, ${p.y}) is not collinear with the others` };
    }
  }

  const EPS = 1e-9;
  const slopeOk = Math.abs(actualSlope - claimedSlope) < EPS;
  const interceptOk = Math.abs(actualIntercept - claimedIntercept) < EPS;
  if (slopeOk && interceptOk) return { verified: true };
  return {
    verified: false,
    expected: `slope ${actualSlope}, intercept ${actualIntercept}`,
    message: `points give slope ${actualSlope} and intercept ${actualIntercept}, not ${claimedSlope}/${claimedIntercept}`,
  };
}
