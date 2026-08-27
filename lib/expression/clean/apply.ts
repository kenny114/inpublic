/**
 * Enforce a CleanPlan on the expression plan, the composed scene, and the
 * render patch.
 *
 * The planner still chooses grammar — a chain, two poles, a tree — among
 * the entities the Clean Agent kept. This module is the hard gate after
 * that choice: membership, allowed lines, and a single dominant emphasis.
 * The composer then lays out a plan that already obeys the cap, so the
 * scene/patch filters below are belt-and-suspenders, not a second layout.
 */

import {
  ExpressionPlanSchema,
  relationFamily,
  type CleanPlan,
  type CleanRelation,
  type Connection,
  type ExpressionPlan,
  type Region,
  type RenderPatch,
  type ScenePlan,
  type WorldRelation,
  type WorldState,
} from "../schemas";
import { MAX_CLEAN_NODES } from "./plan";

const regionIdFor = (entityId: string) => `r-${entityId}`.slice(0, 48);

function pairKey(from: string, to: string): string {
  return `${from}|${to}`;
}

function allowedPairs(clean: CleanPlan): Set<string> {
  const set = new Set<string>();
  for (const rel of clean.allowedRelations) {
    set.add(pairKey(rel.from, rel.to));
  }
  return set;
}

function entityOfRegion(plan: ExpressionPlan, regionId: string): string | undefined {
  return plan.regions.find((r) => r.id === regionId)?.entityId;
}

function findRelation(world: WorldState, from: string, to: string): WorldRelation | undefined {
  return world.relations.find((r) => r.source === from && r.target === to);
}

function connectionKind(rel: WorldRelation): Connection["kind"] {
  const family = relationFamily(rel.type);
  if (family === "causal" || family === "temporal") return "flow";
  if (family === "comparative") return "comparison";
  if (family === "structural") return "containment";
  return "link";
}

/**
 * Rewrite an expression plan so it only contains what the Clean Agent
 * allowed. Grammar roles (chain_step, comparison_pole, …) are preserved
 * for kept entities so layout still knows what the structure is; the one
 * competing-centre exception is an old primary_subject that is no longer
 * the primary — that role becomes context, so it cannot keep weight 2.
 */
export function applyCleanToPlan(plan: ExpressionPlan, clean: CleanPlan, world: WorldState): ExpressionPlan {
  const keep = new Set(clean.keep);
  if (!keep.size && !clean.primaryId) {
    return { ...plan, regions: [], connections: [], emphasis: [], focusEntityId: undefined, reason: clean.reason };
  }

  const byEntity = new Map<string, Region>();
  for (const region of plan.regions) {
    if (region.entityId && keep.has(region.entityId) && !byEntity.has(region.entityId)) {
      byEntity.set(region.entityId, region);
    }
  }

  for (const id of clean.keep) {
    if (byEntity.has(id)) continue;
    const role: Region["role"] = id === clean.primaryId ? "primary_subject" : "context";
    byEntity.set(id, { id: regionIdFor(id), role, entityId: id });
  }

  const ordered: Region[] = [];
  const seen = new Set<string>();
  const push = (id: string | undefined) => {
    if (!id || seen.has(id)) return;
    const region = byEntity.get(id);
    if (!region) return;
    seen.add(id);
    let next = region;
    if (id !== clean.primaryId && (region.role === "primary_subject" || region.role === "hierarchy_root")) {
      next = { ...region, role: "context" };
    }
    ordered.push(next);
  };

  push(clean.primaryId);
  for (const region of plan.regions) push(region.entityId);
  for (const id of clean.keep) push(id);

  const entityRegions = ordered.slice(0, MAX_CLEAN_NODES);
  const keptRegionIds = new Set(entityRegions.map((r) => r.id));
  const keptEntities = new Set(entityRegions.map((r) => r.entityId).filter((id): id is string => Boolean(id)));

  const annotations = plan.regions.filter((r) => {
    if (r.role !== "annotation") return false;
    return Boolean(r.entityId && keptEntities.has(r.entityId));
  });

  const regions: Region[] = [
    ...entityRegions.map((r) => ({
      ...r,
      childRegionIds: r.childRegionIds?.filter((id) => keptRegionIds.has(id)),
    })),
    ...annotations,
  ];
  for (const region of annotations) keptRegionIds.add(region.id);

  const allowed = allowedPairs(clean);
  const connections: Connection[] = [];
  const seenConn = new Set<string>();
  const regionIdOf = (entityId: string, preferred?: string) => {
    if (preferred && keptRegionIds.has(preferred)) return preferred;
    return entityRegions.find((r) => r.entityId === entityId)?.id;
  };

  const addConnection = (fromEntity: string, toEntity: string, rel: CleanRelation | WorldRelation, existing?: Connection) => {
    const fromId = regionIdOf(fromEntity, existing?.fromRegionId);
    const toId = regionIdOf(toEntity, existing?.toRegionId);
    if (!fromId || !toId) return;
    const key = `${fromId}|${toId}`;
    if (seenConn.has(key)) return;
    seenConn.add(key);
    if (existing && existing.fromRegionId === fromId && existing.toRegionId === toId) {
      connections.push(existing);
      return;
    }
    const worldRel = "type" in rel ? rel : findRelation(world, fromEntity, toEntity);
    if (!worldRel) return;
    const label = "label" in rel ? rel.label : undefined;
    connections.push({
      id: `c-${worldRel.id}`.slice(0, 48),
      fromRegionId: fromId,
      toRegionId: toId,
      relationId: worldRel.id,
      kind: connectionKind(worldRel),
      ...(label ? { label } : {}),
    });
  };

  for (const connection of plan.connections) {
    const from = entityOfRegion(plan, connection.fromRegionId);
    const to = entityOfRegion(plan, connection.toRegionId);
    if (!from || !to) continue;
    if (!keptEntities.has(from) || !keptEntities.has(to)) continue;
    if (!allowed.has(pairKey(from, to))) continue;
    addConnection(from, to, { from, to }, connection);
  }

  for (const rel of clean.allowedRelations) {
    addConnection(rel.from, rel.to, rel);
  }

  const primaryRegion = regions.find((r) => r.entityId === clean.primaryId);
  const emphasis = primaryRegion
    ? [{ regionId: primaryRegion.id, weight: 3 as const, reason: "the subject of the board" }]
    : [];

  const next: ExpressionPlan = {
    ...plan,
    focusEntityId: clean.primaryId,
    regions,
    connections,
    emphasis,
    reason: plan.reason,
  };
  const parsed = ExpressionPlanSchema.safeParse(next);
  return parsed.success ? parsed.data : { ...next, connections: [], emphasis };
}

/**
 * Drop anything the Clean Agent rejected that still made it onto the
 * scene. Does not re-layout — the plan filter is supposed to have made
 * this a no-op. Demoted nodes are forced to weight 0 so they cannot
 * compete with the subject; the composer already reserved their cell
 * from base size, so shrinking the ink does not shove the spine.
 */
export function constrainScene(scene: ScenePlan, clean: CleanPlan): ScenePlan {
  const keep = new Set(clean.keep);
  const allowed = allowedPairs(clean);
  const objects = scene.objects.filter((object) => {
    if (object.entityId) return keep.has(object.entityId);
    return objectsAnchorKept(object.parentObjectId, scene, keep);
  });

  const objectIds = new Set(objects.map((o) => o.id));
  const entityOf = new Map(objects.filter((o) => o.entityId).map((o) => [o.id, o.entityId!]));
  const connectors = scene.connectors.filter((connector) => {
    if (!objectIds.has(connector.fromObjectId) || !objectIds.has(connector.toObjectId)) return false;
    const from = entityOf.get(connector.fromObjectId);
    const to = entityOf.get(connector.toObjectId);
    if (!from || !to) return false;
    return allowed.has(pairKey(from, to));
  });

  const demoted = new Set(clean.demote);
  const weighted = objects.map((object) => {
    if (!object.entityId) return object;
    if (object.entityId === clean.primaryId) return object.weight === 3 ? object : { ...object, weight: 3 };
    if (demoted.has(object.entityId)) return object.weight === 0 ? object : { ...object, weight: 0 };
    if (object.weight >= 3 && object.entityId !== clean.primaryId) return { ...object, weight: 1 };
    return object;
  });

  return {
    ...scene,
    objects: weighted,
    connectors,
    focusObjectId: weighted.find((o) => o.entityId === clean.primaryId)?.id ?? scene.focusObjectId,
  };
}

function objectsAnchorKept(parentObjectId: string | undefined, scene: ScenePlan, keep: Set<string>): boolean {
  if (!parentObjectId) return false;
  const parent = scene.objects.find((o) => o.id === parentObjectId);
  return Boolean(parent?.entityId && keep.has(parent.entityId));
}

/**
 * Last gate before a renderer sees a patch. An add whose entity was
 * rejected is dropped; a board object the plan named in `remove` is
 * forced into `removed` even if the diff missed it.
 */
export function constrainPatch(patch: RenderPatch, clean: CleanPlan, prev: ScenePlan | null): RenderPatch {
  const keep = new Set(clean.keep);
  const allowed = allowedPairs(clean);
  const entityOfPrev = new Map((prev?.objects ?? []).filter((o) => o.entityId).map((o) => [o.id, o.entityId!]));
  const entityOf = (objectId: string, entityId?: string) => entityId ?? entityOfPrev.get(objectId);

  const added = patch.added.filter((object) => !object.entityId || keep.has(object.entityId));
  const moved = patch.moved.filter(({ object }) => !object.entityId || keep.has(object.entityId));
  const updated = patch.updated.filter(({ object }) => !object.entityId || keep.has(object.entityId));

  const removed = new Set(patch.removed);
  for (const object of prev?.objects ?? []) {
    if (object.entityId && (clean.remove.includes(object.entityId) || !keep.has(object.entityId))) {
      removed.add(object.id);
    }
  }
  // Do not report a remove for something we also kept as an add of the same id.
  const keptObjectIds = new Set([...added, ...moved.map((m) => m.object), ...updated.map((u) => u.object)].map((o) => o.id));
  for (const id of keptObjectIds) removed.delete(id);

  const entityOfNext = new Map<string, string>();
  for (const object of added) if (object.entityId) entityOfNext.set(object.id, object.entityId);
  for (const { object } of moved) if (object.entityId) entityOfNext.set(object.id, object.entityId);
  for (const { object } of updated) if (object.entityId) entityOfNext.set(object.id, object.entityId);

  const pairAllowed = (fromId: string, toId: string, fromEntity?: string, toEntity?: string) => {
    const from = fromEntity ?? entityOfNext.get(fromId) ?? entityOf(fromId);
    const to = toEntity ?? entityOfNext.get(toId) ?? entityOf(toId);
    if (!from || !to) return false;
    return allowed.has(pairKey(from, to));
  };

  const connectorsAdded = patch.connectorsAdded.filter((c) => pairAllowed(c.fromObjectId, c.toObjectId));
  const connectorsRerouted = patch.connectorsRerouted.filter((c) => pairAllowed(c.fromObjectId, c.toObjectId));

  const connectorsRemoved = new Set(patch.connectorsRemoved);
  for (const connector of prev?.connectors ?? []) {
    const from = entityOf(connector.fromObjectId);
    const to = entityOf(connector.toObjectId);
    if (!from || !to || !allowed.has(pairKey(from, to)) || !keep.has(from) || !keep.has(to)) {
      connectorsRemoved.add(connector.id);
    }
  }
  for (const connector of connectorsAdded) connectorsRemoved.delete(connector.id);
  for (const connector of connectorsRerouted) connectorsRemoved.delete(connector.id);

  return {
    added,
    moved,
    updated,
    removed: [...removed],
    connectorsAdded,
    connectorsRemoved: [...connectorsRemoved],
    connectorsRerouted,
  };
}
