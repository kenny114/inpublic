# Expression Engine V1 — meaning → visual expression

This is the implementation that exists, not a future sketch. It lives in
`lib/expression/` and is wired into the live speech path behind a flag that is
off by default (`features.expressionEngineV1`).

## Why a new engine and not a rewrite of `lib/meaning/`

`lib/meaning/` already got several important things right and they were
carried forward rather than rediscovered: the model never emits geometry,
the visual planner is deterministic, layout is a pure function, the canvas
is patched rather than wiped, and non-structural meaning is kept as claims
instead of being forced into fake edges.

What it could not do was represent ordinary speech about the world. Its
relation vocabulary is discourse-shaped — `causes`, `supports`, `contains`,
`contrasts`, `related_to` — and its concepts are untyped. "I'm from Trinidad
and Tobago", "I have a family of five" and "my mother's name is Mariam" all
collapse into `related_to` between two unlabelled boxes, and with no entity
types there is nothing to resolve a visual primitive from. Three further
layers named in the brief had no home at all: communicative intent, a
renderer abstraction, and evaluation/repair.

Those are schema-level problems, so they were fixed at the schema.
`lib/meaning/` is untouched and remains the default live engine; the two are
mutually exclusive at the flag resolver.

## The layers

| Layer | Module | Decided by |
|---|---|---|
| Input | `pipeline.ts` (`segmentText`, `InputSegment`) | — |
| Meaning | `meaning/extract.ts` | **model** (the only one) |
| World | `world/apply.ts` | deterministic |
| Intent | `intent/classify.ts` | deterministic |
| Expression | `planner/plan.ts` + `grammars/` | deterministic |
| Primitives | `primitives/resolve.ts` | deterministic |
| Scene | `compose/compose.ts` | deterministic |
| Render | `render/svg.ts`, `render/excalidraw.ts` | deterministic |
| Evaluate | `evaluate/evaluate.ts` | deterministic |
| Repair | `evaluate/repair.ts` | deterministic |

One model call, at one layer, answering one question: what does this
sentence mean? Everything else is TypeScript that can be tested without a
network.

**No geometry above `ScenePlan`.** Not by convention — `MeaningDelta`,
`WorldState`, `ExpressionIntent` and `ExpressionPlan` are `.strict()` Zod
schemas with no field a coordinate could occupy, so a model that tried to
emit one would fail validation.

## What each layer contributes

**Meaning.** `MeaningDelta` types every entity (`person`, `group`, `place`,
`object`, `concept`, `action`, `event`, `state`, `time`, `quantity`) and
carries a world-shaped relation vocabulary of 22 types grouped into eight
families. `role_of` plus an open `role` string covers kinship, employment
and office generically, instead of one enum member per human relationship.

**World.** Identity, reference resolution and lifecycle are deterministic
and live here, not in the prompt. Pronouns resolve against a salience stack;
definite anaphora resolves head-finally ("that team" → "the data team");
proper names subsume ("Mariam" → "Mariam Farmer"); retractions supersede
rather than delete. Importance is recomputed from the whole graph every
round, so a thing mentioned once in passing becomes primary when the
conversation turns out to be about it.

**Intent.** Reads structure, never words. "Because" and "so" are discourse
markers people scatter through speech; a causal relation in the world is
evidence, the word is not. Scored rather than cascaded, so one stray edge
cannot hijack an utterance, and non-dominant intents survive as `secondary`.

**Grammar and planner.** Ten grammars. Each says which entities become
regions and which relations survive as visible connections; none returns
coordinates. Every connection names the world relation it is accountable to,
which is what makes the false-relation check possible at all. The fallback
chain always ends at `relationship`, so the planner never has to invent
structure to fill a gap.

**Primitives.** Chosen from the entity's semantic type and never from its
wording. A `concept` gets a plain labelled node — when the meaning layer
could not say what kind of thing something is, the honest visual is a node,
not a guessed icon. That is the single line between this and keyword
illustration, and it is enforced by `resolvePrimitive` never seeing a label.

**Composer.** Five layout routines selected by grammar, plus emphasis
scaling, overlap separation and edge-to-edge connector routing. Connector
style is semantic: a flow gets an arrow; a containment already drawn as
enclosure gets *nothing*, because the enclosure has said it; a comparison
gets nothing unless a magnitude was stated.

**Evaluation.** Reverse interpretation. The scene is read back as raw
geometry and marks — arrows mean direction, a box inside a box means
containment, two equal things side by side mean comparison — producing the
relation set a stranger could reconstruct with no transcript. Only then is
it compared to the world. It reads `connector.style`, not the plan's
intent, so a connector resolved to invisible earns no credit.

Missing and invented structure are priced differently, because they are not
symmetrical failures: a missing relation means the viewer learns less; an
invented one means the viewer learns something false.

## Results

`npm test` includes the offline suite (`scripts/expression-test.mjs`): **966
checks over 119 corpus cases in 16 categories, mean semantic preservation
1.000, no invented relations, no overlaps.** The corpus fixes the extractor
with fixtures so the other nine layers are asserted exactly, with no API key.

Read that number correctly: it says the deterministic layers express what
they are given without losing or inventing relations. It says nothing about
extraction quality, which is measured separately and against a real model by
`scripts/expression-live.mjs`.

The evaluator has teeth, and the negative tests prove it: deleting an arrow
drops the score and reports the missing relation; an accidental enclosure is
caught as a false relation and penalised; omitting the primary subject costs
0.3 even when every drawn relation is readable.

## Found by running it live

Two defects the corpus could not have caught, both now fixed with regression
tests:

1. **A score that disagreed with its own problem list.** A scene drew a stale
   sequence perfectly while omitting the subject the conversation had moved
   on to, and scored 1.0 next to a severity-0.9 `missing_entity`. Preservation
   now prices missing subjects.
2. **`Priya precedes joining precedes last month`,** extracted from "Priya
   joined last month" — a nonsense chain that pinned the intent classifier to
   `show_sequence` for the rest of the conversation. `precedes` is a claim
   about time, so both ends must be something that can happen; the prompt
   discourages it and `sanitizeDelta` enforces it. A type rule that can be
   checked is never left to a prompt.

## Running it

```bash
npm test
```

```bash
node --no-warnings --import ./scripts/ts-register.mjs scripts/expression-test.mjs
```

Live, against a real model (costs money):

```bash
node --no-warnings --import ./scripts/ts-register.mjs scripts/expression-live.mjs
```

The text-first lab is at `/dev/express` — a textarea, a Visualize button, the
canvas, and a debug panel with one tab per layer. It processes input one
sentence at a time so the incremental behaviour is exercised by default
rather than being a mode nobody runs. No microphone, no streaming, no camera:
latency and transcription are separate problems, and the only question this
surface asks is whether InPublic can understand arbitrary meaning and express
it visually.

The lab has no listening session to lease, so `/api/express` opts into the
existing server-validated local-dev capability
(`lib/server/developmentReplayAuthorization.ts`). That is not a bypass — the
grant always fails outside `NODE_ENV=development`, so in production the route
requires a real session exactly like every other model-calling route.

## Verified live

`My name is Kenny Farmer. / I'm from Trinidad and Tobago. / I have a family
of five. / My mother's name is Mariam.` — through the real extractor:

- one Kenny across four sentences, not four
- `intent: introduce`, `grammar: scene`, Kenny at the centre
- the family drawn as **five figures inside one boundary** — no numeral
- Trinidad and Tobago as a place marker, not a flag icon
- the mother relation labelled, because a role cannot be read from position
- Mariam emphasised at weight 3 as the thing that just arrived
- preservation 1.0, nothing invented, five text nodes on the whole canvas

## Live speech

Wired, behind `features.expressionEngineV1` (dev override `?xe=1`). Off by
default: with the flag off no controller is created, no model is called and no
canvas write happens — verified in the browser, not just by reading the branch.

```text
Deepgram → Live Presentation V2 settled thought
  → ExpressionLiveController   debounce, coalesce, serialise   lib/expression/live.ts
  → ExpressionSession.ingest   the pipeline above
  → syncExpressionCanvas       reconcile the region on the sheet
  → recordOperation / commit / camera / fade consumed transcript
```

Only three things had to be added, because the pipeline was already
source-agnostic:

**Cadence** (`lib/expression/live.ts`). `ExpressionSession` processes one
segment and returns, which is right for a text box and wrong for a microphone.
The controller debounces bursts into one run, keeps at most one run in flight
(the world model is a sequence of folds; two folds racing would silently lose
one), and reports `consumedIds` only for runs that actually changed something,
so transcript ink is never faded for meaning that was never represented.

**Canvas reconciliation** (`lib/expression/render/excalidrawSync.ts`). Reserves
a region, owns only the elements inside it, turns the page on overflow — the
board's conventions, matching `syncMeaningCanvas`. What the ScenePlan layer
buys: geometry arrives already decided and conversion is idempotent, so
reconciliation is a signature diff and an unchanged element is not touched at
all. The reconciliation decision is a pure function (`planCanvasDiff`) so it is
testable without a browser.

**Mutual exclusion.** The Meaning Engine and this one consume the same settled
thoughts and draw on the same sheet, so `isMeaningEngineV1Enabled()` returns
false whenever the Expression Engine is on. Enforced in the resolver and
covered by tests, not left to whoever flips the flags.

### Two bugs this found

Both were caught by driving real speech through the real board, and both now
have regression tests:

1. **Excalidraw does not keep the ids you give it.** `convertToExcalidrawElements`
   rebuilds elements internally and emits its own ids — `lib/ops.ts` already
   documents this and works around it by reading back whichever id it got. The
   whole "patch, never wipe" design depends on ids being ours, so they are now
   re-applied after conversion (`applyStableIds`), which is sound only because
   every skeleton maps to exactly one element. It returns null rather than
   guess if that ever stops holding. Arrows are deliberately left unbound: a
   binding buys re-routing on manual drag and costs id control, and this region
   is re-laid-out on the next sentence anyway.
2. **The same thing typed differently forked the world.** "Traffic" came back
   as a `state` in one sentence and an `event` in the next, so a second entity
   was minted and the causal chain split in half — the picture showed only the
   longer piece. Entity type compatibility is now by family rather than exact
   equality. A `place` and a `person` sharing a name still stay distinct.

Verified live, two utterances, from a clean board:

- `Heavy rain flooded the road, which caused traffic.` → 8 elements
- `The traffic made everyone late for work.` → **all 8 survived by id**, 3
  added (the new node, its label, the new arrow), spine grew to
  `heavy-rain → road-flooding → traffic → lateness-for-work`, preservation 1.0,
  no problems

### Driving it without a microphone

`inpublic.speak(...)` in the devtools console (dev only, needs `?v2=1&xe=1`)
feeds settled thoughts through the real controller, debounce and canvas sync:

```js
inpublic.speak(["My name is Kenny Farmer.", "I'm from Trinidad and Tobago."])
```

Every run is also left on `window.__expression` / `window.__expressionHistory`.
Add `&debug=1` to run the whole pipeline and log every stage without drawing.

## Not built yet

- **Agent input.** The seam exists and is used: `ingestDelta` feeds meaning in
  directly, skipping extraction, which is what an AI submitting meaning would
  do. It has no route yet.
- **Camera framing.** New ink pulls the camera via the existing reveal path,
  but the composer's `focusObjectId` is still unused — the camera frames the
  bounding box of what was added rather than what the plan considers the focus.
- **Wordless signs.** The Meaning Engine can draw glyphs instead of labelled
  boxes (`features.wordlessVisualsV1`); this engine's primitives are drawn from
  entity type, but concepts still reach the canvas as text.
- **Repair breadth.** Five of nine repair actions do real work; the rest are
  correctly no-ops (the composer already separates overlaps, the resolver
  already draws counts as extent), and a repair is kept only when it scores
  better, so the layer is safe to be wrong.
