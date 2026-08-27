/**
 * Failure attribution: which layer first broke the meaning?
 *
 * The whole reason the pipeline returns every intermediate stage is this
 * question. A bad picture has symptoms at every layer below the one that
 * actually failed, and fixing the symptom is how a system accumulates
 * special cases: if "traffic" appears twice on the canvas, the tempting fix
 * is in the composer, and the real fix is in entity identity four layers up.
 *
 * So attribution walks the pipeline IN ORDER and stops at the first stage
 * whose output already fails the expectation. Everything after that point is
 * downstream damage and is deliberately not reported — one cause per
 * failure, or the report becomes noise and nobody reads it.
 *
 * The expectations are written in terms of MEANING, never of pictures:
 * "Mariam must be recoverable as Kenny's mother", not "there must be a line
 * at 40,120". A test that pins coordinates freezes the layout and stops it
 * from ever improving, which is the opposite of what this loop is for.
 */

import type { ExpressionTrace } from "../pipeline";
import { isLiveEntityStatus, relationFamily, type RelationType, type WorldState } from "../schemas";
import { normalizeMention } from "../world/apply";

/**
 * Where a failure originated. Ordered by pipeline position — the order of
 * this list IS the search order, so a new stage must be inserted at its
 * real position rather than appended.
 */
export const FAILURE_CLASSES = [
  "MEANING_EXTRACTION",
  "ENTITY_IDENTITY",
  "REFERENCE_RESOLUTION",
  "WORLD_UPDATE",
  "INTENT_SELECTION",
  "GRAMMAR_SELECTION",
  "EXPRESSION_PLANNING",
  "COMPOSITION",
  "RENDERING",
  "SEMANTIC_EVALUATION",
  "VISUAL_CLUTTER",
  "CONTINUITY",
] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

/** A relation written the way a person would state it, for expectations. */
export type RelationExpectation = [source: string, type: RelationType, target: string];

export interface Expectation {
  /** Entity labels that must exist in the world by the end of the scenario. */
  entities?: string[];
  /** Labels that must NOT have been split into two entities. */
  singular?: string[];
  /** Relations that must exist in the world, by entity label. */
  relations?: RelationExpectation[];
  /** Relations that must be RECOVERABLE from the drawing, not merely stored. */
  readable?: RelationExpectation[];
  /** Entity labels that must appear on the canvas. */
  drawn?: string[];
  /** Entity labels that must NOT exist — a retraction that should have removed them. */
  absent?: string[];
  intent?: string | string[];
  grammar?: string | string[];
  /** Total live entity count, when the exact number is the point. */
  entityCount?: number;
  /** Minimum acceptable score for a named dimension. */
  minDimension?: Partial<Record<"entity" | "relation" | "causal" | "quantity" | "ordering" | "polarity" | "uncertainty", number>>;
}

export interface Failure {
  failureClass: FailureClass;
  detail: string;
  /** What the later stages showed as a result — context, not the diagnosis. */
  downstream?: string[];
}

// ─────────────────────────────────────────────────────────── lookup

function liveEntities(world: WorldState) {
  return world.entities.filter((e) => isLiveEntityStatus(e.status));
}

/**
 * Finds an entity by what a person would call it. Expectations are written
 * with human labels ("Mariam", "my family"), while the world holds minted
 * ids and sharpened labels, so matching goes through the same normalisation
 * the world model itself uses rather than through a second, subtly different
 * rule.
 */
function findEntity(world: WorldState, label: string) {
  const wanted = normalizeMention(label);
  return liveEntities(world).find(
    (e) => normalizeMention(e.label) === wanted || e.aliases.includes(wanted) || e.id === wanted.replace(/\s+/g, "-"),
  );
}

function relationExists(world: WorldState, [source, type, target]: RelationExpectation): boolean {
  const from = findEntity(world, source);
  const to = findEntity(world, target);
  if (!from || !to) return false;
  return world.relations.some((r) => r.source === from.id && r.target === to.id && r.type === type);
}

// ───────────────────────────────────────────────────────── attribution

/**
 * Walks the stages in order and returns the FIRST one that already fails.
 * Returns null when the trace meets every expectation.
 */
export function attributeFailure(trace: ExpressionTrace, expect: Expectation): Failure | null {
  const { world, delta, intent, plan, scene, evaluation } = trace;

  // ---- 1. MEANING_EXTRACTION -------------------------------------
  // Only checkable when the delta came from a real model. With a fixture the
  // delta is an input, so this stage cannot fail by construction — which is
  // exactly why the live runner exists alongside the offline one.
  for (const label of expect.entities ?? []) {
    if (findEntity(world, label)) continue;
    const inDelta = delta.entities.some((e) => normalizeMention(e.label) === normalizeMention(label));
    if (!inDelta && !world.entities.length) {
      return {
        failureClass: "MEANING_EXTRACTION",
        detail: `"${label}" was never extracted from the speech at all`,
      };
    }
  }

  // ---- 2. ENTITY_IDENTITY ----------------------------------------
  // One real thing that became two. Checked before anything downstream,
  // because a split entity breaks relations, chains and continuity, and
  // every one of those looks like a different bug.
  for (const label of expect.singular ?? []) {
    const wanted = normalizeMention(label);
    const matches = liveEntities(world).filter(
      (e) => normalizeMention(e.label) === wanted || e.aliases.includes(wanted),
    );
    if (matches.length > 1) {
      return {
        failureClass: "ENTITY_IDENTITY",
        detail: `"${label}" exists ${matches.length} times: ${matches.map((m) => `${m.id}:${m.type}`).join(", ")}`,
        downstream: [`relations split across the duplicates`, `chains through "${label}" break in half`],
      };
    }
  }
  if (expect.entityCount !== undefined && liveEntities(world).length > expect.entityCount) {
    return {
      failureClass: "ENTITY_IDENTITY",
      detail: `${liveEntities(world).length} entities where ${expect.entityCount} were expected: ${liveEntities(world).map((e) => e.label).join(", ")}`,
    };
  }

  // ---- 3. REFERENCE_RESOLUTION -----------------------------------
  // A pronoun that became its own entity instead of resolving. "she" on the
  // canvas is always this failure, never a drawing problem.
  const PRONOUNS = new Set(["he", "she", "it", "they", "them", "him", "her", "this", "that", "we", "us"]);
  const unresolved = liveEntities(world).filter((e) => PRONOUNS.has(normalizeMention(e.label)));
  if (unresolved.length) {
    return {
      failureClass: "REFERENCE_RESOLUTION",
      detail: `a pronoun became an entity of its own: ${unresolved.map((e) => `"${e.label}"`).join(", ")}`,
    };
  }

  // ---- 4. WORLD_UPDATE -------------------------------------------
  for (const label of expect.entities ?? []) {
    if (!findEntity(world, label)) {
      return {
        failureClass: "WORLD_UPDATE",
        detail: `"${label}" was extracted but never reached the world`,
      };
    }
  }
  for (const label of expect.absent ?? []) {
    if (findEntity(world, label)) {
      return {
        failureClass: "WORLD_UPDATE",
        detail: `"${label}" should have been retracted but is still active`,
      };
    }
  }
  for (const expected of expect.relations ?? []) {
    if (!relationExists(world, expected)) {
      return {
        failureClass: "WORLD_UPDATE",
        detail: `the world is missing ${expected[0]} -${expected[1]}-> ${expected[2]}`,
      };
    }
  }

  // ---- 5. INTENT_SELECTION ---------------------------------------
  if (expect.intent) {
    const allowed = Array.isArray(expect.intent) ? expect.intent : [expect.intent];
    if (!allowed.includes(intent.primary)) {
      return {
        failureClass: "INTENT_SELECTION",
        detail: `chose "${intent.primary}" (${intent.reason}); expected ${allowed.join(" or ")}`,
        downstream: [`grammar "${plan.grammar}" follows from the wrong intent`],
      };
    }
  }

  // ---- 6. GRAMMAR_SELECTION --------------------------------------
  if (expect.grammar) {
    const allowed = Array.isArray(expect.grammar) ? expect.grammar : [expect.grammar];
    if (!allowed.includes(plan.grammar)) {
      return {
        failureClass: "GRAMMAR_SELECTION",
        detail: `chose "${plan.grammar}" (${plan.reason}); expected ${allowed.join(" or ")}`,
      };
    }
  }

  // ---- 7. EXPRESSION_PLANNING ------------------------------------
  // In the world, but the planner gave it no region.
  for (const label of expect.drawn ?? []) {
    const entity = findEntity(world, label);
    if (!entity) continue; // already reported above
    const hasRegion = plan.regions.some((r) => r.entityId === entity.id);
    if (!hasRegion) {
      return {
        failureClass: "EXPRESSION_PLANNING",
        detail: `"${label}" is in the world but the ${plan.grammar} grammar gave it no region (${plan.reason})`,
      };
    }
  }
  for (const expected of expect.readable ?? []) {
    const from = findEntity(world, expected[0]);
    const to = findEntity(world, expected[2]);
    if (!from || !to) continue;
    const relation = world.relations.find((r) => r.source === from.id && r.target === to.id && r.type === expected[1]);
    if (relation && !plan.connections.some((c) => c.relationId === relation.id)) {
      return {
        failureClass: "EXPRESSION_PLANNING",
        detail: `${expected[0]} -${expected[1]}-> ${expected[2]} is in the world but the plan never connected it`,
      };
    }
  }

  // ---- 8. COMPOSITION --------------------------------------------
  // Has a region, but no object — or objects that collide.
  for (const label of expect.drawn ?? []) {
    const entity = findEntity(world, label);
    if (!entity) continue;
    if (!scene.objects.some((o) => o.entityId === entity.id)) {
      return {
        failureClass: "COMPOSITION",
        detail: `"${label}" has a region but never became a scene object`,
      };
    }
  }
  const overlap = evaluation.problems.find((p) => p.type === "overlap");
  if (overlap) {
    return { failureClass: "COMPOSITION", detail: overlap.detail };
  }

  // ---- 9. RENDERING ----------------------------------------------
  // A connection that exists in the plan but was drawn as nothing, for a
  // relation the arrangement cannot state on its own. Enclosure and parallel
  // placement legitimately draw nothing; a causal claim never can.
  for (const expected of expect.readable ?? []) {
    const from = findEntity(world, expected[0]);
    const to = findEntity(world, expected[2]);
    if (!from || !to) continue;
    const relation = world.relations.find((r) => r.source === from.id && r.target === to.id && r.type === expected[1]);
    if (!relation) continue;
    if (evaluation.recoveredRelationIds.includes(relation.id)) continue;
    const connector = scene.connectors.find((c) => c.relationId === relation.id);
    const family = relationFamily(relation.type);
    if (connector && connector.style === "none" && (family === "causal" || family === "temporal")) {
      return {
        failureClass: "RENDERING",
        detail: `${expected[0]} -${expected[1]}-> ${expected[2]} was planned but drawn as nothing, and direction cannot be inferred from position`,
      };
    }
    return {
      failureClass: "SEMANTIC_EVALUATION",
      detail: `${expected[0]} -${expected[1]}-> ${expected[2]} is not recoverable from the drawing`,
    };
  }

  // ---- 10. SEMANTIC_EVALUATION -----------------------------------
  // The evaluator disagreeing with itself: a clean score beside a serious
  // problem. A number that contradicts the problem list is worse than none.
  const severe = evaluation.problems.filter((p) => p.severity >= 0.6);
  if (severe.length && evaluation.semanticPreservation >= 0.95) {
    return {
      failureClass: "SEMANTIC_EVALUATION",
      detail: `scored ${evaluation.semanticPreservation} while reporting ${severe.length} severe problem(s): ${severe.map((p) => p.type).join(", ")}`,
    };
  }
  for (const [name, floor] of Object.entries(expect.minDimension ?? {})) {
    const measured = evaluation.preservation[name as keyof typeof evaluation.preservation];
    if (measured.score !== null && measured.score < floor) {
      return {
        failureClass: dimensionOwner(name),
        detail: `${name} preservation ${measured.score} below ${floor}: ${measured.lost.join("; ")}`,
      };
    }
  }

  // ---- 11. VISUAL_CLUTTER ----------------------------------------
  const clutter = evaluation.problems.find((p) => p.type === "clutter");
  if (clutter) {
    return { failureClass: "VISUAL_CLUTTER", detail: clutter.detail };
  }

  return null;
}

/**
 * Which layer owns a dimension when it scores low. Ordering is a placement
 * decision, polarity is a labelling decision, and the rest are about what
 * reached the canvas at all — so they are not all the same bug.
 */
function dimensionOwner(dimension: string): FailureClass {
  switch (dimension) {
    case "ordering":
      return "COMPOSITION";
    case "polarity":
      return "RENDERING";
    case "causal":
    case "relation":
      return "EXPRESSION_PLANNING";
    case "entity":
    case "quantity":
      return "EXPRESSION_PLANNING";
    case "uncertainty":
    default:
      return "SEMANTIC_EVALUATION";
  }
}

/**
 * Continuity across a multi-turn scenario, which no single trace can see:
 * something understood in an earlier turn that silently vanished later.
 * Checked separately because it is a property of the sequence, not of a
 * round — and because losing an entity the speaker already established is a
 * different bug from never having understood it.
 */
export function attributeContinuity(traces: ExpressionTrace[]): Failure | null {
  for (let i = 1; i < traces.length; i += 1) {
    const before = liveEntities(traces[i - 1].world);
    const after = new Set(liveEntities(traces[i].world).map((e) => e.id));
    const archived = new Set(traces[i].world.entities.filter((e) => !isLiveEntityStatus(e.status)).map((e) => e.id));
    const vanished = before.filter((e) => !after.has(e.id) && !archived.has(e.id));
    if (vanished.length) {
      return {
        failureClass: "CONTINUITY",
        detail: `turn ${i + 1} lost ${vanished.map((e) => `"${e.label}"`).join(", ")} without a retraction`,
      };
    }
  }
  return null;
}
