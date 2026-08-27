/**
 * Durable boundary for Expression's semantic memory.
 *
 * Expression owns this schema because only Expression knows what a valid
 * WorldState means. Session persistence stores the resulting plain data but
 * never interprets entities, relations, claims, or reference state.
 */

import { z } from "zod";
import { EMPTY_WORLD_STATE, WorldStateSchema, type WorldState } from "./schemas";

export const EXPRESSION_STATE_VERSION = 1 as const;

export const PersistedExpressionStateSchema = z
  .object({
    version: z.literal(EXPRESSION_STATE_VERSION),
    world: WorldStateSchema,
  })
  .strict();

export type PersistedExpressionState = z.infer<typeof PersistedExpressionStateSchema>;
export type WorldStateRestoreStatus = "restored" | "missing" | "unsupported_version" | "invalid";

export interface WorldStateRestoreResult {
  status: WorldStateRestoreStatus;
  world: WorldState;
}

/** Validate and clone the runtime world into the explicit versioned envelope. */
export function serializeWorldState(world: WorldState): PersistedExpressionState {
  return PersistedExpressionStateSchema.parse({
    version: EXPRESSION_STATE_VERSION,
    world,
  });
}

/**
 * Validate persisted input without allowing semantic corruption to prevent a
 * project from opening. Unsupported versions are distinguished from malformed
 * version 1 payloads so they are never silently interpreted as current.
 */
export function restoreWorldState(input: unknown): WorldStateRestoreResult {
  if (input === undefined || input === null) {
    return { status: "missing", world: EMPTY_WORLD_STATE };
  }

  if (
    typeof input === "object" &&
    input !== null &&
    "version" in input &&
    (input as { version?: unknown }).version !== EXPRESSION_STATE_VERSION
  ) {
    return { status: "unsupported_version", world: EMPTY_WORLD_STATE };
  }

  const parsed = PersistedExpressionStateSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", world: EMPTY_WORLD_STATE };
  return { status: "restored", world: parsed.data.world };
}
