/**
 * Deterministic visual planner: SemanticState -> VisualPlan.
 *
 * If meaning is right, form follows. This module never calls a model and
 * never thinks in pixels — it only reads relationship types and importance
 * and decides which sentence the canvas should speak. An LLM picking
 * "diagram type" would reintroduce speech-to-visuals one stage later.
 *
 * First match wins:
 *   1. longest causes|leads_to|depends_on path of 2+ nodes → causal_chain
 *   2. a contrasts edge, or two quantified concepts → comparison
 *   3. contains|part_of, or a claim with ≥2 supports → hierarchy (enclosure)
 *   4. a lone unstructured aside → draw nothing
 *   5. else → concept_network (a column, not a spanning tree)
 *
 * Visual restraint lives here, not in the semantic caps: at most
 * DISPLAY_BUDGET concepts are focused. Claims never become boxes.
 */

import {
  EMPTY_VISUAL_PLAN,
  type Concept,
  type Relationship,
  type SemanticState,
  type VisualPlan,
} from "./types";

export const CAUSAL_TYPES = new Set(["causes", "leads_to", "depends_on"]);
const CONTAINMENT_TYPES = new Set(["contains", "part_of"]);
const DISPLAY_BUDGET = 6;
const ANNOTATION_BUDGET = 4;

const IMPORTANCE_RANK: Record<string, number> = { primary: 0, supporting: 1, detail: 2 };

function isActive(concept: Concept): boolean {
  return concept.status !== "superseded";
}

function activeConcepts(state: SemanticState): Concept[] {
  return state.concepts.filter(isActive);
}

function importanceOf(state: SemanticState, id: string): number {
  const concept = state.concepts.find((c) => c.id === id);
  return IMPORTANCE_RANK[concept?.importance ?? "detail"] ?? 2;
}

/**
 * Longest directed path using only causes/leads_to, as concept ids.
 * Gold assertions import this so they cannot drift from the planner.
 */
export function longestCausalSpineIds(state: SemanticState): string[] {
  const concepts = activeConcepts(state);
  const known = new Set(concepts.map((c) => c.id));
  const outgoing = new Map<string, string[]>(concepts.map((c) => [c.id, []]));
  for (const rel of state.relationships) {
    if (!CAUSAL_TYPES.has(rel.type)) continue;
    if (!known.has(rel.from) || !known.has(rel.to) || rel.from === rel.to) continue;
    outgoing.get(rel.from)!.push(rel.to);
  }

  let best: string[] = [];
  function dfs(node: string, path: string[], seen: Set<string>): void {
    const nexts = outgoing.get(node) ?? [];
    let extended = false;
    for (const next of nexts) {
      if (seen.has(next)) continue;
      extended = true;
      seen.add(next);
      dfs(next, [...path, next], seen);
      seen.delete(next);
    }
    if (!extended && path.length > best.length) best = path;
  }

  const starts = [...concepts].sort((a, b) => IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance]);
  for (const concept of starts) {
    dfs(concept.id, [concept.id], new Set([concept.id]));
  }
  return best;
}

function budgetIds(ids: string[], state: SemanticState, max: number): string[] {
  if (ids.length <= max) return ids;
  if (ids.length <= 2) return ids.slice(0, max);
  const keepEnds = [ids[0], ids[ids.length - 1]];
  const middle = ids.slice(1, -1);
  const ranked = [...middle].sort((a, b) => importanceOf(state, a) - importanceOf(state, b));
  const room = max - 2;
  const keptMiddle = new Set(ranked.slice(0, room));
  return [keepEnds[0], ...middle.filter((id) => keptMiddle.has(id)), keepEnds[1]];
}

function edgesAlong(path: string[], relationships: Relationship[], types?: Set<string>): string[] {
  const ids: string[] = [];
  for (let i = 0; i < path.length - 1; i += 1) {
    const from = path[i];
    const to = path[i + 1];
    const rel = relationships.find(
      (r) => r.from === from && r.to === to && (!types || types.has(r.type)),
    );
    if (rel) ids.push(rel.id);
  }
  return ids;
}

function annotationIds(state: SemanticState, focus: Set<string>): string[] {
  const ranked = (state.claims ?? [])
    .filter((claim) => (claim.about ?? []).some((id) => focus.has(id)) || !(claim.about ?? []).length)
    .sort((a, b) => IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance]);
  // Unattached claims only annotate when there is no focused concept to hang on.
  const attached = ranked.filter((c) => (c.about ?? []).some((id) => focus.has(id)));
  const pool = attached.length ? attached : ranked;
  return pool.slice(0, ANNOTATION_BUDGET).map((c) => c.id);
}

function relationshipsAmong(state: SemanticState, focus: Set<string>): string[] {
  return state.relationships
    .filter((r) => focus.has(r.from) && focus.has(r.to))
    .map((r) => r.id);
}

function pickContrast(state: SemanticState): Relationship | null {
  const active = new Map(activeConcepts(state).map((c) => [c.id, c]));
  const candidates = state.relationships.filter((r) => {
    if (r.type !== "contrasts") return false;
    const a = active.get(r.from);
    const b = active.get(r.to);
    return Boolean(a && b && a.importance !== "detail" && b.importance !== "detail");
  });
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => {
    const aRank = importanceOf(state, a.from) + importanceOf(state, a.to);
    const bRank = importanceOf(state, b.from) + importanceOf(state, b.to);
    return aRank - bRank;
  })[0];
}

function neighborsOf(id: string, state: SemanticState): string[] {
  const active = new Set(activeConcepts(state).map((c) => c.id));
  const ids: string[] = [];
  for (const rel of state.relationships) {
    if (rel.from === id && active.has(rel.to) && rel.to !== id) ids.push(rel.to);
    if (rel.to === id && active.has(rel.from) && rel.from !== id) ids.push(rel.from);
  }
  return ids;
}

function containmentChild(rel: Relationship): { parent: string; child: string } | null {
  if (rel.type === "contains") return { parent: rel.from, child: rel.to };
  if (rel.type === "part_of") return { parent: rel.to, child: rel.from };
  return null;
}

function pickHierarchyRoot(state: SemanticState): { root: string; children: string[] } | null {
  const active = new Set(activeConcepts(state).map((c) => c.id));
  const childrenOf = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  for (const id of active) childrenOf.set(id, []);
  for (const rel of state.relationships) {
    if (!CONTAINMENT_TYPES.has(rel.type)) continue;
    const pair = containmentChild(rel);
    if (!pair) continue;
    if (!active.has(pair.parent) || !active.has(pair.child) || pair.parent === pair.child) continue;
    if (parentOf.has(pair.child)) continue;
    parentOf.set(pair.child, pair.parent);
    childrenOf.get(pair.parent)!.push(pair.child);
  }
  const roots = [...active].filter((id) => !parentOf.has(id) && (childrenOf.get(id)?.length ?? 0) >= 2);
  if (!roots.length) return null;
  roots.sort((a, b) => importanceOf(state, a) - importanceOf(state, b) || (childrenOf.get(b)?.length ?? 0) - (childrenOf.get(a)?.length ?? 0));
  const root = roots[0];
  return { root, children: childrenOf.get(root) ?? [] };
}

function collectDescendants(root: string, state: SemanticState): string[] {
  const active = new Set(activeConcepts(state).map((c) => c.id));
  const childrenOf = new Map<string, string[]>();
  for (const id of active) childrenOf.set(id, []);
  for (const rel of state.relationships) {
    const pair = containmentChild(rel);
    if (!pair || !active.has(pair.parent) || !active.has(pair.child)) continue;
    childrenOf.get(pair.parent)!.push(pair.child);
  }
  const ordered: string[] = [root];
  const queue = [root];
  const seen = new Set([root]);
  while (queue.length) {
    const id = queue.shift()!;
    for (const child of childrenOf.get(id) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      ordered.push(child);
      queue.push(child);
    }
  }
  return ordered;
}

function networkFocus(state: SemanticState): string[] {
  const ranked = [...activeConcepts(state)].sort(
    (a, b) => IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance],
  );
  return ranked.slice(0, DISPLAY_BUDGET).map((c) => c.id);
}

const NUMBER_WORD = /^(one|two|three|four|five|six|seven|eight|nine|ten|\d+)/i;

function isQuantified(concept: Concept): boolean {
  if (concept.quantity && Number.isFinite(concept.quantity.value)) return true;
  return NUMBER_WORD.test(concept.label.trim());
}

/** Two counted things with no better structure — have vs need, revenue vs cost. */
function pickQuantityPair(state: SemanticState): [string, string] | null {
  const counted = activeConcepts(state).filter((c) => c.importance !== "detail" && isQuantified(c));
  if (counted.length < 2) return null;
  return [counted[0].id, counted[1].id];
}

/** A claim/problem with two or more supporting reasons pointing at it. */
function pickSupportBundle(state: SemanticState): { root: string; children: string[] } | null {
  const active = new Map(activeConcepts(state).map((c) => [c.id, c]));
  let best: { root: string; children: string[] } | null = null;
  for (const concept of active.values()) {
    const children = state.relationships
      .filter((r) => r.type === "supports" && r.to === concept.id && active.has(r.from))
      .map((r) => r.from);
    if (children.length < 2) continue;
    if (!best || children.length > best.children.length || importanceOf(state, concept.id) < importanceOf(state, best.root)) {
      best = { root: concept.id, children };
    }
  }
  return best;
}

function isVisuallyThin(state: SemanticState): boolean {
  const meat = activeConcepts(state).filter((c) => c.importance !== "detail");
  if (meat.length >= 2) return false;
  if (meat.length === 1 && (meat[0].importance === "primary" || isQuantified(meat[0])) && meat[0].label.trim().length > 2) return false;
  return true;
}

export function planMeaning(state: SemanticState): VisualPlan {
  if (!activeConcepts(state).length && !(state.claims ?? []).length) return EMPTY_VISUAL_PLAN;

  const spine = longestCausalSpineIds(state);
  if (spine.length >= 3) {
    const focusConceptIds = budgetIds(spine, state, DISPLAY_BUDGET);
    const focus = new Set(focusConceptIds);
    return {
      family: "causal_chain",
      focusConceptIds,
      focusRelationshipIds: edgesAlong(focusConceptIds, state.relationships, CAUSAL_TYPES),
      annotationClaimIds: annotationIds(state, focus),
      reason: `causal spine of ${spine.length}: ${focusConceptIds.join(" → ")}`,
    };
  }

  const contrast = pickContrast(state);
  if (contrast) {
    const poles = [contrast.from, contrast.to];
    const neighborIds = [...new Set([...neighborsOf(contrast.from, state), ...neighborsOf(contrast.to, state)])]
      .filter((id) => !poles.includes(id))
      .sort((a, b) => importanceOf(state, a) - importanceOf(state, b));
    const focusConceptIds = budgetIds([...poles, ...neighborIds], state, DISPLAY_BUDGET);
    const focus = new Set(focusConceptIds);
    return {
      family: "comparison",
      focusConceptIds,
      focusRelationshipIds: relationshipsAmong(state, focus),
      annotationClaimIds: annotationIds(state, focus),
      reason: `contrasts ${contrast.from} vs ${contrast.to}`,
    };
  }

  const quantities = pickQuantityPair(state);
  if (quantities) {
    const focusConceptIds = budgetIds(quantities, state, DISPLAY_BUDGET);
    const focus = new Set(focusConceptIds);
    return {
      family: "comparison",
      focusConceptIds,
      focusRelationshipIds: relationshipsAmong(state, focus),
      annotationClaimIds: annotationIds(state, focus),
      reason: `quantified pair ${quantities[0]} vs ${quantities[1]}`,
    };
  }

  if (spine.length >= 2) {
    const focusConceptIds = budgetIds(spine, state, DISPLAY_BUDGET);
    const focus = new Set(focusConceptIds);
    return {
      family: "causal_chain",
      focusConceptIds,
      focusRelationshipIds: edgesAlong(focusConceptIds, state.relationships, CAUSAL_TYPES),
      annotationClaimIds: annotationIds(state, focus),
      reason: `causal spine of ${spine.length}: ${focusConceptIds.join(" → ")}`,
    };
  }

  const bundle = pickSupportBundle(state);
  if (bundle) {
    const focusConceptIds = budgetIds([bundle.root, ...bundle.children], state, DISPLAY_BUDGET);
    const focus = new Set(focusConceptIds);
    return {
      family: "hierarchy",
      focusConceptIds,
      focusRelationshipIds: relationshipsAmong(state, focus).filter((id) => state.relationships.find((r) => r.id === id)?.type === "supports"),
      annotationClaimIds: annotationIds(state, focus),
      reason: `supporting reasons under ${bundle.root}`,
    };
  }

  const hierarchy = pickHierarchyRoot(state);
  if (hierarchy) {
    const focusConceptIds = budgetIds(collectDescendants(hierarchy.root, state), state, DISPLAY_BUDGET);
    const focus = new Set(focusConceptIds);
    return {
      family: "hierarchy",
      focusConceptIds,
      focusRelationshipIds: relationshipsAmong(state, focus).filter((id) => {
        const rel = state.relationships.find((r) => r.id === id);
        return rel ? CONTAINMENT_TYPES.has(rel.type) : false;
      }),
      annotationClaimIds: annotationIds(state, focus),
      reason: `containment under ${hierarchy.root} (${hierarchy.children.length} children)`,
    };
  }

  if (isVisuallyThin(state)) {
    return {
      ...EMPTY_VISUAL_PLAN,
      reason: "nothing visually worth expressing yet",
      annotationClaimIds: annotationIds(state, new Set()),
    };
  }

  const focusConceptIds = networkFocus(state);
  const focus = new Set(focusConceptIds);
  return {
    family: "concept_network",
    focusConceptIds,
    focusRelationshipIds: relationshipsAmong(state, focus),
    annotationClaimIds: annotationIds(state, focus),
    reason: focusConceptIds.length
      ? `no chain/contrast/hierarchy; ${focusConceptIds.length} concept network`
      : `claims only; no structural form`,
  };
}
