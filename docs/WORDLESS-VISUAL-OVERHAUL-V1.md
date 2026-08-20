# Wordless Visuals V1 — audit, architecture, and path

The product direction: **anything spoken should be expressed visually, not
written as words.** Speech → meaning → visual expression, with text as an
internal artifact only.

This document audits what the codebase does today against that goal, states
the architecture, defines the visual-semantics system, and gives the phased
path. It is written against the code as it exists, not against a plan.

---

## 1. Audit

### The finding that changes the plan

**The `speech → meaning → visual` pipeline already exists and is already
model-driven and text-free by design.** `lib/meaning/` (Meaning Engine V1)
takes settled thoughts, builds a persistent `SemanticState` of concepts /
relationships / claims that carries no coordinates and no rendering decisions,
and `lib/meaning/plan.ts` deterministically chooses a visual family from it.
`docs/MEANING-VISUAL-PIPELINE.md` describes exactly the layering the brief
asks for.

So this is **not** a from-scratch rebuild. The gap is narrower and sharper
than "the architecture is wrong":

1. The meaning pipeline is **off in production** (`features.meaningEngineV1:
   false`), so what a user actually sees today is the older text-first path.
2. Where the meaning pipeline *does* draw, it draws **labelled boxes** — the
   concept's English label goes onto the canvas.

Point 2 is the real overhaul. Point 1 is a rollout decision.

### Where text is the primary output today

| Site | What it does | Verdict |
|---|---|---|
| `lib/ops.ts` `buildLiveLine` + `Board.tsx` `writeLive` | The live utterance lettered onto the sheet, patched ~5×/sec | **The caption surface.** Structurally text-first: no model, words straight to canvas. Phase out last — it is the only fallback when the sign vocabulary misses. |
| `lib/ops.ts` `buildConceptNode` | Rectangle whose entire purpose is to hold a bound label | **Replaced.** Strip the label and only an empty box remains. |
| `lib/meaning/display.ts` `displayConceptLabel` | Compresses a semantic label to ≤4 words / 26 chars so it fits a box | **A symptom.** Its existence encodes "labels go on the canvas". |
| `lib/ops.ts` `applyOp` (`title` / `heading` / `word` / `note` / `bullet` / `box` / `link` label) | The Scribe's sketchnote lettering | **Text-first by construction.** Whole-op-vocabulary retirement, not a tweak. |
| `lib/visualReentry/render.ts` (3 text sites) | Titles/labels on re-entry visuals | Superseded path, flag already off. |
| `lib/math/visuals.ts` (13 text sites) | Numerals and operators in math visuals | **Legitimately keep.** A numeral is a symbol, not a caption; "=" is not prose. |
| `lib/storyPrimitives.ts` | Story Mode captions | Story Mode already off. |

### Where the architecture assumes words

- `buildConceptNode`'s contract is `(nodeId, label, kind, pen)` — a label is a
  required argument. Anything built on it inherits the assumption.
- `MeaningIdentity.signatureByConceptId` keys on `${label}|${importance}`:
  identity change detection is defined in terms of the drawn text.
- `MeaningIdentity.titleIdByConceptId` exists solely to track an enclosure's
  title text.
- Arrow labels: `buildBoundArrow(id, from, to, label, …)`. `apply.ts` already
  passes `""` — a prior, correct step in this direction.
- Excalidraw itself binds arrows only to *bindable* element types. A bare set
  of strokes cannot be an arrow endpoint. Any wordless node still needs a
  bindable anchor — this is a real constraint, not an assumption to remove.

### Where "wait for a full thought" blocks live expression

Live Presentation V2 turns provider **finals** into settled thoughts, and the
Meaning Engine consumes settled thoughts. Interims reach only `writeLive` —
the caption path. So today the split is precisely backwards from the brief:

> **words are live; visuals wait.**

Inverting that is Phase 3 below, and it is the single highest-value change
after the vocabulary itself: tentative signs on interims, sharpened on finals.

---

## 2. Architecture

Layers, with the module that owns each. Bold is new in this overhaul.

```
Microphone → Deepgram (interims + finals)          lib/liveSpeech.ts
    ↓
Streaming meaning                                  lib/meaning/decideCore.ts
  stage 1 extract LocalMeaning (no graph bias)     lib/meaning/engine.ts
  stage 2 reconcile into SemanticState             lib/meaning/reconcile.ts
    ↓                                              — no coordinates, no glyphs
Visual semantics          **lib/meaning/lexicon.ts**
  Concept  → VisualSign (glyph + modifiers)        — deterministic, no model
  Relation → RelationForm (arrow/nest/adjacent/…)
    ↓
Composition               lib/meaning/plan.ts + layout.ts
  family, display budget, geometry
    ↓
Render                    **lib/meaning/sign.ts** + lib/meaning/apply.ts
  signSkeleton → Excalidraw elements, zero text
```

**The English stops at the lexicon.** `SemanticState` keeps full labels
forever — they are what lets "it" resolve to the same concept two sentences
later, and what makes the state inspectable in logs. They simply never reach
a renderer.

### Model-call budget and latency

Unchanged, deliberately. The lexicon and the sign renderer are **pure and
synchronous**: no network, no model, no added latency. A sign is chosen every
time a concept is added *or moved*, which is far more often than meaning is
re-decided — a round trip here would put one on every frame of the drawing.
Model calls stay where they are: one two-stage meaning decision per settled
thought, debounced and coalesced by `MeaningEngineController`.

### Avoiding visual thrashing

Three mechanisms, all now in place:

- **Signature-based diffing.** `apply.ts` rebuilds a node only when its sign
  *or* its geometry changed. Unchanged signs are left alone.
- **Centre-anchored position comparison.** A sign's anchor sits at the centre
  of its layout box, not its origin, so the change check compares against
  where this renderer would actually put it — otherwise every sync would see a
  phantom move and rebuild the whole diagram.
- **Deterministic ink.** The "cluttered" scrawl uses a seeded hash, not
  `Math.random`, so re-rendering an unchanged sign produces byte-identical
  output. Asserted in `scripts/meaning-lexicon-test.mjs`.

### Revision and retraction

Already supported and now visually expressible:

- `ConceptStatus: "superseded"` — the speaker revised themselves.
- `confidence: "low"` → `tentative` → drawn thin and dashed. The system shows
  it is still deciding *without a word saying so*.
- Negation → the sign is struck through, not deleted. The speaker said it; a
  viewer already saw it; cancelling it is itself the meaning.

### Fallback

The failure mode that matters is "the lexicon does not recognise this." The
answer is never text. An unmatched concept becomes `mass` — a neutral
unresolved form — which honestly reads as *something is here and its shape is
not settled*, and which the composition layer can sharpen in place later. The
`mass` fallback is asserted in tests so it cannot silently regress to a label.

---

## 3. The visual-semantics system

Named the **visual lexicon**: `lib/meaning/glyphs.ts` (the drawn vocabulary) +
`lib/meaning/lexicon.ts` (the mapping) + `lib/meaning/sign.ts` (the renderer).

### The core design decision: two independent axes

```
glyph      WHAT the thing is        onboarding      → funnel
modifiers  HOW it is going          "too complicated" → cluttered + problem
```

"Onboarding is too complicated" is **not** a 25th glyph. It is `funnel` with
`texture: "cluttered"`, `charge: "problem"`. If the noun table also set the
mood, every noun×condition pairing would need its own entry — the
combinatorial blowup this design exists to avoid.

This was not the first attempt. The initial cut collapsed both axes into one
ordered rule table, and the test suite caught it immediately: "onboarding is
too complicated" produced the `overload` glyph and *lost the onboarding*. The
tables are now genuinely separate — one answers "what", one answers "how", and
every matching modifier applies over whatever glyph won.

### The modifiers

| Axis | Values | Drawn as |
|---|---|---|
| `charge` | problem / solution / neutral | ink colour (crimson / green / black) |
| `texture` | cluttered / normal / clean | added scrawl vs. withheld ink; roughness |
| `motion` | rise / fall / exit / loop / still | a directional cue in the gutter beside the sign |
| `scale` | continuous | size — **emphasis is scale**, from importance × quantity × intensifiers |
| `negated` | bool | struck through |
| `tentative` | bool | thin, dashed |

### The glyphs (24)

`lib/icons.ts` already held *object* pictograms — the things a speaker names
(person, people, money, clock, database, rocket). `glyphs.ts` adds the half
that carries no noun at all:

| Meaning | Glyph |
|---|---|
| cause, reason, source, "because" | `source` — energy radiating from an origin |
| grinding, pain, struggle | `friction` |
| blocked, stuck, bottleneck | `blockage` |
| broken, bug, risk, instability | `crack` |
| complicated, tangled, messy | `tangle` |
| confusion, uncertainty, fog | `fog` |
| growth, increase, better | `rise` |
| decline, drop, worse | `fall` |
| onboarding, journey, process | `funnel` |
| leaving, churn, drop-off | `exit` |
| opportunity, clarity, unlock | `opening` |
| too much, overload | `overload` |
| simple, reduced | `simple` — deliberately the least ink in the set |
| decision, branch | `fork` |
| fix, repair, solution | `repair` |
| cycle, retention, repetition | `loop` |
| goal, aim | `target` |
| realization, breakthrough | `spark` |
| cost, burden, drag | `weight` |
| working, unobstructed | `flow` |
| value, payoff, the win | `value` |
| *unmatched* | `mass` — an unresolved form, never a label |

Authored in the same 0–100 box contract as `lib/icons.ts` (`IconArt`), so one
renderer draws both, and both come out of Excalidraw looking hand-drawn.

### Relations become structure, not always arrows

`formForRelationship` maps each `RelationshipType` to a visual form. Not every
relation is an arrow — nesting, adjacency and a plain tether carry meaning an
arrow would overstate:

| Relation | Form |
|---|---|
| `causes`, `leads_to` | `causal_arrow` |
| `depends_on` | `flow_arrow` |
| `contains`, `part_of` | `nest` — the region *is* the containment |
| `contrasts` | `adjacent` — the two columns *are* the contrast |
| `supports`, `example_of`, `related_to` | `tether` |

### Worked example

> "The reason our users are leaving is because onboarding is too complicated."

| Concept | Sign |
|---|---|
| users | `people`, neutral |
| leaving | `exit`, **problem**, motion `exit` |
| onboarding | `funnel`, **problem**, texture `cluttered` |

plus a `causes` relation → `causal_arrow` from the cluttered funnel to the
exit. A tangled funnel, a crowd peeling out through a doorway, a causal arrow
between them. No sentence, no caption, no label.

---

## 4. Phased path

**Phase 1 — the vocabulary (done, this change).** The lexicon, the glyph set,
the sign renderer, wired into `apply.ts` behind `features.wordlessVisualsV1`
(`?wordless=1` in dev). 296 assertions in
`scripts/meaning-lexicon-test.mjs`, registered in `npm test`. Nothing changes
for any existing user: the flag is off, and it is inert unless the Meaning
Engine is on.

**Phase 2 — validate that it reads.** The one thing that cannot be asserted in
a test file: *does a viewer understand it?* Run `scripts/meaning-gold-replay.mjs`
over the gold corpus with wordless on, capture the canvas, and show it to
someone who did not hear the audio. Ask them to say what the speaker meant.
That is the acceptance test for this whole direction — everything downstream
is wasted if it fails. Expect the answer to be "extend the lexicon", and
budget for that: the glyph table is designed to be appended to.

**Phase 3 — invert the live/settled split (done).** See §6.

**Phase 4 — retire the caption surface.** Only once Phases 2–3 hold. Shrink
`writeLive` to a peripheral confidence strip, then remove it. Keeping it until
then is deliberate: it is the only signal a viewer gets when the vocabulary
misses, and removing it early turns a vocabulary gap into a blank screen.

**Phase 5 — retire the Scribe's lettering ops.** `title` / `heading` / `word`
/ `note` / `bullet` / `box` in `lib/ops.ts`. Largest blast radius, least
urgency, and it should follow real evidence from Phase 2 about what the
lexicon still cannot say.

**Keep throughout:** Deepgram, `SemanticState`'s English labels (internal),
`lib/math/visuals.ts` numerals (a numeral is a symbol, not a caption), and the
existing camera.

---

## 5. Status

Implemented and green (`npm test`):

- `lib/meaning/glyphs.ts` — 24 abstract glyphs
- `lib/meaning/lexicon.ts` — two-axis mapping, relation forms
- `lib/meaning/sign.ts` — `signSkeleton` (pure, testable) + `buildSign`
- `lib/meaning/apply.ts` — `{ wordless: true }`; sign-part lifecycle tracking;
  centre-anchored change detection
- `lib/features.ts` — `wordlessVisualsV1`, `isWordlessVisualsEnabled()`
- `components/Board.tsx` — passes the flag through
- `scripts/meaning-lexicon-test.mjs` — 296 assertions, in `npm test`

The load-bearing assertion, and the whole direction in one line:

> no descriptor produced by `signSkeleton` is `type: "text"`, carries a
> `text` field, or carries a bound `label` — for every sign the lexicon can
> produce, including the fallback.

---

## 6. Phase 3 — the inversion (done)

### What was backwards

Deepgram interims reached only `writeLive`. Every visual system — Meaning
Engine, Visual Re-entry, Beat, Director — consumed *settled* output. So:

> **words were live; pictures lagged.**

Exactly inverted from "the canvas must not wait for a fully completed thought."

### What now happens during speech

`components/Board.tsx` `handleInterim` already computes settled words — the
prefix two consecutive interims agree on, typically 100–300ms behind the mouth
and stable. That signal now drives signs as well as text:

```text
settled interim words
  -> scanUtterance()          lexicon.ts   clause split, same two rule tables
  -> scanProvisional()        reflex.ts    diff against what is drawn
  -> syncProvisionalCanvas()  a reserved band, thin dashed ink
       | (thought settles)
  -> clearProvisional()       every guess retired
  -> the Meaning Engine's confident signs take the region
```

### Sharpening, which is the whole point

Provisional signs are keyed by **clause position, not clause text**. Keying on
text would make every added word a brand-new sign and fill the sheet with the
history of a sentence. Keying on position means a clause that gains words
redraws the same sign in place:

| Spoken so far | Sign |
|---|---|
| "our onboarding" | funnel, calm, neutral |
| "our onboarding is too complicated" | *the same* funnel — now tangled, crimson |
| "…so users are leaving" | funnel unchanged; a second sign: exit, crimson, motion `exit` |

The first sign is never removed and re-added. It sharpens. That is the
difference between a canvas that follows a speaker and one that stutters, and
it is pinned down by assertion in `scripts/meaning-reflex-test.mjs`.

### Silence is still a valid answer

A clause the vocabulary does not recognise draws **nothing** — it does *not*
become a neutral `mass`. `mass` is right for a concept the meaning engine
decided is real but the lexicon cannot picture; it is wrong for a half-spoken
fragment that may not be a concept yet. Filler ("um", "you know", "basically")
is dropped outright. Without this the sheet fills with shrugs in seconds.

### Retraction comes free

If Deepgram walks a clause back, it stops appearing in the scan and the diff
reports it removed. No separate retraction path, and no guess can outlive the
words that produced it. A new utterance retires the previous one's signs; a
page turn retires them rather than migrating them.

### Causal cues split, they do not draw

"because" / "so" / "which is why" are clause boundaries and deliberately do
**not** emit a `source` glyph. Causality has a better visual form than a blob
between two things — an arrow, which is what `formForRelationship` produces
once the meaning engine has decided the relation. A connector glyph here would
put a weaker rendering of the same idea on screen a moment before the right one
arrives. `source` still fires when a speaker *names* the cause ("the root
cause"), which is a concept rather than a connective.

### The V2 invariants

This inverts protected invariants 6 and 7 in
`docs/LIVE-SPEECH-PRESENTATION-V2.md`, and that doc now carries a scope note
saying so rather than being silently contradicted. The short version: those
invariants protect the live *text* line's ownership of the screen, which is
not what wordless mode outputs. **Invariant 1 — no model on the Tier 1 live
path — is fully intact**: the scan is regex and table lookup, no network, no
allocation beyond the diff, which is the only reason it is affordable on every
interim tick. Invariant 9 holds too: with the flag off, none of this runs.

### Cost controls

- Provisional ink is **not** recorded in the undo stack — it is scaffolding
  with a lifetime shorter than a sentence, and burying the user's real history
  under the machine's thinking would be a bad trade.
- The band is capped at `MAX_PROVISIONAL` (5), most-recent-clause-wins. A dozen
  tentative marks is not a mind following along; it is noise.
- Identical re-scans are a no-op, so a speaker pausing mid-sentence does not
  cause the canvas to rewrite itself several times a second.
- The band is a fixed strip, not pen flow: flow placement would advance the pen
  for ink about to be erased, permanently indenting the settled content after it.
- Every draw carries the same stale-epoch guard `writeLive` uses, so a
  clear/undo/page-turn between scan and draw discards the result.

### New in this phase

- `lib/meaning/lexicon.ts` — `scanUtterance()`, clause splitting, filler rejection
- `lib/meaning/reflex.ts` — provisional state, sharpening diff, retraction
- `lib/meaning/provisional.ts` — the band renderer
- `lib/types.ts` — `type: "reflex"` session-log events, logged as glyph names
  rather than transcript (a log full of text could not tell you whether speech
  actually became a picture)
- `components/Board.tsx` — driven from settled interim words, retired at settlement
- `scripts/meaning-reflex-test.mjs` — 39 assertions, in `npm test`

### What is still Phase 2, and still the gate

None of this proves a viewer *understands* the output. That remains the
acceptance test for the whole direction, and it is unchanged by this phase.
