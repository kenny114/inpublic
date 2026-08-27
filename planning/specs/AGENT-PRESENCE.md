# Agent Presence

Phase 9 makes the bounded visual agent visibly present without turning presence into board meaning.

## Contract

- The Agent emits lifecycle state and semantic entity targets only: `idle`, `observing`, `thinking`, `acting`, and the reserved capability `speaking`.
- Canvas owns target resolution. It maps an entity id through the current `ScenePlan` to current observed element bounds and then to viewport pixels.
- The visible layer is a `pointer-events: none` host overlay. It never selects an Excalidraw tool, writes collaborators, changes cursor state, calls `updateScene`, or creates elements.
- Pointer travel is short, interruptible, and snaps under reduced motion. Target emphasis expires automatically and is never added to undo or persistence.
- Human pointer, wheel, or keyboard input immediately suppresses agent gestures. It does not block or reinterpret the human event.
- Presence does not appear in `WorldState`, `ScenePlan`, `CanvasObservation`, semantic revision hashes, persistence, or VisualAction schemas.
- Lifecycle signals and trace entries are deterministic consequences of the existing loop. They make no model request and never delay action execution.
- `speaking` is a state capability only. Phase 9 does not synthesize audio or imply that audio exists.

## Visual behavior

Observing and thinking show a compact status chip. Acting may point to and briefly outline the currently targeted semantic entity. A minimum display window is maintained inside the overlay clock so a fast action remains perceptible; the agent loop does not await it. Completion, failure, reload, or reset clears presence.

## Non-goals

No autonomous continuation, background execution, laser trail, collaboration participant, voice output, free-draw simulation, or new model reasoning is introduced in this phase.
