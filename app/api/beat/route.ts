import { NextResponse } from "next/server";
import { BEAT_MODEL, complete } from "@/lib/llm";
import { BEAT_SYSTEM } from "@/lib/prompts";
import type { BeatDecision, BeatRequest } from "@/lib/types";
import { BEAT_RETRY_INSTRUCTION, SKIP, excerpt, parseDecision } from "@/lib/beat";
import { guardProviderRequest, reconcileProviderCost, type ProviderUsage } from "@/lib/server/provider-guard";
import { providerFor } from "@/lib/llm";

export const dynamic = "force-dynamic";

/**
 * Only appended when math mode is on. Kept out of BEAT_SYSTEM itself so
 * Standard/Story mode prompts are byte-for-byte unchanged when the flag is
 * off — the whole point of shipping this behind a flag.
 */
const BEAT_MATH_ADDENDUM = `

MATH MODE IS ON. Add one more action to your vocabulary:

- math_step — they stated, transformed, or asked about a mathematical expression or equation: "two x plus four equals ten", "subtract four from both sides", "what does x mean here", "so x equals three". "focus" is a one-sentence statement of the mathematical content (the expression, or the operation being described).

A math_step takes priority over draw when the content is explicitly mathematical — an equation is not "a system with parts" for the purposes of "draw", it goes to math_step so it can be verified deterministically instead of sketched as a generic diagram.`;

export async function POST(req: Request) {
  let body: BeatRequest;
  try {
    body = (await req.json()) as BeatRequest;
  } catch {
    return NextResponse.json({ error: { code: "invalid_request", message: "Invalid request." } }, { status: 400 });
  }

  const serialized = JSON.stringify(body);
  const provider = providerFor(BEAT_MODEL);
  // Reserved for two attempts, because an unparseable response gets one retry
  // below. Reconciliation reports what was actually spent either way; this
  // only stops a retry from overrunning its own reservation.
  const guard = await guardProviderRequest(req, { feature: "beat", provider, model: BEAT_MODEL, requestBytes: Buffer.byteLength(serialized), maxOutputTokens: 600 });
  if (guard instanceof Response) return guard;

  // Usage accumulates across attempts, so a retry is not billed as if the
  // first call never happened.
  let usage: ProviderUsage = {};
  const addUsage = (next: ProviderUsage) => {
    usage = {
      providerRequestId: next.providerRequestId ?? usage.providerRequestId,
      inputTokens: (usage.inputTokens ?? 0) + (next.inputTokens ?? 0),
      outputTokens: (usage.outputTokens ?? 0) + (next.outputTokens ?? 0),
      cacheCreationInputTokens: (usage.cacheCreationInputTokens ?? 0) + (next.cacheCreationInputTokens ?? 0),
      cacheReadInputTokens: (usage.cacheReadInputTokens ?? 0) + (next.cacheReadInputTokens ?? 0),
    };
  };

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

  const system = mathEnabled ? `${BEAT_SYSTEM}${BEAT_MATH_ADDENDUM}` : BEAT_SYSTEM;

  try {
    const raw = await complete({
      model: BEAT_MODEL,
      system,
      user,
      // 150 truncated the JSON mid-object on longer focus strings, which the
      // parser then threw away as a skip. Two of twenty calls died that way.
      maxTokens: 300,
      temperature: 0,
      onUsage: (value) => { addUsage(value); },
    });

    let result = parseDecision(raw);
    let bytes = Buffer.byteLength(raw);

    /*
     * One retry on an unreadable response.
     *
     * A malformed beat is not a decision — it is a lost thought. The old code
     * turned it into `skip`, and because nothing downstream schedules another
     * beat once the speaker has stopped talking, whatever they had just said
     * was gone for good. Observed in the wild: a fenced, truncated object
     * ("```json {\"action\": \"skip\", ... \"focus\":") that read as a
     * deliberate skip in the session log.
     *
     * The retry restates the output contract and gives it more room, rather
     * than resending the identical request and hoping — temperature is
     * already 0, so an identical request would most likely fail identically.
     */
    if (!result.ok) {
      console.warn("[beat] unreadable response, retrying:", excerpt(raw));
      const retry = await complete({
        model: BEAT_MODEL,
        system,
        user: `${user}\n\n${BEAT_RETRY_INSTRUCTION}`,
        maxTokens: 400,
        temperature: 0,
        onUsage: (value) => { addUsage(value); },
      });
      bytes += Buffer.byteLength(retry);
      result = parseDecision(retry);
      if (!result.ok) console.warn("[beat] retry also unreadable:", excerpt(retry));
    }

    await reconcileProviderCost(guard, "succeeded", usage, bytes);
    return NextResponse.json(
      result.ok
        ? result.decision
        : { ...SKIP, reason: `parse failure after retry: ${excerpt(result.raw)}` },
    );
  } catch (err) {
    await reconcileProviderCost(guard, "failed", usage);
    console.error("[beat]", err);
    // A failed beat check is a skip. Never surface it on the canvas.
    return NextResponse.json({ ...SKIP, reason: "beat request failed" });
  }
}
