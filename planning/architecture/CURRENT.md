# Current Stripped Architecture

This is the primary visual runtime that exists now. It is a factual map, not a target design.

```text
                     Explicit instruction
                              │
                              ▼
                       ┌─────────────┐
                       │ VisualAgent │
                       └──────┬──────┘
                              │
             ┌────────────────┴────────────────┐
             ▼                                 ▼
         WorldState                    CanvasObservation
             │                                 ▲
             └──────────────┬──────────────────┘
                            ▼
                      AgentDecision
                            │
                            ▼
                       VisualAction
                            │
                            ▼
                        Dispatcher
                            │
                       ┌────┴────┐
                       ▼         ▼
                   Semantic    Canvas
                       │         │
                       ▼         │
                   WorldState    │
                       │         │
                       ▼         │
                Expression Engine│
                       └────┬────┘
                            ▼
                          Canvas
                            │
                            ▼
                       Excalidraw
                            │
                            ▼
                   CanvasObservation
                            │
                            └──── next iteration

Deepgram interim/settled speech → Board → ExpressionLiveController
                                      → WorldState → Expression → Canvas
```

`Board.tsx` is the application orchestrator: it connects speech, settled thoughts, the live controller, Canvas, camera/page policy, undo, persistence, and UI. `ExpressionLiveController` owns live batching and cadence. `ExpressionSession` owns the in-memory semantic world, deterministic planning, composition, evaluation/repair, the last `ScenePlan`, and patch generation. `CanvasRuntime` owns expression reconciliation and canvas identity plus imperative element and viewport application. The Excalidraw implementation under `lib/canvas/excalidraw/` converts scene output and reconciles it with the live editor.

The semantic source of truth is `WorldState`; the Expression engine itself does not consume the current Excalidraw scene. `WorldState` snapshots to a validated version-1 `PersistedExpressionState` carried by the same `PersistedSession` as canvas elements. Reload/project reopen restores that state directly into the active Expression runtime, while old or corrupt semantic payloads fall back empty without blocking canvas restoration. Canvas normalizes live elements, selection, and viewport into `CanvasObservation`. Phase 8's Agent is the only reasoning owner that consumes that observation; Meaning, WorldState folding, intent, and Expression still do not. The last `ScenePlan` supports incremental diffing and identity mapping but is not canvas perception or persisted semantic memory.

Canvas application now has one explicit owner. `Board.tsx` mounts Excalidraw and attaches the instance to `CanvasRuntime`; it does not call `updateScene` or `getAppState` directly. Board still owns application policy: page-turn decisions, camera targets and animation, undo, persistence triggers, and UI. Compatibility exports remain in `lib/expression/render/excalidraw*.ts`, but their implementation lives under Canvas.

Phase 7 adds a geometry-free `VisualAction` language and deterministic dispatcher under `lib/visual-actions/`. Semantic `express`, exact-id update/removal, and relationship actions mutate WorldState through Expression and then reuse the ordinary ScenePlan/RenderPatch/Canvas path. Presentation-only `focus` resolves a semantic id through the current ScenePlan's derived canvas identity and applies a Canvas viewport.

Phase 8 adds one bounded `VisualAgent` under `lib/agent/`. It compacts current WorldState and CanvasObservation into an InPublic-owned model context, validates one strict `AgentDecision`, executes at most one VisualAction, re-observes, feeds compact ActionResult facts into the next decision, and returns a structured terminal status. Default budget is four actions and the boundary caps it at eight. Repeated identical noop/rejection or repeated applied-without-progress stalls deterministically. Development exposes `window.inpublic.runVisualAgent(...)` and an inspectable last run. Scripted decisions exercise the complete loop without provider cost; live decisions use the existing guarded centralized model abstraction. Continuous speech does not invoke this loop.

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

## Phase 6 durable semantic memory

- `PersistedSession.expressionState` carries a strict `{ version: 1, world }` envelope through IndexedDB and existing `projects.canvas_json` storage.
- Expression owns validation and semantic meaning; Session stores the envelope without interpreting it.
- The active controller snapshots/restores through a supported lifecycle seam and resumes its sequence clock after the saved `WorldState.seq`.
- Missing, unsupported, malformed, and partially corrupt semantic payloads fall back to an empty runtime without blocking the canvas.
- Canvas and semantic memory are one project version, including 409 recovery copies.
- Restore itself does not consume `CanvasObservation` and cannot change restored WorldState; only an explicit Phase 8 Agent run may read both independent truths.

## Phase 7 visual action language

- Public name: `VisualAction`, not `CanvasAction`.
- Supported semantic actions: `express`, `update_entity`, `remove_entity`, `relate_entities`, `remove_relation`.
- Supported presentation action: `focus` by semantic entity id.
- Strict schemas reject raw coordinates, raw shapes, canvas element ids, and unknown operations.
- Dispatch results are structured `applied`, `noop`, or `rejected`; ordinary invalid control flow does not throw.
- Repositioning, highlighting/pointer presence, agent judgment, and observe-decide-act remain absent.

## Phase 8 bounded visual agent

- One agent, one strict decision, and at most one VisualAction per iteration.
- Compact semantic ids/relationships/claims plus normalized canvas bounds, selection, viewport, text, and revisions are supplied to reasoning.
- Raw Excalidraw types, editor APIs, renderer internals, and action geometry remain withheld.
- Canvas is re-observed after every action and ActionResult is explicit feedback.
- Terminal statuses are completed, blocked, step_limit, or stalled.
- No generic canvas/world reconciliation, action batches, multi-agent swarm, or continuous-speech rerouting exists.

## Phase 4 verification

- `Board.tsx`: 4,186 lines
- Canvas boundary contract test: passed
- Typecheck: clean (`npm run typecheck`, 2026-08-26)
- Build: clean (`npm run build`, 2026-08-26)
- `npm test`: 48 passed / the same 3 known `EXPRESSION_PLANNING` failures (2026-08-26)
- Browser smoke: 4/4 passed (`npm run test:smoke`, 2026-08-26)
