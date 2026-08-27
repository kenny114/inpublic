/**
 * The Clean Agent: given this thought and what is already on the board,
 * decide what the picture is allowed to be.
 *
 * Deterministic on purpose. The hard rules are complete — one primary,
 * six nodes, one hop, current-sentence relations — and a model looking at
 * the same snapshot would only add latency and a second opinion the
 * renderer is not allowed to take. The Drawing Agent invents strokes
 * because no rule can; this layer deletes and ranks, which a ranking can.
 *
 * It does not write the world. Archived, historical and 2-hop entities
 * remain in semantic memory; they simply do not occupy a box. The moment
 * the speaker makes one of them the subject, it is eligible again.
 */

import {
  isLiveEntityStatus,
  EMPTY_CLEAN_PLAN,
  relationFamily,
  type CleanPlan,
  type CleanRelation,
  type CompositionPlan,
  type MeaningDelta,
  type WorldEntity,
  type WorldRelation,
  type WorldState,
} from "../schemas";
import { snapshotNeedsPolice, type BoardSnapshot } from "./snapshot";

/** Hard occupancy cap. The planner's REGION_BUDGET is 8; this is stricter. */
export const MAX_CLEAN_NODES = 6;
/**
 * Preferred occupancy. Spine and this thought may fill to MAX; boarded
 * leftovers and extra fans should not. Fewer stronger marks beat a full page.
 */
export const PREFERRED_CLEAN_NODES = 4;

const ORDERING = new Set(["precedes", "transforms_into"]);
const SPINE = new Set(["precedes", "transforms_into", "causes", "enables", "depends_on"]);
const FAN = new Set(["wants", "relates_to"]);

export interface CleanInput {
  snapshot: BoardSnapshot;
  delta: MeaningDelta;
  world: WorldState;
  /** local delta id -> world id, from applyDelta. */
  idMap?: Map<string, string>;
  newEntityIds?: string[];
  previousFocusId?: string;
  /** Intent's focus — a hint, not a command. The current thought wins. */
  focusHint?: string;
  /**
   * Story decided by the Composition Agent. When present this is a hard
   * constraint: primary, membership and the spine cannot be second-guessed.
   * Occupancy (the six-node cap, stale fans) still runs inside that set.
   */
  composition?: CompositionPlan | null;
}

function live(world: WorldState): WorldEntity[] {
  return world.entities.filter((e) => isLiveEntityStatus(e.status));
}

function mapId(local: string, input: CleanInput): string | undefined {
  const mapped = input.idMap?.get(local);
  if (mapped && input.world.entities.some((e) => e.id === mapped)) return mapped;
  if (input.world.entities.some((e) => e.id === local)) return local;
  return undefined;
}

/** Entities this thought actually named, in world ids. */
function currentEntityIds(input: CleanInput): Set<string> {
  const ids = new Set<string>();
  for (const entity of input.delta.entities) {
    const id = mapId(entity.id, input);
    if (id) ids.add(id);
  }
  for (const rel of input.delta.relations) {
    const from = mapId(rel.source, input);
    const to = mapId(rel.target, input);
    if (from) ids.add(from);
    if (to) ids.add(to);
  }
  for (const id of input.newEntityIds ?? []) ids.add(id);
  const topic = input.delta.topicEntityId ? mapId(input.delta.topicEntityId, input) : undefined;
  if (topic) ids.add(topic);
  for (const entity of live(input.world)) {
    if (entity.lastTouchedSeq === input.world.seq) ids.add(entity.id);
  }
  return ids;
}

function currentRelationKeys(input: CleanInput): Set<string> {
  const keys = new Set<string>();
  for (const rel of input.delta.relations) {
    const from = mapId(rel.source, input);
    const to = mapId(rel.target, input);
    if (from && to) keys.add(`${from}|${rel.type}|${to}`);
  }
  for (const rel of input.world.relations) {
    if (rel.lastTouchedSeq === input.world.seq) keys.add(`${rel.source}|${rel.type}|${rel.target}`);
  }
  return keys;
}

function neighbors(world: WorldState, id: string): string[] {
  const out: string[] = [];
  for (const rel of world.relations) {
    if (rel.source === id) out.push(rel.target);
    else if (rel.target === id) out.push(rel.source);
  }
  return out;
}

/** Undirected hop distance from `from`, live entities only. */
function hopMap(world: WorldState, from: string): Map<string, number> {
  const liveIds = new Set(live(world).map((e) => e.id));
  const dist = new Map<string, number>([[from, 0]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i += 1) {
    const cur = queue[i];
    const d = dist.get(cur) ?? 0;
    for (const next of neighbors(world, cur)) {
      if (!liveIds.has(next) || dist.has(next)) continue;
      dist.set(next, d + 1);
      queue.push(next);
    }
  }
  return dist;
}

/**
 * Ordered/causal spine through the primary. A chain is only true whole, so
 * membership here may occupy remaining slots after the current sentence —
 * amputating "sign in -> load -> dashboard" down to the last two steps
 * because the first is two hops away is exactly the lie keepOrderedChainsWhole
 * exists to prevent. Capped by the occupancy budget, nearest first.
 */
function spineIds(world: WorldState, primaryId: string, eligible: Set<string>): Set<string> {
  const keep = new Set<string>([primaryId]);
  const spineRels = world.relations.filter((r) => SPINE.has(r.type) || ORDERING.has(r.type));
  if (!spineRels.length) return keep;
  for (let grew = true; grew; ) {
    grew = false;
    for (const rel of spineRels) {
      const hasS = keep.has(rel.source);
      const hasT = keep.has(rel.target);
      if (hasS === hasT) continue;
      const missing = hasS ? rel.target : rel.source;
      if (!eligible.has(missing)) continue;
      keep.add(missing);
      grew = true;
    }
  }
  return keep;
}

function degree(world: WorldState, id: string): number {
  let n = 0;
  for (const rel of world.relations) {
    if (rel.source === id || rel.target === id) n += 1;
  }
  return n;
}

function isEphemeral(entity: WorldEntity): boolean {
  return entity.type === "person" || entity.type === "time" || entity.type === "place";
}

const PRONOUN_LABEL = /^(i|me|we|us|my|myself|speaker)$/i;

function isComparativePeer(world: WorldState, a: string | undefined, b: string): boolean {
  if (!a) return false;
  return world.relations.some(
    (r) =>
      relationFamily(r.type) === "comparative" &&
      ((r.source === a && r.target === b) || (r.target === a && r.source === b)),
  );
}

function isKin(world: WorldState, a: string, b: string): boolean {
  return world.relations.some(
    (r) =>
      (r.type === "role_of" || r.type === "member_of" || r.type === "part_of") &&
      ((r.source === a && r.target === b) || (r.target === a && r.source === b)),
  );
}

/**
 * Never draw both "I" and a named person as two figures when they are the
 * same speaker. Kinship stays — mother is not a second drawing of Kenny.
 */
function speakerDuplicateIds(world: WorldState, keep: string[], primaryId: string | undefined): string[] {
  const living = live(world);
  const byId = new Map(living.map((e) => [e.id, e]));
  const persons = keep.map((id) => byId.get(id)).filter((e): e is WorldEntity => e?.type === "person");
  if (persons.length < 2) return [];
  const pronouns = persons.filter((p) => PRONOUN_LABEL.test(p.label));
  const named = persons.filter((p) => !PRONOUN_LABEL.test(p.label));
  if (!pronouns.length || !named.length) return [];
  const drops: string[] = [];
  for (const pronoun of pronouns) {
    const duplicate = named.some((n) => !isKin(world, pronoun.id, n.id));
    if (!duplicate) continue;
    if (pronoun.id === primaryId) {
      for (const n of named) {
        if (n.id !== primaryId && !isKin(world, pronoun.id, n.id)) drops.push(n.id);
      }
    } else {
      drops.push(pronoun.id);
    }
  }
  return [...new Set(drops)];
}

/**
 * An old "wants"/"relates_to" leaf hanging off the primary and nowhere
 * else — the fan that accumulated while the speaker listed desires. Current
 * sentence leaves are not fans; they are this thought.
 */
function isStaleFanLeaf(entityId: string, primaryId: string, world: WorldState, current: Set<string>): boolean {
  if (current.has(entityId)) return false;
  const links = world.relations.filter((r) => r.source === entityId || r.target === entityId);
  if (!links.length) return false;
  return links.every((r) => {
    const other = r.source === entityId ? r.target : r.source;
    if (other !== primaryId) return false;
    if (!FAN.has(r.type)) return false;
    return r.lastTouchedSeq < world.seq;
  });
}

function pickPrimary(input: CleanInput, current: Set<string>): string | undefined {
  const living = live(input.world);
  const liveIds = new Set(living.map((e) => e.id));
  const exists = (id?: string) => (id && liveIds.has(id) ? id : undefined);
  const currentLive = [...current].filter((id) => liveIds.has(id));

  /**
   * Elaboration keeps the subject. "Plan A's duration is 3 weeks" is still
   * a thought about Plan A; handing the board to "duration" would demote
   * the comparison the duration is a dimension of. A current entity that
   * cannot reach the incumbent at all is a change of topic, and wins.
   */
  const incumbent = exists(input.previousFocusId);
  if (incumbent && currentLive.length) {
    const hops = hopMap(input.world, incumbent);
    if (currentLive.some((id) => id === incumbent || (hops.get(id) ?? 99) <= 1)) return incumbent;
    // A new step on the same ordered/causal spine is still this story.
    // Hop distance would otherwise hand the board to the latest clause of
    // a four-step sequence and resize the head — the box the viewer has
    // been following.
    const spine = spineIds(input.world, incumbent, liveIds);
    if (currentLive.some((id) => spine.has(id))) return incumbent;
  } else if (incumbent && !currentLive.length) {
    return incumbent;
  }

  const hint = exists(input.focusHint);
  if (hint && currentLive.includes(hint)) return hint;
  if (hint && currentLive.some((id) => hopMap(input.world, hint).get(id) === 1)) return hint;

  const mappedTopic = input.delta.topicEntityId ? exists(mapId(input.delta.topicEntityId, input)) : undefined;
  if (mappedTopic && currentLive.includes(mappedTopic)) return mappedTopic;

  if (currentLive.length) {
    const byId = new Map(living.map((e) => [e.id, e]));
    const durable = currentLive.filter((id) => {
      const entity = byId.get(id);
      return entity && !isEphemeral(entity);
    });
    const pool = durable.length ? durable : currentLive;
    return [...pool].sort((a, b) => {
      const deg = degree(input.world, b) - degree(input.world, a);
      if (deg) return deg;
      return (byId.get(b)?.lastTouchedSeq ?? 0) - (byId.get(a)?.lastTouchedSeq ?? 0);
    })[0];
  }

  return exists(input.previousFocusId) ?? exists(input.snapshot.primary?.id) ?? living[0]?.id;
}

function relationLabel(rel: WorldRelation): string | undefined {
  if (rel.type === "wants") return "wants";
  if (rel.type === "prevents") return "prevents";
  if (rel.type === "refutes") return "refutes";
  if (rel.type === "greater_than") return "more";
  if (rel.type === "less_than") return "less";
  if (rel.type === "role_of") return rel.role;
  return undefined;
}

function boundReason(reason: string): string {
  return reason.length <= 200 ? reason : `${reason.slice(0, 199)}…`;
}

export function planClean(input: CleanInput): CleanPlan {
  const living = live(input.world);
  if (!living.length) return EMPTY_CLEAN_PLAN;

  const current = currentEntityIds(input);
  const currentRels = currentRelationKeys(input);
  const primaryId = pickPrimary(input, current);
  if (!primaryId) return EMPTY_CLEAN_PLAN;

  const hops = hopMap(input.world, primaryId);
  const onBoard = new Set(input.snapshot.nodes.map((n) => n.id));
  const eligible = new Set(living.map((e) => e.id));
  const spine = spineIds(input.world, primaryId, eligible);

  type Bucket = 0 | 1 | 2 | 3 | 4 | 5;
  const ranked: Array<{ id: string; bucket: Bucket; hop: number; seq: number; boarded: boolean }> = [];

  for (const entity of living) {
    const hop = hops.get(entity.id) ?? 99;
    let bucket: Bucket | null = null;
    if (entity.id === primaryId) bucket = 0;
    else if (current.has(entity.id)) bucket = hop <= 1 ? 1 : 2;
    else if (hop === 1 && !isStaleFanLeaf(entity.id, primaryId, input.world, current)) bucket = 3;
    else if (spine.has(entity.id) && onBoard.has(entity.id)) bucket = 4;
    // Boarded leftovers that are not this thought, not 1-hop, and not the
    // spine used to fill the cap and compete with the subject. They stay
    // in the world; they do not occupy a box.
    if (bucket === null) continue;
    ranked.push({
      id: entity.id,
      bucket,
      hop,
      seq: entity.lastTouchedSeq,
      boarded: onBoard.has(entity.id),
    });
  }

  ranked.sort((a, b) => a.bucket - b.bucket || b.seq - a.seq || Number(b.boarded) - Number(a.boarded));

  const keep: string[] = [];
  const keepSet = new Set<string>();
  for (const row of ranked) {
    if (keepSet.has(row.id)) continue;
    // Spine and this sentence may fill to MAX. Hop-1 support (bucket 3)
    // stops at PREFERRED so a tidy board is not packed with neighbours.
    if (row.bucket >= 3 && keep.length >= PREFERRED_CLEAN_NODES) continue;
    if (keep.length >= MAX_CLEAN_NODES) break;
    keepSet.add(row.id);
    keep.push(row.id);
  }

  if (!keepSet.has(primaryId) && keep.length) {
    keep[0] = primaryId;
    keepSet.clear();
    for (const id of keep) keepSet.add(id);
  } else if (!keepSet.has(primaryId)) {
    keep.unshift(primaryId);
    keepSet.add(primaryId);
    if (keep.length > MAX_CLEAN_NODES) {
      const dropped = keep.pop();
      if (dropped) keepSet.delete(dropped);
    }
  }

  for (const duplicate of speakerDuplicateIds(input.world, keep, primaryId)) {
    if (duplicate === primaryId) continue;
    const idx = keep.indexOf(duplicate);
    if (idx === -1) continue;
    keep.splice(idx, 1);
    keepSet.delete(duplicate);
  }

  const byId = new Map(input.snapshot.nodes.map((n) => [n.id, n]));
  const demote: string[] = [];
  const demoteSet = new Set<string>();
  const remove: string[] = [];
  const promote: string[] = [];
  const competing = input.snapshot.primary?.size ?? 0;
  const pushDemote = (id: string) => {
    if (id === primaryId || spine.has(id) || demoteSet.has(id) || !keepSet.has(id)) return;
    if (isComparativePeer(input.world, primaryId, id)) return;
    demoteSet.add(id);
    demote.push(id);
  };

  for (const node of input.snapshot.nodes) {
    if (!keepSet.has(node.id)) {
      remove.push(node.id);
      continue;
    }
    if (node.id === primaryId) continue;
    const hop = hops.get(node.id) ?? 99;
    const wasCentre = node.role === "primary" || (competing > 0 && node.size >= competing * 0.75);
    if (wasCentre || hop > 1 || node.role === "primary" || !hops.has(node.id)) pushDemote(node.id);
  }

  // Anything kept that is not the subject and not on the spine would
  // otherwise read as a peer. Demote it before Presentation ranks weight.
  for (const id of keep) pushDemote(id);

  for (const id of keep) {
    const node = byId.get(id);
    if (id === primaryId && input.snapshot.primary?.id !== id) {
      promote.push(id);
      continue;
    }
    if (!node) {
      promote.push(id);
      continue;
    }
    if (node.role === "periphery" && (hops.get(id) ?? 99) <= 1) promote.push(id);
  }

  const allowedRelations: CleanRelation[] = [];
  const seenRel = new Set<string>();
  for (const rel of input.world.relations) {
    if (!keepSet.has(rel.source) || !keepSet.has(rel.target)) continue;
    const key = `${rel.source}|${rel.type}|${rel.target}`;
    const pair = `${rel.source}|${rel.target}`;
    if (seenRel.has(pair)) continue;
    const isCurrent = currentRels.has(key);
    const touchesPrimary = rel.source === primaryId || rel.target === primaryId;
    const staleFan = FAN.has(rel.type) && rel.lastTouchedSeq < input.world.seq && !isCurrent;
    if (staleFan) continue;
    const spineLink = (SPINE.has(rel.type) || ORDERING.has(rel.type)) && spine.has(rel.source) && spine.has(rel.target);
    if (!isCurrent && !touchesPrimary && !spineLink) continue;
    seenRel.add(pair);
    const label = relationLabel(rel);
    allowedRelations.push(label ? { from: rel.source, to: rel.target, label } : { from: rel.source, to: rel.target });
  }

  const removedN = remove.length;
  const reason = boundReason(
    `primary ${primaryId}; keep ${keep.length}/${MAX_CLEAN_NODES}` +
      (removedN ? `; remove ${removedN}` : "") +
      (demote.length ? `; demote ${demote.length}` : ""),
  );

  const planned: CleanPlan = {
    primaryId,
    keep,
    demote,
    remove,
    promote,
    allowedRelations,
    maxNodes: MAX_CLEAN_NODES,
    reason,
  };
  return input.composition ? constrainCleanToComposition(planned, input.composition, input) : planned;
}

/**
 * Occupancy still decides how many boxes, but it cannot contradict the
 * story. Spine nodes stay; nothing outside `allowed` is kept; demotions
 * and removals the Composition Agent named are unioned in.
 */
function constrainCleanToComposition(clean: CleanPlan, composition: CompositionPlan, input: CleanInput): CleanPlan {
  if (!composition.primaryId && !composition.allowed.length) return clean;

  const liveIds = new Set(live(input.world).map((e) => e.id));
  const allowed = new Set(composition.allowed.filter((id) => liveIds.has(id)));
  const spineIds: string[] = [];
  for (const edge of composition.spine) {
    if (liveIds.has(edge.from) && !spineIds.includes(edge.from)) spineIds.push(edge.from);
    if (liveIds.has(edge.to) && !spineIds.includes(edge.to)) spineIds.push(edge.to);
  }
  const primaryId =
    (composition.primaryId && liveIds.has(composition.primaryId) ? composition.primaryId : undefined) ?? clean.primaryId;

  const keep: string[] = [];
  const keepSet = new Set<string>();
  const push = (id: string | undefined) => {
    if (!id || keepSet.has(id) || !allowed.has(id) || keep.length >= MAX_CLEAN_NODES) return;
    keepSet.add(id);
    keep.push(id);
  };
  push(primaryId);
  for (const id of spineIds) push(id);
  for (const id of clean.keep) push(id);
  for (const id of composition.allowed) push(id);

  if (primaryId && !keepSet.has(primaryId) && allowed.has(primaryId)) {
    if (keep.length >= MAX_CLEAN_NODES) {
      const dropped = keep.pop();
      if (dropped) keepSet.delete(dropped);
    }
    keep.unshift(primaryId);
    keepSet.add(primaryId);
  }

  const spineSet = new Set(spineIds);
  const demoteSet = new Set<string>();
  const demote: string[] = [];
  const pushDemote = (id: string) => {
    if (!keepSet.has(id) || id === primaryId || spineSet.has(id) || demoteSet.has(id)) return;
    demoteSet.add(id);
    demote.push(id);
  };
  for (const id of composition.demote) pushDemote(id);
  for (const id of clean.demote) pushDemote(id);

  const removeSet = new Set<string>();
  const remove: string[] = [];
  const pushRemove = (id: string) => {
    if (keepSet.has(id) || removeSet.has(id) || remove.length >= 48) return;
    removeSet.add(id);
    remove.push(id);
  };
  for (const id of composition.remove) pushRemove(id);
  for (const id of clean.remove) pushRemove(id);
  for (const node of input.snapshot.nodes) {
    if (!keepSet.has(node.id)) pushRemove(node.id);
  }

  const allowedRelations: CleanRelation[] = [];
  const seenRel = new Set<string>();
  const pushRel = (from: string, to: string, label?: string) => {
    if (!keepSet.has(from) || !keepSet.has(to)) return;
    const pair = `${from}|${to}`;
    if (seenRel.has(pair)) return;
    seenRel.add(pair);
    allowedRelations.push(label ? { from, to, label } : { from, to });
  };
  for (const edge of composition.spine) pushRel(edge.from, edge.to, edge.label);
  for (const rel of clean.allowedRelations) pushRel(rel.from, rel.to, rel.label);

  const promote = clean.promote.filter((id) => keepSet.has(id));
  if (primaryId && input.snapshot.primary?.id !== primaryId && !promote.includes(primaryId) && keepSet.has(primaryId)) {
    promote.unshift(primaryId);
  }

  for (const duplicate of speakerDuplicateIds(input.world, keep, primaryId)) {
    if (duplicate === primaryId) continue;
    const idx = keep.indexOf(duplicate);
    if (idx === -1) continue;
    keep.splice(idx, 1);
    keepSet.delete(duplicate);
    if (!remove.includes(duplicate)) remove.push(duplicate);
  }

  return {
    primaryId,
    keep,
    demote: demote.filter((id) => keepSet.has(id)),
    remove,
    promote: promote.filter((id) => keepSet.has(id)).slice(0, 6),
    allowedRelations: allowedRelations.filter((r) => keepSet.has(r.from) && keepSet.has(r.to)).slice(0, 16),
    maxNodes: MAX_CLEAN_NODES,
    reason: boundReason(`${clean.reason}; composed ${composition.primaryId ?? "—"}`),
  };
}

/**
 * Settled thoughts always run. Reflex never does — it is a one-entity
 * preview and must stay free. Anticipation runs only when the board is
 * already in violation, so a partial read cannot spend a clean pass on a
 * picture that is still within budget.
 */
export function shouldPoliceVisual(opts: {
  contextless?: boolean;
  segmentId: string;
  snapshot: BoardSnapshot;
}): boolean {
  if (!opts.contextless) return true;
  if (!opts.segmentId.startsWith("anticipate-")) return false;
  return snapshotNeedsPolice(opts.snapshot);
}
