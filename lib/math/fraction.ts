/**
 * Exact rational arithmetic. The verification layer compares structurally
 * normalized values, not floating point — "1/3" and "0.333" must never be
 * treated as equal by accident, and 2/4 must reduce to 1/2 before comparison.
 */

export interface Fraction {
  num: number;
  den: number;
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

export function fraction(num: number, den = 1): Fraction {
  if (den === 0) throw new Error("division by zero");
  if (den < 0) {
    num = -num;
    den = -den;
  }
  const g = gcd(num, den);
  return { num: num / g, den: den / g };
}

export function fAdd(a: Fraction, b: Fraction): Fraction {
  return fraction(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function fSub(a: Fraction, b: Fraction): Fraction {
  return fraction(a.num * b.den - b.num * a.den, a.den * b.den);
}

export function fMul(a: Fraction, b: Fraction): Fraction {
  return fraction(a.num * b.num, a.den * b.den);
}

export function fDiv(a: Fraction, b: Fraction): Fraction {
  if (b.num === 0) throw new Error("division by zero");
  return fraction(a.num * b.den, a.den * b.num);
}

export function fEquals(a: Fraction, b: Fraction): boolean {
  const ra = fraction(a.num, a.den);
  const rb = fraction(b.num, b.den);
  return ra.num === rb.num && ra.den === rb.den;
}

export function fToNumber(a: Fraction): number {
  return a.num / a.den;
}

export function fToString(a: Fraction): string {
  const r = fraction(a.num, a.den);
  return r.den === 1 ? String(r.num) : `${r.num}/${r.den}`;
}

/** Parses "3", "-3", "3/4", "-3/4". Returns null on anything else. */
export function parseFraction(raw: string): Fraction | null {
  const s = raw.trim();
  const wholeOrFrac = s.match(/^(-?\d+)\s*\/\s*(-?\d+)$/);
  if (wholeOrFrac) {
    const den = Number(wholeOrFrac[2]);
    if (den === 0) return null;
    return fraction(Number(wholeOrFrac[1]), den);
  }
  const decimal = s.match(/^-?\d+(\.\d+)?$/);
  if (decimal) {
    if (s.includes(".")) {
      const [, frac] = s.split(".");
      const den = 10 ** frac.length;
      return fraction(Math.round(Number(s) * den), den);
    }
    return fraction(Number(s), 1);
  }
  return null;
}
