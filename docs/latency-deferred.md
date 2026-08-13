# Deferred latency work, and why

Two items from the snappiness brief were investigated and deliberately **not**
implemented. Both were told to be documented rather than forced if the
architecture did not permit them safely. This is that documentation, written so
the next attempt starts from the finding rather than rediscovering it.

---

## 1. Artist action streaming — blocked on batch-scoped planning

### The goal

```text
now:      request → wait ~4s → all actions → render
wanted:   request → action 1 → render → action 2 → render → …
```

### The server side is easy

`app/api/artist/route.ts` calls the non-streaming `complete()` and returns
`{actions: [...]}` in one response. `lib/llm.ts` already exports
`completeStream`, and `/api/scribe` already proves the pattern: stream the
model, emit one complete unit per line, render as each arrives.

Extracting whole JSON objects from a partial `{"actions":[{…},{…}` stream is
straightforward — scan for balanced braces at depth 1 and parse each. Only
balanced, parseable objects would ever be emitted, so **invalid partial JSON
could never reach the scene**, and `parseAction` (`lib/actions.ts:65`) already
validates each action independently.

### The client side is the blocker

`planActions` (`lib/organizer.ts:115`) is not a per-action function. It builds
resolution state that spans the **whole batch**:

- `willExist` — concept ids that will exist *by the time links run*, seeded
  from the board and then extended by every `create_concept` earlier in the
  same batch.
- `resolved` — the Artist's requested ids and labels mapped to the ids that
  actually exist, including slugified variants.
- `claimedMarks` — stops two actions in one batch adopting the same ink already
  lettered on the page.

A `create_relationship` resolves its endpoints through `lookup()`, which reads
`resolved` and `willExist`. Calling `planActions([oneAction])` per streamed
action would therefore **drop nearly every relationship**, because its endpoints
were created by a `create_concept` in a previous call and are absent from a
fresh planner's state. The `steps.push({kind:"drop", …})` path at
`lib/organizer.ts:198` is exactly where they would go.

That is a correctness regression — relationships are the arrows, and the arrows
are the product — so it fails the brief's own test.

### What a correct implementation looks like

Make the planner explicitly stateful rather than batch-scoped:

```ts
export interface PlannerState { resolved: Map<string,string>; willExist: Set<string>; claimedMarks: Set<string>; }
export function newPlannerState(board: SemanticBoard): PlannerState;
export function planAction(action: CanvasAction, state: PlannerState, board, marks): PlanStep[];
export function planActions(actions, board, marks): Plan; // keeps working, built on the above
```

`planActions` becomes a fold over `planAction`, so the existing batch behaviour
is preserved exactly and is covered by the existing organizer tests. The Board
then holds one `PlannerState` per Artist response and feeds actions through as
they stream.

Ordering is not a concern: streams preserve order, and `ARTIST_SYSTEM` already
instructs the model to emit concepts before the relationships that reference
them.

### Why it was not urgent enough to justify that

The entire justification for streaming the Artist was that the board sits silent
while it thinks. **Tier 2 removed that silence.** The board now reacts locally
in tens of milliseconds and the Scribe letters marks about a second later, so
the Artist's 3.6–4.5s is no longer dead air — it is refinement arriving on top of
a board that is already alive. Streaming it is still worth doing; it is no longer
worth doing at the cost of the arrow layer.

---

## 2. Touch locks, camera cost, and audio chunk size — no measurements yet

The brief was explicit that these should be tuned **only from measurements**.
The measurements did not exist when this work started, and the instrumentation
that produces them shipped in the same change — so there is nothing to tune
from yet. Nothing here was altered.

### What was left alone

| Constant | Value | Why it exists |
|---|---|---|
| `TOUCH_LOCK_MS` | 4000 | Blocks `renderBeat` after pointer input, so a diagram never lands under the user's cursor |
| `SKETCH_TOUCH_LOCK_MS` | 1500 | Same for the Scribe, shorter because its marks are small and cheap to undo |
| `LIVE_SETTLE_WAIT_MS` | 1500 | Stops a diagram landing in a row the live line is still growing into |
| `STAGGER_MS` / `POLISH_STAGGER_MS` | 180 / 70 | Per-child reveal pacing |
| `FADE_MS` | 250 | Opacity fade on Artist output |
| worklet chunk | 80 ms | `public/pcm-capture-worklet.js`, `sampleRate * 0.08` |

### The specific question about the 4-second touch lock

The audit suggested it might be obsolete now that `suppressChangeUntilRef`
(`Board.tsx:325`) absorbs Excalidraw's mount-time `onChange` storm. That
suppression handles *synthetic* change events at mount. `TOUCH_LOCK_MS` is
driven by `lastPointerInputRef`, which is real pointer input. They cover
different causes, so the suppression does **not** make the lock redundant — but
4000ms may still be more than is needed for the real case. That is an empirical
question and now an answerable one.

### How to answer these now

The `latency` log event and `inpublic.latency()` carry what is needed:

- **Camera cost during speech** — compare `paintP50`/`paintP95` across sessions
  with heavy versus light camera movement. If the spring's per-frame
  `updateScene({appState})` is material, it will show up here, because paint is
  sampled on every interim. If p95 tracks p50 closely, the camera is not the
  problem and should be left alone.
- **Touch locks** — count `sketch-blocked` events with reason
  `recent pointer input` against session length. If they are rare, the lock
  costs nothing and there is no case for touching it.
- **Chunk size** — `chunkGapP50`/`chunkGapP95` report the real cadence, which is
  advisory rather than exact for MediaRecorder. Any experiment with 40ms or 20ms
  chunks must report `interimLagP50` alongside CPU, because smaller chunks buy
  at most ~40ms of buffering and cost proportionally more socket frames. **Do
  not assume smaller is better** — the measurement is the whole point.
