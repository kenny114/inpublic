# The expression error loop

How a bad visualization gets found, attributed to a layer, fixed generically,
and prevented from coming back. This documents the loop that exists, not a
process we intend to follow.

```text
input → pipeline → visual → evaluation → attribution → generic fix → regression test → full replay
```

## Running it

```bash
npm test
```

```bash
node --no-warnings --import ./scripts/ts-register.mjs scripts/expression-discover.mjs --verbose
```

| Command | Asks |
|---|---|
| `scripts/expression-discover.mjs` | does meaning survive, and if not, **which layer broke it**? |
| `scripts/expression-evaluator-test.mjs` | would the evaluator **notice** if it didn't? |
| `scripts/expression-test.mjs` | 119-case corpus + every layer's unit behaviour |

All three are in `npm test`. `--only=<text>` narrows the discovery run to one
scenario; `--verbose` prints the full stage-by-stage trace for each failure.

In the browser (`?v2=1&xe=1`, dev only):

```js
inpublic.speak("Heavy rain flooded the road, which caused traffic.")
inpublic.trace()      // the last run, stage by stage
inpublic.traces()     // every run this session
```

## The trace

Every run preserves every stage, and `lib/expression/trace.ts` renders them in
pipeline order — the console API and the offline runner print the same view, so
a failure seen live and a failure seen in CI read identically:

```text
INPUT · MEANING · WORLD ← · WORLD → · CHANGED · INTENT · PLAN · SCENE · CANVAS · EVALUATION · PROBLEMS · REPAIR
```

`WORLD ←` and `WORLD →` are the before and after, because half of every "what
changed" question is what was there already.

## Attribution

`lib/expression/evaluate/attribute.ts` walks the stages **in order** and stops
at the first one that already fails. Everything after that is downstream damage
and is deliberately not reported — one cause per failure, or the report becomes
noise nobody reads.

```text
MEANING_EXTRACTION → ENTITY_IDENTITY → REFERENCE_RESOLUTION → WORLD_UPDATE →
INTENT_SELECTION → GRAMMAR_SELECTION → EXPRESSION_PLANNING → COMPOSITION →
RENDERING → SEMANTIC_EVALUATION → VISUAL_CLUTTER → CONTINUITY
```

This is what stops symptom-patching. "Traffic" appearing twice on the canvas
looks like a composition bug and is an identity bug four layers up; a five-box
hierarchy for a causal chain looks like a drawing problem and is a grammar
choice. Expectations are written in meaning ("Mariam must be recoverable as
Kenny's mother"), never in geometry — pinning coordinates would freeze the
layout and stop it improving.

## The corpus

17 scenarios across 15 categories, each in **two forms**: one paragraph, and
the same content as several settled speech segments. Both must satisfy the same
expectations, and their final worlds must converge.

That pairing is the point. Live speech never arrives as a paragraph, and the
very first bug this corpus found was one that passed in multi-turn form and
failed in single-utterance form — correct in the test that is easy to write,
wrong in the mode that ships.

## Round-trip evaluation

`semanticPreservation` is no longer one opaque number. Seven dimensions are
measured separately, each with the reasons behind it, because they fail for
different reasons and are repaired at different layers:

| Dimension | Question | Owned by |
|---|---|---|
| entity | did the things discussed reach the canvas? | planner |
| relation | is the link recoverable from the arrangement? | planner |
| causal | is **direction** recoverable, not just connection? | planner |
| quantity | is a stated number drawn as extent? | primitives |
| ordering | does visual order match described order? | composer |
| polarity | can "prevents" still be told from "causes"? | renderer |
| uncertainty | is hedged meaning still marked as hedged? | *unrepresented — see below* |

A dimension with nothing to measure scores `null`, never 1.0: an utterance with
no numbers has not preserved quantity perfectly, it has nothing to say about it.

The headline is the **mean of the applicable dimensions**, so it is a summary of
the breakdown rather than a rival to it and cannot disagree with the problem
list sitting beside it.

## What the loop found

Eight defects, each fixed at the layer that caused it. Every one has a
regression test; none is a special case for a corpus sentence.

| # | Layer | Defect | Generic fix |
|---|---|---|---|
| 1 | REFERENCE_RESOLUTION | "She is a teacher" attached to Kenny, not Mariam — salience put the paragraph's *topic* ahead of the nearest antecedent | salience orders by recency of mention first, topic second |
| 2 | WORLD_UPDATE | "John is Sarah's brother… actually, her cousin" asserted **both** | relation types that are single-valued per pair replace; contradictory types retire each other |
| 3 | EXPRESSION_PLANNING | a branching explanation lost an arm — `cause_effect` drew only the longest path | an explanation is a causal **graph**; branches adjacent to the spine are drawn too |
| 4 | EXPRESSION_PLANNING | the argument's subject was dropped — comparison drew the two numbers and not what they were about | the planner fills the display budget with what the speaker connected, seeding disconnected components |
| 5 | SEMANTIC_EVALUATION | **losing content raised the score** — dropping an entity removed its relations from the denominator | headline is the mean of the dimensions |
| 6 | INTENT_SELECTION | an argument *about* a comparison was classified as a comparison | taking a position outranks noting a difference |
| 7 | *primitives* | "six chairs" lost its six — extent was decided per entity type | a stated count is extent, whatever was counted |
| 8 | COMPOSITION | the bird was drawn **above** the tree it was described as beneath | the layout may not contradict a stated spatial relation, in any grammar |

Numbers 5 and 6 are worth singling out. Number 5 was found by the corpus and
means every score before it was optimistic. Number 8 scored *perfectly* on every
relation it drew while asserting something the speaker never said — only the
`ordering`/spatial reading could see it.

## Evaluator regressions

`scripts/expression-evaluator-test.mjs` is separate from the renderer suites
because it asks the opposite question. It hands the evaluator scenes broken **on
purpose** and asserts the specific loss is reported:

- a causal chain drawn one link short → `missing_relation`, causal exactly 0.5
- two people adjacent with no connector → `ambiguous_relation` naming the role
- an unlabelled line between them → still ambiguous; repair proposes labelling it
- a trade-off with only the upside drawn → entity loss naming the missing half
- a negation drawn as a bare arrow → polarity 0, "reads as its own opposite"
- a sequence stacked backwards → ordering 0 **while relation stays 1.0**
- accidental enclosure → `false_relation`, penalised harder than omission

Each also asserts the correct version is **not** flagged. An evaluator that
fires on good output is as useless as one that never fires.

## Known gaps

- **Uncertainty has no visual form.** `ScenePlan` cannot say "this is hedged",
  so the dimension scores presence only. It is measured rather than hidden, and
  it will read as a loss until a primitive exists for it.
- **`MEANING_EXTRACTION` is unreachable offline.** The corpus supplies deltas as
  fixtures, so extraction cannot fail by construction there. It is exercised
  against a real model by `scripts/expression-live.mjs`.
- **Visual quality is not in scope here.** This phase asked whether meaning
  survives and whether failures are attributable. Composition quality,
  expressive range and visual richness are the next phase.
