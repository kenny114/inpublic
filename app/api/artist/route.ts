import { NextResponse } from "next/server";
import { ARTIST_MODEL, complete } from "@/lib/llm";
import { parseActions } from "@/lib/actions";
import { ARTIST_SYSTEM } from "@/lib/prompts";
import type { ArtistRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The artist edits the board rather than drawing a new picture of it.
 *
 * It used to return a Mermaid string and receive only frame labels, which meant
 * it had no way to refer to anything already on the canvas and therefore
 * redrew concepts that were already there. It now receives the semantic board
 * and returns actions that reference existing conceptIds.
 */
export async function POST(req: Request) {
  let body: ArtistRequest;
  try {
    body = (await req.json()) as ArtistRequest;
  } catch {
    return NextResponse.json({ actions: [] });
  }

  const scene = body.scene;
  const intent = body.intent === "command" ? "command" : "draw";

  const user = [
    intent === "command"
      ? `THE SPEAKER GAVE AN INSTRUCTION ABOUT THE BOARD: ${body.focus ?? ""}`
      : `WHAT TO SHOW: ${body.focus ?? ""}`,
    "",
    "EXISTING CONCEPTS — reuse these conceptIds, never duplicate them:",
    scene?.concepts.length
      ? JSON.stringify(scene.concepts, null, 2)
      : "(the board has no concepts yet)",
    "",
    "EXISTING RELATIONSHIPS — do not create these again:",
    scene?.relationships.length
      ? JSON.stringify(scene.relationships, null, 2)
      : "(none)",
    "",
    `SECTIONS: ${JSON.stringify(scene?.sections ?? [])}`,
    `ACTIVE TOPIC: ${scene?.activeTopic ?? "Untitled"}`,
    `CURRENT PAGE: ${scene?.currentPage ?? 0}`,
    scene?.recentCommands.length
      ? `RECENT COMMANDS: ${scene.recentCommands.join(" | ")}`
      : "",
    "",
    "RECENT TRANSCRIPT:",
    body.transcript ?? "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const raw = await complete({
      model: ARTIST_MODEL,
      system: ARTIST_SYSTEM,
      user,
      maxTokens: 1200,
      temperature: 0.3,
      allowThinking: true,
    });
    return NextResponse.json({ actions: parseActions(raw) });
  } catch (err) {
    console.error("[artist]", err);
    // An artist failure must never reach the canvas. Empty is a safe answer.
    return NextResponse.json({ actions: [], error: String(err) });
  }
}
