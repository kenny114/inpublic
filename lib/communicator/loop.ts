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
import { CommunicationDecisionSchema } from "./types";
import type {
  CommunicationContext,
  CommunicationDecisionProvider,
  CommunicationHistoryEntry,
  CommunicationRunResult,
  CommunicationRunTrace,
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
  const trace: CommunicationRunTrace = {
    userMessage: input.userMessage,
    communicationGoal: input.communicationGoal,
    budget: maxSteps,
    shapingCalls: 0,
    decisionCalls: 0,
    steps: [],
  };
  const history: CommunicationHistoryEntry[] = [];
  let previousOutcomeKey = "";
  let repeatCount = 0;

  for (let step = 1; step <= maxSteps; step += 1) {
    const world = options.source.getWorld();
    const scene = options.source.getScene();
    const observation = options.source.observe();
    if (!observation) return { status: "blocked", reason: "canvas observation is unavailable", trace };

    const context: CommunicationContext = {
      userMessage: input.userMessage,
      communicationGoal: input.communicationGoal,
      world: agentWorldView(world),
      canvas: agentCanvasView(observation, scene),
      history: history.slice(-8),
      step,
      remainingSteps: Math.max(0, maxSteps - step + 1),
    };

    trace.decisionCalls += 1;
    let raw: unknown;
    try {
      raw = await options.decisionProvider(context);
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240);
      const stepTrace: CommunicationStepTrace = { step, decision: { type: "provider_error", reason } };
      trace.steps.push(stepTrace);
      options.onStep?.(stepTrace);
      return { status: "blocked", reason, trace };
    }
    const parsed = CommunicationDecisionSchema.safeParse(raw);
    if (!parsed.success) {
      const reason = parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".") || "decision"}: ${issue.message}`)
        .join("; ")
        .slice(0, 240);
      const stepTrace: CommunicationStepTrace = { step, decision: { type: "invalid_decision", reason } };
      trace.steps.push(stepTrace);
      options.onStep?.(stepTrace);
      return { status: "blocked", reason, trace };
    }
    const decision = parsed.data;
    if (decision.type === "done") {
      const stepTrace: CommunicationStepTrace = { step, decision };
      trace.steps.push(stepTrace);
      options.onStep?.(stepTrace);
      return { status: "completed", trace };
    }

    const sceneRevisionBefore = observation.revisions.scene;
    const execution = await executeCommunicationDecision(decision, {
      world,
      dispatcher: options.dispatcher,
      onShapingUsage: (usage) => {
        trace.shapingCalls += 1;
        options.onShapingUsage?.(usage);
      },
    });
    const afterObservation = options.source.observe();
    const sceneRevisionAfter = afterObservation?.revisions.scene;

    // ScenePlan itself carries no grammar id — that fact lives on the
    // ExpressionTrace produced by the render callback the harness/caller
    // already observes (see scripts/self-expressive-agent-v0-eval.mjs's
    // onUpdate), so this loop leaves `chosenGrammar` for the caller to fill
    // in from that trace rather than guessing at it here.
    const stepTrace: CommunicationStepTrace = {
      step,
      decision,
      outcome: { status: execution.status, reason: execution.reason },
      sceneRevisionBefore,
      sceneRevisionAfter,
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
      if (repeatCount >= 1) return { status: "stalled", reason: `repeated ${execution.status} without canvas change`, trace };
    } else {
      repeatCount = 0;
    }
    previousOutcomeKey = outcomeKey;
  }
  return { status: "step_limit", trace };
}
