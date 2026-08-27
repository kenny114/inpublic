/**
 * The Composition Agent: decide the single story of the current thought.
 *
 * It sits between structured meaning (the world + this delta) and the Clean
 * Agent. Clean still owns occupancy — six nodes, one hop, renderer gate —
 * but it is not allowed to pick a different subject, keep a second spine,
 * or add anything this plan rejected. The renderer is bound the same way.
 *
 * Deterministic, and cheap on purpose. The input is entities, relations and
 * a compact board snapshot, never pixels. A model looking at the same
 * graph would only add latency and a second opinion the layers below are
 * not allowed to take.
 */

import {
  isLiveEntityStatus,
  relationFamily,
  EMPTY_COMPOSITION_PLAN,
  type CompositionEdge,
  type CompositionPlan,
  type MeaningDelta,
  type WorldEntity,
  type WorldRelation,
  type WorldState,
} from "../schemas";
import { snapshotNeedsPolice, type BoardSnapshot } from "../clean/snapshot";

/**
 * Relations that can lie ON the spine. Causal/temporal edges are the path
 * itself. `wants` may open a spine when its target continues (I want a
 * startup that funds a life) — a spray of parallel wants is a fan, not a
 * second story.
 */
const STRONG_SPINE = new Set(["causes", "enables", "depends_on", "prevents", "precedes", "transforms_into"]);
const OPENING_SPINE = new Set(["wants"]);
const SPINE_TYPES = new Set([...STRONG_SPINE, ...OPENING_SPINE]);

const MAX_SPINE_NODES = 4;
const MAX_ALLOWED = 12;

export interface CompositionInput {
  snapshot: BoardSnapshot;
  delta: MeaningDelta;
  world: WorldState;
  /** local delta id -> world id, from applyDelta. */
  idMap?: Map<string, string>;
  newEntityIds?: string[];
  previousFocusId?: string;
  /** The story the previous settled thought chose — continuity, not a command. */
  previousComposition?: CompositionPlan | null;
  /** Intent's focus — a hint. The current thought and the incumbent win over it. */
  focusHint?: string;
}

function live(world: WorldState): WorldEntity[] {
  return world.entities.filter((e) => isLiveEntityStatus(e.status));
}

function mapId(local: string, input: CompositionInput): string | undefined {
  const mapped = input.idMap?.get(local);
  if (mapped && input.world.entities.some((e) => e.id === mapped)) return mapped;
  if (input.world.entities.some((e) => e.id === local)) return local;
  return undefined;
}

/** Entities this thought actually named, in world ids. */
function currentEntityIds(input: CompositionInput): Set<string> {
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

function neighbors(world: WorldState, id: string): string[] {
  const out: string[] = [];
  for (const rel of world.relations) {
    if (rel.source === id) out.push(rel.target);
    else if (rel.target === id) out.push(rel.source);
  }
  return out;
}

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

function degree(world: WorldState, id: string): number {
  let n = 0;
  for (const rel of world.relations) {
    if (rel.source === id || rel.target === id) n += 1;
  }
  return n;
}

function isStaleFanLeaf(entityId: string, primaryId: string, world: WorldState, current: Set<string>): boolean {
  if (current.has(entityId)) return false;
  const links = world.relations.filter((r) => r.source === entityId || r.target === entityId);
  if (!links.length) return false;
  return links.every((r) => {
    const other = r.source === entityId ? r.target : r.source;
    if (other !== primaryId) return false;
    if (!OPENING_SPINE.has(r.type) && r.type !== "relates_to") return false;
    return r.lastTouchedSeq < world.seq;
  });
}

function isComparativePeer(world: WorldState, a: string, b: string): boolean {
  return world.relations.some(
    (r) =>
      relationFamily(r.type) === "comparative" &&
      ((r.source === a && r.target === b) || (r.target === a && r.source === b)),
  );
}

function boundReason(reason: string): string {
  return reason.length <= 200 ? reason : `${reason.slice(0, 199)}…`;
}

function spineLabel(rel: WorldRelation): string | undefined {
  if (rel.type === "wants") return "wants";
  if (rel.type === "enables") return "enables";
  if (rel.type === "prevents") return "prevents";
  if (rel.type === "depends_on") return "depends on";
  if (rel.type === "causes") return "causes";
  if (rel.type === "refutes") return "refutes";
  return undefined;
}

function edgeFor(rel: WorldRelation): CompositionEdge {
  const label = spineLabel(rel);
  return label ? { from: rel.source, to: rel.target, label } : { from: rel.source, to: rel.target };
}

function nodesOnSpine(spine: CompositionEdge[]): string[] {
  const ids: string[] = [];
  for (const edge of spine) {
    if (!ids.includes(edge.from)) ids.push(edge.from);
    if (!ids.includes(edge.to)) ids.push(edge.to);
  }
  return ids;
}

interface Path {
  nodes: string[];
  edges: WorldRelation[];
}

function outgoingSpine(world: WorldState, from: string, liveIds: Set<string>): WorldRelation[] {
  return world.relations.filter((r) => r.source === from && SPINE_TYPES.has(r.type) && liveIds.has(r.target));
}

/** Directed simple paths of 2–4 nodes over spine relations, starting at `start`. */
function pathsFrom(world: WorldState, start: string, liveIds: Set<string>): Path[] {
  const found: Path[] = [];
  const walk = (nodes: string[], edges: WorldRelation[]) => {
    if (nodes.length >= 2) found.push({ nodes: [...nodes], edges: [...edges] });
    if (nodes.length >= MAX_SPINE_NODES) return;
    const from = nodes[nodes.length - 1];
    for (const rel of outgoingSpine(world, from, liveIds)) {
      if (nodes.includes(rel.target)) continue;
      walk([...nodes, rel.target], [...edges, rel]);
    }
  };
  walk([start], []);
  return found;
}

function scorePath(path: Path, primaryId: string, current: Set<string>, previous: CompositionEdge[]): number {
  let score = path.nodes.length * 10;
  if (path.nodes[0] === primaryId) score += 8;
  else if (path.nodes.includes(primaryId)) score += 3;

  for (let i = 0; i < path.edges.length; i += 1) {
    const rel = path.edges[i];
    if (STRONG_SPINE.has(rel.type)) score += 8;
    else if (OPENING_SPINE.has(rel.type)) {
      // A wants that continues into a cause/enable is the start of the story.
      // A wants that dead-ends is a fan leaf competing with the story.
      const continues = i < path.edges.length - 1 && STRONG_SPINE.has(path.edges[i + 1].type);
      score += continues ? 6 : 1;
    }
  }

  for (const id of path.nodes) {
    if (current.has(id)) score += 5;
  }

  const prevNodes = nodesOnSpine(previous);
  if (prevNodes.length) {
    const shares = path.nodes.filter((id) => prevNodes.includes(id)).length;
    score += shares * 3;
    if (prevNodes[0] && path.nodes[0] === prevNodes[0]) score += 6;
    if (previous.length && path.nodes[0] === previous[0].from && path.nodes[1] === previous[0].to) score += 4;
  }

  const earliest = Math.min(...path.edges.map((e) => e.firstSeenSeq));
  score -= earliest * 0.01;
  return score;
}

function pickBestPath(paths: Path[], primaryId: string, current: Set<string>, previous: CompositionEdge[]): Path | null {
  if (!paths.length) return null;
  const ranked = [...paths].sort((a, b) => {
    const ds = scorePath(b, primaryId, current, previous) - scorePath(a, primaryId, current, previous);
    if (ds) return ds;
    return a.nodes.join(">").localeCompare(b.nodes.join(">"));
  });
  return ranked[0];
}

function prependPrimary(path: Path, primaryId: string, world: WorldState, liveIds: Set<string>): Path {
  if (path.nodes[0] === primaryId || path.nodes.includes(primaryId)) return path;
  const link = world.relations.find(
    (r) => r.source === primaryId && r.target === path.nodes[0] && SPINE_TYPES.has(r.type) && liveIds.has(r.target),
  );
  if (!link) return path;
  const nodes = [primaryId, ...path.nodes];
  const edges = [link, ...path.edges];
  if (nodes.length <= MAX_SPINE_NODES) return { nodes, edges };
  return { nodes: nodes.slice(0, MAX_SPINE_NODES), edges: edges.slice(0, MAX_SPINE_NODES - 1) };
}

function extendPreviousSpine(
  world: WorldState,
  previous: CompositionEdge[],
  liveIds: Set<string>,
  current: Set<string>,
): Path | null {
  const prevNodes = nodesOnSpine(previous);
  if (prevNodes.length < 2) return null;
  const edges: WorldRelation[] = [];
  for (const step of previous) {
    const rel = world.relations.find(
      (r) => r.source === step.from && r.target === step.to && liveIds.has(r.source) && liveIds.has(r.target),
    );
    if (!rel) return null;
    edges.push(rel);
  }
  let nodes = [...prevNodes];
  const tail = nodes[nodes.length - 1];
  const extension = world.relations.find(
    (r) => r.source === tail && SPINE_TYPES.has(r.type) && liveIds.has(r.target) && !nodes.includes(r.target) && current.has(r.target),
  );
  const actuallyExtended = Boolean(extension);
  if (extension) {
    nodes = [...nodes, extension.target];
    edges.push(extension);
  }
  const involvesCurrent = nodes.some((id) => current.has(id));
  // Continuity is for a story this thought is still telling. An untouched
  // previous path must not beat a new chain that does not share a node.
  if (!actuallyExtended && !involvesCurrent) return null;
  if (nodes.length > MAX_SPINE_NODES) {
    // Keep the subject and the newest end; drop from the middle.
    const keepHead = nodes[0];
    const keepTail = nodes.slice(-(MAX_SPINE_NODES - 1));
    nodes = [keepHead, ...keepTail.filter((id) => id !== keepHead)].slice(0, MAX_SPINE_NODES);
    const nextEdges: WorldRelation[] = [];
    for (let i = 0; i < nodes.length - 1; i += 1) {
      const rel =
        edges.find((e) => e.source === nodes[i] && e.target === nodes[i + 1]) ??
        world.relations.find((r) => r.source === nodes[i] && r.target === nodes[i + 1] && SPINE_TYPES.has(r.type));
      if (rel) nextEdges.push(rel);
    }
    return { nodes, edges: nextEdges };
  }
  return { nodes, edges };
}

function pickSpine(
  world: WorldState,
  primaryId: string,
  current: Set<string>,
  previous: CompositionEdge[],
): Path | null {
  const liveIds = new Set(live(world).map((e) => e.id));
  const extended = extendPreviousSpine(world, previous, liveIds, current);
  const starts = new Set<string>([primaryId, ...current]);
  for (const node of nodesOnSpine(previous)) starts.add(node);

  const paths: Path[] = [];
  for (const start of starts) {
    if (!liveIds.has(start)) continue;
    for (const path of pathsFrom(world, start, liveIds)) {
      paths.push(prependPrimary(path, primaryId, world, liveIds));
    }
  }

  const throughPrimary = paths.filter((p) => p.nodes.includes(primaryId) || p.nodes[0] === primaryId);
  const pool = throughPrimary.length ? throughPrimary : paths;
  const best = pickBestPath(pool, primaryId, current, previous);

  if (extended && best) {
    const extendScore = scorePath(extended, primaryId, current, previous) + 4;
    if (extendScore >= scorePath(best, primaryId, current, previous)) return extended;
  }
  return best ?? extended;
}

/**
 * The person a wants-chain is ABOUT is the subject, not the thing wanted.
 * Clean's occupancy picker prefers durable concepts over people, which is
 * how "I want a startup" used to hand the board to the startup. Continuity
 * still wins: an incumbent that this thought still touches stays.
 */
function pickPrimary(input: CompositionInput, current: Set<string>): string | undefined {
  const living = live(input.world);
  const liveIds = new Set(living.map((e) => e.id));
  const exists = (id?: string) => (id && liveIds.has(id) ? id : undefined);
  const currentLive = [...current].filter((id) => liveIds.has(id));
  const byId = new Map(living.map((e) => [e.id, e]));

  const incumbent = exists(input.previousComposition?.primaryId) ?? exists(input.previousFocusId);
  if (incumbent && currentLive.length) {
    const hops = hopMap(input.world, incumbent);
    const reachable = currentLive.some((id) => id === incumbent || (hops.get(id) ?? 99) <= 2);
    if (reachable) return incumbent;
    const previousNodes = nodesOnSpine(input.previousComposition?.spine ?? []);
    if (currentLive.some((id) => previousNodes.includes(id))) return incumbent;
    const along = pickSpine(input.world, incumbent, current, input.previousComposition?.spine ?? []);
    if (along && currentLive.some((id) => along.nodes.includes(id))) return incumbent;
  } else if (incumbent && !currentLive.length) {
    return incumbent;
  }

  const mappedTopic = input.delta.topicEntityId ? exists(mapId(input.delta.topicEntityId, input)) : undefined;
  if (mappedTopic && currentLive.includes(mappedTopic)) return mappedTopic;

  const hint = exists(input.focusHint);
  if (hint && currentLive.includes(hint)) return hint;

  if (currentLive.length) {
    const wantSource = currentLive.find((id) => {
      const entity = byId.get(id);
      if (entity?.type !== "person" && entity?.type !== "group") return false;
      return input.world.relations.some((r) => r.source === id && OPENING_SPINE.has(r.type) && liveIds.has(r.target));
    });
    if (wantSource) return wantSource;

    const persons = currentLive.filter((id) => byId.get(id)?.type === "person");
    if (persons.length === 1) return persons[0];

    return [...currentLive].sort((a, b) => {
      const deg = degree(input.world, b) - degree(input.world, a);
      if (deg) return deg;
      return (byId.get(b)?.lastTouchedSeq ?? 0) - (byId.get(a)?.lastTouchedSeq ?? 0);
    })[0];
  }

  return incumbent ?? exists(input.snapshot.primary?.id) ?? living[0]?.id;
}

export function planComposition(input: CompositionInput): CompositionPlan {
  const living = live(input.world);
  if (!living.length) return EMPTY_COMPOSITION_PLAN;

  const current = currentEntityIds(input);
  const primaryId = pickPrimary(input, current);
  if (!primaryId) return EMPTY_COMPOSITION_PLAN;

  const previousSpine = input.previousComposition?.spine ?? [];
  const path = pickSpine(input.world, primaryId, current, previousSpine);
  const spine: CompositionEdge[] = path ? path.edges.map(edgeFor) : [];
  const spineNodes = path ? path.nodes : [primaryId];
  const spineSet = new Set(spineNodes);
  const liveIds = new Set(living.map((e) => e.id));
  const hopsFromSpine = new Map<string, number>();
  for (const id of spineNodes) {
    const hops = hopMap(input.world, id);
    for (const [other, d] of hops) {
      const prev = hopsFromSpine.get(other);
      if (prev === undefined || d < prev) hopsFromSpine.set(other, d);
    }
  }

  const onBoard = new Set(input.snapshot.nodes.map((n) => n.id));
  const allowed: string[] = [];
  const allowedSet = new Set<string>();
  const pushAllowed = (id: string | undefined) => {
    if (!id || !liveIds.has(id) || allowedSet.has(id) || allowed.length >= MAX_ALLOWED) return;
    allowedSet.add(id);
    allowed.push(id);
  };

  pushAllowed(primaryId);
  for (const id of spineNodes) pushAllowed(id);
  // This thought is the story being told. Occupancy (Clean) may still cap
  // it; composition must not amputate a clause because it was not on the
  // directed path — a book's chapters, a comparison's other pole, a second
  // tree stated in the same breath.
  for (const id of current) pushAllowed(id);

  const attachments: Array<{ id: string; seq: number }> = [];
  for (const entity of living) {
    if (allowedSet.has(entity.id)) continue;
    const hop = hopsFromSpine.get(entity.id) ?? 99;
    if (hop !== 1) continue;
    if (isStaleFanLeaf(entity.id, primaryId, input.world, current)) continue;
    if (!onBoard.has(entity.id)) continue;
    attachments.push({ id: entity.id, seq: entity.lastTouchedSeq });
  }
  attachments.sort((a, b) => b.seq - a.seq);
  for (const row of attachments) pushAllowed(row.id);

  const demote: string[] = [];
  const hasDirectedSpine = spine.length >= 1;
  for (const id of allowed) {
    if (id === primaryId || spineSet.has(id)) continue;
    if (isComparativePeer(input.world, primaryId, id)) continue;
    // Off-spine current nodes are periphery only when there is a path they
    // would otherwise compete with. With no spine, this thought's own
    // entities are the picture, not footnotes to it.
    if (!hasDirectedSpine && current.has(id)) continue;
    demote.push(id);
  }

  const remove: string[] = [];
  const removeSet = new Set<string>();
  const pushRemove = (id: string) => {
    if (allowedSet.has(id) || removeSet.has(id) || remove.length >= 48) return;
    removeSet.add(id);
    remove.push(id);
  };
  for (const node of input.snapshot.nodes) pushRemove(node.id);
  for (const id of current) pushRemove(id);

  const spineText = spine.length
    ? spine.map((e) => `${e.from}${e.label ? `-${e.label}->` : "->"}${e.to}`).join(" ")
    : primaryId;
  const reason = boundReason(
    `primary ${primaryId}; spine ${spineText}` +
      (demote.length ? `; demote ${demote.join(",")}` : "") +
      (remove.length ? `; remove ${remove.length}` : ""),
  );

  return {
    primaryId,
    spine,
    allowed,
    demote,
    remove,
    reason,
  };
}

/**
 * Settled thoughts always compose. Reflex never does. Anticipation composes
 * when the board is already over budget, or when the partial thought
 * already carries a directed story (two or more spine relations) — a
 * "strong" preview is worth a story decision; a one-entity preview is not.
 */
export function shouldCompose(opts: {
  contextless?: boolean;
  segmentId: string;
  snapshot: BoardSnapshot;
  delta?: MeaningDelta;
}): boolean {
  if (!opts.contextless) return true;
  if (!opts.segmentId.startsWith("anticipate-")) return false;
  if (snapshotNeedsPolice(opts.snapshot)) return true;
  const spineRels = (opts.delta?.relations ?? []).filter((r) => SPINE_TYPES.has(r.type));
  return spineRels.length >= 2;
}
