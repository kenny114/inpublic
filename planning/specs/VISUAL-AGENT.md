# Bounded Visual Agent

Status: Phase 8 implementation contract

## Purpose

Phase 8 adds one explicit `VisualAgent` runtime that can read the durable semantic world and actual Canvas observation, request one strict geometry-free `VisualAction`, execute it through the existing deterministic dispatcher, re-observe reality, and decide whether to continue or stop.

The Agent is orchestration only. It does not own meaning, layout, rendering, Canvas implementation, persistence, or a second model-provider stack.

## Runtime boundary

```text
instruction
  -> observe WorldState + CanvasObservation
  -> compact AgentContext
  -> AgentDecision provider
  -> strict AgentDecision validation
  -> one VisualAction
  -> existing deterministic dispatcher
  -> WorldState -> Expression -> Canvas OR presentation -> Canvas
  -> re-observe actual Canvas
  -> next decision or structured stop
```

The direct live speech-to-Expression path remains unchanged. The visual agent is invoked explicitly by a developer harness, future settled-instruction path, or future bridge.

## Inputs

`runVisualAgent` receives:

- a non-empty instruction, bounded to 2,000 characters;
- the existing semantic runtime and `CanvasRuntime` through a narrow observation interface;
- the existing `VisualActionDispatcher`;
- one injected `AgentDecisionProvider`;
- an optional action-step budget, clamped by the boundary.

The runtime rejects an empty/oversized instruction or unavailable Canvas observation without mutating WorldState or Canvas.

## AgentContext

```ts
type AgentContext = {
  instruction: string;
  world: AgentWorldView;
  canvas: AgentCanvasView;
  previousAction?: VisualAction;
  previousResult?: AgentActionFeedback;
  step: number;
  remainingSteps: number;
};
```

`step` is the next one-based decision/action position. `remainingSteps` is the number of actions still executable, not an invitation for the model to alter the budget.

### AgentWorldView

The compact world view supplies only decision-relevant semantic state:

- topic and interpretation;
- live and archived entities with stable semantic id, type, label, status, description, quantity, compact attributes, confidence, importance, and recency;
- relationships with stable relation id, stable endpoint ids, type/role/spatial information, confidence, and recency;
- claims with id, compact text, semantic `about` ids, uncertainty/invalidated state, confidence, and importance;
- salience ids and world sequence.

Aliases, provenance histories, first-seen bookkeeping, metric history internals, raw extraction structures, and renderer state are withheld.

### AgentCanvasView

The compact canvas view derives from the current `CanvasObservation` and current ScenePlan identity mapping. It supplies:

- observation scene/selection/viewport revisions;
- normalized element id and type;
- normalized bounds (`x`, `y`, `width`, `height`) and angle;
- compact visible text;
- selection state, order, group/container/frame ids;
- semantic entity id when the existing SceneObject-derived identity can establish one;
- viewport bounds and zoom.

Canvas geometry is input evidence only. It lets the model understand actual position, selection, visibility, and human edits. It never becomes a legal action output.

Raw Excalidraw objects, editor API methods, style data, binary files, raw app state, ScenePlan internals, RenderPatch, and canvas mutation handles are withheld.

## AgentDecision

The only valid provider output is the strict union:

```ts
type AgentDecision =
  | { type: "act"; action: VisualAction }
  | { type: "done" }
  | { type: "cannot_complete"; reason: string };
```

An `act` contains exactly one existing `VisualAction`. Strict Zod validation rejects extra properties, arrays of actions, free-form tool names, arbitrary operations, coordinates, Excalidraw elements, or invalid semantic ids/action shapes. The deterministic dispatcher performs state-dependent validation and execution after decision validation.

Invalid model output never reaches the dispatcher and returns a structured blocked result. Provider errors also return blocked results. Neither condition mutates WorldState or Canvas.

## Decision provider

`AgentDecisionProvider` is injected into the loop so orchestration tests and browser smoke use deterministic fake decisions with no paid calls.

The live provider uses the centralized `lib/llm.ts` `complete` abstraction through a server-only decision endpoint. Its prompt:

- identifies the system as a controller of a live semantic visual world;
- supplies only the normalized `AgentContext`;
- asks for the single smallest valid action;
- forbids geometry, invented ids, Canvas/editor calls, and action batches;
- tells the model to use only supplied semantic identities;
- tells it to return `done` when the requested state already exists;
- includes the previous deterministic action result so rejection/no-op recovery is informed by execution reality.

Prompting and model parsing are separate from deterministic loop execution.

## Budget and cadence

Default budget: **4 executed or attempted actions**.

Four actions cover the current small vocabulary's useful multi-step changes while bounding latency and provider cost. Callers may request 1–8 actions; values outside that range are clamped, and model output cannot change it.

The runtime permits one final decision after the last action so the provider can report `done` or `cannot_complete`. A further `act` returns `step_limit` without executing it. Thus a run makes at most `budget + 1` decision requests and at most `budget` dispatch calls.

## Observation cadence

The loop obtains a fresh WorldState snapshot and calls `CanvasRuntime.observe()` before every decision. After each dispatched action, it calls `observe()` again and records the resulting revisions before any next decision. Therefore two executed actions can never share a single initial observation:

```text
observe -> decide -> dispatch -> observe -> decide -> dispatch -> observe
```

The post-action observation becomes the factual source for the next normalized context. Human movement, selection, deletion, or viewport changes are retained as actual presentation reality. No generic WorldState/Canvas reconciliation runs.

## ActionResult feedback

The next `AgentContext.previousResult` contains only compact deterministic feedback:

- status: `applied`, `noop`, or `rejected`;
- action type and semantic/presentation/validation category;
- reason and rejection code when present;
- whether the semantic world, scene, canvas scene, selection, or viewport changed.

The full Phase 7 snapshots are not sent back to the model because the next current world/canvas views already describe reality.

## Stopping conditions

The loop returns one explicit `AgentRunResult`:

```ts
type AgentRunResult =
  | { status: "completed"; steps: number; trace: AgentRunTrace }
  | { status: "blocked"; reason: string; steps: number; trace: AgentRunTrace }
  | { status: "step_limit"; steps: number; trace: AgentRunTrace }
  | { status: "stalled"; reason: string; steps: number; trace: AgentRunTrace };
```

- `done` -> `completed`.
- `cannot_complete` -> `blocked` with the supplied reason.
- invalid/provider-failed decision -> `blocked` without dispatch.
- unavailable Canvas observation -> `blocked`.
- an `act` after the action budget -> `step_limit` without dispatch.
- the same action against the same world/canvas revision producing the same `noop` or `rejected` result twice consecutively -> `stalled`.
- two consecutive `applied` results with no semantic, scene, or canvas revision change -> `stalled`.

A first no-op or rejection is fed back and permits one recovery decision. The loop never uses an unbounded `while (!done)`.

## Trace

Each run keeps an in-memory structured trace suitable for tests and developer inspection:

```ts
type AgentStepTrace = {
  step: number;
  observed: { world: string; scene: string; selection: string; viewport: string };
  decision: AgentDecision | AgentDecisionFailure;
  actionResult?: AgentActionFeedback;
  resulting?: { world: string; scene: string; selection: string; viewport: string };
};
```

The trace records structured decision facts and compact fingerprints, not hidden reasoning or giant duplicated canvas snapshots. It is returned to the caller and is not persisted to projects in Phase 8.

## Failure and mutation guarantees

- Decision validation failure and provider failure execute no action.
- Dispatcher rejection retains Phase 7's no-mutation guarantee.
- A presentation action cannot mutate WorldState.
- A semantic action still flows through WorldState, Expression, and Canvas reconciliation.
- The Agent never calls Excalidraw, produces raw geometry, or bypasses the dispatcher.
- No automatic retries occur outside the next bounded model decision.

## Integration and evaluation

Development exposes an explicit `window.inpublic.runVisualAgent(instruction, options?)` harness plus deterministic fake-decision support for smoke tests. It returns the final result and inspectable trace. Existing `express`, `act`, and continuous speech paths remain available and unchanged.

Deterministic tests cover orchestration without model cost. An opt-in live-model evaluation script uses fixed worlds/ids and is excluded from normal `npm test`; it runs only when explicitly enabled and credentials/authorization are available. No external/MCP bridge is required to prove this phase, so `express_meaning` remains unchanged and a new bridge is deferred.
