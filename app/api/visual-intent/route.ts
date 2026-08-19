import { NextResponse } from "next/server";
import { providerFor } from "@/lib/llm";
import { VISUAL_REENTRY_MODEL, NONE_FALLBACK, decideVisual } from "@/lib/visualReentry/decide";
import { guardProviderRequest, reconcileProviderCost, type ProviderUsage } from "@/lib/server/provider-guard";

export const dynamic = "force-dynamic";

interface VisualIntentRequest {
  /** The settled thought's own text — the only thing the model decides on. */
  text: string;
}

/**
 * Visual Re-entry's single decision call. Mirrors app/api/beat/route.ts's
 * shape (guard -> complete -> reconcile) exactly — the same cost/rate-limit
 * governance every other model-calling route in this codebase goes through.
 *
 * Never returns anything other than 200 + a valid VisualReentryIntent, or a
 * guard Response (429/503/401) the client already knows how to treat as
 * "no visual this time" — there is no retry loop here, unlike beat/scribe,
 * because `none` is always an acceptable outcome for this feature.
 */
export async function POST(req: Request) {
  let body: VisualIntentRequest;
  try {
    body = (await req.json()) as VisualIntentRequest;
  } catch {
    return NextResponse.json({ error: { code: "invalid_request", message: "Invalid request." } }, { status: 400 });
  }
  if (!body.text || typeof body.text !== "string") {
    return NextResponse.json(NONE_FALLBACK);
  }

  const guard = await guardProviderRequest(req, {
    feature: "visual-reentry",
    provider: providerFor(VISUAL_REENTRY_MODEL),
    model: VISUAL_REENTRY_MODEL,
    requestBytes: Buffer.byteLength(body.text),
    maxOutputTokens: 400,
  });
  if (guard instanceof Response) return guard;

  let usage: ProviderUsage = {};
  try {
    const intent = await decideVisual(body.text, (value) => { usage = value; });
    await reconcileProviderCost(guard, "succeeded", usage);
    return NextResponse.json(intent);
  } catch (err) {
    await reconcileProviderCost(guard, "failed", usage);
    console.error("[visual-intent]", err);
    return NextResponse.json(NONE_FALLBACK);
  }
}
