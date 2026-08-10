import { NextResponse } from "next/server";
import { complete, STORY_MODEL } from "@/lib/llm";
import { STORY_SYSTEM } from "@/lib/prompts";
import { isThoughtComplete } from "@/lib/pagination";
import {
  interpretStoryDeterministically,
  parseStoryInterpretation,
  type StoryInterpreterContext,
} from "@/lib/story";
import { guardProviderRequest, reconcileProviderCost, type ProviderUsage } from "@/lib/server/provider-guard";
import { providerFor } from "@/lib/llm";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: StoryInterpreterContext;
  try {
    body = (await request.json()) as StoryInterpreterContext;
  } catch {
    return NextResponse.json({ sourceText: "", normalizedText: "", confidence: 0, actions: [], error: "invalid request" }, { status: 400 });
  }
  if (body.mode !== "story" || !body.transcript?.trim()) {
    return NextResponse.json({ sourceText: body.transcript ?? "", normalizedText: "", confidence: 0, actions: [] });
  }
  const sourceText = body.transcript;
  const normalizedText = sourceText.trim().replace(/\s+/g, " ");
  if (!isThoughtComplete(sourceText)) {
    return NextResponse.json({ sourceText, normalizedText, confidence: 1, actions: [], incomplete: true });
  }

  const guard = await guardProviderRequest(request, { feature: "story", provider: providerFor(STORY_MODEL), model: STORY_MODEL, requestBytes: Buffer.byteLength(JSON.stringify(body)), maxOutputTokens: 1000 });
  if (guard instanceof Response) return guard;
  let usage: ProviderUsage = {};

  const user = [
    `TRANSCRIPT: ${body.transcript}`,
    `ACTIVE SCENE: ${body.activeScene || "(none)"}`,
    `CURRENT PAGE: ${body.currentPage ?? 0}`,
    "EXISTING ENTITIES:",
    JSON.stringify(body.existingEntities ?? [], null, 2),
    "RECENT ENTITIES, MOST RECENT FIRST:",
    JSON.stringify(body.recentEntities ?? [], null, 2),
    "HISTORICAL OR HIDDEN ENTITIES (do not use for ordinary pronouns):",
    JSON.stringify(body.historicalEntities ?? [], null, 2),
    "EXISTING RELATIONS:",
    JSON.stringify(body.existingRelations ?? [], null, 2),
  ].join("\n");

  try {
    const raw = await complete({
      model: STORY_MODEL,
      system: STORY_SYSTEM,
      user,
      maxTokens: 1000,
      temperature: 0.1,
      onUsage: (value) => { usage = value; },
    });
    await reconcileProviderCost(guard, "succeeded", usage, Buffer.byteLength(raw));
    const interpreted = parseStoryInterpretation(raw, sourceText);
    if (!interpreted) {
      return NextResponse.json({
        sourceText,
        normalizedText,
        confidence: 0.55,
        actions: interpretStoryDeterministically(body),
        warnings: ["invalid structured interpreter response"],
        fallback: true,
        error: "invalid structured interpreter response",
      });
    }
    return NextResponse.json({
      ...interpreted,
    });
  } catch (error) {
    await reconcileProviderCost(guard, "failed", usage);
    return NextResponse.json({
      sourceText,
      normalizedText,
      confidence: 0.45,
      actions: interpretStoryDeterministically(body),
      warnings: ["interpreter request failed; deterministic fallback used"],
      fallback: true,
      error: String(error),
    });
  }
}
