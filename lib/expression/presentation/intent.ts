/**
 * A caller's request for how existing semantic truth should be expressed.
 *
 * This is deliberately separate from both MeaningDelta/WorldState (truth)
 * and PresentationPlan (the engine's concrete, deterministic presentation
 * decision). It contains no geometry and cannot create semantic facts.
 */
import { z } from "zod";
import { IdSchema, type GrammarId, type WorldState } from "../schemas";

export const PresentationFormSchema = z.enum([
  "existing",
  "process",
  "comparison",
  "spatial",
  "magnitude",
  "causal",
  "tension",
]);
export type PresentationForm = z.infer<typeof PresentationFormSchema>;

export const PresentationSpatialArrangementSchema = z.enum([
  "separated",
  "clustered",
  "centralized",
  "surrounding",
]);
export type PresentationSpatialArrangement = z.infer<typeof PresentationSpatialArrangementSchema>;

export const PresentationIntentSchema = z
  .object({
    form: PresentationFormSchema.optional(),
    scope: z
      .object({ entityIds: z.array(IdSchema).min(1).max(12) })
      .strict()
      .optional(),
    emphasis: z
      .object({ primaryEntityIds: z.array(IdSchema).max(3).optional() })
      .strict()
      .optional(),
    spatial: z
      .object({ arrangement: PresentationSpatialArrangementSchema.optional() })
      .strict()
      .optional(),
  })
  .strict();
export type PresentationIntent = z.infer<typeof PresentationIntentSchema>;

/** A read-only expression view; the underlying WorldState is never sliced or mutated. */
export function worldForPresentation(world: WorldState, request: PresentationIntent | undefined): WorldState {
  const requested = request?.scope?.entityIds;
  if (!requested?.length) return world;
  const ids = new Set(requested.filter((id) => world.entities.some((entity) => entity.id === id)));
  if (!ids.size) return world;
  return {
    ...world,
    entities: world.entities.filter((entity) => ids.has(entity.id)),
    relations: world.relations.filter((relation) => ids.has(relation.source) && ids.has(relation.target)),
    claims: world.claims.filter((claim) => !claim.about?.length || claim.about.some((id) => ids.has(id))),
    salience: world.salience.filter((id) => ids.has(id)),
  };
}

/**
 * Presentation requests are preferences, never permission to invent the
 * relation or quantity a grammar requires. Every returned chain therefore
 * ends in the honest relationship fallback.
 */
export function grammarChainForPresentation(
  world: WorldState,
  request: PresentationIntent | undefined,
  semanticChain: GrammarId[],
): GrammarId[] {
  const form = request?.form ?? "existing";
  if (form === "existing") return semanticChain;

  const has = (type: string) => world.relations.some((relation) => relation.type === type);
  const hasCausal = world.relations.some((relation) =>
    relation.type === "causes" || relation.type === "enables" || relation.type === "depends_on" || relation.type === "prevents",
  );
  const hasComparative = world.relations.some((relation) =>
    relation.type === "contrasts_with" || relation.type === "greater_than" || relation.type === "less_than",
  );
  const quantified = world.entities.filter((entity) => entity.quantity).length;

  switch (form) {
    case "process":
      return has("transforms_into") ? ["process", "relationship"] : has("precedes") ? ["sequence", "relationship"] : ["relationship"];
    case "comparison":
      return hasComparative || quantified >= 2 ? ["comparison", "relationship"] : ["relationship"];
    case "magnitude":
      return quantified > 0 ? ["quantity", "relationship"] : ["relationship"];
    case "causal":
      return hasCausal ? ["cause_effect", "relationship"] : ["relationship"];
    case "tension":
      return hasComparative ? ["comparison", "relationship"] : ["relationship"];
    case "spatial":
      // A presentation-level arrangement does not imply semantic location.
      return has("located_at") ? ["spatial", "relationship"] : ["relationship"];
    default:
      return semanticChain;
  }
}
