# Phase 7: Visual Action Language

## Result

Phase 7 introduces a strict, geometry-free `VisualAction` language and deterministic dispatcher. Explicit code can now request semantic changes by stable WorldState identity or request presentation-only focus. Meaning-changing actions update WorldState first, reuse the existing Expression Engine, and reach Excalidraw only through Canvas reconciliation. No model chooses actions, no autonomous continuation exists, and CanvasObservation remains absent from decision-making.

## Baseline

The Phase 6 working tree was intentionally preserved and audited before Phase 7. Baseline on 2026-08-27:

- `npm run typecheck`: clean.
- `npm run build`: clean.
- Canvas boundary, Canvas observation, and dependency checks: passed.
- WorldState persistence: **11 passed / 0 failed**.
- Expression: **1,254 passed / 0 failed**.
- Discovery: **48 passed / 3 known failures**.
- Browser smoke: **6/6 passed**.

The accepted failures were and remain:

1. `family: five people, mother named, then her occupation [paragraph]` — Mariam's `role_of` relationship exists in the world but the plan never connected it.
2. `family: five people, mother named, then her occupation [incremental]` — the same missing `role_of` connection.
3. `quantity: three people, four apples each, twelve total [incremental]` — quantity preservation is 0.667 because “apples each” (4) is absent from the canvas.

## Chosen public name

**VisualAction** is the public name.

- `CanvasAction` implies all operations are direct canvas mutations, which is false for meaning changes.
- `ExpressionAction` excludes valid presentation-only operations.
- `AgentAction` implies an Agent runtime currently exists.

TARGET now names `VisualAction` and keeps the future Agent explicitly absent.

## Action schema

```ts
type VisualAction =
  | { type: "express"; meaning: MeaningDelta }
  | { type: "update_entity"; entityId: string; changes: EntityChanges }
  | { type: "remove_entity"; entityId: string }
  | {
      type: "relate_entities";
      sourceEntityId: string;
      targetEntityId: string;
      relation: RelationIntent;
    }
  | { type: "remove_relation"; relationId: string }
  | { type: "focus"; entityId: string };
```

Every object is strict Zod-validated. The schemas have no x/y/width/height, canvas element id, shape, arrow, style, or editor-operation field. `express` embeds the existing geometry-free `MeaningDeltaSchema`.

## Supported semantic actions

### Express

Uses the existing structured `MeaningDelta` fold. It remains the only creation/general-expression action, avoiding a duplicate agent-only creation system.

### Update entity

Targets an exact stable entity id and can change only existing semantic properties: type, label, description, quantity, attributes, and confidence. Global id, lifecycle bookkeeping, importance, sequence, provenance, aliases, and geometry are not caller-controlled. The id is retained and aliases are updated deterministically.

### Remove entity

Removes the exact entity from WorldState, removes incident relations, removes it from claim `about` references and salience, clears supersession links to it, and recomputes importance. The next Expression pass omits its SceneObject; RenderPatch and Canvas reconciliation remove its derived visual elements/connectors.

### Relate entities

Targets exact active source/target ids. It creates a first-class WorldRelation or updates the optional properties of the matching endpoint/type/role relation. Expression decides whether that meaning is rendered as an arrow, line, label, arrangement, or containment.

### Remove relation

Targets an exact relation id, removes it from WorldState, recomputes endpoint recency/importance, and lets Expression remove or recompose its visual representation.

## Supported presentation actions

`focus` is the only presentation action. It targets a semantic entity id, resolves it to the current SceneObject through `SceneObject.entityId`, resolves the live marks through deterministic renderer-derived ids, reads current physical bounds/viewport from CanvasObservation, and applies a bounded centered viewport through `CanvasRuntime.applyViewport`.

Focus does not mutate WorldState or ScenePlan. Repeating focus at the deterministic target is a no-op.

## Intentionally unsupported actions

- raw coordinates, sizes, shapes, arrows, styles, element ids, and `updateScene`;
- semantic repositioning such as “below”/“beside” until Expression has a durable placement-constraint representation;
- arbitrary pixel movement;
- temporary highlight, selection, laser, pointer, gesture, or presence;
- batch/distributed transactions;
- agent planning, retries, autonomous continuation, or observe-decide-act;
- semantic inference/recovery/reconciliation from CanvasObservation.

## Semantic execution path

```text
explicit VisualAction
  -> strict validation
  -> ExpressionLiveController serialization
  -> MeaningDelta fold OR exact-id WorldState reducer
  -> WorldState updated
  -> existing intent / visibility / composition / clean / presentation
  -> existing ScenePlan / RenderPatch / evaluate-repair
  -> Board's existing Expression update callback
  -> CanvasRuntime.applyExpression
  -> Excalidraw
  -> applied result resolves after structural reconciliation
```

The exact-id reducer is Expression-owned in `lib/expression/actions.ts`; it emits existing WorldOps plus the new explicit `REMOVE_ENTITY` trace op. General creation still uses MeaningDelta. No second renderer or canvas-writing semantic path exists.

## Presentation execution path

```text
focus(entityId)
  -> validate entity in WorldState
  -> resolve SceneObject.entityId
  -> resolve deterministic derived canvas ids
  -> read CanvasObservation bounds/viewport
  -> compute private viewport target
  -> CanvasRuntime.applyViewport
```

The action contains no geometry. Observation supplies execution facts only after the caller has selected focus.

## Identity strategy

Semantic operations use `WorldEntity.id` and `WorldRelation.id`. They never search canvas text or use labels as primary identity. Presentation focus crosses the identity boundary through the existing chain:

```text
WorldEntity.id -> SceneObject.entityId -> SceneObject.id -> derived canvas element ids
```

When object ids share prefixes, ownership resolves to the longest matching SceneObject id so one entity cannot accidentally capture another entity's compound marks.

## Validation and structured results

The dispatcher accepts `unknown`, validates once, and returns:

- `applied` with semantic/presentation category and before/after snapshots;
- `noop` with a deterministic reason and unchanged snapshots where applicable;
- `rejected` with category, code, reason, and before/after snapshots.

Unknown entity, inactive entity, self-relation, malformed action, extra coordinate field, missing visible identity, detached Canvas, busy semantic runtime, and unexpected runtime errors are explicit rejections. Normal validation/control flow does not throw.

## Idempotency behavior

- identical entity update: `noop`, WorldState sequence unchanged;
- identical relationship: `noop`, sequence unchanged;
- already-absent entity/relation removal: `noop` for safe retry;
- already-focused viewport: `noop`;
- structured express with no semantic change: existing Expression no-op.

No distributed transaction or automatic retry infrastructure was added.

## Observation usage

CanvasObservation is used only inside presentation focus to find the physical bounds and current viewport needed to execute an already-explicit action. It is also returned by the development harness/tests to verify results. It is not imported by Meaning or Expression world actions, does not mutate WorldState, and never selects an action.

## Developer action harness

Development Board exposes:

```js
await window.inpublic.act({ type: "remove_entity", entityId: "sleep" })
```

Callers establish an initial world through the existing deterministic `express({delta})` harness, then submit an explicit action. Results include before/after WorldState, ScenePlan, and CanvasObservation snapshots. The harness invokes no model.

## Tests

Focused deterministic VisualAction suite: **14 passed / 0 failed**. Coverage includes:

- strict raw-geometry/unknown-operation rejection;
- express through MeaningDelta with semantic and visual output;
- stable-id entity update and corresponding scene update;
- identical-update no-op;
- relationship creation and Expression connector representation;
- duplicate-relationship no-op;
- relation removal and connector removal;
- repeated relation-removal no-op;
- invalid identity rejection with byte-equivalent WorldState and unchanged Canvas;
- entity removal, relation/claim/salience cascade, RenderPatch removal, and resulting Canvas absence;
- repeated entity-removal no-op;
- focus with unchanged WorldState/ScenePlan and changed viewport;
- repeated-focus no-op;
- strict rejection of extra coordinate fields.

Static VisualAction dependency checks ensure public schemas expose no geometry/raw canvas operations, action code imports no Excalidraw package or provider/model client, Meaning/world actions consume no CanvasObservation, and Canvas dependency exists only in orchestration.

## Browser smoke

Browser smoke is **7/7**. The new real-browser scenario:

```text
deterministic express Coffee -> prevents -> Sleep
  -> remove_entity(Sleep id)
  -> applied result shows Sleep absent from WorldState
  -> existing Expression/Canvas reconciliation completes
  -> live CanvasObservation contains none of Sleep's derived marks
```

It uses no LLM or Deepgram connection.

## Final verification

Final verification on 2026-08-27:

- `npm run typecheck`: clean.
- `npm run build`: clean.
- Canvas boundary: passed.
- Canvas observation: passed.
- Canvas dependency direction: passed.
- VisualAction: **14 passed / 0 failed**.
- VisualAction dependency direction: passed.
- WorldState persistence: **11 passed / 0 failed**.
- Expression: **1,254 passed / 0 failed**.
- Discovery: **48 passed / same 3 known failures**.
- Browser smoke: **7/7 passed**.
- MCP: **13 passed / 0 failed**.
- Product packaging: **38 passed / 0 failed**.
- `git diff --check`: clean (line-ending conversion notices only).

No new regression was introduced.

## Remaining action debt

- semantic placement/repositioning needs a real Expression-owned constraint representation and deterministic solver;
- presentation highlight/pointer/gesture/presence remain unimplemented;
- entity removal is currently hard removal for the explicit action contract, while conversational retractions continue to use archival lifecycle states;
- focus applies the target viewport immediately and does not join Board's animated camera state machine;
- multi-action transactions and conflict semantics are absent;
- no Agent chooses, schedules, retries, evaluates, or chains VisualActions;
- CanvasObservation/WorldState reconciliation remains deferred.

## Scope answers

1. Can code now request a semantic visual change without producing Excalidraw geometry? **Yes.**
2. Can code target an existing concept by stable semantic identity? **Yes.**
3. If an action changes meaning, does WorldState change before the resulting canvas expression? **Yes.**
4. Can a presentation-only action occur without altering WorldState? **Yes.**
5. Can an LLM currently look at CanvasObservation and choose one of these actions? **No.**
