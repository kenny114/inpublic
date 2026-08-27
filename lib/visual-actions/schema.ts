/** Public, geometry-free VisualAction contract. */

import { z } from "zod";
import {
  ExpressVisualActionSchema,
  RelateEntitiesVisualActionSchema,
  RemoveEntityVisualActionSchema,
  RemoveRelationVisualActionSchema,
  UpdateEntityVisualActionSchema,
} from "../expression/actions";
import { IdSchema } from "../expression/schemas";
import { PresentationIntentSchema } from "../expression/presentation/intent";

export const FocusVisualActionSchema = z
  .object({ type: z.literal("focus"), entityId: IdSchema })
  .strict();

/** Expression-only presentation action. It cannot mutate semantic state. */
export const RecomposeExpressionVisualActionSchema = z
  .object({ type: z.literal("recompose_expression"), presentation: PresentationIntentSchema })
  .strict();

export const VisualActionSchema = z.discriminatedUnion("type", [
  ExpressVisualActionSchema,
  UpdateEntityVisualActionSchema,
  RemoveEntityVisualActionSchema,
  RelateEntitiesVisualActionSchema,
  RemoveRelationVisualActionSchema,
  FocusVisualActionSchema,
  RecomposeExpressionVisualActionSchema,
]);

export type FocusVisualAction = z.infer<typeof FocusVisualActionSchema>;
export type RecomposeExpressionVisualAction = z.infer<typeof RecomposeExpressionVisualActionSchema>;
export type VisualAction = z.infer<typeof VisualActionSchema>;
export type VisualActionType = VisualAction["type"];
