/**
 * Client-safe wrapper for the one model call.
 *
 * lib/expression/meaning/extract.ts imports the provider SDK, so importing
 * it from a "use client" component would ship the whole SDK — and, worse,
 * make an API key look like something the browser could hold. This module
 * only knows how to ask app/api/express/route.ts and validate the reply,
 * the same separation lib/meaning/client.ts keeps for the older engine.
 *
 * Never throws. Any failure resolves to an empty delta, which the world
 * model folds in as "nothing changed" — a network hiccup must never erase
 * what InPublic already understood.
 */

import { providerRequestHeaders } from "../../usage-client";
import type { CompletionUsage } from "../../llm";
import { MeaningDeltaSchema, EMPTY_MEANING_DELTA, type MeaningDelta } from "../schemas";

/**
 * Local-development capability for the text-first lab.
 *
 * The provider guard requires an active listening session, which is right
 * for the live product and impossible for a text box: there is no
 * microphone and no session to lease. Rather than weakening the guard, the
 * lab asks for the same one-use, fingerprint-bound, 30-second dev grant the
 * replay lab uses (see lib/server/developmentReplayAuthorization.ts). The
 * minting route 404s outside local development, so in production this
 * returns nothing and the normal guard applies unchanged.
 */
async function developmentAuthorization(signal?: AbortSignal): Promise<Record<string, string>> {
  // Compiled out of the production bundle entirely. This matters now that the
  // live speech path calls through here: a settled thought must not pay for a
  // round-trip to a route that always 404s in production. Live speech holds a
  // real listening session, so the normal guard passes on its own.
  if (process.env.NODE_ENV === "production") return {};
  try {
    const res = await fetch("/api/dev/replay-authorization", {
      method: "POST",
      signal,
      headers: { "content-type": "application/json" },
    });
    if (!res.ok) return {};
    const body = (await res.json()) as { authorization?: string };
    return body.authorization ? { "x-inpublic-replay-authorization": body.authorization } : {};
  } catch {
    return {};
  }
}

export async function requestMeaningDelta(
  text: string,
  recentContext: string[] = [],
  signal?: AbortSignal,
  /**
   * Prompt-cache accounting for this call, read off the response headers
   * app/api/express/route.ts sets. Never affects the returned delta — a
   * missing or unparseable header just means no numbers this round.
   */
  onUsage?: (usage: CompletionUsage) => void,
): Promise<MeaningDelta> {
  const devHeaders = await developmentAuthorization(signal);
  let res: Response;
  try {
    res = await fetch("/api/express", {
      method: "POST",
      headers: providerRequestHeaders({ "content-type": "application/json", ...devHeaders }),
      signal,
      body: JSON.stringify({ text, recentContext }),
    });
  } catch {
    return EMPTY_MEANING_DELTA;
  }
  if (!res.ok) return EMPTY_MEANING_DELTA;

  if (onUsage) {
    const header = (name: string) => {
      const value = Number(res.headers.get(name));
      return Number.isFinite(value) ? value : 0;
    };
    onUsage({
      inputTokens: header("x-inpublic-input-tokens"),
      outputTokens: 0,
      cacheCreationInputTokens: header("x-inpublic-cache-creation-tokens"),
      cacheReadInputTokens: header("x-inpublic-cache-read-tokens"),
    });
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return EMPTY_MEANING_DELTA;
  }
  const parsed = MeaningDeltaSchema.safeParse(json);
  return parsed.success ? parsed.data : EMPTY_MEANING_DELTA;
}
