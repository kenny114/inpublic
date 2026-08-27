# Legacy and Dead Code — Archaeological Audit

## The single gate that explains most of this file

```js
// components/Board.tsx:6221-6227
if (!v2Enabled) {
  settleSpeculative(text);
  nudgeScribe();
  resetSilenceTimer();
}
```
```js
// components/Board.tsx:6420
if (fresh && features.reflex && !v2Enabled) { /* schedule Tier-2 recognition */ }
```
`v2Enabled` comes from `isLivePresentationV2Enabled()`
(`lib/features.ts:157-162`), which returns `true` unconditionally in
production because `features.livePresentationV2 = true` short-circuits before
any `NODE_ENV`/query-string check. `resetSilenceTimer` is the *only* caller of
`runBeat`, and `runBeat` is the only entry into Beat → Artist → Organizer →
Director/Choreographer → Math. `nudgeScribe()`'s only external call site is
the same dead branch. **This one `if` is why a large, well-imported,
type-checked, still-tested subtree of `lib/` is alive in the source tree and
unreachable at runtime.** Confirmed independently by two research passes
tracing the same code from different starting points.

Two predecessor *visual engines* — `lib/visualReentry/` and `lib/meaning/`
(a `SemanticState`-based engine) — are, by contrast, **actually deleted**
(confirmed: `ls` fails on both paths), matching `lib/features.ts:110-124`'s
claim. Those are gone; everything below is not.

## Classification table

| File / subsystem | Verified responsibility | Importers | Reachable today? | Category |
|---|---|---|---|---|
| `lib/story.ts`, `storyV2.ts`, `storyPrimitives.ts`, `storyAssets.ts` | Story Mode narrative engine | `app/api/story/route.ts`, `Board.tsx`, `ControlBar.tsx`, `DashboardUI.tsx`, `RecordingPanel.tsx` | **Yes, conditionally** — `storyMode:false` blocks *new* sessions, but `Board.tsx:6937` explicitly preserves story mode when an existing session is resumed by id | ACTIVE BUT LEGACY |
| `app/api/story/route.ts` | Story Mode's model call | `Board.tsx` (story-final handling) | Same as above | ACTIVE BUT LEGACY |
| `lib/director.ts` | Stateless per-beat comparison/process detectors | `Board.tsx`, `lib/directorState.ts` | No | PROBABLY SUPERSEDED |
| `lib/directorState.ts` | Persistent Director V1 state machine | `Board.tsx` | No | PROBABLY SUPERSEDED |
| `lib/choreographerComparison.ts` | Side-by-side comparison layout math | `Board.tsx` (dead branch only) | No | PROBABLY SUPERSEDED |
| `lib/choreographerProcess.ts` | 3-6 box process-chain layout math | `Board.tsx` (dead branch only) | No | PROBABLY SUPERSEDED |
| `lib/organizer.ts` | Reuse/adopt/create resolution for Artist actions | `Board.tsx` (dead branch only) | No | PROBABLY SUPERSEDED |
| `lib/beat.ts` | Parses the Beat model's response | `app/api/beat/route.ts` | Route exists; UI never calls it | PROBABLY SUPERSEDED |
| `lib/beatPrefilter.ts` | Local shadow classifier for Beat's verdict | `Board.tsx` (dead branch only) | No | PROBABLY SUPERSEDED |
| `lib/scribeScheduler.ts` | Scheduling for the Scribe tier | `Board.tsx`, `beatPrefilter.ts`, `speculative.ts` | No | PROBABLY SUPERSEDED |
| `lib/speculative.ts` | Tier-2 "Reflex" speculative-mark layer (the *old* reflex — see naming collision below) | `Board.tsx`, gated `features.reflex && !v2Enabled` | No | PROBABLY SUPERSEDED |
| `lib/pulse.ts` | Settle-animation primitives | `Board.tsx` — all 3 call sites sit inside `!v2Enabled` branches | No | PROBABLY SUPERSEDED |
| `lib/reference.ts` | "Going back to X" page-navigation detection | `Board.tsx` (inside Artist/`runBeat` flow) | No | PROBABLY SUPERSEDED |
| `lib/actions.ts` | `CanvasAction` schema for the Artist | `app/api/artist/route.ts`, `app/api/math/route.ts`, `AudioReplayPanel.tsx`, `Board.tsx`, `lib/organizer.ts` | No (only reached via `runBeat`) | ACTIVE BUT LEGACY (typed surface still shared with Math/AudioReplay) |
| `lib/math/*.ts` (actions, arithmetic, fraction, ground, parse, types, verify, visuals) | Math-domain layer for the Artist | `app/api/math/route.ts`, `Board.tsx`, `lib/actions.ts`, `lib/semantic.ts` | No, except via the also-dead `AudioReplayPanel` | PROBABLY SUPERSEDED |
| `lib/semantic.ts` | Legacy "semantic board" (concepts/relationships) that Beat/Artist/Organizer/Director operate on | `app/api/audio/upload/route.ts`, `AudioReplayPanel.tsx`, `Board.tsx`, `lib/actions.ts`, `lib/audio/pipeline.ts`, `director.ts`, `directorState.ts`, `exports.ts`, `organizer.ts`, `persist.ts`, `recordings.ts`, `reference.ts`, `types.ts` | Partial — **not** imported by `lib/expression/*` (zero grep hits); kept alive only by Story Mode + Audio Replay, both flagged off for new sessions | ACTIVE BUT LEGACY |
| `app/api/beat/route.ts`, `app/api/artist/route.ts`, `app/api/math/route.ts`, `app/api/scribe/route.ts` | Tier-3 API routes | Only called from `runBeat`/`nudgeScribe` | Routes remain live HTTP endpoints on the server; no client path calls them under current flags | PROBABLY SUPERSEDED (deployed, dead client-side) |
| `components/AudioReplayPanel.tsx` | Audio-file replay UI, calls `/api/math` and `/api/artist` | — | No — `features.audioReplay = false` | ACTIVE BUT LEGACY ("fully implemented and untouched" per the flags file's own policy) |
| `lib/replayAuthorizationPolicy.ts`, `lib/replayLab.ts`, `lib/replayPacing.ts`, `lib/demoStudio.ts`, `lib/corpus.ts`, `lib/corpusAudio.ts`, `lib/sttDebug.ts` | Dev-only replay/demo/corpus tooling | `Board.tsx` (dev-gated), `DevReplayLab.tsx`, `DemoStudio.tsx`, `hooks/useDeepgram.ts` | Dev-only, correctly gated (`isDev`, `NODE_ENV==="development"`) | ACTIVE BUT LEGACY (dev tooling, not user runtime — not a problem, just not product code) |
| `lib/cameraReplay.ts`, `lib/composition.ts` (root) | Camera proposal/spring-physics + camera geometry types | `Board.tsx` (unconditional call sites, lines 1235/1999), `lib/exports.ts`, `lib/pageArrivalCoalescing.ts`, `lib/persist.ts`, `lib/recordings.ts`, `lib/semantic.ts`, `lib/story.ts`, `lib/types.ts` | **Yes — genuinely active**, drives the camera regardless of engine generation | ACTIVE (not legacy — a pre-Expression-Engine file that is still the correct, unreplaced owner of its responsibility) |
| `lib/scene.ts` | Mermaid→Excalidraw conversion + grid layout | `Board.tsx`, `corpus.ts`, `exports.ts`, **`lib/expression/render/excalidraw.ts`, `render/excalidrawSync.ts`**, `math/visuals.ts`, `ops.ts`, `persist.ts`, `semantic.ts`, `story.ts`, `storyAssets.ts` | **Yes — shared infra**, actively used by the current Expression Engine's renderer | ACTIVE (shared, not legacy) |
| `lib/vocab.ts` | Phonetic term-correction / Deepgram keyterm biasing | `Board.tsx`, `lib/organizer.ts`, `lib/reference.ts` | Its `organizer.ts`/`reference.ts` uses are dead; its direct Board.tsx keyterm-biasing use was not fully traced to a specific gate | UNKNOWN (partial) |
| `lib/attention.ts` | Composition/attention-budget helpers | `Board.tsx` (import found, no confirmed call site in the gated-path grep) | Unclear | PROBABLY SUPERSEDED |
| `lib/routing.ts` | Orthogonal arrow routing/elbow geometry | `lib/ops.ts` | `lib/ops.ts`'s own reachability to the current engine wasn't fully traced | UNKNOWN |
| `lib/attribution.ts` | Client-side UTM/referrer capture | `app/try/page.tsx` (unconditional on page view) | Yes | ACTIVE (unrelated to the engine question — marketing analytics) |
| `lib/demos.ts` | Metadata for 3 marketing demo videos | `LandingSections.tsx`, `VisualDemo.tsx` | Yes | ACTIVE (marketing surface) |

## Naming collisions worth flagging on their own

1. **"Reflex" means two unrelated things.** `features.reflex` (`lib/
   features.ts:26-35`) governs the *old* Tier-2 speculative-mark system
   (`lib/speculative.ts`) — dead under V2. `lib/expression/fast/reflex.ts` +
   `ExpressionLiveController.reflex()` is the *current* engine's zero-model
   fast entity path — very much alive, runs on every settled word,
   gated only on `xeEnabled`. An auditor (or a future engineer) reading
   `features.reflex`'s doc comment could easily assume it governs the
   Expression Engine's reflex. It does not, and nothing in the code
   disambiguates the names.
2. **"Composition" means two unrelated things.** `lib/composition.ts` (root)
   is camera geometry (spring types, `CameraView`). `lib/expression/
   composition/*` is the Expression Engine's story/spine-selection stage.
   Same word, adjacent import paths, entirely different responsibilities —
   both are ACTIVE, which makes this collision more dangerous than the
   reflex one (nothing here is dead code to eventually delete; both meanings
   need to keep existing).
3. **`isLivePresentationV2Enabled`'s dev-override language is itself dead.**
   `lib/features.ts:87-91`'s doc comment describes a `?v2=1` override; the
   function (`157-162`) returns `true` before that branch can ever run, and
   the comment admits it ("`?v2=1` is now a no-op") — a comment describing
   its own dead code, correctly, but still worth noting as a case where the
   flags file itself models discrepancy between stated and actual behavior.

## Pre-existing audit docs vs. current code

`AUDIT.md`, `AUDIT-2.md`, `AUDIT-3.md`, `COST-AUDIT.md`, `LATENCY-AUDIT.md`,
`SPEECH-ACCURACY-AUDIT.md`, `SPEECH-TO-VISUAL-AUDIT.md`, `PLAN.md` (repo
root) are dated 2026-08-07 through 2026-08-14 — all **before**
`livePresentationV2`'s production activation (2026-08-17) and Expression
Engine V1's activation (2026-08-20). They are honest, well-evidenced
snapshots (tagged `[CODE]`/`[MEASURED]`/`[TESTED]`) of the architecture this
audit found to be dead-at-runtime today (the Beat→Artist→Organizer→Director→
Scribe/Reflex pipeline). None contradict the current code — they describe a
system generation the codebase has since replaced while leaving the old code
in place. Their latency/cost/accuracy numbers are stale, not wrong, for the
system as it stood on those dates.

## scripts/ grouped by subsystem (58 files)

- **Expression Engine (current, ACTIVE)**: 18 `expression-*.mjs` files
  (test/replay/audit variants) + `express-mcp-server.mjs`,
  `express-mcp-test.mjs`, `express-say.mjs`, `thought-boundary-v3-replay.mjs`,
  `merge-replay-investigation.mjs`, `freeze-meeting-deltas.mjs`.
- **Live Presentation V2 / camera (current, ACTIVE)**: `live-presentation-
  v2-test.mjs`, `camera-policy-ab.mjs`, `camera-replay-test.mjs`,
  `composition-test.mjs`, `overview-camera-audit.mjs`,
  `overview-eligibility-v2-ab.mjs`.
- **Story Mode (ACTIVE BUT LEGACY)**: `story-test.mjs`, `story-v2-test.mjs`,
  `story-visual-test.mjs` — all three run in `npm test` and pass, testing a
  feature flagged off for new sessions.
- **Math (PROBABLY SUPERSEDED)**: `math-benchmark.mjs`, `math-test.mjs` —
  test a dead branch (only reachable via `runBeat` or the parked
  AudioReplayPanel).
- **STT/audio accuracy (ACTIVE, not flag-gated)**: `audio-test.mjs`, `stt/`
  directory, three `*-speech.ps1` scripts.
- **Demo capture / Demo Studio (ACTIVE BUT LEGACY, dev-only)**:
  `demo-capture-run.mjs`, `demo-capture-server.mjs`, `demo-driver.js`,
  `demo-studio-test.mjs`.
- **Latency/cost benchmarking (ACTIVE, engine-agnostic)**:
  `latency-benchmark.mjs`, `live-probe.mjs`.
- **General/foundation test harness**: `foundation-test.mjs`,
  `pipeline-test.mjs`, `product-test.mjs`, `features-test.mjs`,
  `unit-test.mjs`, `fake-board.mjs`, `ts-hooks.mjs`, `ts-register.mjs`.

At minimum 5 of the ~21 scripts wired into `npm test`
(`story-test`, `story-v2-test`, `story-visual-test`, `composition-test`,
`camera-replay-test`) plus `audio-test.mjs` and the two `math-*` scripts
regression-test features that are either flagged off or dead-at-runtime.
That's real CI time and maintenance surface spent on unreachable code paths.

## Gaps not resolved by static inspection

`lib/attention.ts` and `lib/vocab.ts`'s direct `Board.tsx` call site, and
`lib/routing.ts`'s reachability via `lib/ops.ts`, could not be conclusively
traced to a specific gate from two independent research passes. Marked
UNKNOWN above rather than guessed.
