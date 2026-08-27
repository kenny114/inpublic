import { NextResponse } from "next/server";
import { providerFor } from "@/lib/llm";
import { SKETCH_MODEL, SKETCH_MAX_OUTPUT_TOKENS } from "@/lib/expression/draw/agent";
import { sketchFor } from "@/lib/expression/draw/resolve";
import { guardProviderRequest, reconcileProviderCost, type GuardContext, type ProviderUsage } from "@/lib/server/provider-guard";

export const dynamic = "force-dynamic";

interface SketchRequest {
  type: string;
  label: string;
}

/**
 * The Drawing Agent's only model-backed endpoint: concept -> Sketch.
 *
 * Mirrors app/api/express/route.ts's shape (guard -> resolve -> reconcile).
 * `sketchFor` checks the library before this ever reaches the model, so a
 * repeated concept costs one request but never a second provider call.
 *
 * Always 200. A missing sketch (guard rejection, model failure, invalid
 * output) returns { sketch: null } rather than an error — the caller already
 * knows how to draw the plain shape when no icon is available, so a blocked
 * or failed draw is a safe, ordinary outcome here.
 */
export async function POST(req: Request) {
  let body: SketchRequest;
  try {
    body = (await req.json()) as SketchRequest;
  } catch {
    return NextResponse.json({ error: { code: "invalid_request", message: "Invalid request." } }, { status: 400 });
  }
  if (!body.label || typeof body.label !== "string" || !body.type || typeof body.type !== "string") {
    return NextResponse.json({ sketch: null });
  }

  const modelProvider = providerFor(SKETCH_MODEL);
  // Ollama is a free local process — no cost/rate-limit exposure to protect,
  // and provider_rate_cards has no row for a local model (see
  // app/api/agent/decision/route.ts for the same reasoning).
  let guard: GuardContext | null = null;
  if (modelProvider !== "ollama") {
    const guarded = await guardProviderRequest(req, {
      feature: "sketch-agent",
      provider: modelProvider,
      model: SKETCH_MODEL,
      requestBytes: Buffer.byteLength(body.type) + Buffer.byteLength(body.label),
      // The same budget drawSketch actually asks the provider for. These were
      // 800 here and 6000 there, so every sketch was under-reserved by 7.5x.
      maxOutputTokens: SKETCH_MAX_OUTPUT_TOKENS,
      // Same reasoning as app/api/express/route.ts: the text-first lab has no
      // listening session to lease, so it opts into the server-validated
      // local-dev capability. Fails outside NODE_ENV development regardless.
      allowDevelopmentReplay: true,
    });
    if (guarded instanceof Response) return guarded;
    guard = guarded;
  }

  let usage: ProviderUsage = {};
  try {
    const sketch = await sketchFor(body.type, body.label, (value) => {
      usage = value;
    });
    if (guard) await reconcileProviderCost(guard, "succeeded", usage);
    return NextResponse.json({ sketch: sketch ?? null });
  } catch (err) {
    if (guard) await reconcileProviderCost(guard, "failed", usage);
    console.error("[sketch]", err);
    return NextResponse.json({ sketch: null });
  }
}
