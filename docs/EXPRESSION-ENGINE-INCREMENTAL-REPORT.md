# Expression Engine — Track B: incremental expression

**Goal:** when a settled thought extends an existing structure, the canvas
extends with it — existing objects keep their coordinates, new ink appears in
the right structural slot — instead of re-flowing as if it were a new picture.

Track A's layout rules are untouched: branches still land on their step's
row, emphasis is still size + stroke, the poles still share a row grid, a
contrast still gets its tension mark, a backed claim is still a tree.

## What made the board jump

Three causes, in the order they hurt.

### 1. The chain lost its head — `isLosingAlternative`

Not a layout bug at all. `lib/expression/planner/visibility.ts` classifies an
entity as "the losing arm of a resolved branch" partly from a fallback
clause: same-era, actionish, lower degree than the world's primary. Every
earlier step of a growing chain matches that description. So on turn 2 of
"marketing creates traffic" → "traffic creates signups", `marketing` was
demoted to `historical`, fell out of `canvasEligible`, and was **deleted from
the canvas** — the spine drawn was `traffic -> signups` and the speaker's
first claim was gone.

Fixed by giving that fallback the distinction it was missing: two entities
joined by a causal, temporal or structural relation are not rivals, they are
two parts of one structure. The explicit-contrast and shared-claim signals
are unchanged.

### 2. A comparison could not survive one turn — the same function

`contrasts_with` reaches `isLosingAlternative` directly, so in any explicit
comparison one pole was labelled the loser and sent to `historical`. The next
sentence adding a dimension dropped that pole off the horizon, which took it
out of the grammar's pole selection, which re-chose the poles from what was
left and redrew the whole thing (`poles plan-a vs b-cost`).

A contrast is not a decision. A losing alternative now loses its **reserved
seat** — which is what the function is documented to do — but not its
existence: while it is still current it competes as an ordinary contextual
entity, and it ages out on the ordinary clock exactly as before. It is still
removed from `persistIds`, so it never reaches the durable reserve.

### 3. Emphasis decay re-flowed every layout — the grids

Emphasis decays by design: what was just said is weight 3 and drops the
moment something newer arrives. Every layout built its grid from **actual**
box sizes, so every box's cell resized every single turn, and each resize
pushed everything after it. A three-sentence chain re-flowed end to end on
each new sentence for a reason that had nothing to do with meaning.

`Placed` now carries `baseW`/`baseH` — the size the object would be at weight
1 — and `layoutFlow`, `layoutPoles` and `packBelow` build their grids from
those, reserving `EMPHASIS_HEADROOM` (read off `WEIGHT_SCALE[3]`, not a
second literal) so an emphasised box always fits its cell. Rows are
**top-aligned**, so an emphasised box grows down into the gap rather than
nudging the row line beneath it. Emphasis still changes the box; it no longer
changes the grid.

### 4. …and the origin translation moved what was left

Every layout is relative and then translated so the scene starts at the
origin — a translation computed from the scene's own extent, so anything that
changed the extent slid the whole diagram sideways.

`anchorToPrevious` re-anchors onto the scene already on the canvas when the
grammar is unchanged: the median offset of the objects present in both is
applied to all of them. The median, not the mean, so one object that really
did move cannot drag everything by a fraction of its displacement — and the
sample is the objects **whose size did not change**, falling back to all
retained objects only when every one of them resized. A box drawn centred in
its cell has to move when it shrinks; anchoring on those was dragging the
untouched dimensions of a comparison sideways by half a pole's shrink.

It is a translation and nothing else — no object is placed anywhere its
layout did not put it — and the scene is shifted back if the offset would
push any part of it to a negative coordinate.

## When a full recompose is still right

`isContinuation` (one definition, in `compose.ts`) says a round is a
continuation only if there is a previous scene **and the grammar is the
same**. A grammar change is a legitimate rebuild: the spatial logic itself
changed, so no existing object has a comparable slot and anchoring the new
arrangement onto the old coordinates would preserve nothing but the illusion
of continuity. A repair that changes grammar re-evaluates the mode for the
same reason.

## Files

| File | Change |
|---|---|
| `lib/expression/planner/visibility.ts` | the two `isLosingAlternative` fixes |
| `lib/expression/compose/compose.ts` | `baseW`/`baseH`, `EMPHASIS_HEADROOM`/`cell`/`rowCell` grids, `ComposeOptions`, `isContinuation`, `anchorToPrevious` |
| `lib/expression/pipeline.ts` | threads the previous scene + grammar into `compose`; `lastGrammar`; `ExpressionTrace.mode` |
| `lib/types.ts` | optional `mode` on the `expression` log entry |
| `components/Board.tsx` | `mode` on the existing `expression/updated` event |
| `scripts/expression-test.mjs` | new `incremental expression` section |

Caption vs expression ownership is untouched: nothing in this pass goes near
`writeLive` or the region `syncExpressionCanvas` owns. Phase 0 events are
unchanged apart from one added optional field.

## Tests

`scripts/expression-test.mjs`: **1061 → 1089 checks, 0 failed** (28 new, in
`incremental expression: the board extends, it does not redraw`). The new
section drives multi-turn sessions the way the pipeline does — fold, plan
against last round's visible ids, compose against the previous scene — and
asserts the brief's three cases plus the rebuild case:

- **causal** — turn 1 A→B, turn 2 B→C: mode `full` then `patch`, the head is
  still drawn, the chain reads whole, A and B at identical coordinates,
  `patch.moved` empty, exactly one object and one connector added.
- **sequence** — three turns: steps established two turns earlier at identical
  coordinates, the new step at the end of the chain, one object added,
  nothing moved.
- **comparison** — a dimension arrives a turn later: both poles still poles,
  poles keep their row and their centre-x, an untouched dimension does not
  move *at all*, the new dimension lands under its own pole, nothing moved.
- **grammar shift** — comparison → enclosure reports mode `full`.
- **anchoring is a translation** — the whole scene moves together, draws the
  same objects, preserves the same score, never anchors off the top-left, and
  is skipped when the previous grammar differs.

Corpus, 122 cases: mean preservation **1.000**, 122/122 perfect — unchanged
from Track A. Grammar distribution unchanged. Full `npm test` green,
`tsc --noEmit` clean.

`scripts/expression-visibility-audit.mjs` over the 118-turn meeting replay,
before this pass vs after (measured by neutering exactly these changes):

| | before | after |
|---|---|---|
| canvas patch added / updated / rerouted / removed | 202 / 96 / 672 / 192 | **195 / 94 / 541 / 185** |
| mean visible-object retention | 0.825 | **0.834** |
| mean stale-visible | 2.19 | 2.12 |
| mean additions / removals per turn | 1.39 / 1.33 | 1.33 / 1.27 |

Connector reroutes — the direct measure of "endpoints moved" — fall **20%**.
The failure distribution over expected concepts is unchanged.

## Live probes

`inpublic.speak()` on `/try?v2=1&xe=1` against the real extractor, positions
straight off `window.__expression`.

**Causal, two turns**

> "Marketing creates traffic." → "And traffic creates signups."

| | turn 1 | turn 2 |
|---|---|---|
| mode | `full` | `patch` |
| spine | `marketing -> traffic` | `marketing -> traffic -> signups` |
| Marketing | 71,**48** | 52,**48** |
| Traffic | 48,**248** | 48,**248** |
| Signups | — | 8,448 |
| patch | +2 | added `Signups`, **moved: none**, updated `Marketing`/`Traffic`, removed: none, 1 connector added |

The head of the chain survives (that is fix #1), y is identical, and the two
`updated` entries are the emphasis decay itself — w3→w2 and w3→w1 — each box
shrinking about its own stable centre.

**Two more turns on the same board**

> "First we finish payments, then we cut latency." → "Then we bring in testers."

Marketing 64,48 · Traffic 48,248 · Signups 48,448 — **byte-identical across
both further turns** while a new topic was drawn beside them. `moved: none`
both times; the only ink written was the new nodes.

**Comparison, two turns** (fresh session)

> "Plan A costs more than Plan B." → "Plan A also takes twice as long as Plan B."

Turn 1 `full`, poles Plan A / Plan B at y=48 with their costs on the shared
row y=344. Turn 2 `patch`: poles still `plan-a vs plan-b`, both still at
y=48, **Plan B cost unchanged at 654,344**, `moved: none`.

One honest gap this probe exposed, and it is *not* incremental: the extractor
emitted the new dimensions as `plan-a-duration -has_property-> plan-a` —
backwards — and the comparison grammar's property loop only reads
`source === pole`, so the durations were attached as context and parked in
the straggler column instead of being seated under their poles. Reproduced
in a **single** turn with the same relations, so it is a grammar robustness
gap against reversed extractor edges (the same class the `lift` map already
handles in one direction), not something this pass introduced or should fix
under a Track B brief. Track B's own requirement held: the poles and the
existing dimensions did not move.

## Not touched

`writeLive` / `syncExpressionCanvas` ownership, Phase 0 event names, the
meaning schema, Track C's agent entry point, HF/GitHub, auth/mic. No
model→shapes anywhere: anchoring is a median of integers.
