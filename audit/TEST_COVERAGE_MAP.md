# Test Coverage Map

## `npm test` chain — one script at a time

| Script | Subsystem | Network/LLM | Active or legacy? |
|---|---|---|---|
| `foundation-test.mjs` | Static-text assertions over migration SQL + route source files | None | Active (billing/auth plumbing) |
| `unit-test.mjs` | Deterministic decision layers, pure functions | None | Active |
| `pipeline-test.mjs` | Six conversations end-to-end, offline against recorded Artist responses by default; `test:live` (separate script, not in `npm test`) hits a real dev server | None by default | Active |
| `story-test.mjs` | `lib/story.ts`, `storyAssets.ts`, `semantic.ts` | None | **Legacy** — `storyMode:false` |
| `story-visual-test.mjs` | Visual Action Engine for Story Mode | None | **Legacy** |
| `story-v2-test.mjs` | `lib/storyV2.ts`, `lib/story.ts` | None | **Legacy** |
| `composition-test.mjs` | `lib/composition.ts` (camera), `storyV2.ts` | None | **Legacy** (Story Mode's composition layer, not the Expression Engine's `composition/`) |
| `camera-replay-test.mjs` | `lib/cameraReplay.ts`, `lib/composition.ts` | None | **Legacy** (Story Mode camera; note the *general* camera engine these files also drive is ACTIVE — this test's scenario set is Story-Mode-flavored per its imports) |
| `math-test.mjs` | Math domain layer | None | Legacy-adjacent (reachable only via dead `runBeat`/parked AudioReplay) |
| `audio-test.mjs` | Audio Replay Mode's offline pieces; explicitly documents it does NOT cover the live Deepgram call or browser scrub UI | None | **Legacy/parked** — `audioReplay:false` |
| `math-benchmark.mjs` | Verification layer benchmark | None by default | Legacy-adjacent |
| `live-presentation-v2-test.mjs` | Flag/merge/camera-fit logic, deterministic, without mounting Board.tsx | None | **Active** — protected baseline |
| `demo-studio-test.mjs` | Format/pixel validation for demo capture | None | Active-adjacent (marketing tooling) |
| `features-test.mjs` | Confirms flag values + preference clamping | None | Active (meta-test) |
| `expression-test.mjs` | Every deterministic Expression Engine layer + full pipeline over a 100-case corpus; extractor output supplied as fixtures | None (fixture-replayed) | **Active — core engine** |
| `expression-clean-test.mjs` | Clean Agent (occupancy/primary/relation discipline) | None | Active |
| `expression-composition-test.mjs` | Composition Agent | None | Active |
| `expression-presentation-test.mjs` | Presentation Agent + Clean/Draw gates | None | Active |
| `expression-evaluator-test.mjs` | Adversarial tests against deliberately broken scenes | None | Active |
| `expression-discover.mjs` | Error-discovery loop across scenario replays; asserts meaning-survival, not pixel output | None (replay) | Active |
| `express-mcp-test.mjs` | MCP transport end-to-end: real child process, real JSON-RPC/stdin, fetch to a loopback bridge | Local-only, no external LLM | Active (dev tool) |
| `product-test.mjs` | Static-text assertions over marketing/pricing/product UI source | None | Active |

**At least 7 of the ~21 `npm test` scripts** (`story-test`,
`story-visual-test`, `story-v2-test`, `composition-test`,
`camera-replay-test`, `audio-test`, plus `math-test`/`math-benchmark` if
counted) exercise flagged-off or dead-at-runtime code paths. They run and
pass on every CI invocation, at real maintenance cost, testing a product
generation no user can currently reach.

## Browser / UI-interaction testing

**None found.** No `playwright.config.*`, no `*.spec.ts` anywhere outside
`node_modules`. `.playwright-cli/` contains only timestamped `console-*.log`
files — manual/ad hoc CLI run artifacts, not a CI suite; no config or spec
files alongside them. `output/playwright/` holds screenshots/recordings from
similar manual runs. There is no automated verification that the product
actually renders correctly in a browser.

## Visual/perceptual evaluation — real, but manual and human-reviewed

`scripts/expression-critical-replay.mjs`, `expression-meeting-stress-
replay.mjs`, `expression-visibility-audit.mjs`,
`expression-target-failure-audit.mjs` are **not wired into `package.json`**
at all — standalone diagnostic tools, run by hand. Their own header comments
say so explicitly: `expression-meeting-stress-replay.mjs` states "This is not
a pass/fail fixture... By design this does NOT auto-fix anything it finds...
Categorizing what went wrong is a human judgment call made by reading the
output." `expression-critical-replay.mjs` states it is "deliberately NOT
asserting the engine should be rewritten to pass everything — it's a
baseline."

The ~25 `docs/EXPRESSION-ENGINE-*.md` files are the output of exactly this
process — narrative, human-authored analyses of specific captured sessions.
One example: `LIVE-EVAL-3-REPORT.md` walks a real 41-minute session log with
specific timestamps and measured percentages ("Preservation < 0.05: 29/45
updates (64%)") to diagnose a specific bug (stale entities surviving a topic
change because visibility windows are turn-counted, not wall-clock). This is
rigorous evaluation methodology — but it is manual and report-driven, not
CI-gated regression testing. A regression in visual quality would not fail a
build; it would only be caught the next time someone runs one of these
scripts and reads the output.

## Coverage-by-subsystem rating

| Subsystem | Rating | Evidence |
|---|---|---|
| Expression Engine deterministic layers | **Tested strongly** | 100-case corpus + dedicated per-agent tests + adversarial evaluator tests, all offline/deterministic |
| Expression Engine extraction (LLM layer) | **Tested partially** | Fixture-replayed in CI (real output frozen as fixtures); only exercised live via manual, non-CI replay scripts |
| Canvas rendering (Excalidraw conversion/sync) | **Tested partially** | `planCanvasDiff` is stated to be unit-testable pure logic (`excalidrawSync.ts:116-120`), but no dedicated automated test file for `excalidraw.ts`/`excalidrawSync.ts` was confirmed present |
| Agent tool / MCP bridge | **Tested strongly** (transport only) | `express-mcp-test.mjs`, real process/real JSON-RPC |
| Persistence (Supabase/IndexedDB round-trip) | **Tested partially** | `foundation-test.mjs` does static text assertions against route/migration files, not actual read/write round trips |
| Voice/STT (Deepgram, Gemini Live) | **Not tested** | `audio-test.mjs` explicitly disclaims covering the live Deepgram call; no Gemini Live test found |
| Story Mode | **Tested strongly, for dead code** | Thorough deterministic coverage of a feature flagged off for new sessions |
| Math mode | **Tested strongly** for the verification layer; **not tested** for live model step-choosing | `math-test.mjs`, `math-benchmark.mjs` |
| Camera/viewport engine | **Tested, but under Story-Mode-flavored scenarios** | `camera-replay-test.mjs`'s imports lean on `lib/composition.ts`/`storyV2.ts`; general-purpose camera coverage independent of Story Mode not confirmed separately |
| Visual quality / semantic fidelity | **Tested, but manually and non-continuously** | The `expression-*-replay.mjs`/`*-audit.mjs` + `docs/EXPRESSION-ENGINE-*.md` corpus — real and rigorous, but not automated regression protection |

## "Test exists" is not "behavior is guaranteed" — the concrete caveats

- A 100-case corpus test passing does not mean the *live* extraction model
  (not the frozen fixtures) still produces compatible output — model
  drift/prompt drift between the corpus's frozen fixtures and today's live
  API responses is not caught by CI.
- The repair loop (`evaluate/repair.ts`) is exercised by `expression-
  evaluator-test.mjs`'s adversarial scenarios, but there is no confirmed test
  asserting the *live* pipeline actually triggers repair under real
  extraction output at the rate the human-reviewed reports (e.g.
  `LIVE-EVAL-3-REPORT.md`'s 64% preservation-failure finding) suggest it
  should.
- No test in the CI chain touches a real browser, so a change that breaks
  Excalidraw rendering, camera behavior, or the mic pipeline visually would
  not be caught by `npm test` at all — only by someone manually running the
  app or one of the replay scripts and looking at the output.
