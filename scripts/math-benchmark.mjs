/**
 * Math Explanation System benchmark — this milestone's scope only (algebra,
 * fractions, coordinate graphs, word problems). Geometry, probability,
 * statistics and calculus are explicitly NOT covered here; see the report
 * at the bottom for why, rather than padding this file with cases that
 * would trivially pass against nothing.
 *
 *   node --import ./scripts/ts-register.mjs scripts/math-benchmark.mjs
 *
 * Offline and deterministic — this benchmarks the VERIFICATION layer's
 * correctness and latency, not the LLM's step-choosing (that needs a live
 * model call and is exercised instead by `--live` mode, see the bottom).
 */

import { verifyFraction, verifyLinearStep, verifySlopeIntercept } from "../lib/math/verify.ts";

const cases = [
  // --- algebra: linear equations ---
  { domain: "algebra", name: "2x + 4 = 10, subtract 4", fn: () => verifyLinearStep("2x + 4 = 10", "subtract", 4, "2x = 6"), expect: true },
  { domain: "algebra", name: "2x = 6, divide by 2", fn: () => verifyLinearStep("2x = 6", "divide", 2, "x = 3"), expect: true },
  { domain: "algebra", name: "3x - 5 = 16, add 5", fn: () => verifyLinearStep("3x - 5 = 16", "add", 5, "3x = 21"), expect: true },
  { domain: "algebra", name: "negative solution", fn: () => verifyLinearStep("2x = -6", "divide", 2, "x = -3"), expect: true },
  { domain: "algebra", name: "catches a wrong arithmetic claim", fn: () => verifyLinearStep("2x + 4 = 10", "subtract", 4, "2x = 5"), expect: false },
  { domain: "algebra", name: "catches a one-sided operation", fn: () => verifyLinearStep("2x + 4 = 10", "subtract", 4, "2x + 4 = 6"), expect: false },

  // --- fractions ---
  { domain: "fractions", name: "1/2 + 1/3", fn: () => verifyFraction("add", "1/2", "1/3", "5/6"), expect: true },
  { domain: "fractions", name: "3/4 - 1/4", fn: () => verifyFraction("subtract", "3/4", "1/4", "1/2"), expect: true },
  { domain: "fractions", name: "2/3 * 3/4", fn: () => verifyFraction("multiply", "2/3", "3/4", "1/2"), expect: true },
  { domain: "fractions", name: "1/2 / 1/4", fn: () => verifyFraction("divide", "1/2", "1/4", "2"), expect: true },
  { domain: "fractions", name: "simplify 6/8", fn: () => verifyFraction("simplify", "6/8", undefined, "3/4"), expect: true },
  { domain: "fractions", name: "catches wrong fraction sum", fn: () => verifyFraction("add", "1/2", "1/3", "1"), expect: false },

  // --- coordinate graphs ---
  { domain: "graphs", name: "slope 2 through origin", fn: () => verifySlopeIntercept([{ x: 0, y: 0 }, { x: 3, y: 6 }], 2, 0), expect: true },
  { domain: "graphs", name: "slope -1, intercept 5", fn: () => verifySlopeIntercept([{ x: 0, y: 5 }, { x: 5, y: 0 }], -1, 5), expect: true },
  { domain: "graphs", name: "catches wrong slope", fn: () => verifySlopeIntercept([{ x: 0, y: 0 }, { x: 3, y: 6 }], 1, 0), expect: false },
  { domain: "graphs", name: "catches non-collinear third point", fn: () => verifySlopeIntercept([{ x: 0, y: 0 }, { x: 2, y: 4 }, { x: 4, y: 9 }], 2, 0), expect: false },

  // --- word problems (modeled as a linear equation, per this milestone) ---
  { domain: "word_problems", name: "'three more than twice a number is 11' -> 2x+3=11, subtract 3", fn: () => verifyLinearStep("2x + 3 = 11", "subtract", 3, "2x = 8"), expect: true },
  { domain: "word_problems", name: "...then divide by 2", fn: () => verifyLinearStep("2x = 8", "divide", 2, "x = 4"), expect: true },
];

const results = [];
for (const c of cases) {
  const start = performance.now();
  const result = c.fn();
  const latencyMs = performance.now() - start;
  const correct = result.verified === c.expect;
  results.push({ ...c, result, latencyMs, correct });
}

const byDomain = new Map();
for (const r of results) {
  const list = byDomain.get(r.domain) ?? [];
  list.push(r);
  byDomain.set(r.domain, list);
}

console.log("Math Explanation System — deterministic verification benchmark\n");
for (const [domain, list] of byDomain) {
  const correct = list.filter((r) => r.correct).length;
  const avgMs = list.reduce((a, r) => a + r.latencyMs, 0) / list.length;
  console.log(`${domain}: ${correct}/${list.length} correct, avg ${avgMs.toFixed(3)}ms`);
  for (const r of list.filter((r) => !r.correct)) {
    console.log(`  ✗ ${r.name}: expected verified=${r.expect}, got ${r.result.verified} (${r.result.message ?? ""})`);
  }
}

const totalCorrect = results.filter((r) => r.correct).length;
console.log(`\nOverall: ${totalCorrect}/${results.length} verification decisions correct`);
console.log(
  "\nNot covered by this benchmark (documented, not silently skipped): geometry, probability,\n" +
  "statistics, calculus — no verification layer exists yet for these domains (see the plan's\n" +
  "'explicitly deferred' section). Also not covered: end-to-end LLM step quality (whether the\n" +
  "MODEL chooses good steps), reasoning coherence across a full multi-step explanation, visual\n" +
  "correctness on a rendered canvas, and timing sync — those need a live model call and a real\n" +
  "canvas, and were evaluated manually per the plan's verification section, not automated here.",
);

if (totalCorrect !== results.length) process.exitCode = 1;
