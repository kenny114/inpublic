/**
 * Visual horizon: a derived view of which world entities may compete for
 * scarce canvas space, and as what.
 *
 * World `importance` stays a graph/recency score used by identity, reference
 * and lifecycle. This module does not write it. Long meetings taught us that
 * degree-primary plus neighbourhood attachment freezes the board on the
 * densest early cluster, while recency-only would cycle whatever was just
 * said. The horizon is the third thing: current topic organises the picture,
 * standing decisions/problems/goals persist, historical and archived
 * entities remain in semantic memory but do not fill the budget.
 *
 * Tiers, coarsest first:
 *   primary     the current visual focus — one entity
 *   supporting  standing decisions, active problems, active goals
 *   contextual  live and recent, but not sticky
 *   historical  live, old, not sticky — still in the world
 *   archived    suspended / rejected / superseded
 */

import { isLiveEntityStatus, relationFamily, type WorldEntity, type WorldState } from "../schemas";

export type VisibilityTier = "primary" | "supporting" | "contextual" | "historical" | "archived";

/** Turns that still count as "what we are talking about now". Matches the salience stack bound. */
export const CURRENT_WINDOW = 8;
/**
 * Turns a standing decision/problem/goal may remain visually eligible after
 * last mention. Longer than CURRENT_WINDOW so a later topic does not wipe
 * the group's conclusions; shorter than the whole meeting so a losing
 * alternative that was last mentioned in the same breath as the winner
 * still ages out.
 */
export const PERSIST_WINDOW = 36;

export const TIER_RANK: Record<VisibilityTier, number> = {
  primary: 0,
  supporting: 1,
  contextual: 2,
  historical: 3,
  archived: 4,
};

export interface VisibilityAssignment {
  tier: Map<string, VisibilityTier>;
  focusId: string | undefined;
  persistIds: Set<string>;
}

export interface VisibilityOptions {
  newEntityIds?: string[];
  previousVisibleIds?: string[];
  /** The previous scene's visual focus — kept across a passing mention. */
  previousFocusId?: string;
  /** Intent's own focus, used only as a last-resort hint. */
  focusHint?: string;
  /**
   * Wall-clock time this round is being planned at, in the same unit as
   * InputSegment.timestamp (schemas.ts: "whatever unit the caller uses
   * consistently" — the live path uses Date.now() ms). Absent means no
   * wall-clock signal is available for this round: every check below that
   * depends on it is then a no-op, and visibility is exactly the turn-count
   * behavior this module always had. This is why every existing fixture and
   * test, none of which pass a real timestamp, is untouched by its
   * existence — see hasGoneIdle.
   */
  nowMs?: number;
}

/**
 * How long a NON-durable entity may sit idle, in REAL time, before "still
 * within the turn window" stops being good evidence that it's relevant. Long
 * enough that an ordinary pause — someone thinking, a slow typer, a sip of
 * coffee — never trips it; short enough to catch what CURRENT_WINDOW/
 * PERSIST_WINDOW cannot: a session left open with the mic idle for a while,
 * where almost no turns were ingested but a great deal of real time passed.
 * Turn-count windows are blind to that distinction by construction — they
 * only know how many segments arrived, never how long the gap between them
 * was — and a topic that a human would call closed can still read as
 * "recent" to a turn counter that barely moved. See live eval #3.
 */
const IDLE_GAP_MS = 15 * 60 * 1000;

/** The most recent wall-clock touch recorded for `entity`, if any — provenance is append-ordered, oldest-evicted, so the last entry is always the latest touch. */
function lastTouchedAtMs(entity: WorldEntity): number | undefined {
  return entity.provenance?.at(-1)?.timestamp;
}

/**
 * True when real time has clearly moved on since `entity` was last touched —
 * long enough that its place in a turn-count window is no longer trustworthy
 * evidence of relevance. False whenever the signal isn't available at all
 * (no timestamp anywhere for this entity, or the caller supplied none for
 * this round) or the gap is short — both cases must reproduce today's
 * turn-only behavior exactly, which is what keeps every timestamp-free
 * fixture and test byte-identical to before this existed.
 */
function hasGoneIdle(entity: WorldEntity, nowMs: number | undefined): boolean {
  if (nowMs === undefined) return false;
  const touchedAt = lastTouchedAtMs(entity);
  if (touchedAt === undefined) return false;
  return nowMs - touchedAt > IDLE_GAP_MS;
}

function degree(world: WorldState, id: string): number {
  let n = 0;
  for (const rel of world.relations) {
    if (rel.source === id || rel.target === id) n += 1;
  }
  return n;
}

function isActionish(entity: WorldEntity): boolean {
  return entity.type === "action" || entity.type === "event";
}

function isEphemeralType(entity: WorldEntity): boolean {
  return entity.type === "person" || entity.type === "time" || entity.type === "place";
}

/**
 * The losing arm of a resolved branch: same kind as a live rival, shares a
 * claim or a relation, and the rival is the world's structural primary.
 * The winner persists as the conclusion; the loser stays in memory.
 */
function isLosingAlternative(entity: WorldEntity, world: WorldState): boolean {
  if (!isActionish(entity) && entity.type !== "concept") return false;
  const primary = world.entities.find((e) => e.importance === "primary" && isLiveEntityStatus(e.status));
  if (!primary || primary.id === entity.id) return false;
  if (!isActionish(primary) && primary.type !== "concept") return false;
  if (entity.lastTouchedSeq > primary.lastTouchedSeq) return false;
  if (degree(world, primary.id) < degree(world, entity.id)) return false;

  const contrasts = world.relations.some(
    (r) =>
      r.type === "contrasts_with" &&
      ((r.source === entity.id && r.target === primary.id) || (r.target === entity.id && r.source === primary.id)),
  );
  const sharedClaim = world.claims.some(
    (c) => (c.about ?? []).includes(entity.id) && (c.about ?? []).includes(primary.id) && !c.invalidated,
  );
  if (contrasts || sharedClaim) return true;
  // Same-era competing actions: the decided primary is the surviving
  // conclusion even when the extractor never drew an explicit contrast edge.
  //
  // "Competing" is doing real work in that sentence, and without the guard
  // below this clause could not tell competition from CONNECTION. Two events
  // joined by a causal, ordering or structural edge are not rivals — they are
  // two parts of one structure, and the earlier one is not a losing
  // alternative to the later one just because the later one is now the
  // world's primary.
  //
  // That is not a corner case; it is what a chain growing over several turns
  // looks like from here. "Marketing creates traffic" then "traffic creates
  // signups": on the second turn `traffic` is the primary, `marketing` is
  // actionish, same era, lower degree — so `marketing` was archived to
  // historical, dropped out of `canvasEligible`, and vanished from a canvas
  // it had been sitting on a moment earlier. The picture then showed
  // "traffic -> signups" and the speaker's first claim was gone, which is
  // both a lost meaning and the single most jarring thing a live board can do
  // while someone is still talking about it.
  const connectedToPrimary = world.relations.some((r) => {
    if (!((r.source === entity.id && r.target === primary.id) || (r.target === entity.id && r.source === primary.id))) return false;
    const family = relationFamily(r.type);
    return family === "causal" || family === "temporal" || family === "structural";
  });
  if (connectedToPrimary) return false;
  return isActionish(entity) && isActionish(primary) && Math.abs(entity.firstSeenSeq - primary.firstSeenSeq) <= CURRENT_WINDOW;
}

function hasArchivedNeighbor(entity: WorldEntity, world: WorldState): boolean {
  for (const rel of world.relations) {
    const otherId = rel.source === entity.id ? rel.target : rel.target === entity.id ? rel.source : null;
    if (!otherId) continue;
    const other = world.entities.find((e) => e.id === otherId);
    if (other && !isLiveEntityStatus(other.status)) return true;
  }
  return false;
}

function hasMetricSignal(entity: WorldEntity): boolean {
  const metric = entity.metric;
  if (!metric) return false;
  if (metric.target) return true;
  return (metric.history?.length ?? 0) >= 2;
}

/**
 * How strongly `entity` is anchored as DURABLE understanding — an accepted
 * decision, an active problem, an active goal, or a surviving conclusion —
 * rather than merely a standing action that happens to still be live. Lower
 * is more durable.
 *
 * This is the smallest deterministic split between the two timescales the
 * board must track: durable understanding (decisions, problems, goals,
 * conclusions — ranked here) and working context (the current topic's
 * supporting detail — still ranked by recency, untouched by this function).
 * It reads only structural signals already computed elsewhere in this file
 * (metric target, an archived neighbour, entity type) — no new field, no new
 * extraction capability, no keyword matching on transcript text.
 *
 * Used ONLY to order competition for the persist reserve
 * (lib/expression/planner/plan.ts's attachRelatedEntities). It does not
 * change tier assignment above: a losing alternative or a bare mention does
 * not gain persistSticky just because it would rank well here, and an entity
 * whose status turns archived drops out of the supporting tier entirely
 * before this ranking is ever consulted — durability is lost the moment the
 * semantic state that earned it is gone, never by a slot-count decree.
 */
export function durabilityRank(entity: WorldEntity, world: WorldState): number {
  if (hasMetricSignal(entity)) return 0; // a stated target/threshold — an active goal
  if (hasArchivedNeighbor(entity, world) && (isActionish(entity) || entity.type === "object" || entity.type === "concept")) {
    return 1; // a decision or problem that outlived a rejected/superseded alternative — a surviving conclusion
  }
  if (isActionish(entity)) return 2; // a committed action / next step, no resolved alternative (yet)
  if (entity.type === "object") return 3;
  return 4; // a bare concept — the weakest standing-persist signal
}

function persistSticky(entity: WorldEntity, world: WorldState, seq: number, nowMs: number | undefined): boolean {
  if (!isLiveEntityStatus(entity.status)) return false;
  if (isEphemeralType(entity)) return false;
  if (isLosingAlternative(entity, world)) return false;
  // Durable understanding — the world's own structural primary, a stated
  // goal/target, or a decision/conclusion that outlived a rejected
  // alternative — survives a real idle gap on purpose: these are exactly
  // the standing decision / unresolved problem / active goal categories
  // live eval #3 was told to keep durable across long pauses, and none of
  // them derive their standing from "still within N turns" in the first
  // place, so a wall-clock gap has nothing to revoke.
  if (entity.importance === "primary") return true;
  if (hasMetricSignal(entity)) return true;
  if (hasArchivedNeighbor(entity, world) && (isActionish(entity) || entity.type === "object" || entity.type === "concept")) {
    return true;
  }
  // Below this point, the entity's only claim to persistence is "an
  // ordinary action/object, still within the turn window" — exactly the
  // generic-conversational-entity / supporting-detail case that SHOULD
  // decay once real time has clearly moved on, because a turn window can't
  // tell a 40-minute idle gap from a fast exchange that happened to stay
  // under PERSIST_WINDOW segments.
  if (hasGoneIdle(entity, nowMs)) return false;
  const age = seq - entity.lastTouchedSeq;
  // Objects and committed actions/events persist across a topic shift.
  // Bare concepts (including anaphoric leftovers like "the number") stay
  // contextual only while they are current — otherwise they occupy the
  // board without being a decision, problem, or goal.
  if ((isActionish(entity) || entity.type === "object") && age <= PERSIST_WINDOW) {
    return true;
  }
  return false;
}

/**
 * Details whose only remaining neighbours are already historical/archived
 * collapse with that branch rather than occupying a canvas slot of their own.
 */
function isCollapsedDetail(
  entity: WorldEntity,
  world: WorldState,
  tier: Map<string, VisibilityTier>,
  persist: Set<string>,
): boolean {
  if (persist.has(entity.id)) return false;
  const neighbors: string[] = [];
  for (const rel of world.relations) {
    if (rel.source === entity.id) neighbors.push(rel.target);
    else if (rel.target === entity.id) neighbors.push(rel.source);
  }
  if (!neighbors.length) return false;
  return neighbors.every((id) => {
    const t = tier.get(id);
    return t === "historical" || t === "archived";
  });
}

/**
 * How many relation hops still count as "the same piece of the world".
 *
 * Not unbounded: in a long meeting everything eventually connects to
 * everything, and an unbounded reachability test would say every new noun
 * elaborates the subject forever. Three hops is a subject, what it does,
 * and what that leads to — the span of one explanation.
 */
const COMPONENT_REACH = 3;

/** True when `from` reaches `to` within `hops` live relations, in either direction. */
function connectedWithin(world: WorldState, from: string, to: string, hops: number): boolean {
  if (from === to) return true;
  let frontier = new Set([from]);
  const seen = new Set([from]);
  for (let depth = 0; depth < hops; depth += 1) {
    const next = new Set<string>();
    for (const rel of world.relations) {
      const step = frontier.has(rel.source) ? rel.target : frontier.has(rel.target) ? rel.source : null;
      if (!step || seen.has(step)) continue;
      if (step === to) return true;
      seen.add(step);
      next.add(step);
    }
    if (!next.size) return false;
    frontier = next;
  }
  return false;
}

function pickFocus(
  world: WorldState,
  persist: Set<string>,
  opts: VisibilityOptions,
): string | undefined {
  const seq = world.seq;
  const newIds = new Set(opts.newEntityIds ?? []);
  const live = world.entities.filter((e) => isLiveEntityStatus(e.status) && !isLosingAlternative(e, world));
  if (!live.length) return undefined;

  const score = (entity: WorldEntity): number => {
    let s = 0;
    if (entity.lastTouchedSeq === seq) s += 4;
    if (newIds.has(entity.id)) s += 6;
    if ((world.salience ?? [])[0] === entity.id) s += 3;
    if (persist.has(entity.id)) s += 2;
    if (!isEphemeralType(entity)) s += 3;
    s += entity.lastTouchedSeq / 1000;
    return s;
  };

  const best = (pool: WorldEntity[]): WorldEntity | undefined =>
    [...pool].sort((a, b) => score(b) - score(a))[0];

  /**
   * The incumbent subject is asked FIRST, not third.
   *
   * This check used to sit below the persist and newly-introduced
   * branches, so it almost never ran: nearly every turn touches a standing
   * entity or introduces one, and both of those returned before the board
   * was ever asked whether it already had a subject. The result was a
   * subject that changed on most sentences while appearing to have a
   * hysteresis rule protecting it.
   *
   * The rule that matters is the same one either way — elaboration keeps
   * the subject, a genuinely new topic takes it — but it has to be applied
   * before anything else gets to answer. An incumbent that has gone
   * untouched for CURRENT_WINDOW turns stops defending its seat, which is
   * what keeps a long session from freezing on its first noun.
   */
  const incumbent = opts.previousFocusId ? live.find((e) => e.id === opts.previousFocusId) : undefined;
  if (incumbent && seq - incumbent.lastTouchedSeq <= CURRENT_WINDOW && !isEphemeralType(incumbent)) {
    const arrivals = live.filter((e) => e.lastTouchedSeq === seq && e.id !== incumbent.id && !isEphemeralType(e));
    const elaborates =
      !arrivals.length || arrivals.some((e) => connectedWithin(world, e.id, incumbent.id, COMPONENT_REACH));
    if (elaborates) return incumbent.id;
  }

  const persistNow = live.filter((e) => persist.has(e.id) && e.lastTouchedSeq === seq && !isEphemeralType(e));
  if (persistNow.length) return best(persistNow)?.id;

  const introduced = live.filter((e) => newIds.has(e.id) && !isEphemeralType(e));
  if (introduced.length) {
    /**
     * A NEW NOUN IS NOT A NEW SUBJECT.
     *
     * This used to hand the board to whatever was introduced most
     * recently, which meant the primary subject moved every single turn a
     * sentence contained a word the world had not heard before — i.e.
     * almost every turn. "I want to build a startup / that makes 100k /
     * that funds the life I want" is ONE story about one subject, and the
     * board re-subjected itself three times telling it, so nothing was
     * ever the point long enough to read as the point.
     *
     * The distinction that matters is not new-vs-old, it is ELABORATION
     * vs. a change of topic. An entity introduced into the same connected
     * piece of the world the current subject sits in is more of this
     * story; one that arrives with no path to it at all is the speaker
     * starting a different one. So the incumbent holds through the first
     * and yields to the second.
     *
     * The incumbent still has to be CURRENT to hold at all, which is what
     * stops a long session from freezing on its first noun: once the
     * speaker has left it alone for CURRENT_WINDOW turns it stops
     * defending the seat, whether or not the graph still connects.
     */
    // The incumbent already had its chance above; reaching here means it
    // either had none or this turn genuinely changed the subject.
    return best(introduced)?.id;
  }

  if (opts.previousFocusId) {
    const prev = live.find((e) => e.id === opts.previousFocusId);
    if (prev && (persist.has(prev.id) || seq - prev.lastTouchedSeq <= CURRENT_WINDOW)) return prev.id;
  }

  const current = live.filter((e) => seq - e.lastTouchedSeq <= CURRENT_WINDOW);
  const pool = current.length ? current : live;
  return best(pool)?.id;
}

export function assignVisibility(world: WorldState, opts: VisibilityOptions = {}): VisibilityAssignment {
  const seq = world.seq;
  const persistIds = new Set<string>();
  const tier = new Map<string, VisibilityTier>();
  /** Entities denied the durable reserve as the losing arm of a branch — see below. */
  const losing = new Set<string>();

  for (const entity of world.entities) {
    if (!isLiveEntityStatus(entity.status)) {
      tier.set(entity.id, "archived");
      continue;
    }
    if (persistSticky(entity, world, seq, opts.nowMs)) persistIds.add(entity.id);
  }

  for (const entity of world.entities) {
    if (tier.get(entity.id) === "archived") continue;
    if (isLosingAlternative(entity, world)) {
      persistIds.delete(entity.id);
      losing.add(entity.id);
    }
    const age = seq - entity.lastTouchedSeq;
    if (persistIds.has(entity.id)) {
      tier.set(entity.id, "supporting");
      continue;
    }
    // A losing alternative loses its RESERVED seat — which is what
    // isLosingAlternative is for ("the winner persists as the conclusion; the
    // loser stays in memory") — but not its existence. Sending it straight to
    // `historical` also removed it from `canvasEligible`, i.e. deleted it
    // from the canvas outright the very next turn, and one of the signals
    // that reaches this branch is a plain `contrasts_with`.
    //
    // A contrast is not a decision. "Plan A costs more than Plan B" makes
    // Plan B the loser by this test, so a comparison could not survive a
    // single further turn: the next sentence adding a dimension under Plan A
    // dropped Plan B off the horizon, which took the pole with it, which
    // re-chose the poles from what was left and redrew the whole thing.
    //
    // So a loser that is still CURRENT competes like any other contextual
    // entity, and ages out on the ordinary clock. Nothing gains persistence
    // here: it was already removed from persistIds above, so it never
    // reaches the durable reserve, and once it is past CURRENT_WINDOW it
    // falls through to `historical` exactly as it always did.
    // Same reasoning as persistSticky's idle gate: a plain "current" read
    // (age <= CURRENT_WINDOW) is turn-count evidence too, and a long real
    // idle gap undermines it exactly the same way. persistSticky already
    // exempted every durably-important entity before this loop ever runs,
    // so nothing durable is at risk here — only ordinary recent mentions
    // that outlived the session's actual pace, not its turn count.
    if (age <= CURRENT_WINDOW && !hasGoneIdle(entity, opts.nowMs)) {
      tier.set(entity.id, "contextual");
      continue;
    }
    tier.set(entity.id, "historical");
  }

  for (const entity of world.entities) {
    if (tier.get(entity.id) !== "contextual" && tier.get(entity.id) !== "supporting") continue;
    if (isCollapsedDetail(entity, world, tier, persistIds)) {
      persistIds.delete(entity.id);
      tier.set(entity.id, "historical");
    }
  }

  for (const id of losing) persistIds.delete(id);

  const focusId = pickFocus(world, persistIds, opts);
  if (focusId) {
    tier.set(focusId, "primary");
    persistIds.add(focusId);
  }

  return { tier, focusId, persistIds };
}

export function canvasEligible(
  entityId: string,
  vis: VisibilityAssignment,
  world: WorldState,
  opts: VisibilityOptions,
): boolean {
  const t = vis.tier.get(entityId);
  if (!t || t === "archived") return false;
  if (t === "primary" || t === "supporting" || t === "contextual") return true;
  const entity = world.entities.find((e) => e.id === entityId);
  if (!entity) return false;
  const newIds = opts.newEntityIds ?? [];
  return entity.lastTouchedSeq === world.seq || newIds.includes(entityId);
}

/**
 * Relations whose meaning is an ORDER: each one asserts that its two ends
 * occupy successive positions in one chain. Deliberately narrow — a causal
 * or structural edge says two things are related, which survives one of them
 * ageing out; an ordering edge says where a thing sits in a run, which does
 * not.
 */
const ORDERING_RELATIONS = new Set(["precedes", "transforms_into"]);

/**
 * Re-admits the steps that hold a visible chain together.
 *
 * The horizon is a recency rule, and recency amputates a sequence from the
 * front. "First the user signs in", then a turn later "then we load their
 * projects", then "and finally we open the dashboard": by the last turn
 * `sign in` is live but historical, so it fell out of the view the grammars
 * see. The sequence grammar then honestly reported two ordered steps and
 * drew a process that begins at "load projects" — a statement the speaker
 * never made, and worse than showing nothing, because it reads as complete.
 *
 * A chain is only true whole, so membership propagates along ordering edges
 * until it stops growing. Only LIVE entities are re-admitted: a step the
 * speaker retracted stays out, because that is a claim about the world
 * rather than about how recently it was mentioned.
 *
 * Budget is deliberately not handled here. A chain longer than the region
 * budget is trimmed from the MIDDLE by the grammars (trimChain), which keeps
 * the true first and last steps — the two this function exists to protect.
 */
function keepOrderedChainsWhole(world: WorldState, keep: Set<string>): void {
  const live = new Set(world.entities.filter((e) => isLiveEntityStatus(e.status)).map((e) => e.id));
  const ordering = world.relations.filter((r) => ORDERING_RELATIONS.has(r.type));
  if (!ordering.length) return;

  for (let grew = true; grew; ) {
    grew = false;
    for (const rel of ordering) {
      const hasSource = keep.has(rel.source);
      const hasTarget = keep.has(rel.target);
      if (hasSource === hasTarget) continue;
      const missing = hasSource ? rel.target : rel.source;
      if (!live.has(missing)) continue;
      keep.add(missing);
      grew = true;
    }
  }
}

/**
 * A world the grammars may look at: historical/archived entities are gone,
 * so a causal spine or a scene neighbourhood cannot be the densest old
 * cluster. The real world is unchanged.
 */
export function horizonWorld(world: WorldState, vis: VisibilityAssignment, opts: VisibilityOptions): WorldState {
  const keep = new Set(
    world.entities.filter((e) => canvasEligible(e.id, vis, world, opts)).map((e) => e.id),
  );
  if (vis.focusId) keep.add(vis.focusId);
  keepOrderedChainsWhole(world, keep);
  return {
    ...world,
    entities: world.entities.filter((e) => keep.has(e.id)),
    relations: world.relations.filter((r) => keep.has(r.source) && keep.has(r.target)),
    claims: world.claims.filter((c) => !c.about?.length || c.about.some((id) => keep.has(id))),
    salience: (world.salience ?? []).filter((id) => keep.has(id)),
  };
}
