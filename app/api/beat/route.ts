import { NextResponse } from "next/server";
import { BEAT_MODEL, complete } from "@/lib/llm";
import { BEAT_SYSTEM } from "@/lib/prompts";
import type { BeatDecision, BeatRequest } from "@/lib/types";
import { guardProviderRequest, reconcileProviderCost, type ProviderUsage } from "@/lib/server/provider-guard";
import { providerFor } from "@/lib/llm";

export const dynamic = "force-dynamic";

const SKIP: BeatDecision = { action: "skip", reason: "parse failure", focus: "" };

/**
 * Only appended when math mode is on. Kept out of BEAT_SYSTEM itself so
 * Standard/Story mode prompts are byte-for-byte unchanged when the flag is
 * off — the whole point of shipping this behind a flag.
 */
const BEAT_MATH_ADDENDUM = `

MATH MODE IS ON. Add one more action to your vocabulary:

- math_step — they stated, transformed, or asked about a mathematical expression or equation: "two x plus four equals ten", "subtract four from both sides", "what does x mean here", "so x equals three". "focus" is a one-sentence statement of the mathematical content (the expression, or the operation being described).

A math_step takes priority over draw when the content is explicitly mathematical — an equation is not "a system with parts" for the purposes of "draw", it goes to math_step so it can be verified deterministically instead of sketched as a generic diagram.`;

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
      action !== "clear" &&
      action !== "math_step"
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
    return NextResponse.json({ error: { code: "invalid_request", message: "Invalid request." } }, { status: 400 });
  }

  const serialized = JSON.stringify(body);
  const provider = providerFor(BEAT_MODEL);
  const guard = await guardProviderRequest(req, { feature: "beat", provider, model: BEAT_MODEL, requestBytes: Buffer.byteLength(serialized), maxOutputTokens: 300 });
  if (guard instanceof Response) return guard;
  let usage: ProviderUsage = {};

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

  const mathEnabled = process.env.NEXT_PUBLIC_ENABLE_MATH_MODE === "true";

  try {
    const raw = await complete({
      model: BEAT_MODEL,
      system: mathEnabled ? `${BEAT_SYSTEM}${BEAT_MATH_ADDENDUM}` : BEAT_SYSTEM,
      user,
      // 150 truncated the JSON mid-object on longer focus strings, which the
      // parser then threw away as a skip. Two of twenty calls died that way.
      maxTokens: 300,
      temperature: 0,
      onUsage: (value) => { usage = value; },
    });
    await reconcileProviderCost(guard, "succeeded", usage, Buffer.byteLength(raw));
    return NextResponse.json(parseDecision(raw));
  } catch (err) {
    await reconcileProviderCost(guard, "failed", usage);
    console.error("[beat]", err);
    // A failed beat check is a skip. Never surface it on the canvas.
    return NextResponse.json({ ...SKIP, reason: "beat request failed" });
  }
}
