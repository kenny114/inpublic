# Phase 8: Close the Visual Agent Loop

## Result

Phase 8 adds the first bounded InPublic visual agent. Explicit AI reasoning can now consume a compact semantic view derived from durable `WorldState` and a compact structural view derived from actual `CanvasObservation`, return one strict `AgentDecision`, execute one existing geometry-free `VisualAction` through the deterministic Phase 7 dispatcher, re-observe the resulting live canvas, and continue or stop.

There is one agent, not a swarm. It creates no alternate meaning, rendering, Canvas, persistence, or provider system. The direct continuous-speech Expression path remains unchanged.

## Pre-agent checkpoint

Checkpoint audit on 2026-08-27:

- Branch: `expression-engine-default`.
- HEAD: `e191601111ae5e3cefd567aef52e3cd38d524638`.
- Existing `inpublic-pre-agent-v0` tag: absent.
- Working tree: dirty, containing completed but uncommitted Phase 6 and Phase 7 implementation/documentation.

No tag was created. Tagging HEAD would have falsely claimed that commit contained Phase 7, while tagging the dirty working tree is impossible. The working tree was preserved.

## Baseline

The pre-implementation Phase 7 baseline was:

- `npm run typecheck`: clean when run serially. An initial parallel invocation overlapped `next build` regenerating `.next-build/types` and produced transient missing-file errors; the serial rerun was clean.
- `npm run build`: clean.
- Canvas boundary, Canvas observation, and Canvas dependency checks: passed.
- WorldState persistence: **11 passed / 0 failed**.
- VisualAction: **14 passed / 0 failed**.
- Expression: **1,254 passed / 0 failed**.
- Discovery: **48 passed / the same 3 known failures**.
- MCP: **13 passed / 0 failed**.
- Product packaging: **38 passed / 0 failed**.
- Browser smoke: **7/7 passed**.

The accepted discovery failures remain the two missing Mariam `role_of` plan connections and the incremental “four apples each” quantity preservation case.

## Agent architecture

```text
explicit instruction
  -> VisualAgent
  -> fresh WorldState + fresh CanvasObservation
  -> compact AgentContext
  -> one AgentDecision
     -> done / cannot_complete
     -> one VisualAction
  -> existing deterministic dispatcher
     -> semantic: WorldState -> Expression -> Canvas
     -> presentation: Canvas
  -> mandatory post-action CanvasObservation
  -> ActionResult feedback + actual new state
  -> next bounded decision
```

`lib/agent/` owns context normalization, decision validation, provider-independent orchestration, ActionResult feedback, bounded continuation, trace, and stopping. It imports no Excalidraw package and performs no Canvas mutation itself. Meaning, Expression, Canvas, and VisualAction do not depend on Agent.

## AgentContext schema

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

The world view contains stable semantic entity and relation ids, semantic labels/types/status/importance, useful descriptions/quantity/attributes/confidence/recency, compact claims, salience, topic/interpretation, and sequence. It omits aliases, provenance histories, first-seen bookkeeping, metric internals, extractor state, renderer state, and persistence machinery.

The canvas view contains current element identity/type, normalized bounds and angle, visible text, selection, order, groups/container/frame identity, viewport, independent observation revisions, and a semantic entity mapping when the existing SceneObject-derived identity can establish one. Geometry is model input evidence only. Raw Excalidraw objects, app state, styling, files, API methods, ScenePlan internals, RenderPatch, and mutation handles are withheld.

Views are strictly bounded. Instruction length is 1–2,000 characters; Canvas elements are capped at 160; existing WorldState schema bounds remain in force.

## AgentDecision schema

```ts
type AgentDecision =
  | { type: "act"; action: VisualAction }
  | { type: "done" }
  | { type: "cannot_complete"; reason: string };
```

All variants are strict Zod objects. An act contains exactly one Phase 7 `VisualAction`. There are no free-form tools, arbitrary operations, action arrays, coordinates, canvas element mutations, or Excalidraw types. Invalid model output is blocked before dispatch and mutates nothing.

## AgentRunResult schema

The caller receives one deterministic status:

- `completed`: the decision provider returned `done`;
- `blocked`: provider/decision failure, unavailable observation, concurrent run, invalid instruction, or `cannot_complete`;
- `step_limit`: the provider requested another action after exhausting the hard budget;
- `stalled`: deterministic repeated no-progress protection fired.

Every result includes the number of attempted/executed actions, a compact structured trace, and a final normalized World/Canvas state. Callers do not infer success from console logs.

## Model-provider integration

The live adapter calls the existing centralized `lib/llm.ts` `complete` abstraction. `VISUAL_AGENT_MODEL` defaults to the existing `ARTIST_MODEL` and may be configured by environment. The request uses temperature zero and a 1,200-token output budget.

The browser calls one guarded `/api/agent/decision` route. It uses the existing provider guard, cost reconciliation, usage-session headers, and local-development one-use authorization pattern. The new `visual-agent` route limit is 12 requests per minute; the loop's stricter per-run action budget remains the primary continuation bound.

Only the server-side Agent model adapter imports `lib/llm.ts`. The deterministic loop receives an `AgentDecisionProvider` interface and therefore has no provider dependency. The prompt asks for the smallest single valid action, forbids geometry/editor operations and batches, requires supplied semantic identity for existing targets, treats ActionResult as authoritative, and prefers `done` when the state already satisfies the instruction.

## Step budget

Default: **4 action attempts**.

Four covers useful multi-step work in the current small action vocabulary while bounding sequential provider latency and cost. The boundary accepts 1–8 and clamps outside values; the model cannot alter it. One final decision after the fourth action may return `done` or `cannot_complete`. A fifth `act` is not dispatched and returns `step_limit`.

Thus a default run makes at most five decision requests and four dispatch calls.

## Stopping and stall detection

- `done` completes immediately.
- `cannot_complete` blocks with its bounded reason.
- provider failure or invalid structured output blocks without dispatch.
- unavailable Canvas observation blocks.
- an action beyond the budget returns `step_limit` without execution.
- one noop or rejection is fed back and permits a recovery decision.
- the same action against the same complete semantic/canvas revision producing the same noop or rejection twice consecutively stalls.
- two consecutive results reported as applied while world, Expression scene, and all Canvas revisions remain unchanged stall.
- concurrent runs on the same VisualAgent are rejected.

There is no unbounded `while (!done)` and no hidden retry policy.

## Observation cadence

The runtime obtains current WorldState and calls `observe()` before every decision. After every dispatch it calls `observe()` again before continuation. The next iteration then obtains another fresh snapshot, allowing a human edit between decisions to become first-class reality.

```text
observe -> decide -> act -> observe -> decide -> act -> observe
```

Tests assert that the second decision receives the first action's changed live scene revision. No action batch can skip this boundary.

## ActionResult feedback

The next context receives compact deterministic facts:

- status (`applied`, `noop`, `rejected`);
- action type and category;
- reason and rejection code;
- booleans for WorldState, Expression scene, Canvas scene, selection, and viewport changes.

The model does not judge whether execution succeeded. Phase 7 execution does. Full before/after snapshots are not duplicated into prompt context because the next current views already represent reality.

## Human edits and drift

Normalized canvas geometry, selection, deletion-by-absence, and viewport are actual input evidence. The Agent does not overwrite them merely because WorldState or the last ScenePlan differs. No `syncWorldFromCanvas`, `repairCanvasFromWorld`, background reconciliation, or semantic recovery from pixels was added. The Agent may use an existing VisualAction only when relevant to its current explicit instruction.

## Live speech relationship

The existing Deepgram → Board → ExpressionLiveController path is intact. Interim and settled transcript handling does not wait for an Agent observation/model/action cycle. Phase 8 invokes the Agent only through an explicit boundary. Deciding when settled speech should invoke it remains a later product/runtime policy.

## Developer harness

Development exposes:

```js
await window.inpublic.runVisualAgent("Remove Sleep", {
  decisions: [
    { type: "act", action: { type: "remove_entity", entityId: "sleep" } },
    { type: "done" }
  ]
})
```

Omitting `decisions` uses the guarded live decision endpoint. Supplying decisions injects the deterministic scripted provider used by browser smoke. `window.inpublic.agentLastRun()` returns the most recent result and trace. Existing `express`, `act`, and `observe` harnesses remain unchanged.

## Trace format

Each step records:

- one-based step number;
- compact world, Expression-scene, Canvas-scene, selection, and viewport revisions observed before decision;
- the validated decision or structured invalid/provider failure;
- compact ActionResult feedback when an action ran;
- the same compact revisions after execution.

The run trace records the instruction and budget. It stores no hidden chain-of-thought, no raw provider prose, and no giant duplicated canvas snapshots. It is returned in memory and not persisted to projects.

## Deterministic tests

VisualAgent suite: **14 passed / 0 failed**.

Coverage includes:

- compact semantic identities and actual Canvas bounds in model context;
- one semantic action then done, updating WorldState and canvas;
- multiple actions with a changed observation between decisions;
- presentation focus with byte-equivalent WorldState;
- rejection feedback followed by bounded recovery;
- noop feedback followed by done;
- repeated identical noop stall;
- repeated identical rejection stall;
- repeated applied-without-progress stall;
- hard step-budget exhaustion without executing an extra action;
- invalid structured output with no dispatch/mutation;
- immediate done;
- `cannot_complete`;
- concurrent-run rejection.

Static Agent dependency checks pass. They enforce no Excalidraw import/raw editor mutation in Agent, no Agent dependency from Canvas/Expression, one existing VisualAction in `AgentDecision`, no model/provider call in deterministic orchestration, and centralized LLM use only in the server model adapter.

## Live-model evaluation

`npm run test:agent:live` is opt-in and excluded from `npm test`. It contains four deterministic-ID scenarios for relationship creation, relation removal, focus, and already-satisfied completion. It reports valid action selection and identity correctness.

The paid suite was **not run** during Phase 8 verification. The default command confirmed it skips cleanly unless `RUN_VISUAL_AGENT_LIVE_EVAL=1` is explicitly set. No provider money was spent and no unverified intelligence claim is made.

## Browser smoke

Browser smoke is **8/8**. The new real-browser test:

```text
mount Board and real Excalidraw
  -> deterministically express Coffee prevents Sleep
  -> invoke runVisualAgent with scripted remove_entity(Sleep)
  -> deterministic dispatcher updates WorldState
  -> existing Expression/Canvas reconciliation removes live marks
  -> Agent records the resulting Canvas scene revision
  -> next decision observes that exact resulting revision
  -> scripted provider returns done
  -> final WorldState and live observation confirm removal
```

No LLM or Deepgram call occurs.

## MCP / external bridge

The existing `express_meaning` bridge remains intact and passes 13 checks. The core Agent has no MCP dependency. A new `run_visual_agent` bridge is not necessary to prove the runtime and was deferred rather than exposing many Canvas tools or expanding external mutation authority in this phase.

## Final verification

Final verification on 2026-08-27:

- `npm run typecheck`: clean.
- `npm run build`: clean, including `/api/agent/decision`.
- Canvas boundary: passed.
- Canvas observation: passed.
- Canvas dependency direction: passed.
- WorldState persistence: **11 passed / 0 failed**.
- VisualAction: **14 passed / 0 failed**.
- VisualAction dependency direction: passed.
- VisualAgent: **14 passed / 0 failed**.
- VisualAgent dependency direction: passed.
- Expression: **1,254 passed / 0 failed**.
- Expression clean/composition/presentation/evaluator suites: passed.
- Discovery: **48 passed / the same 3 known failures**.
- MCP: **13 passed / 0 failed**.
- Product packaging: **38 passed / 0 failed**.
- Browser smoke: **8/8 passed**.
- `git diff --check`: clean except line-ending conversion notices.

No new regression was introduced.

## Remaining agent limitations

- Live-model quality has an opt-in evaluator but was not measured in this phase.
- The current model endpoint is sequential; no streaming or speculative decision path exists.
- Semantic placement/repositioning remains absent because VisualAction has no placement-constraint representation.
- Focus is the only presentation action; highlight/pointer/gesture/presence remain absent.
- No generic WorldState/Canvas reconciliation or canvas-to-semantics recovery exists.
- Agent traces are in-memory developer artifacts and are not durable project provenance.
- No product UI, settled-speech invocation policy, MCP agent bridge, or background autonomy exists.
- Multi-action transactions, action rollback across multiple iterations, and conflict semantics remain absent.
- The explicit hard-removal action still differs from conversational archival lifecycle semantics.

## Scope answers

1. Can the model now see both the semantic world and actual canvas? **Yes.**
2. Can it choose a geometry-free VisualAction? **Yes.**
3. Does InPublic execute the action deterministically? **Yes.**
4. Does the agent see the actual result before deciding again? **Yes.**
5. Can the loop terminate itself when the requested state is achieved? **Yes.**
6. Can it loop forever? **No.**
7. Does every live speech interim now go through the visual agent? **No.**
