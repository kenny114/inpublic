# Phase 4: Canvas Boundary

## Result

Phase 4 established one explicit runtime boundary between Expression output and Excalidraw without changing visual behavior. Active Expression Engine reconciliation, canvas identity, element application, viewport reads, and viewport writes now pass through `lib/canvas/`. No canvas perception or agent loop was added.

## Upstream Excalidraw inspected

- Repository: https://github.com/excalidraw/excalidraw
- Branch: `master`
- SHA: `e1bb9ff8f8931e783c11d104abb8967ac6605c9a`
- Inspected: 2026-08-26

The inspected `ExcalidrawImperativeAPI` includes `updateScene`, `applyDeltas`, `mutateElement`, `getSceneElements`, `getSceneElementsIncludingDeleted`, `getAppState`, `getFiles`, and `setViewport`. `convertToExcalidrawElements` remains exported at the package root. InPublic installs `0.18.1`, whose viewport API predates `setViewport`; this extraction preserves the existing `updateScene({ appState })` payload behind Canvas rather than combining the work with an Excalidraw upgrade.

## Old ownership map

```text
Expression ScenePlan / RenderPatch
  -> lib/expression/render/excalidraw.ts       conversion + stable ids
  -> lib/expression/render/excalidrawSync.ts   reconciliation + identity + region placement
  -> Board.tsx                                 apiRef + updateScene + getAppState
  -> Excalidraw
```

`Board.tsx` held the mounted API and made five direct `updateScene` calls, four direct `getAppState` reads, and one direct converter-preload import. Expression-named modules contained all Excalidraw conversion and reconciliation implementation.

## New ownership map

```text
Meaning
  -> Expression
  -> ScenePlan / RenderPatch
  -> CanvasRuntime
       -> Excalidraw conversion
       -> canvas identity + reconciliation
       -> element application
       -> viewport read/application
  -> Excalidraw
```

Board mounts Excalidraw and attaches the instance to Canvas. It retains app policy—undo, persistence triggers, page-turn decisions, camera targets, animation timing, and UI—but calls the InPublic contract for all imperative canvas access.

## Files moved

- Excalidraw conversion, skeleton construction, and stable-id implementation moved from `lib/expression/render/excalidraw.ts` to `lib/canvas/excalidraw/conversion.ts`.
- Expression-region identity, signature diffing, reconciliation, conversion/merge, and overflow integration moved from `lib/expression/render/excalidrawSync.ts` to `lib/canvas/excalidraw/sync.ts`.

## Files created

- `lib/canvas/index.ts` — public boundary exports.
- `lib/canvas/types.ts` — the small current `CanvasRuntime` contract and request/viewport types.
- `lib/canvas/excalidraw/adapter.ts` — mounted editor ownership, canvas identity, and application orchestration.
- `lib/canvas/excalidraw/viewport.ts` — the installed Excalidraw API port plus normalized viewport read/application.
- `lib/canvas/excalidraw/conversion.ts` — moved Excalidraw conversion implementation.
- `lib/canvas/excalidraw/sync.ts` — moved reconciliation implementation.
- `scripts/canvas-boundary-test.mjs` — focused adapter contract tests with an injected deterministic converter; it does not test upstream Excalidraw.
- `planning/specs/CANVAS_BOUNDARY.md` — pre-move touchpoint map and constraints.
- `planning/decisions/0001-canvas-boundary.md` — accepted dependency and ownership decision.

## Compatibility shims retained

`lib/expression/render/excalidraw.ts` and `lib/expression/render/excalidrawSync.ts` remain as implementation-free re-exports. This protects existing imports without implying that Excalidraw belongs to Expression. The main Expression test now imports the Canvas implementation directly; the boundary test verifies the compatibility export remains equivalent.

## Board.tsx touchpoints before and after

| Touchpoint | Before | After |
| --- | ---: | ---: |
| `apiRef`/mounted API ownership | 1 ref plus React state | 0; Canvas owns the attached instance |
| direct `updateScene` | 5 | 0 |
| direct `getAppState` | 4 | 0 |
| direct Excalidraw preload import | 1 | 0 |
| `<Excalidraw>` mount | 1 | 1; intentional application wiring |

`Board.tsx` is 4,186 lines after the extraction. Its in-memory element editing, undo recording, persistence scheduling, page policy, and camera-policy calculations remain unchanged; the eventual editor write now uses `CanvasRuntime.applyElements` or `CanvasRuntime.applyViewport`.

## Dependency violations removed

- Expression-named modules no longer implement Excalidraw conversion or reconciliation.
- Board no longer invokes the Excalidraw imperative API directly.
- Viewport application has one explicit owner in `lib/canvas/excalidraw/viewport.ts`.
- Expression canvas identity is private to the adapter; Board receives the `alreadyOnThisPage` fact in the existing overflow callback instead of reading identity internals.
- Meaning, WorldState, intent, planners, composition, clean, and presentation contain no Excalidraw imports or imperative API dependency.

## Gemini exception status

Gemini Live remains the documented dormant exception:

```text
Gemini Live -> model Op[] -> Board.handleLiveOps -> applyOp
```

It was not forced through Meaning or the Expression Engine. Its existing operation-to-element conversion remains in `lib/ops.ts`, but the final scene application now uses the same Canvas boundary because every Board commit does. This cheap reuse does not alter Gemini semantics or allow the exception to shape the primary Canvas contract.

## Tests

Pre-change and post-change results match:

- `npm run typecheck`: clean.
- `npm run build`: clean.
- Canvas boundary contract: passed.
- Existing Expression Engine suite: 1,254 checks passed.
- `npm test`: 48 passed / 3 known failures, with no new failure.

The unchanged known failures are:

1. `family: five people, mother named, then her occupation [paragraph]` — `Mariam -role_of-> the speaker is in the world but the plan never connected it`.
2. `family: five people, mother named, then her occupation [incremental]` — the same missing `role_of` connection.
3. `quantity: three people, four apples each, twelve total [incremental]` — `quantity preservation 0.667 below 1: "apples each" (4) is not on the canvas`.

## Browser smoke

`npm run test:smoke`: 4/4 passed—boot, continuation/page-camera, persistence round-trip, and undo.

## Remaining canvas debt

- `lib/ops.ts` still constructs Excalidraw skeletons for active transcript ink and the dormant Gemini path. All writes cross Canvas, but this compatibility conversion is not yet physically under `lib/canvas/`.
- `lib/scene.ts`, `lib/corpus.ts`, and `lib/exports.ts` retain Excalidraw-shaped compatibility/export concerns outside the live Expression boundary.
- Page-region allocation and overflow detection remain co-located with reconciliation in `sync.ts`; Board still owns the actual page-turn decision. This was preserved to avoid a policy rewrite during extraction.
- InPublic remains on Excalidraw `0.18.1`; adopting upstream's newer `setViewport`, `applyDeltas`, or imperative `mutateElement` requires a separately verified package upgrade.
- Compatibility export files remain at the old Expression paths until downstream references no longer require them.
- Canvas holds no observation contract yet. `getSceneElements`, `getAppState`, and `getFiles` are not exposed upward for reasoning.

## Phase 5 readiness

Yes. The next phase can add canvas perception without reaching around the Canvas boundary: the mounted Excalidraw instance is private to the adapter, and Board has no direct imperative reads. Phase 5 must deliberately extend Canvas with the minimum read/observation contract backed by upstream `getSceneElements`, `getAppState`, and, only if needed, `getFiles`; it must not read those surfaces directly from Board or feed raw Excalidraw types into Meaning, WorldState, or agent judgment.
