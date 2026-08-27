import type { AgentRunResult, VisualAgent } from "../agent";
import type { ExpressionOutcome } from "../expression/live";
import { classifyLiveInteraction } from "./classify";
import type {
  LiveInteractionInput,
  LiveInteractionResult,
  LiveInteractionRunOptions,
  LiveInteractionTrace,
} from "./types";

export interface LiveInteractionOrchestratorOptions {
  express(input: LiveInteractionInput): Promise<ExpressionOutcome>;
  agent: VisualAgent;
  now?: () => number;
  onTrace?: (trace: LiveInteractionTrace) => void;
  historyLimit?: number;
}

interface AgentTicket {
  input: LiveInteractionInput;
  options: LiveInteractionRunOptions;
  trace: LiveInteractionTrace;
  resolve: (result: LiveInteractionResult) => void;
}

function changedByAgent(result: AgentRunResult): boolean {
  return result.trace.steps.some((step) => step.actionResult && Object.values(step.actionResult.changed).some(Boolean));
}

function phaseAt(result: AgentRunResult, phase: AgentRunResult["trace"]["presence"][number]["phase"]): number | undefined {
  return result.trace.presence.find((event) => event.phase === phase)?.atMs;
}

export function createLiveInteractionOrchestrator(options: LiveInteractionOrchestratorOptions) {
  const now = options.now ?? (() => Date.now());
  const history: LiveInteractionTrace[] = [];
  const byInputId = new Map<string, LiveInteractionTrace>();
  let activeAgent: AgentTicket | null = null;
  let pendingAgent: AgentTicket | null = null;

  const publish = (trace: LiveInteractionTrace) => options.onTrace?.(trace);
  const remember = (trace: LiveInteractionTrace) => {
    history.push(trace);
    byInputId.set(trace.id, trace);
    while (history.length > (options.historyLimit ?? 100)) {
      const removed = history.shift();
      if (removed && byInputId.get(removed.id) === removed) byInputId.delete(removed.id);
    }
    publish(trace);
  };
  const makeTrace = (input: LiveInteractionInput): LiveInteractionTrace => {
    const routedAtMs = now();
    const settledAtMs = input.settledAtMs ?? routedAtMs;
    const classification = classifyLiveInteraction(input.text);
    return {
      id: input.id,
      text: input.text.trim().slice(0, 1000),
      source: input.source ?? "speech",
      intent: classification.intent,
      routingReason: classification.reason,
      settledAtMs,
      routedAtMs,
      status: "routed",
      metrics: {
        speechFinalToRouteMs: Math.max(0, routedAtMs - settledAtMs),
        routingModelCalls: 0,
        modelCalls: 0,
        agentSteps: 0,
      },
    };
  };
  const finishCancelled = (ticket: AgentTicket, reason: string, agent?: AgentRunResult): LiveInteractionResult => {
    ticket.trace.status = "cancelled";
    ticket.trace.reason = reason;
    ticket.trace.finishedAtMs = now();
    ticket.trace.agentStatus = agent?.status ?? "cancelled";
    if (agent) ticket.trace.agent = agent.trace;
    publish(ticket.trace);
    return { status: "cancelled", intent: ticket.trace.intent, reason, trace: ticket.trace, ...(agent ? { agent } : {}) };
  };

  const startNext = () => {
    if (activeAgent || !pendingAgent) return;
    const next = pendingAgent;
    pendingAgent = null;
    void runAgent(next);
  };

  const runAgent = async (ticket: AgentTicket): Promise<void> => {
    activeAgent = ticket;
    ticket.trace.status = "running";
    publish(ticket.trace);
    const startedAtMs = now();
    let result: AgentRunResult;
    try {
      result = await options.agent.run(ticket.input.text, ticket.options);
      ticket.trace.finishedAtMs = now();
      ticket.trace.agentStatus = result.status;
      ticket.trace.agent = result.trace;
      ticket.trace.metrics.modelCalls = result.trace.modelCalls;
      ticket.trace.metrics.agentSteps = result.steps;
      ticket.trace.metrics.totalAgentRunMs = Math.max(0, ticket.trace.finishedAtMs - startedAtMs);
      const decisionAt = phaseAt(result, "decision_completed");
      const actionAt = phaseAt(result, "action_started");
      const actionResultAt = phaseAt(result, "action_completed");
      const reobservedAt = phaseAt(result, "reobservation_completed");
      if (decisionAt !== undefined) ticket.trace.metrics.agentRouteToFirstDecisionMs = Math.max(0, decisionAt - ticket.trace.routedAtMs);
      if (actionAt !== undefined && actionResultAt !== undefined) ticket.trace.metrics.agentDecisionToActionResultMs = Math.max(0, actionResultAt - actionAt);
      if (actionResultAt !== undefined && reobservedAt !== undefined) ticket.trace.metrics.agentActionToReobservationMs = Math.max(0, reobservedAt - actionResultAt);
      if (changedByAgent(result) && actionResultAt !== undefined) {
        ticket.trace.metrics.speechFinalToFirstVisualChangeMs = Math.max(0, actionResultAt - ticket.trace.settledAtMs);
      }
      if (result.status === "cancelled") {
        ticket.resolve(finishCancelled(ticket, result.reason, result));
      } else if (result.status === "completed") {
        ticket.trace.status = "completed";
        publish(ticket.trace);
        ticket.resolve({ status: "completed", intent: ticket.trace.intent, trace: ticket.trace, agent: result });
      } else {
        const reason = "reason" in result ? result.reason : result.status;
        ticket.trace.status = "failed";
        ticket.trace.reason = reason;
        publish(ticket.trace);
        ticket.resolve({ status: "failed", intent: ticket.trace.intent, reason, trace: ticket.trace, agent: result });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      ticket.trace.status = "failed";
      ticket.trace.reason = reason;
      ticket.trace.finishedAtMs = now();
      publish(ticket.trace);
      ticket.resolve({ status: "failed", intent: ticket.trace.intent, reason, trace: ticket.trace });
    } finally {
      if (activeAgent === ticket) activeAgent = null;
      startNext();
    }
  };

  const supersedePending = (reason: string) => {
    if (!pendingAgent) return;
    const stale = pendingAgent;
    pendingAgent = null;
    stale.resolve(finishCancelled(stale, reason));
  };

  return {
    submit(input: LiveInteractionInput, runOptions: LiveInteractionRunOptions = {}): Promise<LiveInteractionResult> {
      const trace = makeTrace(input);
      remember(trace);
      if (trace.intent === "ignore") {
        trace.status = "completed";
        trace.finishedAtMs = now();
        publish(trace);
        return Promise.resolve({ status: "completed", intent: "ignore", trace });
      }
      if (trace.intent === "express") {
        options.agent.cancel("superseded by newer settled human expression");
        supersedePending("superseded by newer settled human expression");
        trace.status = "running";
        trace.metrics.modelCalls = input.meaning ? 0 : 1;
        publish(trace);
        return options.express(input).then<LiveInteractionResult>((expression) => {
          trace.finishedAtMs = now();
          trace.expressionStatus = expression.status;
          if (expression.status === "failed") {
            const reason = expression.error instanceof Error ? expression.error.message : String(expression.error ?? "expression failed");
            trace.status = "failed";
            trace.reason = reason;
            publish(trace);
            return { status: "failed", intent: "express", reason, trace, expression };
          }
          trace.status = "completed";
          publish(trace);
          return { status: "completed", intent: "express", trace, expression };
        }).catch((error): LiveInteractionResult => {
          const reason = error instanceof Error ? error.message : String(error);
          trace.status = "failed";
          trace.reason = reason;
          trace.finishedAtMs = now();
          publish(trace);
          return { status: "failed", intent: "express", reason, trace };
        });
      }

      return new Promise((resolve) => {
        const ticket: AgentTicket = { input, options: runOptions, trace, resolve };
        if (activeAgent) {
          options.agent.cancel("superseded by newer settled human instruction");
          supersedePending("superseded before start by newer settled human instruction");
          pendingAgent = ticket;
          return;
        }
        void runAgent(ticket);
      });
    },
    noteVisualChange(inputIds: string[], atMs = now()): void {
      for (const id of inputIds) {
        const trace = byInputId.get(id);
        if (!trace || trace.metrics.speechFinalToFirstVisualChangeMs !== undefined) continue;
        trace.metrics.speechFinalToFirstVisualChangeMs = Math.max(0, atMs - trace.settledAtMs);
        if (trace.intent === "express") {
          trace.metrics.expressRouteToFirstVisualChangeMs = Math.max(0, atMs - trace.routedAtMs);
        }
        publish(trace);
      }
    },
    cancel(reason = "cancelled by human"): boolean {
      const active = options.agent.cancel(reason);
      const hadPending = Boolean(pendingAgent);
      supersedePending(reason);
      return active || hadPending;
    },
    isAgentActive: () => Boolean(activeAgent),
    traces: () => history,
    lastTrace: () => history.at(-1) ?? null,
  };
}

export type LiveInteractionOrchestrator = ReturnType<typeof createLiveInteractionOrchestrator>;
