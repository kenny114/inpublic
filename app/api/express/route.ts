import { NextResponse } from "next/server";
import { providerFor } from "@/lib/llm";
import { EXPRESSION_MODEL, extractMeaning } from "@/lib/expression/meaning/extract";
import { EMPTY_MEANING_DELTA } from "@/lib/expression/schemas";
import { guardProviderRequest, reconcileProviderCost, type GuardContext, type ProviderUsage } from "@/lib/server/provider-guard";

export const dynamic = "force-dynamic";

interface ExpressRequest {
  text: string;
  recentContext?: unknown;
}

function sanitizeRecentContext(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string").slice(0, 8);
}

/**
 * The Expression Engine's only model-backed endpoint: text -> MeaningDelta.
 *
 * Mirrors app/api/meaning/route.ts's shape (guard -> complete -> reconcile)
 * so it inherits the same cost and rate-limit governance every other
 * model-calling route in this codebase already has.
 *
 * Always returns 200 with a valid MeaningDelta, or a guard Response the
 * client already treats as "nothing new this round". Falling back to an
 * empty delta is always a safe outcome here: the world simply does not
 * change, which is exactly what should happen when we did not understand
 * anything.
 */
export async function POST(req: Request) {
  let body: ExpressRequest;
  try {
    body = (await req.json()) as ExpressRequest;
  } catch {
    return NextResponse.json({ error: { code: "invalid_request", message: "Invalid request." } }, { status: 400 });
  }
  if (!body.text || typeof body.text !== "string") {
    return NextResponse.json(EMPTY_MEANING_DELTA);
  }
  const recentContext = sanitizeRecentContext(body.recentContext);

  const modelProvider = providerFor(EXPRESSION_MODEL);
  // Ollama is a free local process, and neither Groq nor NVIDIA has a
  // provider_rate_cards row — none has cost/rate-limit exposure to protect
  // (see app/api/agent/decision/route.ts for the same reasoning).
  let guard: GuardContext | null = null;
  if (modelProvider !== "ollama" && modelProvider !== "groq" && modelProvider !== "nvidia") {
    const guarded = await guardProviderRequest(req, {
      feature: "expression-engine",
      provider: modelProvider,
      model: EXPRESSION_MODEL,
      requestBytes: Buffer.byteLength(body.text) + Buffer.byteLength(recentContext.join(" ")),
      // Matches extractMeaning's maxTokens, so the guard's estimate covers the
      // real worst case rather than a hopeful one.
      maxOutputTokens: 2000,
      // The text-first lab (app/dev/express) has no listening session to lease
      // — there is no microphone in a text box — so it opts into the existing
      // server-validated local-dev capability instead. This is not a bypass:
      // consumeDevelopmentReplayAuthorization always fails outside NODE_ENV
      // development, so in production this route still requires a real session
      // exactly like every other model-calling route.
      allowDevelopmentReplay: true,
    });
    if (guarded instanceof Response) return guarded;
    guard = guarded;
  }

  let usage: ProviderUsage = {};
  try {
    const delta = await extractMeaning(body.text, recentContext, (value) => {
      usage = value;
    });
    if (guard) await reconcileProviderCost(guard, "succeeded", usage);
    console.log(
      `[express] ${EXPRESSION_MODEL} input=${usage.inputTokens ?? 0} cache_creation=${
        usage.cacheCreationInputTokens ?? 0
      } cache_read=${usage.cacheReadInputTokens ?? 0}`,
    );
    // Headers, not body: the response body is a MeaningDelta and the client
    // validates it with MeaningDeltaSchema, which would strip an extra key
    // anyway. Diagnostic only — the client logs them beside extractMs so a
    // session log can show the extraction prompt being cached (or not).
    return NextResponse.json(delta, {
      headers: {
        "x-inpublic-cache-creation-tokens": String(usage.cacheCreationInputTokens ?? 0),
        "x-inpublic-cache-read-tokens": String(usage.cacheReadInputTokens ?? 0),
        "x-inpublic-input-tokens": String(usage.inputTokens ?? 0),
      },
    });
  } catch (err) {
    if (guard) await reconcileProviderCost(guard, "failed", usage);
    console.error("[express]", err);
    return NextResponse.json(EMPTY_MEANING_DELTA);
  }
}
