/**
 * The visual grammar library.
 *
 * A grammar is NOT a diagram type and holds no geometry. It answers one
 * question: given this meaning, which things become regions, what role does
 * each region play, and which relations survive as visible connections?
 * Where those regions physically land is the composer's problem
 * (lib/expression/compose/compose.ts) — a grammar that returned coordinates
 * would be a renderer wearing a disguise.
 *
 * Ten primitives, per the brief, and no more until something real needs an
 * eleventh. They compose by nesting: `scene` puts a `grouping` region
 * inside itself for a counted family; `comparison` hangs each pole's own
 * properties off it as context. That nesting is why `Region.childRegionIds`
 * exists and why every builder returns a flat region list plus parent
 * links, rather than a tree — the composer walks it either way, and a flat
 * list is what the schema can actually validate.
 *
 * Every builder shares one discipline: a connection must name the world
 * relation it is accountable to. There is no way to draw an arrow that is
 * not backed by something the speaker said, which is what makes
 * lib/expression/evaluate/evaluate.ts's false-relation check possible at
 * all.
 */

import {
  isLiveEntityStatus,
  relationFamily,
  type Connection,
  type GrammarId,
  type IntentType,
  type Region,
  type WorldEntity,
  type WorldRelation,
  type WorldState,
} from "../schemas";

/**
 * Visual restraint lives here, not in the world model: the world
 * understands everything, the grammar shows a few.
 *
 * This bounds the STRUCTURE a grammar may draw — the steps in a sequence,
 * the parts of a hierarchy, the poles of a comparison and their
 * dimensions. A grammar that found real structure is showing one idea, and
 * cutting it mid-idea makes the picture wrong rather than clean, so this
 * stays where it was.
 *
 * What made boards dense was never the structure; it was everything
 * attached AROUND it. That is bounded separately and much harder — see
 * CONTEXT_BUDGET in lib/expression/planner/plan.ts.
 */
export const REGION_BUDGET = 8;
/**
 * Two, not three. An annotation is the one thing on this canvas that is
 * literally a sentence, and the budget is how many sentences a picture can
 * carry before it stops being a picture. Three was already a paragraph.
 */
export const ANNOTATION_BUDGET = 2;

export interface GrammarResult {
  regions: Region[];
  connections: Connection[];
  reason: string;
}

export interface GrammarContext {
  world: WorldState;
  focusEntityId?: string;
}

export interface Grammar {
  id: GrammarId;
  /** One line, for the debug panel: what spatial logic does this grammar impose? */
  description: string;
  build(ctx: GrammarContext): GrammarResult;
}

// ────────────────────────────────────────────────────────── helpers

const regionId = (entityId: string) => `r-${entityId}`.slice(0, 48);
const connectionId = (relationId: string) => `c-${relationId}`.slice(0, 48);

function active(world: WorldState): WorldEntity[] {
  return world.entities.filter((e) => isLiveEntityStatus(e.status));
}

function entityById(world: WorldState, id: string): WorldEntity | undefined {
  return active(world).find((e) => e.id === id);
}

const IMPORTANCE_RANK = { primary: 0, supporting: 1, detail: 2 } as const;

function byImportance(world: WorldState, ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const ea = entityById(world, a);
    const eb = entityById(world, b);
    return IMPORTANCE_RANK[ea?.importance ?? "detail"] - IMPORTANCE_RANK[eb?.importance ?? "detail"];
  });
}

/**
 * Trim a chain to the display budget by dropping from the middle, never the
 * ends. The first and last link of a causal story are the two a viewer
 * needs; the middle is elaboration. Same rule for sequences.
 */
function trimChain(ids: string[], world: WorldState, max: number): string[] {
  if (ids.length <= max) return ids;
  const middle = byImportance(world, ids.slice(1, -1)).slice(0, max - 2);
  const keep = new Set(middle);
  return [ids[0], ...ids.slice(1, -1).filter((id) => keep.has(id)), ids[ids.length - 1]];
}

function longestPathOver(relations: WorldRelation[], types: Set<string>): string[] {
  const out = new Map<string, string[]>();
  for (const rel of relations) {
    if (!types.has(rel.type)) continue;
    if (!out.has(rel.source)) out.set(rel.source, []);
    out.get(rel.source)!.push(rel.target);
  }
  let best: string[] = [];
  const walk = (node: string, path: string[], seen: Set<string>) => {
    let extended = false;
    for (const next of out.get(node) ?? []) {
      if (seen.has(next)) continue;
      extended = true;
      seen.add(next);
      walk(next, [...path, next], seen);
      seen.delete(next);
    }
    if (!extended && path.length > best.length) best = path;
  };
  for (const start of out.keys()) walk(start, [start], new Set([start]));
  return best;
}

/** Relations whose two endpoints both survived into the shown region set. */
function relationsAmong(world: WorldState, shown: Set<string>, filter?: (r: WorldRelation) => boolean): WorldRelation[] {
  return world.relations.filter((r) => shown.has(r.source) && shown.has(r.target) && (!filter || filter(r)));
}

/**
 * A connection's label exists only when the arrangement alone cannot carry
 * the relation. A causal arrow reads as causation without the word
 * "causes"; a role ("mother") and a stated magnitude ("2x") genuinely
 * cannot be inferred from position, so those get words. This is the rule
 * that keeps the canvas from becoming a re-typed transcript.
 */
function connectionLabel(rel: WorldRelation): string | undefined {
  if (rel.type === "role_of" && rel.role) return rel.role;
  if (rel.type === "has_property") return undefined;
  if (rel.magnitude && rel.magnitude !== 1) return `${rel.magnitude}x`;
  /**
   * Polarity has to be written, because position cannot carry it.
   *
   * Two boxes side by side say "these are being compared"; they cannot say
   * which one is MORE. An arrow says "this leads to that"; it cannot say
   * "this stops that". So a relation whose entire content is its sign reads
   * as its own opposite when drawn bare — "rest prevents burnout" and "rest
   * causes burnout" are the same picture without the word.
   *
   * This is the one place text is not a failure of visual expression: it is
   * the only thing that can carry the meaning at all.
   */
  /**
   * A want is the same case as a polarity, arriving from the other side: an
   * arrow from a person to a thing says they are connected and which way
   * the line runs, and nothing at all about what the person is doing with
   * it — wanting it, building it, refusing it all draw identically. The
   * word is the relation, so the word is drawn.
   */
  if (rel.type === "wants") return "wants";
  if (rel.type === "prevents") return "prevents";
  if (rel.type === "refutes") return "refutes";
  if (rel.type === "greater_than") return "more";
  if (rel.type === "less_than") return "less";
  return undefined;
}

function connect(rel: WorldRelation, kind: Connection["kind"]): Connection {
  return {
    id: connectionId(rel.id),
    fromRegionId: regionId(rel.source),
    toRegionId: regionId(rel.target),
    relationId: rel.id,
    kind,
    label: connectionLabel(rel),
  };
}

/** Public accountability helper for explicit presentation recomposition. */
export function connectionForRelation(rel: WorldRelation, kind: Connection["kind"]): Connection {
  return connect(rel, kind);
}

function chainRegions(ids: string[], role: Region["role"]): Region[] {
  return ids.map((id, index) => ({ id: regionId(id), role, entityId: id, order: index }));
}

/** Edges along a path, in path order, restricted to the given predicate. */
function edgesAlong(path: string[], relations: WorldRelation[], types: Set<string>): WorldRelation[] {
  const out: WorldRelation[] = [];
  for (let i = 0; i < path.length - 1; i += 1) {
    const rel = relations.find((r) => r.source === path[i] && r.target === path[i + 1] && types.has(r.type));
    if (rel) out.push(rel);
  }
  return out;
}

function parentChildMap(world: WorldState): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const push = (parent: string, child: string) => {
    if (!map.has(parent)) map.set(parent, []);
    if (!map.get(parent)!.includes(child)) map.get(parent)!.push(child);
  };
  for (const rel of world.relations) {
    if (rel.type === "contains") push(rel.source, rel.target);
    else if (rel.type === "part_of" || rel.type === "member_of") push(rel.target, rel.source);
  }
  return map;
}

/**
 * The entity that belongs under `pole` by this relation, if any.
 *
 * `has_property` is membership, not a directed arrow: the extractor emits
 * both `plan-a → plan-a-duration` and `plan-a-duration → plan-a` for the
 * same fact. If either end is the pole, the other end is the dimension.
 * greater_than / less_than stay directed — those are measurements, not
 * ownership.
 */
function dimensionHungOn(rel: WorldRelation, pole: string): string | undefined {
  if (rel.type === "has_property") {
    if (rel.source === pole && rel.target !== pole) return rel.target;
    if (rel.target === pole && rel.source !== pole) return rel.source;
    return undefined;
  }
  if ((rel.type === "greater_than" || rel.type === "less_than") && rel.source === pole) return rel.target;
  return undefined;
}

/**
 * Owner and dimension of a has_property edge, treating it as undirected.
 *
 * A quantity attached to a non-quantity is a dimension of it, whichever
 * way the extractor pointed the edge — otherwise a reversed
 * `plan-a-duration → plan-a` would lift Plan A onto its duration and the
 * poles would become the measurements. Concept-properties ("expensive")
 * keep the canonical direction (source owns target).
 */
function hasPropertyOwnership(
  rel: WorldRelation,
  world: WorldState,
): { ownerId: string; dimensionId: string } | undefined {
  if (rel.type !== "has_property") return undefined;
  const source = entityById(world, rel.source);
  const target = entityById(world, rel.target);
  if (!source || !target) return undefined;
  if (source.type === "quantity" && target.type !== "quantity") {
    return { ownerId: target.id, dimensionId: source.id };
  }
  return { ownerId: source.id, dimensionId: target.id };
}

// ────────────────────────────────────────────────────────── grammars

const CAUSAL = new Set(["causes", "enables", "depends_on", "prevents"]);
const SEQUENCE = new Set(["precedes"]);
const TRANSFORM = new Set(["transforms_into"]);

/**
 * cause_effect — a directed flow. The arrangement carries the direction, so
 * only the spine's own edges become arrows; a side relation between two
 * chain members is shown as a plain link so it cannot be misread as another
 * step in the story.
 */
const causeEffect: Grammar = {
  id: "cause_effect",
  description: "directed flow; the spine is the story, everything else is aside",
  build({ world }) {
    const spine = trimChain(longestPathOver(world.relations, CAUSAL), world, REGION_BUDGET - 2);
    if (spine.length < 2) return { regions: [], connections: [], reason: "no causal chain" };
    const shown = new Set(spine);

    /**
     * Causes and effects that hang off the spine without lying on it.
     *
     * An explanation is a causal GRAPH, not a causal path. "If demand rises
     * prices rise; if supply also rises that pressure is reduced" has two
     * arms, and a grammar that draws only the longest one silently deletes
     * the speaker's second condition — which is exactly what this did before,
     * and the half it kept read as the whole story.
     *
     * Branches are ranked by importance and bounded by the same budget as
     * everything else, so a densely connected world still yields a readable
     * picture rather than a hairball.
     */
    const branchIds = byImportance(
      world,
      [
        ...new Set(
          world.relations
            .filter((r) => relationFamily(r.type) === "causal")
            .flatMap((r) => (shown.has(r.source) ? [r.target] : shown.has(r.target) ? [r.source] : []))
            .filter((id) => !shown.has(id) && entityById(world, id)),
        ),
      ],
    ).slice(0, REGION_BUDGET - spine.length);
    for (const id of branchIds) shown.add(id);

    const spineEdges = edgesAlong(spine, world.relations, CAUSAL);
    const spineEdgeIds = new Set(spineEdges.map((r) => r.id));
    // A branch's own causal edge is a flow like any other — direction is the
    // claim, and `prevents` carries a label so it cannot read as `causes`.
    const branchEdges = relationsAmong(world, shown, (r) => relationFamily(r.type) === "causal" && !spineEdgeIds.has(r.id));
    const asides = relationsAmong(world, shown, (r) => !spineEdgeIds.has(r.id) && relationFamily(r.type) !== "causal");

    return {
      regions: [
        ...chainRegions(spine, "chain_step"),
        ...branchIds.map((id, index) => ({ id: regionId(id), role: "context" as const, entityId: id, order: index })),
      ],
      connections: [
        ...spineEdges.map((r) => connect(r, "flow")),
        ...branchEdges.map((r) => connect(r, "flow")),
        ...asides.map((r) => connect(r, "link")),
      ],
      reason:
        `causal spine: ${spine.join(" -> ")}` +
        (branchIds.length ? `; branches: ${branchIds.join(", ")}` : ""),
    };
  },
};

/** sequence — ordered steps. Identical topology to cause_effect, different claim: "then", not "therefore". */
const sequence: Grammar = {
  id: "sequence",
  description: "ordered steps; position encodes time, not causation",
  build({ world }) {
    const explicit = world.relations
      .filter((r) => r.type === "precedes" && r.step !== undefined)
      .sort((a, b) => (a.step ?? 0) - (b.step ?? 0));
    const path = explicit.length
      ? [...new Set(explicit.flatMap((r) => [r.source, r.target]))]
      : longestPathOver(world.relations, SEQUENCE);
    const steps = trimChain(path, world, REGION_BUDGET);
    if (steps.length < 2) return { regions: [], connections: [], reason: "no sequence" };
    return {
      regions: chainRegions(steps, "sequence_step"),
      connections: edgesAlong(steps, world.relations, SEQUENCE).map((r) => connect(r, "flow")),
      reason: `${steps.length} ordered steps`,
    };
  },
};

/** process — a thing becoming another thing. Same one entity, successive states. */
const process: Grammar = {
  id: "process",
  description: "state change; the same subject shown at each state it passes through",
  build({ world }) {
    const states = trimChain(longestPathOver(world.relations, TRANSFORM), world, REGION_BUDGET);
    if (states.length < 2) return { regions: [], connections: [], reason: "no transformation" };
    return {
      regions: chainRegions(states, "sequence_step"),
      connections: edgesAlong(states, world.relations, TRANSFORM).map((r) => connect(r, "flow")),
      reason: `transformation through ${states.length} states`,
    };
  },
};

/**
 * comparison — two poles side by side. No arrow is drawn between them: the
 * parallel arrangement IS the contrast, and an arrow would assert a
 * direction the speaker never claimed. Each pole keeps its own properties
 * beneath it so the two columns are actually comparable.
 */
const comparison: Grammar = {
  id: "comparison",
  description: "parallel columns; the arrangement is the contrast, no arrow between poles",
  build({ world }) {
    const comparative = world.relations.filter((r) => relationFamily(r.type) === "comparative");

    // An entity that is a PROPERTY of another is a dimension of it, never a
    // peer to set against it. "Plan A costs more but finishes twice as
    // quickly as Plan B" is a comparison of two PLANS measured on cost and
    // speed — but the meaning layer readily produces the contrast between
    // the two dimensions ("costs more BUT finishes quickly"), and taking
    // that pair literally drew Plan A's cost beside Plan A's speed with
    // Plan B nowhere on the sheet.
    //
    // So every comparative endpoint is lifted to whatever it is a property
    // OF before poles are chosen. Two dimensions of the same subject then
    // collapse to that one subject and stop being a candidate pair, while a
    // dimension compared against a subject ("Plan A's cost vs Plan B")
    // lifts into the subject-vs-subject comparison it was really making.
    const ownerOfProperty = new Map<string, string>();
    for (const rel of world.relations) {
      const owned = hasPropertyOwnership(rel, world);
      if (owned && !ownerOfProperty.has(owned.dimensionId)) ownerOfProperty.set(owned.dimensionId, owned.ownerId);
    }
    const lift = (id: string) => ownerOfProperty.get(id) ?? id;

    const candidates = comparative
      .map((rel) => ({ rel, a: lift(rel.source), b: lift(rel.target) }))
      .filter((c) => c.a !== c.b && entityById(world, c.a) && entityById(world, c.b));

    // An explicit contrast is the speaker setting two things against each
    // other; greater_than/less_than is a measurement that may only touch one
    // dimension. So an explicit contrast wins when both are present.
    const chosen = candidates.find((c) => c.rel.type === "contrasts_with") ?? candidates[0];
    let poles: [string, string] | null = chosen ? [chosen.a, chosen.b] : null;

    if (!poles) {
      const counted = active(world).filter((e) => e.quantity);
      if (counted.length >= 2) poles = [counted[0].id, counted[1].id];
    }
    if (!poles || !entityById(world, poles[0]) || !entityById(world, poles[1])) {
      return { regions: [], connections: [], reason: "no two poles to compare" };
    }

    const regions: Region[] = [
      { id: regionId(poles[0]), role: "comparison_pole", entityId: poles[0], order: 0, childRegionIds: [] },
      { id: regionId(poles[1]), role: "comparison_pole", entityId: poles[1], order: 1, childRegionIds: [] },
    ];
    const connections: Connection[] = [];
    const shown = new Set<string>(poles);

    // Each pole's own attributes, hung beneath it — a comparison of two bare
    // names compares nothing. has_property is read undirected: whichever end
    // is the pole, the other end is the dimension that belongs in its column.
    const perPole = Math.floor((REGION_BUDGET - 2) / 2);
    for (const [index, pole] of poles.entries()) {
      let hung = 0;
      for (const rel of world.relations) {
        if (hung >= perPole) break;
        const dimensionId = dimensionHungOn(rel, pole);
        if (!dimensionId || !entityById(world, dimensionId) || shown.has(dimensionId)) continue;
        shown.add(dimensionId);
        regions.push({ id: regionId(dimensionId), role: "context", entityId: dimensionId, order: index });
        regions[index].childRegionIds!.push(regionId(dimensionId));
        connections.push(connect(rel, "link"));
        hung += 1;
      }
    }

    const [poleA, poleB] = poles;
    // Is the contrast between the poles stated in its own right, as a
    // relation whose two ends ARE the poles? That is what decides whether a
    // dimension-level relation that lifts onto the same pair is a
    // restatement or the only statement there is.
    const polesStatedDirectly = comparative.some(
      (r) => (r.source === poleA && r.target === poleB) || (r.source === poleB && r.target === poleA),
    );
    for (const rel of comparative) {
      // A dimension-level relation that LIFTS onto the poles ("Plan A's cost
      // vs Plan B") is usually the pole comparison wearing a different pair
      // of ends, and drawing it too would restate the contrast against an
      // endpoint that is not even one of the poles.
      //
      // "Usually" is the part that was wrong. It is a restatement only when
      // it says nothing the pole comparison does not already say. Two things
      // can make it say more, and they are exactly the two `connectionLabel`
      // already recognises as unable to survive an arrangement: a magnitude
      // ("twice as quickly") and a polarity ("costs MORE"). Dropped
      // wholesale, "Plan A costs more but finishes twice as quickly as Plan
      // B" produced two columns that said the plans were being compared and
      // could not say which was faster, or by how much — the sentence's
      // entire point, drawn as nothing.
      //
      // A lifted relation is also kept when the poles were never contrasted
      // directly, because then it is the only statement of the comparison
      // there is.
      const [a, b] = [lift(rel.source), lift(rel.target)];
      const wasLifted = a !== rel.source || b !== rel.target;
      const liftsOntoPoles = (a === poleA && b === poleB) || (a === poleB && b === poleA);
      const restatesThePoles = wasLifted && liftsOntoPoles && polesStatedDirectly && !connectionLabel(rel);
      if (restatesThePoles) continue;
      if (shown.has(rel.source) && shown.has(rel.target)) connections.push(connect(rel, "comparison"));
    }
    return { regions, connections, reason: `poles ${poleA} vs ${poleB}` };
  },
};

/**
 * hierarchy — enclosure. Children are drawn INSIDE the parent rather than
 * hanging off it on labelled arrows, because containment is the one
 * relation a picture can state without any words at all.
 */
const hierarchy: Grammar = {
  id: "hierarchy",
  description: "enclosure; children inside the parent, containment stated without words",
  build({ world, focusEntityId }) {
    const map = parentChildMap(world);
    // A claim backed by two or more reasons is a hierarchy too: the claim is
    // the root, the reasons are what sit under it.
    for (const entity of active(world)) {
      const backers = world.relations.filter((r) => r.type === "supports" && r.target === entity.id).map((r) => r.source);
      if (backers.length >= 2 && !map.has(entity.id)) map.set(entity.id, backers);
    }
    const candidates = [...map.entries()].filter(([parent, children]) => entityById(world, parent) && children.length >= 1);
    if (!candidates.length) return { regions: [], connections: [], reason: "no containment" };

    const root =
      candidates.find(([parent]) => parent === focusEntityId) ??
      candidates.sort((a, b) => b[1].length - a[1].length)[0];

    const children = byImportance(world, root[1].filter((id) => entityById(world, id))).slice(0, REGION_BUDGET - 1);
    const rootRegion: Region = {
      id: regionId(root[0]),
      role: "hierarchy_root",
      entityId: root[0],
      childRegionIds: children.map(regionId),
    };
    const childRegions: Region[] = children.map((id, index) => ({
      id: regionId(id),
      role: "hierarchy_child",
      entityId: id,
      order: index,
    }));
    const shown = new Set([root[0], ...children]);
    const connections = relationsAmong(
      world,
      shown,
      (r) => r.type === "contains" || r.type === "part_of" || r.type === "member_of" || r.type === "supports",
    ).map((r) => connect(r, "containment"));

    return {
      regions: [rootRegion, ...childRegions],
      connections,
      reason: `${children.length} under ${root[0]}`,
    };
  },
};

/**
 * grouping — a set shown as its members. A "family of five" becomes five
 * marks inside one boundary, not a box with the word five in it. When the
 * group's members are not individually known, the composer draws the count;
 * that is what `count` on a SceneObject is for.
 */
const grouping: Grammar = {
  id: "grouping",
  description: "a set drawn as its members within one boundary",
  build({ world, focusEntityId }) {
    const map = parentChildMap(world);
    const groups = active(world)
      .filter((e) => e.type === "group" || map.has(e.id))
      .sort((a, b) => (a.id === focusEntityId ? -1 : 0) - (b.id === focusEntityId ? -1 : 0));
    const group = groups[0];
    if (!group) return { regions: [], connections: [], reason: "no group" };

    const members = (map.get(group.id) ?? []).filter((id) => entityById(world, id)).slice(0, REGION_BUDGET - 1);
    const regions: Region[] = [
      { id: regionId(group.id), role: "hierarchy_root", entityId: group.id, childRegionIds: members.map(regionId) },
      ...members.map((id, index) => ({ id: regionId(id), role: "group_member" as const, entityId: id, order: index })),
    ];
    const shown = new Set([group.id, ...members]);
    return {
      regions,
      connections: relationsAmong(world, shown, (r) => r.type === "member_of" || r.type === "contains" || r.type === "part_of").map(
        (r) => connect(r, "containment"),
      ),
      reason: `group ${group.id}${group.quantity ? ` of ${group.quantity.value}` : ""} with ${members.length} named members`,
    };
  },
};

/**
 * quantity — numbers made visible as extent rather than written as digits.
 * Repetition and relative size are what the composer has to work with; the
 * grammar's job is only to say which entities are being counted and how
 * they rank.
 */
const quantity: Grammar = {
  id: "quantity",
  description: "counted things drawn as extent; magnitude is size, not text",
  build({ world }) {
    const counted = active(world)
      .filter((e) => e.quantity)
      .sort((a, b) => (b.quantity?.value ?? 0) - (a.quantity?.value ?? 0))
      .slice(0, REGION_BUDGET);
    if (!counted.length) return { regions: [], connections: [], reason: "nothing counted" };
    const shown = new Set(counted.map((e) => e.id));
    return {
      regions: counted.map((e, index) => ({
        id: regionId(e.id),
        role: index === 0 ? ("primary_subject" as const) : ("comparison_pole" as const),
        entityId: e.id,
        order: index,
      })),
      // Every relation among the counted things, not just the comparative
      // ones: "two of the five are contractors" is a membership, and dropping
      // it would leave two unrelated tallies side by side.
      connections: relationsAmong(world, shown).map((r) =>
        connect(r, relationFamily(r.type) === "comparative" ? "comparison" : "link"),
      ),
      reason: `${counted.length} quantified entities`,
    };
  },
};

/**
 * spatial — the arrangement IS the meaning. The composer reads each
 * relation's `spatial` qualifier and places accordingly, so connections are
 * carried as links only for traceability; most of them are drawn as nothing
 * at all (a chair beside a desk needs no line between them).
 */
const spatial: Grammar = {
  id: "spatial",
  description: "layout mirrors described space; relations are placement, not lines",
  build({ world }) {
    const spatialRels = world.relations.filter((r) => r.type === "located_at");
    if (!spatialRels.length) return { regions: [], connections: [], reason: "nothing located" };
    const ids: string[] = [];
    for (const rel of spatialRels) {
      for (const id of [rel.source, rel.target]) {
        if (entityById(world, id) && !ids.includes(id)) ids.push(id);
      }
    }
    const shown = ids.slice(0, REGION_BUDGET);
    return {
      regions: shown.map((id, index) => ({
        id: regionId(id),
        role: index === 0 ? ("primary_subject" as const) : ("context" as const),
        entityId: id,
        order: index,
      })),
      connections: spatialRels
        .filter((r) => shown.includes(r.source) && shown.includes(r.target))
        .map((r) => connect(r, "link")),
      reason: `${spatialRels.length} spatial relations`,
    };
  },
};

/**
 * scene — a subject with its context around it. This is the identity
 * grammar: one person or thing at the centre, origins and roles and
 * memberships arranged around them. Sub-structure nests: a counted group in
 * the context becomes a grouping region with its members inside.
 */
const scene: Grammar = {
  id: "scene",
  description: "a subject at the centre with its context arranged around it",
  build({ world, focusEntityId }) {
    const subject = (focusEntityId && entityById(world, focusEntityId)) ?? active(world).find((e) => e.importance === "primary");
    if (!subject) return { regions: [], connections: [], reason: "no subject" };

    const around = world.relations
      .filter((r) => r.source === subject.id || r.target === subject.id)
      .filter((r) => entityById(world, r.source === subject.id ? r.target : r.source));
    const regions: Region[] = [{ id: regionId(subject.id), role: "primary_subject", entityId: subject.id }];
    const connections: Connection[] = [];
    const shown = new Set([subject.id]);
    const childMap = parentChildMap(world);

    for (const rel of around) {
      if (regions.length >= REGION_BUDGET) break;
      const otherId = rel.source === subject.id ? rel.target : rel.source;
      if (shown.has(otherId)) {
        connections.push(connect(rel, "link"));
        continue;
      }
      shown.add(otherId);
      const members = (childMap.get(otherId) ?? []).filter((id) => entityById(world, id) && !shown.has(id));
      const region: Region = {
        id: regionId(otherId),
        role: "context",
        entityId: otherId,
        childRegionIds: members.length ? members.map(regionId) : undefined,
      };
      regions.push(region);
      connections.push(connect(rel, "link"));

      // Nested grouping: the family's named members live inside the family.
      for (const memberId of members.slice(0, REGION_BUDGET - regions.length)) {
        shown.add(memberId);
        regions.push({ id: regionId(memberId), role: "group_member", entityId: memberId, order: regions.length });
        const memberRel = world.relations.find(
          (r) =>
            (r.source === memberId && r.target === otherId && (r.type === "member_of" || r.type === "part_of")) ||
            (r.source === otherId && r.target === memberId && r.type === "contains"),
        );
        if (memberRel) connections.push(connect(memberRel, "containment"));
      }
    }

    // Relations between two context entities (Mariam is Kenny's mother AND a
    // member of the family) are real and must not be silently dropped.
    for (const rel of relationsAmong(world, shown)) {
      if (!connections.some((c) => c.relationId === rel.id)) connections.push(connect(rel, "link"));
    }

    return { regions, connections, reason: `subject ${subject.id} with ${regions.length - 1} context regions` };
  },
};

/** relationship — the honest fallback: what is connected to what, and nothing implied beyond that. */
const relationship: Grammar = {
  id: "relationship",
  description: "connected things, with no structure claimed beyond the connections themselves",
  build({ world, focusEntityId }) {
    const ranked = byImportance(
      world,
      active(world).map((e) => e.id),
    );
    const ordered = focusEntityId && ranked.includes(focusEntityId) ? [focusEntityId, ...ranked.filter((id) => id !== focusEntityId)] : ranked;
    const shownIds = ordered.slice(0, REGION_BUDGET);
    const shown = new Set(shownIds);
    return {
      regions: shownIds.map((id, index) => ({
        id: regionId(id),
        role: index === 0 ? ("primary_subject" as const) : ("context" as const),
        entityId: id,
        order: index,
      })),
      connections: relationsAmong(world, shown).map((r) =>
        connect(r, relationFamily(r.type) === "causal" || relationFamily(r.type) === "temporal" ? "flow" : "link"),
      ),
      reason: `${shownIds.length} entities, ${relationsAmong(world, shown).length} relations`,
    };
  },
};

export const GRAMMARS: Record<GrammarId, Grammar> = {
  scene,
  relationship,
  cause_effect: causeEffect,
  sequence,
  comparison,
  hierarchy,
  grouping,
  process,
  quantity,
  spatial,
};

/**
 * Which grammar an intent reaches for first, and what it falls back to when
 * that grammar finds nothing to build. The fallback chain always ends at
 * `relationship`, which can express any non-empty world — so the planner
 * can never fail to produce something, and never has to invent structure to
 * fill a gap.
 */
export const GRAMMAR_FOR_INTENT: Record<IntentType, GrammarId[]> = {
  explain_causality: ["cause_effect", "relationship"],
  show_sequence: ["sequence", "process", "relationship"],
  show_transformation: ["process", "sequence", "relationship"],
  compare: ["comparison", "quantity", "relationship"],
  show_hierarchy: ["hierarchy", "grouping", "relationship"],
  show_spatial: ["spatial", "scene", "relationship"],
  argue: ["hierarchy", "relationship"],
  show_quantity: ["quantity", "comparison", "relationship"],
  introduce: ["scene", "grouping", "relationship"],
  define: ["scene", "hierarchy", "relationship"],
  narrate: ["sequence", "scene", "relationship"],
  show_relationships: ["relationship"],
  express_uncertainty: ["relationship"],
  describe: ["scene", "relationship"],
};
