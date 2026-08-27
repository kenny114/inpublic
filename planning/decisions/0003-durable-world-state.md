# ADR 0003: Durable WorldState

- Status: Accepted
- Date: 2026-08-27

## Context

Before Phase 6, project persistence restored Excalidraw elements and the predecessor semantic-board snapshot, but the active Expression runtime always started with `EMPTY_WORLD_STATE`. A project therefore retained its picture while losing the stable entities, relations, claims, salience, provenance, and sequence history needed to continue the same semantic conversation.

The visual artifact alone is insufficient to continue a semantic world after reload. Replaying transcripts, deriving meaning from pixels, or feeding `CanvasObservation` into WorldState would be lossy and would cross boundaries established by ADRs 0001 and 0002.

## Decision

Semantic `WorldState` is persisted as versioned session/project state:

```ts
type PersistedExpressionState = {
  version: 1;
  world: WorldState;
};
```

Expression owns the schema, serialization, validation, and semantic meaning. Session owns durability by carrying the envelope as optional `PersistedSession.expressionState` through the existing IndexedDB and `projects.canvas_json` lifecycle. Canvas owns the independently persisted visual state.

The active `ExpressionSession` exposes a narrow validated snapshot/restore lifecycle seam. Restoration uses the saved semantic state directly and resumes the sequence clock; it does not replay transcript history or inspect canvas pixels/observation. Canvas and WorldState travel as fields of the same project version, including optimistic-concurrency recovery copies.

Projects without `expressionState` remain readable and start with empty semantic memory. Unsupported, malformed, or partially corrupt semantic payloads are not interpreted as version 1 and cannot prevent the canvas from opening. The explicit version dispatch is the migration seam; no hypothetical migration system is added.

## Consequences

- Stable semantic ids, relations, claims, salience, provenance, and lifecycle metadata survive reload/project reopen.
- One existing session autosave remains the durability owner; no semantic timer, Supabase table, or provider dependency is introduced.
- `semantic` remains the predecessor semantic-board field and is not repurposed.
- The first post-restore visual expression may recompute a full scene because render-diff caches remain transient.
- `CanvasObservation` ↔ WorldState reconciliation, observation-driven reasoning, agent decisions, and semantic recovery from canvas remain deferred.
