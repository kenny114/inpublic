/**
 * Expression repair: turn an evaluation's problems into the smallest change
 * that fixes them.
 *
 * The rule that shapes this whole module: repair adjusts, it does not
 * regenerate. Recomposing from a different grammar throws away every
 * position the viewer has already learned, so it is the last resort and is
 * flagged explicitly (`recomposeRequired`) rather than being the default.
 * Everything else — labelling a connector, strengthening one into an arrow,
 * dropping a detail region, promoting an emphasis — is a local edit to the
 * ExpressionPlan that leaves the rest of the picture where it was.
 *
 * Repairs are also diagnosed at the layer that can actually fix them. A
 * missing causal relation is a CONNECTOR problem when the plan drew it as a
 * weak link, and a GRAMMAR problem only when the plan drew it as a flow and
 * it still could not be read — at which point no amount of restyling one
 * edge will help and the spatial logic itself is wrong.
 */

import {
  EMPTY_REPAIR_PLAN,
  type Connection,
  type EvaluationResult,
  type ExpressionPlan,
  type Problem,
  type Region,
  type RepairPlan,
  type RepairStep,
  type WorldState,
} from "../schemas";

function connectionForRelation(plan: ExpressionPlan, relationId?: string): Connection | undefined {
  return relationId ? plan.connections.find((c) => c.relationId === relationId) : undefined;
}

function diagnose(problem: Problem, plan: ExpressionPlan, world: WorldState): RepairStep | null {
  switch (problem.type) {
    case "missing_relation": {
      const connection = connectionForRelation(plan, problem.relationId);
      if (!connection) {
        return {
          action: "expose_relation",
          targetId: problem.relationId,
          reason: "the relation is between two drawn things but the plan never connected them",
        };
      }
      if (connection.kind !== "flow") {
        return {
          action: "strengthen_connector",
          targetId: connection.id,
          reason: "drawn as an undirected link, but the relation carries direction",
        };
      }
      return {
        action: "change_grammar",
        grammar: "relationship",
        reason: "already drawn as a flow and still unreadable — the spatial logic is wrong for this meaning",
      };
    }

    case "ambiguous_relation": {
      const connection = connectionForRelation(plan, problem.relationId);
      if (!connection) return null;
      return {
        action: "label_connector",
        targetId: connection.id,
        reason: "a named role cannot be inferred from position; it has to be written",
      };
    }

    case "false_relation":
      // Something looks enclosed that isn't. Enclosure is a property of the
      // grammar, so this is one of the few genuine recompose cases.
      return {
        action: "change_grammar",
        grammar: "relationship",
        reason: "the layout implies containment nobody claimed",
      };

    case "overlap":
      return { action: "separate_overlap", reason: "two marks read as one" };

    case "clutter":
      return { action: "drop_detail", reason: "too much on the canvas to read at a glance" };

    case "no_focus":
      return {
        action: plan.emphasis.length ? "promote_emphasis" : "establish_focus",
        targetId: plan.focusEntityId,
        reason: "the eye needs one place to land first",
      };

    case "unexpressed_quantity":
      return {
        action: "express_quantity",
        targetId: problem.entityIds?.[0],
        reason: "a stated number is drawn as a box instead of as extent",
      };

    case "missing_entity":
      return {
        action: "expose_relation",
        targetId: problem.entityIds?.[0],
        reason: "the primary subject is missing from its own picture",
      };

    default:
      return null;
  }
}

export function planRepair(evaluation: EvaluationResult, plan: ExpressionPlan, world: WorldState): RepairPlan {
  if (!evaluation.repairRequired) return EMPTY_REPAIR_PLAN;

  const steps: RepairStep[] = [];
  const seen = new Set<string>();
  for (const problem of evaluation.problems) {
    const step = diagnose(problem, plan, world);
    if (!step) continue;
    const key = `${step.action}:${step.targetId ?? step.grammar ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    steps.push(step);
    if (steps.length >= 8) break;
  }

  // One grammar change is a recompose; a second one in the same round would
  // be thrashing, so only the first is kept.
  const grammarSteps = steps.filter((s) => s.action === "change_grammar");
  const trimmed = steps.filter((s) => s.action !== "change_grammar" || s === grammarSteps[0]);

  return { steps: trimmed, recomposeRequired: grammarSteps.length > 0 };
}

/**
 * Applies the local (non-recompose) steps to the plan and returns the
 * adjusted plan plus, if a grammar change was ordered, the grammar to
 * recompose with. The caller decides whether to accept the result — see
 * lib/expression/pipeline.ts, which keeps a repair only when it actually
 * scored better, so a repair can never make a picture worse.
 */
export function applyRepair(
  plan: ExpressionPlan,
  repair: RepairPlan,
  world: WorldState,
): { plan: ExpressionPlan; grammarOverride?: ExpressionPlan["grammar"] } {
  let regions: Region[] = [...plan.regions];
  let connections: Connection[] = [...plan.connections];
  let emphasis = [...plan.emphasis];
  let grammarOverride: ExpressionPlan["grammar"] | undefined;

  for (const step of repair.steps) {
    switch (step.action) {
      case "strengthen_connector":
        connections = connections.map((c) => (c.id === step.targetId ? { ...c, kind: "flow" } : c));
        break;

      case "label_connector":
        connections = connections.map((c) => {
          if (c.id !== step.targetId) return c;
          const relation = world.relations.find((r) => r.id === c.relationId);
          const label = relation?.role ?? relation?.type.replace(/_/g, " ");
          return label ? { ...c, label: label.slice(0, 32) } : c;
        });
        break;

      case "expose_relation": {
        const relation = world.relations.find((r) => r.id === step.targetId);
        if (!relation) break;
        const from = regions.find((r) => r.entityId === relation.source);
        const to = regions.find((r) => r.entityId === relation.target);
        if (!from || !to || connections.some((c) => c.relationId === relation.id)) break;
        connections.push({
          id: `c-${relation.id}`.slice(0, 48),
          fromRegionId: from.id,
          toRegionId: to.id,
          relationId: relation.id,
          kind: "flow",
        });
        break;
      }

      case "drop_detail": {
        // Drop the least important context first, and every connection that
        // hung off it — never a chain step, which would break the story.
        const droppable = regions
          .filter((r) => r.role === "context" || r.role === "annotation")
          .sort((a, b) => (b.order ?? 0) - (a.order ?? 0));
        const drop = droppable[0];
        if (!drop) break;
        regions = regions.filter((r) => r.id !== drop.id);
        connections = connections.filter((c) => c.fromRegionId !== drop.id && c.toRegionId !== drop.id);
        emphasis = emphasis.filter((e) => e.regionId !== drop.id);
        break;
      }

      case "promote_emphasis":
      case "establish_focus": {
        const target =
          regions.find((r) => r.entityId === plan.focusEntityId) ??
          regions.find((r) => r.role === "primary_subject" || r.role === "hierarchy_root") ??
          regions[0];
        if (!target) break;
        emphasis = [
          { regionId: target.id, weight: 3, reason: "repair: the picture had no entry point" },
          ...emphasis.filter((e) => e.regionId !== target.id).map((e) => ({ ...e, weight: Math.min(e.weight, 1) })),
        ].slice(0, 3);
        break;
      }

      case "change_grammar":
        grammarOverride = step.grammar;
        break;

      // separate_overlap and express_quantity are handled below the plan
      // layer — the composer already separates on every pass, and the
      // primitive resolver already draws counts as extent. Reaching them
      // here means the world lacked the information (no quantity, or two
      // regions that genuinely cannot fit), and inventing it in a repair
      // would be worse than the problem.
      case "separate_overlap":
      case "express_quantity":
      default:
        break;
    }
  }

  return { plan: { ...plan, regions, connections, emphasis }, grammarOverride };
}
