# Phase 5: Canvas Perception

## Result

Phase 5 added explicit, read-only structural perception to the existing Canvas boundary. `CanvasRuntime.observe()` reads the mounted editor, normalizes live canvas reality into InPublic-owned types, and returns a deterministic snapshot without mutating the editor or semantic state. No model or agent consumes the observation.

## Excalidraw source basis

- Installed version: `@excalidraw/excalidraw 0.18.1`.
- Verified through: `package.json`, `package-lock.json`, installed package manifest, and installed `.d.ts` files.
- Upstream `master` inspected: `e1bb9ff8f8931e783c11d104abb8967ac6605c9a` (2026-08-26).

Local observation APIs verified: `getSceneElements`, `getSceneElementsIncludingDeleted`, `getAppState`, `getFiles`, `onChange`, `onPointerDown`, `onPointerUp`, and `onScrollChange`. Snapshot observation uses only `getSceneElements` and `getAppState`.

Current upstream additionally exposes `onIncrement`, `onStateChange`, `getSceneElementsMapIncludingDeleted`, and `getViewportOffsets`. These are documented as future upstream capabilities, not used or polyfilled. Excalidraw was not upgraded.

## CanvasObservation schema

```text
CanvasObservation
├── elements: CanvasObservedElement[]
│   ├── id, type
│   ├── x, y, width, height, angle
│   ├── text (when present)
│   ├── groupIds, frameId, containerId
│   ├── revision
│   └── order
├── selection
│   ├── elementIds
│   └── groupIds
├── viewport
│   ├── scrollX, scrollY, zoom
│   └── width, height
└── revisions
    ├── scene
    ├── selection
    └── viewport
```

The public contract does not expose `ExcalidrawElement`, `AppState`, binary files, styling, bindings, editor tools, pointer state, or collaboration internals.

## Element normalization

- `getSceneElements()` is the source, so only currently live elements appear.
- Canvas id is the observed identity and is unchanged by movement.
- Geometry and angle are finite normalized numbers; negative zero is normalized to zero.
- Text is included only when the element provides structural text.
- Group order is retained; frame and text-container relationships are normalized to ids or `null`.
- Excalidraw's numeric element version becomes the canvas-owned element `revision` so unexposed editor changes still affect scene comparison.
- Array position becomes normalized `order`, preserving overlap/order changes without exposing Excalidraw's fractional index.
- Styling properties are intentionally omitted.

Deletion is observed as disappearance from `elements`. Phase 5 does not expose tombstones from `getSceneElementsIncludingDeleted`.

## Revision strategy

Each fingerprint hashes a canonical normalized component with a deterministic two-lane 32-bit hash:

- `scene`: normalized elements, including geometry, relationships, element revision, and order.
- `selection`: sorted selected element and group ids.
- `viewport`: normalized scroll, zoom, width, and height.

The same component state produces the same fingerprint. Selection or viewport-only changes do not change the scene fingerprint. This is snapshot comparison, not event sourcing or a monotonic counter.

## Developer inspection

Development builds expose `window.inpublic.observe()`. It returns the same `CanvasObservation` used by tests and performs no writes. No permanent product UI was added.

## Tests

Pre-change baseline:

- `npm run typecheck`: clean.
- `npm run build`: clean.
- Canvas boundary contract: passed.
- Expression checks: 1,254 passed.
- `npm test`: 48 passed / the same 3 known `EXPRESSION_PLANNING` failures.
- Browser smoke: 4/4 passed.

Focused Phase 5 tests verify empty observation, element addition and normalization, stable unchanged snapshots, movement with stable identity, deletion by absence, selection changes, viewport changes, separated fingerprints, detached behavior, and zero editor writes. A static dependency test rejects Excalidraw imports under `lib/expression/` and `CanvasObservation` consumption under meaning, world, or intent.

The targeted browser scenario mounts the real board, creates a deterministic Expression scene, reads a live observation, selects the scene through real editor keyboard input, moves it with arrow keys, and reads changed geometry and scene revision under the same ids. It makes no model or Deepgram call.

Post-change verification:

- `npm run typecheck`: clean.
- `npm run build`: clean.
- Canvas boundary contract: passed.
- Canvas observation contract: passed.
- Canvas dependency-direction assertions: passed.
- Expression checks: 1,254 passed / 0 failed.
- `npm test`: 48 passed / the same 3 known failures, with no new failure.
- `npm run test:smoke`: 5/5 passed—the original four scenarios plus canvas observation.

The unchanged known failures are:

1. `family: five people, mother named, then her occupation [paragraph]` — Mariam's `role_of` relationship exists in the world but is not connected in the plan.
2. `family: five people, mother named, then her occupation [incremental]` — the same missing `role_of` connection.
3. `quantity: three people, four apples each, twelve total [incremental]` — quantity preservation remains 0.667 because “apples each” (4) is absent from the canvas.

## Leakage check

- `lib/expression/` imports no `@excalidraw/*` package.
- Meaning, WorldState, and intent do not import or reference `CanvasObservation`.
- Raw Excalidraw observation values are normalized inside `lib/canvas/excalidraw/observation.ts`.
- Board exposes the development-only snapshot method but does not normalize or interpret canvas state.

## Limitations

- Snapshots are pull-based; no events or history indicate when a change occurred.
- Deletion is absence, not a tombstone with deletion metadata.
- Files, bindings, styling, crop data, pointer position, hovered elements, and collaboration state are not exposed.
- Structural observation does not infer semantic meaning from arbitrary shapes.
- No WorldState reconciliation, drift correction, automatic repair, screenshot perception, or CanvasAction exists.
- Compact fingerprints are deterministic comparison aids, not cryptographic identifiers.

## Scope answers

1. If a human manually moves an element, can InPublic detect the changed canvas state? **Yes.** Identity remains stable while geometry and the scene fingerprint change.
2. If a human deletes an element, can InPublic detect that it no longer exists? **Yes.** It disappears from the next live snapshot and the scene fingerprint changes.
3. Can InPublic identify what is currently selected? **Yes.** Selected element and group ids are normalized in the snapshot.
4. Can InPublic identify what part of the canvas the user is viewing? **Yes.** The snapshot includes scroll position, zoom, and viewport dimensions.
5. Can any AI reasoning currently react to those observations? **No.** No semantic or agent layer consumes `CanvasObservation`.
