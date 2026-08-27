/**
 * Ordinal and topic-recall reference resolution: "the second option", "the
 * last idea", "the other one", "go back to the pricing problem", "what we
 * said earlier about funding".
 *
 * Deliberately separate from apply.ts's resolveMention (pronouns, proper
 * names, definite anaphora): those resolve by TYPE COMPATIBILITY and
 * RECENCY against a flat salience stack, which is the wrong search here.
 * "The second option" is not "the most recently mentioned compatible
 * entity" — it is a POSITION within whichever enumerated group the speaker
 * is pointing at. "Go back to the pricing problem" can specifically mean
 * something that is NOT currently salient at all; salience-order search
 * would never find it.
 *
 * Both resolvers operate on WorldState only — entities, relations, seq —
 * never on canvas geometry, never on raw transcript text. The extractor
 * already reduced the utterance to a ReferenceMention (see schemas.ts)
 * before either of these runs; this module answers "which world entity, if
 * any, does that pointer resolve to", exactly the same division of labour
 * pronoun resolution already uses.
 *
 * The one rule that matters more than the algorithm: a low-confidence
 * result is a result of `chosenId: null`. Guessing and attaching to the
 * wrong concept is worse than an unresolved reference, because a wrong
 * attachment corrupts the world silently while an unresolved one is visible
 * in the trace and drops cleanly (the caller treats it exactly like a
 * relation whose endpoint could not be resolved — dropped, not dangling).
 */

import { normalizeMention } from "./apply";
import {
  isLiveEntityStatus,
  type ReferenceCandidate,
  type ReferenceMention,
  type ReferenceResolution,
  type WorldEntity,
  type WorldState,
} from "../schemas";
import {
  applyTargetJudge,
  decideTarget,
  judgeInputFor,
  retrieveTargetCandidates,
  toReferenceCandidates,
  type TargetContext,
  type TargetJudge,
} from "./resolveTarget";

function isActive(e: WorldEntity): boolean {
  return isLiveEntityStatus(e.status);
}

function words(text: string): string[] {
  return normalizeMention(text).split(" ").filter(Boolean);
}

function entityById(world: WorldState, id: string): WorldEntity | undefined {
  return world.entities.find((e) => e.id === id);
}

// ───────────────────────────────────────────────── ordinal candidate groups

interface CandidateGroup {
  /** The shared entity the members relate to, when there is one — a decision, a topic. Absent for a pairwise contrast or a sequence. */
  hubId?: string;
  /** Mention/creation order (or sequence step order) — index 0 is "the first one". */
  memberIds: string[];
  /** Most recent touch among the members — how the default group (no topic hint) is chosen. */
  recency: number;
  label: string;
}

/** Relation types where the SOURCE is the shared hub and the many-side members are targets. */
const HUB_FORWARD = new Set(["relates_to", "contains", "causes", "enables", "prevents"]);
/**
 * Relation types where the TARGET is the shared hub and the many-side
 * members are sources. `instance_of` belongs here alongside `part_of` /
 * `member_of` / `supports` — found live: "for funding, we could raise money
 * or bootstrap" extracts as raise_money/bootstrap each `instance_of`
 * funding (funding is the category, they are its instances), the same
 * shape as membership, and ordinal resolution needs to see it as one
 * enumerable group the same way.
 */
const HUB_BACKWARD = new Set(["part_of", "member_of", "supports", "instance_of"]);

/**
 * Every enumerable set currently recoverable from the graph: things sharing
 * a hub via a one-to-many relation, pairwise contrasts, and ordered
 * sequences. Recomputed on demand from `world.relations` rather than
 * tracked as separate history, so a group can never drift from the world it
 * describes — the same reason importance is recomputed rather than carried.
 */
function candidateGroups(world: WorldState): CandidateGroup[] {
  const order = (ids: string[]): string[] =>
    [...new Set(ids)]
      .filter((id) => {
        const e = entityById(world, id);
        return e && isActive(e);
      })
      .sort((a, b) => entityById(world, a)!.firstSeenSeq - entityById(world, b)!.firstSeenSeq);

  const groups: CandidateGroup[] = [];
  const addGroup = (hubId: string | undefined, memberIds: string[], label: string) => {
    const ordered = order(memberIds);
    if (ordered.length < 2) return;
    groups.push({ hubId, memberIds: ordered, recency: Math.max(...ordered.map((id) => entityById(world, id)!.lastTouchedSeq)), label });
  };

  const forward = new Map<string, string[]>();
  const backward = new Map<string, string[]>();
  for (const r of world.relations) {
    if (HUB_FORWARD.has(r.type)) {
      const key = `${r.source}::${r.type}`;
      forward.set(key, [...(forward.get(key) ?? []), r.target]);
    }
    if (HUB_BACKWARD.has(r.type)) {
      const key = `${r.target}::${r.type}`;
      backward.set(key, [...(backward.get(key) ?? []), r.source]);
    }
  }
  for (const [key, members] of forward) {
    const hubId = key.slice(0, key.lastIndexOf("::"));
    addGroup(hubId, members, `options of ${hubId}`);
  }
  for (const [key, members] of backward) {
    const hubId = key.slice(0, key.lastIndexOf("::"));
    addGroup(hubId, members, `contributors to ${hubId}`);
  }

  // Pairwise contrast: "Plan A vs Plan B" is a 2-member group with no hub.
  for (const r of world.relations.filter((r) => r.type === "contrasts_with")) {
    addGroup(undefined, [r.source, r.target], `contrast between ${r.source} and ${r.target}`);
  }

  // Sequence: every entity touched by a `precedes` relation, ordered by its
  // stated step where given, else by when it was first mentioned.
  const seqRels = world.relations.filter((r) => r.type === "precedes");
  if (seqRels.length) {
    const ids = [...new Set(seqRels.flatMap((r) => [r.source, r.target]))];
    const stepOf = new Map<string, number>();
    for (const r of seqRels) {
      if (r.step === undefined) continue;
      stepOf.set(r.source, Math.min(stepOf.get(r.source) ?? r.step, r.step));
      stepOf.set(r.target, Math.min(stepOf.get(r.target) ?? r.step + 1, r.step + 1));
    }
    const ordered = ids
      .filter((id) => {
        const e = entityById(world, id);
        return e && isActive(e);
      })
      .sort((a, b) => (stepOf.get(a) ?? entityById(world, a)!.firstSeenSeq) - (stepOf.get(b) ?? entityById(world, b)!.firstSeenSeq));
    if (ordered.length >= 2) {
      groups.push({ memberIds: ordered, recency: Math.max(...ordered.map((id) => entityById(world, id)!.lastTouchedSeq)), label: "sequence" });
    }
  }

  return groups;
}

/**
 * "The second option" / "the last idea" / "the other one". Picks the most
 * relevant candidate group (a topic hint breaks ties; otherwise the most
 * recently touched group wins), then reads off the requested position.
 */
export function resolveOrdinal(world: WorldState, mention: ReferenceMention): ReferenceResolution {
  const surface = mention.surface;
  const groups = candidateGroups(world);
  if (!groups.length) {
    return { surface, kind: "ordinal", candidates: [], chosenId: null, confidence: "low", reason: "no enumerable group exists in the world yet" };
  }

  const hintWords = new Set(words(mention.topicHint ?? ""));
  const scored = groups
    .map((group) => {
      const hubLabel = group.hubId ? entityById(world, group.hubId)?.label : undefined;
      const hintScore = hintWords.size && hubLabel ? words(hubLabel).filter((w) => hintWords.has(w)).length : 0;
      return { group, hintScore };
    })
    .sort((a, b) => b.hintScore - a.hintScore || b.group.recency - a.group.recency);

  const candidates: ReferenceCandidate[] = scored.slice(0, 5).map(({ group, hintScore }) => ({
    id: group.memberIds.join("+"),
    label: `${group.label} [${group.memberIds.join(", ")}]`,
    score: hintScore * 1000 + group.recency,
    reason: `${group.memberIds.length}-member group, ${hintScore ? "topic hint matched" : "chosen by recency"}`,
  }));

  const top = scored[0];
  const second = scored[1];
  // Two groups are genuinely competing when neither the topic hint nor
  // recency separates them — the same tie a listener would also be unsure
  // about, so this is exactly when to prefer "unresolved" over "guessed".
  const groupAmbiguous = Boolean(second) && top.hintScore === second.hintScore && top.group.recency === second.group.recency;
  if (groupAmbiguous) {
    return {
      surface,
      kind: "ordinal",
      candidates,
      chosenId: null,
      confidence: "low",
      reason: `${groups.length} equally-recent groups match and nothing in the mention picks between them: "${top.group.label}" vs "${second!.group.label}"`,
    };
  }

  const group = top.group;
  let index: number | null = null;
  let positionReason = "";

  if (mention.ordinalOther) {
    if (group.memberIds.length !== 2) {
      return {
        surface,
        kind: "ordinal",
        candidates,
        chosenId: null,
        confidence: "low",
        reason: `"the other one" needs exactly 2 candidates; "${group.label}" has ${group.memberIds.length}`,
      };
    }
    const mostRecent = group.memberIds.reduce((a, b) =>
      entityById(world, a)!.lastTouchedSeq >= entityById(world, b)!.lastTouchedSeq ? a : b,
    );
    const other = group.memberIds.find((id) => id !== mostRecent)!;
    index = group.memberIds.indexOf(other);
    positionReason = "the member of the pair not most recently discussed";
  } else if (mention.ordinalFromEnd) {
    index = group.memberIds.length - 1;
    positionReason = "last position in the group";
  } else if (mention.ordinalIndex !== undefined) {
    index = mention.ordinalIndex;
    positionReason = `position ${mention.ordinalIndex + 1} in the group`;
  }

  if (index === null || index < 0 || index >= group.memberIds.length) {
    return {
      surface,
      kind: "ordinal",
      candidates,
      chosenId: null,
      confidence: "low",
      reason: `requested position is out of range for the ${group.memberIds.length}-member group "${group.label}"`,
    };
  }

  const chosenId = group.memberIds[index];
  const confidence = groups.length === 1 || top.hintScore > 0 ? "high" : "medium";
  return { surface, kind: "ordinal", candidates, chosenId, confidence, reason: `${positionReason} of "${group.label}"` };
}

// ─────────────────────────────────────────────────────────── topic recall

/**
 * The core entity text-matcher, now the shared contextual substrate in
 * resolveTarget.ts: hyphen-split/stemmed lexical + alias evidence, claim
 * coverage (scaled by how much of the hint the claim actually covers), then
 * ranking bonuses for speaker, active topic, recency, relation neighborhood,
 * and lifecycle. Searches every entity ever mentioned — active AND archived
 * — because both "go back to X" and a discourse act like "reject X" have to
 * be able to name something no longer in view. Shared by resolveTopicRecall
 * and lib/expression/world/apply.ts's discourse-act target resolution.
 */
export function rankEntitiesBySurface(
  world: WorldState,
  hint: string,
  speakerHint?: string,
  ctx: Omit<TargetContext, "speakerHint"> = {},
): ReferenceCandidate[] {
  return toReferenceCandidates(retrieveTargetCandidates(world, hint, { ...ctx, speakerHint }));
}

/**
 * Turns a ranked candidate list into a confidence tier. Delegates to the
 * shared substrate so topic-recall and discourse-act resolution stay on
 * the same "unresolved beats wrong" threshold, including the parent/child
 * label-subset veto.
 */
export function tierMatchConfidence(candidates: ReferenceCandidate[]): { confidence: "high" | "medium" | "low"; reason: string } {
  const { confidence, reason } = decideTarget(
    candidates.map((c) => ({
      ...c,
      status: "active" as const,
      kind: "concept" as const,
      reasons: [c.reason],
    })),
  );
  return { confidence, reason };
}

/**
 * "Go back to the pricing problem" / "what we said earlier about funding".
 * Searches every entity ever mentioned — active AND archived, unlike
 * salience-based resolution — through the shared target-resolution substrate.
 */
export function resolveTopicRecall(world: WorldState, mention: ReferenceMention): ReferenceResolution {
  const surface = mention.surface;
  const hint = mention.topicHint ?? mention.surface;
  const ctx: TargetContext = { speakerHint: mention.speakerHint };
  const decision = decideTarget(retrieveTargetCandidates(world, hint, ctx), hint, ctx);
  const candidates = toReferenceCandidates(decision.candidates);

  if (!candidates.length) {
    return { surface, kind: "topic_recall", candidates, chosenId: null, confidence: "low", reason: `nothing in the world's history matches "${hint}"` };
  }

  return {
    surface,
    kind: "topic_recall",
    candidates,
    chosenId: decision.chosenId,
    confidence: decision.confidence,
    reason: decision.reason,
  };
}

/** Same as resolveTopicRecall, then optionally asks a constrained judge when deterministic evidence tied. */
export async function resolveTopicRecallWithJudge(
  world: WorldState,
  mention: ReferenceMention,
  judge: TargetJudge,
): Promise<ReferenceResolution> {
  const surface = mention.surface;
  const hint = mention.topicHint ?? mention.surface;
  const ctx: TargetContext = { speakerHint: mention.speakerHint };
  let decision = decideTarget(retrieveTargetCandidates(world, hint, ctx), hint, ctx);
  if (decision.needsJudge && decision.candidates.length) {
    const result = await judge(judgeInputFor(surface, hint, "topic_recall", decision, ctx));
    decision = applyTargetJudge(decision, result);
  }
  return {
    surface,
    kind: "topic_recall",
    candidates: toReferenceCandidates(decision.candidates),
    chosenId: decision.chosenId,
    confidence: decision.confidence,
    reason: decision.reason,
  };
}

export function resolveReference(world: WorldState, mention: ReferenceMention): ReferenceResolution {
  return mention.kind === "ordinal" ? resolveOrdinal(world, mention) : resolveTopicRecall(world, mention);
}
