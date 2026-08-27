# Visual Action Language

Status: Phase 7 implementation contract

## Purpose and public name

The public name is **VisualAction**. `CanvasAction` is misleading because most useful actions change semantic meaning and must update `WorldState` before Canvas. `ExpressionAction` is too narrow because presentation-only focus intentionally bypasses semantic mutation. `AgentAction` incorrectly implies an Agent runtime exists.

A future Agent may choose a `VisualAction`; Phase 7 implements only the validated deterministic language and everything below that absent decision-maker.

## Core split

```text
VisualAction
  ├─ semantic action
  │    -> exact WorldState mutation or existing MeaningDelta fold
  │    -> existing intent / plan / compose / evaluate / RenderPatch
  │    -> Canvas reconciliation
  └─ presentation action
       -> deterministic semantic-to-scene-to-canvas identity resolution
       -> Canvas viewport application
```

Semantic actions never write Canvas directly. Presentation actions never mutate `WorldState`. Neither branch accepts raw geometry from its caller.

## Existing capability audit

| Requested capability | Existing primitive | New primitive? | Category | Execution owner |
|---|---|---:|---|---|
| Express new meaning | `MeaningDelta` -> `ExpressionSession.ingestDelta` -> `applyDelta` | No; add an action adapter only | Semantic | Expression |
| Create entity | `MeaningDelta.entities` -> `ADD_ENTITY` | No; `express` owns creation | Semantic | Expression world fold |
| Update entity by mention | `applyDelta` merges matched entities and retains global id | Yes, for exact global-id targeting | Semantic | Expression world action reducer |
| Archive/retract entity | discourse acts and `supersededMentions` change lifecycle status by resolved language | Yes; Phase 7 removal requires exact-id absence and relation/salience cleanup | Semantic | Expression world action reducer |
| Add relationship | `MeaningDelta.relations` -> `ADD_RELATION` | Yes, thin exact endpoint-id entry; reuse `WorldRelation` rules | Semantic | Expression world action reducer |
| Update same relationship | existing relation merge updates spatial/magnitude/step/confidence | Yes, through the same exact endpoint/type action | Semantic | Expression world action reducer |
| Remove relationship | `REMOVE_RELATION` exists as an internal `WorldOp` during corrections/archive | Yes, exact relation-id entry | Semantic | Expression world action reducer |
| Reference resolution | pronoun/alias/salience, ordinal/topic recall, optional identity/target judges | No; actions already carry resolved stable ids and must not repeat fuzzy resolution | Semantic | Existing Meaning/World for `express`; exact action validation otherwise |
| Salience update | `applyDelta` maintains a bounded compatible antecedent stack | Extend deterministically for exact update/relate/remove | Semantic | Expression world action reducer |
| Layout continuation | `lastScene`, `lastGrammar`, `lastComposition`, `compose(... previous ...)` | No | Expression | Existing pipeline |
| Remove from ScenePlan | live-entity filtering + `diffScenes().removed/connectorsRemoved` | No | Expression renderer core |
| Remove from canvas | `CanvasRuntime.applyExpression` reconciliation drops owned ids absent from next scene | No | Canvas |
| Viewport movement | `CanvasRuntime.readViewport/applyViewport` | Add semantic-target focus resolver only | Presentation | VisualAction presentation executor + Canvas |
| Semantic repositioning | no durable placement-constraint schema or solver | Not in Phase 7 | Semantic (future) | Unsupported |

## Smallest action union

```ts
type VisualAction =
  | { type: "express"; meaning: MeaningDelta }
  | { type: "update_entity"; entityId: string; changes: EntityChanges }
  | { type: "remove_entity"; entityId: string }
  | { type: "relate_entities"; sourceEntityId: string; targetEntityId: string; relation: RelationIntent }
  | { type: "remove_relation"; relationId: string }
  | { type: "focus"; entityId: string };
```

This deliberately omits a separate create action: `express` already creates entities through the strongest existing path. Relationship change is remove + relate, or an update to the same endpoint/type/role relation's optional properties. Grouping uses an ordinary semantic relationship through `express`/`relate_entities` rather than a new parallel group system.

`update_entity` supports only properties already represented by `WorldEntity`: type, label, description, quantity, attributes, and confidence. It cannot set importance, lifecycle bookkeeping, ids, sequence values, provenance, aliases, or geometry.

## Identity

Semantic actions target `WorldEntity.id` or `WorldRelation.id`. No label search or canvas id is used for action validation. The reducer preserves an updated entity's id and cascades entity removal through relations, claim references, and salience.

Focus starts from `WorldEntity.id`, resolves the current `SceneObject` through `SceneObject.entityId`, and resolves physical elements through the renderer's existing derived-id convention (`SceneObject.id` and its deterministic suffixes). Canvas ids remain an internal execution detail. No fuzzy text matching is allowed.

## Validation and results

The complete unknown input is validated with strict Zod schemas before dispatch. Semantic validation additionally rejects unknown/archived targets, identical updates, self-relations, unknown endpoints, and missing relations. Presentation validation rejects entities absent from the world or current scene and detached Canvas.

Dispatch returns one structured result:

```ts
type ActionResult =
  | { status: "applied"; category: "semantic" | "presentation"; ...snapshots }
  | { status: "noop"; category: "semantic" | "presentation"; reason: string; ...snapshots }
  | { status: "rejected"; category: "validation" | "semantic" | "presentation"; reason: string; code: string; ...snapshots };
```

Unknown or malformed input never throws as ordinary control flow. Unexpected implementation faults are caught at the dispatcher boundary and returned as `rejected/runtime_error`.

## Idempotency

- identical entity updates are `noop` and do not advance WorldState sequence;
- relating an already-identical relationship is `noop`;
- removing an absent entity or relation is `noop` (safe retry), while malformed ids are rejected at schema validation;
- focusing a viewport already at the deterministic target is `noop`;
- `express` retains the existing engine's semantic no-op behavior.

## Semantic execution

`express` calls the existing structured-meaning path. Exact-id actions use one new pure Expression-owned WorldState reducer, then run the resulting world through the existing downstream Expression stages. The reducer emits existing `WorldOp` values plus an explicit `REMOVE_ENTITY` op. The live controller serializes action execution against pending speech, awaits Board's existing Expression update callback, and therefore resolves only after Canvas reconciliation completes.

No second renderer, raw shape operation, transcript replay, or model call is introduced.

## Presentation execution

`focus` uses the current semantic world and scene to resolve a target, reads `CanvasObservation` only to obtain current physical bounds/viewport, calculates a bounded deterministic camera target internally, and calls `CanvasRuntime.applyViewport`. The action contains no coordinate or canvas id. WorldState and ScenePlan remain byte-equivalent.

This is observation used to execute an already-chosen action, not observation used to choose an action.

## Intentionally unsupported

- raw x/y/width/height, Excalidraw element ids, shapes, arrows, or `updateScene`;
- semantic repositioning/placement constraints until Expression has a real durable constraint representation;
- arbitrary pixel movement;
- temporary highlight, pointer, laser, gesture, presence, or selection control;
- batch transactions, autonomous continuation, retries, planning, or an Agent loop;
- CanvasObservation-to-WorldState inference or repair.

## Developer harness and verification

Development Board exposes `window.inpublic.act(unknown)`. Callers establish an initial world through the existing deterministic `express({delta})` harness, submit an explicit action, and receive the structured result with before/after WorldState, ScenePlan, and CanvasObservation snapshots. No model is involved.

Deterministic tests cover every action, exact identity, removal cascade, rendering patches, invalid/no-op behavior, focus invariants, and dispatcher routing. One browser smoke establishes semantic state, removes an entity through `act`, verifies WorldState first changed through the returned result, and verifies the resulting live `CanvasObservation` no longer contains that entity's derived visual ids.
