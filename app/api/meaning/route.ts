import { NextResponse } from "next/server";
import { providerFor } from "@/lib/llm";
import { MEANING_ENGINE_MODEL, decideMeaning } from "@/lib/meaning/decide";
import { SemanticStateSchema, EMPTY_SEMANTIC_STATE } from "@/lib/meaning/types";
import { guardProviderRequest, reconcileProviderCost, type ProviderUsage } from "@/lib/server/provider-guard";

export const dynamic = "force-dynamic";

interface MeaningRequest {
  currentState: unknown;
  recentContext?: unknown;
  newText: string;
}

function sanitizeRecentContext(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string").slice(0, 12);
}

/**
 * The Meaning Engine's single decision call. Mirrors app/api/visual-intent/
 * route.ts's shape (guard -> complete -> reconcile) exactly — same
 * cost/rate-limit governance every other model-calling route uses.
 *
 * Always returns 200 + a valid SemanticState, or a guard Response the
 * client already treats as "state unchanged this round" — never a retry
 * loop, since falling back to the caller-supplied currentState is always a
 * safe outcome for this feature.
 */
export async function POST(req: Request) {
  let body: MeaningRequest;
  try {
    body = (await req.json()) as MeaningRequest;
  } catch {
    return NextResponse.json({ error: { code: "invalid_request", message: "Invalid request." } }, { status: 400 });
  }
  const parsedState = SemanticStateSchema.safeParse(body.currentState);
  const currentState = parsedState.success ? parsedState.data : EMPTY_SEMANTIC_STATE;
  const recentContext = sanitizeRecentContext(body.recentContext);
  if (!body.newText || typeof body.newText !== "string") {
    return NextResponse.json(currentState);
  }

  const guard = await guardProviderRequest(req, {
    feature: "meaning-engine",
    provider: providerFor(MEANING_ENGINE_MODEL),
    model: MEANING_ENGINE_MODEL,
    requestBytes: Buffer.byteLength(body.newText) + Buffer.byteLength(JSON.stringify(currentState)) + Buffer.byteLength(recentContext.join(" ")),
    // Matches decideCore.ts's reconcile-stage maxTokens (8000) — the guard's
    // cost estimate must cover the actual worst-case output now that the
    // semantic caps allow a much larger state (see lib/meaning/types.ts).
    maxOutputTokens: 8000,
  });
  if (guard instanceof Response) return guard;

  let usage: ProviderUsage = {};
  try {
    const nextState = await decideMeaning(currentState, recentContext, body.newText, (value) => { usage = value; });
    await reconcileProviderCost(guard, "succeeded", usage);
    return NextResponse.json(nextState);
  } catch (err) {
    await reconcileProviderCost(guard, "failed", usage);
    console.error("[meaning]", err);
    return NextResponse.json(currentState);
  }
}
