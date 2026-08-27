import { AgentDecisionSchema, type AgentDecision, type AgentDecisionProvider } from "./types";

export type DecisionAttempt =
  | { status: "valid"; decision: AgentDecision }
  | { status: "invalid"; reason: string }
  | { status: "provider_error"; reason: string };

export async function requestValidatedDecision(
  provider: AgentDecisionProvider,
  context: Parameters<AgentDecisionProvider>[0],
): Promise<DecisionAttempt> {
  let raw: unknown;
  try {
    raw = await provider(context);
  } catch (error) {
    return {
      status: "provider_error",
      reason: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
    };
  }
  const parsed = AgentDecisionSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "invalid",
      reason: parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".") || "decision"}: ${issue.message}`)
        .join("; ")
        .slice(0, 240),
    };
  }
  return { status: "valid", decision: parsed.data };
}

export function createScriptedDecisionProvider(decisions: unknown[]): AgentDecisionProvider {
  let index = 0;
  return async () => {
    if (index >= decisions.length) throw new Error("scripted decision provider exhausted");
    const decision = decisions[index];
    index += 1;
    return decision;
  };
}
