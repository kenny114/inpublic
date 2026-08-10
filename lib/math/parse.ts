/**
 * A small, deliberately narrow parser: linear expressions in at most one
 * variable, with integer or fractional coefficients. It exists only to make
 * verification possible — it is not a CAS and must never be asked to parse
 * anything the milestone doesn't cover (quadratics, multi-variable systems).
 *
 * "2x + 4" -> LinearExpr { coefX: fraction(2), constant: fraction(4) }
 * "2x + 4 = 10" -> Equation { left, right }
 */

import { fAdd, fSub, fraction, parseFraction, type Fraction } from "./fraction";

export interface LinearExpr {
  /** Coefficient on the variable term. Zero if the expression is constant-only. */
  coefX: Fraction;
  constant: Fraction;
  /** The variable name actually seen, so "y = 2x + 1" round-trips its labels. */
  variable: string | null;
}

export interface Equation {
  left: LinearExpr;
  right: LinearExpr;
}

const ZERO = fraction(0);

function emptyExpr(): LinearExpr {
  return { coefX: fraction(0), constant: fraction(0), variable: null };
}

/**
 * Tokenizes one side into signed terms: "2x + 4 - x/2" ->
 * [{sign:1, coef:2, var:"x"}, {sign:1, coef:4, var:null}, {sign:-1, coef:1/2, var:"x"}]
 */
function tokenize(side: string): { coef: Fraction; variable: string | null }[] {
  const cleaned = side.replace(/\s+/g, "");
  // Split on + / - while keeping the sign, but not inside a fraction slash.
  const parts = cleaned.match(/[+-]?[^+-]+/g) ?? [];
  const terms: { coef: Fraction; variable: string | null }[] = [];
  for (const raw of parts) {
    if (!raw) continue;
    const sign = raw.startsWith("-") ? -1 : 1;
    const body = raw.replace(/^[+-]/, "");
    if (!body) continue;
    // "x", "2x", "x/2", "3x/4", "-x"
    const varMatch = body.match(/^(\d+(?:\/\d+)?)?([a-zA-Z])$/);
    if (varMatch) {
      const coefRaw = varMatch[1];
      const coef = coefRaw ? parseFraction(coefRaw) : fraction(1);
      if (!coef) return [];
      terms.push({ coef: fraction(sign * coef.num, coef.den), variable: varMatch[2] });
      continue;
    }
    // plain fraction/number constant
    const constMatch = parseFraction(body);
    if (constMatch) {
      terms.push({ coef: fraction(sign * constMatch.num, constMatch.den), variable: null });
      continue;
    }
    // unrecognised token — bail out, caller treats as unparsable
    return [{ coef: fraction(NaN), variable: "__invalid__" }];
  }
  return terms;
}

export function parseLinearExpr(side: string): LinearExpr | null {
  const terms = tokenize(side);
  if (terms.some((t) => t.variable === "__invalid__" || Number.isNaN(t.coef.num))) {
    return null;
  }
  const expr = emptyExpr();
  for (const t of terms) {
    if (t.variable) {
      expr.coefX = fAdd(expr.coefX, t.coef);
      expr.variable = t.variable;
    } else {
      expr.constant = fAdd(expr.constant, t.coef);
    }
  }
  return expr;
}

/** Parses "2x + 4 = 10". Returns null if either side fails to parse. */
export function parseEquation(raw: string): Equation | null {
  const sides = raw.split("=");
  if (sides.length !== 2) return null;
  const left = parseLinearExpr(sides[0]);
  const right = parseLinearExpr(sides[1]);
  if (!left || !right) return null;
  return { left, right };
}

export function exprIsZero(e: LinearExpr): boolean {
  return e.coefX.num === 0 && e.constant.num === ZERO.num;
}

/** left - right, collapsed to a single LinearExpr ("ax + b"). */
export function equationDelta(eq: Equation): LinearExpr {
  return {
    coefX: fSub(eq.left.coefX, eq.right.coefX),
    constant: fSub(eq.left.constant, eq.right.constant),
    variable: eq.left.variable ?? eq.right.variable,
  };
}

/** Solves ax + b = 0 for x. Null if there is no unique solution (a = 0). */
export function solveForX(eq: Equation): Fraction | null {
  const delta = equationDelta(eq);
  if (delta.coefX.num === 0) return null;
  return { num: -delta.constant.num * delta.coefX.den, den: delta.constant.den * delta.coefX.num };
}

export function exprToString(e: LinearExpr): string {
  const parts: string[] = [];
  if (e.coefX.num !== 0) {
    const abs = fraction(Math.abs(e.coefX.num), e.coefX.den);
    const coefStr = abs.num === 1 && abs.den === 1 ? "" : `${abs.den === 1 ? abs.num : `${abs.num}/${abs.den}`}`;
    parts.push(`${e.coefX.num < 0 ? "-" : ""}${coefStr}${e.variable ?? "x"}`);
  }
  if (e.constant.num !== 0 || parts.length === 0) {
    const sign = e.constant.num < 0 ? "-" : parts.length ? "+" : "";
    const abs = fraction(Math.abs(e.constant.num), e.constant.den);
    parts.push(`${parts.length ? ` ${sign} ` : sign}${abs.den === 1 ? abs.num : `${abs.num}/${abs.den}`}`);
  }
  return parts.join("").trim() || "0";
}

export function equationToString(eq: Equation): string {
  return `${exprToString(eq.left)} = ${exprToString(eq.right)}`;
}
