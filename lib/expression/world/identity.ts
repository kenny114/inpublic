/**
 * Entity identity resolution: for one newly-extracted mention, does it name
 * something the world already knows, or is it genuinely new?
 *
 * This runs BEFORE lib/expression/world/apply.ts ever creates a world
 * entity — apply.ts's own `resolveMention` remains the fallback for callers
 * that never opt into this layer (every existing fixture/test call site),
 * but the real extraction pipeline (lib/expression/pipeline.ts) runs this
 * first and hands apply.ts the answer.
 *
 * Two stages, in order, and stage two only runs when stage one cannot
 * answer confidently:
 *
 *  1. DETERMINISTIC CANDIDATE RETRIEVAL (this file, always runs, free).
 *     Every candidate is judged against a CANONICAL REPRESENTATION built
 *     fresh from the world each time (label, aliases, kind, stemmed
 *     concept tokens, topic context, relation neighborhood) — see
 *     `buildCanonicalRepresentation` — not against its raw display label
 *     alone. Multiple independent signals each contribute ELIGIBILITY (is
 *     this candidate even plausible) and then SCORE (how plausible).
 *     Salience/recency alone must never make a candidate eligible, only
 *     ever break a tie among candidates some OTHER signal already made
 *     eligible or corroborate a decision already supported some other way.
 *
 *  2. SEMANTIC JUDGMENT (only the genuinely ambiguous zone — candidates
 *     exist but no deterministic signal is decisive). A small, tightly
 *     constrained model call chooses among the candidates ALREADY produced
 *     by stage one — it can never name an id of its own, only an index
 *     into the list it was given — and is explicitly allowed, and expected,
 *     to answer `uncertain` when the evidence genuinely does not
 *     distinguish. See identityJudge.ts.
 *
 * LIFECYCLE-AWARE ELIGIBILITY. Status is not a hard filter on candidacy —
 * active, deemphasized, suspended, rejected and superseded entities can ALL
 * be offered as candidates, because a mention can legitimately be about any
 * of them ("the fix" that was rejected last week is still what "the fix"
 * MEANS if the speaker brings it back up). What status controls is what
 * happens after a match:
 *   - active / deemphasized: ordinary candidates, eligible for a fast,
 *     judge-free auto-merge exactly like before.
 *   - suspended: eligible, but NEVER auto-merged deterministically — always
 *     goes through the judge, and only reactivates (status -> "active")
 *     when the judge confirms it. A coincidental lexical match must not
 *     silently un-suspend something the speaker asked to set aside; a
 *     clear, judge-confirmed re-mention should.
 *   - rejected / superseded: eligible for identity linking (so the world
 *     does not mint a second entity for an idea already ruled out), always
 *     through the judge, and NEVER reactivated by a merge — the status
 *     stays rejected/superseded even after content merges in. Recallable
 *     is not the same as valid again.
 *
 * The conservative rule holds throughout: an unresolved/new entity is
 * always preferable to a wrong merge. Everything that is not a confident
 * live-candidate auto-merge or an explicit judge `same_entity` creates (or
 * "holds" — see IdentityAction) a new entity rather than guessing.
 */

import { contentWords, fillsPlaceholderFrame, isPlaceholderMention, normalizeMention, typesCompatible } from "./apply";
import { isLiveEntityStatus, type Entity, type EntityStatus, type EntityType, type WorldEntity, type WorldState } from "../schemas";

export interface IdentityCandidate {
  id: string;
  label: string;
  description?: string;
  status: EntityStatus;
  kind: EntityType;
  score: number;
  reasons: string[];
  /** Both sides gave a description and they share not one content word — active counter-evidence, not just an absence of support. See decideDeterministically. */
  descriptionConflict: boolean;
  /** True when this candidate's kind and the mention's kind are a recognized ROLE variation of the same stable thing (see ROLE_BRIDGE), not the same ontological family apply.ts's typesCompatible already accepts. Never auto-merges — always goes through the judge. */
  crossType: boolean;
}

/** Everything about the current turn identity retrieval needs beyond the mention itself. */
export interface IdentityContext {
  /** World id of this delta's topicEntityId, once resolved against the world — the "what is this utterance about" anchor. */
  topicWorldId?: string | null;
  /** World ids this same delta has already resolved for OTHER local entities — the relation-neighborhood and discourse-context signal. */
  neighborhoodIds?: string[];
  /** Caller-supplied speakerId for this segment, if any. */
  speakerId?: string;
  /** World ids touched in roughly the last few turns — a much smaller, more honest "recently discussed" set than the full salience stack. */
  recentEntityIds?: string[];
}

// ─────────────────────────────────────────────── canonical representation

/**
 * The bounded, structured view of a world entity identity is actually
 * decided against — display label, aliases, kind, stemmed concept tokens,
 * topic context, relation neighborhood. Recomputed fresh from the world
 * every time, the same discipline references.ts's `candidateGroups` and
 * apply.ts's `importance` already use: a derived view can never drift from
 * the world it describes, so there is nothing here to keep in sync and
 * nothing new to persist in WorldEntitySchema.
 */
export interface CanonicalRepresentation {
  id: string;
  label: string;
  aliases: string[];
  kind: EntityType;
  /** Stemmed, stopword-filtered tokens from label + aliases + description — identity's real unit of comparison, not raw wording. */
  conceptTokens: string[];
  topicContext: "primary" | "supporting" | "detail" | "archived";
  relationNeighborIds: string[];
}

const MAX_CONCEPT_TOKENS = 16;

/**
 * A deliberately narrow, safe inflectional stemmer — NOT a general stemmer
 * and NOT embedding similarity. It only collapses the handful of endings
 * English nouns/verbs take for tense and number (rebuild/rebuilding/rebuilt*,
 * fix/fixes/fixing/fixed, metric/metrics) so identical concepts spoken in
 * different grammatical forms compare equal. No derivational suffixes
 * (-tion, -ity, -ness), no vowel-shift rules, nothing that could pull two
 * genuinely DIFFERENT words together — a wrong stem only ever costs a missed
 * match (safe: falls through to the judge), never a false one.
 * (*irregular past tense like "rebuilt" is intentionally not covered —
 * guessing irregulars risks exactly the false-collision this must avoid.)
 */
function stem(word: string): string {
  if (word.length <= 3) return word;
  const undoubleFinal = (s: string) => (s.length >= 4 && /([bcdfgjklmnpqrstvwxz])\1$/.test(s) ? s.slice(0, -1) : s);
  if (word.length > 5 && word.endsWith("ing")) return undoubleFinal(word.slice(0, -3));
  if (word.length > 5 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith("ed")) return undoubleFinal(word.slice(0, -2));
  if (word.length > 4 && /[sxz]es$|[cs]hes$/.test(word)) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** `contentWords()` (already stopword-filtered) with each token stemmed — the unit every identity comparison in this file uses. */
function stemmedWords(text: string): string[] {
  // Hyphens are identity-noise ("step-four-fix" vs "step four fix"), not meaning.
  return contentWords(text.replace(/-/g, " ")).map(stem);
}

/**
 * Heads that are too generic to identify a thing on their own. A later
 * "the fix" must not silently swallow "step four fix" just because both
 * end in "fix"; a later "the rebuild" MAY attach to "full rebuild"
 * because "rebuild" is the distinctive head of that phrase.
 */
const GENERIC_HEADS = new Set([
  "plan", "thing", "issue", "fix", "problem", "idea", "way", "part", "piece",
  "item", "stuff", "change", "approach", "option", "call", "work", "one",
  "project", "bit", "point", "case", "move",
]);

function isGenericHead(word: string | undefined): boolean {
  return Boolean(word && GENERIC_HEADS.has(word));
}

function isSubset(short: string[], long: string[]): boolean {
  if (!short.length || short.length >= long.length) return false;
  const set = new Set(long);
  return short.every((t) => set.has(t));
}

/** Longest run of consecutive tokens shared by both sequences. */
function sharedCoreLength(a: string[], b: string[]): number {
  let best = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k += 1;
      if (k > best) best = k;
    }
  }
  return best;
}

/**
 * English NPs are head-final: "the rebuild" names "full rebuild" when the
 * shorter token set is a subset of the longer and they share the last word.
 * Generic singleton heads ("the plan", "the fix") are excluded — those are
 * the labels the corroboration guard exists to protect.
 */
function phraseHeadMatch(mentionTokens: string[], candidateTokens: string[]): boolean {
  if (!mentionTokens.length || !candidateTokens.length) return false;
  const [short, long] =
    mentionTokens.length <= candidateTokens.length ? [mentionTokens, candidateTokens] : [candidateTokens, mentionTokens];
  if (long.length < 2 || !isSubset(short, long)) return false;
  if (short[short.length - 1] !== long[long.length - 1]) return false;
  if (short.length === 1 && isGenericHead(short[0])) return false;
  return true;
}

function overlapRatio(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (!sa.size || !sb.size) return 0;
  const shared = [...sa].filter((w) => sb.has(w)).length;
  return shared / Math.max(sa.size, sb.size);
}

export function buildCanonicalRepresentation(world: WorldState, entity: WorldEntity): CanonicalRepresentation {
  const raw = [entity.label, ...entity.aliases, entity.description ?? ""].join(" ");
  const conceptTokens = [...new Set(stemmedWords(raw))].slice(0, MAX_CONCEPT_TOKENS);
  const topicContext = !isLiveEntityStatus(entity.status) ? "archived" : entity.importance;
  const relationNeighborIds = [
    ...new Set(
      world.relations
        .filter((r) => r.source === entity.id || r.target === entity.id)
        .map((r) => (r.source === entity.id ? r.target : r.source)),
    ),
  ];
  return { id: entity.id, label: entity.label, aliases: entity.aliases, kind: entity.type, conceptTokens, topicContext, relationNeighborIds };
}

/**
 * SEMANTIC TYPE RECONCILIATION.
 *
 * apply.ts's `typesCompatible` answers "is this the same ONTOLOGICAL KIND
 * of thing" (a person is never a place) and stays exactly as it is —
 * resolveMention, pronoun resolution and relation-endpoint resolution all
 * still use it unchanged, and this module still calls it first, below.
 * This bridge answers a narrower, different question this layer alone
 * needs: is a type mismatch actually just the CONTEXTUAL ROLE a mention
 * happens to play this sentence, describing the same stable thing?
 *
 * Found live, repeatedly, in the meeting stress replay: "the email
 * verification step" extracted once as an `object` (the artifact/feature)
 * and once as an `action` (the work of fixing it) — genuinely one stable
 * thing, never reconcilable under a strict type gate because `object`
 * (physical family) and `action` (occurrence family) share no family.
 * Same pattern for "blog post" (object vs. event) and "affected customers"
 * (group vs. quantity, when a count was mentioned alongside the group).
 *
 * This does NOT loosen the boundary generally — it lists the SPECIFIC,
 * observed pairs where one thing is routinely described as itself (an
 * object) or as the process/occurrence that produces or characterizes it
 * (action/event/state), or as a group vs. the bare count of it. It does not
 * touch person/place/group boundaries, which stay exactly as strict as
 * apply.ts's own gate — nothing here would make "Jordan" (person) eligible
 * against "hiring" (event) just because both are, individually, bridgeable
 * to `object` elsewhere in the table; a bridge only ever applies to the
 * SPECIFIC ordered pair listed.
 *
 * A bridged (role) match is still gated exactly like every other signal —
 * it only grants ELIGIBILITY, never a free pass — and additionally can
 * NEVER auto-merge at stage 1 regardless of score: it always goes through
 * the judge, which has the full mention/description/context to tell a
 * genuine role variation of one thing apart from two different things that
 * simply share a type-family boundary. See decideDeterministically.
 */
const ROLE_BRIDGE: ReadonlyArray<readonly [EntityType, EntityType]> = [
  ["object", "action"],
  ["object", "event"],
  ["object", "state"],
  ["group", "quantity"],
];

function roleBridged(a: EntityType, b: EntityType): boolean {
  return ROLE_BRIDGE.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

/** "same" = apply.ts's own family gate already accepts this pair (ordinary eligibility). "role" = only the bridge above accepts it (eligible, judge-only, never auto-merge). null = a real, untouched type boundary. */
function identityTypeRelation(a: EntityType, b: EntityType): "same" | "role" | null {
  if (typesCompatible(a, b)) return "same";
  if (roleBridged(a, b)) return "role";
  return null;
}

const EXACT_MATCH_SCORE = 100;
const SUBSUMPTION_SCORE = 90;
const PHRASE_HEAD_SCORE = 90;
const SHARED_CORE_SCORE = 86;
const NEAR_EXACT_CONCEPT_SCORE = 88;
const DESCRIPTION_BONUS = 18;
const LEXICAL_WEIGHT = 70;
const TOPIC_BONUS = 22;
const RELATION_BONUS = 16;
const CLAIM_BONUS = 14;
const METRIC_BONUS = 26;
const SPEAKER_BONUS = 6;
const RECENT_BONUS = 4;
/**
 * A mention that FILLS a placeholder the world is already holding open.
 *
 * Scored alongside an exact label match rather than below it, because that
 * is what it is: the speaker is not naming a second thing, they are
 * finishing the sentence they started. It is gated hard — the candidate's
 * label must be nothing but placeholder words, the mention must not be,
 * and the two must already share a relation with something else this same
 * utterance touched. Without that neighbourhood requirement this would
 * merge every specific noun into whatever vague word was said last.
 */
const PLACEHOLDER_SLOT_SCORE = 90;
const CONCEPT_OVERLAP_FLOOR = 0.34;
const NEAR_EXACT_FLOOR = 0.85;

/** Same "Mariam" / "Mariam Farmer" name-containment apply.ts's resolveMention uses — kept local since it is only ever evidence, not a gate, here. */
function isProperName(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => /^[A-Z]/.test(w) && w.length > 1);
}
function subsumes(a: string, b: string): boolean {
  if (!isProperName(a) || !isProperName(b)) return false;
  const ta = normalizeMention(a).split(" ").filter(Boolean);
  const tb = normalizeMention(b).split(" ").filter(Boolean);
  if (!ta.length || !tb.length) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.length !== long.length && short.every((t) => long.includes(t));
}

function relatedToNeighborhood(rep: CanonicalRepresentation, neighborhoodIds: string[]): boolean {
  if (!neighborhoodIds.length) return false;
  return rep.relationNeighborIds.some((id) => neighborhoodIds.includes(id));
}

function claimOverlapHit(world: WorldState, candidateId: string, mentionWords: Set<string>): string | null {
  if (!mentionWords.size) return null;
  const hit = world.claims.find(
    (c) => (c.about ?? []).includes(candidateId) && stemmedWords(c.text).some((w) => mentionWords.has(w)),
  );
  return hit ? hit.text : null;
}

/**
 * STAGE 1. Every entity ever mentioned — any status — is a candidate to
 * consider, but only the ones some independent signal actually supports
 * become ELIGIBLE, and neither salience nor recency is ever that signal.
 * `rejectedCount` is every type-compatible entity that was considered and
 * found NOT eligible — the "rejected candidates" half of the instrumentation
 * trail, kept as a count rather than a per-entity dump to stay readable on
 * a 100+ entity world.
 */
export function retrieveIdentityCandidates(
  world: WorldState,
  local: Entity,
  ctx: IdentityContext = {},
): { candidates: IdentityCandidate[]; rejectedCount: number } {
  const normalized = normalizeMention(local.label);
  if (!normalized) return { candidates: [], rejectedCount: 0 };
  const mentionTokens = stemmedWords(`${local.label} ${local.description ?? ""}`);
  const mentionWordSet = new Set(mentionTokens);
  const neighborhood = ctx.neighborhoodIds ?? [];
  const recent = new Set(ctx.recentEntityIds ?? []);

  const out: IdentityCandidate[] = [];
  let rejectedCount = 0;

  for (const entity of world.entities) {
    const typeRelation = identityTypeRelation(entity.type, local.type);
    if (!typeRelation) continue; // a real, untouched ontological boundary — never eligible, regardless of status
    const crossType = typeRelation === "role";

    const rep = buildCanonicalRepresentation(world, entity);
    const label = normalizeMention(entity.label);
    const labelTokens = stemmedWords([entity.label, ...entity.aliases].join(" "));
    const reasons: string[] = [];
    let eligible = false;
    let score = 0;
    if (crossType) reasons.push(`role variation (${entity.type} <-> ${local.type})`);

    const exactMatch = label === normalized || entity.aliases.includes(normalized);
    if (exactMatch) {
      eligible = true;
      score = Math.max(score, EXACT_MATCH_SCORE);
      reasons.push("exact label/alias match");
    }

    if (subsumes(entity.label, local.label) || subsumes(local.label, entity.label)) {
      eligible = true;
      score = Math.max(score, SUBSUMPTION_SCORE);
      reasons.push("name containment");
    }

    // An exact match trivially scores 100% concept-token overlap too —
    // counting both would let one piece of evidence masquerade as two
    // independent ones, defeating the corroboration check below. Concept
    // overlap only ever contributes its OWN reason when it found something
    // an exact match did not.
    if (!exactMatch) {
      const ratio = overlapRatio(rep.conceptTokens, mentionTokens);
      if (ratio >= NEAR_EXACT_FLOOR) {
        // Pure word-form variation ("rebuild" / "rebuilding") and token
        // permutation ("step four fix" / "fix step four") stem to the same
        // set — specific enough to treat as almost an exact label match.
        eligible = true;
        score = Math.max(score, NEAR_EXACT_CONCEPT_SCORE);
        reasons.push(`identical concept tokens after normalization (vs "${entity.label}")`);
      } else if (phraseHeadMatch(mentionTokens, labelTokens)) {
        eligible = true;
        score = Math.max(score, PHRASE_HEAD_SCORE);
        reasons.push(`phrase-head anaphora of "${entity.label}"`);
      } else if (sharedCoreLength(mentionTokens, labelTokens) >= 2 || sharedCoreLength(mentionTokens, rep.conceptTokens) >= 2) {
        const core = Math.max(sharedCoreLength(mentionTokens, labelTokens), sharedCoreLength(mentionTokens, rep.conceptTokens));
        eligible = true;
        score = Math.max(score, SHARED_CORE_SCORE + Math.min(core - 2, 2) * 4);
        reasons.push(`shared ${core}-token phrase core with "${entity.label}"`);
      } else if (ratio >= CONCEPT_OVERLAP_FLOOR) {
        eligible = true;
        score = Math.max(score, ratio * LEXICAL_WEIGHT);
        reasons.push(`${Math.round(ratio * 100)}% concept-token overlap with "${entity.label}"`);
      } else if (mentionTokens.length >= 2) {
        const pool = new Set([...labelTokens, ...rep.conceptTokens]);
        const shared = mentionTokens.filter((t) => pool.has(t)).length;
        const coverage = shared / mentionTokens.length;
        if (coverage >= 0.5 && shared >= 1) {
          eligible = true;
          score = Math.max(score, coverage * LEXICAL_WEIGHT);
          reasons.push(`${Math.round(coverage * 100)}% of mention tokens found in "${entity.label}"`);
        }
      }
    }

    // The placeholder slot (see PLACEHOLDER_SLOT_SCORE): "something" ->
    // "a startup", when both are already tied to the same neighbour.
    const fillsSlot =
      (isPlaceholderMention(entity.label) && !isPlaceholderMention(local.label)) ||
      fillsPlaceholderFrame(entity.label, local.label);
    if (fillsSlot && mentionTokens.length) {
      if (relatedToNeighborhood(rep, neighborhood) || (ctx.topicWorldId && entity.id === ctx.topicWorldId)) {
        eligible = true;
        score = Math.max(score, PLACEHOLDER_SLOT_SCORE);
        reasons.push(`names the placeholder "${entity.label}" the speaker had left open`);
      }
    }

    if (local.description && entity.description) {
      const descRatio = overlapRatio(stemmedWords(local.description), stemmedWords(entity.description));
      if (descRatio >= 0.4) {
        eligible = true;
        score += DESCRIPTION_BONUS;
        reasons.push("matching descriptions");
      }
    }

    // Metric identity: two metric-bearing entities of the SAME unit whose
    // concept tokens overlap at all ("traffic" / "traffic this month") are
    // almost certainly one measurement described with a time/category
    // qualifier, not two different things being measured.
    if (local.metric && entity.metric && entity.metric.unit === local.metric.unit) {
      if (overlapRatio(rep.conceptTokens, mentionTokens) > 0) {
        eligible = true;
        score += METRIC_BONUS;
        reasons.push(`same "${entity.metric.unit}" metric identity`);
      }
    }

    // Topic / relation / claim never GRANT eligibility. In a long meeting
    // they fire for almost everyone on the salience stack, which packed the
    // candidate list with five high-scoring neighbours and left an exact
    // "full rebuild" re-mention with a margin too small to auto-merge —
    // so the abstaining judge minted full-rebuild-2. Recency/speaker below
    // already follow this rule. Topic is allowed only as a tie-break on a
    // candidate some lexical/phrase/metric/description signal already made
    // plausible, plus the utterance's own stated topicEntityId (already a
    // resolved world id, not a guess).
    if (ctx.topicWorldId && entity.id === ctx.topicWorldId) {
      eligible = true;
      score += TOPIC_BONUS;
      reasons.push("this utterance's own stated topic");
    }

    if (!eligible) {
      rejectedCount += 1;
      continue;
    }

    if (rep.topicContext === "primary") {
      score += TOPIC_BONUS;
      reasons.push("current primary topic");
    }

    if (relatedToNeighborhood(rep, neighborhood)) {
      score += RELATION_BONUS;
      reasons.push("shares a relation with something else this utterance touched");
    }

    const claimText = claimOverlapHit(world, entity.id, mentionWordSet);
    if (claimText) {
      score += CLAIM_BONUS;
      reasons.push(`mentioned in claim "${claimText}"`);
    }

    if (ctx.speakerId && entity.provenance?.some((p) => p.speakerId === ctx.speakerId)) {
      score += SPEAKER_BONUS;
      reasons.push(`previously touched by ${ctx.speakerId}`);
    }
    if (recent.has(entity.id)) {
      score += RECENT_BONUS;
      reasons.push("recently discussed");
    }

    // Two different speakers can reuse the same short generic label ("the
    // plan") for two actively CONTRADICTORY things within seconds of each
    // other — lexical/topical/recency signals all fire identically for
    // that case and for an honest re-mention, because they only measure
    // proximity, not content. A stated description is the one place actual
    // content lives; when both sides gave one and they share nothing at
    // all, that is active counter-evidence, not merely weaker support, and
    // must veto an auto-merge regardless of how many proximity signals
    // agree.
    const descriptionConflict = Boolean(
      local.description && entity.description && overlapRatio(stemmedWords(local.description), stemmedWords(entity.description)) === 0,
    );

    out.push({ id: entity.id, label: entity.label, description: entity.description, status: entity.status, kind: entity.type, score, reasons, descriptionConflict, crossType });
  }

  /**
   * EXACTNESS OUTRANKS PROXIMITY.
   *
   * Score alone put "step four" above "step-four fix" for the mention
   * "step-four fix", and "activation target" above "One month" for the
   * mention "one month": the wrong candidate was the current topic, or
   * shared a relation, or had just been discussed, and those bonuses total
   * more than the gap between an exact label match and a partial one. The
   * two then tied close enough that the margin rule refused to merge at
   * all, and the board grew a third box saying the same words as the
   * first two.
   *
   * Proximity signals answer "is this plausible". Only the words answer
   * "is this the same thing". So an exact label/alias match sorts above
   * every inexact candidate first, and score decides only within a class.
   */
  const ordered = out.sort((a, b) => exactness(b) - exactness(a) || b.score - a.score);
  return { candidates: ordered.slice(0, 5), rejectedCount };
}

/** 1 when this candidate's own LABEL (or an alias) is what was said, 0 when the match is only partial. See the sort in retrieveIdentityCandidates. */
function exactness(candidate: IdentityCandidate): number {
  return candidate.reasons.some((r) => r.startsWith("exact label")) ? 1 : 0;
}

export type IdentityAction = "merge" | "create" | "hold";

export interface IdentityDecision {
  action: IdentityAction;
  targetId?: string;
  /** True only when the merge target was `suspended` and the match was confirmed (by the judge) strongly enough to bring it back into active discussion. Never set for a deterministic stage-1 merge, since those only ever target already-live candidates. */
  reactivate?: boolean;
  candidates: IdentityCandidate[];
  rejectedCount: number;
  usedJudge: boolean;
  judgeVerdict?: JudgeVerdict;
  reason: string;
}

const AUTO_MERGE_SCORE = 85;
const AUTO_MERGE_MARGIN = 25;

/**
 * Stage 1's own verdict when it is confident enough to skip stage 2
 * entirely — returns null when the case is genuinely ambiguous OR when the
 * top candidate is not currently live. A non-live top candidate NEVER
 * auto-merges, no matter how high its score: reactivating a suspended idea
 * or re-touching a rejected one is exactly the kind of consequential,
 * easy-to-get-wrong call that gets a judge's sanity check every time.
 */
function decideDeterministically(
  candidates: IdentityCandidate[],
  rejectedCount: number,
  mentionSpecific: boolean,
  refusal?: { reason: string },
): IdentityDecision | null {
  if (!candidates.length) {
    return { action: "create", candidates, rejectedCount, usedJudge: false, reason: "no eligible candidate — nothing in the world plausibly matches" };
  }
  const [top, second] = candidates;
  const refuse = (why: string): null => {
    if (refusal) refusal.reason = why;
    return null;
  };
  if (top.status !== "active" && top.status !== "deemphasized") return refuse(`top candidate "${top.label}" is ${top.status}`); // archived — always defer to the judge
  // A role-bridged match normally waits for the judge, because a type
  // boundary crossed is real evidence of two different things. The one
  // case that does not need asking about is the case the bridge was
  // written for: the SAME distinctive phrase, extracted once as the thing
  // and once as the doing of it ("the email verification step" as an
  // object in one sentence and an action in the next). When the label
  // matches exactly and is specific enough to name one thing, the type
  // difference is the extractor's grammar, not the world's ontology — and
  // deferring it to a judge that abstains (the live path configures none)
  // does not produce caution, it produces a second box saying the same
  // words.
  const exactLabelMatch = top.reasons.some((r) => r.startsWith("exact label"));
  const distinctivePhrase = mentionSpecific && !isGenericHead(stemmedWords(top.label).at(-1));
  if (top.crossType && !(exactLabelMatch && distinctivePhrase)) {
    return refuse(`"${top.label}" matches only across a role bridge (${top.kind})`);
  }
  // Measured within a class, for the same reason the sort has classes: an
  // exact match leading an inexact one is not a close call that needs a
  // bigger lead, it is a different kind of evidence winning.
  const margin = !second || exactness(top) > exactness(second) ? Infinity : top.score - second.score;
  // A single reason — usually a bare exact-label match — is not enough to
  // merge silently: a short generic label ("the fix", "the plan") can get
  // reused for a genuinely different thing once the conversation has moved
  // on. Auto-merge needs a SECOND, independent signal corroborating it
  // (recency, current topicality, a relation, a shared claim, ...); a lone
  // coincidence still gets a stage-2 sanity check instead.
  //
  // Exception: a SPECIFIC phrase (two or more content tokens, or a
  // non-generic 1-token morphological variant) is already distinctive.
  // "step four fix" / "fix step four" / "the rebuild" ~ "full rebuild"
  // should not wait for a judge, or for recency, to stay one entity.
  const phraseIdentity = top.reasons.some(
    (r) =>
      r.includes("identical concept tokens") ||
      r.includes("same concept tokens") ||
      r.includes("phrase-head anaphora") ||
      r.includes("shared ") && r.includes("phrase core"),
  );
  const specificEnough =
    mentionSpecific ||
    (phraseIdentity && !isGenericHead(top.label.split(/\s+/).pop()?.toLowerCase()));
  const exactLabel = exactLabelMatch;
  // Already corroborated by construction: the slot signal only fires when
  // the placeholder and the mention share a neighbour from this very
  // utterance, which is a second, independent signal, not a lexical
  // coincidence waiting for one.
  const placeholderSlot = top.reasons.some((r) => r.includes("the speaker had left open"));
  const topHead = stemmedWords(top.label)[0];
  const selfCorroborating =
    placeholderSlot ||
    (specificEnough && (phraseIdentity || exactLabel)) ||
    (exactLabel && !isGenericHead(topHead));
  /**
   * A conflicting description vetoes a COINCIDENCE, which is what it was
   * written for: two speakers reaching for "the plan" within seconds and
   * meaning opposite things. Applied to every match alike it also vetoed
   * "rebuild" against "rebuild" — one distinctive word, exact, the only
   * eligible candidate in the world, scoring 114 — because two people had
   * described the same rebuild in different words. That is not a conflict,
   * that is two descriptions; short descriptions of one thing routinely
   * share no content words at all.
   *
   * So the veto keeps its job over generic labels, where the wording is
   * genuinely all the evidence there is, and stands down for a distinctive
   * exact or phrase-identity match, where the label itself is the evidence.
   * Description conflict remains the largest single source of duplicate
   * boxes on a long board, and this is the half of it that was never the
   * risk the guard was protecting against.
   */
  const distinctiveLabel = (exactLabel || phraseIdentity) && !isGenericHead(topHead);
  const corroborated = !(top.descriptionConflict && !distinctiveLabel) && (top.reasons.length > 1 || selfCorroborating);
  // A specific phrase with an exact or phrase-identity hit is the entity.
  // Crowded meetings used to stack five neighbours at similar scores, so a
  // 25-point margin never cleared and abstention minted full-rebuild-2.
  const marginNeeded = selfCorroborating ? 8 : AUTO_MERGE_MARGIN;
  if (top.score >= AUTO_MERGE_SCORE && margin >= marginNeeded && corroborated) {
    return {
      action: "merge",
      targetId: top.id,
      candidates,
      rejectedCount,
      usedJudge: false,
      reason: `confident deterministic match: "${top.label}" (${top.reasons.join("; ")})`,
    };
  }
  const why =
    top.score < AUTO_MERGE_SCORE
      ? `top candidate "${top.label}" scored ${Math.round(top.score)} < ${AUTO_MERGE_SCORE}`
      : top.descriptionConflict
        ? `"${top.label}" has a conflicting description`
        : margin < marginNeeded
          ? `"${top.label}" led "${second?.label}" by only ${Math.round(margin)} (needs ${marginNeeded})`
          : `"${top.label}" had a single uncorroborated signal`;
  return refuse(why); // ambiguous — defer to stage 2
}

export type JudgeVerdict = "same_entity" | "related_but_distinct" | "new_entity" | "uncertain";

export interface JudgeResult {
  index: number | null;
  verdict: JudgeVerdict;
  reason: string;
}

export type IdentityJudge = (mention: Entity, candidates: IdentityCandidate[]) => Promise<JudgeResult>;

/** The safe default for every caller that does not explicitly opt into a model-backed judge: an ambiguous case stays unresolved rather than guessed. Zero network calls, zero cost, used by every existing fixture/test. */
export const abstainIdentityJudge: IdentityJudge = async () => ({
  index: null,
  verdict: "uncertain",
  reason: "no identity judge configured — abstaining rather than guessing",
});

/**
 * Full two-stage resolution for one local entity. Stage 1 always runs;
 * stage 2 (the judge) only runs when stage 1 could not decide on its own —
 * the large majority of mentions are either an obvious new thing (zero
 * eligible candidates) or an obvious re-mention (one dominant, already-live
 * candidate), and neither of those costs a model call.
 *
 * The judge's four verdicts map to three actions, not four — `uncertain`
 * and a confident `related_but_distinct`/`new_entity` both create a new
 * entity in the end (there is no fourth thing to do with a mention that
 * must go somewhere), but they are labelled DIFFERENTLY: `hold` for
 * genuine abstention (the judge could not tell), `create` for a confident
 * "no". That distinction is the whole point of measuring uncertainty
 * explicitly rather than folding it into "created a new entity" and losing
 * it.
 */
export async function resolveEntityIdentity(
  world: WorldState,
  local: Entity,
  ctx: IdentityContext,
  judge: IdentityJudge = abstainIdentityJudge,
): Promise<IdentityDecision> {
  const { candidates, rejectedCount } = retrieveIdentityCandidates(world, local, ctx);
  const mentionSpecific = stemmedWords(local.label).length >= 2;
  // Why stage 1 stood down is the single most useful fact about a mention
  // that ended up as a duplicate on the board, and it used to be thrown
  // away — every `hold` read "judge: uncertain", which says what happened
  // after the interesting decision, not what caused it.
  const refusal = { reason: "no eligible candidate" };
  const deterministic = decideDeterministically(candidates, rejectedCount, mentionSpecific, refusal);
  if (deterministic) return deterministic;

  const result = await judge(local, candidates);
  if (result.verdict === "same_entity" && result.index !== null && candidates[result.index]) {
    const target = candidates[result.index];
    return {
      action: "merge",
      targetId: target.id,
      reactivate: target.status === "suspended",
      candidates,
      rejectedCount,
      usedJudge: true,
      judgeVerdict: result.verdict,
      reason: `judge: same_entity as "${target.label}" — ${result.reason}`,
    };
  }
  return {
    action: result.verdict === "uncertain" ? "hold" : "create",
    candidates,
    rejectedCount,
    usedJudge: true,
    judgeVerdict: result.verdict,
    reason: `stage 1 stood down: ${refusal.reason} · judge: ${result.verdict} — ${result.reason || "no eligible candidate was a confident match"}`,
  };
}

/**
 * Full instrumentation for one local entity's identity decision: mention ->
 * normalized/canonical comparison -> eligible candidates (+ how many were
 * considered and rejected) -> deterministic resolution or judge -> judge
 * verdict if invoked -> merge/create/hold -> resulting entity id.
 */
export interface IdentityResolution {
  localId: string;
  mentionLabel: string;
  mentionType: string;
  candidateCount: number;
  rejectedCount: number;
  topCandidateId?: string;
  topCandidateStatus?: EntityStatus;
  topScore?: number;
  usedJudge: boolean;
  judgeVerdict?: JudgeVerdict;
  action: IdentityAction;
  reactivate?: boolean;
  resultingEntityId: string | null;
  reason: string;
}

/** Convenience for the caller building `ctx.recentEntityIds` — world ids touched within the last `window` segments. */
export function recentlyTouchedEntityIds(world: WorldState, window: number): string[] {
  const threshold = world.seq - window;
  return world.entities.filter((e) => isLiveEntityStatus(e.status) && e.lastTouchedSeq >= threshold).map((e) => e.id);
}

export type { WorldEntity };
