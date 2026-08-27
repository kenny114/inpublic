# ADR 0007: Live Interaction Orchestration

- Status: Accepted
- Date: 2026-08-27

## Context

InPublic had two proven capabilities with different latency and context needs: `ExpressionLiveController` could turn ordinary settled speech into a visual world quickly, while `VisualAgent` could observe and change an existing semantic/canvas world through bounded `VisualAction` steps. Sending every transcript through the agent would discard Expression's live cadence and add avoidable model latency. Leaving the two entry points unrelated would make corrections and references become unrelated new expression.

Interim speech already feeds immediate ink, deterministic reflexes, and rationed anticipation. Those partial transcripts are unstable and must not start expensive world-aware loops.

## Decision

InPublic maintains two complementary live paths behind one small `LiveInteractionOrchestrator` in `lib/interaction/`:

- New meaning favors direct Expression.
- Existing-world manipulation, correction, inspection, and presentation favor `VisualAgent`.
- Empty or non-semantic input may be ignored.

Routing is a conservative deterministic command classifier with zero model calls. Explicit imperative and correction signals select the world-aware path; pronouns alone do not. Uncertain utterances default to Expression. Classification decides routing only and does not duplicate semantic extraction.

Deepgram interim handling remains unchanged and cannot call the orchestrator or agent. Only settled thoughts enter routing. The direct branch reuses `ExpressionLiveController`, including its debounce, burst coalescing, `ExpressionSession`, and existing Canvas synchronization. The world-aware branch reuses the bounded agent, dispatcher, and the same Expression-owned `WorldState`.

One agent run may be active and only the latest additional world-aware instruction is retained. New settled expression or a newer agent instruction cancels stale agent work. Cancellation stops future decisions/actions, clears ephemeral presence, returns a structured `cancelled` result, and never rolls back valid actions already applied. Continuing steps re-observe, so current Canvas state—including human moves, deletes, selection, pan, or zoom—is authoritative.

Routing and run traces record route latency, first visual change, decision/action/re-observation timing, total duration, provider-call count, and agent-step count without storing hidden reasoning. Evaluation judges the combined product flow end to end with deterministic scenarios, browser smoke, and optional explicitly invoked paid-model runs.

## Consequences

- Ordinary settled speech retains the shortest proven visual path; interim speech retains immediate behavior.
- References and corrections can use current semantic identity and live CanvasObservation without creating a second world.
- The routing layer adds no provider call and no prompt.
- Human input has priority and stale work is bounded and cancellable.
- Camera movement remains action-specific: semantic edits do not automatically focus, and presentation focus stays explicit.
- Deterministic orchestration tests and five category evaluations can attribute failures to routing, identity, decision, execution, expression, canvas, viewport, or presence.
- Richer natural-language command classification and live-model quality remain evidence-driven improvements, not a new architecture phase.
