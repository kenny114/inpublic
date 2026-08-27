# ADR 0004: Visual Action Language

- Status: Accepted
- Date: 2026-08-27

## Context

A future visual agent needs a controlled way to request changes. Exposing Excalidraw shapes, element ids, or coordinates would make a model responsible for geometry and allow meaning-changing edits to bypass `WorldState`. Calling every request a `CanvasAction` would reinforce that wrong ownership: creating/removing a concept or relationship is a semantic operation even when its consequence is visible on Canvas.

The existing Expression Engine is already the authoritative compiler from structured meaning through WorldState, planning, composition, `ScenePlan`, and `RenderPatch`. Canvas already owns deterministic editor reconciliation, observation, and viewport application.

## Decision

Future AI control uses an InPublic-owned **VisualAction** language rather than raw canvas operations. `VisualAction` is a strict discriminated union divided into semantic actions and presentation actions.

Semantic actions change meaning. They update `WorldState` first—through the existing `MeaningDelta` fold for expression or exact stable-id World primitives for update/removal/relationships—and then reuse the existing Expression Engine and Canvas reconciliation. They never mutate Canvas directly.

Presentation actions do not change meaning. Phase 7 supports only `focus`, which resolves a stable semantic entity id through the current ScenePlan's deterministic identity into live Canvas bounds, then applies a deterministic viewport target through `CanvasRuntime`. `CanvasObservation` may supply physical bounds for execution after the action is already chosen; it does not choose the action.

Semantic identity is preferred to canvas identity. Action inputs use entity/relation ids and contain no coordinates, canvas element ids, shapes, arrows, or editor commands. Canvas ids and computed viewport coordinates are private execution details.

Dispatch is deterministic, validates unknown input before execution, returns structured `applied`/`noop`/`rejected` results, and contains no LLM, autonomous continuation, or retry loop.

## Consequences

- Code can request semantic visual changes without producing Excalidraw geometry.
- Meaning-changing actions cannot bypass WorldState or the current renderer.
- Presentation focus can change the viewport without changing WorldState or ScenePlan.
- Obvious retries—identical update/relationship, repeated removal, already-focused viewport—are safe no-ops.
- `CanvasAction` is removed from the target vocabulary because it conflates semantic and presentation ownership.
- Semantic repositioning remains unsupported until Expression owns a real placement-constraint representation; Phase 7 does not introduce coordinates or a solver.
- A future Agent may choose among these actions, but no Agent or observe-decide-act loop exists in Phase 7.
