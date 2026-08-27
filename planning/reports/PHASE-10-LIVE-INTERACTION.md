# Phase 10 — Live Interaction Orchestration & Quality

Date: 2026-08-27  
Branch: `expression-engine-default`  
Phase 9 checkpoint: `a9414f54ba0fa03fcf02c191c249290aade2516c`  
Phase 9 tag: `inpublic-agent-presence-v0`

## Outcome

InPublic now has one explicit settled-input owner that preserves two complementary live paths. Ordinary new meaning goes directly through the proven `ExpressionLiveController`; explicit existing-world manipulation, correction, and presentation go through the bounded `VisualAgent`. Both paths use the same Expression-owned `WorldState` and Canvas runtime.

Routing is conservative and deterministic. It adds zero model calls. Deepgram interim handling remains unchanged: immediate ink, stable-prefix reflex, and rationed anticipation can respond while speech is unfinished, but no interim invokes the full agent.

## Old and new live flow

Before Phase 10, Deepgram final segments became settled thoughts and all non-command settled thoughts went directly to Expression. VisualAgent existed only behind an explicit development invocation. It had no cancellation contract. Typed `speak` also called Expression directly.

Now:

```text
live speech
  ├─ interim → live ink / reflex / anticipation (never Agent)
  └─ settled → LiveInteractionOrchestrator
                 ├─ express → ExpressionLiveController → ExpressionSession
                 └─ manipulate/present → VisualAgent → VisualAction
                                                      → re-observe
                                  both branches → Canvas → Excalidraw
```

The pre-change trace, exact callbacks, ownership, debounce/coalescing behavior, explicit development paths, and unmount behavior are recorded in `planning/specs/LIVE-INTERACTION.md`.

## Routing

The categories are `express`, `manipulate`, `present`, and `ignore`.

- Explicit manipulation verbs, removals, relationship edits, and correction-plus-reference signals route world-aware.
- Explicit focus/show requests route presentation.
- Empty input is ignored.
- New meaning and uncertainty default to Expression.
- Pronouns alone do not invoke the agent.

The classifier decides only which existing capability owns the turn; it does not extract meaning. It uses no model and adds no prompt. A normal live Expression turn retains its existing meaning-extraction call when a delta is not already supplied. An Agent turn uses one decision call per decision, including the final `done`, bounded by the existing action budget.

## Settling, coalescing, and interruption

Settled Expression turns retain `ExpressionLiveController`'s 900 ms debounce, burst coalescing, serial execution, and continuation folding. Phase 10 does not create one agent run per interim or replace the live controller.

Only one Agent run may be active. At most one latest world-aware instruction waits behind it. A newer instruction cancels the active run and supersedes any older pending instruction. New settled expression also cancels stale Agent work so human speech keeps priority. Undo, clear, and Board unmount cancel outstanding work.

Cancellation is explicit in `VisualAgent`: it stops future decisions and actions, returns `status: "cancelled"`, and clears Canvas presence in `finally`. If a valid action already completed, it remains applied; there is no transactional rollback. If cancellation arrives during an action, that action settles and the runtime re-observes before stopping.

## Human canvas edits, camera, and presence

CanvasObservation remains reality. A deterministic interference scenario moves a semantic object's live canvas element between turns; the next Agent decision observes the moved bounds. Continuing steps already re-observe after every action.

Semantic modifications do not automatically focus. The mounted browser scenario verifies that a correction changes the semantic entity while the viewport revision remains unchanged. Presentation movement remains an explicit `focus` action, so the agent does not fight manual pan/zoom merely because it edited meaning.

Phase 9 presence timing was not changed because the mounted evidence did not show a timing defect. In the browser, direct Expression shows no agent presence; the correction visibly enters thinking and targeted acting, then removes the overlay and returns to idle. Presence remains non-interactive and semantic/canvas-state neutral.

## Metrics

Each interaction trace records:

- speech final to route;
- speech final to first visual change;
- Expression route to first visual change;
- Agent route to first decision;
- Agent decision to action result;
- Agent action result to re-observation;
- total Agent run;
- routing, total model-call, and agent-step counts.

The evaluation output additionally records route/semantic/identity correctness, visual completion, continuation turns, unnecessary and rejected actions, stalled runs, clipping, incorrect connections, unexpected deletion/camera movement, and human-interruption recovery. Traces contain decisions and structured results, never hidden chain-of-thought.

## Deterministic verification

- Live interaction behavior: 7/7.
- Live interaction dependency/interim ownership: passed.
- Agent presence: 9/9.
- VisualAgent: 14/14.
- VisualAction: 14/14.
- Expression: 1,254/1,254.
- Clean/composition/presentation/evaluator: 36/36, 36/36, 27/27, 33/33.
- WorldState persistence: 11/11.
- Canvas boundary, observation, and dependency checks: passed.
- MCP: 13/13.
- Product packaging: 38/38.
- Typecheck: passed (serial rerun after build).
- Production build: passed.
- Browser smoke: 10/10.

The aggregate `npm test` reaches discovery with 48 passed and the same three accepted `EXPRESSION_PLANNING` failures:

1. Family paragraph: Mariam's `role_of` speaker relation is present in WorldState but omitted by the plan.
2. The same family failure in incremental form.
3. Incremental quantity: “apples each” preserves 0.667 because the quantity 4 is absent from the canvas.

A first parallel typecheck attempt raced Next's build-time regeneration of `.next-build/types` and reported missing generated files. The required serial rerun passed; this was runner interference, not a source/type failure.

## Five-category evaluation

`npm run test:interaction:eval` runs five deterministic end-to-end scenarios with scripted decisions and no paid provider:

| Scenario | Route | Model calls | Agent steps | Result |
| --- | --- | ---: | ---: | --- |
| Build | express | 0 | 0 | pass |
| Connect | manipulate | 2 | 1 | pass |
| Correct | manipulate | 2 | 1 | pass |
| Remove | manipulate | 2 | 1 | pass |
| Continue naturally + manual canvas move | express, manipulate | 2 | 1 | pass |

All five had correct routes and semantic identities, visual completion, zero invalid targets, zero unnecessary actions, zero rejected actions, zero stalled loops, zero unintended deletions, zero persistent clipping, and zero unexpected camera movement. Each world-aware scripted scenario needed one action plus one bounded `done` continuation decision. The continuation scenario confirmed current moved canvas bounds reached the first Agent context.

The initial evaluation run rejected three seed worlds before provider invocation. Root cause was the evaluation harness using informal `problem`, `process`, `has_part`, and `contributes_to` values outside the production ontology. The fix was confined to the fixture owner by using canonical `concept`/`action`, `contains`, and `relates_to` values. No agent prompt or runtime schema was weakened.

No paid live-model evaluation was run. Therefore actual token usage and monetary cost are not reported. Deterministic routing cost is zero; scripted scenario call counts above represent provider-decision boundaries, not billed calls. Paid VisualAgent evaluation remains explicitly opt-in through the existing live test command.

## Remaining product-quality debt

- The command classifier is intentionally conservative; natural-language variants not carrying explicit command/correction signals may default to Expression until evidence supports bounded additions.
- Identity and decision quality with real ambiguous speech still require opt-in live-model and human visual evaluation.
- Generic reconciliation when semantic state and arbitrary human canvas deletion diverge remains outside this phase.
- The three accepted Expression planning discoveries remain unresolved.
- `Board.tsx` still owns substantial application wiring, although routing policy itself now lives under `lib/interaction/`.

## Required answers

1. Does ordinary speech still begin visually expressing without waiting for a full agent loop? **Yes.** Interim response is unchanged, and settled new meaning routes directly to Expression.
2. Can a spoken reference/correction invoke the world-aware VisualAgent? **Yes.** Deterministic and browser cases update existing semantic identities through Agent and VisualAction.
3. Does every interim transcript call the agent? **No.** Static dependency checks and runtime ownership keep interims on ink/reflex/anticipation only.
4. If the human changes the canvas while the agent is working, does the next agent step see current reality? **Yes.** The interference evaluation observes the moved live bounds.
5. Can stale agent work be interrupted/cancelled? **Yes.** Cancellation stops future work, bounds pending work, preserves completed actions, returns structured status, and clears presence.
6. Are end-to-end failures now measurable by layer instead of generic “AI quality”? **Yes.** Route, semantic/identity, action/result, canvas, viewport, presence, latency, call, and step evidence are emitted separately.

Phase 10 is complete. No subsequent architecture phase was started.
