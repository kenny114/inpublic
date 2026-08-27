import type { AgentPresencePort, AgentPresenceState, CanvasObservation } from "../canvas";
import type { ScenePlan, WorldState } from "../expression/schemas";
import type { VisualAction, VisualActionDispatcher } from "../visual-actions";
import {
  actionFeedback,
  agentCanvasView,
  agentRevisions,
  agentWorldView,
  buildAgentContext,
  sameRevision,
  stableActionKey,
} from "./context";
import { requestValidatedDecision } from "./decide";
import type {
  AgentActionFeedback,
  AgentDecisionProvider,
  AgentFinalState,
  AgentRunResult,
  AgentRunTrace,
  AgentStepTrace,
  PreviousAgentTurn,
  VisualAgent,
  VisualAgentRunOptions,
} from "./types";

export const DEFAULT_AGENT_STEP_BUDGET = 4;
export const MAX_AGENT_STEP_BUDGET = 8;

export interface VisualAgentSource {
  getWorld(): WorldState;
  getScene(): ScenePlan;
  observe(): CanvasObservation | null;
}

export interface CreateVisualAgentOptions {
  source: VisualAgentSource;
  dispatcher: VisualActionDispatcher;
  decisionProvider?: AgentDecisionProvider;
  /** Optional Canvas-owned, model-free visible lifecycle sink. */
  presence?: AgentPresencePort;
}

function actionPresence(action: VisualAction, world: WorldState): AgentPresenceState {
  if (action.type === "update_entity" || action.type === "remove_entity" || action.type === "focus") {
    return { status: "acting", target: { entityId: action.entityId }, gesture: "pointer" };
  }
  if (action.type === "relate_entities") {
    return { status: "acting", target: { entityId: action.targetEntityId }, gesture: "pointer" };
  }
  if (action.type === "remove_relation") {
    const relation = world.relations.find((candidate) => candidate.id === action.relationId);
    if (relation) return { status: "acting", target: { entityId: relation.target }, gesture: "pointer" };
  }
  return { status: "acting", gesture: "none" };
}

function budget(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_AGENT_STEP_BUDGET;
  return Math.max(1, Math.min(MAX_AGENT_STEP_BUDGET, Math.floor(value!)));
}

function noProgress(feedback: AgentActionFeedback): boolean {
  return !Object.values(feedback.changed).some(Boolean);
}

function repeatedOutcome(
  previous: { actionKey: string; observedKey: string; feedback: AgentActionFeedback } | undefined,
  action: VisualAction,
  observedKey: string,
  feedback: AgentActionFeedback,
): boolean {
  if (!previous) return false;
  return previous.actionKey === stableActionKey(action)
    && previous.observedKey === observedKey
    && previous.feedback.status === feedback.status
    && previous.feedback.reason === feedback.reason;
}

export function createVisualAgent(options: CreateVisualAgentOptions): VisualAgent {
  let running = false;
  let activeRun: { cancelled: boolean; reason: string } | null = null;

  const finalState = (): AgentFinalState => {
    const world = options.source.getWorld();
    const scene = options.source.getScene();
    const observation = options.source.observe();
    if (!observation) {
      const emptyCanvas = {
        revisions: { scene: "unavailable", selection: "unavailable", viewport: "unavailable" },
        elements: [],
        selection: { elementIds: [], groupIds: [] },
        viewport: { scrollX: 0, scrollY: 0, zoom: 1, width: 0, height: 0 },
      };
      return {
        world: agentWorldView(world),
        canvas: emptyCanvas,
        revisions: {
          world: JSON.stringify(agentWorldView(world)),
          expressionScene: JSON.stringify(scene),
          scene: "unavailable",
          selection: "unavailable",
          viewport: "unavailable",
        },
      };
    }
    return {
      world: agentWorldView(world),
      canvas: agentCanvasView(observation, scene),
      revisions: agentRevisions(world, scene, observation),
    };
  };

  const result = (
    status: AgentRunResult["status"],
    steps: number,
    trace: AgentRunTrace,
    reason?: string,
  ): AgentRunResult => {
    const base = { status, steps, trace, final: finalState() };
    if (status === "blocked" || status === "cancelled" || status === "stalled") return { ...base, status, reason: reason ?? status };
    return base as AgentRunResult;
  };

  return {
    isRunning: () => running,
    cancel(reason = "superseded by newer human input") {
      if (!activeRun || activeRun.cancelled) return false;
      activeRun.cancelled = true;
      activeRun.reason = reason;
      return true;
    },
    async run(instruction: string, runOptions: VisualAgentRunOptions = {}): Promise<AgentRunResult> {
      const text = instruction.trim();
      const maxSteps = budget(runOptions.maxSteps);
      const trace: AgentRunTrace = { instruction: text.slice(0, 2000), budget: maxSteps, modelCalls: 0, steps: [], presence: [] };
      if (running) return result("blocked", 0, trace, "visual agent is already running");
      if (!text || text.length > 2000) return result("blocked", 0, trace, "instruction must contain 1 to 2000 characters");
      const provider = runOptions.decisionProvider ?? options.decisionProvider;
      if (!provider) return result("blocked", 0, trace, "no decision provider is configured");

      running = true;
      const runState = { cancelled: false, reason: "cancelled" };
      activeRun = runState;
      let actions = 0;
      let outcome: AgentRunResult["status"] = "blocked";
      let previousTurn: PreviousAgentTurn | undefined;
      let previousOutcome: { actionKey: string; observedKey: string; feedback: AgentActionFeedback } | undefined;
      let consecutiveAppliedWithoutProgress = 0;
      const signal = (
        phase: AgentRunTrace["presence"][number]["phase"],
        state: AgentPresenceState,
        step = actions + 1,
      ) => {
        options.presence?.setState(state);
        trace.presence.push({ step, phase, atMs: Date.now(), state });
      };
      const finish = (status: AgentRunResult["status"], reason?: string): AgentRunResult => {
        outcome = status;
        return result(status, actions, trace, reason);
      };
      const cancelled = (): AgentRunResult | null => runState.cancelled ? finish("cancelled", runState.reason) : null;
      try {
        signal("run_started", { status: "observing", gesture: "none" }, 0);
        // One final decision is allowed after the action budget so the model
        // can confirm completion. A further act is not executed.
        for (let decisionIndex = 0; decisionIndex <= maxSteps; decisionIndex += 1) {
          const beforeObservation = cancelled();
          if (beforeObservation) return beforeObservation;
          signal("observation_ready", { status: "observing", gesture: "none" });
          const world = options.source.getWorld();
          const scene = options.source.getScene();
          const observation = options.source.observe();
          if (!observation) return finish("blocked", "canvas observation is unavailable");
          const observed = agentRevisions(world, scene, observation);
          const context = buildAgentContext({
            instruction: text,
            world,
            scene,
            observation,
            previous: previousTurn,
            step: actions + 1,
            remainingSteps: Math.max(0, maxSteps - actions),
          });
          signal("decision_started", { status: "thinking", gesture: "none" });
          trace.modelCalls += 1;
          const attempt = await requestValidatedDecision(provider, context);
          const afterDecision = cancelled();
          if (afterDecision) return afterDecision;
          if (attempt.status !== "valid") {
            const stepTrace: AgentStepTrace = {
              step: actions + 1,
              observed,
              decision: {
                type: attempt.status === "invalid" ? "invalid_decision" : "provider_error",
                reason: attempt.reason,
              },
            };
            trace.steps.push(stepTrace);
            return finish("blocked", attempt.reason);
          }

          const decision = attempt.decision;
          signal("decision_completed", { status: "thinking", gesture: "none" });
          const stepTrace: AgentStepTrace = { step: actions + 1, observed, decision };
          trace.steps.push(stepTrace);
          if (decision.type === "done") return finish("completed");
          if (decision.type === "cannot_complete") return finish("blocked", decision.reason);
          if (actions >= maxSteps) return finish("step_limit");

          const acting = actionPresence(decision.action, world);
          signal("action_started", acting);
          const beforeAction = cancelled();
          if (beforeAction) return beforeAction;
          const actionResult = await options.dispatcher.dispatch(decision.action);
          actions += 1;
          const feedback = actionFeedback(actionResult);
          signal("action_completed", {
            ...acting,
            gesture: feedback.status === "applied" && acting.target ? "highlight" : acting.gesture,
          }, actions);
          const resultingWorld = options.source.getWorld();
          const resultingScene = options.source.getScene();
          // Mandatory post-action observation. The next loop iteration will
          // observe again, so external edits between turns remain visible.
          const resultingObservation = options.source.observe();
          if (!resultingObservation) {
            stepTrace.actionResult = feedback;
            return finish("blocked", "canvas observation became unavailable after action execution");
          }
          const resulting = agentRevisions(resultingWorld, resultingScene, resultingObservation);
          signal("reobservation_completed", { status: "observing", gesture: "none" }, actions);
          stepTrace.actionResult = feedback;
          stepTrace.resulting = resulting;

          const afterAction = cancelled();
          if (afterAction) return afterAction;

          const observedKey = JSON.stringify(observed);
          if (
            (feedback.status === "noop" || feedback.status === "rejected")
            && repeatedOutcome(previousOutcome, decision.action, observedKey, feedback)
          ) {
            return finish("stalled", `repeated ${feedback.status}: ${feedback.reason}`);
          }

          if (feedback.status === "applied" && noProgress(feedback) && sameRevision(observed, resulting)) {
            consecutiveAppliedWithoutProgress += 1;
            if (consecutiveAppliedWithoutProgress >= 2) {
              return finish("stalled", "actions reported applied without changing semantic or canvas state");
            }
          } else {
            consecutiveAppliedWithoutProgress = 0;
          }

          previousOutcome = { actionKey: stableActionKey(decision.action), observedKey, feedback };
          previousTurn = { action: decision.action, result: feedback };
        }
        return finish("step_limit");
      } finally {
        options.presence?.clear();
        trace.presence.push({
          step: actions,
          phase: "run_finished",
          atMs: Date.now(),
          state: { status: "idle", gesture: "none" },
          outcome,
        });
        if (activeRun === runState) activeRun = null;
        running = false;
      }
    },
  };
}
