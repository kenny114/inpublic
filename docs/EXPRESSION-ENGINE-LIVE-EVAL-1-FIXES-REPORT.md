# Two fixes from live evaluation #1, before the next session

Scope held to exactly the two high-confidence issues named in the brief.
Identity, target resolution, lifecycle semantics, metric semantics, visual
grammar, scene budget, MCP, collaboration: untouched. No new product
features. Salience/topic-closing behavior (the second-largest live failure)
is instrumented in fix 2's log but deliberately not touched — deferred until
a deep capture proves where the stale entities actually survive.

## Fix 1 — ExpressionPlan diagnostic metadata validation

**Bug**: `plan.reason` (`lib/expression/planner/plan.ts`) is built by
appending every entity `attachRelatedEntities` attached onto the chosen
grammar's own reason string. That string grows with how much a round
actually drew — exactly the kind of text that eventually crosses
`ExpressionPlanSchema`'s fixed 200-character cap. When it did, the entire
otherwise-valid plan failed `safeParse` and the pipeline fell back to an
empty/relationship plan with `preservation: 0`, for as long as the attached
list stayed long. This is finding #1 from live eval #1: three consecutive
turns, ~9 seconds, mid-thought.

**Fix**: `boundReason()`, a single truncation function, applied at every
point in `plan.ts` that constructs a `reason` string before it's ever handed
to `ExpressionPlanSchema.safeParse`. Diagnostic text can only get shorter;
it can never invalidate a plan again. Caught and fixed one adjacent bug
while in this code: the invalid-plan fallback branch read `chosen.grammar`
unguarded, which would throw on `chosen === null` — changed to
`chosen?.grammar ?? "relationship"`, matching how the same value is already
computed a few lines above.

**Regression**: `scripts/expression-plan-reason-bound-test.mjs` — builds a
world with a short causal spine and 7 long-labeled entities attached to it
(mirroring the real session's "the initial motivation for building InPublic
was a desire to..." style text), forcing the exact same growth pattern.
Verified both directions: reverting the fix reproduces the live bug's exact
error string (`grammar cause_effect produced an invalid plan: String must
contain at most 200 character(s)`, 0 regions); with the fix, the plan is the
real 8-region `cause_effect` plan and `reason.length === 200` (truncated,
not failed).

**Side effect worth stating plainly**: replaying the frozen 118-turn meeting
corpus with this fix applied shows a small shift (primary-focus changes
57→56, mean stale-visible 2.17→2.19) versus the durable-reserve pass's own
numbers from immediately before this fix. This is not a ranking or tier
change — `durabilityRank`/`visibility.ts` are untouched, and `reason` is
never read by any decision logic in the planner. It's the direct, expected
effect of fix 1 correcting a small number of turns in the corpus itself that
were silently hitting this exact validation failure. The concept-level
failure distribution (13 omitted / 12 ok-visible / 7 ok-hidden / ...) is
byte-identical to before this fix — only turns that were previously broken
by this bug changed.

## Fix 2 — automatic page-turn churn

**Root cause, found**: `lib/expression/render/excalidrawSync.ts`'s
`syncExpressionCanvas` decided whether to reserve a new region (and
therefore whether to call `onOverflow`, which turns the page) from
`needsRegion`, which included `identity.originPage !== pageIndex` — i.e.
"has the page changed since we last reserved a region" — with **no check
for whether there was anything new to draw**. The page can change for
reasons that have nothing to do with the expression engine (Tier 1's own
`writeLive`/"long-utterance" page turn, or anything else). The next time the
expression engine ran afterwards — even on a round where `trace.patch` (the
actual semantic diff from the world/plan/scene layer) was completely empty
— `needsRegion` was true purely from the stale page index. That reserved a
fresh region at a new origin, which changed the absolute x/y of every
existing skeleton, which changed every signature, which made
`planCanvasDiff` treat the whole unchanged scene as "updated": a full silent
redraw and camera move, for a round with zero new information. This is
exactly live eval #1 finding #2 — page turns and empty renders back to
back, and more precisely, a "no new content" round that was silently doing
a full redraw anyway.

**Fix**: one gate, placed before any region logic runs — if `patch` (the
`RenderPatch` already computed upstream by `diffScenes`, already the
authoritative "did anything visible actually change" signal) is entirely
empty, `syncExpressionCanvas` returns immediately. No region check, no
`onOverflow`, no redraw, no re-anchor. This is a direct implementation of
the requested invariant — *no meaningful visual delta, no automatic page
turn* — and it targets the actual mechanism, not a symptom: no timer, no
cooldown, nothing time-based at all. A genuine overflow (patch non-empty,
region doesn't fit) is completely unaffected and still turns the page
exactly as before.

**What this fix does not touch**: Tier 1's own `"long-utterance"` page-turn
trigger inside `writeLive` (`components/Board.tsx`) — explicitly protected,
load-bearing code (see `docs/EXPRESSION-ENGINE-LIVE-CAPTURE.md`'s note on
why it was left alone during capture-mode work). That trigger draws real
content (the live caption line) when it fires, so it doesn't itself violate
the stated invariant; it was the *downstream* effect on the expression
engine's own region bookkeeping that did.

### Instrumentation

Every time the expression engine's own `onOverflow` now fires (i.e. every
remaining automatic page turn from this code path), `components/Board.tsx`'s
`applyExpressionUpdate` logs one `{ type: "expression", event: "page-turn" }`
record with everything the brief asked for:

| Field | Source |
|---|---|
| `trigger` | always `"overflow"` — the only trigger this call site has |
| `msSincePreviousTurn` | tracked in a ref across calls |
| `activeTopic` | `plan.focusEntityId ?? intent.focusEntityId` |
| `topicChanged` | compared against the previous round's topic |
| `pageOccupancy` / `pageCapacity` | `scene.objects.length` / `REGION_BUDGET` |
| `newSemanticEntities` | `ops` filtered to `ADD_ENTITY` |
| `newVisibleEntities` / `removedVisibleEntities` | `patch.added.length` / `patch.removed.length` |
| `planValidationFailed` | detects pipeline.ts's exact invalid-plan fallback message |
| `scenePlanDiff` | `describePatch(trace.patch)`, the same text already used for the `"rendered"` log line |
| `renderOperationCount` | sum of every `patch` array's length |
| `overflow` | `{ neededW, neededH, pen, pageIndex }` — the geometry `syncExpressionCanvas` itself knows |

`lib/types.ts`'s `LogEvent` union was extended with this shape (additive —
every new field is optional, every existing `"expression"` event is
unaffected). This gives salience/topic-closing behavior — deferred by
design this pass — a instrumented trail to inspect from the next capture
without re-adding anything to the runtime that decides visibility.

**Regression**: `scripts/expression-test.mjs`, new block — an unchanged
scene with an empty patch, a page index that's already moved, and a region
too small to fit the scene: without the fix this reaches
`@excalidraw/excalidraw`'s browser-only conversion (which the rest of this
test file avoids on purpose) and would redraw; with the fix it returns
untouched and `onOverflow` never fires. A second case with a genuine
non-empty patch and an intentionally overflowing pen confirms real overflow
still turns the page — the fix suppresses the empty case specifically, not
overflow itself. Verified both directions the same way as fix 1.

## Regression summary

| Suite | Result |
|---|---|
| `expression-test.mjs` (offline corpus + unit-style checks) | 988/988 (was 984 before the two new regression blocks) |
| `expression-plan-reason-bound-test.mjs` (new) | 4/4 |
| `expression-evaluator-test.mjs` | 33/33 |
| `expression-critical-replay.mjs` | 9/9 |
| `expression-identity-replay.mjs` | 13/13 |
| `expression-lifecycle-replay.mjs` | 10/10 |
| `expression-reference-replay.mjs` | 13/13 |
| `tsc --noEmit` | clean (two pre-existing errors in frozen files — `plan.ts`'s null-narrowing note above fixed one of them; `resolveTarget.ts`'s remains, untouched, out of scope) |
| 118-turn frozen meeting replay | concept-level distribution unchanged; small, explained, expected shift from fix 1 correcting previously-broken turns (see above) |

## Next: live evaluation #2

Per the brief: one uninterrupted 15-minute unscripted session, captions
hidden, `inpublic.captureDownload()` enabled this time (not the shallow
session log used for eval #1), with a simultaneous screen recording. No
fixes during the session. The new page-turn instrumentation and the
now-unbreakable `reason` field mean this capture should, for the first
time, carry enough to correlate an experiential failure against the exact
`WorldState → visibility → ExpressionPlan → ScenePlan → render` chain that
produced it — which is what deep capture was built for two passes ago.
