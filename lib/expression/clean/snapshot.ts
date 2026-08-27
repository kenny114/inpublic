/**
 * Compact structured view of what is actually on the canvas right now.
 *
 * The Clean Agent is not allowed to look at pixels, and it must not be
 * handed the whole WorldState either — that is the planner's input, and
 * mixing the two is how occupancy quietly becomes "everything the world
 * still believes". This snapshot is the board as a viewer would summarise
 * it: a handful of nodes, their rough size, and the lines between them.
 *
 * Node ids are entity ids, not scene-object ids. Keep/remove decisions are
 * about what the picture is OF, and every layer below already keys on
 * entity id.
 */

import { type ScenePlan } from "../schemas";

export type BoardNodeRole = "primary" | "support" | "periphery";

export interface BoardSnapshotNode {
  id: string;
  label: string;
  role: BoardNodeRole;
  /** Visual width after emphasis — the size a viewer actually sees. */
  size: number;
  x?: number;
  y?: number;
}

export interface BoardSnapshot {
  primary: { id: string; label: string; size: number } | null;
  nodes: BoardSnapshotNode[];
  connectors: Array<{ from: string; to: string; label?: string }>;
  nodeCount: number;
  connectorCount: number;
}

export const EMPTY_BOARD_SNAPSHOT: BoardSnapshot = {
  primary: null,
  nodes: [],
  connectors: [],
  nodeCount: 0,
  connectorCount: 0,
};

function roleFromWeight(weight: number): BoardNodeRole {
  if (weight >= 3) return "primary";
  if (weight >= 1) return "support";
  return "periphery";
}

/**
 * One node per entity. A quantity_array is still one thing; counting its
 * marks as separate nodes would make the occupancy cap lie.
 */
export function snapshotBoard(scene: ScenePlan | null, focusEntityId?: string): BoardSnapshot {
  if (!scene?.objects.length) return EMPTY_BOARD_SNAPSHOT;

  const byEntity = new Map<string, BoardSnapshotNode>();
  for (const object of scene.objects) {
    if (!object.entityId || byEntity.has(object.entityId)) continue;
    byEntity.set(object.entityId, {
      id: object.entityId,
      label: object.label ?? object.entityId,
      role: roleFromWeight(object.weight),
      size: object.w,
      x: object.x,
      y: object.y,
    });
  }

  const nodes = [...byEntity.values()];
  const entityOf = new Map(scene.objects.filter((o) => o.entityId).map((o) => [o.id, o.entityId!]));
  const connectors: BoardSnapshot["connectors"] = [];
  const seen = new Set<string>();
  for (const connector of scene.connectors) {
    const from = entityOf.get(connector.fromObjectId);
    const to = entityOf.get(connector.toObjectId);
    if (!from || !to || from === to) continue;
    const key = `${from}|${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    connectors.push(connector.label ? { from, to, label: connector.label } : { from, to });
  }

  const focused = focusEntityId ? byEntity.get(focusEntityId) : undefined;
  const heaviest = nodes.reduce<BoardSnapshotNode | undefined>((best, node) => {
    if (!best) return node;
    if (node.role === "primary" && best.role !== "primary") return node;
    if (node.role === best.role && node.size > best.size) return node;
    return best;
  }, undefined);
  const primaryNode = focused ?? (heaviest?.role === "primary" ? heaviest : undefined) ?? heaviest;

  return {
    primary: primaryNode ? { id: primaryNode.id, label: primaryNode.label, size: primaryNode.size } : null,
    nodes,
    connectors,
    nodeCount: nodes.length,
    connectorCount: connectors.length,
  };
}

/** True when the snapshot already violates the occupancy/hierarchy rules. */
export function snapshotNeedsPolice(snapshot: BoardSnapshot): boolean {
  if (snapshot.nodeCount > 6) return true;
  const large = snapshot.nodes.filter((n) => {
    if (n.role === "primary") return true;
    return snapshot.primary ? n.size >= snapshot.primary.size * 0.9 : n.size >= 140;
  });
  return large.length > 1;
}
