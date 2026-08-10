# Math reasoning schema

## Scope of this milestone

Linear equations in one variable, fractions, coordinate graphs (points,
slope/intercept), and word problems reducible to the above. This is the
brief's own named first milestone — not the full spec's mention of geometry,
probability, statistics, or calculus, which have no verification layer yet
and are explicitly deferred (see the plan's "explicitly deferred" section and
`scripts/math-benchmark.mjs`'s header comment).

## `MathReasoningStep` (`lib/math/types.ts`)

```ts
{
  stepId: string;
  operation: string;        // "add" | "subtract" | "multiply" | "divide" for verified steps
  value?: string | number;  // the operand only — "4" for "subtract four", never the whole equation
  from: string;              // "both sides" is the only value this milestone verifies
  reason: string;             // why — required, not decorative
  before: string;             // the literal expression this step started from
  result: string;              // the claimed outcome
  verified: boolean;            // set by lib/math/verify.ts, never trusted from the model
  verificationDetail?: string;
  commonMistake?: string;
  connection?: string;          // how it relates to the previous step
}
```

This differs slightly from the brief's illustrative JSON (which nests steps
inside a `MathReasoningState` with a shared `current_expression`) — here,
`before`/`result` are carried on every step instead, because each step is its
own `Concept` on the board (see `docs/event-schema.md`) and needs to be
verifiable independent of replay order.

## Verification (`lib/math/verify.ts`)

No LLM involved. Exact rational arithmetic (`lib/math/fraction.ts` — a
reduced-fraction type, never floating point) and a small linear-expression
parser (`lib/math/parse.ts`, deliberately scoped: one variable, integer or
fractional coefficients — not a CAS).

- `verifyLinearStep(before, operation, value, after)` — recomputes what
  applying `operation`/`value` to both sides of `before` actually produces,
  and compares it **structurally** to `after` (coefficient and constant
  equal on each side, allowing sides to be swapped — "6 = 2x" and "2x = 6"
  verify as the same equation). A mismatch returns the correct `expected`
  value alongside `verified: false`, so the caller can show *what it should
  be*, not just that it's wrong.
- `verifyFraction(operation, a, b, claimed)` — add/subtract/multiply/divide/
  simplify, exact.
- `verifyArithmetic(expr, claimed)` — a small recursive-descent evaluator
  (`lib/math/arithmetic.ts`) over `+ - * / ()` with exact fractions.
- `verifySlopeIntercept(points, claimedSlope, claimedIntercept)` — requires
  every given point to be exactly collinear (catches a "roughly fits" line,
  which is exactly the confident-but-wrong case this layer exists to catch)
  and rejects vertical lines rather than silently computing an undefined
  slope.

**On failure, nothing is confidently committed.** `Board.tsx`'s
`transform_equation` case still creates the step (so the board doesn't
stall waiting for a perfect answer), but `buildMathStepBox` renders it with
a dashed amber outline instead of solid blue, and the concept's
`mathMeaning.verified` is `false` with `verificationDetail` explaining why.

## Grounding the starting equation (`lib/math/ground.ts`)

`verifyLinearStep`/`verifyTransformStep` check that a step follows correctly
from what's already on the board — but `create_equation` has no prior board
state to check against; it's the axiom a session's whole reasoning chain
gets built on, not a derived claim. Caught live: a spoken "three x plus five
equals twenty" came back from the model as the expression `"5 = 20"` — the
`"3x +"` term silently vanished, and nothing downstream noticed, because
verification only ever ran on steps built on TOP of the starting equation.

`groundEquationInSource(expression, sourceText)` closes that gap the same
way `groundedInSource` (`lib/vocab.ts`) already guards Scribe marks against
hallucinated text: it checks the claimed expression's literal numbers and
variable actually appear in the transcript it was extracted from. Two
directions matter, and only one is the obvious one:

- **Fabrication**: a number or variable in the expression that was never
  said (e.g. claiming `"3x + 7 = 20"` when the speaker said "three x plus
  *five* equals twenty") — the equation says more than the speaker did.
- **Silent drop**: a variable the speaker named (e.g. "x") that doesn't
  appear in the expression at all — the equation says *less* than the
  speaker did. This is the one the live bug actually was, and it's the
  harder direction to catch: a strict subset like `"5 = 20"` passes a
  naive "do the expression's numbers appear in the transcript" check with
  flying colors, because 5 and 20 genuinely were said — the omission of the
  `"3x"` term leaves nothing in the expression to flag as extra.

`create_equation` in `Board.tsx` uses this the same way `transform_equation`
uses `verifyTransformStep`: an ungrounded equation still gets drawn (so a
false-negative doesn't stall the board), but with the dashed amber outline
and `mathMeaning.verified: false`, not confidently as fact.

## Deterministic visuals (`lib/math/visuals.ts`)

The model chooses **which** visual and supplies **only symbolic values**
(counts, coordinates, slope/intercept) — never pixel coordinates. The
renderer computes exact geometry. Shipped this milestone:

- `number_line` — ticks, labelled, with point markers.
- `balance_model` — an equation as counted groups on a beam (the brief's own
  worked example: "two groups of x, four units, balanced against ten
  units").
- `fraction_bar` — a segmented, partially-shaded bar; two bars for showing an
  operation between fractions.
- `counters` — grouped dot arrays, for multiplication/word-problem
  reasoning.
- `coordinate_axes` — axes scaled to a given range, plotted points, and a
  line computed from slope/intercept.
- `table` — headers + rows.

Deferred: vectors, angles, a full geometric shape library, area-model
shading nuance — see the plan's "explicitly deferred" section.

## Explanatory depth

Default is one clipped `reason` per step. `add_math_explanation` goes deeper
on the CURRENT step when the speaker asks "why" / "what does this mean" /
"another way" — detected by a cue-phrase regex in `Board.tsx`'s `runBeat`
(the same style as `lib/reference.ts`'s existing back-reference cues, not a
new NLU system), passed to `/api/math` as `depth: "deep"`.
