# Target Architecture

The target is a live visual expressive agent with a closed observation/action loop. This is a conceptual ownership map only.

```text
                       LIVE INPUT
                           │
                 ┌─────────┴─────────┐
                 ▼                   ▼
              interim              settled
                 │                   │
                 ▼                   ▼
        fast live expression  interaction routing
                                     │
                         ┌───────────┴───────────┐
                         ▼                       ▼
                    Expression               VisualAgent ◄── WorldState
                         │                       ▲
                         │                       └──────── CanvasObservation
                         │                       │
                         │                       ▼
                         │                  VisualAction
                         └───────────┬───────────┘
                                     ▼
                                   Canvas
                                     │
                                     ▼
                                 Excalidraw
                                     │
                                     ▼
                            CanvasObservation

World-aware loop detail:

  WorldState ────► VisualAgent ◄──── CanvasObservation ─────┐
                   │       │                                │
 lifecycle +       │       ▼                                │
 semantic id       │  AgentDecision                         │
                   ▼       │                                │
          Canvas Presence  ▼                                │
          (ephemeral UI) VisualAction                        │
                          │                                 │
                          ▼                                 │
                 Action Dispatcher                          │
                ┌────┴────┐                │
                ▼         ▼                │
            Semantic   Presentation        │
                │         │                │
                ▼         │                │
            WorldState    │                │
                │         │                │
                ▼         │                │
         Expression Engine│                │
                └────┬────┘                │
                     ▼                     │
                   Canvas                  │
                     │                     │
                     ▼                     │
                 Excalidraw                │
                     │                     │
                     ▼                     │
            CanvasObservation ─────────────┘
```

The bounded Agent loop is now invoked by settled live routing for explicit existing-world instructions. It reads compact semantic and structural canvas views, chooses one strict geometry-free action, delegates execution, re-observes, and stops under deterministic budgets/stall/cancellation rules. Ordinary speech stays on the existing `MeaningDelta` → `WorldState` → visual intent → deterministic planning → `ScenePlan` → `RenderPatch` path. Those paths share one WorldState and the existing Canvas mutation routes.

Session now durably owns both the versioned Expression `WorldState` snapshot and canvas/project snapshot. They restore independently from one project version. A future observation/action loop may compare those truths, but current restoration performs no reconciliation.

## Conceptual ownership

### Speech

Owns microphone input, the STT provider, and transcript settling. It must not own meaning, layout, or canvas geometry.

### Meaning

Owns `MeaningDelta`, `WorldState`, semantic identity, references, and relationships. It must not own geometry or depend on a rendering technology.

### Expression

Owns visual intent, visual form, composition, `ScenePlan`, and evaluation/repair. It must not depend on Excalidraw-specific types.

### Canvas

Owns Excalidraw integration, scene application, observation, viewport, canvas identity, ephemeral presence rendering, semantic-target geometry resolution, and the user/canvas interaction boundary. Excalidraw-specific types and display coordinates stop here. Presence is not scene content.

### Agent

Owns observe, compact context, decision validation, action selection, bounded continuation, cancellation, ActionResult feedback, lifecycle signals, trace, and stop orchestration. It may identify a presence target semantically but does not own target geometry or display timing. It reuses Meaning, Expression, VisualAction, and Canvas rather than duplicating them. Future work may add richer supported actions and deliberate drift handling without moving those lower-layer responsibilities into Agent.

### Live Interaction

Owns settled-input routing between direct Expression and world-aware Agent, human-priority supersession, one-active/one-latest-pending policy, and cross-path interaction metrics. It does not interpret interim speech, extract meaning, choose geometry, dispatch actions, or own WorldState.

### Session

Owns durable project and session state, including versioned Expression semantic memory and canvas state needed to continue coherently after reload. It stores Expression's representation without interpreting it.

### App

Owns UI and wiring only. `Board.tsx` remains wiring during gradual extraction, not a destination for new domain logic.

Generic drift repair, semantic recovery from canvas, multi-agent roles, background autonomy, and model-generated action batches remain outside the target until separately specified. The implemented routing and loop are settled-input scoped, conservative, cancellable, and bounded.
