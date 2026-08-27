# Canvas Architecture Audit

## How the AI sees the canvas

**It doesn't — not directly.** The Expression Engine never reads raw
Excalidraw elements, never takes a screenshot, never extracts text from the
rendered scene. Its only "perception" is its own `WorldState`
(`lib/expression/schemas.ts:634-676`), an in-memory structure the engine
itself built up turn by turn from meaning deltas. What it has:

- **Persistent semantic state**: `WorldState { entities[max 64], relations[max
  128], claims[max 48], salience[max 16], seq }` — held inside
  `ExpressionLiveController`/`ExpressionSession`
  (`lib/expression/live.ts:183`, `pipeline.ts`), instantiated once per
  `Board.tsx` mount (`Board.tsx:812,870`), never persisted to disk.
- **Its own last-rendered scene**, for diffing only (`render/core.ts:
  diffScenes`) — a rendering optimization, not something the reasoning layers
  (`intent/classify.ts`, `planner/plan.ts`, `composition/plan.ts`, etc.)
  consult.
- **No raw elements, no screenshot, no selection state, no viewport state**
  reach the reasoning layers. Camera/viewport is handled entirely outside the
  Expression Engine (see RESPONSIBILITY_MAP.md's Camera/viewport entry) and
  the engine never asks where the camera currently is.
- **Previous operations**: implicitly, via `WorldState.seq` and each
  entity/relation's `firstSeenSeq`/`lastTouchedSeq`, plus `provenance[]`
  (source-turn tracking, max 6 per fact). This is a real, if minimal, notion
  of history — but it is the engine's own log of what *it* decided, not an
  observation of what the canvas currently displays.

This means: if a human manually drags, deletes, or redraws something on the
Excalidraw canvas outside the engine's own writes, the Expression Engine has
no way to notice. Its model of the world can silently diverge from the
canvas. No mitigation for this was found in the codebase.

## How the AI changes the canvas

Not raw JSON, not coordinates from the model, not literal tool calls per
element. The actual output chain, in order of increasing geometric
specificity:

1. **`MeaningDelta`** (the *only* model-output schema, `schemas.ts:499`) —
   entities/relations/claims/references/discourse-acts/interpretation.
   Explicitly, deliberately, **zero geometry** — a submission carrying a
   coordinate is rejected, not stripped (`AGENT.md`, root of repo:
   `geometry rejected: "x" describes what to draw, not what you mean.`).
2. **`ExpressionPlan`** (`schemas.ts` ~line 893) — semantic regions and
   connections (`role`, `entityId`, `childRegionIds`) — still no geometry.
3. **`ScenePlan`** (`schemas.ts:1175`) — the first structure with x/y/w/h,
   produced exclusively by `compose/compose.ts`.
4. **`RenderPatch`** — a diff (add/update/remove) between the last `ScenePlan`
   and the new one, produced by `render/core.ts:diffScenes`.
5. **Excalidraw element skeletons** — produced by `render/excalidraw.ts`, then
   reconciled against the live scene by `render/excalidrawSync.ts`'s own
   signature-based diff (`planCanvasDiff`, deliberately not using Excalidraw's
   own change-diffing) and applied via `apiRef.current.updateScene(...)`.

So the answer is: **semantic deltas → deterministic geometry pipeline →
patches**, a genuine "commands/deltas" model, not raw coordinates from the
model and not a bag of tool calls per shape. This is one of the system's
real architectural strengths (see AUDIT_SUMMARY.md).

## Geometry ownership

| Decision | Owner | Notes |
|---|---|---|
| x/y coordinates | `compose/compose.ts` exclusively | Neither composition/plan.ts nor presentation/plan.ts touch coordinates directly |
| Dimensions | `compose/compose.ts`, informed by `primitives/resolve.ts` (entity type → visual primitive/size) | |
| Layout routine choice | `presentation/plan.ts` (`PresentationLayout`: vertical-spine / left-to-right / hierarchy / central-primary) | `compose.ts` dispatches on the chosen routine name |
| Collision avoidance | `compose/compose.ts`'s own `overlaps()`/overlap-separation pass | Entirely custom; Excalidraw provides no native collision system to lean on |
| Grouping | `composition/plan.ts` (story/spine membership) constrains `clean/plan.ts` (occupancy), which constrains what `presentation/plan.ts` can show | |
| Connection/arrow endpoints | `compose/compose.ts` computes raw `points`; **not** bound to Excalidraw elements | Deliberate — see EXCALIDRAW_COMPARISON.md |
| Arrow routing | `lib/routing.ts` (orthogonal/elbow geometry) via `lib/ops.ts` — a **legacy-era file**, reachability to the current engine not fully confirmed (flagged UNKNOWN in LEGACY_AND_DEAD_CODE.md) | Needs a follow-up trace — the current engine's own arrow geometry appears to live in `compose/compose.ts`, not `lib/routing.ts` |
| Frame placement | Not used at all — zero Excalidraw frame-element usage found anywhere in `lib/expression` | |
| Camera/viewport placement | `lib/composition.ts` + `lib/cameraReplay.ts` (pre-Expression-Engine, still sole owner) + `render/excalidrawSync.ts`'s overflow/page-turn logic | Genuine ownership gap — never rebuilt for the new engine |

## Object identity

- **How objects are identified**: semantic ids minted by
  `uniqueId(slugify(label))` in `world/apply.ts` — human-readable slugs like
  `costs`, `consol` (per `AGENT.md`'s own example), not raw UUIDs and not
  reused Excalidraw element ids.
- **How the AI references existing objects**: by saying the referent again in
  words (per `AGENT.md`: "Refer to something you established earlier by
  saying it again in words; the world resolves identity itself"). The engine,
  not the caller, does the matching.
- **Semantic IDs exist**: yes, and they are the primary key for everything —
  `WorldEntity.id`, referenced by `WorldRelation.source/target`,
  `WorldClaim.about[]`, `Region.entityId`, `SceneObject` (presumably keyed the
  same way through the pipeline).
- **Canvas IDs are not reused as semantic identity** — Excalidraw element ids
  are a separate, lower concern; `render/excalidraw.ts`'s `applyStableIds`
  exists specifically to work around Excalidraw minting fresh random ids on
  every `convertToExcalidrawElements` call, i.e. to give the *rendering* layer
  stable ids, decoupled from the *semantic* layer's ids.
- **Update vs. delete/redraw**: entities are updated in place inside
  `WorldState` when identity resolves to an existing entity; they are marked
  `superseded`/`suspended`/`rejected` via a `status` field rather than deleted
  outright when the discourse moves on (`world/apply.ts`'s lifecycle
  handling). The rendering layer's diff (`RenderPatch`) then decides
  add/update/remove for the actual Excalidraw elements based on what changed
  in the `ScenePlan`, not based on the world's status transitions directly.

## Persistence (canvas-specific)

Covered fully in `STATE_AND_PERSISTENCE.md`. Headline fact repeated here
because it's a canvas-architecture concern too: **drawn pixels persist
(IndexedDB `elements`, synced to Supabase `canvas_json`); the meaning behind
them does not.** A reload restores what's on screen but not the `WorldState`
that produced it — so post-reload, the engine can no longer correctly resolve
"the thing I mentioned earlier" against pre-reload content, because it has no
memory of it. This is a real functional gap, not just an audit nitpick: it
directly contradicts the "board is one continuing world" claim in `AGENT.md`
across a page reload.

## §7 — Planning is scattered, but sequenced (evidence)

Five files are literally named `plan`/`planX`: `planner/plan.ts`,
`planner/visibility.ts`, `composition/plan.ts`, `clean/plan.ts`,
`presentation/plan.ts`. Traced wiring in `pipeline.ts:441-508` confirms a
strict, enforced precedence: `planComposition` → `planClean` (hard-constrained
to composition's `primaryId`/`spine`/`allowed`, `clean/plan.ts:453`) →
`planPresentation` (may only subtract from clean's keep-set) → `planExpression`
(constrained by all three via `applyCleanToPlan`/`applyCompositionToPlan`/
`applyPresentationToPlan`) → `compose()` (coordinates) → three sequential
scene-level constrain passes (`constrainScene`, `constrainCompositionScene`,
`constrainPresentationScene`).

**Verdict**: this is not duplicate *authority* — each stage's decision is
final within its scope and later stages are strictly subordinate, enforced in
code, not just convention. It *is* duplicate *mechanism*: `clean/plan.ts` and
`presentation/plan.ts` each define their own near-identical
`speakerDuplicateIds` function (one exported, one not); `clean/plan.ts` and
`composition/plan.ts` each independently compute spine/hop-map logic. The
real risk is silent divergence if one copy is edited without the other, not a
runtime conflict.

## Repair loop (genuine, bounded)

`evaluate/evaluate.ts:evaluateScene` reverse-interprets the `ScenePlan`'s
geometry back into implied relations and compares against `world.relations`
across 7 scored dimensions. If `semanticPreservation < 0.85` or any problem's
severity `>= 0.6`, `evaluate/repair.ts:planRepair`/`applyRepair` diagnoses
each problem into a `RepairStep` (label a connector, strengthen a link,
drop a detail region, promote emphasis, or — last resort — `change_grammar`
which triggers one recompose). The repaired version is kept only if
`semanticPreservation` strictly improved or tied with lower cost
(`pipeline.ts:536-553`). This is a real observe→evaluate→repair→re-observe
loop, bounded to a single grammar-change recompose — not just logging, and
not unbounded retry either.
