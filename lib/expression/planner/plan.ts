/**
 * The expression planner: WorldState + ExpressionIntent -> ExpressionPlan.
 *
 * Decides what should EXIST visually, what should be connected, what should
 * dominate and what should be grouped — and still not where anything goes.
 * Deterministic; the model is three layers upstream by now and has no say
 * here.
 *
 * The planner is thin on purpose. Choosing regions and connections is the
 * grammar's job (lib/expression/grammars/index.ts); this module chooses the
 * grammar, walks the fallback chain when a grammar finds nothing to build,
 * and then adds the two things no single grammar can decide because they
 * depend on the round rather than the structure:
 *
 *  - EMPHASIS, which is about what just changed. A grammar sees a world; it
 *    cannot know that Mariam is the thing that arrived this second and so
 *    deserves to be the thing your eye lands on.
 *  - ANNOTATIONS, the claims that never became structure. They attach to a
 *    region as a note; they never become boxes, because a claim rendered as
 *    a box is a caption pretending to be a concept.
 *  - HORIZON, which is about which of a long world's entities may compete
 *    for the display budget. World importance is a graph score used by
 *    identity; the visual tiers in visibility.ts are a derived view so a
 *    30-minute meeting does not freeze on its densest early cluster.
 */

import { applyCleanToPlan } from "../clean/apply";
import {
  ANNOTATION_BUDGET,
  GRAMMARS,
  GRAMMAR_FOR_INTENT,
  REGION_BUDGET,
  type GrammarResult,
} from "../grammars";
import {
  relationFamily,
  EMPTY_EXPRESSION_PLAN,
  ExpressionPlanSchema,
  type CleanPlan,
  type Connection,
  type Emphasis,
  type ExpressionIntent,
  type ExpressionPlan,
  type GrammarId,
  type Region,
  type WorldEntity,
  type WorldState,
} from "../schemas";
import {
  CURRENT_WINDOW,
  TIER_RANK,
  assignVisibility,
  canvasEligible,
  durabilityRank,
  horizonWorld,
  type VisibilityAssignment,
  type VisibilityOptions,
} from "./visibility";

export interface PlanOptions {
  /** Entities added by the round that produced this world — the basis for "look here now". */
  newEntityIds?: string[];
  /** Forces a grammar; used by repair (lib/expression/evaluate/repair.ts) and by the debug UI. */
  grammarOverride?: GrammarId;
  /**
   * Entity ids visible on the previous scene — hysteresis so a standing
   * decision does not flicker out the moment the speaker takes a breath.
   */
  previousVisibleIds?: string[];
  /** Visual focus of the previous plan — a passing mention must not steal it. */
  previousFocusId?: string;
  /** Threaded straight through to visibility.ts's VisibilityOptions.nowMs — see its doc comment. */
  nowMs?: number;
  /**
   * Occupancy and hierarchy decision from the Clean Agent. When present,
   * this module still chooses the grammar, but membership, allowed lines
   * and the single dominant emphasis are taken from the clean plan — the
   * planner is no longer the last word on what stays on the board.
   */
  cleanPlan?: CleanPlan;
}

/**
 * A grammar "found something" when it produced at least one region. A
 * grammar that returns nothing is not a failure — it is correctly reporting
 * that this world has no such structure, which is exactly when the fallback
 * chain should move on rather than force the shape.
 */
function firstUsable(
  world: WorldState,
  focusEntityId: string | undefined,
  chain: GrammarId[],
): { grammar: GrammarId; result: GrammarResult; skipped: GrammarId[] } | null {
  const skipped: GrammarId[] = [];
  for (const id of chain) {
    const result = GRAMMARS[id].build({ world, focusEntityId });
    if (result.regions.length) return { grammar: id, result, skipped };
    skipped.push(id);
  }
  return null;
}

/**
 * Emphasis is ranked, not boolean: weight 3 is "this is the point", 2 is
 * "this just arrived", 1 is "this is the subject". Capped at three entries
 * because a picture where everything is emphasised has no hierarchy at all
 * — which is precisely the failure the evaluator flags as `no_focus`.
 */
function buildEmphasis(regions: Region[], focusEntityId: string | undefined, world: WorldState): Emphasis[] {
  const emphasis: Emphasis[] = [];
  const seen = new Set<string>();
  const add = (region: Region | undefined, weight: number, reason: string) => {
    if (!region || seen.has(region.id) || emphasis.length >= 3) return;
    seen.add(region.id);
    emphasis.push({ regionId: region.id, weight, reason });
  };

  /**
   * ONE THING IS BIG.
   *
   * There used to be two claims on the eye: the subject at weight 2, and
   * whatever was newly introduced at weight 3 — so the largest box was
   * whatever the last clause mentioned, the subject sat visually beneath
   * it, and the hierarchy inverted on most sentences. Two competing
   * emphases is not a hierarchy; it is a tie.
   *
   * Recency is no longer encoded as size at all. It does not need to be:
   * new ink APPEARS, which is the strongest recency cue a live board has,
   * and it appears next to something that is unmistakably the point.
   * Dropping it also makes the picture hold still — a box that was
   * emphasised for one turn and then demoted changes size, and a box that
   * changes size moves everything around it.
   */
  add(
    regions.find((r) => r.entityId === focusEntityId) ??
      regions.find((r) => r.role === "primary_subject" || r.role === "hierarchy_root"),
    3,
    "the subject of the board",
  );

  /**
   * A contrast is a claim that two things are the SAME KIND of thing,
   * being weighed against each other. Drawing one of them half the size of
   * the other unsays that — the picture stops reading as a comparison and
   * starts reading as a thing with a footnote, which is a different
   * sentence from the one that was spoken.
   *
   * So when the subject is one pole of a stated comparison, the other pole
   * matches it. This is the one place a second element is allowed to be as
   * large as the subject, and it is allowed precisely because the two are
   * one figure rather than two competing ones.
   */
  if (focusEntityId) {
    for (const relation of world.relations) {
      if (relationFamily(relation.type) !== "comparative") continue;
      const other =
        relation.source === focusEntityId ? relation.target : relation.target === focusEntityId ? relation.source : null;
      if (!other) continue;
      add(regions.find((r) => r.entityId === other), 3, "the other pole of a stated comparison");
    }
  }
  return emphasis;
}

/**
 * One word per fan of identical arrows.
 *
 * A live session about one intention produces a spray of arrows from the
 * same shape carrying the same verb — "I wants something", "I wants
 * building something", "I wants a startup" — and the third caption
 * communicates nothing the first two did not, while costing exactly as
 * much room and attention. Position cannot carry "wants", which is why
 * the word is drawn at all (grammars/index.ts's connectionLabel); but a
 * fan of parallel arrows from one source reads as one kind of tie, so the
 * word only has to appear once for the whole fan to say it.
 *
 * Keyed on source AND label, so a shape with genuinely different outgoing
 * relations still labels each of them.
 */
function dedupeFanLabels(connections: Connection[]): Connection[] {
  const seen = new Set<string>();
  return connections.map((connection) => {
    if (!connection.label) return connection;
    const key = `${connection.fromRegionId}|${connection.label}`;
    if (!seen.has(key)) {
      seen.add(key);
      return connection;
    }
    const { label: _label, ...rest } = connection;
    return rest;
  });
}

/**
 * Claims become annotation regions hanging off whatever they are about.
 * A claim about nothing shown is dropped rather than floated: an unattached
 * note is a sentence on a canvas, and the whole point is not to write
 * sentences on the canvas.
 *
 * Two rules beyond that, both learned from a 118-turn board that ended with
 * three separate small-print notes stacked under one box:
 *
 * NEWEST FIRST. `world.claims` is append-ordered, so taking the first three
 * that anchor to something shown took the three OLDEST — a board late in a
 * session was annotated with what had been said near the start of it, in
 * text too small to read and about a turn nobody was on any more.
 *
 * ONE PER ANCHOR. Three notes on one shape do not read as three facts;
 * they read as a paragraph, and a paragraph on a diagram is the failure
 * this whole engine exists to avoid. A second claim about the same thing
 * waits for a turn when it is the freshest thing said about it.
 */
function buildAnnotations(world: WorldState, regions: Region[]): Region[] {
  const shownEntityIds = new Set(regions.map((r) => r.entityId).filter(Boolean) as string[]);
  const out: Region[] = [];
  const anchored = new Set<string>();
  for (let i = world.claims.length - 1; i >= 0; i -= 1) {
    const claim = world.claims[i];
    if (out.length >= ANNOTATION_BUDGET) break;
    // An invalidated claim ("no, that's wrong") is kept for provenance, same
    // as everything else that is archived rather than deleted, but it must
    // not keep asserting itself on the canvas as if it were still believed.
    if (claim.invalidated) continue;
    const anchor = (claim.about ?? []).find((id) => shownEntityIds.has(id));
    if (!anchor || anchored.has(anchor)) continue;
    anchored.add(anchor);
    out.push({ id: `a-${claim.id}`.slice(0, 48), role: "annotation", claimId: claim.id, entityId: anchor });
  }
  return out;
}

/**
 * Fill the display budget with what the speaker actually connected.
 *
 * The thing the utterance is ABOUT must be on the canvas, and so should
 * anything else related to what is already shown while there is room.
 *
 * Every grammar selects for its own structure, and a grammar that finds its
 * structure is entitled to ignore whatever does not participate in it — but
 * not when the thing it ignored is the subject. "Cheap software is not always
 * cheaper, because maintenance exceeds the purchase price" is a comparison
 * between maintenance and purchase price, so the comparison grammar drew
 * exactly those two and dropped the software the argument was about. The
 * picture compared two numbers and never said what for.
 *
 * Fixed here rather than in the comparison grammar because it is not a fact
 * about comparisons: any grammar can select a structure that excludes the
 * subject, and each one would need the same patch. The focus is re-attached
 * as context, with whatever real relations connect it to what is already
 * shown — never with an invented one, so a focus with no relation to the
 * structure appears beside it rather than being wired in falsely.
 */
/**
 * How many regions may be added AROUND whatever the grammar drew.
 *
 * The grammar's own output is one idea with a shape — a chain, a
 * hierarchy, two poles — and it is bounded by REGION_BUDGET. This bounds
 * the second, much less disciplined source of boxes: the surrounding
 * material this function attaches. That used to be bounded only by the
 * total, which meant a two-region scene grew six neighbours every round
 * purely because there was room, and the room was the only reason.
 *
 * Two. Enough for the subject to be shown with what it bears on, not
 * enough for a page of loosely-related phrases to assemble itself around
 * the thing actually being said.
 */
const CONTEXT_BUDGET = 2;

/**
 * How many turns back still counts as "just said" for the purpose of
 * keeping a seat without being tied to the subject. Two: the sentence
 * before this one, and the one before that.
 */
const RECENT_CONTEXT_TURNS = 2;

function attachRelatedEntities(
  world: WorldState,
  intent: ExpressionIntent,
  result: GrammarResult,
  vis: VisibilityAssignment,
  visOpts: VisibilityOptions,
): GrammarResult {
  const eligible = world.entities.filter((e) => canvasEligible(e.id, vis, world, visOpts));
  const regions = [...result.regions];
  const connections = [...result.connections];
  const shown = new Set(regions.map((r) => r.entityId).filter(Boolean) as string[]);
  const attached: string[] = [];
  const previous = new Set(visOpts.previousVisibleIds ?? []);

  /** Every real relation between `id` and something already shown. Never an invented one. */
  const linksTo = (id: string) =>
    world.relations.filter((r) => (r.source === id && shown.has(r.target)) || (r.target === id && shown.has(r.source)));

  /**
   * Starts a new component: the same attach, without requiring a link to
   * what is already shown.
   *
   * Offered ONLY to material spoken this turn (see below). One sentence
   * can legitimately state two separate things — "platform contains infra
   * and tooling; product contains web and mobile" is two trees, and the
   * second one has nothing to attach to until it exists. What this must
   * never again do is seed from the ACCUMULATION: an old entity placed on
   * the canvas unconnected, purely so the next pass would have something
   * to link to and the budget would fill.
   */
  const seedComponent = (id: string) => {
    if (shown.has(id) || regions.length >= REGION_BUDGET) return;
    shown.add(id);
    attached.push(id);
    regions.push({ id: `r-${id}`.slice(0, 48), role: "context", entityId: id });
  };

  const attach = (id: string, role: Region["role"]) => {
    if (shown.has(id) || regions.length >= REGION_BUDGET) return;
    const links = linksTo(id);
    // The focus earns its place even unlinked — it is what the utterance is
    // about. Anything else has to be connected to something on the canvas,
    // or it would land as a floating box asserting nothing.
    if (!links.length && id !== intent.focusEntityId) return;
    shown.add(id);
    attached.push(id);
    regions.push({ id: `r-${id}`.slice(0, 48), role, entityId: id });
    for (const relation of links.slice(0, 4)) {
      if (connections.some((c) => c.relationId === relation.id)) continue;
      connections.push({
        id: `c-${relation.id}`.slice(0, 48),
        fromRegionId: `r-${relation.source}`.slice(0, 48),
        toRegionId: `r-${relation.target}`.slice(0, 48),
        relationId: relation.id,
        kind: relationFamily(relation.type) === "causal" ? "flow" : "link",
        label: CONNECTION_LABEL[relation.type] ?? (relation.type === "role_of" ? relation.role : undefined),
      });
    }
  };

  const rankEntity = (entity: WorldEntity): number => {
    const tier = vis.tier.get(entity.id) ?? "historical";
    // Already-visible entities keep their seats: a live board that swaps a
    // contextual box for a different equally-ranked neighbour every turn is
    // the occupancy-at-capacity flicker (eval #1/#3). Previous-visible
    // hysteresis used to apply only to primary/supporting; extending it to
    // working context is what stops the rotating pool without raising the
    // budget. Recency still breaks ties among things that were NOT on the
    // last scene.
    const prevBonus = previous.has(entity.id) ? -0.5 : 0;
    // The durable reserve (supporting tier) is ranked by semantic
    // persistence strength, not by the clock: a resolved decision from
    // twenty minutes ago must not lose its reserved seat to a fresher
    // standing item just because time passed. Recency plays no part here —
    // ties fall back to array order (world.entities, oldest first), so an
    // established anchor also wins a genuine tie over a newer one.
    if (tier === "supporting") return TIER_RANK.supporting + durabilityRank(entity, world) / 10 + prevBonus;
    return TIER_RANK[tier] + prevBonus - entity.lastTouchedSeq / 1000;
  };

  const ranked = (predicate: (e: WorldEntity) => boolean = () => true) =>
    eligible
      .filter((e) => !shown.has(e.id) && predicate(e))
      .sort((a, b) => rankEntity(a) - rankEntity(b));

  const isPersist = (entity: WorldEntity) => vis.persistIds.has(entity.id) || vis.tier.get(entity.id) === "primary";
  const canSeedCurrent = (entity: WorldEntity): boolean => {
    if (isPersist(entity)) return true;
    if (entity.firstSeenSeq === world.seq) return true;
    if (previous.has(entity.id)) return true;
    return false;
  };

  const isStandingPersist = (entity: WorldEntity) =>
    isPersist(entity) && world.seq - entity.lastTouchedSeq > CURRENT_WINDOW;

  const persistWaiting = eligible.filter((e) => isStandingPersist(e) && !shown.has(e.id)).length;
  const persistReserve = Math.min(PERSIST_RESERVE, persistWaiting);
  const currentCap = Math.max(1, REGION_BUDGET - persistReserve);

  if (regions.length > currentCap) {
    const droppable = [...regions].filter((r) => {
      if (!r.entityId || r.entityId === vis.focusId || r.role === "primary_subject") return false;
      const entity = world.entities.find((e) => e.id === r.entityId);
      if (!entity) return true;
      return !isStandingPersist(entity);
    });
    const drop = new Set(droppable.slice(-(regions.length - currentCap)).map((r) => r.id));
    for (let i = regions.length - 1; i >= 0 && regions.length > currentCap; i -= 1) {
      if (!drop.has(regions[i].id)) continue;
      const gone = regions.splice(i, 1)[0];
      if (gone.entityId) shown.delete(gone.entityId);
    }
    const kept = new Set(regions.map((r) => r.id));
    for (let i = connections.length - 1; i >= 0; i -= 1) {
      if (!kept.has(connections[i].fromRegionId) || !kept.has(connections[i].toRegionId)) connections.splice(i, 1);
    }
  }

  if (intent.focusEntityId) attach(intent.focusEntityId, "primary_subject");

  /**
   * THE BUDGET IS A CEILING, NOT A TARGET.
   *
   * What used to be here was two loops that ran until the board was FULL:
   * attach anything that links to anything already shown, and when nothing
   * linked, `seedComponent` put an unconnected entity on the canvas anyway
   * so the next pass would have something new to link to. A board is
   * therefore always at capacity, and most of what filled it was neither
   * about the subject nor connected to it — every phrase the session had
   * ever produced, ranked and poured in until the quota was met. That is
   * the fragmented, overlapping, competing picture: not a layout failure,
   * a selection failure.
   *
   * What replaces it is one rule. The subject is on the canvas, and so is
   * what the subject is DIRECTLY TIED TO, best first, while there is room.
   * Nothing else. A thing two hops away is part of the world, not part of
   * this picture — the world still knows it, and it comes back the moment
   * the speaker makes it the subject.
   *
   * There is no seeding of unconnected components any more. A box with no
   * relation to anything on the page cannot reinforce a story, and a page
   * of them is the concept map this engine is not supposed to draw.
   */
  const subjectId = intent.focusEntityId ?? vis.focusId;
  const spokenThisTurn = (entity: WorldEntity) => entity.lastTouchedSeq === world.seq;
  const tiedToSubject = (entity: WorldEntity): boolean =>
    Boolean(subjectId) &&
    world.relations.some(
      (r) => (r.source === subjectId && r.target === entity.id) || (r.target === subjectId && r.source === entity.id),
    );

  /**
   * WHAT WAS JUST SAID, AND THEN ALMOST NOTHING ELSE.
   *
   * These two loops used to be one, over everything the world still held,
   * and it ran until the board was FULL — attach whatever links to
   * whatever is shown, and when nothing links, seed an unconnected box so
   * the next pass has something to link to. The board was therefore always
   * at capacity, and most of what filled it was neither this sentence nor
   * about the subject; it was every phrase the session had produced,
   * ranked and poured in because there was room. That is the fragmented,
   * competing picture — a selection failure, not a layout one.
   *
   * The two sources are not the same thing and no longer share a rule:
   *
   *  - THIS TURN'S MATERIAL is the sentence being spoken. It goes on in
   *    full, up to the structural budget, because dropping half of it
   *    would draw a picture of half a thought. It still has to connect —
   *    a box with no relation to anything on the page says nothing — and
   *    it is attached repeatedly so a chain stated in one breath ("the
   *    book has three parts, and the first part has four chapters")
   *    assembles in whatever order its links allow.
   *
   *  - EVERYTHING OLDER is the accumulation, and it is what made boards
   *    unreadable. It must be tied DIRECTLY to the subject, and there is
   *    room for CONTEXT_BUDGET of it. Something two hops from the subject
   *    is part of the world, not part of this picture; the world still
   *    knows it and it returns the moment the speaker makes it the point.
   *
   * Nothing seeds an unconnected component any more. A box unrelated to
   * anything on the page cannot reinforce a story, and a page of them is
   * the concept map this engine exists not to draw.
   */
  /**
   * "Touched this turn" is not quite "said this turn", and the difference
   * is a passing recall: "by the way, go back to the original problem for
   * a second" touches an archived entity without asking for it to be
   * drawn. `canSeedCurrent` already draws exactly this line elsewhere in
   * this function — new this turn, or already on the page, or standing —
   * so the current moment is defined once and read twice.
   */
  const saidThisTurn = (entity: WorldEntity) => spokenThisTurn(entity) && canSeedCurrent(entity);

  for (let pass = 0; pass < REGION_BUDGET && regions.length < currentCap; pass += 1) {
    const before = attached.length;
    for (const entity of ranked(saidThisTurn)) {
      if (regions.length >= currentCap) break;
      attach(entity.id, "context");
    }
    if (attached.length > before) continue;
    // Nothing left that links to the page, but the sentence is not done:
    // whatever it still has to say starts its own component.
    const seed = ranked(saidThisTurn)[0];
    if (!seed) break;
    seedComponent(seed.id);
  }

  const contextCap = regions.length + CONTEXT_BUDGET;
  for (const entity of ranked((e) => !saidThisTurn(e) && tiedToSubject(e) && !isStandingPersist(e))) {
    if (regions.length >= Math.min(currentCap, contextCap)) break;
    attach(entity.id, "context");
  }

  /**
   * The breath before this one.
   *
   * Requiring a tie to the subject is right for the ACCUMULATION and
   * wrong for the sentence immediately behind the current one: "we're at
   * 80% of our target" followed by "the goal is $10k MRR" is two things
   * with no relation between them, and dropping the first one sentence
   * later is not selectivity, it is forgetting out loud. So the last
   * couple of turns may hold a seat unconnected — within CONTEXT_BUDGET,
   * which means at most a seat or two, and only for as long as it takes
   * the conversation to move on.
   *
   * Anything touched THIS turn is already settled by the rules above; this
   * is only about what was said just before, which is also why a passing
   * recall of an archived topic cannot arrive through here.
   */
  for (const entity of ranked((e) => !spokenThisTurn(e) && world.seq - e.lastTouchedSeq <= RECENT_CONTEXT_TURNS)) {
    if (regions.length >= Math.min(currentCap, contextCap)) break;
    if (!shown.has(entity.id)) seedComponent(entity.id);
  }

  // The durable reserve keeps its seats — a standing decision or an open
  // problem outlives the sentence that raised it — but within the same
  // bound as everything else that is not this turn's own material.
  for (const entity of ranked(isStandingPersist)) {
    if (regions.length >= Math.min(REGION_BUDGET, contextCap)) break;
    attach(entity.id, "context");
  }

  /**
   * Relations that reinforce the picture, not a web behind it.
   *
   * Attaching a neighbour brings up to four of ITS relations with it, so a
   * handful of boxes could arrive carrying a dozen lines between each
   * other — every cross-link the session had ever established between two
   * things that happen to be on screen together. The grammar's own
   * connections are the structure and always stay. Of the rest, a line
   * survives if it is part of what was just said, or if it runs to the
   * subject; a line between two pieces of old context is exactly the web.
   */
  const structural = new Set(result.connections.map((c) => c.id));
  const shownEntities = new Map(
    regions.map((r) => [r.entityId, world.entities.find((e) => e.id === r.entityId)] as const),
  );
  const reinforces = (entityId: string | undefined): boolean => {
    if (!entityId) return false;
    if (entityId === subjectId) return true;
    const entity = shownEntities.get(entityId);
    return Boolean(entity && spokenThisTurn(entity));
  };
  for (let i = connections.length - 1; i >= 0; i -= 1) {
    const c = connections[i];
    if (structural.has(c.id)) continue;
    const relation = world.relations.find((r) => r.id === c.relationId);
    if (relation && (reinforces(relation.source) || reinforces(relation.target))) continue;
    connections.splice(i, 1);
  }

  if (!attached.length) return result;
  return {
    regions,
    connections,
    reason: `${result.reason}; attached ${attached.join(", ")}`,
  };
}

/** Relations whose sign cannot be seen in an arrangement — see the grammar library's connectionLabel. */
const CONNECTION_LABEL: Partial<Record<string, string>> = {
  prevents: "prevents",
  refutes: "refutes",
  // The one thing an arrow between a person and a thing cannot show by
  // itself: which way the wanting runs, and that it is wanting at all.
  wants: "wants",
  greater_than: "more",
  less_than: "less",
};

/**
 * The fallback for weak/ambiguous intent evidence — currently reachable
 * only via `express_uncertainty`, the one intent that wins purely because
 * nothing else scored higher (lib/expression/intent/classify.ts's own
 * priority list ranks it second-to-last). A grammar chosen with genuine
 * confidence is entitled to reorganise the picture around what it found;
 * a grammar chosen because nothing else matched is not entitled to the
 * same authority — and the normal chain (`GRAMMAR_FOR_INTENT.express_uncertainty
 * = ["relationship"]`) gave it that authority anyway, because `relationship`
 * selects its top entities by world importance regardless of why it was
 * invoked. That is precisely how a disfluent stretch of speech, with
 * nothing confident to say about it, ends up dragging old high-importance
 * entities back onto a canvas that has moved on to something else (live
 * eval #3: a forty-minute-old "trying" and a cast of business-talk nodes
 * recirculating through a story about a frog).
 *
 * Scope here is deliberately narrow and additive, never a reselection:
 *
 *  1. The resolved focus (if any) and whatever was already on the canvas
 *     are kept exactly as they were — low confidence about THIS utterance
 *     is not license to redraw what the previous, more confident rounds
 *     already established.
 *  2. Only entities this round actually created are added on top.
 *  3. Only relations where BOTH ends are already in scope are drawn — an
 *     edge can connect two things already shown, or a new thing to the
 *     existing picture, but it can never be the reason a third, unrelated
 *     entity gets pulled in.
 *
 * No world-importance ranking runs at all. An entity absent from both
 * `previousVisibleIds` and this round's new entities cannot appear here,
 * full stop — which is exactly "must not globally reselect by world
 * importance / must not pull in unrelated stale entities" from the brief,
 * enforced structurally rather than by a threshold that could drift.
 * Reused entirely: REGION_BUDGET (unchanged), canvasEligible (unchanged
 * visibility rules — a durable decision that was already visible stays
 * visible; nothing not already eligible is granted an exception), the
 * `relationship` grammar id itself (no schema change, no new visual
 * capability — this only changes WHICH entities relationship draws, not
 * what a relationship-grammar plan is allowed to contain or how it
 * renders).
 */
function weakConfidenceFallback(
  world: WorldState,
  vis: VisibilityAssignment,
  visOpts: VisibilityOptions,
  visualFocus: string | undefined,
  newEntityIds: string[],
): GrammarResult {
  const regions: Region[] = [];
  const connections: Connection[] = [];
  const shown = new Set<string>();

  const keep = (id: string, role: Region["role"]) => {
    if (shown.has(id) || regions.length >= REGION_BUDGET) return;
    if (!canvasEligible(id, vis, world, visOpts)) return;
    shown.add(id);
    regions.push({ id: `r-${id}`.slice(0, 48), role, entityId: id });
  };

  if (visualFocus) keep(visualFocus, "primary_subject");
  for (const id of visOpts.previousVisibleIds ?? []) keep(id, "context");
  for (const id of newEntityIds) keep(id, "context");

  for (const rel of world.relations) {
    if (!shown.has(rel.source) || !shown.has(rel.target)) continue;
    if (connections.some((c) => c.relationId === rel.id)) continue;
    connections.push({
      id: `c-${rel.id}`.slice(0, 48),
      fromRegionId: `r-${rel.source}`.slice(0, 48),
      toRegionId: `r-${rel.target}`.slice(0, 48),
      relationId: rel.id,
      kind: relationFamily(rel.type) === "causal" ? "flow" : "link",
      label: CONNECTION_LABEL[rel.type] ?? (rel.type === "role_of" ? rel.role : undefined),
    });
  }

  const addedNew = newEntityIds.filter((id) => shown.has(id)).length;
  return {
    regions,
    connections,
    reason: `low-confidence fallback: kept ${regions.length - addedNew} existing, added ${addedNew} new — no importance-based reselection`,
  };
}

/**
 * `viewIds` is the horizon the grammar was actually built from. A region for
 * an entity in that view is kept even when the raw recency test would reject
 * it, because the horizon has already made that decision — with more
 * information — and re-litigating it here silently deleted structure the
 * grammar had deliberately included.
 *
 * That is not hypothetical: horizonWorld re-admits the older steps of an
 * ordered chain (keepOrderedChainsWhole), so the sequence grammar would
 * build all three of "sign in -> load projects -> open dashboard" and this
 * function would drop the region for the one that had aged out, leaving a
 * two-step picture whose own `reason` still said three. Any region this does
 * drop is now named in the returned reason rather than vanishing.
 */
function dropIneligibleRegions(
  result: GrammarResult,
  vis: VisibilityAssignment,
  world: WorldState,
  visOpts: VisibilityOptions,
  viewIds: Set<string>,
): GrammarResult {
  const keep = new Set(
    result.regions
      .filter((r) => !r.entityId || viewIds.has(r.entityId) || canvasEligible(r.entityId, vis, world, visOpts))
      .map((r) => r.id),
  );
  const regions = result.regions.filter((r) => keep.has(r.id));
  if (regions.length === result.regions.length) return { ...result, regions };

  const droppedIds = result.regions.filter((r) => !keep.has(r.id)).map((r) => r.entityId ?? r.id);
  const keptIds = new Set(regions.map((r) => r.id));
  const connections = result.connections.filter((c) => keptIds.has(c.fromRegionId) && keptIds.has(c.toRegionId));
  return { ...result, regions, connections, reason: `${result.reason} (dropped ${droppedIds.join(", ")} — off the visual horizon)` };
}

/**
 * Must match ExpressionPlanSchema's `reason` field cap (lib/expression/schemas.ts).
 * Kept as a separate constant rather than read off the schema at runtime —
 * zod does not expose a `.max()` check value without walking `_def.checks`,
 * and a literal here is one line either file's max needs to change is
 * caught by scripts/expression-plan-reason-bound-test.mjs, not by drift.
 */
const REASON_LIMIT = 200;

/**
 * Diagnostic/explanation text must never invalidate an otherwise-valid plan.
 * `withFocus.reason` is built by appending every attached entity's id
 * (attachRelatedEntities, below) onto the chosen grammar's own reason — a
 * string that grows with how much the round actually drew, which is exactly
 * the kind of thing that eventually crosses a fixed cap. Nothing about the
 * picture on the canvas depends on this text; it exists for the debug panel
 * and the trace log. Truncating it can only shorten a log line — it can
 * never be a semantic regression — so bounding it here, before the plan is
 * ever handed to ExpressionPlanSchema.safeParse, is strictly safer than
 * letting a long explanation take the whole plan down with it.
 */
function boundReason(reason: string, limit = REASON_LIMIT): string {
  return reason.length <= limit ? reason : `${reason.slice(0, limit - 1)}…`;
}

const PERSIST_RESERVE = 3;

/** Free a few grammar slots so standing decisions/problems/goals can persist. */
function reservePersistSlots(result: GrammarResult, vis: VisibilityAssignment, world: WorldState, visOpts: VisibilityOptions): GrammarResult {
  const shown = new Set(result.regions.map((r) => r.entityId).filter(Boolean) as string[]);
  const persistWaiting = world.entities.filter(
    (e) =>
      vis.persistIds.has(e.id) &&
      world.seq - e.lastTouchedSeq > CURRENT_WINDOW &&
      !shown.has(e.id) &&
      canvasEligible(e.id, vis, world, visOpts),
  ).length;
  const need = Math.min(PERSIST_RESERVE, persistWaiting);
  if (result.regions.length + need <= REGION_BUDGET) return result;
  const dropCount = result.regions.length + need - REGION_BUDGET;
  const droppable = result.regions.filter((r) => {
    if (!r.entityId || r.entityId === vis.focusId) return false;
    if (r.role === "primary_subject" || r.role === "hierarchy_root" || r.role === "chain_step" || r.role === "sequence_step") {
      return false;
    }
    const tier = vis.tier.get(r.entityId);
    if (tier === "contextual" || tier === "historical") return true;
    // Current persist (just-discussed events) can yield to standing decisions.
    return tier === "supporting" && world.seq - (world.entities.find((e) => e.id === r.entityId)?.lastTouchedSeq ?? 0) <= CURRENT_WINDOW;
  });
  const drop = new Set(droppable.slice(-dropCount).map((r) => r.id));
  if (!drop.size) return result;
  const regions = result.regions.filter((r) => !drop.has(r.id));
  const keptIds = new Set(regions.map((r) => r.id));
  const connections = result.connections.filter((c) => keptIds.has(c.fromRegionId) && keptIds.has(c.toRegionId));
  return { ...result, regions, connections };
}

export function planExpression(world: WorldState, intent: ExpressionIntent, opts: PlanOptions = {}): ExpressionPlan {
  const visOpts: VisibilityOptions = {
    newEntityIds: opts.newEntityIds ?? [],
    previousVisibleIds: opts.previousVisibleIds ?? [],
    previousFocusId: opts.previousFocusId,
    focusHint: intent.focusEntityId,
    nowMs: opts.nowMs,
  };
  const vis = assignVisibility(world, visOpts);
  const visualFocus = opts.cleanPlan?.primaryId ?? vis.focusId ?? intent.focusEntityId;
  const visualIntent: ExpressionIntent = { ...intent, focusEntityId: visualFocus };
  const view = horizonWorld(world, vis, visOpts);

  // Weak/ambiguous intent evidence gets the narrow-scope fallback instead
  // of the normal chain — see weakConfidenceFallback's own doc comment for
  // why. This bypasses `firstUsable`/`attachRelatedEntities` entirely: the
  // fallback already does its own (much narrower) version of both jobs, and
  // letting the normal attachment step run afterward would undo the whole
  // point by refilling the budget from the same importance-ranked pools.
  const isWeakConfidence = intent.primary === "express_uncertainty";
  const chain = opts.grammarOverride
    ? [opts.grammarOverride, ...GRAMMAR_FOR_INTENT[intent.primary].filter((g) => g !== opts.grammarOverride)]
    : GRAMMAR_FOR_INTENT[intent.primary];

  const chosen = isWeakConfidence ? null : firstUsable(view, visualFocus, chain);
  const grammarResult = isWeakConfidence
    ? undefined
    : chosen
      ? reservePersistSlots(
          dropIneligibleRegions(chosen.result, vis, world, visOpts, new Set(view.entities.map((e) => e.id))),
          vis,
          world,
          visOpts,
        )
      : { regions: [], connections: [], reason: boundReason(`no grammar could express this world (tried ${chain.join(", ")})`) };

  const withFocus = isWeakConfidence
    ? weakConfidenceFallback(world, vis, visOpts, visualFocus, opts.newEntityIds ?? [])
    : attachRelatedEntities(world, visualIntent, grammarResult!, vis, visOpts);
  if (!withFocus.regions.length) {
    return { ...EMPTY_EXPRESSION_PLAN, intent: intent.primary, reason: boundReason(isWeakConfidence ? withFocus.reason : grammarResult!.reason) };
  }

  const connections = dedupeFanLabels(withFocus.connections);
  const annotations = buildAnnotations(world, withFocus.regions);
  const regions = [...withFocus.regions, ...annotations];
  const emphasis = buildEmphasis(regions, visualFocus, world);

  const planGrammar = isWeakConfidence ? "relationship" : (chosen?.grammar ?? "relationship");
  const plan: ExpressionPlan = {
    grammar: planGrammar,
    intent: intent.primary,
    focusEntityId: visualFocus,
    regions,
    // withFocus, not chosen.result: the attachment step adds the relations
    // that connect what it attached, and reading the grammar's original list
    // here put entities on the canvas with every one of their relations
    // silently dropped — visible as boxes that sit near each other saying
    // nothing, which is precisely the failure mode the brief calls out.
    connections,
    emphasis,
    reason: boundReason(
      isWeakConfidence
        ? `relationship: ${withFocus.reason}`
        : `${planGrammar}: ${withFocus.reason}` + (chosen?.skipped.length ? ` (skipped ${chosen.skipped.join(", ")} — no such structure)` : ""),
    ),
  };

  // The schema is the contract, not a suggestion: a grammar that produced a
  // connection to a region it never created is a bug in that grammar, and
  // failing loudly here is far cheaper than debugging it from the canvas.
  // (`plan.reason` itself is bounded above and can no longer be the cause of
  // a safeParse failure — this branch is for a REAL structural bug now.)
  const parsed = ExpressionPlanSchema.safeParse(plan);
  if (!parsed.success) {
    return {
      ...EMPTY_EXPRESSION_PLAN,
      intent: intent.primary,
      reason: boundReason(`grammar ${planGrammar} produced an invalid plan: ${parsed.error.issues[0]?.message ?? "unknown"}`),
    };
  }
  if (!opts.cleanPlan) return parsed.data;
  return applyCleanToPlan(parsed.data, opts.cleanPlan, world);
}
