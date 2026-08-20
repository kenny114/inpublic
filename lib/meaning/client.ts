/**
 * Client-safe request wrapper for the Meaning Engine's decision call.
 *
 * The model call itself lives server-side in app/api/meaning/route.ts (via
 * lib/meaning/decide.ts, which is `server-only`) — this file only knows how
 * to ask that route and validate what comes back, the same separation
 * lib/visualReentry/client.ts keeps for Visual Re-entry. Never imports
 * lib/llm.ts.
 */

import { providerRequestHeaders } from "../usage-client";
import { SemanticStateSchema, type SemanticState } from "./types";

/**
 * Requests the updated meaning state. Never throws — a network failure, an
 * aborted request, a non-2xx response, or a schema-invalid payload all
 * resolve to `currentState` unchanged, so a pipeline hiccup never erases
 * what InPublic already understood.
 *
 * `recentContext` is the rolling window of already-processed settled-thought
 * text (oldest first) that lets the model resolve pronouns and vague
 * references against what was actually just said — see
 * lib/meaning/engine.ts and lib/meaning/decide.ts's doc comments.
 */
export async function requestMeaning(
  currentState: SemanticState,
  recentContext: string[],
  newText: string,
  signal?: AbortSignal,
): Promise<SemanticState> {
  let res: Response;
  try {
    res = await fetch("/api/meaning", {
      method: "POST",
      headers: providerRequestHeaders({ "content-type": "application/json" }),
      signal,
      body: JSON.stringify({ currentState, recentContext, newText }),
    });
  } catch {
    return currentState;
  }
  if (!res.ok) return currentState;

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return currentState;
  }
  const parsed = SemanticStateSchema.safeParse(json);
  return parsed.success ? parsed.data : currentState;
}
