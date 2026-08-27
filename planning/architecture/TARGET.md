# Target Architecture

The target is a live visual expressive agent with a closed observation/action loop. This is a conceptual ownership map only.

```text
               Input
                 │
                 ▼
         CanvasObservation
                 │
            WorldState
                 │
                 ▼
             Meaning
                 │
                 ▼
           Visual Intent
                 │
                 ▼
        Expression Engine
                 │
                 ▼
           CanvasAction
                 │
                 ▼
         Excalidraw Adapter
                 │
                 ▼
            Excalidraw
                 │
                 └──── read back ────► observation
```

The diagram establishes a loop, not final sequencing or type definitions. The existing `MeaningDelta` → `WorldState` → visual intent → deterministic planning → `ScenePlan` → `RenderPatch` foundation remains authoritative while boundaries are extracted deliberately. The current Canvas boundary now provides explicit structural snapshots, but nothing in Agent, Meaning, or Expression consumes them yet.

## Conceptual ownership

### Speech

Owns microphone input, the STT provider, and transcript settling. It must not own meaning, layout, or canvas geometry.

### Meaning

Owns `MeaningDelta`, `WorldState`, semantic identity, references, and relationships. It must not own geometry or depend on a rendering technology.

### Expression

Owns visual intent, visual form, composition, `ScenePlan`, and evaluation/repair. It must not depend on Excalidraw-specific types.

### Canvas

Owns Excalidraw integration, scene application, observation, viewport, canvas identity, and the user/canvas interaction boundary. Excalidraw-specific types stop here.

### Agent

Eventually owns observe, decide, action selection, continuation, and repair orchestration. It reuses Meaning and Expression rather than duplicating either.

### Session

Owns durable project and session state, including the state needed to continue coherently after reload.

### App

Owns UI and wiring only. `Board.tsx` remains wiring during gradual extraction, not a destination for new domain logic.

No agent runtime, observation-driven semantic mutation, drift repair, or `CanvasAction` implementation exists yet. Structured `CanvasObservation` snapshots are the current read-only foundation for that later work.
