/**
 * Schemas for the math domain layer. These are the only zod schemas in the
 * codebase (see docs/math-reasoning-schema.md for why) — scoped deliberately
 * to the math and audio systems, which the brief explicitly asks to be
 * schema-validated, rather than retrofitted onto the existing hand-rolled
 * parsers that already work for Standard/Story mode.
 */

import { z } from "zod";

export const MATH_DOMAINS = ["linear_equation", "fraction", "coordinate_graph", "word_problem"] as const;
export type MathDomain = (typeof MATH_DOMAINS)[number];

export const LINEAR_OPERATIONS = ["add", "subtract", "multiply", "divide"] as const;
export const FRACTION_OPERATIONS = ["add", "subtract", "multiply", "divide", "simplify"] as const;
export const MATH_OPERATIONS = [...new Set([...LINEAR_OPERATIONS, ...FRACTION_OPERATIONS])] as const;

export const MathSymbolSchema = z.object({
  symbol: z.string().min(1),
  meaning: z.string().min(1),
});
export type MathSymbol = z.infer<typeof MathSymbolSchema>;

export const MathReasoningStepSchema = z.object({
  stepId: z.string().min(1),
  operation: z.string().min(1),
  value: z.union([z.string(), z.number()]).optional(),
  from: z.string().default("both sides"),
  reason: z.string().min(1),
  /** The state before this step, needed to verify it independent of history order. */
  before: z.string().min(1),
  result: z.string().min(1),
  verified: z.boolean().default(false),
  verificationDetail: z.string().optional(),
  /** What a learner would get wrong here, per the brief's "common mistake" field. */
  commonMistake: z.string().optional(),
  connection: z.string().optional(),
});
export type MathReasoningStep = z.infer<typeof MathReasoningStepSchema>;

export const MathExplanationSchema = z.object({
  meaning: z.string().min(1),
  invariant: z.string().min(1),
});

export const MathReasoningStateSchema = z.object({
  topic: z.string().min(1),
  domain: z.enum(MATH_DOMAINS),
  goal: z.string().min(1),
  symbols: z.array(MathSymbolSchema).default([]),
  currentExpression: z.string().min(1),
  steps: z.array(MathReasoningStepSchema).default([]),
  explanation: MathExplanationSchema,
});
export type MathReasoningState = z.infer<typeof MathReasoningStateSchema>;

// --- deterministic visuals --------------------------------------------------
//
// The model may choose WHICH of these to draw; it must never emit pixel
// coordinates. Every field here is a symbolic/numeric value the renderer in
// lib/math/visuals.ts turns into exact geometry.

const PointSchema = z.object({ x: z.number(), y: z.number() });

export const NumberLineSpecSchema = z.object({
  type: z.literal("number_line"),
  min: z.number(),
  max: z.number(),
  points: z.array(z.number()).default([]),
  label: z.string().optional(),
});

export const BalanceModelSpecSchema = z.object({
  type: z.literal("balance_model"),
  leftGroups: z.number().int().min(0),
  leftUnits: z.number().int(),
  rightUnits: z.number().int(),
  variableLabel: z.string().default("x"),
});

export const FractionBarSpecSchema = z.object({
  type: z.literal("fraction_bar"),
  numerator: z.number().int().min(0),
  denominator: z.number().int().min(1),
  /** A second fraction, for showing an operation between two bars. */
  secondNumerator: z.number().int().min(0).optional(),
  secondDenominator: z.number().int().min(1).optional(),
  label: z.string().optional(),
});

export const CountersSpecSchema = z.object({
  type: z.literal("counters"),
  groups: z.number().int().min(1),
  perGroup: z.number().int().min(1),
  label: z.string().optional(),
});

export const CoordinateAxesSpecSchema = z.object({
  type: z.literal("coordinate_axes"),
  xMin: z.number().default(-10),
  xMax: z.number().default(10),
  yMin: z.number().default(-10),
  yMax: z.number().default(10),
  points: z.array(PointSchema).default([]),
  line: z.object({ slope: z.number(), intercept: z.number() }).optional(),
  label: z.string().optional(),
});

export const MathTableSpecSchema = z.object({
  type: z.literal("table"),
  headers: z.array(z.string()).min(1),
  rows: z.array(z.array(z.string())),
});

/**
 * Structural representation of the standard long-multiplication algorithm —
 * added so carries and partial products can be laid out deterministically
 * (aligned by column, measured by the renderer) instead of the model trying
 * to fake column alignment with literal space padding inside a free-text
 * label. Excalifont is proportional, so space-padding never actually lines
 * up; verified against real model output during the audio-replay audit
 * ("39 × 8\n        2  (carry 7)" renders as "39 × 8 2 (carry 7)" with no
 * alignment at all once wrapped). The model supplies the numbers and their
 * place values; lib/math/visuals.ts's longMultiplicationSkeleton computes
 * every coordinate.
 */
export const LongMultiplicationCarrySchema = z.object({
  /** Usually a single digit, but not assumed — "7" or "12". */
  value: z.string().min(1),
  /** Place-value column this carry sits above, 0 = ones, increasing leftward. */
  column: z.number().int().min(0),
});

export const LongMultiplicationPartialProductSchema = z.object({
  value: z.string().min(1),
  /** How many columns in from the right this value's rightmost digit is anchored — the standard algorithm's per-row leftward shift. */
  shift: z.number().int().min(0),
  explanation: z.string().optional(),
});

export const LongMultiplicationSpecSchema = z.object({
  type: z.literal("long_multiplication"),
  multiplicand: z.string().min(1),
  multiplier: z.string().min(1),
  carries: z.array(LongMultiplicationCarrySchema).default([]),
  partialProducts: z.array(LongMultiplicationPartialProductSchema).default([]),
  result: z.string().min(1),
});
export type LongMultiplicationSpec = z.infer<typeof LongMultiplicationSpecSchema>;

export const MathVisualSpecSchema = z.discriminatedUnion("type", [
  NumberLineSpecSchema,
  BalanceModelSpecSchema,
  FractionBarSpecSchema,
  CountersSpecSchema,
  CoordinateAxesSpecSchema,
  MathTableSpecSchema,
  LongMultiplicationSpecSchema,
]);
export type MathVisualSpec = z.infer<typeof MathVisualSpecSchema>;

/** What the /api/math route returns for one incremental step. */
export const MathStepResponseSchema = z.object({
  step: MathReasoningStepSchema,
  visual: MathVisualSpecSchema.optional(),
  topic: z.string().optional(),
  domain: z.enum(MATH_DOMAINS).optional(),
  goal: z.string().optional(),
  symbols: z.array(MathSymbolSchema).optional(),
});
export type MathStepResponse = z.infer<typeof MathStepResponseSchema>;

export const MathDepthSchema = z.enum(["default", "deep"]);
export type MathDepth = z.infer<typeof MathDepthSchema>;
