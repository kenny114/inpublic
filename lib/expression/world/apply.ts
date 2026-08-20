/**
 * The world model: fold one MeaningDelta into the persistent WorldState.
 *
 * Entirely deterministic — no model call. This is deliberate and is the
 * single most important boundary in the engine. The extractor's job is to
 * say what one utterance means, in isolation, with local ids it invented
 * for that utterance alone. Deciding whether "she" is the Mariam we already
 * know, whether "the family" is the group we already counted, and whether a
 * second mention of Kenny is the same Kenny, is NOT an extraction question
 * — it is a question about accumulated state, and answering it here means
 * it is testable, replayable and identical every run.
 *
 * Three things this module owns:
 *
 *  1. IDENTITY. A local entity is matched against the world by pronoun
 *     resolution, then alias/label equality, then name subsumption
 *     ("Mariam" is the "Mariam Farmer" we know). Only an unmatched entity
 *     mints a new global id. Global ids never change once minted, because
 *     everything downstream — scene object identity, the render patch, the
 *     "don't wipe the board" guarantee — hangs off them.
 *
 *  2. LIFECYCLE. Matched entities are UPDATED in place (labels sharpen,
 *     attributes accumulate, aliases remember every surface form used).
 *     Retracted entities are marked superseded, never deleted, so the
 *     revision remains inspectable.
 *
 *  3. IMPORTANCE. Recomputed from the whole graph every round rather than
 *     taken from the extractor, because importance is a property of the
 *     conversation, not of the sentence that happened to introduce a thing.
 *     A person mentioned once in passing who later turns out to be the
 *     subject of everything should become primary without anyone restating
 *     them.
 */

import {
  type Entity,
  type EntityType,
  type MeaningDelta,
  type Relation,
  type RelationType,
  type WorldClaim,
  type WorldEntity,
  type WorldOp,
  type WorldRelation,
  type WorldState,
} from "../schemas";

const MAX_SALIENCE = 16;
const MAX_ALIASES = 12;

export interface ApplyResult {
  world: WorldState;
  ops: WorldOp[];
  /** local delta id -> global world id, for callers that need to follow one round's entities down the pipeline. */
  idMap: Map<string, string>;
}

// ───────────────────────────────────────────────────── normalisation

/** Leading determiners and possessives carry no identity — "my mother" and "the mother" name the same role. */
const LEADING_NOISE = /^(the|a|an|my|our|your|his|her|their|its|this|that|these|those)\s+/i;

export function normalizeMention(text: string): string {
  let out = text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, " ");
  let prev = "";
  while (prev !== out) {
    prev = out;
    out = out.replace(LEADING_NOISE, "");
  }
  return out.replace(/\s+/g, " ").trim();
}

export function slugify(text: string): string {
  const slug = normalizeMention(text)
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return /^[a-z]/.test(slug) ? slug : `e-${slug}` .slice(0, 40);
}

/**
 * Pronouns and bare references, mapped to the entity types they can refer
 * to. This is a closed grammatical class, not a knowledge base — the list
 * is about English function words, and every one of them resolves to
 * whichever recently-mentioned entity of a compatible type is most salient.
 */
const PRONOUN_TYPES: Record<string, EntityType[]> = {
  i: ["person"],
  me: ["person"],
  we: ["group", "person"],
  us: ["group", "person"],
  you: ["person", "group"],
  he: ["person"],
  him: ["person"],
  she: ["person"],
  her: ["person"],
  they: ["group", "person"],
  them: ["group", "person"],
  it: ["object", "concept", "place", "event", "state", "action"],
  this: ["concept", "object", "event", "state", "action"],
  that: ["concept", "object", "event", "state", "action"],
  there: ["place"],
  here: ["place"],
};

function pronounTypes(label: string): EntityType[] | null {
  return PRONOUN_TYPES[normalizeMention(label)] ?? null;
}

/**
 * Types that are near enough to be the same thing.
 *
 * Found live: "traffic" was extracted as a `state` in one sentence and an
 * `event` in the next, so the world minted a second entity and the causal
 * chain silently split in two — rain → flooding → traffic, and a separate
 * traffic → being late. The picture then showed only the longer half. The
 * evaluator caught it (`missing_entity`, preservation 0.7), but the damage
 * was done in identity resolution.
 *
 * Exact type equality is too strict for a model that has to pick one label
 * from a menu of near-synonyms. Traffic genuinely IS both a state and an
 * event; which one gets chosen is a coin flip that should not fork the
 * world. So compatibility is by family, not by exact type.
 *
 * Kept deliberately narrow across families: a `place` named "Washington" and
 * a `person` named "Washington" are a distinction worth preserving, and this
 * is only ever consulted once the surface forms already match — so a wrong
 * merge needs both the same name AND the same family.
 */
const TYPE_FAMILY: Record<EntityType, string> = {
  action: "occurrence",
  event: "occurrence",
  state: "occurrence",
  time: "occurrence",
  person: "animate",
  group: "animate",
  object: "physical",
  place: "physical",
  concept: "abstract",
  quantity: "abstract",
};

function typesCompatible(a: EntityType, b: EntityType): boolean {
  // `concept` is the extractor's honest "I could not categorise this", so it
  // matches anything that does have a category.
  if (a === "concept" || b === "concept") return true;
  return a === b || TYPE_FAMILY[a] === TYPE_FAMILY[b];
}

function tokens(text: string): string[] {
  return normalizeMention(text).split(" ").filter(Boolean);
}

/**
 * Proper names only — every token capitalised, and not a single letter.
 *
 * This gate is what stops subsumption from eating the language. "Mariam"
 * and "Mariam Farmer" are the same person; "trust" and "building trust" are
 * two different things, and an early version of this matcher merged them,
 * silently deleting one of the two ideas the speaker was contrasting. Token
 * containment is only evidence of identity for names.
 */
function isProperName(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  return words.every((word) => /^[A-Z]/.test(word) && word.length > 1);
}

/** "Mariam" names the same person as "Mariam Farmer": one name's tokens contain the other's. */
function subsumes(a: string, b: string): boolean {
  if (!isProperName(a) || !isProperName(b)) return false;
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.length === long.length) return false;
  return short.every((t) => long.includes(t));
}

// ──────────────────────────────────────────────────────── matching

function isActive(entity: WorldEntity): boolean {
  return entity.status !== "superseded";
}

/**
 * Relation types that hold at most ONE value between an ordered pair.
 *
 * Two people have one kinship role toward each other at a time; a thing
 * comes from one place; an object sits in one arrangement relative to
 * another; a state becomes one next state. So a second assertion of the same
 * type about the same pair is a correction, not an addition.
 *
 * Everything absent from this set is genuinely multi-valued and accumulates:
 * one thing can cause several others, contain several others, and support
 * several claims at once.
 */
const SINGLE_VALUED = new Set<RelationType>(["role_of", "originates_from", "located_at", "transforms_into"]);

/**
 * Types that cannot both be true of the same ordered pair. Asserting one
 * retires the other, because leaving both would put a contradiction on the
 * canvas and let the composer pick whichever it happened to reach first.
 */
const CONTRADICTS: Partial<Record<RelationType, RelationType[]>> = {
  causes: ["prevents"],
  prevents: ["causes", "enables"],
  enables: ["prevents"],
  greater_than: ["less_than", "equivalent_to"],
  less_than: ["greater_than", "equivalent_to"],
  equivalent_to: ["greater_than", "less_than"],
  supports: ["refutes"],
  refutes: ["supports"],
};

/** Does asserting `incoming` between this pair retire the existing relation? */
function supersedesRelation(existing: WorldRelation, incoming: Relation, source: string, target: string): boolean {
  if (existing.source !== source || existing.target !== target) return false;
  if (existing.type === incoming.type) {
    // Same type, same pair: only a single-valued type replaces, and only when
    // the value actually differs (otherwise this is an ordinary re-mention).
    return SINGLE_VALUED.has(incoming.type) && (existing.role ?? "") !== (incoming.role ?? "");
  }
  return (CONTRADICTS[incoming.type] ?? []).includes(existing.type);
}

/** Salience order first, then recency — the antecedent a listener would pick. */
function bySalience(world: WorldState): WorldEntity[] {
  const rank = new Map(world.salience.map((id, i) => [id, i]));
  return [...world.entities]
    .filter(isActive)
    .sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999) || b.lastTouchedSeq - a.lastTouchedSeq);
}

/**
 * Resolve a surface form (a label, or a bare mention from
 * `supersededMentions`) to an existing entity, or null for something new.
 * `type` narrows the search when the caller knows it; pass null for a bare
 * mention where only the words are available.
 */
export function resolveMention(world: WorldState, mention: string, type: EntityType | null): WorldEntity | null {
  const normalized = normalizeMention(mention);
  if (!normalized) return null;
  const ordered = bySalience(world);

  const pronoun = pronounTypes(mention);
  if (pronoun) {
    return ordered.find((e) => pronoun.includes(e.type)) ?? null;
  }

  const exact = ordered.find(
    (e) => (normalizeMention(e.label) === normalized || e.aliases.includes(normalized)) && (!type || typesCompatible(e.type, type)),
  );
  if (exact) return exact;

  const subsumed = ordered.find((e) => subsumes(e.label, mention) && (!type || typesCompatible(e.type, type)));
  if (subsumed) return subsumed;

  // Definite anaphora: "that team" after "the data team", "the company"
  // after "Kepler Company". English noun phrases are head-final, so a
  // determiner plus a bare head noun refers back to whichever salient thing
  // ends with that head. Gated on the determiner being present — without it
  // this would merge every noun that happens to share a last word.
  if (LEADING_NOISE.test(mention.trim())) {
    const headMatch = ordered.find((e) => {
      if (type && !typesCompatible(e.type, type)) return false;
      const label = normalizeMention(e.label);
      if (label === normalized) return false;
      return label.endsWith(` ${normalized}`);
    });
    if (headMatch) return headMatch;
  }

  return null;
}

// ──────────────────────────────────────────────────────── merging

function mergeAliases(existing: string[], ...added: string[]): string[] {
  const out = [...existing];
  for (const alias of added) {
    const normalized = normalizeMention(alias);
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out.slice(-MAX_ALIASES);
}

/**
 * A later mention sharpens a label rather than replacing it: a proper name
 * beats a description, and a longer name beats a shorter one it contains
 * ("Mariam" -> "Mariam Farmer"), but an incidental re-reference ("she")
 * never overwrites a name we already have.
 */
function sharperLabel(current: string, incoming: string): string {
  if (pronounTypes(incoming)) return current;
  if (normalizeMention(current) === normalizeMention(incoming)) return current;
  if (subsumes(current, incoming) && tokens(incoming).length > tokens(current).length) return incoming;
  if (pronounTypes(current)) return incoming;
  return current;
}

function mergeEntity(existing: WorldEntity, incoming: Entity, seq: number): WorldEntity {
  const attributes = [...(existing.attributes ?? [])];
  for (const attr of incoming.attributes ?? []) {
    const at = attributes.findIndex((a) => a.key === attr.key);
    if (at >= 0) attributes[at] = attr;
    else attributes.push(attr);
  }
  return {
    ...existing,
    // A concrete type always beats the `concept` fallback, whichever side holds it.
    type: existing.type === "concept" && incoming.type !== "concept" ? incoming.type : existing.type,
    label: sharperLabel(existing.label, incoming.label),
    description: incoming.description ?? existing.description,
    quantity: incoming.quantity ?? existing.quantity,
    attributes: attributes.length ? attributes.slice(0, 8) : undefined,
    confidence: incoming.confidence ?? existing.confidence,
    aliases: mergeAliases(existing.aliases, incoming.label),
    lastTouchedSeq: seq,
  };
}

function entityChanged(a: WorldEntity, b: WorldEntity): boolean {
  return (
    a.label !== b.label ||
    a.type !== b.type ||
    a.description !== b.description ||
    JSON.stringify(a.quantity ?? null) !== JSON.stringify(b.quantity ?? null) ||
    JSON.stringify(a.attributes ?? []) !== JSON.stringify(b.attributes ?? []) ||
    a.importance !== b.importance ||
    a.status !== b.status
  );
}

function uniqueId(base: string, taken: Set<string>): string {
  const root = base || "thing";
  if (!taken.has(root)) return root;
  for (let i = 2; i < 100; i += 1) {
    const candidate = `${root}-${i}`.slice(0, 48);
    if (!taken.has(candidate)) return candidate;
  }
  return `${root}-${taken.size}`.slice(0, 48);
}

// ─────────────────────────────────────────────────────── importance

/**
 * Importance is recomputed for the whole world every round from structure
 * and recency, never carried over from the extractor. Degree dominates
 * because a thing everything else connects to IS the subject, whatever
 * order it happened to be mentioned in; recency breaks ties so a talk that
 * moves on doesn't stay anchored on its first sentence forever.
 */
function recomputeImportance(entities: WorldEntity[], relations: WorldRelation[], seq: number): WorldEntity[] {
  const degree = new Map<string, number>(entities.map((e) => [e.id, 0]));
  for (const rel of relations) {
    degree.set(rel.source, (degree.get(rel.source) ?? 0) + 1);
    degree.set(rel.target, (degree.get(rel.target) ?? 0) + 1);
  }
  const scored = entities
    .filter(isActive)
    .map((e) => ({
      id: e.id,
      score: (degree.get(e.id) ?? 0) * 3 + (e.lastTouchedSeq === seq ? 2 : 0) + (e.quantity ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score);

  const primaryId = scored.length && scored[0].score > 0 ? scored[0].id : scored[0]?.id;
  return entities.map((entity) => {
    if (!isActive(entity)) return { ...entity, importance: "detail" as const };
    if (entity.id === primaryId) return { ...entity, importance: "primary" as const };
    const d = degree.get(entity.id) ?? 0;
    return { ...entity, importance: d >= 1 ? ("supporting" as const) : ("detail" as const) };
  });
}

// ──────────────────────────────────────────────────────────── apply

/**
 * Fold one delta into the world. Never throws and never returns a world
 * that would fail WorldStateSchema — a relation whose endpoints could not
 * be resolved is dropped rather than being allowed to dangle, because a
 * half-attached edge is worse than a missing one: the composer would draw
 * it pointing at nothing.
 */
export function applyDelta(world: WorldState, delta: MeaningDelta, seq: number): ApplyResult {
  const ops: WorldOp[] = [];
  const idMap = new Map<string, string>();
  let entities = [...world.entities];
  const taken = new Set(entities.map((e) => e.id));
  const touched: string[] = [];

  // ---- entities ---------------------------------------------------
  for (const local of delta.entities) {
    const match = resolveMention({ ...world, entities }, local.label, local.type);
    if (match) {
      idMap.set(local.id, match.id);
      const merged = mergeEntity(match, local, seq);
      const at = entities.findIndex((e) => e.id === match.id);
      entities[at] = merged;
      if (entityChanged(match, merged)) ops.push({ kind: "UPDATE_ENTITY", entity: merged, prev: match });
      touched.push(match.id);
      continue;
    }
    // An unresolvable pronoun names something we have never heard of; it
    // would become a nameless box, so it is dropped rather than invented.
    if (pronounTypes(local.label)) continue;

    const id = uniqueId(slugify(local.label), taken);
    taken.add(id);
    const created: WorldEntity = {
      ...local,
      id,
      status: "active",
      importance: "supporting",
      firstSeenSeq: seq,
      lastTouchedSeq: seq,
      aliases: mergeAliases([], local.label),
    };
    entities.push(created);
    idMap.set(local.id, id);
    ops.push({ kind: "ADD_ENTITY", entity: created });
    touched.push(id);
  }

  // ---- retractions ------------------------------------------------
  for (const mention of delta.supersededMentions ?? []) {
    const match = resolveMention({ ...world, entities }, mention, null);
    if (!match || match.status === "superseded") continue;
    const at = entities.findIndex((e) => e.id === match.id);
    entities[at] = { ...match, status: "superseded", lastTouchedSeq: seq };
    ops.push({ kind: "SUPERSEDE_ENTITY", entityId: match.id });
  }

  // ---- relations --------------------------------------------------
  let relations = [...world.relations];
  const relationIds = new Set(relations.map((r) => r.id));
  const activeIds = new Set(entities.map((e) => e.id));

  /** A local endpoint is either one of this delta's own entities, or a bare mention of something already known. */
  const resolveEndpoint = (localId: string): string | null => {
    const mapped = idMap.get(localId);
    if (mapped) return mapped;
    const match = resolveMention({ ...world, entities }, localId.replace(/[-_]/g, " "), null);
    return match ? match.id : null;
  };

  for (const local of delta.relations) {
    const source = resolveEndpoint(local.source);
    const target = resolveEndpoint(local.target);
    if (!source || !target || source === target) continue;
    if (!activeIds.has(source) || !activeIds.has(target)) continue;

    // A later statement about the same pair can REPLACE an earlier one rather
    // than sit beside it — see SINGLE_VALUED and CONTRADICTS. This is what
    // makes "John is Sarah's brother… actually, her cousin" a correction
    // instead of a claim that he is both.
    const superseded = relations.filter((r) => supersedesRelation(r, local, source, target));
    for (const stale of superseded) {
      ops.push({ kind: "REMOVE_RELATION", relationId: stale.id });
    }
    if (superseded.length) {
      const staleIds = new Set(superseded.map((r) => r.id));
      relations = relations.filter((r) => !staleIds.has(r.id));
    }

    const existing = relations.find(
      (r) => r.source === source && r.target === target && r.type === local.type && (r.role ?? "") === (local.role ?? ""),
    );
    if (existing) {
      const merged: WorldRelation = {
        ...existing,
        spatial: local.spatial ?? existing.spatial,
        magnitude: local.magnitude ?? existing.magnitude,
        step: local.step ?? existing.step,
        confidence: local.confidence ?? existing.confidence,
        lastTouchedSeq: seq,
      };
      relations[relations.indexOf(existing)] = merged;
      if (JSON.stringify({ ...existing, lastTouchedSeq: 0 }) !== JSON.stringify({ ...merged, lastTouchedSeq: 0 })) {
        ops.push({ kind: "UPDATE_RELATION", relation: merged, prev: existing });
      }
      continue;
    }

    const id = uniqueId(`${source}-${local.type}-${target}`.slice(0, 44), relationIds);
    relationIds.add(id);
    const created: WorldRelation = {
      ...local,
      id,
      source,
      target,
      firstSeenSeq: seq,
      lastTouchedSeq: seq,
    };
    relations.push(created);
    ops.push({ kind: "ADD_RELATION", relation: created });
  }

  // A superseded entity's relations go with it — leaving them would let the
  // composer draw edges into a thing the speaker has taken back.
  const supersededIds = new Set(entities.filter((e) => !isActive(e)).map((e) => e.id));
  if (supersededIds.size) {
    const survivors = relations.filter((r) => !supersededIds.has(r.source) && !supersededIds.has(r.target));
    for (const dropped of relations.filter((r) => !survivors.includes(r))) {
      ops.push({ kind: "REMOVE_RELATION", relationId: dropped.id });
    }
    relations = survivors;
  }

  // ---- claims -----------------------------------------------------
  let claims = [...world.claims];
  const claimIds = new Set(claims.map((c) => c.id));
  for (const local of delta.claims) {
    const about = (local.about ?? []).map(resolveEndpoint).filter((id): id is string => Boolean(id) && activeIds.has(id!));
    const normalized = local.text.trim().toLowerCase();
    const existing = claims.find((c) => c.text.trim().toLowerCase() === normalized);
    if (existing) {
      const merged: WorldClaim = {
        ...existing,
        about: about.length ? [...new Set([...(existing.about ?? []), ...about])].slice(0, 5) : existing.about,
        uncertain: local.uncertain ?? existing.uncertain,
        lastTouchedSeq: seq,
      };
      claims[claims.indexOf(existing)] = merged;
      if (JSON.stringify(existing.about ?? []) !== JSON.stringify(merged.about ?? [])) {
        ops.push({ kind: "UPDATE_CLAIM", claim: merged, prev: existing });
      }
      continue;
    }
    const id = uniqueId(slugify(local.text).slice(0, 32) || "claim", claimIds);
    claimIds.add(id);
    const created: WorldClaim = {
      id,
      text: local.text,
      about: about.length ? about.slice(0, 5) : undefined,
      uncertain: local.uncertain,
      confidence: local.confidence,
      importance: "supporting",
      firstSeenSeq: seq,
      lastTouchedSeq: seq,
    };
    claims.push(created);
    ops.push({ kind: "ADD_CLAIM", claim: created });
  }
  claims = claims.filter((c) => !(c.about ?? []).some((id) => supersededIds.has(id)) || !(c.about ?? []).length);

  // ---- importance + salience --------------------------------------
  const before = new Map(entities.map((e) => [e.id, e]));
  entities = recomputeImportance(entities, relations, seq);
  for (const entity of entities) {
    const prev = before.get(entity.id);
    if (!prev || prev.importance === entity.importance) continue;
    // An importance change with no other change is still worth an op: it is
    // how "this turned out to be the main thing" reaches the composer.
    const alreadyReported = ops.some(
      (op) => (op.kind === "ADD_ENTITY" || op.kind === "UPDATE_ENTITY") && op.entity.id === entity.id,
    );
    if (!alreadyReported) ops.push({ kind: "UPDATE_ENTITY", entity, prev });
  }

  // Salience is ordered by RECENCY OF MENTION first, and only then by topic.
  //
  // The other way round is what a first version did, and it broke the
  // commonest pronoun in the corpus. "I have a family of five. My mother's
  // name is Mariam. She is a teacher." — said as one utterance, the topic is
  // Kenny, so a topic-first stack resolved "she" to Kenny and hung the
  // teaching on the wrong person. Said as three utterances the topic was
  // Mariam and it worked, which is the worst kind of bug: correct in the
  // test that is easy to write, wrong in the mode that ships.
  //
  // A listener resolves a pronoun to the nearest compatible antecedent, not
  // to whatever the paragraph is broadly about. `touched` is mention order,
  // so reversing it puts the nearest mention first. The topic still follows,
  // which is what resolves "it" and "that" against a subject that was not
  // re-mentioned this round.
  const topicId = delta.topicEntityId ? idMap.get(delta.topicEntityId) ?? null : null;
  const salience = [...new Set([...touched.reverse(), ...(topicId ? [topicId] : []), ...world.salience])]
    .filter((id) => entities.some((e) => e.id === id && isActive(e)))
    .slice(0, MAX_SALIENCE);

  return {
    world: {
      topic: world.topic,
      interpretation: delta.interpretation || world.interpretation,
      entities,
      relations,
      claims,
      salience,
      seq: Math.max(world.seq, seq),
    },
    ops,
    idMap,
  };
}

/** Human-readable one-liner per op — the debug panel's "what changed" column. */
export function describeWorldOp(op: WorldOp): string {
  switch (op.kind) {
    case "ADD_ENTITY":
      return `+ ${op.entity.type} "${op.entity.label}"`;
    case "UPDATE_ENTITY": {
      // Name the fields that actually changed. Printing label and importance
      // unconditionally produced lines like `"Kenny Farmer" -> "Kenny Farmer"
      // (primary -> primary)` for a round that really did change something
      // else, which is worse than useless in a panel whose entire job is
      // telling you what happened.
      const changes: string[] = [];
      if (op.prev.label !== op.entity.label) changes.push(`label "${op.prev.label}" -> "${op.entity.label}"`);
      if (op.prev.type !== op.entity.type) changes.push(`type ${op.prev.type} -> ${op.entity.type}`);
      if (op.prev.importance !== op.entity.importance) changes.push(`${op.prev.importance} -> ${op.entity.importance}`);
      if (op.prev.description !== op.entity.description) changes.push("description");
      if (JSON.stringify(op.prev.quantity ?? null) !== JSON.stringify(op.entity.quantity ?? null)) {
        changes.push(`quantity ${op.entity.quantity ? op.entity.quantity.value : "cleared"}`);
      }
      if (JSON.stringify(op.prev.attributes ?? []) !== JSON.stringify(op.entity.attributes ?? [])) changes.push("attributes");
      if (op.prev.status !== op.entity.status) changes.push(`status ${op.entity.status}`);
      return `~ ${op.entity.id}: ${changes.join(", ") || "touched"}`;
    }
    case "SUPERSEDE_ENTITY":
      return `x ${op.entityId} superseded`;
    case "ADD_RELATION":
      return `+ ${op.relation.source} -${op.relation.type}${op.relation.role ? `:${op.relation.role}` : ""}-> ${op.relation.target}`;
    case "UPDATE_RELATION":
      return `~ ${op.relation.id}`;
    case "REMOVE_RELATION":
      return `- ${op.relationId}`;
    case "ADD_CLAIM":
      return `+ claim "${op.claim.text}"`;
    case "UPDATE_CLAIM":
      return `~ claim ${op.claim.id}`;
  }
}
