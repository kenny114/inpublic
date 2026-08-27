import { z } from "zod";
import {
  ConfidenceSchema,
  EntityStatusSchema,
  EntityTypeSchema,
  IdSchema,
  ImportanceSchema,
  QuantitySchema,
  RelationTypeSchema,
  SpatialRelationSchema,
} from "../expression/schemas";
import { VisualActionSchema, type VisualAction } from "../visual-actions";
import type { AgentPresenceState } from "../canvas";

const CompactText = z.string().max(240);

export const AgentWorldEntitySchema = z
  .object({
    id: IdSchema,
    type: EntityTypeSchema,
    label: z.string().min(1).max(60),
    status: EntityStatusSchema,
    importance: ImportanceSchema,
    description: z.string().max(160).optional(),
    quantity: QuantitySchema.optional(),
    attributes: z.array(z.object({ key: z.string().max(32), value: z.string().max(80) }).strict()).max(8).optional(),
    confidence: ConfidenceSchema.optional(),
    lastTouchedSeq: z.number().int().nonnegative(),
  })
  .strict();

export const AgentWorldRelationSchema = z
  .object({
    id: IdSchema,
    sourceEntityId: IdSchema,
    targetEntityId: IdSchema,
    type: RelationTypeSchema,
    role: z.string().max(32).optional(),
    spatial: SpatialRelationSchema.optional(),
    magnitude: z.number().finite().optional(),
    step: z.number().int().nonnegative().optional(),
    confidence: ConfidenceSchema.optional(),
    lastTouchedSeq: z.number().int().nonnegative(),
  })
  .strict();

export const AgentWorldClaimSchema = z
  .object({
    id: IdSchema,
    text: z.string().min(1).max(160),
    aboutEntityIds: z.array(IdSchema).max(5),
    uncertain: z.boolean().optional(),
    invalidated: z.boolean().optional(),
    confidence: ConfidenceSchema.optional(),
    importance: ImportanceSchema,
  })
  .strict();

export const AgentWorldViewSchema = z
  .object({
    topic: z.string().max(80).optional(),
    interpretation: z.string().max(240).optional(),
    entities: z.array(AgentWorldEntitySchema).max(64),
    relations: z.array(AgentWorldRelationSchema).max(128),
    claims: z.array(AgentWorldClaimSchema).max(48),
    salience: z.array(IdSchema).max(16),
    sequence: z.number().int().nonnegative(),
  })
  .strict();

export const AgentCanvasElementSchema = z
  .object({
    id: z.string().min(1).max(160),
    type: z.string().min(1).max(48),
    bounds: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().finite().nonnegative(),
        height: z.number().finite().nonnegative(),
      })
      .strict(),
    angle: z.number().finite(),
    text: z.string().max(160).optional(),
    selected: z.boolean(),
    groupIds: z.array(z.string().max(160)).max(16),
    frameId: z.string().max(160).nullable(),
    containerId: z.string().max(160).nullable(),
    order: z.number().int().nonnegative(),
    semanticEntityId: IdSchema.optional(),
  })
  .strict();

export const AgentCanvasViewSchema = z
  .object({
    revisions: z.object({ scene: z.string(), selection: z.string(), viewport: z.string() }).strict(),
    elements: z.array(AgentCanvasElementSchema).max(160),
    selection: z
      .object({ elementIds: z.array(z.string().max(160)).max(160), groupIds: z.array(z.string().max(160)).max(160) })
      .strict(),
    viewport: z
      .object({
        scrollX: z.number().finite(),
        scrollY: z.number().finite(),
        zoom: z.number().finite(),
        width: z.number().finite().nonnegative(),
        height: z.number().finite().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const AgentActionFeedbackSchema = z
  .object({
    status: z.enum(["applied", "noop", "rejected"]),
    actionType: z.string().max(48),
    category: z.enum(["semantic", "presentation", "validation"]),
    reason: CompactText,
    code: z.string().max(80).optional(),
    changed: z
      .object({
        world: z.boolean(),
        expressionScene: z.boolean(),
        canvasScene: z.boolean(),
        selection: z.boolean(),
        viewport: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const AgentContextSchema = z
  .object({
    instruction: z.string().min(1).max(2000),
    world: AgentWorldViewSchema,
    canvas: AgentCanvasViewSchema,
    previousAction: VisualActionSchema.optional(),
    previousResult: AgentActionFeedbackSchema.optional(),
    step: z.number().int().min(1).max(9),
    remainingSteps: z.number().int().min(0).max(8),
  })
  .strict();

export const AgentDecisionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("act"), action: VisualActionSchema }).strict(),
  z.object({ type: z.literal("done") }).strict(),
  z.object({ type: z.literal("cannot_complete"), reason: z.string().min(1).max(240) }).strict(),
]);

export type AgentWorldView = z.infer<typeof AgentWorldViewSchema>;
export type AgentCanvasView = z.infer<typeof AgentCanvasViewSchema>;
export type AgentActionFeedback = z.infer<typeof AgentActionFeedbackSchema>;
export type AgentContext = z.infer<typeof AgentContextSchema>;
export type AgentDecision = z.infer<typeof AgentDecisionSchema>;

export type AgentDecisionProvider = (context: AgentContext) => Promise<unknown>;

export interface AgentRevisionSet {
  world: string;
  expressionScene: string;
  scene: string;
  selection: string;
  viewport: string;
}

export interface AgentDecisionFailure {
  type: "invalid_decision" | "provider_error";
  reason: string;
}

export interface AgentStepTrace {
  step: number;
  observed: AgentRevisionSet;
  decision: AgentDecision | AgentDecisionFailure;
  actionResult?: AgentActionFeedback;
  resulting?: AgentRevisionSet;
}

export interface AgentRunTrace {
  instruction: string;
  budget: number;
  steps: AgentStepTrace[];
  presence: AgentPresenceTraceEvent[];
}

export interface AgentPresenceTraceEvent {
  step: number;
  phase: "run_started" | "observation_ready" | "decision_started" | "action_started" | "action_completed" | "run_finished";
  state: AgentPresenceState;
  outcome?: AgentRunResult["status"];
}

export interface AgentFinalState {
  world: AgentWorldView;
  canvas: AgentCanvasView;
  revisions: AgentRevisionSet;
}

interface AgentRunResultBase {
  steps: number;
  trace: AgentRunTrace;
  final: AgentFinalState;
}

export type AgentRunResult =
  | (AgentRunResultBase & { status: "completed" })
  | (AgentRunResultBase & { status: "blocked"; reason: string })
  | (AgentRunResultBase & { status: "step_limit" })
  | (AgentRunResultBase & { status: "stalled"; reason: string });

export interface VisualAgentRunOptions {
  maxSteps?: number;
  decisionProvider?: AgentDecisionProvider;
}

export interface VisualAgent {
  run(instruction: string, options?: VisualAgentRunOptions): Promise<AgentRunResult>;
  isRunning(): boolean;
}

export interface PreviousAgentTurn {
  action?: VisualAction;
  result?: AgentActionFeedback;
}
