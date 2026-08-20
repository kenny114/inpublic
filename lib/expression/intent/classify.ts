/**
 * Communicative intent: what is the speaker TRYING TO DO?
 *
 * Deterministic, and deliberately blind to the transcript. This module
 * never sees the words — only the shape of the world and of the delta that
 * just landed. That is the whole point: "so", "because" and "therefore" are
 * discourse markers people scatter through speech without meaning
 * causation, and a classifier that reads them would be doing keyword
 * matching one layer up from the keyword matching this architecture exists
 * to avoid. A causal RELATION in the world is evidence of causal intent; the
 * word "because" is not.
 *
 * Scored rather than cascaded. An earlier design here was a first-match
 * if-chain, which meant a single stray causal edge in an otherwise
 * comparative utterance hijacked the whole expression. Scoring lets the
 * dominant structure win while `secondary` still reports the others, so the
 * planner can express them as supporting regions instead of losing them.
 */

import {
  relationFamily,
  type ExpressionIntent,
  type IntentType,
  type MeaningDelta,
  type RelationFamily,
  type WorldEntity,
  type WorldRelation,
  type WorldState,
} from "../schemas";

/**
 * Tie-break order when two intents score equally. Ordered by how much
 * structure the intent commits to: a sequence or a causal chain says
 * something specific about the world, `describe` says almost nothing, so
 * the specific reading wins a tie.
 */
const PRIORITY: IntentType[] = [
  "explain_causality",
  "show_sequence",
  "show_transformation",
  "compare",
  "show_hierarchy",
  "show_spatial",
  "argue",
  "show_quantity",
  "introduce",
  "define",
  "narrate",
  "show_relationships",
  "express_uncertainty",
  "describe",
];

function activeEntities(world: WorldState): WorldEntity[] {
  return world.entities.filter((e) => e.status !== "superseded");
}

function familyCounts(relations: WorldRelation[]): Record<RelationFamily, number> {
  const counts = {
    causal: 0,
    temporal: 0,
    structural: 0,
    attributive: 0,
    spatial: 0,
    comparative: 0,
    argumentative: 0,
    associative: 0,
  };
  for (const rel of relations) counts[relationFamily(rel.type)] += 1;
  return counts;
}

/**
 * Longest directed path over one relation predicate. A chain of three is
 * qualitatively different from three unrelated edges — it is the difference
 * between "these things are connected" and "this leads to this leads to
 * this" — so chain length, not edge count, drives the causal and sequence
 * scores.
 */
export function longestPath(relations: WorldRelation[], predicate: (r: WorldRelation) => boolean): string[] {
  const out = new Map<string, string[]>();
  for (const rel of relations) {
    if (!predicate(rel)) continue;
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

/** Parent -> children, over containment and membership alike. */
export function containmentGroups(world: WorldState): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  const push = (parent: string, child: string) => {
    if (!groups.has(parent)) groups.set(parent, []);
    if (!groups.get(parent)!.includes(child)) groups.get(parent)!.push(child);
  };
  for (const rel of world.relations) {
    if (rel.type === "contains") push(rel.source, rel.target);
    else if (rel.type === "part_of" || rel.type === "member_of") push(rel.target, rel.source);
  }
  return groups;
}

/** A claim or relation the speaker hedged. Uncertainty is expressed, not discarded. */
function uncertaintyCount(world: WorldState): number {
  return (
    world.claims.filter((c) => c.uncertain).length +
    world.relations.filter((r) => r.confidence === "low").length
  );
}

export function classifyIntent(world: WorldState, delta: MeaningDelta): ExpressionIntent {
  const entities = activeEntities(world);
  const relations = world.relations;
  if (!entities.length) {
    return {
      primary: "describe",
      secondary: [],
      strength: 0,
      reason: "no entities in the world yet",
    };
  }

  const counts = familyCounts(relations);
  const causalChain = longestPath(relations, (r) => r.type === "causes" || r.type === "enables" || r.type === "depends_on");
  const sequenceChain = longestPath(relations, (r) => r.type === "precedes");
  const transformChain = longestPath(relations, (r) => r.type === "transforms_into");
  const groups = containmentGroups(world);
  const biggestGroup = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  const quantified = entities.filter((e) => e.quantity);
  const uncertain = uncertaintyCount(world);

  const scores = new Map<IntentType, number>();
  const bump = (intent: IntentType, amount: number) => {
    if (amount > 0) scores.set(intent, (scores.get(intent) ?? 0) + amount);
  };

  // A chain of length n contributes n; a lone edge contributes 1. Structure
  // that composes is worth more than structure that doesn't.
  bump("explain_causality", causalChain.length >= 2 ? causalChain.length : counts.causal);
  bump("show_sequence", sequenceChain.length >= 2 ? sequenceChain.length : 0);
  bump("show_transformation", transformChain.length >= 2 ? transformChain.length + 1 : 0);
  // A group of two or more reads as a hierarchy on sight; a lone containment
  // edge is still structure, just weaker evidence of it being the point.
  bump("show_hierarchy", biggestGroup && biggestGroup[1].length >= 2 ? biggestGroup[1].length + 1 : counts.structural);
  bump("show_spatial", counts.spatial * 2);
  // Weighted above a bare comparison, because taking a POSITION on something
  // is a more specific communicative act than noting that two things differ.
  // "Cheap software is not always cheaper, because maintenance exceeds the
  // purchase price" contains both: one `refutes` and one `greater_than`. At
  // equal weight the comparison won, and the resulting picture compared two
  // numbers while dropping the claim the whole sentence was about. The
  // comparison is the evidence; the argument is the point.
  bump("argue", counts.argumentative * 3);
  bump("express_uncertainty", uncertain);

  // A contrast is a comparison; an equivalence is a definition. Both are in
  // the comparative family, and lumping them together made "latency is the
  // time between a request and a response" score as a comparison.
  const contrastive = relations.filter((r) => r.type === "contrasts_with" || r.type === "greater_than" || r.type === "less_than");
  const equivalences = relations.filter((r) => r.type === "equivalent_to");
  bump("compare", contrastive.length * 2);

  // Quantity only becomes the point when there is more than one number to
  // relate, or when a counted thing stands alone. A single number attached
  // to something that also has structure is a property of that thing, not
  // the thing to visualise — otherwise "I have a family of five" loses the
  // person whose family it is.
  if (quantified.length >= 2) bump("show_quantity", quantified.length);
  else if (quantified.length === 1 && quantified[0].importance === "primary" && !relations.length) bump("show_quantity", 2);

  // Identity: a person or group being placed, named, or given a role. This
  // is what "my name is Kenny, I'm from Trinidad, I have a family of five"
  // actually is, and it had nowhere to land before this vocabulary existed.
  // Weighted above a bare containment count because an introduction with a
  // family in it is still an introduction, not an org chart of the family.
  const identityRelations = relations.filter((r) => r.type === "originates_from" || r.type === "role_of");
  const subjectIsPerson = entities.some((e) => e.importance === "primary" && (e.type === "person" || e.type === "group"));
  if (identityRelations.length) {
    bump(subjectIsPerson ? "introduce" : "define", identityRelations.length * 2 + (subjectIsPerson ? 1 : 0));
  }

  // Properties define a thing — unless that thing is one side of a
  // comparison, in which case its properties are what is being compared and
  // belong to the comparison, not to a definition of it.
  const contrastedIds = new Set(contrastive.flatMap((r) => [r.source, r.target]));
  const definingProperties = relations.filter((r) => r.type === "has_property" && !contrastedIds.has(r.source));
  bump("define", definingProperties.length + relations.filter((r) => r.type === "instance_of").length * 2 + equivalences.length * 2);

  // Narration: people and events moving through time. Distinguished from a
  // bare sequence by WHO is in it — a story has actors, a process doesn't.
  const actors = entities.filter((e) => e.type === "person" || e.type === "group").length;
  const happenings = entities.filter((e) => e.type === "event" || e.type === "action").length;
  if (sequenceChain.length >= 2 && actors >= 1 && happenings >= 1) bump("narrate", sequenceChain.length);

  bump("show_relationships", counts.associative + (relations.length >= 2 ? 1 : 0));
  bump("describe", entities.length ? 1 : 0);

  const ranked = [...scores.entries()]
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1] || PRIORITY.indexOf(a[0]) - PRIORITY.indexOf(b[0]));

  const [primary, topScore] = ranked[0] ?? (["describe", 1] as [IntentType, number]);
  const total = ranked.reduce((sum, [, score]) => sum + score, 0) || 1;
  const secondary = ranked
    .slice(1)
    .filter(([intent, score]) => score >= Math.max(2, topScore * 0.5) && intent !== "describe")
    .slice(0, 3)
    .map(([intent]) => intent);

  return {
    primary,
    secondary,
    focusEntityId: pickFocus(world, primary, { causalChain, sequenceChain, transformChain, biggestGroup }),
    strength: Math.min(1, topScore / total),
    reason: describe(primary, topScore, { causalChain, sequenceChain, transformChain, biggestGroup, quantified: quantified.length, counts }),
  };
}

interface Shape {
  causalChain: string[];
  sequenceChain: string[];
  transformChain: string[];
  biggestGroup?: [string, string[]];
}

/**
 * The entity the expression should be organised around. Intent decides
 * where to look: a chain is organised around its head, a hierarchy around
 * its root, everything else around whatever the world already considers
 * primary.
 */
function pickFocus(world: WorldState, intent: IntentType, shape: Shape): string | undefined {
  const exists = (id?: string) => (id && world.entities.some((e) => e.id === id && e.status !== "superseded") ? id : undefined);
  switch (intent) {
    case "explain_causality":
      return exists(shape.causalChain[0]) ?? exists(primaryId(world));
    case "show_sequence":
    case "narrate":
      return exists(shape.sequenceChain[0]) ?? exists(primaryId(world));
    case "show_transformation":
      return exists(shape.transformChain[0]) ?? exists(primaryId(world));
    case "show_hierarchy":
      return exists(shape.biggestGroup?.[0]) ?? exists(primaryId(world));
    default:
      return exists(primaryId(world));
  }
}

function primaryId(world: WorldState): string | undefined {
  return world.entities.find((e) => e.importance === "primary" && e.status !== "superseded")?.id;
}

function describe(
  intent: IntentType,
  score: number,
  shape: Shape & { quantified: number; counts: Record<RelationFamily, number> },
): string {
  switch (intent) {
    case "explain_causality":
      return shape.causalChain.length >= 2
        ? `causal chain of ${shape.causalChain.length}: ${shape.causalChain.join(" -> ")}`
        : `${shape.counts.causal} causal relation(s), no chain`;
    case "show_sequence":
      return `sequence of ${shape.sequenceChain.length} steps`;
    case "show_transformation":
      return `state change through ${shape.transformChain.length} states`;
    case "compare":
      return `${shape.counts.comparative} comparative relation(s)`;
    case "show_hierarchy":
      return `${shape.biggestGroup?.[1].length ?? 0} children under ${shape.biggestGroup?.[0] ?? "?"}`;
    case "show_spatial":
      return `${shape.counts.spatial} spatial relation(s)`;
    case "argue":
      return `${shape.counts.argumentative} support/refute relation(s)`;
    case "show_quantity":
      return `${shape.quantified} quantified entities`;
    case "introduce":
      return `identity relations around a person or group (score ${score})`;
    case "define":
      return `properties/instances define the subject (score ${score})`;
    case "narrate":
      return `actors moving through ${shape.sequenceChain.length} events`;
    case "express_uncertainty":
      return `hedged meaning dominates (score ${score})`;
    case "show_relationships":
      return `${shape.counts.associative} loose relation(s)`;
    case "describe":
      return "no dominant structure; entities only";
  }
}
