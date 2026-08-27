"use client";

import { providerRequestHeaders } from "../usage-client";
import type { AgentContext, AgentDecisionProvider } from "./types";

async function developmentAuthorization(): Promise<Record<string, string>> {
  if (process.env.NODE_ENV === "production") return {};
  try {
    const response = await fetch("/api/dev/replay-authorization", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    if (!response.ok) return {};
    const body = (await response.json()) as { authorization?: string };
    return body.authorization ? { "x-inpublic-replay-authorization": body.authorization } : {};
  } catch {
    return {};
  }
}

export const requestVisualAgentDecision: AgentDecisionProvider = async (context: AgentContext) => {
  const developmentHeaders = await developmentAuthorization();
  const response = await fetch("/api/agent/decision", {
    method: "POST",
    headers: providerRequestHeaders({ "content-type": "application/json", ...developmentHeaders }),
    body: JSON.stringify({ context }),
  });
  if (!response.ok) {
    let reason = `visual agent decision request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) reason = body.error.message;
    } catch {
      // Preserve the status-based message.
    }
    throw new Error(reason);
  }
  const body = (await response.json()) as { decision?: unknown };
  return body.decision;
};
