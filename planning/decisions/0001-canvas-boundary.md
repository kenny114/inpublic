# ADR 0001: InPublic-Owned Canvas Boundary

- Status: Accepted
- Date: 2026-08-26

## Context

The primary Expression Engine produced technology-independent `ScenePlan` and `RenderPatch` values, but Excalidraw conversion, stable ids, reconciliation, imperative application, and viewport writes were split between `lib/expression/render/` and `Board.tsx`. That made editor implementation details appear to belong to Expression and left no single route for future canvas capabilities.

## Decision

Excalidraw is accessed through an InPublic-owned Canvas boundary in `lib/canvas/`.

```text
Meaning -> Expression -> Canvas contracts -> Excalidraw implementation
```

Meaning and Expression remain independent of the editor implementation. Meaning owns meaning, `WorldState`, semantic identity, references, and relationships. Expression owns visual intent, form, composition, `ScenePlan` semantics, `RenderPatch` semantics, and evaluation/repair. Agent judgment remains outside the canvas implementation.

Canvas owns Excalidraw element conversion, canvas-specific identity, reconciliation, imperative scene application, and viewport application. Generic editor primitives and editor behavior are learned from current upstream Excalidraw source rather than reproduced in InPublic.

Board may mount Excalidraw and wire the resulting instance into Canvas. It retains application policy such as undo, persistence triggers, page-turn decisions, camera targets, and animation timing, but applies elements and viewport state only through `CanvasRuntime`.

The current contract contains only capabilities used now: attach, preload, element application, viewport read/application, expression reconciliation, and expression-identity reset. It deliberately has no observation, selection understanding, agent action, or hypothetical multi-canvas interface.

## Consequences

- Active Expression Engine writes pass through `CanvasRuntime`.
- Excalidraw-specific conversion and reconciliation implementation lives under `lib/canvas/excalidraw/`.
- Compatibility exports remain at the old `lib/expression/render/excalidraw*.ts` paths for existing imports; they contain no implementation.
- The dormant Gemini `Op[] -> applyOp` path is not redesigned. Its final element application now shares Canvas, while its operation-to-element conversion remains a documented exception.
- The installed Excalidraw `0.18.1` viewport payload is preserved. A future upgrade to upstream's current `setViewport` is a separate decision and migration.
- Future perception and canvas action work must extend this boundary instead of reaching around it through `Board.tsx`.
