/**
 * The Expression Engine's ONE model call: text in, MeaningDelta out.
 *
 * This is the only place in the entire engine where a model is allowed to
 * make a decision, and its decision space is deliberately narrow: what does
 * this one utterance mean? Not what it should look like, not which diagram
 * suits it, not what is important, not how it relates to everything said
 * before. Every one of those is answered downstream, deterministically,
 * where it can be tested.
 *
 * Two rules the prompt enforces that matter more than the rest:
 *
 *  1. NO GEOMETRY, and nothing that smells like it. The schema has no field
 *     a coordinate could hide in, and the prompt never mentions drawing, so
 *     the model has neither the opportunity nor the framing to think in
 *     shapes.
 *
 *  2. EXTRACT IN ISOLATION. The model sees the last few things said (to
 *     resolve pronouns) but never the accumulated world graph. Handing it
 *     the graph biases it toward "does this support what we already
 *     believe" instead of "what does this actually say" — the failure that
 *     cost lib/meaning/decideCore.ts two thirds of the meaningful content
 *     in a real voice-note replay, and the reason that module was split
 *     into two stages. This engine avoids the failure by construction
 *     instead: reconciliation is not a prompt here, it is
 *     lib/expression/world/apply.ts.
 *
 * No `server-only` import, so scripts/expression-*.mjs can drive it
 * directly outside Next's build. app/api/express/route.ts is the only path
 * app code should use.
 */

import { complete, SCRIBE_MODEL, type CompletionUsage } from "../../llm";
import { MeaningDeltaSchema, EMPTY_MEANING_DELTA, type MeaningDelta } from "../schemas";

export const EXPRESSION_MODEL = process.env.EXPRESSION_MODEL || SCRIBE_MODEL;

export const EXTRACTION_SYSTEM_PROMPT = `You extract the meaning contained in one piece of speech or writing. You are not drawing anything and there is no canvas — never think about diagrams, boxes, arrows, layout, colour or position.

You will be given:
1. "recentContext": the few things said just before this, oldest first, as plain text. Use it ONLY to resolve pronouns ("she", "it", "they"), vague references ("the bigger thing"), and continuations. Do not re-extract what it already said.
2. "text": the new speech or writing. It may be an imperfect transcription — interpret the most plausible intended meaning rather than quoting odd wording back.

Extract:

"entities" — every distinct thing named or clearly implied. Each needs:
  - "id": a short kebab-case slug, unique within THIS extraction only.
  - "type": one of person, group, place, object, concept, action, event, state, time, quantity.
      person   a named or referenced individual
      group    a set of people or things taken as one ("my family", "the team")
      place    a location, region, country, room
      object   a physical thing
      concept  an idea, quality, abstraction — also the honest fallback when nothing else fits
      action   something someone does
      event    something that happens
      state    a condition something is in ("frozen", "liquid")
      time     a moment or period
      quantity a number treated as a thing in its own right
  - "label": a NAME of 1-4 words, never a sentence. Put any clause in "description".
  - "quantity": {"value": N, "unit": "optional"} whenever a number is stated about it. "A family of five" is ONE group entity with quantity 5 — not five person entities.
  - "attributes": [{"key":"...","value":"..."}] for stated properties that are not worth their own entity ("occupation":"teacher").

"relations" — how those entities stand to one another. Each has "source", "type", "target" using this extraction's own local ids. Choose the most specific type that is true:
  causes         A makes B happen
  enables        A makes B possible or easier (NOT the same as causes)
  prevents       A stops B
  depends_on     A requires B
  precedes       A happens before B in time. BOTH ends must be an action, event, state or time — never a person or object. "Priya joined last month" is a person, an event and a time, NOT a chain of three steps. Add "step": 0,1,2... for an ordered sequence.
  transforms_into A becomes B (state change)
  contains       A has B as a part or member
  part_of        A is part of B
  member_of      A is a member of the group B
  instance_of    A is an example of category B
  has_property   A has the quality B
  role_of        A holds a named role toward B — ALSO set "role" ("mother", "teacher", "founder"). "My mother is Mariam" is {source: mariam, type: role_of, role: "mother", target: speaker}.
  originates_from A comes from place B
  located_at     A is positioned at/near B — ALSO set "spatial": near|beside|above|below|behind|in_front_of|inside|on
  contrasts_with A is being set against B
  greater_than / less_than  A exceeds / falls short of B — set "magnitude" when stated ("twice as fast" -> 2)
  equivalent_to  A equals B
  supports       A is evidence for B
  refutes        A is evidence against B
  relates_to     last resort, only when nothing above is true

"claims" — meaning that is real but does not resolve into a relation between two named things: a reflection, an evaluation, a realisation, a feeling, a conclusion. {"text": "...", "about": ["localId"], "uncertain": true when the speaker hedged}. A claim is a normal, expected output — not a fallback for failure.

"topicEntityId" — the local id of the entity this text is mainly ABOUT.
"emphasisEntityIds" — local ids the speaker themselves stressed ("the big thing is...").
"supersededMentions" — the exact words for anything the speaker just took back or corrected ("actually, not the road").
"interpretation" — one sentence: what does this text mean?

Rules:
- Speech about oneself creates a person entity for the speaker. "My name is Kenny Farmer" -> a person labelled "Kenny Farmer".
- Never invent anything the text does not support.
- Never merge two distinct new things into one vague entity, and never split one thing across two.
- Pure filler ("um", "so yeah") extracts to empty arrays and an empty interpretation. Being short, reflective or pronoun-heavy is NEVER by itself a reason to extract nothing.

Respond with ONLY one JSON object, no other text:
{"entities":[{"id":"...","type":"...","label":"...","description":"optional","quantity":{"value":1},"attributes":[{"key":"...","value":"..."}]}],"relations":[{"source":"...","type":"...","target":"...","role":"optional","spatial":"optional","magnitude":1,"step":0}],"claims":[{"text":"...","about":["..."],"uncertain":false}],"topicEntityId":"optional","emphasisEntityIds":[],"supersededMentions":[],"interpretation":"..."}`;

/**
 * Pulls the first balanced JSON object out of a response. Models sometimes
 * wrap JSON in prose or a code fence despite instructions; discarding the
 * whole round for that would throw away real meaning over punctuation.
 */
export function extractJsonObject(raw: string): unknown | null {
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

/**
 * Repairs what a model plausibly gets slightly wrong, without inventing
 * meaning: slugs ids, drops relations whose endpoints do not exist, clears
 * fields that do not apply to the chosen relation type. Anything that
 * cannot be repaired is dropped rather than guessed — a dropped relation
 * costs one edge, a guessed one corrupts the world.
 */
export function sanitizeDelta(input: unknown): MeaningDelta {
  if (!input || typeof input !== "object") return EMPTY_MEANING_DELTA;
  const raw = input as Record<string, unknown>;

  const slug = (value: unknown, fallback: string): string => {
    const text = typeof value === "string" ? value : "";
    const cleaned = text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    return /^[a-z]/.test(cleaned) ? cleaned : fallback;
  };

  const entities: MeaningDelta["entities"] = [];
  const idMap = new Map<string, string>();
  for (const [index, item] of (Array.isArray(raw.entities) ? raw.entities : []).entries()) {
    const entity = item as Record<string, unknown>;
    const label = typeof entity.label === "string" ? entity.label.trim().slice(0, 60) : "";
    if (!label) continue;
    const id = slug(entity.id ?? label, `e${index}`);
    idMap.set(String(entity.id ?? ""), id);
    const parsed = {
      id,
      type: entity.type,
      label,
      description: typeof entity.description === "string" ? entity.description.slice(0, 160) : undefined,
      quantity:
        entity.quantity && typeof entity.quantity === "object" && Number.isFinite((entity.quantity as { value?: unknown }).value)
          ? {
              value: Number((entity.quantity as { value: number }).value),
              unit: typeof (entity.quantity as { unit?: unknown }).unit === "string" ? String((entity.quantity as { unit: string }).unit).slice(0, 24) : undefined,
            }
          : undefined,
      attributes: Array.isArray(entity.attributes)
        ? entity.attributes
            .filter((a): a is { key: string; value: string } => Boolean(a) && typeof (a as { key?: unknown }).key === "string" && typeof (a as { value?: unknown }).value === "string")
            .slice(0, 8)
            .map((a) => ({ key: a.key.slice(0, 32), value: a.value.slice(0, 80) }))
        : undefined,
    };
    const check = MeaningDeltaSchema.shape.entities.element.safeParse(parsed);
    if (check.success) entities.push(check.data);
  }

  const known = new Set(entities.map((e) => e.id));
  const resolve = (value: unknown): string | null => {
    const direct = idMap.get(String(value ?? ""));
    if (direct && known.has(direct)) return direct;
    const slugged = slug(value, "");
    return slugged && known.has(slugged) ? slugged : null;
  };

  /**
   * `precedes` is a claim about time, so both ends must be something that
   * can happen. A live run produced "Priya precedes joining precedes last
   * month" from "Priya joined last month" — a nonsense chain that then
   * pinned the intent classifier to `show_sequence` for the rest of the
   * conversation. The prompt discourages it; this enforces it, because a
   * type rule that can be checked should never be left to a prompt.
   */
  const typeOf = new Map(entities.map((e) => [e.id, e.type]));
  const CANNOT_PRECEDE = new Set(["person", "group", "place"]);

  const relations: MeaningDelta["relations"] = [];
  for (const [index, item] of (Array.isArray(raw.relations) ? raw.relations : []).entries()) {
    const relation = item as Record<string, unknown>;
    const source = resolve(relation.source);
    const target = resolve(relation.target);
    if (!source || !target || source === target) continue;
    if (relation.type === "precedes" && (CANNOT_PRECEDE.has(typeOf.get(source)!) || CANNOT_PRECEDE.has(typeOf.get(target)!))) continue;
    const parsed = {
      id: `r${index}`,
      source,
      target,
      type: relation.type,
      role: relation.type === "role_of" && typeof relation.role === "string" ? relation.role.slice(0, 32) : undefined,
      spatial: relation.type === "located_at" ? relation.spatial : undefined,
      magnitude: Number.isFinite(relation.magnitude) ? Number(relation.magnitude) : undefined,
      step: Number.isInteger(relation.step) && Number(relation.step) >= 0 ? Number(relation.step) : undefined,
    };
    const check = MeaningDeltaSchema.shape.relations.element.safeParse(parsed);
    if (check.success) relations.push(check.data);
  }

  const claims: MeaningDelta["claims"] = [];
  for (const [index, item] of (Array.isArray(raw.claims) ? raw.claims : []).entries()) {
    const claim = item as Record<string, unknown>;
    const text = typeof claim.text === "string" ? claim.text.trim().slice(0, 160) : "";
    if (!text) continue;
    const about = Array.isArray(claim.about) ? claim.about.map(resolve).filter((id): id is string => Boolean(id)) : [];
    const check = MeaningDeltaSchema.shape.claims.element.safeParse({
      id: `c${index}`,
      text,
      about: about.length ? about.slice(0, 5) : undefined,
      uncertain: claim.uncertain === true ? true : undefined,
    });
    if (check.success) claims.push(check.data);
  }

  const delta = {
    entities,
    relations,
    claims,
    topicEntityId: resolve(raw.topicEntityId) ?? undefined,
    emphasisEntityIds: Array.isArray(raw.emphasisEntityIds)
      ? raw.emphasisEntityIds.map(resolve).filter((id): id is string => Boolean(id)).slice(0, 4)
      : undefined,
    supersededMentions: Array.isArray(raw.supersededMentions)
      ? raw.supersededMentions.filter((m): m is string => typeof m === "string").map((m) => m.slice(0, 60)).slice(0, 4)
      : undefined,
    interpretation: typeof raw.interpretation === "string" ? raw.interpretation.slice(0, 240) : "",
  };
  const parsed = MeaningDeltaSchema.safeParse(delta);
  return parsed.success ? parsed.data : EMPTY_MEANING_DELTA;
}

/**
 * Never throws. Any failure — network, parse, schema — resolves to an empty
 * delta, which the world model folds in as "nothing changed". A pipeline
 * hiccup must never erase what InPublic already understood.
 */
export async function extractMeaning(
  text: string,
  recentContext: string[] = [],
  onUsage?: (usage: CompletionUsage) => void,
): Promise<MeaningDelta> {
  if (!text.trim()) return EMPTY_MEANING_DELTA;
  let raw = "";
  try {
    raw = await complete({
      model: EXPRESSION_MODEL,
      system: EXTRACTION_SYSTEM_PROMPT,
      user: JSON.stringify({ recentContext: recentContext.slice(-6), text }),
      maxTokens: 2000,
      temperature: 0,
      onUsage,
    });
  } catch {
    return EMPTY_MEANING_DELTA;
  }
  const json = extractJsonObject(raw);
  return json ? sanitizeDelta(json) : EMPTY_MEANING_DELTA;
}

/** The seam every offline test and replay drives the pipeline through. */
export type MeaningExtractor = (text: string, recentContext: string[]) => Promise<MeaningDelta>;
