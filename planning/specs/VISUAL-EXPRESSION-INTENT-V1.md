# Visual Expression Intent V1

Status: implemented as a dev-only expression/communicator experiment. It is
not connected to the normal live-speech decision path.

## Checkpoint boundary

Local Intelligence Stack V0 was committed before this work:

- Branch: `expression-engine-default`
- SHA: `c2738d2fae7b2c0111b9b385f687a65f9c501e1b`
- Local models: `qwen3:1.7b`, `qwen3:4b`
- Ollama: `0.33.1`

Cloud providers remain available. Local evaluation explicitly sets
`LLM_PROVIDER=ollama`, leaves `OLLAMA_ALLOW_FALLBACK` empty, and asserts that
the remote-call counter remains zero.

## The separation

`WorldState` is semantic truth. `PresentationIntent` is a request for how the
truth should be expressed. They are independent inputs to Expression:

```text
WorldState ──> semantic intent classifier ──> grammar ──> composition
    │                                           ▲             ▲
    │                                           │             │
    └──────────────── PresentationIntent ──────┴─────────────┘
```

The semantic classifier remains `classifyIntent(world, delta)` and remains
blind to transcript words and presentation. Presentation does not rewrite its
answer. `planExpression` considers the presentation request when choosing a
grammar, and the composer realises the resulting layout.

The exact current pipeline is:

1. `ExpressionSession.foldDelta` applies `MeaningDelta` to `WorldState` unless
   the call is presentation-only.
2. `classifyIntent(WorldState, MeaningDelta)` derives semantic communicative
   intent solely from true entities, relations, claims, and quantities.
3. `planExpression(WorldState, ExpressionIntent, { presentationIntent })`
   chooses the first semantically usable grammar in the presentation chain.
4. The grammar emits regions and connections accountable to existing world
   ids. During explicit presentation, all real relations among shown entities
   remain connected even when they are not the relation family that selected
   the grammar.
5. Composition/Clean/Presentation constrain membership and emphasis. An
   explicit requested grammar is not overwritten by Composition's inferred
   flow grammar.
6. `compose(WorldState, ExpressionPlan, { presentationIntent })` owns all
   coordinates and deterministically realises layout and spatial arrangement.

## InPublic-owned type

Defined in `lib/expression/presentation/intent.ts`:

```ts
type PresentationIntent = {
  form?:
    | "existing"
    | "process"
    | "comparison"
    | "spatial"
    | "magnitude"
    | "causal"
    | "tension";
  scope?: { entityIds: string[] };
  emphasis?: { primaryEntityIds?: string[] };
  spatial?: {
    arrangement?: "separated" | "clustered" | "centralized" | "surrounding";
  };
};
```

Every object is strict Zod. There is no `x`, `y`, width, height, coordinate,
canvas id, Excalidraw id, shape, movement, or resize field. Unknown geometry
is rejected rather than stripped.

`scope` creates a read-only expression view of the same world. It never slices
or writes the stored `WorldState`. Invalid communicator scope/emphasis ids are
discarded before Expression; the communicator prompt explicitly requires ids
from semantic `world.entities`, never renderer `canvas.objects`.

## Deterministic form compatibility

Presentation is preference, not permission to invent compatibility:

| Requested form | First compatible grammar | Honest fallback |
|---|---|---|
| existing | semantic classifier's normal chain | relationship |
| process | process for `transforms_into`, sequence for `precedes` | relationship |
| comparison | comparison for comparative meaning or at least two quantities | relationship |
| magnitude | quantity when quantitative meaning exists | relationship |
| causal | cause_effect when a causal relation exists | relationship |
| tension | comparison when comparative meaning exists | relationship |
| spatial | spatial for true `located_at`; presentation arrangement may still organise a relationship plan | relationship |

Thus `magnitude` with no number, `causal` with no causation, and `spatial`
with no semantic location never create a quantity, causal edge, or
`located_at`. The selected fallback and reason are deterministic and visible
in `ExpressionTrace.plan`.

Spatial arrangement is presentation. The composer, the only layer allowed to
know coordinates, maps `separated`, `clustered`, `centralized`, and
`surrounding` to deterministic distances. Those choices never enter
`WorldState`.

## Communicator path

`VisualCommunicationIntent` now extends the expression-owned presentation
schema: its `form`, `scope`, `emphasis`, and `spatial` fields are exactly
PresentationIntent fields. It adds only `goal`, the semantic question for the
shaping model.

```text
communicator decision
  ├─ goal ─────────────> shaping model ─────> MeaningDelta
  └─ form/scope/etc. ───────────────────────> PresentationIntent

MeaningDelta + PresentationIntent ──────────> Expression
```

The shaping model no longer receives form guidance. Its system prompt asks
only what meaning needs to exist and explicitly forbids using `prevents`,
`contrasts_with`, `transforms_into`, or `located_at` as layout-control tokens.

For new meaning, the existing `express` semantic action carries optional
PresentationIntent into the same Expression fold. For existing meaning,
exactly one new geometry-free expression action exists:

```ts
{
  type: "recompose_expression";
  presentation: PresentationIntent;
}
```

It calls no model, applies no `MeaningDelta`, advances no WorldState sequence,
does not call Excalidraw, and produces a deterministic ScenePlan through
Expression. The dispatcher categorises it as presentation, and the live
controller applies the resulting ordinary Expression update.

## Communication progress memory

Each bounded communicator run now carries:

- messages already spoken;
- the previous communication decision;
- whether the canvas changed;
- whether semantic state changed;
- one explicit repeated-message feedback value.

An exact repeated `speak` or `speak_and_visualize` message is rejected as a
no-op and feeds `This message has already been delivered.` into the next
decision context once. Repeating it again terminates `stalled`. It is not
silently counted as success. The existing repeated unchanged-action stall
guard remains in force for visual decisions.

Every step trace records CommunicationDecision, VisualCommunicationIntent,
PresentationIntent, MeaningDelta when one exists, WorldState before/after,
selected grammar, ScenePlan, CanvasObservation, semantic preservation, and
invented relation ids.

## Boundaries

- No raw drawing, move, resize, or geometry action was added.
- No cloud provider was removed.
- No ordinary live-speech route imports or invokes `lib/communicator`.
- PresentationIntent is not persisted as semantic state.
- No model call occurs during true recomposition.

