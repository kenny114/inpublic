/**
 * Reading the beat's answer.
 *
 * Split out of app/api/beat/route.ts so it can be tested directly: a route
 * file cannot export helpers without upsetting Next's route type checking,
 * and this is the piece where a mistake costs the speaker a thought.
 */

import type { BeatDecision } from "./types";

export const SKIP: BeatDecision = { action: "skip", reason: "parse failure", focus: "" };

const ACTIONS = new Set(["draw", "command", "section", "skip", "undo", "clear", "math_step"]);

/**
 * A parse RESULT, not a decision.
 *
 * This used to collapse an unreadable response into `skip`, which is exactly
 * the shape of a deliberate "nothing worth drawing here". A malformed response
 * therefore looked identical to a considered one, and because nothing
 * schedules another beat once the speaker has stopped talking, the thought was
 * gone for good. Callers now get to tell the two apart and retry.
 */
export type ParseResult = { ok: true; decision: BeatDecision } | { ok: false; raw: string };

export function parseDecision(raw: string): ParseResult {
  const decision = tryParseDecision(raw);
  return decision ? { ok: true, decision } : { ok: false, raw };
}

function tryParseDecision(raw: string): BeatDecision | null {
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
    if (!parsed.action || !ACTIONS.has(parsed.action)) {
      // Readable JSON, unusable action. Not a parse failure — a retry would
      // not help — so it stays a skip.
      return SKIP;
    }
    return {
      action: parsed.action,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
      focus: typeof parsed.focus === "string" ? parsed.focus : "",
    };
  } catch {
    return null;
  }
}

/** Enough of a response to tell truncation from prose from a stray fence. */
export function excerpt(raw: string) {
  return raw.slice(0, 200).replace(/\s+/g, " ").trim();
}

/**
 * Appended to the user turn on the one retry.
 *
 * Resending the identical prompt would be pointless — temperature is 0, so it
 * would most likely fail identically. This restates the output contract and
 * caps the field that actually causes truncation.
 */
export const BEAT_RETRY_INSTRUCTION =
  'Your previous response could not be parsed. Reply with ONE raw JSON object and nothing else — no code fence, no explanation, no text before or after it. Keep "focus" under 20 words so the object closes.';
