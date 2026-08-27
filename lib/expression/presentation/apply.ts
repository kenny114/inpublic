/**
 * Enforce a PresentationPlan on Clean, the expression plan, and the scene.
 *
 * Presentation may only drop (simplifications) and rank (emphasis). It
 * never adds a node, a relation, or a second centre. Layout itself is
 * realised by the composer from `presentation.layout`.
 */

import {
  ExpressionPlanSchema,
  type CleanPlan,
  type CompositionPlan,
  type ExpressionPlan,
  type PresentationPlan,
  type PresentationWeight,
  type ScenePlan,
} from "../schemas";

const WEIGHT_FOR: Record<PresentationWeight, 0 | 1 | 3> = {
  heavy: 3,
  medium: 1,
  light: 0,
};

function spineIds(composition: CompositionPlan | null | undefined): Set<string> {
  const ids = new Set<string>();
  if (!composition) return ids;
  for (const edge of composition.spine) {
    ids.add(edge.from);
    ids.add(edge.to);
  }
  return ids;
}

/**
 * Take Presentation's clarity drops out of Clean's keep-set so occupancy
 * and the renderer agree. Never drops the primary.
 */
export function applyPresentationToClean(clean: CleanPlan, presentation: PresentationPlan): CleanPlan {
  const drop = new Set(presentation.simplifications.filter((id) => id !== clean.primaryId));
  if (!drop.size) return clean;
  const keep = clean.keep.filter((id) => !drop.has(id));
  const keepSet = new Set(keep);
  const remove = [...clean.remove];
  for (const id of drop) {
    if (!remove.includes(id)) remove.push(id);
  }
  return {
    ...clean,
    keep,
    demote: clean.demote.filter((id) => keepSet.has(id)),
    promote: clean.promote.filter((id) => keepSet.has(id)),
    remove: remove.slice(0, 48),
    allowedRelations: clean.allowedRelations.filter((r) => keepSet.has(r.from) && keepSet.has(r.to)),
    reason: clean.reason,
  };
}

/** Drop simplified entities from the expression plan. Grammar/roles stay. */
export function applyPresentationToPlan(plan: ExpressionPlan, presentation: PresentationPlan, primaryId?: string): ExpressionPlan {
  const drop = new Set(presentation.simplifications.filter((id) => id !== primaryId));
  if (!drop.size) return plan;
  const regions = plan.regions.filter((r) => !r.entityId || !drop.has(r.entityId));
  const kept = new Set(regions.map((r) => r.id));
  const next: ExpressionPlan = {
    ...plan,
    regions: regions.map((r) => ({
      ...r,
      childRegionIds: r.childRegionIds?.filter((id) => kept.has(id)),
    })),
    connections: plan.connections.filter((c) => kept.has(c.fromRegionId) && kept.has(c.toRegionId)),
    emphasis: plan.emphasis.filter((e) => kept.has(e.regionId)),
    focusEntityId: primaryId ?? plan.focusEntityId,
  };
  const parsed = ExpressionPlanSchema.safeParse(next);
  return parsed.success ? parsed.data : { ...next, connections: [], emphasis: [] };
}

/**
 * Last visual gate: membership from simplifications, and the three-tier
 * emphasis. Exactly one heavy node.
 */
export function constrainPresentationScene(
  scene: ScenePlan,
  presentation: PresentationPlan,
  opts: { primaryId?: string; composition?: CompositionPlan | null; demote?: string[] },
): ScenePlan {
  const drop = new Set(presentation.simplifications.filter((id) => id !== opts.primaryId));
  const demoted = new Set(opts.demote ?? []);
  const spine = spineIds(opts.composition ?? null);
  const objects = scene.objects.filter((object) => {
    if (!object.entityId) return true;
    return !drop.has(object.entityId);
  });
  const objectIds = new Set(objects.map((o) => o.id));
  const connectors = scene.connectors.filter(
    (c) => objectIds.has(c.fromObjectId) && objectIds.has(c.toObjectId),
  );

  const heavy = WEIGHT_FOR[presentation.emphasis.primary];
  const medium = WEIGHT_FOR[presentation.emphasis.support];
  const light = WEIGHT_FOR[presentation.emphasis.periphery];
  const spineLayout = presentation.layout === "vertical-spine" || presentation.layout === "left-to-right";

  const weighted = objects.map((object) => {
    if (!object.entityId) return object;
    if (object.entityId === opts.primaryId) {
      return object.weight === heavy ? object : { ...object, weight: heavy };
    }
    if (demoted.has(object.entityId)) {
      return object.weight === light ? object : { ...object, weight: light };
    }
    if (!spineLayout) return object;
    if (spine.size && !spine.has(object.entityId)) {
      return object.weight === light ? object : { ...object, weight: light };
    }
    return object.weight === medium ? object : { ...object, weight: medium };
  });

  const centres = weighted.filter((o) => o.weight >= 3);
  const centred =
    centres.length <= 1
      ? weighted
      : weighted.map((object) => {
          if (object.weight < 3) return object;
          if (object.entityId === opts.primaryId) return object;
          return { ...object, weight: medium };
        });

  return {
    ...scene,
    objects: centred,
    connectors,
    focusObjectId: centred.find((o) => o.entityId === opts.primaryId)?.id ?? scene.focusObjectId,
  };
}
