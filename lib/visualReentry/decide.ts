import "server-only";

/**
 * The one LLM call in Visual Re-entry V1: does this settled thought earn an
 * additional visual, and if so which supported family?
 *
 * Server-only, same as every other model-calling module in this codebase
 * (lib/llm.ts is imported exclusively by app/api/*\/route.ts handlers,
 * never by a "use client" component) — this file is called from
 * app/api/visual-intent/route.ts, NOT from components/Board.tsx directly.
 * lib/visualReentry/client.ts is the client-safe counterpart Board.tsx
 * actually imports.
 *
 * `none` is a fully valid, expected answer — most settled thoughts should
 * produce nothing. The model is never asked for, and must never emit,
 * pixel/canvas coordinates (codebase-wide invariant); it only returns
 * symbolic content plus its own textual evidence, which
 * lib/visualReentry/ground.ts then verifies against the source text before
 * lib/visualReentry/render.ts turns it into geometry.
 *
 * Strict, closed output only: the response must parse as exactly one of
 * VisualReentryIntentSchema's closed branches (lib/visualReentry/types.ts).
 * There is no fallback path to a free-form Beat/Artist action — anything
 * that isn't a clean parse becomes `none`.
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

const SYSTEM_PROMPT = `You decide whether a single settled thought from a live talk deserves an additional visual, on top of the words already shown on screen.

You are NOT trying to make the page visually busy. The live speech text already communicates what the speaker said. Your only job is to identify whether this settled thought contains structure that benefits from ONE supported visual form below. Answering "none" is the correct, expected, default answer — there is NO penalty for "none" and NO target visual frequency.

Choose "none" when the thought is:
- an ordinary conversational statement
- a reflection, opinion, or expression of uncertainty
- incomplete information, filler, or repetition
- something a visual would merely rewrite verbatim, adding nothing
- hierarchical, spatial, story-like, implied causality, or any other structure the supported forms below don't naturally fit
- something a useful visual would require inventing information for
- a case where your confidence is weak

Do NOT flatten a structure into the wrong family just to draw something. Causal chains are not sequences. A flat list is not a sequence. A chronological anecdote is not a process. A before/after numeric comparison remains quantitative_change, not sequence.

A thought can produce AT MOST ONE visual, never two. If a thought contains hints of more than one shape at once (e.g. "There are three things. First, users went from 10 to 20...") — do not return both. Pick the single shape that adds the most explanatory value, or answer "none" if you're not confident which one that is. Never split one thought into more than one visual.

You may choose exactly one of these six shapes and NOTHING else:

{"type":"none","reason":"one short sentence explaining why no visual is warranted"}

{"type":"enumeration","title":"optional short title","items":["item one","item two"],"evidence":["a phrase from the thought that supports this list"]}
  - Use only when the speaker genuinely presents a list: several named items under one idea, several reasons, or explicit numbered/grouped items — not merely a sentence that happens to contain multiple nouns.
  - "items": 2 to 5 short strings, verbatim or near-verbatim from what was said. Never invent an item that wasn't said. If there are more than 5 meaningful items and you cannot faithfully represent all of them, answer "none" rather than dropping any.
  - "evidence": one or more short phrases, quoted verbatim (or nearly so) from the thought, that justify the items you extracted.

{"type":"quantitative_change","from":10,"to":40,"fromQualifier":"about|around|roughly|approximately (optional)","toQualifier":"about|around|roughly|approximately (optional)","unit":"optional unit","fromLabel":"optional label for the starting value","toLabel":"optional label for the ending value","evidence":["a phrase from the thought that supports this change"]}
  - Use only when the thought states a LITERAL value that went from one specific number to another specific number, both actually spoken (e.g. "we had ten users last week and twenty users this week", "revenue went from ten thousand dollars to twenty thousand dollars", "the price increased from ten dollars to fifteen dollars").
  - Not appropriate for a vague magnitude with no literal numbers: "users grew a lot", "revenue is doing much better", "the business doubled" all describe a change without stating both literal numbers — answer "none" for these, every time.
  - "from"/"to": exactly the two numbers as spoken (word-form numbers like "ten thousand" are fine — write them as the number 10000). If EITHER literal number anchor is missing from what was said, answer "none" instead — do not estimate, round, or infer one.
  - "fromQualifier"/"toQualifier": if and only if that exact anchor was qualified by "about", "around", "roughly", or "approximately", copy that literal qualifier. Omit the field for an exact anchor. Never drop a spoken qualifier or add one that was not spoken.
  - Answer "none" for distinct modalities this schema cannot preserve, including nearly/almost, more/less than, at least/at most, over/under, ranges, or approximate multipliers such as "roughly twice".
  - "unit": only if a unit was actually spoken (e.g. "users", "dollars"). Omit otherwise — never invent one.
  - "fromLabel"/"toLabel": only if a time or context label was actually spoken (e.g. "last week"/"this week"). Omit otherwise — never invent one.
  - Never compute or output a percentage, a rate, an intermediate/derived value, a trend line, or an axis range. This shape is for exactly two literal spoken numbers and nothing else — no arithmetic of any kind.
  - "evidence": one or more short phrases, quoted verbatim (or nearly so) from the thought, that justify the from/to values.

{"type":"sequence","title":"optional short title","steps":["first spoken step","second spoken step"],"evidence":["source phrase supporting the ordered process"]}
  - Use only for a genuinely ordered process with explicit ordering/process semantics. Do not use for causality, flat lists, numeric before/after comparisons, or ordinary chronological storytelling.
  - "steps": 2 to 5 short strings, verbatim or near-verbatim from what was said, in spoken order. Never add an intermediate step, infer a prerequisite, merge away a spoken step, or truncate a process longer than 5 steps.
  - If uncertainty such as maybe/could/might applies to the process, answer "none" because this schema cannot preserve that modality safely.
  - "evidence": one or more source phrases supporting the steps and ordered-process interpretation.

{"type":"cause_effect","title":"optional short title","nodes":["literal cause","literal effect"],"edges":[{"from":0,"to":1,"evidence":"literal clause containing source, target, and causal cue"}],"evidence":["literal causal clause"]}
  - Use only for an ASSERTED causal relationship whose direction is explicit in the words. Temporal order, correlation, association, co-occurrence, or two nearby ideas are not causality.
  - "nodes": 2 to 4 short source concepts, verbatim or near-verbatim. Never invent an intermediate concept.
  - "edges": 1 to 3 directed, acyclic relationships. Every edge must retain its own literal evidence containing the source concept, target concept, and causal cue in the claimed direction.
  - Reverse grammar correctly: "Y because X" means X -> Y. Do not use text order alone.
  - Answer "none" for maybe/might/could/possibly/probably/I think, negated causal cues, or correction/revision discourse such as "I thought X caused Y, but actually...".
  - Never truncate an explanation over 4 nodes or 3 edges. Never turn after/before/then into a causal edge.

{"type":"comparison","leftLabel":"first explicit subject","rightLabel":"second explicit subject","rows":[{"left":"optional literal left claim","right":"optional literal right claim","evidence":["source phrase supporting this row"]}],"evidence":["source phrase establishing the contrast"]}
  - Use only for an explicit contrast between exactly two stable named subjects. Mentioning or using two things together is not a comparison.
  - Return 1 to 4 rows. Each row must contain at least one literal spoken claim. A missing side stays omitted—never invent the opposite claim to fill a cell.
  - Never add a winner, score, rank, preference, shared dimension, inverse claim, checkmark, or good/bad judgment unless that exact claim was spoken.
  - Preserve one-sided comparatives literally: for "A is faster than B", A may have "faster than B" while B has no invented "slower" claim.
  - Entity/value pairs such as "Plan A costs 10 dollars and Plan B costs 20 dollars" are comparison. Temporal/from-to change remains quantitative_change.
  - Answer "none" for uncertain, negated, or corrected comparisons, and for ordinary co-occurrence.
  - Every subject, claim, and evidence phrase must be present verbatim or nearly verbatim in the source.

Rules:
- Never include x, y, position, coordinates, size, or any layout information — you have no visibility into the canvas and must not guess at it.
- Never include any field not listed above for the shape you chose.
- Only extract content that is actually present in the thought. Do not add, infer, or embellish.
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
 * throws — a network/API failure, an empty response, unparseable JSON, an
 * unknown type, or a schema-invalid payload (missing/extra/malformed
 * fields) all resolve to `none`, since silence is always a safe fallback
 * for this feature (Part 12 — a failure at any stage does nothing, never
 * retries, never escalates). The `reason` distinguishes a genuine
 * model-decided `none` from a pipeline failure so
 * lib/visualReentry/orchestrate.ts can log them as separate stages
 * (`decision-none` vs `parse-failed`) — see REASON_* in ./types.
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
      maxTokens: 500,
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
