# Expression Engine — R0 + R1 + R6

Branch `expression-engine-default`. Scope as briefed: stage instrumentation,
two-phase render, sketch gate and cost alignment. No agent/MCP work, no new
models, no debounce change, no change to `MeaningDelta`, grammars, identity, or
plan/compose.

**Headline, measured on a real board with real model calls: settled thought →
structural ink went from ~20.6 s median to ~4.6 s median.** The Drawing Agent
still runs, still takes 15–17 s, and no longer holds up a single line of it.

---

## 1. What changed

| File | Change |
|---|---|
| `components/Board.tsx` | Two-phase render in `applyExpressionUpdate`; `expressionRunSeqRef` for supersession; stage timing + sketch event logging |
| `lib/expression/pipeline.ts` | `ExpressionTrace.timings` — `extractMs` (model) and `deterministicMs` (the nine layers); `ingestDelta` takes optional upstream timings |
| `lib/expression/draw/client.ts` | `resolveSketches` reports per-key outcomes; new `pendingSketchKeys()`; `SketchResolutionEvent` |
| `lib/expression/draw/schemas.ts` | `sketchRejectionReason()` — named reasons, relaxed gate; `sketchLooksAbstract` delegates to it |
| `lib/expression/draw/agent.ts` | `SKETCH_MAX_OUTPUT_TOKENS = 6000`, exported, used by `drawSketch` |
| `app/api/sketch/route.ts` | Reserves `SKETCH_MAX_OUTPUT_TOKENS` instead of a hardcoded 800 |
| `lib/latency.ts` | Five new `SampleKey`s; documented meaning change on `settled_to_expression` |
| `lib/types.ts` | `expression` log event gains `"sketch"`, stage-timing fields, and per-key sketch fields |
| `scripts/expression-test.mjs` | 6 new checks: relaxed gate, named reasons, `pendingSketchKeys`, two-phase diff with a half-warm cache |

Untouched, deliberately: `MeaningDeltaSchema`, all ten grammars, `identity.ts`,
`plan.ts`, `compose.ts`, `evaluate.ts`, `live.ts`, the 900 ms debounce, and
`SKETCH_MODEL`.

---

## 2. How the two-phase commit works

### Before

`applyExpressionUpdate` awaited `resolveSketches` for every new `sketchKey`,
then called `syncExpressionCanvas` once. Nothing structural reached the sheet
until the slowest Sonnet call in the fan-out returned.

The comment justifying that order was correct about the mechanism — "a sketch
that arrives after the elements are written would not be drawn until some later
sentence dirtied the same node" — and wrong about the remedy. The fix is not to
wait for the sketch; it is to make the sketch's **arrival** dirty the node.

### After

**Phase 1 — structure.** `syncExpressionCanvas` is called immediately with the
sketch cache *as it currently stands*. Cached sketches are not "later": they
cost nothing, so a concept drawn earlier in the session is in the very first
frame. Only keys the client has never seen defer. `pendingSketchKeys()` decides
which those are. This commit keeps everything it had before — undo entry,
`recordOperation`, `revealVisualReentry` on newly added bounds, caption
demotion, transcript fade.

**Phase 2 — detail.** Detached (`void (async () => …)()`), so nothing above
waits for it. `resolveSketches` fans out, reporting each key; when it returns,
`syncExpressionCanvas` runs a second time with the now-fuller cache. The
existing signature diff does the rest: a node whose sketch just arrived has a
changed signature, so it rebuilds; every other element on the sheet is
byte-identical and is not touched at all. This is the mechanism the renderer
was already built for and already tested for ("a late sketch removes the
placeholder rect / and adds the strokes / while the un-sketched node is left
strictly alone" — a pre-existing check in the suite).

### The guards

**Camera.** Phase 2 never calls `revealVisualReentry`. This is not belt-and-
braces: a sketch commit genuinely produces *added* ids, because every stroke is
its own element, so `boundsOf(elements, addedIds)` would return real bounds and
the camera would fly to them. The viewer is already looking at that node;
yanking the view because an icon finished drawing is exactly the jitter the
split exists to prevent.

**Supersession.** `expressionRunSeqRef` is bumped on entry to every run. The
live controller does **not** await `onUpdate` (`live.ts:221`), so a newer run
can start and finish while an older run's sketches are still in flight. Before
committing, phase 2 checks `expressionRunSeqRef.current === runSeq`; if a newer
run has composed a different scene onto those ids, the commit is dropped and
logged with `superseded: true`. **This fired in live testing** — see §5.

**Page turn.** Phase 2 also drops if `pageRef.current !== structurePage`. A page
turn between the two commits would make `syncExpressionCanvas` reserve a fresh
origin, which changes every absolute coordinate, which changes every signature —
a full silent redraw of the whole diagram at a new location, with no camera
move to explain it. Additionally, phase 2 passes an `onOverflow` that only logs
a suppressed page-turn: unreachable in practice (the region was reserved in
phase 1 and the scene footprint has not changed), but recorded rather than
silent if it ever is.

**No first frame, no second.** Phase 2 is skipped entirely when phase 1 wrote
nothing. Without a first frame there is no identity for those ids, so the sketch
commit would arrive as a batch of ADDED elements — new camera-worthy ink —
rather than as an upgrade to nodes already being watched.

### The pending affordance — decision

**"Expressing…" clears after the first structural commit.** The `finally` that
calls `settleExpressionPendingRef` sits in phase 1's scope, so this is true by
construction now that phase 2 is detached. The board reads as done the moment
the diagram is on the sheet, which is the honest signal: the thought *has* been
expressed; what is still arriving is decoration. No "detail loading" affordance
was added — the sketch upgrade is visible in itself.

One consequence worth naming: `latency.observe("settled_to_expression")` fires
from that same `finally`, so **that key's meaning has changed** — it now ends at
the structural commit rather than after the sketch fan-out. Figures recorded
before and after this change are not comparable. Documented in `lib/latency.ts`
at the key's definition.

---

## 3. Observability added (R0)

### Stage splits

`ExpressionTrace.timings` carries `extractMs` (the one `/api/express` model
call, measured inside `ingest` because the caller cannot see inside it) and
`deterministicMs` (fold → intent → visibility → plan → compose → evaluate →
diff). `extractMs` is absent on the agent path, where meaning arrives already
structured and no model runs.

Board logs and observes:

| Where | Log field | `latency` key |
|---|---|---|
| `expression/updated` | `extractMs` | `expression_extract` |
| `expression/updated` | `deterministicMs` | `expression_deterministic` |
| `expression/rendered` `phase:"structure"` | `syncMs` | `expression_sync` |
| `expression/rendered` `phase:"structure"` | `settledToStructureMs` | `expression_structure` |
| `expression/rendered` `phase:"sketch"` | `ms` | `expression_sketch` |

`settledToUpdatedMs` is unchanged and still logged, so nothing that read it
breaks.

### Sketch path

A new `expression/sketch` event per key per resolve pass:

```
{ event: "sketch", sketchKey, outcome: "cache_hit" | "fetched" | "missing",
  ms, strokes, rejectedReason?, superseded? }
```

`rejectedReason` is the verdict the *renderer* will reach on those strokes —
same pure function, same input — computed at resolve time so a session log can
say a model call was paid for and thrown away. Reporting it does not cause the
fallback; `render/excalidraw.ts` still decides that for itself. This closes
audit §8 unknown #5, where the >70-stroke discard was "currently invisible in
production."

No cross-session dashboard was built, as briefed. `LatencySummary` was not
extended — the new keys record and transport through the existing sink, and the
readable numbers are in the session log.

---

## 4. Sketch gate and cost alignment (R6)

### The gate

`sketchLooksAbstract` contradicted the prompt it was grading. `SKETCH_SYSTEM`
asks for "40-100+" strokes with cross-hatched shading, `SketchSchema` allows
120, and the gate discarded anything over **70** — so the better a sketch
followed its own instructions, the likelier it was binned. The second rule was
worse: it rejected any sketch where >70% of strokes were shorter than 10 units,
which is the *definition* of cross-hatching.

Now `sketchRejectionReason(sketch): string | null`, with `sketchLooksAbstract`
as a thin wrapper so both renderers and every logger read one function.

- **Stroke count: removed.** `SketchSchema`'s max of 120 is now the only
  stroke-count authority.
- **Short-stroke ratio: replaced with a contour floor.** What distinguishes
  shading from scribble is whether there is a *form* underneath it, so the test
  is a floor on long strokes rather than a ceiling on short ones: a sketch needs
  at least `min(3, strokeCount)` strokes of ≥10 units. 100 hatch marks over 10
  contour strokes is a drawing; forty short marks and nothing else is not.
- Kept unchanged: `< 2` strokes, `< 4` points, and the `span < 900` cluster test.

Every rejection now names itself: `"single stroke"`, `"too few points"`,
`"clustered (span N < 900)"`, `"no contour (N strokes >= 10 units, needs M)"`.

### The reserve

`SKETCH_MAX_OUTPUT_TOKENS = 6000` is exported from `draw/agent.ts` and used by
both `drawSketch`'s `maxTokens` and `/api/sketch`'s `guardProviderRequest`
reserve, which was 800 — an under-reservation of 7.5× on every sketch. One
constant, two readers, cannot drift again.

No vendor change, no prompt change.

---

## 5. Test results

### Suites

```bash
npm run typecheck && npm test
```

`tsc --noEmit` clean. Full `npm test` exits 0. `scripts/expression-test.mjs`:
**1192 checks passed, 0 failed** (1186 before the new checks, 1180 before this
work). Corpus unchanged: 122 cases, mean preservation **1.000**, 122 perfect, 0
below 0.85 — patch/full behaviour is untouched for non-sketch fields.

New checks:

- 100 strokes is not by itself abstract
- cross-hatched shading over a real contour is kept
- short marks with no contour under them are still rejected
- every rejection names its reason
- a half-warm scene defers only the keys it has never seen
- the structural frame already carries the cached sketch / and a plain node for
  the one still being drawn
- the second commit upgrades the node whose sketch just arrived / and does not
  touch the node that was already sketched in phase one
- a second commit with nothing new resolved is a no-op
- `pendingSketchKeys` dedupes, skips cached keys, ignores objects with no key

### Live session — real board, real Haiku, real Sonnet

Driven through `inpublic.speak()` on `/try?v2=1&xe=1`, which goes through the
real settled-thought path: same controller, same debounce, same canvas sync.
Four runs, seven concepts sketched, no console errors.

| run | mode | `extractMs` | `deterministicMs` | `syncMs` | **settled → structural ink** | sketch phase | sketch commit |
|---|---|---|---|---|---|---|---|
| 1 | full | 9,777 | 19 | 85 | **10,796** | 17,265 | landed |
| 2 | patch | 4,814 | 6 | 11 | **5,732** | 14,840 | landed |
| 3 | patch | 2,314 | — | 10 | **3,230** | 10,312 | **superseded, dropped** |
| 4 | patch | 2,304 | — | 5 | **3,441** | 14,948 | landed |

**Before vs after, on these same rounds.** Under the old ordering the first ink
would have been `settled→structure + sketch phase`, because the sketch fan-out
sat in front of the sync:

| run | old (structure after sketches) | new (structure first) |
|---|---|---|
| 1 | 28,061 ms | **10,796 ms** |
| 2 | 20,572 ms | **5,732 ms** |
| 4 | 18,389 ms | **3,441 ms** |
| **median** | **20,572 ms** | **4,586 ms** (all four runs) |

**~4.5× faster to first structural ink**, and the 28.1 s on run 1 is within 0.2%
of the ~28 s median measured from the real 137-second session log in
`docs/EXPRESSION-ENGINE-RESEARCH-BRIEF.md` — independent corroboration that the
old number was real and that this is the thing that was causing it.

Other confirmations from the same session:

- **Supersession works.** Run 3's sketch fetch returned at 10,312 ms, by which
  time run 4 had already committed its structure. The commit was dropped and
  logged `superseded: true`. Exactly one sketch frame landed per surviving run;
  three sketch frames for four runs.
- **Cache hits are in the first frame.** 17 `cache_hit` events across runs 2–4,
  each of those sketches drawn in the structural commit rather than deferred.
  Run 3 and 4's structural frames carried seven already-cached sketches at
  3.2 s and 3.4 s.
- **All 7 nodes upgraded** — `elements()` shows 267 stroke elements across
  `o-r-marketing` (36), `o-r-traffic` (**70**), `o-r-signups` (28),
  `o-r-the-whole-thing` (40), `o-r-trust` (27), `o-r-conversion` (26),
  `o-r-bottleneck` (40), plus `concept:onboarding-quality` at 68.
- **R6 was not theoretical.** `concept:traffic` came back at exactly **70**
  strokes and `concept:onboarding-quality` at **68** — one and three strokes
  from the old cliff, in a four-utterance test. Zero rejections under the new
  gate.
- **`syncMs` is 5–85 ms.** The deterministic render was never the problem, and
  now the log proves it rather than inferring it.

---

## 6. Remaining risks

**1. Extract is now 100% of the structural latency floor — expected, not fixed
here.** `settled→structure` is `900 ms debounce + extractMs + syncMs`, and
`extractMs` was 9,777 ms cold and ~2,300 ms warm. Nothing in this brief touches
that. The research brief's R3 (prompt-cache the ~3,700-token
`EXTRACTION_SYSTEM_PROMPT`, which currently has no `cache_control` anywhere) and
R7 (shape/detail call split) are the next moves, and R0's `extractMs` is now the
instrument that will prove or disprove them.

**2. An empty or slow first frame still reads as an empty board.** With
sketches off the critical path, a round where extraction is slow shows nothing
for ~3–10 s. That is the honest state of the system, not a regression — it was
previously hidden behind a much longer wait — and it is what research-brief R10
(a reserved "thinking" region) would address.

**3. Concurrent sketch phases can duplicate a fetch.** Runs 3 and 4 both fetched
`concept:pricing`, because both computed their pending set before either
finished and an in-flight fetch is not yet in the cache. This is pre-existing —
`onUpdate` was never awaited, so overlapping `applyExpressionUpdate` calls were
always possible — but R1 makes it more reachable, because the sketch phase now
outlives its own run. It costs a duplicate Sonnet call, never correctness: both
resolve to the same key and the last write wins on identical work. The fix is an
in-flight promise map in `draw/client.ts`, deliberately out of scope here.

**4. The sketch library is still per-process and per-tab.** `draw/library.ts`
loses everything on server restart and `expressionSketchCacheRef` dies with the
tab, so every session pays for its whole vocabulary again. Research-brief R5.

**5. `settled_to_expression` history is not comparable across this change.**
Noted in §2 and at the key's definition in `lib/latency.ts`.

**6. Two-phase reading quality is still unmeasured.** Audit open question #12.6
asked whether early structure that later gains detail reads better than a
slower, complete first frame. This makes that testable for the first time —
there is now an early frame to judge — but it has not been judged.
