/**
 * Pure hierarchical layout: SemanticState -> where each concept's box goes,
 * relative to a (0,0) cluster origin. No Excalidraw, no side effects — this
 * is Part 5/7 of the Meaning Canvas brief ("hierarchy must drive layout",
 * "layout should work on groups/subtrees") answered as a deterministic,
 * testable function, the same posture lib/composition.ts and
 * lib/visualReentry/render.ts's measure functions already take in this
 * codebase.
 *
 * Algorithm: a layered tree (Reingold-Tilford, simplified). Relationships
 * are read as parent -> child edges to build a spanning forest rooted at
 * the primary concept(s) (BFS/DFS order, first relationship to claim a
 * child wins, cycles are skipped) — this is a layout decision only, not a
 * semantic one: `from`/`to` still carries its real relationship `type` for
 * rendering, this tree is purely "who sits near whom." A concept relations
 * doesn't reach from any root becomes its own root, so nothing is ever
 * dropped from the layout even if the graph is disconnected.
 *
 * This directly answers the "long arrows crossing the canvas" bug: a child
 * is always positioned directly beneath its parent's subtree, so an edge
 * connects two spatially close boxes by construction, not by chance.
 */

import type { ConceptImportance, SemanticState, VisualPlan } from "./types";

export interface LayoutBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HierarchicalLayout {
  boxes: Map<string, LayoutBox>;
  width: number;
  height: number;
}

export const NODE_W = 220;
export const NODE_H = 64;
const H_GUTTER = 40;
export const V_GUTTER = 88;
/** Matches lib/choreographerComparison.ts's COLUMN_GAP — two poles side by side, not a tree. */
export const COMPARISON_COLUMN_GAP = 64;

const IMPORTANCE_RANK: Record<ConceptImportance, number> = { primary: 0, supporting: 1, detail: 2 };

function wouldCreateCycle(from: string, to: string, parentOf: Map<string, string>): boolean {
  let cur: string | undefined = from;
  const guard = new Set<string>();
  while (cur !== undefined) {
    if (cur === to) return true;
    if (guard.has(cur)) return false; // an existing cycle elsewhere in the (already-built) tree — not this edge's problem
    guard.add(cur);
    cur = parentOf.get(cur);
  }
  return false;
}

/** Depth-first: positions `id`'s whole subtree with its left edge at `xStart`, returns the subtree's total width. */
function layoutSubtree(
  id: string,
  childrenOf: Map<string, string[]>,
  xStart: number,
  depth: number,
  boxes: Map<string, LayoutBox>,
  maxDepth: { value: number },
): number {
  maxDepth.value = Math.max(maxDepth.value, depth);
  const children = childrenOf.get(id) ?? [];
  const y = depth * (NODE_H + V_GUTTER);

  if (!children.length) {
    boxes.set(id, { x: xStart, y, w: NODE_W, h: NODE_H });
    return NODE_W;
  }

  let cx = xStart;
  const centers: number[] = [];
  for (const childId of children) {
    const w = layoutSubtree(childId, childrenOf, cx, depth + 1, boxes, maxDepth);
    const childBox = boxes.get(childId);
    if (childBox) centers.push(childBox.x + childBox.w / 2);
    cx += w + H_GUTTER;
  }
  const subtreeWidth = Math.max(NODE_W, cx - H_GUTTER - xStart);
  const center = centers.length ? (centers[0] + centers[centers.length - 1]) / 2 : xStart + NODE_W / 2;
  boxes.set(id, { x: center - NODE_W / 2, y, w: NODE_W, h: NODE_H });
  return subtreeWidth;
}

export function computeHierarchicalLayout(state: SemanticState): HierarchicalLayout {
  const concepts = state.concepts;
  if (!concepts.length) return { boxes: new Map(), width: 0, height: 0 };

  const childrenOf = new Map<string, string[]>();
  for (const c of concepts) childrenOf.set(c.id, []);
  const parentOf = new Map<string, string>();

  for (const rel of state.relationships) {
    if (!childrenOf.has(rel.from) || !childrenOf.has(rel.to)) continue;
    if (rel.from === rel.to) continue;
    if (parentOf.has(rel.to)) continue; // already claimed by an earlier relationship
    if (wouldCreateCycle(rel.from, rel.to, parentOf)) continue;
    parentOf.set(rel.to, rel.from);
    childrenOf.get(rel.from)!.push(rel.to);
  }

  const roots = concepts
    .filter((c) => !parentOf.has(c.id))
    .sort((a, b) => IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance]);

  const boxes = new Map<string, LayoutBox>();
  const maxDepth = { value: 0 };
  let cursorX = 0;
  for (const root of roots) {
    const w = layoutSubtree(root.id, childrenOf, cursorX, 0, boxes, maxDepth);
    cursorX += w + H_GUTTER;
  }

  const width = Math.max(0, cursorX - H_GUTTER);
  const height = (maxDepth.value + 1) * (NODE_H + V_GUTTER) - V_GUTTER;
  return { boxes, width, height };
}

/**
 * A causal chain is a sentence, not a tree. One column, spine order, same
 * x-center — so "AI → easier building → more apps → trust" reads top to
 * bottom instead of as parent/child hierarchy.
 */
export function computeCausalChainLayout(state: SemanticState, plan: VisualPlan): HierarchicalLayout {
  const known = new Set(state.concepts.map((c) => c.id));
  const ids = plan.focusConceptIds.filter((id) => known.has(id));
  const boxes = new Map<string, LayoutBox>();
  ids.forEach((id, i) => {
    boxes.set(id, { x: 0, y: i * (NODE_H + V_GUTTER), w: NODE_W, h: NODE_H });
  });
  return {
    boxes,
    width: ids.length ? NODE_W : 0,
    height: ids.length ? ids.length * NODE_H + Math.max(0, ids.length - 1) * V_GUTTER : 0,
  };
}

function connected(a: string, b: string, state: SemanticState): boolean {
  return state.relationships.some(
    (r) => (r.from === a && r.to === b) || (r.from === b && r.to === a),
  );
}

/**
 * Two poles on one row, supporters stacked under the pole they belong to.
 * Plan.focusConceptIds leads with the contrast endpoints (see plan.ts).
 * Falls back to the hierarchical layout if the plan is too thin to be a pair.
 */
export function computeComparisonLayout(state: SemanticState, plan: VisualPlan): HierarchicalLayout {
  const known = new Set(state.concepts.map((c) => c.id));
  const ids = plan.focusConceptIds.filter((id) => known.has(id));
  if (ids.length < 2) return computeHierarchicalLayout(state);

  const leftPole = ids[0];
  const rightPole = ids[1];
  const left: string[] = [leftPole];
  const right: string[] = [rightPole];
  for (const id of ids.slice(2)) {
    const toLeft = connected(id, leftPole, state);
    const toRight = connected(id, rightPole, state);
    if (toLeft && !toRight) left.push(id);
    else if (toRight && !toLeft) right.push(id);
    else if (left.length <= right.length) left.push(id);
    else right.push(id);
  }

  const boxes = new Map<string, LayoutBox>();
  const placeColumn = (column: string[], x: number) => {
    column.forEach((id, i) => {
      boxes.set(id, { x, y: i * (NODE_H + V_GUTTER), w: NODE_W, h: NODE_H });
    });
  };
  placeColumn(left, 0);
  placeColumn(right, NODE_W + COMPARISON_COLUMN_GAP);
  const rows = Math.max(left.length, right.length);
  return {
    boxes,
    width: NODE_W * 2 + COMPARISON_COLUMN_GAP,
    height: rows ? rows * NODE_H + Math.max(0, rows - 1) * V_GUTTER : 0,
  };
}

const ENCLOSURE_PAD = 20;
export const ENCLOSURE_HEADER = 56;
const ENCLOSURE_ROW_GAP = 24;
const ENCLOSURE_CHILD_H = 72;

function enclosureColumns(n: number): number {
  if (n <= 2) return n || 1;
  if (n === 4) return 2;
  return Math.min(3, n);
}

/**
 * contains / part_of / a claim with supporting reasons: the parent is a
 * region, children sit inside it. Enclosure is the grammar — not a "part of" arrow.
 * Four children wrap 2×2 so the region does not become a stadium banner.
 */
export function computeEnclosureLayout(state: SemanticState, plan: VisualPlan): HierarchicalLayout {
  const known = new Set(state.concepts.map((c) => c.id));
  const ids = plan.focusConceptIds.filter((id) => known.has(id));
  if (ids.length < 2) return computeHierarchicalLayout(state);
  const root = ids[0];
  const children = ids.slice(1);
  const cols = enclosureColumns(children.length);
  const rows = Math.max(1, Math.ceil(children.length / cols));
  const boxes = new Map<string, LayoutBox>();
  children.forEach((id, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    boxes.set(id, {
      x: ENCLOSURE_PAD + col * (NODE_W + H_GUTTER),
      y: ENCLOSURE_HEADER + row * (ENCLOSURE_CHILD_H + ENCLOSURE_ROW_GAP),
      w: NODE_W,
      h: ENCLOSURE_CHILD_H,
    });
  });
  const innerW = cols * NODE_W + (cols - 1) * H_GUTTER;
  const innerH = rows * ENCLOSURE_CHILD_H + (rows - 1) * ENCLOSURE_ROW_GAP;
  boxes.set(root, {
    x: 0,
    y: 0,
    w: innerW + ENCLOSURE_PAD * 2,
    h: ENCLOSURE_HEADER + innerH + ENCLOSURE_PAD,
  });
  return {
    boxes,
    width: innerW + ENCLOSURE_PAD * 2,
    height: ENCLOSURE_HEADER + innerH + ENCLOSURE_PAD,
  };
}

/** Form-aware layout: the planner chooses the sentence, this picks the geometry. */
export function computeMeaningLayout(state: SemanticState, plan: VisualPlan): HierarchicalLayout {
  if (plan.family === "causal_chain" || plan.family === "concept_network") return computeCausalChainLayout(state, plan);
  if (plan.family === "comparison") return computeComparisonLayout(state, plan);
  if (plan.family === "hierarchy") return computeEnclosureLayout(state, plan);
  return computeHierarchicalLayout(state);
}
