import { completeStream, SCRIBE_MODEL } from "@/lib/llm";
import { SCRIBE_SYSTEM } from "@/lib/prompts";
import { guardProviderRequest, reconcileProviderCost, type ProviderUsage } from "@/lib/server/provider-guard";
import { providerFor } from "@/lib/llm";

export const dynamic = "force-dynamic";

interface ScribeRequest {
  /** Words spoken since the last scribe call. */
  fresh: string;
  /** A little of what came before, for context. Not to be drawn. */
  context: string;
  /** Marks already on the page — the model must not repeat these. */
  onPage: string[];
}

/**
 * The live hand. Streams drawing operations back one line at a time so the
 * client can render mark N while the model is still writing mark N+1.
 */
export async function POST(req: Request) {
  let body: ScribeRequest;
  try {
    body = (await req.json()) as ScribeRequest;
  } catch {
    return Response.json({ error: { code: "invalid_request", message: "Invalid request." } }, { status: 400 });
  }

  const guard = await guardProviderRequest(req, { feature: "scribe", provider: providerFor(SCRIBE_MODEL), model: SCRIBE_MODEL, requestBytes: Buffer.byteLength(JSON.stringify(body)), maxOutputTokens: 200 });
  if (guard instanceof Response) return guard;
  let usage: ProviderUsage = {};

  const onPage = Array.isArray(body.onPage) ? body.onPage : [];

  const user = [
    onPage.length
      ? `ALREADY ON PAGE (do not repeat): ${onPage.join(" | ")}`
      : "ALREADY ON PAGE: (nothing yet)",
    "",
    body.context ? `EARLIER (context only, already handled): ${body.context}` : "",
    "",
    `JUST SAID (draw this): ${body.fresh}`,
  ].join("\n");

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of completeStream({
          model: SCRIBE_MODEL,
          system: SCRIBE_SYSTEM,
          user,
          maxTokens: 200,
          temperature: 0.4,
          onUsage: (value) => { usage = value; },
        })) {
          controller.enqueue(encoder.encode(chunk));
        }
        await reconcileProviderCost(guard, "succeeded", usage);
        controller.close();
      } catch (err) {
        await reconcileProviderCost(guard, "failed", usage);
        console.warn("[scribe]", err);
        // Make the body reader reject. A clean, empty stream looks like a
        // legitimate "nothing worth drawing" response and would silently
        // bypass the client's local fallback.
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}
