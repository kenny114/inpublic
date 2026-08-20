import { NextResponse } from "next/server";
import { providerFor } from "@/lib/llm";
import { SKETCH_MODEL } from "@/lib/expression/draw/agent";
import { sketchFor } from "@/lib/expression/draw/resolve";
import { guardProviderRequest, reconcileProviderCost, type ProviderUsage } from "@/lib/server/provider-guard";

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

  const guard = await guardProviderRequest(req, {
    feature: "sketch-agent",
    provider: providerFor(SKETCH_MODEL),
    model: SKETCH_MODEL,
    requestBytes: Buffer.byteLength(body.type) + Buffer.byteLength(body.label),
    maxOutputTokens: 800,
    // Same reasoning as app/api/express/route.ts: the text-first lab has no
    // listening session to lease, so it opts into the server-validated
    // local-dev capability. Fails outside NODE_ENV development regardless.
    allowDevelopmentReplay: true,
  });
  if (guard instanceof Response) return guard;

  let usage: ProviderUsage = {};
  try {
    const sketch = await sketchFor(body.type, body.label, (value) => {
      usage = value;
    });
    await reconcileProviderCost(guard, "succeeded", usage);
    return NextResponse.json({ sketch: sketch ?? null });
  } catch (err) {
    await reconcileProviderCost(guard, "failed", usage);
    console.error("[sketch]", err);
    return NextResponse.json({ sketch: null });
  }
}
