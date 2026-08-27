# Expression Engine — Track C: agent-shaped input

**Goal:** anything that can produce meaning — Claude, Codex, an MCP caller,
an internal tool — asks for visual expression through the same pipeline a
settled speech thought goes through.

The headline is how little there was to build. The pipeline was already
source-agnostic and said so in three places: `InputSegment.source` has
carried `"ai_agent"` since the schema was written, `ExpressionSession.ingestDelta`
is documented as "the AI-agent input path", and `ExpressionLiveController`
was written to "take text in and hand traces out, so the same controller
drives a human speaking and an AI agent submitting meaning." Track C is
mostly the wiring those three had been waiting for.

## API shape

```ts
// lib/expression/entry.ts
createExpressionEntry(controller: ExpressionLiveController, { onSubmit? }): ExpressionEntry

entry.express({ text })                    // the caller has words — extraction runs
entry.express({ delta })                   // the caller has meaning — extraction is skipped
entry.express({ text, id, speakerId })     // optional caller-chosen id and attribution
```

resolving to

```ts
{ id, status: "updated" | "noop" | "failed",
  mode?: "patch" | "full", intent?, grammar?, reason?, objects?, connectors?,
  error?, trace? }
```

Two ways in, differing only in how much work the caller has already done.
`{ text }` is byte-for-byte a settled thought. `{ delta }` goes straight into
the world fold — an agent that already knows what it means should not have to
render that back into English so a model can parse it out again.

Failures **resolve** as `status: "failed"` rather than rejecting: "the engine
ran and produced nothing" and "the engine threw" are both answers, and a
caller forced to try/catch one and inspect the other will end up handling
only one.

What the API deliberately cannot do: name a shape, a coordinate, or a diagram
type. A caller says what it MEANS; what that looks like stays the engine's
decision, exactly as for speech. `MeaningDeltaSchema` — the same schema that
validates model output, at the same point in the pipeline — enforces it, and
it rejects geometry outright.

## Files

| File | Change |
|---|---|
| `lib/expression/entry.ts` | **new** — the entry facade, ~90 lines of it comment |
| `lib/expression/live.ts` | `ExpressionSubmission` (adds `delta`/`source`/`speakerId`), `ExpressionOutcome`, `express()`, `takeBatch()`, settle-on-reset |
| `components/Board.tsx` | builds the entry over the existing controller; `inpublic.express(...)` on the dev console |
| `scripts/expression-test.mjs` | new `agent input` section |

No new schema, no second renderer, no route, no MCP server. `syncExpressionCanvas`
and `writeLive` are untouched.

## How it hooks ExpressionLiveController

`express()` is `submit()` plus a promise. Same buffer, same debounce, same
serialisation, same `onUpdate`/`onNoChange`/`onError` callbacks firing on the
way past — a caller that waits and a caller that does not are not two paths
through the engine. `flush()` resolves every waiter in the batch with the
outcome it just reported.

Two things needed real thought:

**Coalescing.** Batching several settled thoughts into one utterance is a
fact about *speech*: clauses of one breath belong together, and joining their
text before extraction is what lets a trailing clause be understood against
the one it followed. A submission carrying its own `MeaningDelta` has nothing
to coalesce — two deltas cannot be concatenated the way two sentences can,
and the caller has already decided where its thought ends. So `takeBatch()`
gives a delta submission a run of its own and never merges it with the text
on either side; the rest stays buffered and flushes on the next tick.

**Abandonment.** `reset()` used to drop the buffer. With waiters attached
that would leave an agent's promise pending forever — worse than an error —
so anything still buffered is settled as `failed: session reset`.

## Same guarantees as the speech path

- **Phase 0 events.** `submitted` is written by the entry's `onSubmit` hook
  (a callback, not a log import — this module has no business knowing what a
  session log is). `updated` / `noop` / `failed` / `rendered` / `page-turn`
  are already written by the controller's own callbacks, which never ask who
  submitted. Verified live below: all six fired for two agent turns.
- **patch vs full.** Track B's `isContinuation` is upstream of who is
  calling, so it applies unchanged; `mode` is returned to the caller so an
  agent extending a structure it built earlier can see that the board
  extended rather than redrew.
- **One conversation.** Agent and speech share a controller, a session and a
  world. A tested case has speech introduce `traffic` and an agent extend it —
  one entity, not two, and no forked world.
- **No keyterm path, no model→Excalidraw JSON.** The entry's only output is a
  `MeaningDelta`; everything downstream is the same deterministic planner,
  composer and renderer.

## Tests

`scripts/expression-test.mjs`: **1089 → 1130 checks, 0 failed** (41 new, in
`agent input: the same engine, a different caller`). Corpus unchanged: mean
preservation 1.000, 122/122 perfect. Full `npm test` green, `tsc --noEmit`
clean.

The new section covers:

- **text in** — runs the pipeline, reaches the extractor exactly once, marks
  the segment `ai_agent`, picks `cause_effect`, draws the whole chain, mode
  `full`, and fires the Phase 0 update.
- **structured meaning in** — the extractor is reached **zero** times, a scene
  is still produced, the delta's `interpretation` stands in for the segment
  text, and the caller is recorded as the speaker.
- **two sequential agent calls** — mirrors Track B: second turn is `patch`, the
  chain reads whole, what the first call drew has not moved, one object added
  and nothing moved.
- **agent + speech interleaved** — the agent extends the world speech built and
  does not fork it.
- **batching** — a delta submission is its own run and never merges with the
  spoken clause beside it.
- **the boundary** — a delta carrying coordinates is refused with a usable
  reason, an empty request is refused, and a refused request reaches neither
  the pipeline, the log, nor the world.
- **always answered** — a run that throws resolves as `failed` (and still fires
  the Phase 0 failure event); a submission dropped by `reset()` is settled,
  not left pending.

## Live check — no microphone

`/try?v2=1&xe=1`, dev console, real extractor.

```js
inpublic.express({ text: "AI is making it easier to build apps, so we're going to end up with thousands of apps, but that creates a trust problem because people don't know which apps are legitimate.", speakerId: "claude-code" })
```

```
status   updated          source      ai_agent        speakerId  claude-code
mode     full             intent      explain_causality          grammar cause_effect
reason   cause_effect: causal spine: ai -> building-apps -> thousands-of-apps
         -> trust-problem; attached app-legitimacy
objects  6                connectors  4  (arrow, arrow, arrow, line)
```

Scene: `AI@199,48` → `building apps@222,293` → `thousands of apps@48,538` →
`trust problem@239,783`, with `app legitimacy` on the branch and the claim as
an annotation beneath. A four-step causal chain from an agent call, with no
mic involved.

A second agent turn — "And that trust problem slows down adoption." — came
back `mode: "patch"`, spine `... -> trust-problem -> adoption`, and `adoption`
as the only object added. Session log across the two turns:

```
submitted (agent-mt3a9xi2-1) · updated (cause_effect, mode full)
submitted (agent-mt3aacfn-2) · updated (cause_effect, mode patch) · page-turn · rendered
```

The structured path, same session:

```js
inpublic.express({ speakerId: "codex", delta: { entities: [...], relations: [{ source: "review", type: "causes", target: "defects" }], claims: [], interpretation: "code review catches defects early" } })
// → status updated, mode patch, grammar cause_effect, source ai_agent, 917ms
```

917ms end to end, of which 900 is the controller's own debounce — no model
call at all. And the boundary holds live:

```js
inpublic.express({ delta: { entities: [{ id: "x", type: "concept", label: "X", x: 10 }], ... } })
// → status failed, "delta rejected: Unrecognized key(s) in object: 'x'"
```

One honest note on the second live turn: four objects came back `updated` and
one `moved` by 15px. The four are emphasis decay — each box shrinking about
its own centre — plus the ~5px residual the anchor leaves when *every*
retained object resized and the median has to fall back to the full set
(documented behaviour in `anchorToPrevious`). The one `moved` is the
annotation, whose width tracks its anchor's width by design. No re-flow.

## Not built

No MCP server, no HTTP route, no autopreso-style free agent drawing, no
external diagram repos, no HF extractor, no second schema. The reversed
`has_property` comparison gap noted at the end of Track B is still open and
still belongs in its own small change.
