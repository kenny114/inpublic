/**
 * Client-safe request wrapper for Visual Re-entry's model-fallback decision
 * call.
 *
 * The model call itself lives server-side, in
 * app/api/visual-intent/route.ts (via lib/visualReentry/decide.ts, which is
 * marked `server-only` and pulls in lib/llm.ts / the Anthropic SDK) — this
 * file only knows how to ask that route and validate what comes back, the
 * same separation every other AI feature in this codebase keeps between its
 * "use client" component and its app/api/*\/route.ts handler (see
 * components/Board.tsx's calls to /api/beat, /api/scribe, /api/story).
 * Never imports lib/llm.ts.
 */

import { providerRequestHeaders } from "../usage-client";
import type { VisualReentryIntent } from "./types";
import { VisualReentryIntentSchema, fallbackNone, REASON_PARSE_FAILED, REASON_REQUEST_REJECTED } from "./types";

/**
 * Requests a visual intent for a settled thought's text. Never throws — a
 * network failure, an aborted request, a non-2xx response (rate limited,
 * guard rejection, cost protection, etc.), or a schema-invalid payload all
 * resolve to `none` (a failure at any stage does nothing, never retries).
 * The `reason` distinguishes a request-level failure from a parse failure
 * so lib/visualReentry/orchestrate.ts can log the right stage — see
 * REASON_* in ./types.
 *
 * `signal` is the same AbortController idiom Board.tsx already uses for
 * Beat/Scribe/Story (aiAbortRef/scribeAbortRef/storyAbortRef). Aborts are
 * reserved for reset/teardown; Board suppresses new requests while this one
 * is running instead of making continued speech invalidate useful work.
 */
export async function requestVisualIntent(text: string, signal: AbortSignal): Promise<VisualReentryIntent> {
  let res: Response;
  try {
    res = await fetch("/api/visual-intent", {
      method: "POST",
      headers: providerRequestHeaders({ "content-type": "application/json" }),
      signal,
      body: JSON.stringify({ text }),
    });
  } catch {
    return fallbackNone(REASON_REQUEST_REJECTED);
  }
  if (!res.ok) return fallbackNone(REASON_REQUEST_REJECTED);

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return fallbackNone(REASON_PARSE_FAILED);
  }
  const parsed = VisualReentryIntentSchema.safeParse(json);
  return parsed.success ? parsed.data : fallbackNone(REASON_PARSE_FAILED);
}
