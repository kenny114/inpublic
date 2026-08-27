# ADR 0006: Agent Presence

- Status: Accepted
- Date: 2026-08-27

## Context

Phase 8 closed the bounded observe-decide-act loop, but its lifecycle was visible only in a developer trace. A viewer could not tell whether the visual agent was observing, thinking, acting, or finished, and could not see which existing semantic object held its attention.

The installed Excalidraw 0.18.1 package exposes collaborators, collaborator pointers (including laser), speaking metadata, `elementsToHighlight`, active-tool changes, and cursor APIs. Those surfaces carry editor or collaboration meaning. Using them for an artificial participant would either fake shared-user state, mutate editor app state, or compete with the human's current cursor/tool. Drawing presence as Excalidraw elements would additionally enter scene revisions, undo, persistence, and semantic observation.

## Decision

Agent presence is an ephemeral Canvas-owned host overlay under `lib/canvas/presence/`. The Agent emits lifecycle state plus an optional semantic entity id. It never emits coordinates, element ids, editor tools, cursor choices, or drawing operations. Canvas resolves the entity id through its current `ScenePlan`, current normalized observation, and viewport to screen-space bounds.

The overlay has `pointer-events: none`. It displays a passive lifecycle chip and, while acting, may show a short moving point and temporary outline. Pointer travel is interruptible, reduced-motion mode snaps to the destination, and timing lives entirely in the overlay clock. The Agent loop never waits for an animation.

Human pointer, wheel, or keyboard activity suppresses agent gestures immediately for a short interval. The original event continues normally. Presence does not select tools, set cursor state, select elements, move the viewport, or write collaborators.

Presence has explicit `idle`, `observing`, `thinking`, `acting`, and `speaking` states. `speaking` is only a supported state contract in Phase 9; no audio or speech synthesis is created and the application does not falsely enter it.

The deterministic Agent lifecycle drives the overlay and appends structured presence events to the existing run trace. These events contain lifecycle facts and semantic targets, never hidden reasoning. They make no provider call. Every entered run clears presence in `finally`, including completed, blocked, stalled, and step-limit outcomes.

Presence is deliberately absent from `WorldState`, `ScenePlan`, `CanvasObservation`, VisualAction, persistence, and editor revisions. Excalidraw's native collaborator/laser/highlight/tool surfaces remain unused for this feature. No Excalidraw upgrade is required.

## Consequences

- A viewer can distinguish observing, thinking, acting, and idle without treating visual activity as board content.
- The Agent can visibly attend to a semantic target without receiving or producing coordinates.
- Presence cannot enter undo, persistence, semantic revisions, or WorldState.
- The human's editor tool, cursor, selection, and pointer events remain authoritative.
- Automated tests can advance the overlay clock and inspect lifecycle traces deterministically.
- Native laser trails, collaborator presence, synthesized voice, background autonomy, and Phase 10 invocation policy remain out of scope.
