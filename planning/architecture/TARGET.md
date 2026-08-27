# Target Architecture

The target is a live visual expressive agent with a closed observation/action loop. This is a conceptual ownership map only.

```text
                Instruction
                     │
                     ▼
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

The first bounded Agent loop now exists for explicit instructions. It reads compact semantic and structural canvas views, chooses one strict geometry-free action, delegates execution, re-observes, and stops under deterministic budgets/stall rules. The existing `MeaningDelta` → `WorldState` → visual intent → deterministic planning → `ScenePlan` → `RenderPatch` path and Canvas focus execution remain the only mutation routes beneath it.

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

Owns observe, compact context, decision validation, action selection, bounded continuation, ActionResult feedback, lifecycle signals, trace, and stop orchestration. It may identify a presence target semantically but does not own target geometry or display timing. It reuses Meaning, Expression, VisualAction, and Canvas rather than duplicating them. Future work may add product invocation policy, richer supported actions, evaluation, and deliberate drift handling without moving those lower-layer responsibilities into Agent.

### Session

Owns durable project and session state, including versioned Expression semantic memory and canvas state needed to continue coherently after reload. It stores Expression's representation without interpreting it.

### App

Owns UI and wiring only. `Board.tsx` remains wiring during gradual extraction, not a destination for new domain logic.

Generic drift repair, semantic recovery from canvas, continuous-speech agent routing, multi-agent roles, background autonomy, and model-generated action batches remain outside the target until separately specified. The implemented loop is explicit, bounded, and instruction-scoped.
