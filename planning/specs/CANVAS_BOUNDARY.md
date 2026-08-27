# Canvas Boundary Specification

## Scope

Phase 4 establishes one InPublic-owned boundary for current canvas application. It extracts existing behavior; it does not add perception, new actions, a second canvas implementation, or a new agent loop.

The dependency direction is:

```text
Meaning -> Expression -> Canvas contracts -> Excalidraw implementation
```

`MeaningDelta`, `WorldState`, visual intent, `ScenePlan` semantics, `RenderPatch` semantics, camera targets, and page-turn policy remain InPublic decisions. Excalidraw element conversion, stable canvas ids, reconciliation, imperative scene application, and viewport application belong to Canvas.

## Upstream basis

Inspected Excalidraw `master` at `e1bb9ff8f8931e783c11d104abb8967ac6605c9a` (2026-08-26). The current `ExcalidrawImperativeAPI` exposes `updateScene`, `applyDeltas`, `mutateElement`, `getSceneElements`, `getSceneElementsIncludingDeleted`, `getAppState`, `getFiles`, and `setViewport`. `convertToExcalidrawElements` remains a package-root export and regenerates ids unless `regenerateIds: false` is supplied.

InPublic currently installs `@excalidraw/excalidraw 0.18.1`. Its imperative API exposes `updateScene`, the scene/app/file reads, and `scrollToContent`, but not the newer `applyDeltas`, imperative `mutateElement`, or `setViewport`. This phase does not upgrade Excalidraw. Exact current behavior therefore remains `updateScene({ appState: { scrollX, scrollY, zoom } })`, owned behind the new boundary.

## Pre-extraction touchpoint map

| Location | Touchpoint | Classification | Phase 4 disposition |
| --- | --- | --- | --- |
| `components/Board.tsx` mount | `<Excalidraw>`, `excalidrawAPI`, `onChange` | USER-INTERACTION | Board keeps mounting/wiring the editor; the mounted instance is attached to Canvas. |
| `Board.tsx` `commit` | `apiRef.updateScene({ elements })` | RECONCILIATION | Route through Canvas scene application. |
| `Board.tsx` camera lifecycle | four `getAppState` reads and three animated `updateScene({ appState })` writes | VIEWPORT | Route reads and viewport application through Canvas; retain camera policy/animation in Board and `lib/composition.ts`. |
| `Board.tsx` replay reset | direct scroll/zoom `updateScene` | VIEWPORT | Route through Canvas viewport application. |
| `Board.tsx` expression update | `syncExpressionCanvas`, `ExpressionIdentity`, bounds, overflow callback | RECONCILIATION / VIEWPORT | Canvas owns reconciliation and identity; Board retains page-turn decision, logging, undo, and camera-target policy. |
| `Board.tsx` `elementsRef` edits | in-memory element patches followed by `commit` | USER-INTERACTION / COMPATIBILITY | Preserve edits; all eventual editor mutation passes through Canvas. |
| `lib/expression/render/excalidraw.ts` | skeleton creation, conversion, stable ids | RENDER / RECONCILIATION | Move implementation under `lib/canvas/excalidraw`; retain a compatibility export only. |
| `lib/expression/render/excalidrawSync.ts` | signature diff, identity, region placement, conversion, merge | RECONCILIATION / VIEWPORT | Move implementation under Canvas. Page-placement and overflow policy remain explicit InPublic inputs/decisions. Retain a compatibility export only. |
| `lib/ops.ts` | skeleton conversion for transcript ink and operations | COMPATIBILITY / DORMANT_GEMINI | Leave semantic behavior unchanged. Its writes reach Excalidraw only through Canvas commit; direct skeleton construction remains documented debt. |
| `Board.handleLiveOps -> applyOp` | Gemini model `Op[]` becomes elements | DORMANT_GEMINI_EXCEPTION | Do not redesign. Final scene application uses Canvas cheaply; operation semantics remain the documented exception. |
| `lib/scene.ts` | Mermaid conversion and shared `SceneElement` shape | COMPATIBILITY | Preserve for surviving transcript/export/persistence compatibility; not part of Expression planning. |
| `lib/corpus.ts` | conversion plus immutable screenshot export | RENDER / COMPATIBILITY | Offline evaluation/export only; not live scene mutation. Leave unchanged. |
| `lib/exports.ts` | Excalidraw JSON/PNG/SVG serialization | PERSISTENCE / COMPATIBILITY | Export boundary, not live scene mutation; leave unchanged. |
| `lib/persist.ts` | persists `SceneElement[]` | PERSISTENCE | Preserve schema and behavior. No `WorldState` persistence is added. |
| `lib/composition.ts`, `lib/cameraReplay.ts` | camera target and animation-policy calculations | VIEWPORT | Remain technology-independent policy; Canvas only applies the resulting viewport. |

No surviving runtime use of `applyDeltas`, `mutateElement`, `getSceneElements`, `getSceneElementsIncludingDeleted`, `getFiles`, `setViewport`, or `scrollToContent` was found before extraction. There is no `CanvasObservation` or reasoning input derived from the mounted editor.

## Required live contract

The boundary exposes only current needs:

- attach/detach the mounted editor instance;
- apply the current in-memory element scene;
- read the viewport fields already used by camera policy;
- apply a computed viewport;
- reconcile one `ScenePlan`/`RenderPatch` against current elements while retaining canvas identity;
- reset expression-owned canvas identity when the application resets the board.

The contract must preserve untouched elements, stable ids, patch-only reconciliation, two-phase sketch upgrades, page overflow callbacks, undo inputs, and the exact camera values currently applied.

## Explicit exclusions

No observation model, selection interpretation, drift detection, `CanvasObservation`, `CanvasAction`, pointing, connection action, focus action, agent movement, or observe-reason-act loop is introduced.
