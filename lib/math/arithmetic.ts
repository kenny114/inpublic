/**
 * A tiny recursive-descent evaluator over exact fractions: numbers, + - * /,
 * parentheses. Used to verify arithmetic and fraction claims without ever
 * going through floating point (0.1 + 0.2 must not almost-fail a check).
 */

import { fAdd, fDiv, fMul, fSub, fraction, type Fraction } from "./fraction";

class Cursor {
  i = 0;
  s: string;
  constructor(s: string) {
    this.s = s;
  }
  peek(): string {
    return this.s[this.i] ?? "";
  }
  eof(): boolean {
    return this.i >= this.s.length;
  }
}

function skipSpace(c: Cursor) {
  while (!c.eof() && /\s/.test(c.peek())) c.i++;
}

function parseNumber(c: Cursor): Fraction | null {
  skipSpace(c);
  const start = c.i;
  if (c.peek() === "-") c.i++;
  while (!c.eof() && /[\d.]/.test(c.peek())) c.i++;
  const raw = c.s.slice(start, c.i);
  if (!raw || raw === "-") return null;
  if (raw.includes(".")) {
    const [, frac = ""] = raw.split(".");
    const den = 10 ** frac.length;
    return fraction(Math.round(Number(raw) * den), den);
  }
  return fraction(Number(raw), 1);
}

function parseFactor(c: Cursor): Fraction | null {
  skipSpace(c);
  if (c.peek() === "(") {
    c.i++;
    const v = parseExpr(c);
    skipSpace(c);
    if (c.peek() !== ")") return null;
    c.i++;
    return v;
  }
  return parseNumber(c);
}

function parseTerm(c: Cursor): Fraction | null {
  let left = parseFactor(c);
  if (!left) return null;
  for (;;) {
    skipSpace(c);
    const op = c.peek();
    if (op !== "*" && op !== "/") break;
    c.i++;
    const right = parseFactor(c);
    if (!right) return null;
    try {
      left = op === "*" ? fMul(left, right) : fDiv(left, right);
    } catch {
      return null;
    }
  }
  return left;
}

function parseExpr(c: Cursor): Fraction | null {
  let left = parseTerm(c);
  if (!left) return null;
  for (;;) {
    skipSpace(c);
    const op = c.peek();
    if (op !== "+" && op !== "-") break;
    c.i++;
    const right = parseTerm(c);
    if (!right) return null;
    left = op === "+" ? fAdd(left, right) : fSub(left, right);
  }
  return left;
}

/** Evaluates a pure-arithmetic expression, or "a/b" fraction literals. Returns null if unparsable. */
export function evalArithmetic(raw: string): Fraction | null {
  const c = new Cursor(raw.trim());
  const v = parseExpr(c);
  skipSpace(c);
  if (!v || !c.eof()) return null;
  return v;
}
