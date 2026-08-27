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

import { complete, SCRIBE_MODEL, toOllamaFormat, type CompletionUsage } from "../../llm";
import { MeaningDeltaSchema, MeaningDeltaShape, EMPTY_MEANING_DELTA, type MeaningDelta } from "../schemas";

export const EXPRESSION_MODEL = process.env.EXPRESSION_MODEL || SCRIBE_MODEL;

export const EXTRACTION_SYSTEM_PROMPT = `You extract the meaning contained in one piece of speech or writing. You are not drawing anything and there is no canvas — never think about diagrams, boxes, arrows, layout, colour or position.

You will be given:
1. "recentContext": the few things said just before this, oldest first, as plain text. Use it ONLY to resolve pronouns ("she", "it", "they"), vague references ("the bigger thing"), and continuations. Do not re-extract what it already said — with ONE exception: when this text states a RELATION to something already mentioned, you must re-declare that earlier thing as an entity here, because a relation can only join two of THIS extraction's own local ids. Re-declare it with the same label it had before and nothing else; a deterministic system recognises it as the thing already known and does not duplicate it. An entity you re-declare only to carry a relation costs nothing; a relation you could not express is meaning permanently lost.
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
  - "metric": ONLY for spoken quantitative information about a NAMED thing being MEASURED — traffic, conversion, revenue, a price, a goal. This is completely different from "quantity" above: "quantity" counts how many of a THING there are ("six chairs" = a chairs entity with quantity 6, drawn as six marks); "metric" is a MEASUREMENT over time ("traffic went from 200 to 500") and must never also set "quantity" on the same entity — a metric's number is never a count of items to draw as marks.
      "unit": "count" | "percent" | "currency" | "ratio" — what kind of number this is.
      "currency": only when unit is "currency", e.g. "USD".
      "points": [{"value": N, "label": "optional time/category — 'last week', 'today', 'Q3'", "approximate": true when hedged}], oldest first. ONE metric entity can carry MULTIPLE points stated in the same breath — "traffic went from 200 to 500" is ONE traffic entity with points [{"value":200,"label":"before"},{"value":500,"label":"after"}], never two separate entities each containing one number. A later, separate mention of the same metric ("conversion is now 6%") is its own segment with its own one-point "metric" — a deterministic system appends it to what is already known; you never need to restate the earlier points.
      "target": {"value": N, ...} — a stated goal or threshold: "our target is 12% conversion".
      "direction": "increase" | "decrease" | "flat" — when the speaker states a trend without necessarily giving both numbers: "traffic increased", "conversion stayed flat".
      "changePercent": a stated relative change as a number — "revenue doubled" -> 100, "users fell by about 20%" -> -20. Independent of "points": give whichever the speaker actually stated, or both.
      "approximate" on individual points (not a separate top-level field) is how "around 500" / "roughly 10%" / "maybe $20k" survives — set it, do not round the number away or drop the hedge.
      Two metrics explicitly contrasted in the same breath ("traffic increased but conversion stayed flat") are still TWO separate metric entities — connect them with a "contrasts_with" relation exactly like any other contrast, so the deterministic layer can choose a two-metric comparison.
      You never choose how this looks — no chart type, no coordinates, no colours. That is entirely a deterministic decision made after you.

"relations" — how those entities stand to one another. Each has "source", "type", "target" using this extraction's own local ids. Choose the most specific type that is true:
  causes         A makes B happen
  enables        A makes B possible or easier (NOT the same as causes)
  prevents       A stops B
  depends_on     A requires B
  precedes       A happens before B in time. BOTH ends must be an action, event, state or time — never a person or object. "Priya joined last month" is a person, an event and a time, NOT a chain of three steps. Add "step": 0,1,2... for an ordered sequence.
      A step spoken as a CONTINUATION ("then you open the dashboard", "after that we deploy") is part of the run already under way. Re-declare the step it follows as an entity and emit the precedes relation to it. Saying only that this step exists, and leaving what it follows to be inferred, loses the ordering entirely — the step ends up beside the sequence instead of in it.
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
      COMPARE LIKE WITH LIKE. Both ends of contrasts_with, greater_than and less_than must be the SAME KIND of thing: a plan against a plan, a cost against a cost. "Plan A costs more than Plan B" compares two PLANS, so it is {plan-a, greater_than, plan-b}, never {plan-a-cost, greater_than, plan-b} — a cost and a plan are not comparable and that relation cannot be drawn.
      When someone weighs two things along one or more dimensions ("Plan A costs more but finishes twice as quickly as Plan B"), the things being compared are the two SUBJECTS. Relate the subjects to each other, and attach each measured dimension to the subject it belongs to with has_property. The contrast is between Plan A and Plan B; cost and speed are the dimensions it is measured on, not the things being set against each other.
      Only use a dimension as an end of a comparison when the speaker really is setting two dimensions against each other with no subjects in view ("speed matters more than cost").
      ALWAYS attach a measured or described dimension to whatever it is a dimension OF, using has_property. An attribute that is never linked to its subject leaves the subject with nothing said about it.
  equivalent_to  A equals B
  supports       A is evidence for B
  refutes        A is evidence against B
  wants          A wants, needs, intends or is trying to reach B — the thing desired, not the desire. "I want to build something new" is {source: speaker, type: wants, target: something-new}. Use it whenever someone states what they are after; it is the shape of most first-person speech, and a sentence that states a desire and emits no relation leaves two unconnected things on the page instead of a want.
  relates_to     last resort, only when nothing above is true

"claims" — meaning that is real but does not resolve into a relation between two named things: a reflection, an evaluation, a realisation, a feeling, a conclusion. {"text": "...", "about": ["localId"], "uncertain": true when the speaker hedged}. A claim is a normal, expected output — not a fallback for failure.
  "stance" — ONLY when this claim explicitly agrees or disagrees with something said earlier ("I agree", "that's not right", "I don't think that's true"): {"type": "agrees" or "disagrees", "targetSurface": "<your own words for what is being agreed or disputed, quoting or paraphrasing it using recentContext>"}. Like everywhere else, you are NEVER naming which earlier claim this is by id — targetSurface is a description in your own words, and a separate deterministic system matches it against what was actually said. A bare "I agree" with nothing else worth extracting still produces one claim: {"text": "agrees", "stance": {"type": "agrees", "targetSurface": "..."}}.

"topicEntityId" — the local id of the entity this text is mainly ABOUT.
"emphasisEntityIds" — local ids the speaker themselves stressed ("the big thing is...").
"supersededMentions" — the exact words for anything the speaker just took back or corrected ("actually, not the road").

"referenceMentions" — ONLY when the speaker points at something already discussed by POSITION or by TOPIC, not by name and not with an ordinary pronoun:
  ordinal        a position within a set of things already discussed: "the first one", "the second option", "the last idea", "the other one".
  topic_recall   a return to a topic, whether or not it is currently being discussed: "go back to X", "what we said earlier about X", "the original X".
  For each one, create ONE placeholder entity for it (type "concept", label = the phrase itself — e.g. a placeholder labelled "the second one"), then add a matching entry:
  {"entityId": "<that placeholder's local id>", "surface": "<the exact phrase spoken>", "kind": "ordinal" or "topic_recall",
   "ordinalIndex": 0-based position (0 = first, 1 = second, 2 = third...) — ordinal only, omit for "the last"/"the other",
   "ordinalFromEnd": true for "the last one" / "the last idea" — ordinal only,
   "ordinalOther": true for "the other one" — ordinal only. Set exactly one of ordinalIndex, ordinalFromEnd, ordinalOther.
   "topicHint": the words naming what is being recalled, e.g. "funding", "the pricing problem" — topic_recall only.
   "speakerHint": a speaker named in the recall itself, e.g. "Sarah" in "go back to what SARAH said about onboarding" — topic_recall only, omit when no speaker is named.}
  You are NEVER deciding what the reference points to — do not guess which earlier thing is meant, do not create a relation from the placeholder to anything, do not give it attributes. Name only the GRAMMAR of the pointer (position, or topic) and the exact words used; a separate deterministic system resolves it against everything already discussed, using information you were not given.
  A claim made ABOUT the reference ("the second one is probably safest") attaches normally via "about": ["<placeholder's local id>"] — it follows wherever the reference resolves.
  Ordinary pronouns ("it", "that", "she", "this") are NOT referenceMentions — extract those as ordinary entities, same as always.

"discourseActs" — ONLY when the speaker performs one of these six conversational revisions on something already discussed. A caption system only ever adds; these are how a thought system changes its mind, and they mean six different things — never collapse them into one generic "retraction":
  reject        the speaker no longer accepts or is proposing it: "actually, forget that", "never mind the creator idea".
  suspend       preserved, but pulled out of current focus, likely to return: "let's park that for now", "set that aside".
  deemphasize   still true, still valid, just no longer the priority: "that's not the main issue right now", "it matters less than I said".
  invalidate    the speaker says it is FALSE or WRONG — targets a CLAIM, not a thing: "no, that's wrong", "actually traffic doubled" (invalidating an earlier "traffic is low" claim).
  supersede     a new idea replaces an older one — pair with "supersededByLocalId": "actually make that $15" ($15 is a NEW entity in this same delta, replacing an earlier $20).
  reactivate    bring a suspended/rejected/archived idea back into consideration: "go back to fundraising", "let's reconsider bootstrapping".
  Each entry: {"type": "reject"|"suspend"|"deemphasize"|"invalidate"|"supersede"|"reactivate", "targetSurface": "<your own words for what this targets — an entity's description, or a claim's content for invalidate>", "supersededByLocalId": "<local id of the NEW entity, supersede only>"}.
  Same discipline as referenceMentions: you name the ACT and describe the TARGET in your own words — you never decide which world entity or claim that is. A deterministic system resolves targetSurface the same way it resolves every other free-text pointer in this schema, and if it cannot find a confident match, nothing changes rather than something changing wrong.
  Prefer discourseActs over "supersededMentions" whenever the speaker's intent is clearly one of these six — supersededMentions remains for a simple in-breath correction with no clear category ("not the road — the bridge").

"interpretation" — one sentence: what does this text mean?

Rules:
- Speech about oneself creates a person entity for the speaker, and that entity is labelled exactly "I" unless the speaker gives their own name, in which case it is labelled with the name. "My name is Kenny Farmer" -> a person labelled "Kenny Farmer"; "I want to start a company" -> a person labelled "I". Never label the speaker "the speaker", "me", "myself", "the narrator" or a description of them — a downstream system recognises "I" as the person talking and already has them; any other wording puts a second copy of the same person into the picture.
- Never invent anything the text does not support.
- Never merge two distinct new things into one vague entity, and never split one thing across two.
- Pure filler ("um", "so yeah") extracts to empty arrays and an empty interpretation. Being short, reflective or pronoun-heavy is NEVER by itself a reason to extract nothing.

Respond with ONLY one JSON object, no other text:
{"entities":[{"id":"...","type":"...","label":"...","description":"optional","quantity":{"value":1},"attributes":[{"key":"...","value":"..."}],"metric":{"unit":"percent","currency":"optional","points":[{"value":1,"label":"optional","approximate":false}],"target":{"value":1},"direction":"increase","changePercent":10}}],"relations":[{"source":"...","type":"...","target":"...","role":"optional","spatial":"optional","magnitude":1,"step":0}],"claims":[{"text":"...","about":["..."],"uncertain":false,"stance":{"type":"agrees","targetSurface":"optional"}}],"topicEntityId":"optional","emphasisEntityIds":[],"supersededMentions":[],"referenceMentions":[{"entityId":"...","surface":"...","kind":"ordinal","ordinalIndex":0,"ordinalFromEnd":false,"ordinalOther":false,"topicHint":"optional","speakerHint":"optional"}],"discourseActs":[{"type":"reject","targetSurface":"...","supersededByLocalId":"optional"}],"interpretation":"..."}`;

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

  const VALID_METRIC_UNITS = new Set(["count", "percent", "currency", "ratio"]);
  const VALID_METRIC_DIRECTIONS = new Set(["increase", "decrease", "flat"]);

  const sanitizeMetricPoint = (value: unknown): { value: number; label?: string; approximate?: boolean } | null => {
    const p = value as Record<string, unknown> | undefined;
    if (!p || typeof p !== "object" || !Number.isFinite(p.value)) return null;
    return {
      value: Number(p.value),
      label: typeof p.label === "string" ? p.label.slice(0, 40) : undefined,
      approximate: p.approximate === true ? true : undefined,
    };
  };

  /**
   * Validated proactively, the same discipline `quantity` right below
   * already uses: build a metric that is ALREADY guaranteed to pass
   * MetricSchema, rather than letting an invalid unit or direction fail the
   * whole entity's safeParse and lose its label/type along with it. `undefined`
   * (not a malformed object) is always a safe fallback — metric is optional.
   */
  const sanitizeMetric = (value: unknown): unknown => {
    const m = value as Record<string, unknown> | undefined;
    if (!m || typeof m !== "object" || !VALID_METRIC_UNITS.has(String(m.unit))) return undefined;
    const points = Array.isArray(m.points)
      ? m.points.map(sanitizeMetricPoint).filter((p): p is NonNullable<typeof p> => Boolean(p)).slice(0, 6)
      : [];
    const target = sanitizeMetricPoint(m.target) ?? undefined;
    const direction = VALID_METRIC_DIRECTIONS.has(String(m.direction)) ? m.direction : undefined;
    const changePercent = Number.isFinite(m.changePercent) ? Number(m.changePercent) : undefined;
    // A metric must say SOMETHING — but "our target is 12%" says it with no
    // fresh point at all, so points alone cannot be the gate. Mirrors
    // MetricSchema's own superRefine (lib/expression/schemas.ts).
    if (!points.length && !target && direction === undefined && changePercent === undefined) return undefined;
    return {
      unit: m.unit,
      currency: typeof m.currency === "string" ? m.currency.slice(0, 8) : undefined,
      points,
      target,
      direction,
      changePercent,
    };
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
      metric: sanitizeMetric(entity.metric),
    };
    const check = MeaningDeltaShape.shape.entities.element.safeParse(parsed);
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
    const check = MeaningDeltaShape.shape.relations.element.safeParse(parsed);
    if (check.success) relations.push(check.data);
  }

  const claims: MeaningDelta["claims"] = [];
  for (const [index, item] of (Array.isArray(raw.claims) ? raw.claims : []).entries()) {
    const claim = item as Record<string, unknown>;
    const text = typeof claim.text === "string" ? claim.text.trim().slice(0, 160) : "";
    if (!text) continue;
    const about = Array.isArray(claim.about) ? claim.about.map(resolve).filter((id): id is string => Boolean(id)) : [];
    // "I agree" / "that's not right" — same discipline as everywhere else:
    // the model names the GRAMMAR (agrees/disagrees) and its own words for
    // the target, never a claim id. A stance with no usable target text is
    // not a stance at all, so it is dropped rather than left to resolve
    // against nothing.
    const rawStance = claim.stance as Record<string, unknown> | undefined;
    const stanceTargetSurface = typeof rawStance?.targetSurface === "string" ? rawStance.targetSurface.trim().slice(0, 160) : "";
    const stance =
      rawStance && stanceTargetSurface && (rawStance.type === "agrees" || rawStance.type === "disagrees")
        ? { type: rawStance.type, targetSurface: stanceTargetSurface }
        : undefined;
    const check = MeaningDeltaShape.shape.claims.element.safeParse({
      id: `c${index}`,
      text,
      about: about.length ? about.slice(0, 5) : undefined,
      uncertain: claim.uncertain === true ? true : undefined,
      stance,
    });
    if (check.success) claims.push(check.data);
  }

  /**
   * "the second one", "go back to X" — the model names the placeholder
   * entity and the grammar of the pointer only; it never supplies a target.
   * `entityId` must resolve to one of THIS delta's own sanitised entities
   * (the same `resolve` used for topicEntityId/claim.about, which is exactly
   * the "one of our own local ids" check), or the mention is malformed and
   * dropped — never left dangling for the schema's cross-check to reject the
   * whole delta over one bad reference.
   */
  const referenceMentions: NonNullable<MeaningDelta["referenceMentions"]> = [];
  for (const item of Array.isArray(raw.referenceMentions) ? raw.referenceMentions : []) {
    const mention = item as Record<string, unknown>;
    const entityId = resolve(mention.entityId);
    if (!entityId) continue;
    const surface = typeof mention.surface === "string" ? mention.surface.trim().slice(0, 80) : "";
    if (!surface) continue;
    const parsed = {
      entityId,
      surface,
      kind: mention.kind,
      ordinalIndex: Number.isInteger(mention.ordinalIndex) && Number(mention.ordinalIndex) >= 0 ? Number(mention.ordinalIndex) : undefined,
      ordinalFromEnd: mention.ordinalFromEnd === true ? true : undefined,
      ordinalOther: mention.ordinalOther === true ? true : undefined,
      topicHint: typeof mention.topicHint === "string" ? mention.topicHint.slice(0, 80) : undefined,
      speakerHint: typeof mention.speakerHint === "string" ? mention.speakerHint.slice(0, 48) : undefined,
    };
    const check = MeaningDeltaShape.shape.referenceMentions.unwrap().element.safeParse(parsed);
    if (check.success) referenceMentions.push(check.data);
  }

  /**
   * "let's set that aside", "actually, forget the creator idea", "no,
   * that's wrong" — six distinct lifecycle transitions, named the same
   * discipline as referenceMentions: the model supplies the ACT and its own
   * words for the TARGET, never a world id. `supersededByLocalId` (supersede
   * only) goes through the same `resolve` as every other local-id field, so
   * it can only ever point at one of this delta's own entities.
   */
  const discourseActs: NonNullable<MeaningDelta["discourseActs"]> = [];
  for (const item of Array.isArray(raw.discourseActs) ? raw.discourseActs : []) {
    const act = item as Record<string, unknown>;
    const targetSurface = typeof act.targetSurface === "string" ? act.targetSurface.trim().slice(0, 160) : "";
    if (!targetSurface) continue;
    const parsed = {
      type: act.type,
      targetSurface,
      supersededByLocalId: act.type === "supersede" ? resolve(act.supersededByLocalId) ?? undefined : undefined,
    };
    const check = MeaningDeltaShape.shape.discourseActs.unwrap().element.safeParse(parsed);
    if (check.success) discourseActs.push(check.data);
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
    referenceMentions: referenceMentions.length ? referenceMentions.slice(0, 4) : undefined,
    discourseActs: discourseActs.length ? discourseActs.slice(0, 4) : undefined,
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
      // One cached block, and deliberately only this one. The prompt is
      // ~4k tokens of fixed instruction re-sent on every utterance in a
      // session, which is exactly what an ephemeral cache breakpoint is
      // for — and comfortably over the 2048-token minimum Haiku 4.5
      // enforces before it will cache anything at all. The user message
      // stays entirely dynamic: recentContext and text change every turn,
      // and putting either here would move the breakpoint and re-write the
      // cache on every call rather than read it.
      system: [
        { type: "text", text: EXTRACTION_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      user: JSON.stringify({ recentContext: recentContext.slice(-6), text }),
      maxTokens: 2000,
      temperature: 0,
      onUsage,
      jsonSchema: toOllamaFormat(MeaningDeltaSchema),
    });
  } catch {
    return EMPTY_MEANING_DELTA;
  }
  const json = extractJsonObject(raw);
  return json ? sanitizeDelta(json) : EMPTY_MEANING_DELTA;
}

/**
 * The seam every offline test and replay drives the pipeline through.
 *
 * `onUsage` is optional on both ends: a fixture extractor simply declares
 * two parameters and ignores it, and `extractMeaning` itself is assignable
 * as-is. It exists so the prompt-cache numbers reach the trace — nothing
 * downstream reads them, they are diagnostic only.
 */
export type MeaningExtractor = (
  text: string,
  recentContext: string[],
  onUsage?: (usage: CompletionUsage) => void,
) => Promise<MeaningDelta>;
