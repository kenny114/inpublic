import "server-only";

/**
 * The one LLM call in Visual Re-entry: does this settled thought state a
 * clear, directed relationship between two named things — the single
 * cause_effect (box-and-arrow) shape this feature now supports — and if so,
 * what are its nodes/edges?
 *
 * Server-only, same as every other model-calling module in this codebase
 * (lib/llm.ts is imported exclusively by app/api/*\/route.ts handlers,
 * never by a "use client" component) — this file is called from
 * app/api/visual-intent/route.ts, NOT from components/Board.tsx directly.
 * lib/visualReentry/client.ts is the client-safe counterpart Board.tsx
 * actually imports.
 *
 * This is a FALLBACK, not the primary decision path. cause.ts's
 * `parseExplicitCauseEffect` — a closed, deterministic grammar of explicit
 * causal cue words — always gets the first attempt (lib/visualReentry/
 * fastPath.ts). It only reaches here when that grammar found nothing AND
 * the loosened lib/visualReentry/candidate.ts prefilter still thinks the
 * clause is worth asking about. Real conversational explanation routinely
 * describes a genuine directed relationship without ever using one of the
 * deterministic grammar's fixed trigger words ("InPublic is really
 * infrastructure in which I can explain myself" has no "causes"/"leads
 * to"/"because" anywhere in it) — this model call exists to catch exactly
 * that gap, nothing more.
 *
 * `none` is a fully valid, expected answer — most settled thoughts should
 * produce nothing, and there is no target visual frequency. The model is
 * never asked for, and must never emit, pixel/canvas coordinates
 * (codebase-wide invariant); it only returns symbolic content plus its own
 * textual evidence, which lib/visualReentry/ground.ts then verifies against
 * the source text before lib/visualReentry/render.ts turns it into
 * geometry.
 *
 * Strict, closed output only: the response must parse as exactly one of
 * VisualReentryIntentSchema's two branches (lib/visualReentry/types.ts) —
 * "none" or "cause_effect". There is no fallback path to a free-form
 * Beat/Artist action, and no other visual family exists to fall back to
 * either — anything that isn't a clean parse becomes `none`.
 */

import { complete, SCRIBE_MODEL, type CompletionUsage } from "../llm";
import type { VisualReentryIntent } from "./types";
import { VisualReentryIntentSchema, fallbackNone, REASON_MODEL_UNAVAILABLE, REASON_PARSE_FAILED } from "./types";

/**
 * Reuses SCRIBE_MODEL exactly (not just the same default string) — one
 * small structured call per settled thought, latency matters more than
 * depth here, and reusing an already-billed model means the existing
 * provider_rate_cards row already covers it, same reasoning MATH_MODEL's
 * doc comment (lib/llm.ts) gives for reusing ARTIST_MODEL.
 */
export const VISUAL_REENTRY_MODEL = process.env.VISUAL_REENTRY_MODEL || SCRIBE_MODEL;

/** Generic fallback for a caller that just needs SOME valid intent (e.g. app/api/visual-intent/route.ts's own request-validation short-circuit) without a more specific failure category. */
export const NONE_FALLBACK: VisualReentryIntent = fallbackNone(REASON_MODEL_UNAVAILABLE);

const SYSTEM_PROMPT = `You decide whether a single settled thought from a live talk states a clear, directed RELATIONSHIP between two or more named things — not just causal chains, but any stable structural relationship someone might draw as "A -> B" with a short label: causes, enables, lets someone do something, means something, handles/uses/includes/contains/represents/decides/builds/becomes/connects to/is part of, or any other clearly directional relationship a reasonable person would draw as an arrow from one named thing to another.

You are NOT trying to make the page visually busy. Most thoughts are reflection, opinion, narration, or ordinary description with no drawable relationship — answering "none" is the correct, expected, default answer. There is NO penalty for "none" and NO target frequency.

Choose "none" when the thought is:
- an ordinary statement, reflection, opinion, or narration with no relationship between two distinct named things
- vague ("things are better", "it's interesting") with no two concrete endpoints
- something a relationship would require inventing information for
- a case where your confidence is weak or the direction is ambiguous

Respond with ONLY a single JSON object:
{"type":"none","reason":"one short sentence"}
or
{"type":"cause_effect","title":"optional short title","nodes":["literal source","literal target"],"edges":[{"from":0,"to":1,"evidence":"literal clause containing both endpoints and the relationship"}],"evidence":["literal clause(s) that justify this"]}

Rules:
- "nodes": 2 to 4 short noun phrases (3-6 words), using only words that were actually said. Never invent a node.
- "edges": 1 to 3 directed, acyclic relationships between nodes already listed.
- Every edge's evidence must be a literal (or near-literal) quote containing both its endpoints.
- Never include x, y, position, coordinates, or any layout/visual information.
- Only extract content that is actually present in the thought. Never add, infer, or embellish.
- Respond with ONLY a single JSON object, no other text.`;

/**
 * Best-effort JSON extraction: strips a markdown code fence if the model
 * added one despite instructions, same defensive posture other JSON-parsing
 * call sites in this codebase use around free-form model output.
 */
function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(candidate);
}

/**
 * Decides a visual intent for a settled thought's text, or `none`. Never
 * throws — a network/API failure (including a missing ANTHROPIC_API_KEY in
 * local dev, which lib/llm.ts's `complete()` already fails closed on), an
 * empty response, unparseable JSON, an unknown type, or a schema-invalid
 * payload all resolve to `none`, since silence is always a safe fallback
 * for this feature — a failure at any stage does nothing, never retries,
 * never escalates. The `reason` distinguishes a genuine model-decided
 * `none` from a pipeline failure so lib/visualReentry/orchestrate.ts can
 * log them as separate stages (`decision-none` vs `parse-failed`) — see
 * REASON_* in ./types.
 *
 * Takes the settled thought's text only (not the full SettledThought) —
 * grounding/evidence-checking against sourceSegments happens client-side in
 * lib/visualReentry/ground.ts, which already has that context; the model
 * itself only ever needs the text to decide on.
 *
 * `onUsage` is threaded straight through to `complete()` so the caller (the
 * API route) can reconcile provider cost exactly like every other
 * model-calling route in this codebase.
 */
export async function decideVisual(
  text: string,
  onUsage?: (usage: CompletionUsage) => void,
): Promise<VisualReentryIntent> {
  let raw: string;
  try {
    raw = await complete({
      model: VISUAL_REENTRY_MODEL,
      system: SYSTEM_PROMPT,
      user: text,
      maxTokens: 300,
      temperature: 0,
      onUsage,
    });
  } catch {
    return fallbackNone(REASON_MODEL_UNAVAILABLE);
  }
  if (!raw) return fallbackNone(REASON_MODEL_UNAVAILABLE);

  let json: unknown;
  try {
    json = extractJson(raw);
  } catch {
    return fallbackNone(REASON_PARSE_FAILED);
  }
  const parsed = VisualReentryIntentSchema.safeParse(json);
  return parsed.success ? parsed.data : fallbackNone(REASON_PARSE_FAILED);
}
