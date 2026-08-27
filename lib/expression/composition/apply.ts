/**
 * Enforce a CompositionPlan on the expression plan and the composed scene.
 *
 * Clean already gates occupancy. This module is the story gate: the spine
 * becomes the path the layout must follow, attachments become context, and
 * anything outside `allowed` cannot remain a region, a box, or a line.
 * Grammars whose spatial logic is not a path (comparison, hierarchy, space,
 * quantity) keep their structure; membership and demotion still apply.
 */

import {
  ExpressionPlanSchema,
  relationFamily,
  type CompositionEdge,
  type CompositionPlan,
  type Connection,
  type ExpressionPlan,
  type GrammarId,
  type Region,
  type ScenePlan,
  type WorldRelation,
  type WorldState,
} from "../schemas";

const FLOW_LAYOUTS = new Set<GrammarId>(["cause_effect", "sequence", "process"]);
const KEEP_STRUCTURE = new Set<GrammarId>(["comparison", "quantity", "hierarchy", "grouping", "spatial"]);

const regionIdFor = (entityId: string) => `r-${entityId}`.slice(0, 48);

function pairKey(from: string, to: string): string {
  return `${from}|${to}`;
}

function spineNodes(spine: CompositionEdge[]): string[] {
  const ids: string[] = [];
  for (const edge of spine) {
    if (!ids.includes(edge.from)) ids.push(edge.from);
    if (!ids.includes(edge.to)) ids.push(edge.to);
  }
  return ids;
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

function flowGrammarFor(spine: CompositionEdge[], world: WorldState): GrammarId {
  const types = spine
    .map((edge) => findRelation(world, edge.from, edge.to)?.type)
    .filter((type): type is NonNullable<typeof type> => Boolean(type));
  if (types.length && types.every((t) => t === "precedes")) return "sequence";
  if (types.some((t) => t === "causes" || t === "enables" || t === "depends_on" || t === "prevents")) {
    return "cause_effect";
  }
  return "process";
}

function shouldDrawAsFlow(plan: ExpressionPlan, spine: CompositionEdge[]): boolean {
  if (spine.length < 1) return false;
  if (KEEP_STRUCTURE.has(plan.grammar)) return false;
  return true;
}

/**
 * Rewrite an expression plan so it realises the Composition Agent's story.
 * Spine entities become the path (chain_step, in order); everything demoted
 * becomes context; nothing outside `allowed` remains.
 */
export function applyCompositionToPlan(
  plan: ExpressionPlan,
  composition: CompositionPlan,
  world: WorldState,
  options: { preserveGrammar?: boolean } = {},
): ExpressionPlan {
  const allowed = new Set(composition.allowed);
  if (!allowed.size && !composition.primaryId) {
    return { ...plan, regions: [], connections: [], emphasis: [], focusEntityId: undefined, reason: composition.reason };
  }

  const demoted = new Set(composition.demote);
  const path = spineNodes(composition.spine);
  const pathSet = new Set(path);
  const byEntity = new Map<string, Region>();
  for (const region of plan.regions) {
    if (region.role === "annotation") continue;
    if (region.entityId && allowed.has(region.entityId) && !byEntity.has(region.entityId)) {
      byEntity.set(region.entityId, region);
    }
  }
  for (const id of composition.allowed) {
    if (byEntity.has(id)) continue;
    byEntity.set(id, {
      id: regionIdFor(id),
      role: id === composition.primaryId ? "primary_subject" : pathSet.has(id) ? "chain_step" : "context",
      entityId: id,
    });
  }

  const asFlow = shouldDrawAsFlow(plan, composition.spine);
  const ordered: Region[] = [];
  const seen = new Set<string>();
  const push = (id: string | undefined, role?: Region["role"], order?: number) => {
    if (!id || seen.has(id) || !allowed.has(id)) return;
    const region = byEntity.get(id);
    if (!region) return;
    seen.add(id);
    let next = region;
    if (role) next = { ...next, role, ...(order !== undefined ? { order } : {}) };
    else if (asFlow && demoted.has(id) && id !== composition.primaryId) next = { ...next, role: "context" };
    else if (id !== composition.primaryId && next.role === "primary_subject") {
      next = { ...next, role: "context" };
    }
    ordered.push(next);
  };

  if (asFlow) {
    path.forEach((id, index) => push(id, "chain_step", index));
    if (composition.primaryId && !pathSet.has(composition.primaryId)) {
      push(composition.primaryId, "primary_subject");
    }
    for (const region of plan.regions) push(region.entityId);
    for (const id of composition.allowed) push(id);
  } else {
    push(composition.primaryId);
    for (const region of plan.regions) push(region.entityId);
    for (const id of composition.allowed) push(id);
  }

  const annotations = plan.regions.filter((r) => {
    if (r.role !== "annotation") return false;
    return Boolean(r.entityId && allowed.has(r.entityId));
  });

  const keptRegionIds = new Set(ordered.map((r) => r.id));
  for (const region of annotations) keptRegionIds.add(region.id);
  const regions: Region[] = [
    ...ordered.map((r) => ({
      ...r,
      childRegionIds: r.childRegionIds?.filter((id) => keptRegionIds.has(id)),
    })),
    ...annotations,
  ];

  const regionIdOf = (entityId: string) => ordered.find((r) => r.entityId === entityId)?.id;
  const connections: Connection[] = [];
  const seenConn = new Set<string>();
  const add = (fromEntity: string, toEntity: string, rel: WorldRelation | undefined, existing?: Connection, forceFlow?: boolean) => {
    const fromId = regionIdOf(fromEntity) ?? existing?.fromRegionId;
    const toId = regionIdOf(toEntity) ?? existing?.toRegionId;
    if (!fromId || !toId || !keptRegionIds.has(fromId) || !keptRegionIds.has(toId)) return;
    const key = pairKey(fromId, toId);
    if (seenConn.has(key)) return;
    seenConn.add(key);
    if (existing && existing.fromRegionId === fromId && existing.toRegionId === toId && !forceFlow) {
      connections.push(existing);
      return;
    }
    if (!rel) return;
    const spineEdge = composition.spine.find((e) => e.from === fromEntity && e.to === toEntity);
    connections.push({
      id: existing?.id ?? `c-${rel.id}`.slice(0, 48),
      fromRegionId: fromId,
      toRegionId: toId,
      relationId: rel.id,
      kind: forceFlow || spineEdge ? "flow" : connectionKind(rel),
      ...(spineEdge?.label ? { label: spineEdge.label } : existing?.label ? { label: existing.label } : {}),
    });
  };

  const spineKeys = new Set(composition.spine.map((e) => pairKey(e.from, e.to)));
  for (const edge of composition.spine) {
    add(edge.from, edge.to, findRelation(world, edge.from, edge.to), undefined, asFlow);
  }
  for (const connection of plan.connections) {
    const from = plan.regions.find((r) => r.id === connection.fromRegionId)?.entityId;
    const to = plan.regions.find((r) => r.id === connection.toRegionId)?.entityId;
    if (!from || !to || !allowed.has(from) || !allowed.has(to)) continue;
    add(from, to, findRelation(world, from, to), connection, asFlow && spineKeys.has(pairKey(from, to)));
  }

  const primaryRegion = regions.find((r) => r.entityId === composition.primaryId);
  const emphasis = primaryRegion
    ? [{ regionId: primaryRegion.id, weight: 3 as const, reason: "the subject of the board" }]
    : [];

  const grammar = options.preserveGrammar ? plan.grammar : asFlow ? flowGrammarFor(composition.spine, world) : plan.grammar;
  const next: ExpressionPlan = {
    ...plan,
    grammar: FLOW_LAYOUTS.has(grammar) || !asFlow ? grammar : plan.grammar,
    focusEntityId: composition.primaryId ?? plan.focusEntityId,
    regions,
    connections,
    emphasis,
    reason: plan.reason,
  };
  const parsed = ExpressionPlanSchema.safeParse(next);
  return parsed.success ? parsed.data : { ...next, connections: [], emphasis };
}

/**
 * Drop anything the Composition Agent rejected that still made it onto the
 * scene, and shrink demoted nodes so they cannot compete with the spine.
 */
export function constrainCompositionScene(scene: ScenePlan, composition: CompositionPlan): ScenePlan {
  const allowed = new Set(composition.allowed);
  const demoted = new Set(composition.demote);
  const spine = new Set(spineNodes(composition.spine));
  const objects = scene.objects.filter((object) => {
    if (object.entityId) return allowed.has(object.entityId);
    return Boolean(object.parentObjectId && scene.objects.some((o) => o.id === object.parentObjectId && o.entityId && allowed.has(o.entityId)));
  });
  const objectIds = new Set(objects.map((o) => o.id));
  const entityOf = new Map(objects.filter((o) => o.entityId).map((o) => [o.id, o.entityId!]));
  const connectors = scene.connectors.filter((connector) => {
    if (!objectIds.has(connector.fromObjectId) || !objectIds.has(connector.toObjectId)) return false;
    const from = entityOf.get(connector.fromObjectId);
    const to = entityOf.get(connector.toObjectId);
    if (!from || !to) return false;
    if (!allowed.has(from) || !allowed.has(to)) return false;
    return true;
  });

  const weighted = objects.map((object) => {
    if (!object.entityId) return object;
    if (object.entityId === composition.primaryId) return object.weight === 3 ? object : { ...object, weight: 3 };
    if (demoted.has(object.entityId)) return object.weight === 0 ? object : { ...object, weight: 0 };
    if (spine.has(object.entityId) && object.weight >= 3) return { ...object, weight: 1 };
    if (object.weight >= 3 && object.entityId !== composition.primaryId) return { ...object, weight: 1 };
    return object;
  });

  return {
    ...scene,
    objects: weighted,
    connectors,
    focusObjectId: weighted.find((o) => o.entityId === composition.primaryId)?.id ?? scene.focusObjectId,
  };
}
