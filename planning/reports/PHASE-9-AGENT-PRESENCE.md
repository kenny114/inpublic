# Phase 9 — Visible Agent Presence

Date: 2026-08-27  
Branch: `expression-engine-default`  
Starting checkpoint: `ddddef7eadca4b35d4d941837b89e27fa0437e56`  
Starting tag: `inpublic-agent-core-v0`

## Outcome

InPublic's bounded visual agent now has an ephemeral visible lifecycle. A viewer can see observing, thinking, and acting, and can see a point and temporary outline on the semantic entity an action targets. Completion or any terminal failure clears the presence immediately. `speaking` exists as a supported state contract but Phase 9 never enters it automatically and creates no audio.

Presence is Canvas-owned UI, not canvas content. The Agent emits lifecycle facts and semantic entity ids only. Canvas maps an entity id through the current `ScenePlan`, current normalized elements, and viewport into screen geometry. The model neither receives nor produces presence coordinates.

## Architecture

The new boundary is under `lib/canvas/presence/`:

- `types.ts` defines the semantic target, lifecycle port, Canvas-resolved geometry, and inspectable snapshot.
- `controller.ts` owns target resolution calls, a 220 ms interruptible point movement, a 650 ms non-blocking acting display window, 900 ms emphasis expiry, 900 ms human-interaction suppression, and reduced-motion snapping.
- `overlay.tsx` renders a passive status chip, point, and temporary target outline as a `pointer-events: none` host overlay.

`CanvasRuntime` exposes the controller. Its Excalidraw adapter retains the last successfully applied `ScenePlan` solely for semantic-id mapping, combines the currently observed elements owned by the matching scene object, and converts their bounds through the live viewport. Reset clears both expression identity and presence.

The VisualAgent loop accepts an optional presence port. It emits deterministic observing/thinking/acting states at existing loop boundaries, promotes a successfully applied targeted action from point to temporary highlight, and clears in `finally`. Structured trace events record phase, state, semantic target, and terminal outcome without hidden reasoning. The loop does not await display timing.

`Board` connects this port, renders the overlay above Excalidraw, and forwards pointer/wheel/key activity to gesture suppression while allowing the original human event to continue. The development harness adds `agentPresence()` and an optional fake-provider delay used only by browser smoke to make lifecycle assertions deterministic.

Normal-run latency impact is zero deliberate waiting and zero new network/model requests. Rendering uses `requestAnimationFrame` independently of the agent promise. The only delay option added is scoped to the deterministic development harness and is absent from normal agent execution.

## Non-interference guarantees

Presence:

- creates no Excalidraw elements;
- calls no `updateScene`, active-tool, cursor, selection, or collaborator API;
- receives no pointer events;
- adds no undo entry and no persisted data;
- is absent from `CanvasObservation` normalization and all scene/selection/viewport fingerprints;
- is absent from `WorldState`, `ScenePlan`, and VisualAction schemas;
- adds no model/provider call;
- does not block action execution for animation;
- clears on completed, blocked, stalled, and step-limit runs;
- disappears on reload because it has no durable representation.

## Excalidraw audit

Installed `@excalidraw/excalidraw` remains 0.18.1. Installed types and implementation provide collaborator pointer/laser state, collaborator speaking/call/mute metadata, `elementsToHighlight`, pointer updates, cursor changes, and active-tool changes. Current upstream `master` remained `e1bb9ff8f8931e783c11d104abb8967ac6605c9a` during the audit and retains the relevant collaborator pointer/laser concepts.

Those APIs were rejected for artificial presence: collaborators would imply a real collaboration participant, app-state highlights would mutate editor state, and tool/cursor APIs could interfere with the human. A Canvas-owned host overlay meets the Phase 9 lifecycle and attention needs without an Excalidraw upgrade. Native laser trails and collaborator presence are deferred.

## Verification

Pre-change:

- clean Phase 6–8 audit, checkpoint commit, and tag;
- `npm run typecheck`: passed;
- `npm run build`: passed;
- deterministic suite reached 48 passed / the same 3 known `EXPRESSION_PLANNING` discovery failures;
- explicit MCP: 13/0;
- product packaging: 38/0;
- browser smoke: 8/8.

Phase 9:

- presence behavior: 9/0;
- presence dependency checks: passed;
- VisualAgent: 14/0;
- VisualAgent dependency checks: passed;
- Canvas boundary/observation/dependency checks: passed;
- WorldState persistence: 11/0;
- VisualAction: 14/0 plus dependency checks;
- Expression: 1,254/0;
- clean/composition/presentation/evaluator: 36/0, 36/0, 27/0, 33/0;
- discovery: 48 passed / the same 3 known `EXPRESSION_PLANNING` failures;
- explicit MCP: 13/0;
- product packaging: 38/0;
- browser smoke: 9/9, including mounted visible lifecycle, semantic target attention, scene-revision isolation, human suppression, and idle cleanup;
- typecheck: passed;
- production build: passed.

## Required answers

1. Can a viewer distinguish observing, thinking, and acting? **Yes.** The passive status chip exposes each lifecycle state, and acting has target attention when an identity exists.
2. Can the agent attend to a semantic target without receiving coordinates? **Yes.** It emits only `entityId`; Canvas resolves current bounds and viewport pixels.
3. Does presence alter WorldState? **No.** It has no semantic mutation or persistence route.
4. Could pointer movement be mistaken for a semantic edit? **No.** It is a small violet overlay point and outline, not an Excalidraw cursor/tool/element, and it never enters editor history or observation revisions.
5. Does presence add LLM calls? **No.** Provider-call counts are identical with and without the presence port.
6. Can a human continue interacting normally? **Yes.** The overlay cannot receive input, and human input temporarily suppresses its gestures without blocking the event or changing the current tool/cursor.

## Deferred

No Phase 10 work was started. Continuous-speech invocation policy, autonomous/background execution, audio/TTS, native laser trails, collaboration participants, generic WorldState/canvas drift repair, and additional action language remain future, separately specified work.
