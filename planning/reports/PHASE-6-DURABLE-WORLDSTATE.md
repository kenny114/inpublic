# Phase 6: Durable WorldState

## Result

Phase 6 makes the active Expression `WorldState` durable through InPublic's existing session/project persistence lifecycle. A reload or explicit project reopen restores the visual canvas and a validated versioned semantic world from the same project version. Stable semantic ids, relations, claims, salience, provenance/lifecycle metadata, and the sequence clock survive. No `CanvasObservation` is consumed and no agent behavior was added.

## Recovery checkpoint

- Branch: `expression-engine-default`
- Commit: `e191601111ae5e3cefd567aef52e3cd38d524638`
- Commit message: `refactor: establish barebones canvas architecture and perception`
- Tag: `inpublic-barebones-v0`

The pre-Phase-6 tree was audited against the completed strip-down, architecture/control-plane, Canvas boundary, and Canvas perception reports. Generated replay output directories were ignored rather than committed. Typecheck, build, Canvas boundary/observation/dependency checks, Expression 1,254/0, `npm test` 48/3-known, and browser smoke 5/5 established the checkpoint baseline.

## Old persistence flow

```text
conversation → ExpressionSession.WorldState (memory only) → expression → canvas

Board autosave → PersistedSession(elements + predecessor semantic + metadata)
               → IndexedDB current + session:<id>
               → /api/projects → projects.canvas_json

reload/reopen → restore canvas + predecessor SemanticBoard
              → newly constructed ExpressionSession remains EMPTY_WORLD_STATE
```

Board creates `ExpressionLiveController` on first render; the controller creates its private `ExpressionSession`. Board owns the existing three-second `makeAutosave` snapshot. `lib/persist.ts` writes local IndexedDB and sends the complete session to the project API. The API stores the session-shaped remainder in `canvas_json` and the log in `transcript_json`. Board's `restoreSession` owns application rehydration.

## New persistence flow

```text
conversation → WorldState → controller.snapshotState()
              → PersistedSession.expressionState + elements
              → existing autosave → IndexedDB / existing project canvas_json

reload/reopen → complete PersistedSession
              ├─→ restore canvas
              └─→ validate expressionState → controller.restoreState()
                                         → active ExpressionSession.WorldState
                                         → next turn continues saved seq/identity
```

The semantic and visual snapshots use one Board snapshot, one IndexedDB transaction, and one cloud request. There is no independent semantic timer, request, or table.

## Persisted semantic schema

Schema version: **1**.

```ts
type PersistedExpressionState = {
  version: 1;
  world: WorldState;
};
```

`lib/expression/persistence.ts` owns the strict Zod envelope and reuses the already strict, bounded, data-only `WorldStateSchema`. It validates and clones on snapshot/restore. `PersistedSession.expressionState` is optional for backwards compatibility. The predecessor `PersistedSession.semantic` field is unchanged and not reinterpreted.

## Durable, recomputable, and transient

Durable is the complete validated `WorldState`: topic/interpretation; entities and stable ids; aliases, status, importance and supersession; relations and claims; confidence and uncertainty; salience; `seq` and first-seen/last-touched values; provenance; and bounded metric history. These fields are read by later identity/reference, intent, visibility, planning, composition, and evaluation work.

Recomputable state includes the next intent, plan, grammar, composition plan, scene, render patch, evaluation/trace, Board indices, and page pen.

Transient state includes pending submissions, cadence timers, callbacks, abort/provider objects, rolling raw extractor context, and last-scene/focus/grammar/composition/presentation caches. React and Canvas runtime objects are also transient. The first post-reload visual turn may therefore compute a full scene even though its semantic fold continues from the restored world.

## Local and cloud save paths

Board adds `expressionControllerRef.current.snapshotState()` to its existing `PersistedSession` producer. `saveLocalSession` writes the complete object to `current` and `session:<id>` in one IndexedDB transaction. Guest sessions use this exact path with `syncCloud:false`.

Authenticated `saveSession` sends the complete object to `/api/projects` via the existing POST/PUT flow. Project routes include `expressionState` in the existing `canvas_json` object spread; Supabase does not understand Expression internals. The unit persistence test asserts that the actual authenticated request body carries `expressionState.version === 1`. No database migration was required.

Anonymous claim, duplicate, rename/star, deleted-project restore, local/cloud merge, and reopen operations already preserve the complete session through object spreads.

## Restore and failure behavior

Board restores canvas/application fields independently, then passes unknown persisted semantic input to the controller's supported restore seam. A valid version-1 payload becomes the active session world; the live controller resumes with its next segment after the saved `world.seq`.

- Missing `expressionState`: classified as an old project; empty semantic runtime, canvas opens.
- Unsupported version: reported as unsupported, never interpreted as version 1; empty semantic runtime, canvas opens.
- Malformed/partially corrupt version 1: validation fails; empty semantic runtime, canvas opens.
- Valid version 1: restored directly; no transcript replay, model call, pixel inference, or observation input.

## Conflict recovery

The 409 path now calls the pure `createConflictRecoverySession` helper used by its focused test. It copies the complete cloud session and only changes recovery id, title, and cloud concurrency version. The cloud version's canvas and matching `expressionState` therefore remain paired; the attempted local version remains its own complete pair.

## Exports and recordings

Scene JSON exports and recording metadata are output-only artifacts and have no project reopen/import path. They remain outside the resumable session durability owner in this phase. A future export/import feature should carry the same versioned envelope. No second persistence representation or save loop was added.

## Serialized size

UTF-8 JSON size of the complete `{version, world}` envelope:

| Fixture | Bytes |
|---|---:|
| Empty WorldState | 86 |
| Representative Alice / Project X world with relation, claim, provenance | 1,163 |
| Structurally near-current-bounds synthetic world (64 entities, 128 relations, 48 claims, capped aliases/provenance/metric histories) | 204,700 |

The bounded synthetic fixture is about 4.9% of the existing 4 MB project request limit before canvas/transcript fields. The measurement does not justify compression; current structural schema bounds remain the protection against unbounded growth.

## Tests and verification

Focused WorldState persistence suite: **11 passed**. It covers rich and empty round-trips, stable ids, relations, claims, provenance, missing/old sessions, unsupported versions, malformed and partially corrupt payloads, project JSON inclusion, canvas-safe fallback, 409 recovery pairing, sequence continuation, and deterministic post-reload pronoun resolution (`she` resolves to the same Alice id).

Final verification on 2026-08-27:

- `npm run typecheck`: clean.
- `npm run build`: clean.
- Canvas boundary contract: passed.
- Canvas observation contract: passed.
- Canvas dependency direction: passed; observation remains unconsumed by semantic layers.
- Expression checks: **1,254 passed / 0 failed**.
- WorldState persistence checks: **11 passed / 0 failed**.
- `npm test`: historical discovery result **48 passed / 3 known failures**; no new failure.
- `npm run test:smoke`: **6/6 passed**, including the new real IndexedDB autosave/reload scenario.

The unchanged known failures are:

1. `family: five people, mother named, then her occupation [paragraph]` — Mariam's `role_of` relationship exists in the world but the plan never connected it.
2. `family: five people, mother named, then her occupation [incremental]` — the same missing `role_of` connection.
3. `quantity: three people, four apples each, twelve total [incremental]` — quantity preservation is 0.667 because “apples each” (4) is absent from the canvas.

## Remaining memory debt

- Rolling raw extraction context is not durable; semantic reference state already represented by WorldState is durable.
- Last scene/grammar/composition/presentation caches are not durable, so first post-reload visual diff continuity can be a full recomputation.
- Restored canvas and restored WorldState are independent truths. Phase 6 does not compare or reconcile them.
- Recording/export artifacts do not yet provide an importable resumable-project format.
- Unsupported future schema versions fall back safely; an actual future version will need a deliberate migration at the existing version seam.

## Scope answers

1. If a project is reloaded, does InPublic remember its semantic entities and relationships? **Yes.**
2. Do semantic identities remain stable across that reload? **Yes.**
3. Can an old project with no persisted WorldState still open? **Yes.** It starts with empty semantic memory.
4. Can malformed WorldState destroy access to an otherwise valid canvas? **No.** Semantic validation failure falls back empty and canvas restoration proceeds.
5. Does `CanvasObservation` currently change or repair restored WorldState? **No.** It remains read-only and unconsumed.
