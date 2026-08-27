# WorldState Persistence

Status: Phase 6 implementation contract

## Purpose and invariant

An InPublic project must preserve the visual artifact and the semantic world that produced it. Expression owns the meaning and validation of `WorldState`; Session owns storing and restoring an intentionally versioned representation; Canvas owns visual state. `CanvasObservation` remains read-only and is not used to create, validate, repair, or reconcile semantic state.

## Current lifecycle (before Phase 6)

### New session and runtime creation

`components/Board.tsx` creates an `ExpressionLiveController` during the first Board render. The controller constructs its private `ExpressionSession`, whose private `world` starts at `EMPTY_WORLD_STATE`. Board separately initializes Excalidraw elements and the predecessor `SemanticBoard`.

### Local autosave and IndexedDB

Board installs the one existing `makeAutosave` lifecycle. Its snapshot contains the session id, cloud version, title, timestamps, page, Excalidraw elements, the predecessor `semantic` snapshot, story/composition/mode, and log. `saveSession` writes that complete `PersistedSession` to IndexedDB database `inpublic`, store `sessions`, under both `current` and `session:<id>` in one transaction. Guest sessions use the identical local path with cloud sync disabled.

### Cloud project save

The same `PersistedSession` is POSTed or PUT to `/api/projects`. The API removes transport/table fields and stores the remaining project shape in `projects.canvas_json`; `log` is stored in `transcript_json`. Supabase does not interpret canvas or Expression fields. The request limit is 4 MB.

### Reload and project reopen

Board calls `loadSession()` for the current project or `loadSessionById()` for an explicit project. Local and cloud records are merged as whole-session versions by `savedAt`. `restoreSession` restores Excalidraw elements, the predecessor `SemanticBoard`, story/composition/mode/log/page, and derived canvas indices. It does not restore the Expression runtime. Consequently the canvas returns while the active `ExpressionSession.world` remains empty.

### Cloud conflict recovery

On a 409, `saveCloudSession` receives the complete cloud project, duplicates it locally under a recovery id/title using an object spread, and leaves the attempted local version intact. Because the project is copied as one object, visual and semantic fields remain paired if semantic state is a first-class `PersistedSession` field.

### Anonymous claim, duplicate, restore, rename, and star

Anonymous claim re-saves the whole local session after authentication. Project duplicate, deleted-project restore, rename, and star operations also use whole-session object spreads. They do not need Expression-specific logic and will preserve a first-class semantic field.

### Exports and recordings

Scene JSON export and recording metadata are output artifacts, not inputs to project/session restoration: there is no import/reopen path from either representation. Phase 6 does not turn those formats into a second durability owner. They continue to contain the predecessor `semantic` representation where already present. The authoritative resumable state remains `PersistedSession` in IndexedDB/cloud. A future export/import feature should add the same versioned Expression envelope rather than inventing another schema.

## Phase 6 lifecycle

```text
conversation
  -> ExpressionLiveController
  -> ExpressionSession / WorldState
  -> snapshotState()
  -> Board's existing PersistedSession snapshot
  -> one existing autosave
  -> IndexedDB and, when authenticated, projects.canvas_json

reload or project reopen
  -> load complete PersistedSession
  -> restore canvas independently
  -> validate persisted Expression envelope
  -> restore the active ExpressionSession directly from WorldState
  -> continue subsequent Expression turns from the restored semantic ids
```

No transcript replay, model call, pixel reconstruction, or `CanvasObservation` input participates in restoration.

## Persistence representation

Expression defines the explicit boundary:

```ts
type PersistedExpressionState = {
  version: 1;
  world: WorldState;
};
```

`WorldStateSchema` is already a strict, bounded, JSON-data-only schema, so version 1 reuses that shape rather than duplicating a DTO. The envelope is strict and validated on both snapshot and restore. `PersistedSession` adds an optional `expressionState` field; it does not repurpose the predecessor `semantic` field.

Expression provides serialization/decoding helpers and a supported lifecycle seam on `ExpressionSession`/`ExpressionLiveController`. Session persistence only stores the result and never performs entity resolution or understands Expression internals.

## State classification

### Durable

The complete validated `WorldState` is durable because later folds, reference resolution, intent, planning, composition, and evaluation read it:

- topic and interpretation;
- entities and stable semantic ids;
- entity type/label/attributes, metrics, confidence, status, importance, aliases, and supersession link;
- relations, stable ids/endpoints/type/role/label/confidence;
- claims, about links, confidence/uncertainty/importance, stance target, and invalidation state;
- salience ordering used by reference resolution;
- `seq`, plus first-seen and last-touched sequence values used for continuity, visibility, and recency;
- bounded provenance and metric histories used by attribution and lifecycle decisions.

The live controller's next input sequence is derived from restored `world.seq`, so a post-reload turn cannot move sequence time backwards.

### Recomputable

- plan, grammar, composition plan, render scene, evaluation, and trace for a future turn;
- Board's concept-to-element index and page pen;
- serialized byte counts and other diagnostics.

### Transient

- pending/debounced submissions, abort controllers, callbacks, promises, timers, and provider/model clients;
- rolling raw extractor context;
- last scene/focus/grammar/composition/presentation layout caches;
- React state, Excalidraw runtime handles, and `CanvasObservation`.

The first post-restore visual expression may recompute a full scene because visual diff caches are transient. That is not semantic loss and Phase 6 does not reconcile the independently restored canvas and world.

## Restore and failure policy

- Version 1 with a valid `WorldState` restores directly.
- A missing `expressionState` is an older project and restores an empty semantic runtime while its canvas opens normally.
- An unsupported version is reported as unsupported and is not interpreted as version 1.
- A malformed or partially corrupt envelope fails validation, is reported/ignored, and restores an empty semantic runtime.
- Semantic restore failure never aborts canvas/project restoration.
- Version dispatch is an explicit seam for a future real migration; Phase 6 invents no hypothetical migration chain.

## Pairing and concurrency

Canvas elements and `expressionState` are captured by the same Board snapshot, stored in the same `PersistedSession`, written by the same IndexedDB transaction, sent in the same cloud request, and copied together in 409 recovery. No separate semantic timer, table, or cloud request is introduced.

## Verification contract

Focused deterministic tests must cover rich and empty round-trips, missing/unsupported/malformed input, project serialization, 409 recovery pairing, runtime reconstruction, stable ids, and continuation reference resolution without paid model calls. One browser smoke must create known semantic state, allow the real autosave, reload through a development-only restore route, and verify both canvas and active Expression state. Serialized byte size is recorded for empty, representative, and near-current-bounds valid fixtures before considering compression.
