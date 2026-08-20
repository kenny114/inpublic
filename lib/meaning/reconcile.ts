/**
 * Reconciliation: previous SemanticState vs. new SemanticState -> the
 * minimum set of semantic operations. This is the piece that keeps meaning
 * from being an endless stream of dumped concepts — something that already
 * has an id only ever gets an UPDATE, never a second ADD.
 *
 * Pure and synchronous: no Excalidraw, no ids beyond the semantic ones
 * already in each state. This is debug/audit output, not a canvas
 * instruction set — lib/meaning/apply.ts (rendering) recomputes its own
 * layout directly from the full SemanticState, it does not consume
 * CanvasOperation[] at all. What these ops ARE used for: (1) deciding
 * whether a round produced anything worth reporting at all (empty ops means
 * "no change" — see lib/meaning/engine.ts), and (2) the mechanical
 * "what changed" half of the Part-10 debug view; the model's own
 * `currentInterpretation` field carries the narrative "why" half (a merge,
 * a correction, a clarification) that a before/after diff by id cannot
 * recover on its own.
 */

import type { Claim, Concept, Relationship, SemanticState } from "./types";

export type CanvasOperation =
  | { kind: "ADD_NODE"; concept: Concept }
  | { kind: "UPDATE_NODE"; concept: Concept; prev: Concept }
  | { kind: "REMOVE_NODE"; conceptId: string }
  | { kind: "ADD_EDGE"; relationship: Relationship }
  | { kind: "UPDATE_EDGE"; relationship: Relationship; prev: Relationship }
  | { kind: "REMOVE_EDGE"; relationshipId: string }
  | { kind: "ADD_CLAIM"; claim: Claim }
  | { kind: "UPDATE_CLAIM"; claim: Claim; prev: Claim }
  | { kind: "REMOVE_CLAIM"; claimId: string };

/**
 * Edges are removed before nodes (so REMOVE_NODE never needs to cascade) and
 * added after nodes (so ADD_EDGE/UPDATE_EDGE can always find both endpoints
 * already placed). Order within each group follows the new state's own
 * array order, which is the model's stated priority.
 */
export function diffSemanticState(prev: SemanticState, next: SemanticState): CanvasOperation[] {
  const ops: CanvasOperation[] = [];

  const prevConcepts = new Map(prev.concepts.map((c) => [c.id, c]));
  const nextConcepts = new Map(next.concepts.map((c) => [c.id, c]));
  const prevRels = new Map(prev.relationships.map((r) => [r.id, r]));
  const nextRels = new Map(next.relationships.map((r) => [r.id, r]));
  const prevClaims = new Map((prev.claims ?? []).map((c) => [c.id, c]));
  const nextClaims = new Map((next.claims ?? []).map((c) => [c.id, c]));

  for (const [id] of prevRels) {
    if (!nextRels.has(id)) ops.push({ kind: "REMOVE_EDGE", relationshipId: id });
  }
  for (const [id] of prevConcepts) {
    if (!nextConcepts.has(id)) ops.push({ kind: "REMOVE_NODE", conceptId: id });
  }
  for (const [id] of prevClaims) {
    if (!nextClaims.has(id)) ops.push({ kind: "REMOVE_CLAIM", claimId: id });
  }

  for (const concept of next.concepts) {
    const prevConcept = prevConcepts.get(concept.id);
    if (!prevConcept) {
      ops.push({ kind: "ADD_NODE", concept });
    } else if (
      prevConcept.label !== concept.label ||
      prevConcept.importance !== concept.importance ||
      (prevConcept.status ?? "active") !== (concept.status ?? "active")
    ) {
      ops.push({ kind: "UPDATE_NODE", concept, prev: prevConcept });
    }
  }
  for (const relationship of next.relationships) {
    const prevRel = prevRels.get(relationship.id);
    if (!prevRel) {
      ops.push({ kind: "ADD_EDGE", relationship });
    } else if (
      prevRel.from !== relationship.from ||
      prevRel.to !== relationship.to ||
      prevRel.type !== relationship.type ||
      prevRel.label !== relationship.label
    ) {
      ops.push({ kind: "UPDATE_EDGE", relationship, prev: prevRel });
    }
  }
  for (const claim of next.claims ?? []) {
    const prevClaim = prevClaims.get(claim.id);
    if (!prevClaim) {
      ops.push({ kind: "ADD_CLAIM", claim });
    } else if (
      prevClaim.text !== claim.text ||
      prevClaim.importance !== claim.importance ||
      JSON.stringify(prevClaim.about ?? []) !== JSON.stringify(claim.about ?? [])
    ) {
      ops.push({ kind: "UPDATE_CLAIM", claim, prev: prevClaim });
    }
  }
  return ops;
}
