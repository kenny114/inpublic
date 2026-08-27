# Strip-Down Report

## Original commit

`072e5c56233da4f0aae126c4383f1843f235f672` — "feat: real detail and a live
stroke-by-stroke reveal for the drawing agent", branch `expression-engine-default`.

Working tree at the start of Phase 1 was already dirty with substantial
**uncommitted, active** Expression Engine work (identity/composition/clean/
presentation/fast layers, `agentBridge.ts`, `entry.ts`, `tool.ts`, ~25
`docs/EXPRESSION-ENGINE-*.md`, ~30 `scripts/expression-*.mjs`). None of that
was touched or treated as a deletion candidate — it is current, reachable
engine code, confirmed by tracing imports, not by filename.

---

# Phase 1 — API routes, stale docs

## Baseline (before Phase 1)

- Typecheck: clean. Build: clean, 25 routes. Test: **48 passed / 3 failed**
  (see "The 3 known baseline failures" below — recorded, not fixed).

## Deleted

- `app/api/{beat,artist,math,scribe}/route.ts`, `app/api/audio/upload/route.ts`
  — confirmed zero live callers (only fetched from `if (!v2Enabled)` branches
  or `features.audioReplay=false` code).
- 8 stale root docs predating the V2/Expression Engine activation
  (`AUDIT.md`, `AUDIT-2.md`, `AUDIT-3.md`, `COST-AUDIT.md`, `LATENCY-AUDIT.md`,
  `SPEECH-ACCURACY-AUDIT.md`, `SPEECH-TO-VISUAL-AUDIT.md`, `PLAN.md`).
- `scripts/foundation-test.mjs` updated (six dead `beat`-route assertions
  removed).

## Result

Typecheck clean, build clean (25→20 routes), test 48/3 (unchanged).
Phase 1 stopped here deliberately — the remaining legacy code turned out to
be far more deeply threaded through `Board.tsx` than a first pass suggested,
and completing it safely needed the browser safety net Phase 2 added first.

---

# Phase 2 — Board.tsx surgery, Story Mode, flags, browser tests

## Step 0 — Baseline re-confirmed

- Typecheck: clean. Build: clean. Test: **48 passed / 3 failed** — identical
  to Phase 1's exit state.
- **The 3 known baseline failures** (pre-existing, `expression-discover.mjs`,
  `EXPRESSION_PLANNING` layer, not touched or fixed this phase):
  1. `family: five people, mother named, then her occupation [paragraph]` —
     "Mariam -role_of-> the speaker is in the world but the plan never
     connected it"
  2. `family: five people, mother named, then her occupation [incremental]` —
     same cause
  3. `quantity: three people, four apples each, twelve total [incremental]` —
     "quantity preservation 0.667 below 1: 'apples each' (4) is not on the
     canvas"

## Step 1 — Browser safety net (new)

Repo had zero automated browser coverage (`audit/TEST_COVERAGE_MAP.md`: no
Playwright config, no `*.spec.ts` anywhere). Added `@playwright/test`,
`playwright.config.ts`, and `tests/smoke/` — deliberately narrow, not a
general E2E framework:

- `board-boot.spec.ts` — `/try?replay=1` (dev-only bypass, mounts
  `<Board guest startFresh />` with no mic click) loads, Excalidraw mounts,
  no fatal console/page error.
- `undo.spec.ts` — undo reverts a real Expression Engine turn. Confirmed
  `recordOperation("expression_engine", ...)` at `Board.tsx:5887`-then is
  genuinely shared infra, not legacy-only, before writing this test.
- `page-camera.spec.ts` — a same-topic continuation extends the board
  rather than erasing the first turn's elements (matches the real corpus's
  "the board is never wiped" invariant).
- `persistence-roundtrip.spec.ts` — a settled turn survives the debounced
  autosave (`lib/persist.ts:makeAutosave`, 3s) as a well-formed
  `PersistedSession` in real IndexedDB.

Every test drives the board via `window.inpublic.express({ delta })`
(`lib/expression/entry.ts`) — skips meaning extraction entirely, no
Deepgram connection, no LLM call, fully deterministic (~14ms per call).

**Not covered, by design, documented in `tests/smoke/README.md`**: full
session **restoration** through the authenticated `/create` route.
`/create` requires a real Supabase session (enforced server-side in
`middleware.ts`); `/try` always mounts with `startFresh: true`
(`Board.tsx:6986`, pre-strip-down line), so there is no unauthenticated
route that both persists and restores through the real UI. Faking a
Supabase session was judged out of scope — risk of writing rows into
whatever project `.env.local` points at, and this phase's rules forbid
adding a new test-only bypass to product code. `persistence-roundtrip.spec.ts`
verifies the save half of the same mechanism for real instead.

Run: `npm run test:smoke`.

## Step 2 — Board.tsx deletion map (classification)

| Symbol | Classification | Resolution |
|---|---|---|
| `applyAction`, `applyActions`, `performComparison`, `performProcess` | LEGACY_ONLY | Deleted whole — zero callers outside the dead Tier-2/3 apparatus, confirmed via `lib/expression/*` grep returning zero hits for any of these names. |
| `buildConceptNode`, `buildConceptMove`, `animateConceptMotion`, `buildBoundArrow`, `nodeForConcept` | LEGACY_ONLY | Deleted — `buildBoundArrow`'s own backing (`lib/routing.ts`'s `routeArrow`/`labelSpot`) also confirmed zero remaining callers once these were gone; deleted too (Step 7). |
| `applyOp` | **MIXED — KEEP** | Also the sole drawing mechanism for the dormant Gemini Live engine (`hooks/useGeminiLive.ts`, `NEXT_PUBLIC_ENGINE=gemini`, off by default). User decision: leave Gemini/`applyOp` alone; only its Deepgram-side Scribe-scheduler callers were dead and removed. |
| `marksRef`, `sketchRef`, `conceptElementRef`, `pageMarksRef` | **MIXED — KEEP container, delete writers** | Also read by genuinely-live undo/page-turn/session-restore bookkeeping and by `applyOp` (kept for Gemini). Only the Artist/Comparison/Process/Math *write* call sites were removed; the refs themselves, and `turnPage`'s page-swap logic (used by the Expression Engine's own overflow page-turn, `Board.tsx` — "expression scene does not fit on the current sheet"), stay. |
| `reconcileSpeculativeRef`, `comparedPairsRef`, `directorStateRef` | LEGACY_ONLY | Deleted. `reconcileSpeculativeRef` is now permanently null (its setter was old-Reflex-only); `applyOp`'s existing `?.()` optional call handles that safely — zero change needed to `applyOp` itself. |
| `recordOperation`, `doUndo`, `emptyUndo`, `cancelConceptMotion` | ACTIVE_SHARED_INFRA | Kept whole. `recordOperation("expression_engine", ...)` at the Expression Engine's canvas-sync call site is the proof; `doUndo` calls `cancelConceptMotion` unconditionally, so that one small helper stays even though its only *setter* (`animateConceptMotion`) is gone — a permanently-harmless no-op guard now. |
| Old Reflex/Speculative (`growSketch`, `retireSpeculative`, `reconcileSpeculative`, `renderSpeculative`, `settleSpeculative`, `speculativeStateRef`/`speculativeMarksRef`/`speculativeUtteranceRef`) | LEGACY_ONLY | Deleted whole — only reachable from the dead `!v2Enabled`/`features.reflex` branch, confirmed before deleting. |
| Scribe scheduler (`runScribe`, `nudgeScribe`, `scribePendingRef`'s scheduling refs) | LEGACY_ONLY (scheduler) / **MIXED** (`scribePendingRef` itself) | `runScribe`/`nudgeScribe` deleted (zero remaining callers — Gemini's `handleLiveTranscript` was the other place `resetSilenceTimer`→`runBeat` was reachable from, and that call site was removed too, see below). `scribePendingRef`/`prevInterimRef`/`settledCountRef` **kept** — the latter two feed the live Tier-1 interim-tracking computation that the Expression Engine's `reflex()`/`anticipate()` calls consume (`Board.tsx` ~4494-4525), confirmed active before keeping. |
| Beat (`runBeat`, `enterReference`, `scoreBeatAgreement`, `localBeatDecision`) | LEGACY_ONLY | Deleted whole. Also discovered mid-session: Gemini's `handleLiveTranscript` called `resetSilenceTimer()` unconditionally (not gated on `!v2Enabled`), meaning Beat/Artist/Math *was* reachable via the Gemini path too — a scope correction from the initial "leave Gemini alone" framing (which only covered `applyOp`/drawing). Fixed by removing that one dead call site from Gemini's handler; Gemini's actual drawing (`handleLiveOps`→`applyOp`) is untouched. |

## Step 3 — Legacy Tier-2/Tier-3 removal (executed in verified groups)

**Group 1** — Beat/Artist/Organizer/Director/Choreographer/Math/AudioReplay:
removed `applyAction`/`applyActions`/`performComparison`/`performProcess`/
`unclaimedMarks`/`adoptMark`/`runBeat`/`enterReference` and all dead imports;
deleted `lib/{director,directorState,choreographerComparison,
choreographerProcess,organizer,actions,beatPrefilter,beat}.ts`,
`lib/math/{actions,arithmetic,fraction,ground,parse,verify,visuals}.ts`
(`lib/math/types.ts` kept — `lib/semantic.ts`, kept, imports
`MathReasoningStep` from it), `components/AudioReplayPanel.tsx`, `lib/audio/`
(whole dir, orphaned once `AudioReplayPanel` was gone). Test-side: deleted
`scripts/{pipeline-test,fake-board,math-test,math-benchmark,audio-test}.mjs`
(all tested exactly this removed code) and updated `package.json`.
Typecheck/build/test(48/3)/smoke(4/4) verified after.

**Group 2** — old Reflex/Speculative/Scribe: removed `growSketch`,
`retireSpeculative`/`reconcileSpeculative`/`renderSpeculative`/
`settleSpeculative`, the dead recognition `setTimeout` block, `runScribe`/
`nudgeScribe`; deleted `lib/speculative.ts`, `lib/scribeScheduler.ts`,
`scripts/latency-benchmark.mjs` (measured exactly this removed pipeline).
`lib/pulse.ts` **not** deleted — see Step 8. Typecheck/build/test/smoke
verified after.

## Step 4 — Story Mode removal

Removed from `Board.tsx`: the caption/render/undo apparatus
(`writeStoryCaption`, `clearStoryCaption`, `animateStoryElements`,
`renderStoryState`, `ensureStoryPage`, `applyStoryBatch`, `doStoryUndo` —
~440 lines), the story-queue apparatus (`runStoryQueue`,
`enqueueStorySegment`, `handleStoryPartial`, `handleStoryFinal` — ~250
lines), every `mode === "story"` branch inside shared functions
(`framePage`'s focal-bounds logic, `activeTerms`'s keyterms,
`runVoiceCommand`, Gemini's `handleLiveTranscript`/`handleLiveOps`,
`handleModeChange` — now fully removed since nothing can set mode to
"story" anymore, the debug `storyAct`/`storySay`/`storyPartial` helpers),
and the `ControlBar` mode-toggle UI (already dead behind
`features.storyMode`, now removed along with the flag). `app/create/page.tsx`
no longer reads `?mode=`.

**Kept, per this phase's own instruction**: `lib/story.ts` (as a
compatibility-type provider — `newStoryState()`/`restoreStoryState()` still
run so `PersistedSession.story` round-trips correctly for old data;
`InPublicMode`/`StoryState` types still shape `Board.tsx`'s `mode` state and
persistence). `lib/storyPrimitives.ts` — **discovered dependency, not on the
original target list**: `lib/story.ts` itself imports `isStoryEffect`/
`resolveProceduralRecipe` from it, so it cannot be deleted while `story.ts`
is kept. `lib/semantic.ts` — same compatibility-type role, unchanged from
Phase 1's decision.

**Deleted**: `app/api/story/route.ts`, `lib/storyV2.ts`, `lib/storyAssets.ts`
— confirmed zero product-code importers once `Board.tsx`'s branches were
gone (only the three now-deleted test scripts and a stale doc comment
referenced them). `scripts/{story-test,story-visual-test,story-v2-test}.mjs`
— tested exactly the removed implementation.

**Rewritten, not deleted**: `scripts/composition-test.mjs` — its first ~227
lines (spring convergence, retargeting, webcam-safe collision, hysteresis,
zoom bounds, live-narration recentering, math-step camera behavior) test the
still-ACTIVE general camera engine (`lib/composition.ts`) with zero Story
dependency and were kept; its last ~68 lines (Story-entity placement,
toward/away-from relations, Story-stage occupancy, mode-switch camera
transition) were Story-Mode-specific and removed, with a clean report
footer restored. Verified standalone: 12/12 checks pass.
`scripts/camera-replay-test.mjs` confirmed to import only
`lib/composition.ts` — no Story dependency, untouched.

**Dashboard UI left alone, deliberately**: `components/DashboardUI.tsx`'s
`ModeBadge` still renders an amber "Story" badge for historical sessions
whose persisted `mode` field is `"story"` — read-only display of existing
user data, not a way to create or interact with Story Mode, out of this
phase's scope.

Typecheck/build/test(48/3)/smoke(4/4) verified after.

## Step 5 — Audio Replay / legacy Math (completed inside Step 3's Group 1)

Folded into Group 1 above rather than run separately — `AudioReplayPanel.tsx`
was the forcing function for `applyActions`' removal, and both landed
together. `lib/math/types.ts` confirmed kept (needed by `lib/semantic.ts`).

## Step 6 — Backing modules

All deleted only after `Board.tsx`'s callers were verified gone (import
graph checked before every deletion, not inferred from the target list) —
see Steps 3–4 above for the specific files and the evidence for each.

## Step 7 — Ambiguous files resolved

| File | Verdict | Evidence |
|---|---|---|
| `lib/routing.ts` | **DELETE** | Its only consumer, `buildBoundArrow` (`lib/ops.ts`), had zero remaining callers once the legacy Artist/Comparison/Process/Math apparatus was gone (`grep buildBoundArrow` → only its own definition). Deleted `routeArrow`/`labelSpot` import from `ops.ts`, the `BuiltRelationship` interface + `buildBoundArrow` function themselves, the file, and its `unit-test.mjs`/`pipeline-test.mjs`(deleted) test coverage. |
| `lib/attention.ts` | **KEEP — active** | `withinInitialCompositionWindow`/`temporaryMarkBudgetReached`/`MAX_TEMPORARY_SCRIBE_MARKS` have real call sites in `applyOp` (kept, drives Gemini's drawing) and in page-turn-suppression logic. Only `visibleConceptBudgetReached`/`visibleRelationshipBudgetReached` (exclusively used by the now-deleted `applyAction`) were dropped from the import list. |
| `lib/ops.ts` | **SPLIT** | The file overall is ACTIVE (shared by the live Deepgram path, Gemini's `applyOp`, and `render/excalidrawSync.ts`'s `PAGE_W`/`PAGE_H`/`pageOrigin`/`place`/`willOverflow`/`buildLiveLine`/`buildOp`). One dead function, `buildBoundArrow` (see `routing.ts` above), was removed from it; everything else kept. |

## Step 8 — Feature-flag simplification

**Removed from `lib/features.ts`**: `storyMode`, `audioReplay`, `reflex`,
`choreographerComparison`, `directorV1` — all gated architecture that no
longer exists in the source tree. Updated every remaining reader:
`lib/preferences.ts` (`defaultMode` now hardcoded to `"standard"` — the
flag check it did is moot, Story Mode can't come back), `components/
SessionsBrowser.tsx` (filter chip unconditionally hides "Story Mode"),
`components/VocabularyEditor.tsx`/`app/dashboard/vocabulary/page.tsx`/
`app/dashboard/community/page.tsx`/`app/contact/page.tsx` (dead
`features.storyMode`-gated UI text/columns removed), `scripts/{features-test,
product-test}.mjs` (checks for the removed flags dropped).

**`Board.tsx`'s dead `if (v2Enabled)`/`else` branches collapsed** where the
diff was small and isolated: the live-line camera-follow decision (dead
`else` unconditional-follow branch removed, kept the real
`liveLineFitsViewport`-gated logic), the `!v2Enabled`-only
`dropSettledLiveLine()` call (removed — `dropSettledLiveLine` itself,
now fully unreferenced, deleted), the `v2Enabled &&`-guarded anchor-reset
diagnostic (simplified), `flushPresentationBoundary`'s `!v2Enabled ||` guard
(simplified), and `shownForLive`'s `v2Enabled &&` ternary (simplified) —
five sites total, each verified individually.

**Left uncollapsed, deliberately**: two `if (v2Enabled) {...}` blocks inside
the settled-thought handling function (`Board.tsx`, the thought-boundary
merge logic and the `writeLiveDone`/settle-flash-pulse assignment) — both
have a real `else` branch containing dead code (the pre-V2 presentation
path and its `opacityPulse`/`runPulse` settle-flash animation, which is why
`lib/pulse.ts` is still imported and not yet deleted). Collapsing these
correctly means restructuring the most latency/timing-sensitive part of the
whole file; behavior is already correct and unchanged either way (`v2Enabled`
is always `true`, so the `else` branches are already provably inert) — this
was judged not worth rushing at the end of a long session. Flagged as
remaining work below.

Handled the `mode`/`onModeChange` cleanup this forced: `handleModeChange`
had zero callers once `ControlBar`'s toggle UI was removed, deleted;
`ControlBar`'s `mode`/`onModeChange` props removed from its interface and
from `Board.tsx`'s call site. `mode`/`modeRef`/`InPublicMode` state itself
**kept** — still consumed by `<RecordingPanel mode={mode} ...>` and still
written into `PersistedSession.mode` for round-trip fidelity with existing
data.

Typecheck/build/test(48/3)/smoke(4/4) verified after every sub-step.

## Step 9 — Tests

Covered inline above per subsystem. Summary:

- **Deleted** (implementation removed): `pipeline-test.mjs`, `fake-board.mjs`,
  `math-test.mjs`, `math-benchmark.mjs`, `audio-test.mjs`,
  `latency-benchmark.mjs`, `story-test.mjs`, `story-visual-test.mjs`,
  `story-v2-test.mjs`.
- **Rewritten** (useful active capability, legacy fixtures): `unit-test.mjs`
  (removed `references`/`routing`/`organizer`/`beat responses`/`scribe
  scheduler`/`speculative visuals`/hazard-A/Part-7/`comparison director`/
  `comparison choreographer`/`director state`/`process evidence gathering`
  sections and their now-dead imports — kept everything else, 1820→~1050
  lines), `composition-test.mjs` (Story fixtures removed, general camera
  coverage kept, see Step 4), `foundation-test.mjs` (Phase 1, beat-route
  assertions removed), `scripts/features-test.mjs`/`product-test.mjs`
  (removed-flag assertions dropped).
- **Kept untouched**: all `expression-*-test.mjs` (Expression Engine,
  evaluator, clean/composition/presentation), `live-presentation-v2-test.mjs`,
  `demo-studio-test.mjs`, `camera-replay-test.mjs`, `express-mcp-test.mjs`.
- **Added**: the browser smoke suite (Step 1).

## Step 10 — Final proof

- **Typecheck**: clean.
- **Build**: clean, 20 routes (unchanged from Phase 1 — `/api/story` is the
  only route Phase 2 removed, and it was already counted out; no new routes
  added or removed beyond Phase 1's five).
- **Test** (`npm test`): **48 passed / 3 failed** — the exact same 3
  `EXPRESSION_PLANNING` failures listed in Step 0, byte-for-byte. No new
  failures anywhere in the chain.
- **Browser smoke** (`npm run test:smoke`): **4 passed / 4** —
  `board-boot`, `undo`, `page-camera`, `persistence-roundtrip`, re-verified
  after every group in this phase.

## Final file/module count changes (this phase, on top of Phase 1's 13)

37 additional files deleted: `app/api/story/route.ts`; `lib/{director,
directorState,choreographerComparison,choreographerProcess,organizer,
actions,beatPrefilter,beat,speculative,scribeScheduler,routing,storyV2,
storyAssets}.ts`; `lib/math/{actions,arithmetic,fraction,ground,parse,
verify,visuals}.ts`; `components/AudioReplayPanel.tsx`; `lib/audio/{chunk,
pipeline,replayController,transcribe,types}.ts`; `scripts/{pipeline-test,
fake-board,math-test,math-benchmark,audio-test,latency-benchmark,
story-test,story-visual-test,story-v2-test}.mjs`.

`components/Board.tsx`: **7500 → 4191 lines** (before any Phase-2-untracked
additions are counted; net diff for this phase alone: 736 insertions, 3546
deletions — a 44% reduction). `lib/features.ts`: 5 flags → 1
(`standardMode`; `livePresentationV2`/`expressionEngineV1`/
`expressionAnticipation` are still real, still-meaningful flags, not
removed).

New: `playwright.config.ts`, `tests/smoke/{board-boot,undo,page-camera,
persistence-roundtrip}.spec.ts`, `tests/smoke/{fixtures.ts,README.md}`.

## Final surviving runtime (unchanged shape from Phase 1, now with far less dead weight around it)

```
mic (Deepgram, live default; Gemini Live dormant behind NEXT_PUBLIC_ENGINE=gemini,
     draws via applyOp — kept, out of this strip-down's scope by user decision)
  -> Board.tsx handleFinal/handleInterim -> writeLive() -> live transcript on canvas
  -> ExpressionLiveController.submit() (lib/expression/live.ts)
       reflex() [zero-model]     anticipate() [rationed extra extraction]
  -> ExpressionSession.foldDelta() (lib/expression/pipeline.ts)
       identity/reference resolution -> WorldState (world/apply.ts)
       -> intent/classify.ts
       -> composition -> clean -> presentation (sequenced planning)
       -> planExpression -> compose/compose.ts (coordinates)
       -> evaluate/repair (bounded)
       -> diffScenes -> RenderPatch
  -> render/excalidrawSync.ts -> apiRef.updateScene() -> Excalidraw canvas
```

Undo, page-turns, session persistence/restore, and camera behavior all
route through the same shared infrastructure they always did
(`recordOperation`/`doUndo`, `turnPage`/`marksRef`/`sketchRef`,
`lib/persist.ts`, `lib/composition.ts`/`lib/cameraReplay.ts`) — none of it
was rebuilt or redesigned this phase, only had its dead writers removed.

## Remaining architectural debt (honest, for the record)

- Two `if (v2Enabled) {...} else {...}` blocks remain in the settled-thought
  handling function (Step 8) — inert (the `else` sides are dead) but not
  yet collapsed. `lib/pulse.ts` stays alive only because of these.
- `Board.tsx` is still large (4191 lines) and still the de facto app
  controller — Step 8/this phase's own rules explicitly forbade refactoring
  it smaller "merely to make it smaller"; only extinct responsibility was
  removed, per instruction.
- Expression Engine `WorldState` is still never persisted (Phase 1 finding,
  unchanged) — a page reload loses the meaning behind a drawing, keeping
  only the pixels.
- Gemini Live (`hooks/useGeminiLive.ts`, `applyOp`-based drawing) remains a
  second, non-Expression-Engine drawing path, dormant behind an env var,
  explicitly out of scope per user decision this phase.
- No browser test covers Gemini's path, Story Mode's historical `ModeBadge`
  display, or the camera engine beyond what `composition-test.mjs`/
  `camera-replay-test.mjs` already covered before this phase.
- The `?mode=` removal from `app/create/page.tsx` and `handleModeChange`'s
  deletion mean a session saved with `mode: "story"` now always resumes as
  `"standard"` — confirmed intentional (Story Mode has no rendering path
  left to resume into), not an oversight.

## Is there now exactly one visual runtime architecture in InPublic?

**Yes**, for the code that draws and manages the primary canvas experience:
speech → Expression Engine → Excalidraw is the only architecture that
builds structured visual output from meaning. Beat/Artist/Organizer/
Director/Choreographer/legacy Math, Story Mode, and Audio Replay are gone
from the source tree, not flagged off.

**One documented exception**: the dormant Gemini Live voice engine
(`NEXT_PUBLIC_ENGINE=gemini`, off by default, no committed-flag path to
production) still draws via `applyOp`'s direct mark-building
(`lib/ops.ts`), bypassing the Expression Engine entirely — a second,
smaller drawing mechanism, kept alive by explicit user decision mid-phase
rather than removed. It is genuinely dormant (an env var away from the
Deepgram-default path, not reachable by any current production user) and
was flagged, not silently kept.
