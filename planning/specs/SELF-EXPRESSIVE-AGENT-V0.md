# Self-Expressive Visual Agent V0

Status: experimental, dev-only, isolated from the live-speech product path.

## Purpose

Every runtime in InPublic today answers a variant of "given an instruction,
what canvas mutation should occur?" — Expression turns settled speech into
meaning; VisualAgent turns an explicit instruction into one `VisualAction`.
Both assume the human already decided that something should appear on the
canvas.

This experiment asks a different question: **can an AI decide, on its own,
that an idea needs a visual at all** — and if so, in what form — without
being told to draw, show, connect, or visualize? It tests whether the canvas
can become one of the AI's own communication modalities, not only a
transcription surface for the human's.

This is not another architecture phase. It adds one new decision layer
*above* the existing systems and changes none of them.

## What this does not touch

`WorldState`, `CanvasObservation`, the Expression Engine, `VisualAction`,
`VisualAgent`, `AgentPresence`, and `LiveInteractionOrchestrator` are
unmodified. The live speech-to-Expression path, `Board.tsx`'s wiring, and
`classifyLiveInteraction` routing are unmodified. No production entry point
calls into this experiment. It is reachable only from a dev-only evaluation
script (`scripts/self-expressive-agent-v0-eval.mjs`), gated behind an opt-in
environment flag, exactly like the paid live-agent evaluations that preceded
it.

## Ownership and dependency direction

New layer: `lib/communicator/`.

- `lib/communicator/` may depend on `lib/agent`, `lib/visual-actions`, and
  `lib/expression` (for `MeaningDelta`/`WorldState` types and the shared
  `sanitizeDelta`/`extractJsonObject` helpers).
- Nothing in `lib/agent`, `lib/visual-actions`, `lib/expression`, or
  `lib/canvas` may depend on `lib/communicator`. The dependency arrow points
  one way, same discipline as Agent's own relationship to Expression/Canvas
  (`lib/CONTEXT.md`).
- `lib/communicator/` never calls Canvas, Excalidraw, or the model provider
  outside the two calls named below. It never mutates `WorldState` or
  `ScenePlan` directly — every mutation still goes through the existing
  `VisualActionDispatcher`.

## The core change

Today:

```text
instruction -> decide canvas action
```

This experiment adds, above it:

```text
communication goal -> decide how best to communicate (words / visual / both) -> [existing systems]
```

The new decision is *whether and how* to communicate. It never decides
geometry, and it never bypasses the deterministic dispatcher that already
guards every mutation.

## `CommunicationDecision`

Implemented in `lib/communicator/types.ts` as a strict Zod discriminated
union, following the same convention as `AgentDecisionSchema`
(`lib/agent/types.ts`):

```ts
type CommunicationDecision =
  | { type: "speak"; message: string }
  | { type: "visualize"; intent: VisualCommunicationIntent }
  | { type: "speak_and_visualize"; message: string; intent: VisualCommunicationIntent }
  | { type: "recompose"; intent: VisualCommunicationIntent }
  | { type: "emphasize"; target: string /* existing semantic id */ }
  | { type: "done" };
```

## `VisualCommunicationIntent`

Answers "what am I trying to make the human SEE," never "what mutation
should occur" (that remains `VisualAction`'s question) and never "where does
it go" (that remains the deterministic composer's question):

```ts
type VisualCommunicationIntent = {
  goal: string;                 // "model costs are growing faster than revenue"
  form: "spatial" | "process" | "comparison" | "magnitude" | "causal" | "tension" | "existing";
  aboutEntityIds?: string[];    // existing entities this idea concerns, never invented
  spatialQualifier?: SpatialRelation; // only meaningful when form === "spatial"
};
```

No coordinates, no element ids, no Excalidraw vocabulary appear anywhere in
this type or in the `CommunicationDecision` union. Both are enforced by
`.strict()` Zod schemas, so an extra geometric field fails validation rather
than silently passing through.

## The six forms, and how each becomes a real picture without new geometry

InPublic already has a deterministic grammar library
(`lib/expression/grammars/index.ts`, 10 grammars) and a deterministic
intent classifier (`lib/expression/intent/classify.ts`) that picks a grammar
**entirely from the relation TYPES present in `WorldState`** — never from an
explicit hint field, and never from the transcript's words. That fact is
what this experiment reuses instead of inventing a parallel layout system:

| form | shaped toward | grammar this tends to select |
|---|---|---|
| spatial | `located_at` relations with a proximity/containment qualifier | `spatial` |
| process | `transforms_into` chain | `process` |
| comparison | `contrasts_with` / `greater_than` / `less_than` between two poles | `comparison` |
| magnitude | `quantity` on entities + `greater_than`/`less_than` | `quantity` / `compare` |
| causal | `causes` / `enables` / `depends_on` / `prevents` chain | `cause_effect` |
| tension | `contrasts_with` plus `prevents`/`refutes` (a comparison with an argumentative edge) | `comparison` (argue-weighted) |
| existing | whatever the extracted meaning's own relation types are | whichever grammar's `GRAMMAR_FOR_INTENT` mapping fits |

Geometry itself never enters this experiment's vocabulary: the composer
(`lib/expression/compose/compose.ts`) still owns every coordinate, exactly
as it does for ordinary speech.

### Known limitation: spatial "separation" is not expressible today

The task's own spatial example — "isolated / surrounded / far apart / inside
/ outside / central / peripheral / crowded / separated" — does not match
`SpatialRelationSchema`'s actual vocabulary, which is
`near/beside/above/below/behind/in_front_of/inside/on` (proximity and
containment only; confirmed by reading
`lib/expression/compose/compose.ts`'s `SPATIAL_OFFSET` table, the only place
a `spatial` qualifier is consumed). This experiment can approximate
"separated" only by declining to add a proximity relation between things
that should read as apart — it cannot *enforce* distance, because no
deterministic layout primitive for that exists yet. This is reported
honestly as a finding in the evaluation, not patched here: adding a "keep
apart" primitive is new production geometry vocabulary, out of this
experiment's scope.

## Two model calls, both isolated from Expression's own prompt

1. **Decision** (`lib/communicator/model.ts`, `decideWithCommunicatorModel`) —
   given the user's message, the communication goal, the compact
   `AgentWorldView`/`AgentCanvasView` (reused as-is from `lib/agent/context.ts`),
   and recent communication history, returns one `CommunicationDecision`.
2. **Shaping** (`lib/communicator/shape.ts`, `shapeVisualIntent`) — given a
   `VisualCommunicationIntent`, returns a real `MeaningDelta`, biased toward
   the relation vocabulary the requested form needs (see table above). This
   is a *different* prompt from Expression's own `extractMeaning`
   (`lib/expression/meaning/extract.ts`) on purpose: reusing that exact
   prompt/endpoint would put this experiment on the production path, and
   Expression's prompt has no notion of a target visual form. Both calls go
   through the same shared `lib/llm.ts` `complete()` abstraction (one
   centralized text-model provider, per `planning/CONTEXT.md`).

Neither call ever emits geometry — the shaping call's system prompt states
this explicitly, and even if it tried, `MeaningDeltaSchema` (the same schema
Expression's own extractor is validated against) has no field a coordinate
could occupy.

## Transformation over generation

Both prompts (decision and shaping) are explicitly instructed to inspect
`AgentWorldView`/`AgentCanvasView` first and prefer, in order:

1. `emphasize` — reuses the existing `focus` `VisualAction` verbatim, zero
   new code, when the idea is already visible and only needs attention drawn
   to it.
2. `recompose` — when the idea concerns entities already on the canvas, the
   shaping call is steered (via `aboutEntityIds`) to restate their existing
   ids/labels rather than inventing new ones, so the underlying `express`
   action updates/extends what's there instead of duplicating it.
3. `visualize` — only when nothing already on the canvas is a reasonable
   starting point for the idea.

### Known limitation: `recompose` is not a true "same facts, new grammar" operation yet

`lib/expression/intent/classify.ts` selects a grammar purely from relation
types already in `WorldState`; there is no existing `VisualAction` that says
"re-render this exact WorldState under a different grammar, without
changing any fact." In this v0, `recompose` is implemented
(`lib/communicator/execute.ts`) as a restatement through the same `express`
path `visualize` uses, steered toward existing entities. It can shift which
grammar wins (e.g. adding a `contrasts_with` relation between two entities
that previously only had `relates_to` can flip the picture from
`relationship` to `comparison`), which is a real, useful effect — but it is
not a pure re-layout of unchanged facts. This is reported as a finding, not
fixed here, because building that primitive is new production surface.

## The bounded communication loop

`lib/communicator/loop.ts`, mirroring `lib/agent/loop.ts`'s discipline
exactly:

```text
observe WorldState + CanvasObservation
  -> compact CommunicationContext (reusing AgentWorldView/AgentCanvasView)
  -> CommunicationDecision provider
  -> strict CommunicationDecision validation
  -> executeCommunicationDecision (dispatches through the EXISTING VisualActionDispatcher, or speaks)
  -> re-observe actual Canvas
  -> next decision or structured terminal result
```

Hard step budget: default 6, clamped 1–8 (`DEFAULT_COMMUNICATOR_STEP_BUDGET`,
`MAX_COMMUNICATOR_STEP_BUDGET`), the same shape as Agent's 4/1–8. Terminal
results are the same closed set Agent uses: `completed` (`done`), `blocked`
(invalid decision, provider error, or unavailable observation), `step_limit`,
`stalled` (an identical decision producing an identical, scene-unchanged
outcome). No unbounded `while (!clear)`.

## What the model can and cannot choose

Can choose: whether to speak, visualize, both, recompose, or emphasize;
which of the six forms fits an idea; which existing entities an idea is
about; when recomposition beats appending; when the idea is clear enough to
stop.

Cannot choose: Excalidraw elements, coordinates, raw paths, pixel sizes, or
any direct Canvas/scene mutation. Both schemas are `.strict()`, and every
mutation still flows through the existing `VisualActionDispatcher`, which
knows nothing about "communication" and would reject anything outside its
existing five semantic/presentation action shapes regardless of what this
layer asked for.

## Demonstration scenarios (dev-only, no seeded WorldState, no visual instructions given)

1. "Explain why an AI startup can gain users while becoming financially
   weaker." — no expected sequence is hard-coded; the communicator must
   decide its own path.
2. "Explain why three teams that do not communicate create organizational
   problems." — tests whether `spatial` form is chosen and whether it
   produces a meaningfully different picture from a generic relationship
   diagram, within the limitation noted above.
3. "Explain the trade-off between moving quickly and maintaining accuracy."
   — tests whether `tension` is recognized as distinct from a plain
   `comparison`.

## Evaluation posture

Schema validity is a gate, not the finding. The evaluation
(`evaluation/reports/SELF-EXPRESSIVE-AGENT-V0.md`) judges: did the
communicator choose to visualize at a useful moment; did the chosen form fit
the meaning; did the visual make the explanation easier to follow; did it
transform/recompose rather than only append; did the canvas get clearer as
the explanation progressed; did the result read as an AI communicating
visually rather than an AI generating diagrams. If all three demonstrations
converge on boxes-arrows-labels regardless of form, that is a failed
experiment even if every decision validates.

## Explicitly out of scope for this experiment

No change to `classifyLiveInteraction` or `LiveInteractionOrchestrator`. No
new `VisualAction` types. No new spatial-separation geometry primitive. No
routing of ordinary speech through this layer. No persistence of
`CommunicationDecision` history beyond one run's in-memory trace. This
experiment answers one question and stops; it does not become the next
architecture phase by default.
