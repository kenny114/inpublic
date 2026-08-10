import { NextResponse } from "next/server";
import { MATH_MODEL, complete, providerFor } from "@/lib/llm";
import { MATH_SYSTEM } from "@/lib/prompts";
import { parseMathAction, type MathCanvasAction } from "@/lib/math/actions";
import type { MathRequest } from "@/lib/types";
import { guardProviderRequest, reconcileProviderCost, type ProviderUsage } from "@/lib/server/provider-guard";

export const dynamic = "force-dynamic";

/**
 * One incremental math step per call, mirroring the artist route's shape.
 * The model proposes a step; verification (lib/math/verify.ts) runs
 * client-side in Board.tsx's applyAction, deterministically, independent of
 * whatever the model claims — this route never marks anything "verified"
 * itself.
 */
function extractAction(raw: string): unknown {
  const cleaned = raw
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as { action?: unknown };
    return parsed?.action ?? null;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]) as { action?: unknown };
      return parsed?.action ?? null;
    } catch {
      return null;
    }
  }
}

export async function POST(req: Request) {
  let body: MathRequest;
  try {
    body = (await req.json()) as MathRequest;
  } catch {
    return NextResponse.json({ error: { code: "invalid_request", message: "Invalid request." } }, { status: 400 });
  }

  const provider = providerFor(MATH_MODEL);
  const guard = await guardProviderRequest(req, {
    feature: "math",
    provider,
    model: MATH_MODEL,
    requestBytes: Buffer.byteLength(JSON.stringify(body)),
    maxOutputTokens: 700,
  });
  if (guard instanceof Response) return guard;
  let usage: ProviderUsage = {};

  const scene = body.scene;
  const user = [
    `WHAT TO SHOW: ${body.focus ?? ""}`,
    "",
    body.currentExpression
      ? `CURRENT EXPRESSION ON THE BOARD (this is the only valid "before"): ${body.currentExpression}`
      : "CURRENT EXPRESSION ON THE BOARD: (none yet — this is a new problem)",
    body.activeConceptId ? `ACTIVE CONCEPT ID: ${body.activeConceptId}` : "",
    "",
    "EXISTING CONCEPTS on the board:",
    scene?.concepts.length ? JSON.stringify(scene.concepts, null, 2) : "(none yet)",
    scene?.checkpointSummaries?.length
      ? `\nEARLIER, COMPRESSED (already off-screen, for continuity only): ${scene.checkpointSummaries.join(" | ")}`
      : "",
    "",
    `DEPTH: ${body.depth === "deep" ? "the speaker asked for more depth on the current step" : "default — keep it clipped"}`,
    "",
    "RECENT TRANSCRIPT:",
    body.transcript ?? "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const raw = await complete({
      model: MATH_MODEL,
      system: MATH_SYSTEM,
      user,
      maxTokens: 700,
      temperature: 0.2,
      allowThinking: true,
      onUsage: (value) => { usage = value; },
    });
    await reconcileProviderCost(guard, "succeeded", usage, Buffer.byteLength(raw));
    const action = parseMathAction(extractAction(raw));
    return NextResponse.json({ action: action as MathCanvasAction | null });
  } catch (err) {
    await reconcileProviderCost(guard, "failed", usage);
    console.error("[math]", err);
    // A math failure must never reach the canvas confidently. Null is a safe answer.
    return NextResponse.json({ action: null, error: String(err) });
  }
}
