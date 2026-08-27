# Live expression experience — pending UI, caption hierarchy, overflow

Scope held to the live board. No agent/MCP work, no keyterm→draw, no parallel
meaning schema. Phase 0 log events (`expression/submitted`, `updated`,
`noop`, `failed`, `rendered`, `page-turn`) are unchanged; a few optional
fields were added so the dead-air window and a suppressed page-turn are
visible in the same log.

## What changed

### 1. Pending feedback

Between `expression/submitted` and the matching `updated` | `noop` | `failed`,
the board now shows that meaning is being expressed:

- Control bar status switches from "Listening…" to **"Expressing…"** with a
  slow pulse on the existing recording dot.
- A small non-blocking pill ("Expressing") sits under the top bar, pointer-events
  none, so looking at the canvas is not dead air while settle + model run.

Pending tracks thought ids, not runs: a coalesced burst stays pending until
the controller has nothing in flight or buffered (`hasPending()`). It clears
in a `finally` after the canvas write, so sketch fetch is still covered.

### 2. Caption vs expression hierarchy

When the expression engine is on, `writeLive` no longer competes for the
centre of the sheet:

- Live captions sit in a **right rail** (248px, 16px type) and do not advance
  the main pen.
- Active thought: opacity 72. Settled, before ink: 48. After expression ink
  lands: 22 (same fade the consumed-transcript path already used).
- Caption overflow wraps in the rail instead of turning the page
  (`long-utterance` is skipped on this path).

The caption system is still there — same element identity, same settle
lock — it is demoted, not deleted.

### 3. Overflow / flicker

Page-turn storms at occupancy ≈ capacity were not "the scene is too big for
a sheet." A scene taller than `PAGE_H` cannot fit a *blank* sheet either;
turning just re-reserved a region, rebuilt every signature, and did it again
8–10 seconds later.

`decideExpressionOverflow` (`lib/expression/render/excalidrawSync.ts`):

- If the diagram already owns this page: **grow in place**, never turn.
- If a blank page would not fit either: stay, clamp the reserved region to
  the sheet.
- Same-topic cooldown otherwise. A real topic change on a sheet that is
  actually full still turns.

Region padding dropped from 1.35 to 1.12 so reservation headroom stops
forcing `needsRegion` every round. Planner hysteresis now keeps *any*
already-visible entity (not only primary/supporting), so a full page does
not rotate contextual neighbours. Clutter in the evaluator fires past the
budget (12 objects / 14 connectors), not at it — 8 regions + 3 annotations
is the designed scene, not a problem.

Suppressed turns still write `expression/page-turn` with `suppressed: true`
and `suppressReason`, so the log can tell "did not thrash" from "never
considered overflow."

### 4. Optional

- A sketch that is a one-stroke scribble, a tight cluster, or >70 noisy
  strokes falls back to a clean labelled node (`sketchLooksAbstract`).
- `latency.observe("settled_to_expression")` and `settledToUpdatedMs` on the
  outcome events measure settled-thought → expression outcome.

## Before / after — multi-minute narrative

Two replays, both offline, same pipeline the live board runs after
extraction.

### A. Same-topic causal chain (16 settled thoughts)

Synthetic live session, one grammar, occupancy at the region budget.

| | Before | After |
|---|---|---|
| Occupancy max | 8 | 8 |
| Patch rounds | 15 / 16 | 15 / 16 |
| Mean preservation | 1.000 | 1.000 |
| Page-turns from overflow | **2** | **0** |

### B. Frozen 28.7-minute meeting (118 turns)

`scripts/fixtures/meeting-transcript-deltas-v1.mjs`, identity judge off.
This is the long occupancy-at-capacity case from live eval #1/#3 (mean
occupancy 10.81 on a budget of 8 regions + annotations).

| | Before (legacy: grow past the sheet ⇒ turn) | After |
|---|---|---|
| Turns | 118 | 118 |
| Duration | 28.7 min | 28.7 min |
| Occupancy max / mean | 11 / 10.81 | 11 / 10.81 |
| Patch / full | 114 / 4 | 114 / 4 |
| Clutter problems | would fire at >10 objects | **0** (budgeted scene is not clutter) |
| Overflow page-turns | **33** | **0** |
| Mean preservation | 0.21 | 0.21 |

Preservation is unchanged: that number is the identity-duplication problem
from the meeting-stress report, not layout. What this pass removes is the
**page-turn storm** — 33 sheet flips on a topic that never needed a new
page — and the false clutter flag that made a full, designed scene look
broken.

Live eval #1's observed cadence (a turn every 8–10s on a ~3-minute take)
was this overflow path. Same-page grow + caption rail is the structural
stop.

## Verification

- `tsc --noEmit` green
- `scripts/expression-test.mjs` 1178 checks, 0 failed (includes overflow
  policy, sketch fallback, pending `hasPending()`, 16-turn narrative)
- evaluator, idle-gap, intent-fallback, plan-reason-bound: green

Not verified in a browser this pass: no live mic session against `/try?v2=1&xe=1`.
The pending pill and caption rail are CSS + `writeLive`/`ControlBar` changes;
exercise them on a real speak to confirm the rail does not clip the Excalidraw
left toolbar (expression origin still uses `INSET_X = 72`).
