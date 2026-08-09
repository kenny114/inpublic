import { NextResponse } from "next/server";
import { BEAT_MODEL, complete } from "@/lib/llm";
import { BEAT_SYSTEM } from "@/lib/prompts";
import type { BeatDecision, BeatRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

const SKIP: BeatDecision = { action: "skip", reason: "parse failure", focus: "" };

/**
 * Nine of fifty-eight beats in the 10:09 session came back as "parse failure",
 * and the log recorded only that phrase — not what had actually been returned,
 * so there was no way to tell a truncated response from a fenced one from a
 * model writing prose. Two changes: salvage the JSON object out of whatever
 * came back, and when that still fails, put the first eighty characters of the
 * raw response in the reason so the next session file explains itself.
 */
function parseDecision(raw: string): BeatDecision {
  try {
    // Strip ``` fences the model was told not to emit but sometimes does.
    let cleaned = raw
      .replace(/^\s*```(?:json)?/i, "")
      .replace(/```\s*$/, "")
      .trim();
    if (!cleaned.startsWith("{")) {
      // Leading prose, or a stray token before the object.
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) cleaned = match[0];
    }
    const parsed = JSON.parse(cleaned) as Partial<BeatDecision>;
    const action = parsed.action;
    if (
      action !== "draw" &&
      action !== "command" &&
      action !== "section" &&
      action !== "skip" &&
      action !== "undo" &&
      action !== "clear"
    ) {
      return SKIP;
    }
    return {
      action,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
      focus: typeof parsed.focus === "string" ? parsed.focus : "",
    };
  } catch {
    return {
      ...SKIP,
      reason: `parse failure: ${raw.slice(0, 80).replace(/\s+/g, " ")}`,
    };
  }
}

export async function POST(req: Request) {
  let body: BeatRequest;
  try {
    body = (await req.json()) as BeatRequest;
  } catch {
    return NextResponse.json(SKIP);
  }

  const sceneSummary = Array.isArray(body.sceneSummary) ? body.sceneSummary : [];

  const live = Array.isArray(body.liveConcepts) ? body.liveConcepts : [];

  const skipStreak = Math.max(0, Math.round(body.skipStreak ?? 0));

  // The two lists below used to be run together under "already on the board",
  // and that single framing caused most of the over-skipping: the Scribe
  // letters generously, so within a minute every noun the speaker uses is
  // already in `live`, and the beat read its own raw material as finished work
  // and called it a restatement. Loose words and drawn diagrams are different
  // kinds of thing and have to be labelled as such.
  const user = [
    `Seconds since the canvas last changed: ${Math.round(body.lastDrawnAt ?? 0)}`,
    `Times you have skipped in a row before this call: ${skipStreak}`,
    "",
    "LOOSE WORDS already lettered on the page:",
    live.length ? live.join(", ") : "(none yet)",
    "These are single words and phrases, not diagrams. Turning them into a",
    "diagram is the job you are being asked about. Overlap with this list is",
    "NOT a restatement and is NOT a reason to skip.",
    "",
    "DIAGRAMS already drawn:",
    sceneSummary.length
      ? JSON.stringify(sceneSummary, null, 2)
      : "(none — nothing has been diagrammed yet)",
    "This is the only list that counts as already drawn.",
    "",
    // The semantic board. A relationship that already exists here is the one
    // thing that genuinely makes new speech redundant.
    "THE BOARD, as meaning:",
    body.scene
      ? JSON.stringify(
          {
            activeTopic: body.scene.activeTopic,
            sections: body.scene.sections,
            concepts: body.scene.concepts.map((c) => ({
              conceptId: c.conceptId,
              label: c.label,
              kind: c.kind,
            })),
            relationships: body.scene.relationships,
            recentCommands: body.scene.recentCommands,
          },
          null,
          2,
        )
      : "(no semantic board yet)",
    "",
    "New transcript since the last drawing:",
    body.pendingText ?? "",
  ].join("\n");

  try {
    const raw = await complete({
      model: BEAT_MODEL,
      system: BEAT_SYSTEM,
      user,
      // 150 truncated the JSON mid-object on longer focus strings, which the
      // parser then threw away as a skip. Two of twenty calls died that way.
      maxTokens: 300,
      temperature: 0,
    });
    return NextResponse.json(parseDecision(raw));
  } catch (err) {
    console.error("[beat]", err);
    // A failed beat check is a skip. Never surface it on the canvas.
    return NextResponse.json({ ...SKIP, reason: "beat request failed" });
  }
}
