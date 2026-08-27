# Live Interaction Orchestration

Phase 10 gives settled live speech one owner for choosing between InPublic's existing direct Expression path and its existing world-aware VisualAgent path. It does not replace either path.

## Pre-change runtime trace

### Microphone and interim speech

1. `useDeepgram` opens the microphone/capture graph, streams audio, and forwards every non-final transcript to `Board.handleInterim` with provider/audio timing.
2. `handleInterim` corrects display text without changing raw stability bookkeeping, updates the transcript strip, and immediately calls `writeLive(..., settled=false)`. This is the first visible response and has no model dependency.
3. Two consecutive interims agreeing on a prefix mark words stable. Stable prefixes call `ExpressionLiveController.reflex`, a synchronous deterministic entity-only fast path, and `anticipate`, a rationed optional extraction pass that can fold entities but never references, corrections, relations, claims, or numbers.
4. Exact closed-set undo/clear commands may fire from a fully stable interim. They bypass expression and are deduplicated against the later final.

### Finals and settled thoughts

1. `useDeepgram` forwards each final to `Board.handleFinal`, then clears the current interim.
2. `handleFinal` applies vocabulary correction, records transcript/timing, resets interim stability and the per-utterance reflex/anticipation ration, and feeds the final into `pushPresentationSegment`.
3. Presentation V2/V3 deterministically holds incomplete clauses across provider finals. Only emitted `SettledThought` values are permanent. Each is written as settled transcript ink and passed to `handleSettledExpression`.
4. `handleSettledExpression` marks the thought pending and calls `ExpressionLiveController.submit`.
5. `ExpressionLiveController` debounces for 900 ms, coalesces adjacent text submissions, serializes one fold at a time, extracts `MeaningDelta`, updates the one durable `WorldState`, and plans/composes/evaluates. It starts the Board update callback without awaiting its asynchronous Canvas work; speech arriving during a fold stays buffered for the next debounced batch.
6. The Board update callback calls `CanvasRuntime.applyExpression` to reconcile the Expression-owned region incrementally. The visual-change metric is recorded at the actual structure commit, and the callback later clears pending thought ids.
7. On recording stop, `flushPresentationBoundary` emits any held thought through the same settled path before Deepgram teardown.

### Other entry points

- `window.inpublic.speak(...)` simulates settled speech by calling the same pre-change settled Expression handler.
- `window.inpublic.express(...)` and the MCP tool use `ExpressionEntry`, which submits text or validated structured meaning to the same `ExpressionLiveController` and same WorldState.
- `window.inpublic.runVisualAgent(...)` invokes the bounded VisualAgent explicitly. It observes current WorldState and CanvasObservation before each decision and after each action.
- Local undo/clear voice commands remain a separate deterministic closed set.
- `useDeepgram` aborts token fetches, closes capture resources, and stops on unmount. Before Phase 10 the VisualAgent has no cancellation API; an in-flight provider decision can outlive new speech or Board teardown.

## Routing contract

```text
interim transcript ──► live ink + reflex + rationed anticipation
                              (never VisualAgent)

settled thought ──► LiveInteractionOrchestrator
                         ├─ express ──► ExpressionLiveController
                         ├─ manipulate/present ──► VisualAgent
                         └─ ignore ──► no action
```

`LiveInteractionIntent` has exactly four states: `express`, `manipulate`, `present`, and `ignore`.

- `express` is the safe default and covers ordinary new claims, descriptions, quantities, sequences, and relationships being introduced.
- `manipulate` requires explicit operational language (remove/delete/connect/change/rename/reverse/move/put) or an explicit correction marker combined with an existing-world reference. Pronouns alone do not route to the agent.
- `present` requires an explicit focus/frame/zoom request or a “show me” presentation request.
- `ignore` is empty/whitespace only; closed-set local commands are consumed before this boundary.

Classification is deterministic and makes zero model calls. Existing semantic extraction and identity/reference resolution remain authoritative after routing: Expression handles new meaning; VisualAgent reasons over current WorldState and CanvasObservation for a routed world-aware instruction.

## Interruption and cancellation

- Express submissions enter the existing coalescing controller immediately.
- A new settled human instruction cancels an active VisualAgent run before it may take another decision or action.
- For world-aware input, the orchestrator retains at most one latest pending instruction. A newer instruction supersedes an older pending one with a structured cancelled result.
- Cancellation does not roll back valid actions already applied. If cancellation occurs during an action, the action completes and is re-observed, then the run returns cancelled.
- Cancellation clears ephemeral presence in the Agent's existing `finally` cleanup.
- Human canvas edits remain reality; any continuing step uses the existing mandatory fresh observation.

## Metrics and trace

Each settled interaction records no raw audio and only the already-settled thought text used by existing developer traces. It records:

- route and deterministic routing reason;
- `speech_final_to_route`;
- `speech_final_to_first_visual_change` when a change occurs;
- `express_route_to_first_visual_change` for Expression;
- `agent_route_to_first_decision`;
- `agent_decision_to_action_result`;
- `agent_action_to_reobservation`;
- `total_agent_run`;
- routing/model call counts and agent step count;
- VisualActions, ActionResults, and canvas revisions already present in the Agent trace;
- terminal status and cancellation/supersession reason.

No chain-of-thought is recorded.

## Quality contract

- Ordinary settled meaning never waits for a VisualAgent decision.
- Interim transcripts never invoke VisualAgent.
- Explicit manipulation and presentation language reaches the world-aware path.
- Both paths share the same Expression controller and WorldState.
- No action geometry, Excalidraw type, or routing rule enters model output.
- No automatic focus accompanies semantic actions.
- Camera and Phase 9 presence policy remain unchanged unless browser/live evidence demonstrates a defect.
- Paid live evaluation is opt-in; deterministic routing and browser smoke remain free.
