/**
 * Bounded observe → decide → communicate → observe → judge loop. Mirrors
 * `lib/agent/loop.ts`'s discipline deliberately (mandatory re-observation,
 * hard step budget, structured terminal result, no unbounded `while`) rather
 * than inventing a new one, but decides communication modality first and
 * only ever resolves down to the existing `VisualActionDispatcher`.
 */

import { agentCanvasView, agentWorldView } from "../agent";
import type { CanvasObservation } from "../canvas";
import type { ScenePlan, WorldState } from "../expression/schemas";
import type { CompletionUsage } from "../llm";
import type { VisualActionDispatcher } from "../visual-actions";
import { executeCommunicationDecision } from "./execute";
import type { shapeVisualIntent } from "./shape";
import { CommunicationDecisionSchema } from "./types";
import {
  deriveStage,
  deriveTransformationCandidate,
  initialCommunicationState,
  meaningfulVisualExists,
  summarizeSemanticDelta,
  summarizeVisualDelta,
  visibleSemanticEntityIds,
} from "./state";
import type {
  CommunicationContext,
  CommunicationDecision,
  CommunicationDecisionProvider,
  CommunicationHistoryEntry,
  CommunicationRunResult,
  CommunicationRunTrace,
  CommunicationState,
  CommunicationStepTrace,
} from "./types";

export const DEFAULT_COMMUNICATOR_STEP_BUDGET = 6;
export const MAX_COMMUNICATOR_STEP_BUDGET = 8;

export interface CommunicatorSource {
  getWorld(): WorldState;
  getScene(): ScenePlan;
  observe(): CanvasObservation | null;
}

export interface RunCommunicatorInput {
  userMessage: string;
  communicationGoal: string;
}

export interface RunCommunicatorOptions {
  source: CommunicatorSource;
  dispatcher: VisualActionDispatcher;
  decisionProvider: CommunicationDecisionProvider;
  onShapingUsage?: (usage: CompletionUsage) => void;
  maxSteps?: number;
  /** Explicit run/session continuation for experimental multi-turn scenarios. Never persisted by Communicator. */
  initialState?: CommunicationState;
  /** Deterministic test seam; normal and evaluation runs use the real local shaping model. */
  shapeIntent?: typeof shapeVisualIntent;
  /** Called after every step, chosen grammar included, for external trace capture (e.g. an eval harness). */
  onStep?: (step: CommunicationStepTrace) => void;
}

function budget(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_COMMUNICATOR_STEP_BUDGET;
  return Math.max(1, Math.min(MAX_COMMUNICATOR_STEP_BUDGET, Math.floor(value!)));
}

export async function runCommunicator(
  input: RunCommunicatorInput,
  options: RunCommunicatorOptions,
): Promise<CommunicationRunResult> {
  const maxSteps = budget(options.maxSteps);
  let state = initialCommunicationState(options.initialState);
  const trace: CommunicationRunTrace = {
    userMessage: input.userMessage,
    communicationGoal: input.communicationGoal,
    budget: maxSteps,
    shapingCalls: 0,
    decisionCalls: 0,
    initialState: structuredClone(state),
    finalState: structuredClone(state),
    steps: [],
  };
  const history: CommunicationHistoryEntry[] = [];
  const messagesSpoken = [...state.deliveredMessages];
  const repeatSpeechWarnings = new Set<string>();
  let previousWorld = structuredClone(options.source.getWorld());
  let previousActiveEntityIds = [...state.activeEntityIds];
  let previousForm = state.currentForm;
  let previousCanvasRevision: string | undefined;
  let feedback:
    | "This message has already been delivered."
    | "No existing visual expression is available to recompose. Establish the visual world first."
    | "Speech did not establish a visual expression. The visual world is still empty."
    | "Recomposition changed presentation only. It did not add the current message to semantic memory."
    | undefined;
  let previousOutcomeKey = "";
  let repeatCount = 0;

  const finish = <T extends Omit<CommunicationRunResult, "state" | "trace">>(result: T): CommunicationRunResult => {
    trace.finalState = structuredClone(state);
    return { ...result, state: structuredClone(state), trace } as CommunicationRunResult;
  };

  for (let step = 1; step <= maxSteps; step += 1) {
    const world = options.source.getWorld();
    const scene = options.source.getScene();
    const observation = options.source.observe();
    if (!observation) return finish({ status: "blocked", reason: "canvas observation is unavailable" });

    const semanticDelta = summarizeSemanticDelta(previousWorld, world);
    const activeEntityIds = visibleSemanticEntityIds(world, scene, observation);
    const visualEstablished = meaningfulVisualExists(world, scene, observation);
    const canvasChanged = previousCanvasRevision !== undefined && previousCanvasRevision !== observation.revisions.scene;
    const visualDelta = summarizeVisualDelta({
      previousActiveEntityIds,
      activeEntityIds,
      previousForm,
      currentForm: state.currentForm,
      canvasChanged,
      decision: state.lastDecision,
    });
    const transformationCandidate = deriveTransformationCandidate(world, state.currentForm);
    state = {
      ...state,
      stage: deriveStage({
        visualEstablished,
        semanticDelta,
        visualDelta,
        transformationCandidate,
        lastDecision: state.lastDecision,
        lastOutcome: state.lastOutcome,
        currentForm: state.currentForm,
        newTurn: step === 1,
      }),
      visualEstablished,
      activeEntityIds,
      deliveredMessages: messagesSpoken.slice(-32),
      visualRevision: state.visualRevision + (canvasChanged || visualDelta.addedEntityIds.length > 0 || visualDelta.removedEntityIds.length > 0 || visualDelta.presentationChange ? 1 : 0),
      semanticRevision: state.semanticRevision + (semanticDelta.changed ? 1 : 0),
    };
    previousWorld = structuredClone(world);
    previousActiveEntityIds = [...activeEntityIds];
    previousForm = state.currentForm;
    previousCanvasRevision = observation.revisions.scene;

    const context: CommunicationContext = {
      userMessage: input.userMessage,
      communicationGoal: input.communicationGoal,
      world: agentWorldView(world),
      canvas: agentCanvasView(observation, scene),
      history: history.slice(-8),
      state: structuredClone(state),
      semanticDelta,
      visualDelta,
      ...(transformationCandidate ? { transformationCandidate } : {}),
      ...(feedback ? { feedback } : {}),
      step,
      remainingSteps: Math.max(0, maxSteps - step + 1),
    };

    trace.decisionCalls += 1;
    let raw: unknown;
    try {
      raw = await options.decisionProvider(context);
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240);
      const stepTrace: CommunicationStepTrace = {
        step, state: structuredClone(state), semanticDelta, visualDelta,
        ...(transformationCandidate ? { transformationCandidate } : {}),
        decision: { type: "provider_error", reason },
      };
      trace.steps.push(stepTrace);
      options.onStep?.(stepTrace);
      return finish({ status: "blocked", reason });
    }
    const parsed = CommunicationDecisionSchema.safeParse(raw);
    if (!parsed.success) {
      const reason = parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".") || "decision"}: ${issue.message}`)
        .join("; ")
        .slice(0, 240);
      const stepTrace: CommunicationStepTrace = {
        step, state: structuredClone(state), semanticDelta, visualDelta,
        ...(transformationCandidate ? { transformationCandidate } : {}),
        decision: { type: "invalid_decision", reason },
      };
      trace.steps.push(stepTrace);
      options.onStep?.(stepTrace);
      return finish({ status: "blocked", reason });
    }
    const decision = parsed.data;
    if (decision.type === "done") {
      state = { ...state, stage: state.visualEstablished ? "conclude" : state.stage, lastDecision: decision };
      const stepTrace: CommunicationStepTrace = {
        step, state: structuredClone(state), semanticDelta, visualDelta,
        ...(transformationCandidate ? { transformationCandidate } : {}), decision,
      };
      trace.steps.push(stepTrace);
      options.onStep?.(stepTrace);
      return finish({ status: "completed" });
    }

    const spokenMessage =
      decision.type === "speak" || decision.type === "speak_and_visualize" ? decision.message : undefined;
    if (spokenMessage && messagesSpoken.includes(spokenMessage)) {
      const repeatedTwice = repeatSpeechWarnings.has(spokenMessage);
      const reason = "This message has already been delivered.";
      const stepTrace: CommunicationStepTrace = {
        step,
        state: structuredClone(state),
        semanticDelta,
        visualDelta,
        ...(transformationCandidate ? { transformationCandidate } : {}),
        decision,
        outcome: { status: "noop", reason },
        sceneRevisionBefore: observation.revisions.scene,
        sceneRevisionAfter: observation.revisions.scene,
        visualCommunicationIntent: decision.type === "speak_and_visualize" ? decision.intent : undefined,
        worldBefore: structuredClone(world),
        worldAfter: structuredClone(world),
        scenePlan: structuredClone(scene),
        canvasObservation: structuredClone(observation),
      };
      trace.steps.push(stepTrace);
      options.onStep?.(stepTrace);
      history.push({ decision, outcome: "noop", reason });
      state = {
        ...state,
        lastDecision: decision,
        lastOutcome: { status: "noop", reason },
      };
      feedback = reason;
      if (repeatedTwice) {
        return finish({ status: "stalled", reason: "repeated an already-delivered message after explicit feedback" });
      }
      repeatSpeechWarnings.add(spokenMessage);
      continue;
    }

    const sceneRevisionBefore = observation.revisions.scene;
    const worldBefore = structuredClone(world);
    const execution = await executeCommunicationDecision(decision, {
      world,
      dispatcher: options.dispatcher,
      visualEstablished: state.visualEstablished,
      shapeIntent: options.shapeIntent,
      onShapingUsage: (usage) => {
        trace.shapingCalls += 1;
        options.onShapingUsage?.(usage);
      },
    });
    const afterObservation = options.source.observe();
    const sceneRevisionAfter = afterObservation?.revisions.scene;
    const worldAfter = options.source.getWorld();
    if (spokenMessage) messagesSpoken.push(spokenMessage);
    feedback = execution.reason === "No existing visual expression is available to recompose. Establish the visual world first."
      ? execution.reason
      : state.stage === "establish" && decision.type === "speak"
        ? "Speech did not establish a visual expression. The visual world is still empty."
        : step === 1 && options.initialState?.visualEstablished && decision.type === "recompose"
          ? "Recomposition changed presentation only. It did not add the current message to semantic memory."
          : undefined;
    const outcome = { status: execution.status, reason: execution.reason.slice(0, 240) } as const;
    const appliedForm =
      execution.status === "applied" && "intent" in decision && decision.type !== "speak_and_visualize"
        ? decision.intent.form
        : execution.status === "applied" && decision.type === "speak_and_visualize"
          ? decision.intent.form
          : state.currentForm;
    state = {
      ...state,
      ...(appliedForm ? { currentForm: appliedForm } : {}),
      deliveredMessages: messagesSpoken.slice(-32),
      lastDecision: decision,
      lastOutcome: outcome,
    };

    // ScenePlan itself carries no grammar id — that fact lives on the
    // ExpressionTrace produced by the render callback the harness/caller
    // already observes (see scripts/self-expressive-agent-v0-eval.mjs's
    // onUpdate), so this loop leaves `chosenGrammar` for the caller to fill
    // in from that trace rather than guessing at it here.
    const stepTrace: CommunicationStepTrace = {
      step,
      state: structuredClone(state),
      semanticDelta,
      visualDelta,
      ...(transformationCandidate ? { transformationCandidate } : {}),
      decision,
      outcome: { status: execution.status, reason: execution.reason },
      sceneRevisionBefore,
      sceneRevisionAfter,
      chosenGrammar: execution.action?.expressionTrace?.plan.grammar,
      visualCommunicationIntent: "intent" in decision ? decision.intent : undefined,
      presentationIntent: execution.presentationIntent,
      meaningDelta: execution.meaningDelta,
      worldBefore,
      worldAfter: structuredClone(worldAfter),
      scenePlan: structuredClone(options.source.getScene()),
      canvasObservation: afterObservation ? structuredClone(afterObservation) : undefined,
      semanticPreservation: execution.action?.expressionTrace?.evaluation.semanticPreservation,
      inventedRelationIds: execution.action?.expressionTrace?.evaluation.inventedRelations,
    };
    trace.steps.push(stepTrace);
    options.onStep?.(stepTrace);

    history.push({ decision, outcome: execution.status, reason: execution.reason.slice(0, 240) });

    // Same discipline as VisualAgent's stall guard: an unchanged, repeated
    // outcome against an unchanged scene means continuing would only spend
    // more calls to say the same thing again.
    const outcomeKey = JSON.stringify([decision, execution.status, sceneRevisionBefore]);
    if (outcomeKey === previousOutcomeKey && sceneRevisionBefore === sceneRevisionAfter) {
      repeatCount += 1;
      if (repeatCount >= 1) return finish({ status: "stalled", reason: `repeated ${execution.status} without canvas change` });
    } else {
      repeatCount = 0;
    }
    previousOutcomeKey = outcomeKey;
  }
  return finish({ status: "step_limit" });
}
