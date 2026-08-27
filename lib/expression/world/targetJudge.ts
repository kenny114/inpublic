/**
 * Constrained model-backed target judge for remaining reference and
 * discourse-act ties. Kept in its own file for the same reason
 * identityJudge.ts is separate from identity.ts: pipeline.ts is imported by
 * client components, so nothing that pulls in `../../llm` can live in a
 * file it imports unconditionally.
 *
 * The judge receives candidate INDICES only — never a world id — and may
 * answer only `resolved` (with an index into the list it was given) or
 * `uncertain`. It cannot invent a target.
 */

import { complete, SCRIBE_MODEL } from "../../llm";
import type { TargetJudge, TargetJudgeResult, TargetJudgeVerdict } from "./resolveTarget";

export const TARGET_JUDGE_MODEL = process.env.TARGET_JUDGE_MODEL || SCRIBE_MODEL;

const JUDGE_SYSTEM_PROMPT = `You decide which already-known thing a speaker is pointing at, or that you cannot tell. You are never told a world id and must never invent one.

You will be given:
1. "pointer": the phrase spoken, the hint extracted from it, whether this is a topic recall or a discourse act (reject/suspend/reactivate/...), and an optional speaker hint.
2. "candidates": a short list of already-known things, each with an "index" (0-based), a label, a description if any, a "status", a "kind", and the deterministic reasons it was retrieved.

Classify as exactly one of:
  resolved    the pointer names ONE specific candidate. Set "index" to that candidate's index.
  uncertain   two or more candidates are each a plausible reading, or none of them is, and nothing in what was actually said tells you which one is right. Set "index" to null.

Calibration for "uncertain" — this is a real, expected answer, not a fallback of last resort:
- If two candidates are both equally plausible and nothing distinguishes them, answer uncertain. Do not break the tie by guessing which one seems more prominent, more recent, or more likely in general.
- Prefer uncertain over a wrong attachment. A wrong target silently mutates the world; an unresolved pointer is visible and harmless.
- A shorter label that is a subset of a longer one ("free tier" vs "revisit the free tier") when the speaker said "forget removing the free tier" is exactly the kind of case that should come back uncertain unless the rest of the pointer clearly names the proposal rather than the product — and even then, only resolve if you are sure.
- Do not resolve a close call just to be helpful.

Rules:
- Only "resolved" ever names a candidate. Set "index" to that candidate's index. For "uncertain", "index" MUST be null.
- Never choose an index that was not given to you. Never invent a candidate.

Respond with ONLY one JSON object, no other text: {"index": <int or null>, "verdict": "resolved"|"uncertain", "reason": "one short sentence"}`;

function extractJsonObject(raw: string): unknown | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const char = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Never throws — any failure resolves to "uncertain", the same fail-safe every model call in this engine uses. */
export const defaultTargetJudge: TargetJudge = async (input) => {
  const abstain: TargetJudgeResult = { index: null, verdict: "uncertain", reason: "model call failed or returned an unusable response" };
  if (!input.candidates.length) return abstain;
  let raw = "";
  try {
    raw = await complete({
      model: TARGET_JUDGE_MODEL,
      system: JUDGE_SYSTEM_PROMPT,
      user: JSON.stringify({
        pointer: {
          surface: input.surface,
          hint: input.hint,
          kind: input.kind,
          actType: input.actType,
          speakerHint: input.speakerHint,
        },
        candidates: input.candidates,
      }),
      maxTokens: 200,
      temperature: 0,
    });
  } catch {
    return abstain;
  }
  const json = extractJsonObject(raw) as Partial<TargetJudgeResult> | null;
  if (!json || typeof json.verdict !== "string") return abstain;
  const VALID: TargetJudgeVerdict[] = ["resolved", "uncertain"];
  if (!VALID.includes(json.verdict as TargetJudgeVerdict)) return abstain;
  const index =
    json.verdict === "resolved" && Number.isInteger(json.index) && (json.index as number) >= 0 && (json.index as number) < input.candidates.length
      ? (json.index as number)
      : null;
  if (json.verdict === "resolved" && index === null) return abstain;
  return { index, verdict: json.verdict as TargetJudgeVerdict, reason: typeof json.reason === "string" ? json.reason.slice(0, 160) : "" };
};
