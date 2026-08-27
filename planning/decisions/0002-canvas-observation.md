# ADR 0002: Normalized Canvas Observation

- Status: Accepted
- Date: 2026-08-26

## Context

The Expression Engine can describe what it intended to render, but intent is not live canvas reality. Human movement, deletion, selection, and camera changes occur inside Excalidraw after rendering. Reading raw Excalidraw elements or `AppState` from Board or semantic layers would bypass the Canvas boundary established by ADR 0001.

## Decision

Canvas perception is exposed as an InPublic-owned, read-only `CanvasObservation` returned by the explicit `CanvasRuntime.observe()` snapshot operation.

The snapshot contains a minimal normalized live-element representation, selected element and group ids, a normalized viewport, and independent deterministic fingerprints for scene content, selection, and viewport. Excalidraw-specific types and normalization remain under `lib/canvas/excalidraw/`.

Phase 5 begins with structured snapshots. It does not subscribe to `onChange`, pointer, increment, or scroll events and does not capture screenshots. Observation retains no history and performs no writes. Repeated observation of unchanged state is side-effect-free and produces equal snapshots.

Observation cannot mutate WorldState, semantic state, ScenePlan, or canvas state. Meaning, WorldState, intent, Expression, and AI reasoning do not consume this contract yet. Agent judgment, drift detection, reconciliation with user edits, and canvas actions belong to later phases.

## Consequences

- InPublic can compare actual live canvas snapshots without importing Excalidraw types above Canvas.
- Element identity survives geometry changes because normalized identity is the stable canvas id.
- Deletion is represented by absence from the live element list; tombstones and event history are intentionally not included.
- Scene, selection, and viewport changes can be compared independently.
- The development-only `window.inpublic.observe()` method supports deterministic inspection and browser testing without adding product UI.
- A future visual agent must consume this contract or a deliberate Canvas extension, never reach around it through Board or the mounted Excalidraw API.
