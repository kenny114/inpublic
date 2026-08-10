/**
 * Math-domain actions, layered onto lib/actions.ts's CanvasAction union.
 *
 * Unlike the hand-rolled parser the rest of actions.ts uses, these are
 * zod-validated — the brief explicitly asks for schema-validated events for
 * the new systems, and a math step is exactly the kind of action where a
 * silently-coerced field (a malformed "value") would produce a wrong but
 * confident-looking verification result. Parsing still fails closed: an
 * invalid math action is dropped, never thrown, same rule as everything else
 * this file's sibling follows.
 */

import { z } from "zod";
import { MATH_DOMAINS, MathVisualSpecSchema } from "./types";

const StepInputSchema = z.object({
  operation: z.string().min(1),
  value: z.union([z.string(), z.number()]).optional(),
  from: z.string().default("both sides"),
  reason: z.string().min(1),
  before: z.string().min(1),
  result: z.string().min(1),
  commonMistake: z.string().optional(),
  connection: z.string().optional(),
});

export const MathActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_equation"),
    conceptId: z.string().min(1),
    expression: z.string().min(1),
    domain: z.enum(MATH_DOMAINS),
    topic: z.string().optional(),
    goal: z.string().optional(),
  }),
  z.object({
    type: z.literal("transform_equation"),
    conceptId: z.string().min(1),
    step: StepInputSchema,
  }),
  z.object({
    type: z.literal("add_math_explanation"),
    conceptId: z.string().min(1),
    meaning: z.string().min(1),
    invariant: z.string().min(1),
  }),
  z.object({
    type: z.literal("create_math_visual"),
    conceptId: z.string().min(1),
    visual: MathVisualSpecSchema,
  }),
  z.object({
    type: z.literal("verify_step"),
    conceptId: z.string().min(1),
    verified: z.boolean(),
    detail: z.string().optional(),
  }),
  z.object({
    type: z.literal("correct_math_step"),
    conceptId: z.string().min(1),
    correctedResult: z.string().min(1),
    reason: z.string().min(1),
  }),
]);

export type MathCanvasAction = z.infer<typeof MathActionSchema>;

const MATH_ACTION_TYPES = new Set<string>(MathActionSchema.options.map((o) => o.shape.type.value));

export function isMathActionType(type: string): boolean {
  return MATH_ACTION_TYPES.has(type);
}

/** One raw object -> one validated math action, or null. Never throws. */
export function parseMathAction(raw: unknown): MathCanvasAction | null {
  const result = MathActionSchema.safeParse(raw);
  return result.success ? result.data : null;
}
