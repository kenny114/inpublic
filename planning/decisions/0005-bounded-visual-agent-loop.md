# ADR 0005: Bounded Visual Agent Loop

- Status: Accepted
- Date: 2026-08-27

## Context

Phases 5–7 established three separate capabilities: durable semantic `WorldState`, normalized read-only `CanvasObservation`, and a strict geometry-free `VisualAction` language with deterministic execution. No runtime combined them. A model could not inspect both semantic intent and actual canvas reality, choose an allowed action, learn what deterministic execution did, and continue or stop.

Closing that loop without a hard boundary would risk model-produced geometry, direct Canvas calls, skipped observations between batches, unbounded continuation, duplicate provider stacks, and automatic reconciliation that overwrites human presentation edits.

## Decision

InPublic has one `VisualAgent` runtime under `lib/agent/`. It owns observation orchestration, compact model context, strict decision validation, one-action continuation, deterministic ActionResult feedback, loop protection, and structured stop results.

Each decision receives distinct normalized views of current `WorldState` and current `CanvasObservation`. The canvas view may include normalized geometry so the model can understand actual spatial reality. Model output remains the strict `AgentDecision` union: one `VisualAction`, `done`, or `cannot_complete`. The model chooses what should happen but cannot produce geometry, Excalidraw elements, Canvas mutations, tool names, or action batches.

An `act` decision is executed only through the Phase 7 `VisualActionDispatcher`. Semantic actions still update WorldState and re-enter Expression before Canvas reconciliation. Presentation actions still use Canvas without semantic mutation. The Agent never calls Excalidraw directly.

The loop calls `CanvasRuntime.observe()` before every decision and again immediately after every dispatched action. The next decision therefore sees actual resulting canvas state and compact deterministic ActionResult feedback (`applied`, `noop`, or `rejected`, reason/code, and changed components).

The default hard action budget is four, configurable from one to eight at the Agent boundary. One final decision after the last action may report completion; a further action returns `step_limit` without execution. Repeating the same action against the same semantic/canvas revisions with the same noop or rejection stalls after the second occurrence. Two consecutive applied-without-progress outcomes also stall.

The live decision adapter uses the existing centralized `lib/llm.ts` provider abstraction through a guarded server endpoint. The loop accepts an injected decision provider, so deterministic tests and browser smoke use scripted decisions and no paid call. Live-model evaluation is explicit and opt-in.

No generic WorldState/Canvas reconciliation is introduced. Human movement, selection, deletion, and viewport state remain first-class canvas reality visible to the next decision. The agent may act on a discrepancy only when relevant to the current explicit instruction and expressible through existing VisualActions.

The existing continuous speech fast path remains unchanged. Phase 8 exposes the agent through an explicit development harness and leaves settled-speech policy and external/MCP integration for later work.

## Consequences

- Model reasoning can consume semantic state and actual canvas state without either layer depending on the Agent.
- Every model-selected mutation remains subject to strict action validation and deterministic execution.
- Observation between actions is enforced by loop structure rather than prompt guidance.
- Callers receive `completed`, `blocked`, `step_limit`, or `stalled`; they do not infer completion from logs.
- Agent traces record compact structured facts and revisions, not hidden reasoning or permanent project history.
- The loop cannot run forever and does not silently retry rejected actions.
- Continuous speech retains its current latency profile because interim transcripts do not invoke the Agent.
- Multi-agent decomposition, model-generated batches, background reconciliation, semantic repositioning, and durable trace persistence remain out of scope.
