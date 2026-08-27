import { NextResponse } from "next/server";
import { AgentContextSchema } from "@/lib/agent";
import {
  decideWithVisualAgentModel,
  VISUAL_AGENT_MAX_OUTPUT_TOKENS,
  VISUAL_AGENT_MODEL,
} from "@/lib/agent/model";
import { providerFor } from "@/lib/llm";
import { guardProviderRequest, reconcileProviderCost, type GuardContext, type ProviderUsage } from "@/lib/server/provider-guard";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return NextResponse.json({ error: { code: "invalid_request", message: "Invalid request." } }, { status: 400 });
  }
  if (Buffer.byteLength(raw) > 256_000) {
    return NextResponse.json({ error: { code: "payload_too_large", message: "Agent context is too large." } }, { status: 413 });
  }
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: { code: "invalid_request", message: "Invalid request." } }, { status: 400 });
  }
  const context = AgentContextSchema.safeParse((input as { context?: unknown } | null)?.context);
  if (!context.success) {
    return NextResponse.json({ error: { code: "invalid_context", message: "Invalid visual agent context." } }, { status: 400 });
  }

  const modelProvider = providerFor(VISUAL_AGENT_MODEL);
  // Ollama is a free local process, and neither Groq nor NVIDIA has a
  // provider_rate_cards row (see lib/server/provider-guard.ts) — none of the
  // three has cost/rate-limit exposure the billing guard was built to
  // protect, and routing any of them through it would 503 with
  // rate_card_missing.
  let guard: GuardContext | null = null;
  if (modelProvider !== "ollama" && modelProvider !== "groq" && modelProvider !== "nvidia") {
    const guarded = await guardProviderRequest(request, {
      feature: "visual-agent",
      provider: modelProvider,
      model: VISUAL_AGENT_MODEL,
      requestBytes: Buffer.byteLength(raw),
      maxOutputTokens: VISUAL_AGENT_MAX_OUTPUT_TOKENS,
      allowDevelopmentReplay: true,
    });
    if (guarded instanceof Response) return guarded;
    guard = guarded;
  }

  let usage: ProviderUsage = {};
  try {
    const decision = await decideWithVisualAgentModel(context.data, (value) => {
      usage = value;
    });
    if (guard) await reconcileProviderCost(guard, "succeeded", usage);
    return NextResponse.json({ decision });
  } catch (error) {
    if (guard) await reconcileProviderCost(guard, "failed", usage);
    console.error("[visual-agent]", error);
    return NextResponse.json(
      { error: { code: "decision_failed", message: "Visual agent decision failed." } },
      { status: 502 },
    );
  }
}
