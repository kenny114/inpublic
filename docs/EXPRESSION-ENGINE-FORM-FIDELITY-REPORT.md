# Expression Engine — Track A: form fidelity

**Track chosen:** A (more form fidelity). No plumbing, no new engine, no
keyterm→shape, no second graph schema. Geometry stays deterministic from
scene objects; every connector still names the world relation it is
accountable to.

## What changed

### 1. causal_chain — the spine reads as the spine

`layoutFlow` (`lib/expression/compose/compose.ts`) placed the spine in a
column and then handed everything else to `layoutStragglers`, which parked
the branches in a leftover column to the right. A causal explanation is a
graph — the grammar already keeps the arms that hang off the spine without
lying on it — but the picture turned those arms into a second unlabelled
stack competing with the story for the same reading. Nothing said which step
a branch belonged to.

A branch is now placed on the **row of the step it is actually connected
to**, alternating right then left so a step with two conditions gets one on
each side. Clear of the spine column by construction: the nearest edge of a
branch sits a full gap beyond the widest step. A branch connected to no step
still falls through to `layoutStragglers`, unchanged.

### 2. Emphasis is actually visible

`WEIGHT_SCALE` weight 3 went 1.25 → 1.4 (weight 2: 1.1 → 1.15). At 1.25 the
thing that had just been said sat inside the ordinary variation between a
short label and a long one.

The Excalidraw renderer gave weight 3 the same stroke and font as weight 2
(`strokeWidth: 2`, `fontSize: 20`), so on the live board what just happened
looked exactly like what had been on the canvas for ten minutes. Now
`strokeWidth: 4` / `fontSize: 24` — which is what the SVG renderer had
always done (`STROKE_FOR_WEIGHT` tops out at 3). The two renderers agree
again. Size stays paired with stroke because size is comparative and stroke
is absolute.

### 3. comparison — dimensions on a shared row grid

Two bugs, one of them silently destroying the whole layout:

- `layoutPoles` handed `layoutStragglers` only the **columns**, not their
  dimensions. Because the dimensions are un-parented (stacked beneath a
  pole, not enclosed in it), the straggler pass saw them as unplaced and
  immediately re-parked the entire grid into one column off to the side.
  Every carefully-placed dimension was overwritten a line later.
- Each column started its stack at its **own** height, so a taller pole
  pushed its dimensions down and the two columns ran out of step from the
  first row.

Both fixed. Every column now starts beneath the tallest pole on a shared row
grid whose row height is the tallest cell in that row, and a dimension the
speaker actually compared against one already seated **takes that
dimension's row** — the rest fill the gaps in order. This is not only
tidier: `evaluate.ts` reads two siblings on the same row as a `parallel`,
which is exactly the reading a comparative relation needs and exactly what
drifting columns denied it.

One grammar change followed. A dimension-level comparison that lifts onto
the poles ("Plan A's cost vs Plan B") was dropped wholesale as a
restatement. It is a restatement only when it says nothing the pole
comparison does not — and a **magnitude** ("twice as quickly") or a
**polarity** ("costs more") is precisely what an arrangement cannot carry.
Dropped wholesale, "Plan A costs more but finishes twice as quickly as Plan
B" produced two columns that said the plans were being compared and could
not say which was faster. Those are now drawn, with their own labels, on
their own ends.

### 4. tension — a contrast gets its own mark

New `ConnectorStyle` `"tension"`: a symmetric zigzag between two things the
speaker set against each other. `contrasts_with` had no magnitude to
bracket, so it resolved to style `"none"` and leaned entirely on the poles
happening to sit in a row — true in the comparison layout, false the moment
the same contrast appears inside a scene, so the claim survived or vanished
depending on which grammar had been chosen. An arrow is not available to it:
a contrast has no direction.

`evaluate.ts` reads a tension mark as **both** `parallel` and `undirected`
(a visible mark is at minimum a connection; a symmetric one that favours
neither end is two things set against each other) and deliberately **never**
as `directed`. Both renderers draw it: SVG as a path through every routed
point, Excalidraw as a 5-point `line`.

### hierarchy — a claim is not a container

The hierarchy grammar builds two different things: containment, and a claim
backed by two or more `supports`. Enclosure is right for only one of them. A
department is inside a company; a reason is not inside the claim it backs —
it stands under it holding it up, and enclosing it says the argument is a
part of its own conclusion.

`isSupportHierarchy` decides from the world's relations (no new region role,
no schema change): if any child is structurally contained the root stays
enclosure, since containment is the stronger claim to get right. Otherwise
`packBelow` draws a tree — claim on top, reasons in a row beneath, root
centred over them, children un-parented so the geometry never claims an
enclosure the layout did not draw. The `supports` connectors become real
lines, recovered as `undirected`, which argumentative relations accept.

## Tests

`scripts/expression-test.mjs`: **1031 → 1061 checks, 0 failed.** 30 new
checks in a new `form fidelity: the arrangement has to argue the idea`
section — causal branch on its step's row and clear of the spine, support
tree vs enclosure (including "invents no containment"), comparison row grid
(paired dimensions share a row, unmatched takes its own, each stays in its
pole's column), tension mark (style, 5 points, symmetry, both readings, both
renderers), and emphasis (weight 3 larger + heavier stroke than weight 2).

Corpus, 122 cases: mean preservation **0.999 → 1.000**, perfect cases
**121 → 122**, comparison category **0.986 → 1.000**. Grammar distribution
unchanged.

Also green: `expression-evaluator-test` (33), `expression-discover` (51/51),
`expression-plan-reason-bound-test` (4), `expression-intent-fallback-test`
(7), `expression-idle-gap-test` (9), and the full `npm test`. `tsc --noEmit`
clean.

## Live probe

`inpublic.speak()` on `/try?v2=1&xe=1` against the real extractor (dev
server; the Board was reached past the mic gate with a silent
`getUserMedia` stream — `speak` does not touch STT).

**Probe 1 — causal branch + emphasis**

> "When demand rises prices go up, and higher prices push inflation, but
> more supply holds prices down."

`explain_causality` → `cause_effect`, reason `causal spine: demand ->
prices -> inflation; branches: supply`.

| object | x | y | size | weight |
|---|---|---|---|---|
| demand | 48 | 48 | 280x101 | 3 |
| prices | 48 | 237 | 280x101 | 3 |
| inflation | 48 | 426 | 280x101 | 3 |
| supply | 400 | 255 | 180x65 | 0 |

The spine is one column (all `x = 48`); the branch sits at `x = 400`, clear
of the spine's right edge at 328, and its centre (287.5) is exactly the
centre of the step it acts on (287.5). Connectors: `arrow`, `arrow`,
`arrow` labelled `prevents`.

**Probe 2 — tension, same session**

> "Moving fast is in tension with staying safe."

Relation `moving-fast -contrasts_with-> staying-safe`. Connector kinds on
the scene: `arrow`, `arrow`, `arrow` (`prevents`), **`tension` with 5
points**. The two new objects are weight 3 at 235x112 against the previous
round's now-weight-1 spine at 200x72 — emphasis visibly moved to what was
just said. On the real Excalidraw board the element
`k-c-moving-fast-contrasts_with-staying-safe` is present as a 5-point
`line`; this probe also demonstrates the point behind the change, since the
contrast was drawn under `cause_effect`, not under the comparison layout.

## Not touched

Phase 0 log events, the MeaningDelta schema, keyterm drawing, HF/STT, the
identity and target-resolution layers, `writeLive` vs `syncExpressionCanvas`
region ownership. No free-form model→shapes anywhere: the tension mark is
routed by the composer's own arithmetic like every other connector.
