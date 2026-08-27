# Current Stripped Architecture

This is the primary visual runtime that exists now. It is a factual map, not a target design.

```text
Deepgram
  → Board
  → ExpressionLiveController
  → ExpressionSession
  → meaning
  → WorldState
  → intent
  → expression planners
  → compose
  → evaluate/repair
  → ScenePlan / RenderPatch
  → CanvasRuntime
  → Excalidraw adapter
  → Excalidraw
       │ live structural reads
       ▼
  CanvasRuntime.observe()
       │
       ▼
  CanvasObservation (currently unconsumed)
```

`Board.tsx` is the application orchestrator: it connects speech, settled thoughts, the live controller, Canvas, camera/page policy, undo, persistence, and UI. `ExpressionLiveController` owns live batching and cadence. `ExpressionSession` owns the in-memory semantic world, deterministic planning, composition, evaluation/repair, the last `ScenePlan`, and patch generation. `CanvasRuntime` owns expression reconciliation and canvas identity plus imperative element and viewport application. The Excalidraw implementation under `lib/canvas/excalidraw/` converts scene output and reconciles it with the live editor.

The semantic source of truth is `WorldState`; the engine itself does not consume the current Excalidraw scene. Canvas can now explicitly read and normalize the live non-deleted elements, selection, and viewport into a `CanvasObservation`. This is developer/test-visible structural perception only: no model, Meaning stage, WorldState fold, intent stage, or agent reacts to it. The last `ScenePlan` still supports incremental diffing but is not used as canvas perception. `WorldState` is reset with the controller and is not part of `PersistedSession`, so it does not survive reloads.

Canvas application now has one explicit owner. `Board.tsx` mounts Excalidraw and attaches the instance to `CanvasRuntime`; it does not call `updateScene` or `getAppState` directly. Board still owns application policy: page-turn decisions, camera targets and animation, undo, persistence triggers, and UI. Compatibility exports remain in `lib/expression/render/excalidraw*.ts`, but their implementation lives under Canvas.

## DORMANT / NON-DEFAULT EXCEPTION

Gemini Live is enabled only when `NEXT_PUBLIC_ENGINE=gemini`; Deepgram is the default. It does not follow the primary Expression Engine path. Gemini receives model-produced `Op[]` values and `Board.handleLiveOps` applies each through `applyOp`; the resulting element scene is applied through Canvas. Its operation-to-element semantics remain an explicit exception, not represented as Meaning → `WorldState` → planning.

## Recorded baseline

- Branch: `expression-engine-default`
- Commit: `072e5c56233da4f0aae126c4383f1843f235f672`
- `Board.tsx`: 4,191 lines before these documentation-only changes
- Typecheck: clean (`npm run typecheck`, 2026-08-26)
- Build: clean (`npm run build`, 2026-08-26)
- `npm test`: 48 passed / 3 known pre-existing `EXPRESSION_PLANNING` failures (2026-08-26)
- Browser smoke: 4/4 passed (`npm run test:smoke`, 2026-08-26)

## Phase 5 canvas perception

- Installed Excalidraw: `0.18.1`.
- `CanvasRuntime.observe()` returns an InPublic-owned snapshot; raw Excalidraw elements and `AppState` remain inside `lib/canvas/excalidraw/`.
- Snapshot fields cover live element identity/type/geometry/text/groups/container/frame/order/revision, selected element/group ids, and viewport position/zoom/size.
- Independent scene, selection, and viewport fingerprints make unchanged and interaction-only snapshots distinguishable.
- Observation is explicit and side-effect-free; no Excalidraw event subscription is registered.
- `window.inpublic.observe()` exposes snapshots in development only for tests and developer inspection.
- Phase 5 verification: typecheck and build clean; Canvas boundary, observation, and dependency checks passed; Expression checks 1,254/0; `npm test` remains 48 passed / the same 3 known failures; browser smoke is 5/5 including live observation.

## Phase 4 verification

- `Board.tsx`: 4,186 lines
- Canvas boundary contract test: passed
- Typecheck: clean (`npm run typecheck`, 2026-08-26)
- Build: clean (`npm run build`, 2026-08-26)
- `npm test`: 48 passed / the same 3 known `EXPRESSION_PLANNING` failures (2026-08-26)
- Browser smoke: 4/4 passed (`npm run test:smoke`, 2026-08-26)
