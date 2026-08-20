/**
 * Core decision logic for the Meaning Engine's LLM calls, extracted from
 * lib/meaning/decide.ts so it can be imported directly by an offline
 * test/replay tool (scripts/meaning-replay.mjs) without pulling in the
 * `server-only` guard — that package only resolves inside Next.js's webpack
 * build, so a plain Node script importing decide.ts fails outright.
 * lib/meaning/decide.ts re-exports everything here wrapped in
 * `server-only`, and remains the only import path app code should use;
 * nothing under app/ or components/ should ever import this file directly.
 *
 * TWO-STAGE ARCHITECTURE (semantic accumulation audit, 2026-08-19):
 *
 * V1 was one call: currentState + newText -> updated state, in one prompt,
 * one shot. Real voice-note replay showed this anchors on the existing
 * interpretation — asking the model to revise currentState AND read newText
 * in the same breath biases it toward "does newText support what I already
 * believe" rather than "what does newText actually say." Measured effect:
 * only ~1/3 of meaningful content across three chained voice notes survived
 * into the final state; most of the loss was new concrete information (a
 * new event, a new named thing) being folded into "more evidence for the
 * existing conclusion" instead of being represented in its own right.
 *
 * Fix: split into two calls that ask two different questions.
 *  1. `extractLocalMeaning` — "what new meaning is actually contained in
 *     this speech?", decided from newText + recentContext (raw prior
 *     speech), with only a minimal topic/interpretation hint from
 *     currentState for pronoun resolution — never the full concept graph.
 *     currentState cannot anchor an extraction it barely sees.
 *  2. `reconcileLocalMeaning` — "how does that meaning modify what we
 *     already understand?", decided from the LocalMeaning + the full
 *     currentState. This is the only stage allowed to merge/supersede/
 *     ignore, and it's explicitly told that reinforcing an existing
 *     conclusion and adding new concrete information are not mutually
 *     exclusive outcomes.
 *
 * `decideMeaningCore` orchestrates both calls and is the only export other
 * modules should call — it keeps the same signature/behavior contract V1
 * had (never throws, falls back to currentState unchanged on any failure)
 * so callers (engine.ts, the API route, replay scripts) need no changes.
 * Pass `onStage` to observe the intermediate LocalMeaning and pre/post
 * sanitize payloads for debugging (see scripts/meaning-*-replay.mjs).
 */

import { complete, SCRIBE_MODEL, type CompletionUsage } from "../llm";
import {
  LocalMeaningSchema,
  SemanticStateSchema,
  type LocalMeaning,
  type SemanticState,
} from "./types";

export const MEANING_ENGINE_MODEL = process.env.MEANING_ENGINE_MODEL || SCRIBE_MODEL;

/** Fired once per stage, per round — the Phase-7 instrumentation hook. Never required for correctness. */
export interface DecideStageEvents {
  onLocalMeaning?: (localMeaning: LocalMeaning | null, raw: string) => void;
  onReconcilePreSanitize?: (json: unknown, raw: string) => void;
  onReconcilePostSanitize?: (json: unknown) => void;
  /** Fired whenever reconcileLocalMeaning bails out BEFORE producing a parsed result — tells apart "nothing to reconcile" from an actual call/parse/validation failure, which onReconcilePreSanitize/PostSanitize alone can't distinguish (both stay unfired in every case). */
  onReconcileSkip?: (reason: "empty-local-meaning" | "call-error" | "empty-response" | "unparseable-json" | "schema-invalid", detail?: string) => void;
}

export const LOCAL_EXTRACTION_SYSTEM_PROMPT = `You extract the meaning newly contained in one chunk of speech — independent of what a separate system already believes about the conversation so far. Do not think about diagrams, boxes, or arrows.

You will be given:
1. "recentContext": the last few settled thoughts BEFORE this one, in order, as plain text — use this to resolve pronouns ("it", "that", "they", "this"), vague references ("the bigger thing", "what I realized"), and implicit continuations.
2. "priorTopic" / "priorInterpretation": a MINIMAL hint of what the conversation has been about so far — a topic string and a one-sentence summary, nothing more. This is only for resolving references (e.g. knowing "he" plausibly refers to a person already established). Do NOT let it suppress or filter what you extract — you are not being asked whether newText fits priorInterpretation, only what newText itself means. If newText contains something that has nothing to do with priorInterpretation, extract it anyway.
3. "newText": the next chunk of speech, already transcribed (transcription may contain recognition errors, e.g. "me onboard in our user" likely means "onboard our user" — interpret the most plausible intended meaning, never quote the raw wording back as if it were clean).

Your ONLY question: what new meaning does newText itself contribute? Extract:
- "concepts": people/objects/events/actions/states/objectives newText introduces or clearly develops. A short local id (kebab-case). "label" is a NAME of 1-4 words, never a clause (put the clause in "description"). If the speaker names a number, set "quantity":{"value":N,"unit":"optional"} and keep the label as the thing counted. Do not mint a concept for a likely transcription aside or filler noun that is not part of the point (e.g. "chat" in "we chat and we have to add" when the point is adding apples). Merge restatements of the same quantity or step instead of a new concept per sentence.
- "claims": an observation, realization, belief, evaluation, conclusion, emotion, or uncertainty that doesn't resolve into a clean structural link (e.g. "it was humbling" -> claim text "the experience was humbling for the speaker"). A claim is a first-class expected output, not a fallback.
- "relationships": a relationship between two of THIS extraction's own local concept ids, only when genuinely clear from newText. If A makes B happen, easier, or possible, that is "causes" or "leads_to" — not "supports". Reserve "supports" for evidence/backing, not for the speaker's actual causal story. Omit "label" on relationships — the type is enough.
- "interpretation": one sentence — what does this speech, on its own, mean?

Extract EVERY distinct new concrete thing newText names — a new person, a new action they took, a new named tool or workflow, a new step — even if it also happens to support or restate something from recentContext. Prefer extracting too much over collapsing multiple distinct new things into one vague claim.

Return "no meaning" as literally empty arrays + an empty interpretation ONLY for pure filler ("um", "so yeah"), accidental noise, or a fragment with nothing recoverable even against recentContext. A sentence being reflective, pronoun-heavy, conversational, or short is never by itself a reason to extract nothing.

Never invent information not supported by newText (allowing for the noisy-transcription interpretation above).

Respond with ONLY a single JSON object, no other text:
{"concepts":[{"id":"...","label":"...","description":"optional"}],"claims":[{"text":"...","about":["localConceptId"]}],"relationships":[{"from":"localConceptId","to":"localConceptId","type":"causes"|"leads_to"|"supports"|"contrasts"|"contains"|"example_of"|"part_of"|"depends_on"|"related_to","label":"optional"}],"interpretation":"..."}`;

export const RECONCILE_SYSTEM_PROMPT = `You maintain a small, developing model of what a speaker currently means, updated as they keep talking. You are the "brain" — a downstream system decides much later, separately, whether/how any of this becomes a picture. Do not think about diagrams, boxes, or arrows.

You will be given:
1. "currentState": the meaning model as it stands right now (topic, concepts, relationships, claims, currentInterpretation). May be empty at the start of a talk.
2. "localMeaning": what the most recent chunk of speech means ON ITS OWN, already extracted independently by a separate step (concepts, claims, relationships, interpretation) — this already captures the new information; your job is to fold it into currentState correctly, not to re-derive it or second-guess whether it's real.

Return the UPDATED state as a whole (not a diff).

CORE PRINCIPLE — REINFORCEMENT MUST NOT ERASE CONCRETE INFORMATION:
localMeaning was extracted before knowing currentState, specifically so that concrete new information isn't discarded just because it also supports an existing conclusion. Your job continues that: a piece of localMeaning can BOTH reinforce/support an existing concept AND be represented as its own new concept/claim. Do not respond to localMeaning containing a concrete new person/action/thing by merely reinforcing an existing abstract concept and dropping the concrete part. Example: currentState already says "Meeting -> changed -> speaker's perspective"; localMeaning says the participant demonstrated his video workflow. Correct: ADD a "video workflow demonstration" concept/claim, and (optionally) connect it to the existing perspective-change concept — never just reinforce the existing concept alone.

RECONCILIATION MOVES (apply per localMeaning item, not to the round as a whole):
- ADD: genuinely new concept/claim/relationship not already represented — mint a fresh id.
- MERGE / UPDATE: localMeaning restates or elaborates something already in currentState — update that SAME item in place (reuse its exact existing id), don't duplicate. A straightforward correction ("actually the outcome was Y") updates the same concept's label, not a new one. If later speech clearly names what an earlier vague/misheard concept was (e.g. "feel tension" was "feed ten children"; "five of those" was "five apples"), UPDATE that concept's label or SUPERSEDE it — do not keep both the mishearing and the correction as equal ideas.
- REINFORCE: localMeaning supports an existing concept/claim with no new distinct content of its own — fine to leave that item as-is, but only when there truly is nothing concrete beyond the existing item (rare — most reinforcing speech also names something concrete, which should ADD alongside).
- SUPERSEDE: use status:"superseded" (keep in the list, don't delete) only when both the earlier and later interpretation are worth preserving as history and the earlier one is now clearly not current.
- CONNECT: when localMeaning is genuinely new AND clearly relates to an existing concept, add both the new concept/claim AND a relationship connecting it, rather than just one or the other.
- IGNORE: only for localMeaning that is empty/near-empty (pure filler already filtered upstream) or that duplicates something already fully represented with zero new content.

DO NOT LET currentState GROW STALE. A currentState with many concepts is not a reason to stop adding — a long talk should end with MORE concepts/claims than a short one. Before treating a round as reinforcement-only, check every item in localMeaning individually against currentState — if even one isn't already represented, this round must add or update something.

MAINTAINING STATE ACROSS TURNS:
- Merge near-duplicates: if two of YOUR OWN existing concepts describe the same underlying idea in different words, collapse them (keep the id that already exists, rewire relationships/claims that pointed at the dropped id, drop the duplicate).
- "importance": "primary" for the one main idea (exactly one unless the speaker is genuinely comparing two equals), "supporting" for concepts that materially develop it, "detail" for minor elaboration.
- Concept "label" stays 1-4 words, a name not a sentence. Omit relationship "label". Merge near-duplicate steps (two "add apples" sentences are one concept).
- A relationship needs two concepts already in "concepts" and a "type": causes, leads_to, supports, contrasts, contains, example_of, part_of, depends_on, or related_to (use related_to only when nothing more specific fits). If A makes B happen, easier, or possible, that is causes or leads_to — not supports. Have-vs-need, X-vs-Y, or two quantities in tension is contrasts. A whole and its parts is contains/part_of. Reasons for a claim support that claim. Reserve supports for evidence/backing, not the speaker's causal story. If a concept has a number, keep/set quantity {value, unit}.
- Every "id" (concepts, relationships, claims) must be a short lowercase kebab-case slug, reused exactly when continuing the same idea, minted fresh only for something genuinely new (localMeaning's own local ids are NOT global ids — mint your own global id, informed by the local label, when adding).
- Update "currentInterpretation" every round to a short, current, one-sentence summary of what you now believe the speaker means overall.
- Never invent information beyond what localMeaning (and currentState) already contain.
- If localMeaning is entirely empty (no concepts, claims, or relationships, and an empty interpretation), return currentState completely unchanged.

Respond with ONLY a single JSON object matching this exact shape, no other text:
{"topic":"optional short topic string","currentInterpretation":"optional one-sentence summary","concepts":[{"id":"...","label":"...","description":"optional clarifying phrase","importance":"primary"|"supporting"|"detail","status":"active"|"superseded","confidence":"high"|"medium"|"low","sourceThoughtIds":["..."]}],"relationships":[{"id":"...","from":"conceptId","to":"conceptId","type":"causes"|"leads_to"|"supports"|"contrasts"|"contains"|"example_of"|"part_of"|"depends_on"|"related_to","label":"optional short label","confidence":"high"|"medium"|"low","sourceThoughtIds":["..."]}],"claims":[{"id":"...","text":"...","about":["conceptId"],"importance":"primary"|"supporting"|"detail","confidence":"high"|"medium"|"low","sourceThoughtIds":["..."]}]}

Every field except "id"/"label"/"text"/"importance"/"type"/"from"/"to" is optional — omit rather than guess when you have nothing to add for it.`;

/**
 * Strips a markdown code fence around the model's JSON, tolerating a fence
 * that never closes — found via real voice-note replay, 2026-08-19: once
 * the semantic caps were raised (24/40/30, see types.ts), a genuinely large
 * reconciliation response could run past maxTokens and get cut off mid-body,
 * so the closing ``` never arrived. The old regex required BOTH fences to
 * match, so an unclosed opening fence fell through to `trimmed` — which
 * still started with the literal "```json" text — and every one of those
 * truncated-but-otherwise-good responses was thrown away as unparseable
 * JSON. Stripping a leading fence unconditionally (closed or not) lets
 * JSON.parse's own truncation error (if the body itself got cut mid-object)
 * be the only thing that still fails these responses.
 */
function extractJson(raw: string): unknown {
  let trimmed = raw.trim();
  const leadingFence = trimmed.match(/^```(?:json)?\s*/i);
  if (leadingFence) trimmed = trimmed.slice(leadingFence[0].length);
  trimmed = trimmed.replace(/```\s*$/i, "").trim();
  return JSON.parse(trimmed);
}

function clampString(value: unknown, max: number): unknown {
  return typeof value === "string" && value.length > max ? value.slice(0, max) : value;
}

/** Schema id: `^[a-z][a-z0-9_-]{0,39}$`. Models often emit `Proliferation->Trust`, `REL 6`, or CamelCase — one bad id used to discard the whole round (gold trust-problem, 2026-08-19). */
const ID_SLUG = /^[a-z][a-z0-9_-]{0,39}$/;

export function slugifyId(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  if (ID_SLUG.test(value)) return value;
  let s = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!s) return null;
  if (!/^[a-z]/.test(s)) s = `id-${s}`;
  if (s.length > 40) s = s.slice(0, 40).replace(/-+$/g, "");
  return ID_SLUG.test(s) ? s : null;
}

function uniqueSlug(value: unknown, used: Set<string>): string | null {
  const base = slugifyId(value);
  if (!base) return null;
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  for (let n = 2; n < 20; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, 40 - suffix.length)}${suffix}`;
    if (ID_SLUG.test(candidate) && !used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  return null;
}

const IMPORTANCE_RANK: Record<string, number> = { primary: 0, supporting: 1, detail: 2 };
/** Unranked/unknown importance sorts as if "detail" — least likely to survive a trim. */
function importanceRank(value: unknown): number {
  return IMPORTANCE_RANK[value as string] ?? 2;
}

/**
 * Keeps the first `max` items by importance (primary, then supporting, then
 * detail), preserving each priority tier's original relative order — a
 * stable sort by rank, not a reshuffle. Used when the model proposes more
 * concepts/claims than the schema allows; the least important overflow is
 * dropped rather than the whole response being discarded.
 */
function trimByImportance<T extends { importance?: unknown }>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => importanceRank(a.item.importance) - importanceRank(b.item.importance) || a.index - b.index)
    .slice(0, max)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.item);
}

/**
 * Truncates known length-capped string fields, and trims arrays that exceed
 * their schema cap, before validation — rather than letting one field or
 * one extra element discard the model's ENTIRE otherwise-correct response.
 * Zod's `.strict()` object validation fails the whole object on any single
 * issue, and a whole round of real understanding is worth far more than one
 * cosmetically long label or one concept over the cap.
 *
 * The array-trim case matters more than it looks: once currentState is
 * already near a cap (e.g. 6-7 concepts), a genuinely well-formed response
 * that adds one more legitimate concept exceeds the limit and would
 * otherwise be discarded wholesale — and since the model has no visibility
 * into WHY its last proposal vanished, it tends to propose a similarly
 * oversized state again next round, silently freezing currentState for the
 * rest of the conversation. Trimming by importance (dropping the least
 * important overflow, never touching a "primary" item unless there are more
 * primaries than the cap allows) keeps the round's real update alive
 * instead of discarding it.
 *
 * Trimming concepts can orphan relationships/claims that referenced a
 * dropped concept id — those dangling references are cleaned up too
 * (`about` entries are pruned individually; a relationship with a missing
 * endpoint is dropped, since a relationship makes no sense without both).
 * A malformed SHAPE (wrong types, missing required fields) still fails
 * through to the normal `currentState`-unchanged fallback — this only
 * repairs "otherwise valid but ran over a bound," which is by far the most
 * common way a real response fails validation.
 */
export function sanitizeForSchema(json: unknown): unknown {
  if (typeof json !== "object" || json === null) return json;
  const obj = json as Record<string, unknown>;
  const sanitized: Record<string, unknown> = { ...obj };

  if ("topic" in sanitized) sanitized.topic = clampString(sanitized.topic, 80);
  if ("currentInterpretation" in sanitized) sanitized.currentInterpretation = clampString(sanitized.currentInterpretation, 240);

  let conceptIds: Set<string> | null = null;
  const idMap = new Map<string, string>();
  if (Array.isArray(sanitized.concepts)) {
    const used = new Set<string>();
    let concepts = (sanitized.concepts as unknown[]).flatMap((c) => {
      if (typeof c !== "object" || c === null) return [c];
      const concept = c as Record<string, unknown>;
      const id = uniqueSlug(concept.id, used);
      if (!id) return [];
      if (typeof concept.id === "string") idMap.set(concept.id, id);
      idMap.set(id, id);
      return [{
        ...concept,
        id,
        label: clampString(concept.label, 60),
        ...("description" in concept ? { description: clampString(concept.description, 160) } : {}),
      }];
    });
    concepts = trimByImportance(concepts as { importance?: unknown }[], 24);
    sanitized.concepts = concepts;
    conceptIds = new Set(concepts.map((c) => (c as Record<string, unknown>).id).filter((id): id is string => typeof id === "string"));
  }

  const resolveId = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    if (idMap.has(value)) return idMap.get(value);
    const slugged = slugifyId(value);
    if (slugged && idMap.has(slugged)) return idMap.get(slugged);
    return slugged ?? undefined;
  };

  if (Array.isArray(sanitized.relationships)) {
    const usedRel = new Set<string>();
    let relationships = (sanitized.relationships as unknown[]).flatMap((r) => {
      if (typeof r !== "object" || r === null) return [r];
      const rel = r as Record<string, unknown>;
      const from = resolveId(rel.from);
      const to = resolveId(rel.to);
      const id = uniqueSlug(rel.id ?? (from && to ? `${from}-to-${to}` : null), usedRel);
      if (!id || !from || !to) return [];
      return [{ ...rel, id, from, to, ...("label" in rel ? { label: clampString(rel.label, 40) } : {}) }];
    });
    if (conceptIds) {
      relationships = relationships.filter((r) => {
        if (typeof r !== "object" || r === null) return true;
        const rel = r as Record<string, unknown>;
        return conceptIds!.has(rel.from as string) && conceptIds!.has(rel.to as string);
      });
    }
    if (relationships.length > 40) relationships = relationships.slice(0, 40);
    sanitized.relationships = relationships;
  }

  if (Array.isArray(sanitized.claims)) {
    const usedClaim = new Set<string>();
    let claims = (sanitized.claims as unknown[]).flatMap((c) => {
      if (typeof c !== "object" || c === null) return [c];
      const claim = c as Record<string, unknown>;
      const id = uniqueSlug(claim.id, usedClaim);
      if (!id) return [];
      const patched: Record<string, unknown> = { ...claim, id, text: clampString(claim.text, 160) };
      if (Array.isArray(claim.about)) {
        const filteredAbout = [...new Set((claim.about as unknown[]).map(resolveId).filter((x): x is string => typeof x === "string" && (!conceptIds || conceptIds.has(x))))];
        if (filteredAbout.length) patched.about = filteredAbout;
        else delete patched.about;
      }
      return [patched];
    });
    claims = trimByImportance(claims as { importance?: unknown }[], 30);
    sanitized.claims = claims;
  }

  return sanitized;
}

/**
 * Same posture as sanitizeForSchema, sized for LocalMeaningSchema's smaller
 * caps (10 concepts / 8 claims / 10 relationships) — a stage-1 response that
 * runs slightly over a bound must still survive, not be discarded (which
 * would silently degrade to "no local meaning" and defeat the entire point
 * of extracting before reconciling).
 */
export function sanitizeLocalMeaning(json: unknown): unknown {
  if (typeof json !== "object" || json === null) return json;
  const obj = json as Record<string, unknown>;
  const sanitized: Record<string, unknown> = { ...obj };

  if ("interpretation" in sanitized) sanitized.interpretation = clampString(sanitized.interpretation, 240) ?? "";
  else sanitized.interpretation = "";

  let conceptIds: Set<string> | null = null;
  if (Array.isArray(sanitized.concepts)) {
    let concepts = (sanitized.concepts as unknown[]).map((c) => {
      if (typeof c !== "object" || c === null) return c;
      const concept = c as Record<string, unknown>;
      return {
        ...concept,
        label: clampString(concept.label, 60),
        ...("description" in concept ? { description: clampString(concept.description, 160) } : {}),
      };
    });
    if (concepts.length > 10) concepts = concepts.slice(0, 10);
    sanitized.concepts = concepts;
    conceptIds = new Set(concepts.map((c) => (c as Record<string, unknown>).id).filter((id): id is string => typeof id === "string"));
  }

  if (Array.isArray(sanitized.claims)) {
    let claims = (sanitized.claims as unknown[]).map((c) => {
      if (typeof c !== "object" || c === null) return c;
      const claim = c as Record<string, unknown>;
      const patched: Record<string, unknown> = { ...claim, text: clampString(claim.text, 160) };
      if (conceptIds && Array.isArray(claim.about)) {
        const filteredAbout = (claim.about as unknown[]).filter((id) => typeof id === "string" && conceptIds!.has(id));
        if (filteredAbout.length) patched.about = filteredAbout;
        else delete patched.about;
      }
      return patched;
    });
    if (claims.length > 8) claims = claims.slice(0, 8);
    sanitized.claims = claims;
  }

  if (Array.isArray(sanitized.relationships)) {
    let relationships = (sanitized.relationships as unknown[]).map((r) => {
      if (typeof r !== "object" || r === null) return r;
      const rel = r as Record<string, unknown>;
      return { ...rel, ...("label" in rel ? { label: clampString(rel.label, 40) } : {}) };
    });
    if (conceptIds) {
      relationships = relationships.filter((r) => {
        if (typeof r !== "object" || r === null) return true;
        const rel = r as Record<string, unknown>;
        return conceptIds!.has(rel.from as string) && conceptIds!.has(rel.to as string);
      });
    }
    if (relationships.length > 10) relationships = relationships.slice(0, 10);
    sanitized.relationships = relationships;
  }

  return sanitized;
}

const EMPTY_LOCAL_MEANING_JSON = { concepts: [], claims: [], relationships: [], interpretation: "" };

/**
 * Stage 1: what new meaning does newText itself contain? Deliberately given
 * only a minimal `priorTopic`/`priorInterpretation` hint from currentState
 * (never the full concept graph) — see this module's doc comment for why.
 * Returns an empty LocalMeaning (never null/throws) on any failure, which
 * `reconcileLocalMeaning` treats as "leave currentState unchanged."
 */
export async function extractLocalMeaning(
  recentContext: string[],
  newText: string,
  priorTopic: string | undefined,
  priorInterpretation: string | undefined,
  onUsage?: (usage: CompletionUsage) => void,
  onStage?: DecideStageEvents,
): Promise<LocalMeaning> {
  let raw = "";
  try {
    raw = await complete({
      model: MEANING_ENGINE_MODEL,
      system: LOCAL_EXTRACTION_SYSTEM_PROMPT,
      user: JSON.stringify({ recentContext, priorTopic, priorInterpretation, newText }),
      maxTokens: 1000,
      temperature: 0,
      onUsage,
    });
  } catch (err) {
    onStage?.onLocalMeaning?.(null, err instanceof Error ? err.message : String(err));
    return { ...EMPTY_LOCAL_MEANING_JSON };
  }
  if (!raw) {
    onStage?.onLocalMeaning?.(null, raw);
    return { ...EMPTY_LOCAL_MEANING_JSON };
  }

  let json: unknown;
  try {
    json = extractJson(raw);
  } catch {
    onStage?.onLocalMeaning?.(null, raw);
    return { ...EMPTY_LOCAL_MEANING_JSON };
  }
  const parsed = LocalMeaningSchema.safeParse(sanitizeLocalMeaning(json));
  const result = parsed.success ? parsed.data : { ...EMPTY_LOCAL_MEANING_JSON };
  onStage?.onLocalMeaning?.(parsed.success ? parsed.data : null, raw);
  return result;
}

/**
 * Stage 2: fold a LocalMeaning into currentState. Falls back to
 * `currentState` unchanged on any failure — never throws.
 */
export async function reconcileLocalMeaning(
  currentState: SemanticState,
  localMeaning: LocalMeaning,
  onUsage?: (usage: CompletionUsage) => void,
  onStage?: DecideStageEvents,
): Promise<SemanticState> {
  // Nothing to reconcile — mirrors the prompt's own "entirely empty -> unchanged" instruction, without spending a call on it.
  if (!localMeaning.concepts.length && !localMeaning.claims.length && !localMeaning.relationships.length && !localMeaning.interpretation) {
    onStage?.onReconcileSkip?.("empty-local-meaning");
    return currentState;
  }

  let raw: string;
  try {
    raw = await complete({
      model: MEANING_ENGINE_MODEL,
      system: RECONCILE_SYSTEM_PROMPT,
      user: JSON.stringify({ currentState, localMeaning }),
      // A full 24-concept/40-relationship/30-claim state can genuinely need
      // this much room to echo back — 1200 (V1's cap, sized for the old
      // 7/12/10 caps) was silently truncating the JSON mid-response once the
      // caps were raised (see extractJson's doc comment). 4000, then 6000,
      // still weren't enough once a real multi-minute combined session's
      // currentState grew toward the higher caps (found via voice-note
      // replay, 2026-08-19 — each bump only moved the truncation wall
      // further out, ~13.5k chars at 4000 tokens, ~20.5k chars at 6000).
      // 8000 is close to Haiku's practical max_tokens ceiling; a state that
      // still doesn't fit here is a real candidate for the (not yet built)
      // visual-planning layer's own summarization, not a bigger number.
      maxTokens: 8000,
      temperature: 0,
      onUsage,
    });
  } catch (err) {
    onStage?.onReconcileSkip?.("call-error", err instanceof Error ? err.message : String(err));
    return currentState;
  }
  if (!raw) {
    onStage?.onReconcileSkip?.("empty-response");
    return currentState;
  }

  let json: unknown;
  try {
    json = extractJson(raw);
  } catch (err) {
    onStage?.onReconcileSkip?.("unparseable-json", `${err instanceof Error ? err.message : String(err)} | raw: ${raw.slice(0, 500)}`);
    return currentState;
  }
  onStage?.onReconcilePreSanitize?.(json, raw);
  const sanitized = sanitizeForSchema(json);
  onStage?.onReconcilePostSanitize?.(sanitized);
  const parsed = SemanticStateSchema.safeParse(sanitized);
  if (!parsed.success) {
    onStage?.onReconcileSkip?.("schema-invalid", JSON.stringify(parsed.error.issues).slice(0, 500));
  }
  return parsed.success ? parsed.data : currentState;
}

/**
 * Orchestrates both stages. Same signature/behavior contract V1's
 * single-call version had (never throws, falls back to `currentState`
 * unchanged on any failure at any stage) — callers need no changes.
 *
 * `recentContext` is the rolling window of already-processed settled-thought
 * text lib/meaning/engine.ts maintains (oldest first) — separate from
 * `currentState` because it answers a different question: currentState is
 * "what do we believe," recentContext is "what was actually just said,
 * in order," which is what pronoun/vague-reference resolution needs.
 *
 * `onUsage` is called ONCE with the two stages' token counts summed — V1
 * had exactly one model call per round, so a caller's onUsage (e.g.
 * app/api/meaning/route.ts's billing reconciliation) expects exactly one
 * report per round too. Passing the same callback straight through to both
 * stage functions would fire it twice and let the second call's usage
 * silently overwrite (not add to) the first's, undercounting billed tokens
 * by roughly half every round.
 */
export async function decideMeaningCore(
  currentState: SemanticState,
  recentContext: string[],
  newText: string,
  onUsage?: (usage: CompletionUsage) => void,
  onStage?: DecideStageEvents,
): Promise<SemanticState> {
  const usages: CompletionUsage[] = [];
  const collect = onUsage ? (u: CompletionUsage) => usages.push(u) : undefined;

  const localMeaning = await extractLocalMeaning(
    recentContext,
    newText,
    currentState.topic,
    currentState.currentInterpretation,
    collect,
    onStage,
  );
  const result = await reconcileLocalMeaning(currentState, localMeaning, collect, onStage);

  if (onUsage && usages.length) {
    onUsage({
      providerRequestId: usages[usages.length - 1].providerRequestId,
      inputTokens: usages.reduce((sum, u) => sum + u.inputTokens, 0),
      outputTokens: usages.reduce((sum, u) => sum + u.outputTokens, 0),
      cacheCreationInputTokens: usages.reduce((sum, u) => sum + (u.cacheCreationInputTokens ?? 0), 0) || undefined,
      cacheReadInputTokens: usages.reduce((sum, u) => sum + (u.cacheReadInputTokens ?? 0), 0) || undefined,
    });
  }

  return result;
}
