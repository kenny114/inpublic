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

export const FocusVisualActionSchema = z
  .object({ type: z.literal("focus"), entityId: IdSchema })
  .strict();

export const VisualActionSchema = z.discriminatedUnion("type", [
  ExpressVisualActionSchema,
  UpdateEntityVisualActionSchema,
  RemoveEntityVisualActionSchema,
  RelateEntitiesVisualActionSchema,
  RemoveRelationVisualActionSchema,
  FocusVisualActionSchema,
]);

export type FocusVisualAction = z.infer<typeof FocusVisualActionSchema>;
export type VisualAction = z.infer<typeof VisualActionSchema>;
export type VisualActionType = VisualAction["type"];
