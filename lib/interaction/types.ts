import type { AgentDecisionProvider, AgentRunResult, VisualAgentRunOptions } from "../agent";
import type { ExpressionOutcome } from "../expression/live";
import type { MeaningDelta } from "../expression/schemas";

export type LiveInteractionIntent = "express" | "manipulate" | "present" | "ignore";
export type LiveInteractionStatus = "routed" | "running" | "completed" | "cancelled" | "failed";

export interface LiveInteractionInput {
  id: string;
  text: string;
  settledAtMs?: number;
  source?: "speech" | "typed";
  /** Development/evaluation seam: validated by Expression before it is folded. */
  meaning?: MeaningDelta;
}

export interface LiveInteractionRunOptions extends VisualAgentRunOptions {
  decisionProvider?: AgentDecisionProvider;
}

export interface LiveInteractionMetrics {
  speechFinalToRouteMs: number;
  speechFinalToFirstVisualChangeMs?: number;
  expressRouteToFirstVisualChangeMs?: number;
  agentRouteToFirstDecisionMs?: number;
  agentDecisionToActionResultMs?: number;
  agentActionToReobservationMs?: number;
  totalAgentRunMs?: number;
  routingModelCalls: 0;
  modelCalls: number;
  agentSteps: number;
}

export interface LiveInteractionTrace {
  id: string;
  text: string;
  source: "speech" | "typed";
  intent: LiveInteractionIntent;
  routingReason: string;
  settledAtMs: number;
  routedAtMs: number;
  finishedAtMs?: number;
  status: LiveInteractionStatus;
  metrics: LiveInteractionMetrics;
  expressionStatus?: ExpressionOutcome["status"];
  agentStatus?: AgentRunResult["status"];
  agent?: AgentRunResult["trace"];
  reason?: string;
}

export type LiveInteractionResult =
  | { status: "completed"; intent: LiveInteractionIntent; trace: LiveInteractionTrace; expression?: ExpressionOutcome; agent?: AgentRunResult }
  | { status: "cancelled"; intent: LiveInteractionIntent; reason: string; trace: LiveInteractionTrace; agent?: AgentRunResult }
  | { status: "failed"; intent: LiveInteractionIntent; reason: string; trace: LiveInteractionTrace; expression?: ExpressionOutcome; agent?: AgentRunResult };

export interface LiveInteractionClassification {
  intent: LiveInteractionIntent;
  reason: string;
}
