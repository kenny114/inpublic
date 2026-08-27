import { AgentDecisionSchema, type AgentDecision, type AgentDecisionProvider } from "./types";

export type DecisionAttempt =
  | { status: "valid"; decision: AgentDecision }
  | { status: "invalid"; reason: string }
  | { status: "provider_error"; reason: string };

const BARE_ACTION_TYPES = new Set(["express", "update_entity", "remove_entity", "relate_entities", "remove_relation", "focus"]);

/**
 * Repairs one observed model habit: emitting a VisualAction directly instead
 * of wrapping it in {"type":"act","action":...}. Only a bare object whose
 * "type" is a known VisualActionType (and not already an "act"/"done"/
 * "cannot_complete" envelope) is rewrapped; validation below stays strict on
 * the result, so this never admits anything AgentDecisionSchema would not
 * already have accepted in its intended shape.
 */
function normalizeDecisionShape(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const type = (raw as { type?: unknown }).type;
  if (typeof type !== "string" || !BARE_ACTION_TYPES.has(type)) return raw;
  if ("action" in raw) return raw;
  return { type: "act", action: raw };
}

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
  const parsed = AgentDecisionSchema.safeParse(normalizeDecisionShape(raw));
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
