# Live-session capture / deterministic replay

A developer evaluation tool, not a product feature. It exists to let a real
live session — actual speech, through the actual production UI — be
inspected and reconstructed after the fact, so failures can be studied
without needing a live microphone in the room and without re-running any
model extraction. No analytics, no dashboard, no meeting UI: capture stays
in memory until a developer explicitly downloads it, the same posture
`lib/sessionLog.ts`'s `downloadLog` already has for the coarse event log.

## What gets captured

Every turn the production live path (`lib/expression/live.ts`'s
`ExpressionLiveController`) already computes a complete
`ExpressionTrace` (`lib/expression/pipeline.ts`) — nothing about the
pipeline needed new instrumentation to make this possible, with one
exception (visibility tiers, below). One `CaptureTurn`
(`lib/expression/capture.ts`) is:

| Field | Source | Covers |
|---|---|---|
| `trace.input` | already on the trace | settled input segment, source, wall-clock timestamp |
| `trace.delta` | already on the trace | sanitized MeaningDelta for this semantic fold |
| `trace.identityResolutions` | already on the trace | identity decisions (empty in production today — see caveat below) |
| `trace.referenceResolutions` / `trace.stanceResolutions` | already on the trace | reference/target resolutions |
| `trace.discourseActResolutions` | already on the trace | lifecycle transitions |
| `trace.metricResolutions` | already on the trace | metric resolutions |
| `trace.worldBefore` / `trace.world` / `trace.ops` | already on the trace | resulting WorldState snapshots and structured patches |
| `trace.visibility` | **new** — see below | visibility tier assignment this round's plan was built against |
| `trace.plan` | already on the trace | ExpressionPlan |
| `trace.scene` | already on the trace | ScenePlan |
| `trace.patch` | already on the trace | canvas operations (added/updated/moved/removed + connectors) |
| `wallClockStart` / `wallClockEnd` | new, in capture.ts | correlates this turn against a recorded screen session |

**Caveat, stated plainly rather than worked around:** the production live
path runs with `enableIdentityLayer` off and `identityJudge`/`targetJudge`
left at their abstaining defaults (`lib/expression/live.ts:70`,
`ExpressionSession`'s own defaults) — this was true before this pass and is
unchanged by it, per the freeze on identity/target-resolution behavior.
`identityResolutions` will therefore be an empty array on every captured
turn; identity decisions for production's actual path (apply.ts's plain
`resolveMention`) show up implicitly in `ops` (`ADD_ENTITY` vs
`UPDATE_ENTITY`/merge), not as a separate structured trail, because
production itself has no such trail today. Turning the identity layer on
just for capture would change what the session actually does, which is
exactly the kind of behavior change this pass was told not to make.

### The one new field: `visibility`

`lib/expression/planner/visibility.ts`'s tier assignment (`primary` /
`supporting` / `contextual` / `historical` / `archived`) was computed inside
`planExpression` every round but never returned — nothing outside the
planner could see it. `lib/expression/pipeline.ts` now calls the already-
exported, already-pure `assignVisibility()` a second time, with the exact
same inputs `planExpression` itself builds
(`newEntityIds`/`previousVisibleIds`/`previousFocusId`/`focusHint`), and
serializes the result (`Map`/`Set` → plain object/array) onto
`ExpressionTrace.visibility`. This is read-only observability: it does not
touch `visibility.ts` or `plan.ts`'s internals, changes no ranking or tier
logic, and costs one extra (cheap, pure) function call per turn.

## Enabling capture for a session

Dev-only, same shape as the existing `?debug=1` (`isExpressionDebugOnlyEnabled`)
and `?v2=1`/`?xe=1` overrides in `lib/features.ts` — no committed flag, so
there is no path to turn this on for a real user by accident:

```
http://localhost:3000/create?v2=1&xe=1&capture=1
```

From the browser devtools console during or after the session:

```js
inpublic.captureStatus()    // { enabled, turnCount, sessionId }
inpublic.captureDownload()  // saves expression-capture-<timestamp>.json
inpublic.captureReset()     // discards buffered turns, keeps recording
```

## Replaying a capture

```bash
node --no-warnings --import ./scripts/ts-register.mjs \
  scripts/expression-live-replay.mjs path/to/expression-capture-*.json [--svg] [--log]
```

Feeds each turn's captured `(input, delta)` pair straight into a fresh
`ExpressionSession.ingestDelta` — the AI-agent-input path, which skips
extraction entirely — constructed with the same defaults the production
live path uses (identity layer off, judges abstaining), and asserts the
replayed `world`/`plan`/`scene` are byte-identical to what was captured.
`--svg` writes one SVG snapshot per turn; `--log` writes the full
`formatTrace()` transcript. Both land under
`scripts/fixtures/.live-replay-out/<sessionId>/`.

Verified against a 15-turn synthetic capture built from the existing frozen
meeting fixture before this doc was written: 15/15 turns replayed
byte-identical.

## What was deliberately not built

- **In-canvas caption ink** (the words `writeLive` draws directly onto the
  sheet as they're spoken) was left untouched. It sits inside
  `components/Board.tsx`'s Tier-1 write path, explicitly marked a protected
  invariant (`docs/LIVE-SPEECH-PRESENTATION-V2.md`) with load-bearing state
  (`liveRef`, pen reservation, page-turn carry) that other tiers assume ran.
  Suppressing it safely would mean auditing and likely restructuring that
  path, which is exactly the kind of unscoped surgery this pass was told to
  avoid. For the live-evaluation session, "transcript/caption rendering
  disabled" is satisfied by leaving `TranscriptStrip` off — it is literally
  the transcript overlay (`components/TranscriptStrip.tsx`), already
  defaults to off (`lib/preferences.ts`'s `showTranscriptByDefault: false`),
  and needed no code change. If the intent was also to suppress the
  in-canvas words, that's a separate, larger piece of work against
  protected code and should be scoped on its own.
- No dashboard, no aggregation across sessions, no server-side storage —
  capture is one in-memory buffer, downloaded on request, per the brief.
