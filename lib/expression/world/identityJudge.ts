/**
 * The real, model-backed half of stage 2 identity judgment — kept in its
 * own file, deliberately separate from identity.ts, for exactly the reason
 * lib/expression/meaning/extract.ts is kept separate from pipeline.ts:
 * pipeline.ts is imported by client components (components/ExpressionLab.tsx)
 * as well as server code, so anything it imports unconditionally ends up in
 * the browser bundle. identity.ts (candidate retrieval, types, the safe
 * abstaining default) has no model dependency and is fine to import from
 * anywhere; this file pulls in `../../llm` and must only ever be imported by
 * server code that explicitly wants the real judge, injected the same way
 * `extractMeaning` already is.
 *
 * No `server-only` import, so scripts/expression-*.mjs can drive it
 * directly outside Next's build — same rule extract.ts documents.
 */

import { complete, SCRIBE_MODEL } from "../../llm";
import type { Entity } from "../schemas";
import type { IdentityCandidate, IdentityJudge, JudgeResult, JudgeVerdict } from "./identity";

export const IDENTITY_JUDGE_MODEL = process.env.IDENTITY_JUDGE_MODEL || SCRIBE_MODEL;

const JUDGE_SYSTEM_PROMPT = `You decide whether a newly-mentioned thing is the SAME as one of a short list of candidates already known, or something else. You are never told a world id and must never invent one.

You will be given:
1. "mention": the new thing just mentioned — its label, type, and description if any.
2. "candidates": a list of already-known things, each with an "index" (0-based), a label, a description if any, a "status", and a "kind".

A candidate's "kind" sometimes differs from the mention's "type" — that is not automatically evidence of a different thing. The same stable thing is often described once as an object/artifact and once as the action, event, or state involving it ("the email verification step" as a feature vs. "fixing the email verification step" as an action; "the blog post" as an object vs. the event of posting it), or as a group vs. a bare count of it ("affected customers" as a group vs. "43" as a quantity). Judge these by MEANING, the same as any other candidate — same_entity if it is genuinely the same stable thing described in a different grammatical role, related_but_distinct or new_entity if the kind difference reflects an actually different thing (a person is never a place; a decision is never the metric that measures it).

"status" tells you what happened to that candidate in the conversation so far — it is NOT a hint about whether the mention is the same thing, only about what should happen if it is:
  active / deemphasized   ordinary, currently in play.
  suspended               the group set this aside for later — "let's park that". If the mention is clearly bringing this SAME idea back into discussion, that is still same_entity; you are not being asked whether it should come back, only whether it is the same thing.
  rejected / superseded   the group ruled this out or replaced it. The mention can still be same_entity — people refer back to rejected ideas all the time ("no, I still think we should have gone with X") — identity is about WHAT something is, completely separate from whether the group accepted it. Do not let a rejected/superseded status pull you toward new_entity by itself.

Classify the relationship as exactly one of:
  same_entity           the mention names the SAME real thing as one specific candidate — just a different phrasing, a correction, a time-shifted restatement, or a different grammatical form of it ("the rebuild" = "full rebuild"; "rebuilding it" = "the rebuild"; "it" continuing "conversion" = "conversion").
  related_but_distinct   the mention is connected to a candidate but is genuinely a different thing (a sub-part, a different metric, a different decision about the same topic).
  new_entity             nothing in the candidate list is this thing at all.
  uncertain              the mention and the candidate(s) it is closest to are each a PLAUSIBLE reading, and nothing in what was actually said tells you which one is right.

Calibration for "uncertain" — this is a real, expected answer, not a fallback of last resort:
- If two candidates are both equally plausible readings of the mention and nothing distinguishes them, answer uncertain with index null. Do not break the tie by guessing which one seems more prominent, more recent, or more likely in general — none of that is evidence about what THIS mention meant.
- A short generic label reused by a different speaker for a description-free mention, with no other candidate to compare against either, is exactly the kind of case that should come back uncertain rather than same_entity — a coincidence in wording is not evidence of shared identity.
- Do not resolve a close call just to be helpful. An uncertain answer costs nothing but a duplicate entity; a wrong same_entity silently corrupts what is already known.

Rules:
- Only "same_entity" ever names a candidate. Set "index" to that candidate's index. For every other verdict, "index" MUST be null.
- Never choose an index that was not given to you. Never invent a candidate.

Respond with ONLY one JSON object, no other text: {"index": <int or null>, "verdict": "same_entity"|"related_but_distinct"|"new_entity"|"uncertain", "reason": "one short sentence"}`;

/** Pulls the first balanced JSON object out of a response — same tolerant parse extract.ts uses, since a model sometimes wraps JSON in a sentence despite instructions. */
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
export const defaultIdentityJudge: IdentityJudge = async (mention: Entity, candidates: IdentityCandidate[]) => {
  const abstain: JudgeResult = { index: null, verdict: "uncertain", reason: "model call failed or returned an unusable response" };
  if (!candidates.length) return abstain;
  let raw = "";
  try {
    raw = await complete({
      model: IDENTITY_JUDGE_MODEL,
      system: JUDGE_SYSTEM_PROMPT,
      user: JSON.stringify({
        mention: { label: mention.label, type: mention.type, description: mention.description },
        candidates: candidates.map((c, index) => ({ index, label: c.label, description: c.description, status: c.status, kind: c.kind })),
      }),
      maxTokens: 200,
      temperature: 0,
    });
  } catch {
    return abstain;
  }
  const json = extractJsonObject(raw) as Partial<JudgeResult> | null;
  if (!json || typeof json.verdict !== "string") return abstain;
  const VALID: JudgeVerdict[] = ["same_entity", "related_but_distinct", "new_entity", "uncertain"];
  if (!VALID.includes(json.verdict as JudgeVerdict)) return abstain;
  const index =
    json.verdict === "same_entity" && Number.isInteger(json.index) && (json.index as number) >= 0 && (json.index as number) < candidates.length
      ? (json.index as number)
      : null;
  // A "same_entity" verdict with no valid index is self-contradictory — treat as uncertain rather than trust the label alone.
  if (json.verdict === "same_entity" && index === null) return abstain;
  return { index, verdict: json.verdict as JudgeVerdict, reason: typeof json.reason === "string" ? json.reason.slice(0, 160) : "" };
};
