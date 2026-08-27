/**
 * Experimental communication-decision vocabulary. See
 * planning/specs/VISUAL-EXPRESSION-INTENT-V1.md for the contract this
 * implements.
 *
 * This layer sits ABOVE VisualAgent, not beside it: `lib/communicator/` may
 * depend on `lib/agent`, `lib/visual-actions`, and `lib/expression`, but
 * nothing below it may depend on `lib/communicator`. It answers a different
 * question than Agent does — Agent answers "what mutation should occur?";
 * this answers "should I say this, show this, or both, and in what visual
 * form?" — and it always resolves down to the same existing `VisualAction`
 * vocabulary. It never invents a second mutation path.
 */

import { z } from "zod";
import { IdSchema, MeaningDeltaSchema, WorldStateSchema, ScenePlanSchema } from "../expression/schemas";
import {
  PresentationFormSchema,
  PresentationIntentSchema,
} from "../expression/presentation/intent";
import type { CanvasObservation } from "../canvas";
import { AgentCanvasViewSchema, AgentWorldViewSchema } from "../agent";

/**
 * Six forms, per the brief, plus the explicit non-choice. `existing` means
 * "whatever grammar the world's own structure already deserves" — it is not
 * a form so much as a way to say "don't force one," and it is what a
 * `visualize` decision should choose when the content itself, not a
 * deliberate metaphor, should decide the picture.
 */
export const VisualFormSchema = PresentationFormSchema;
export type VisualForm = z.infer<typeof VisualFormSchema>;

/**
 * What the communicator is trying to make the human SEE — never geometry.
 * `goal` is a short plain-English description of the idea to make visible,
 * handed to the deterministic shaping step (`lib/communicator/shape.ts`),
 * which is the only thing that ever turns it into WorldState content. This
 * type carries no x/y, no element ids, no Excalidraw vocabulary at all.
 */
export const VisualCommunicationIntentSchema = PresentationIntentSchema.extend({
  /** Meaning needed — "model costs are growing faster than revenue," not "draw two bars." */
  goal: z.string().min(1).max(240),
  form: PresentationFormSchema,
}).strict();
export type VisualCommunicationIntent = z.infer<typeof VisualCommunicationIntentSchema>;

const SemanticIdentitySchema = IdSchema;

export const CommunicationDecisionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("speak"), message: z.string().min(1).max(600) }).strict(),
  z.object({ type: z.literal("visualize"), intent: VisualCommunicationIntentSchema }).strict(),
  z
    .object({
      type: z.literal("speak_and_visualize"),
      message: z.string().min(1).max(600),
      intent: VisualCommunicationIntentSchema,
    })
    .strict(),
  z.object({ type: z.literal("recompose"), intent: VisualCommunicationIntentSchema }).strict(),
  z.object({ type: z.literal("emphasize"), target: SemanticIdentitySchema }).strict(),
  z.object({ type: z.literal("done") }).strict(),
]);
export type CommunicationDecision = z.infer<typeof CommunicationDecisionSchema>;

export const CommunicationOutcomeSchema = z
  .object({
    status: z.enum(["applied", "noop", "rejected", "spoken"]),
    reason: z.string().max(240),
  })
  .strict();
export type CommunicationOutcome = z.infer<typeof CommunicationOutcomeSchema>;

export const CommunicationStageSchema = z.enum(["establish", "develop", "transform", "conclude"]);
export type CommunicationStage = z.infer<typeof CommunicationStageSchema>;

export const CommunicationStateSchema = z
  .object({
    stage: CommunicationStageSchema,
    visualEstablished: z.boolean(),
    currentForm: PresentationFormSchema.optional(),
    activeEntityIds: z.array(IdSchema).max(64),
    deliveredMessages: z.array(z.string().max(600)).max(32),
    visualRevision: z.number().int().nonnegative(),
    semanticRevision: z.number().int().nonnegative(),
    lastDecision: CommunicationDecisionSchema.optional(),
    lastOutcome: CommunicationOutcomeSchema.optional(),
  })
  .strict();
export type CommunicationState = z.infer<typeof CommunicationStateSchema>;

export const SemanticDeltaSummarySchema = z
  .object({
    addedEntityIds: z.array(IdSchema).max(64),
    updatedEntityIds: z.array(IdSchema).max(64),
    removedEntityIds: z.array(IdSchema).max(64),
    addedRelationIds: z.array(IdSchema).max(128),
    updatedRelationIds: z.array(IdSchema).max(128),
    removedRelationIds: z.array(IdSchema).max(128),
    addedClaimIds: z.array(IdSchema).max(48),
    updatedClaimIds: z.array(IdSchema).max(48),
    removedClaimIds: z.array(IdSchema).max(48),
    changed: z.boolean(),
  })
  .strict();
export type SemanticDeltaSummary = z.infer<typeof SemanticDeltaSummarySchema>;

export const VisualDeltaSummarySchema = z
  .object({
    addedEntityIds: z.array(IdSchema).max(64),
    removedEntityIds: z.array(IdSchema).max(64),
    presentationChange: z
      .object({ from: PresentationFormSchema.optional(), to: PresentationFormSchema })
      .strict()
      .optional(),
    focusTarget: IdSchema.optional(),
    canvasChanged: z.boolean(),
    noCanvasChange: z.boolean(),
  })
  .strict();
export type VisualDeltaSummary = z.infer<typeof VisualDeltaSummarySchema>;

export const TransformationCandidateSchema = z
  .object({
    currentForm: PresentationFormSchema.optional(),
    compatibleForms: z.array(PresentationFormSchema).min(1).max(4),
    reason: z.string().min(1).max(160),
  })
  .strict();
export type TransformationCandidate = z.infer<typeof TransformationCandidateSchema>;

/** One prior turn, compact — enough for the model to avoid repeating a visual it already tried. */
export const CommunicationHistoryEntrySchema = z
  .object({
    decision: CommunicationDecisionSchema,
    outcome: z.enum(["applied", "noop", "rejected", "spoken"]),
    reason: z.string().max(240),
  })
  .strict();
export type CommunicationHistoryEntry = z.infer<typeof CommunicationHistoryEntrySchema>;

export const CommunicationContextSchema = z
  .object({
    userMessage: z.string().min(1).max(2000),
    /** What the communicator is ultimately trying to get across, distinct from the literal message. */
    communicationGoal: z.string().min(1).max(400),
    world: AgentWorldViewSchema,
    canvas: AgentCanvasViewSchema,
    history: z.array(CommunicationHistoryEntrySchema).max(8),
    state: CommunicationStateSchema,
    semanticDelta: SemanticDeltaSummarySchema,
    visualDelta: VisualDeltaSummarySchema,
    transformationCandidate: TransformationCandidateSchema.optional(),
    feedback: z
      .enum([
        "This message has already been delivered.",
        "No existing visual expression is available to recompose. Establish the visual world first.",
        "Speech did not establish a visual expression. The visual world is still empty.",
        "Recomposition changed presentation only. It did not add the current message to semantic memory.",
      ])
      .optional(),
    step: z.number().int().positive(),
    remainingSteps: z.number().int().min(0).max(8),
  })
  .strict();
export type CommunicationContext = z.infer<typeof CommunicationContextSchema>;

export type CommunicationDecisionProvider = (context: CommunicationContext) => Promise<unknown>;

export interface CommunicationStepTrace {
  step: number;
  state: CommunicationState;
  semanticDelta: SemanticDeltaSummary;
  visualDelta: VisualDeltaSummary;
  transformationCandidate?: TransformationCandidate;
  decision: CommunicationDecision | { type: "invalid_decision" | "provider_error"; reason: string };
  outcome?: { status: "applied" | "noop" | "rejected" | "spoken"; reason: string };
  sceneRevisionBefore?: string;
  sceneRevisionAfter?: string;
  chosenGrammar?: string;
  visualCommunicationIntent?: VisualCommunicationIntent;
  presentationIntent?: import("../expression/presentation/intent").PresentationIntent;
  meaningDelta?: z.infer<typeof MeaningDeltaSchema>;
  worldBefore?: z.infer<typeof WorldStateSchema>;
  worldAfter?: z.infer<typeof WorldStateSchema>;
  scenePlan?: z.infer<typeof ScenePlanSchema>;
  canvasObservation?: CanvasObservation;
  semanticPreservation?: number;
  inventedRelationIds?: string[];
}

export interface CommunicationRunTrace {
  userMessage: string;
  communicationGoal: string;
  budget: number;
  shapingCalls: number;
  decisionCalls: number;
  initialState: CommunicationState;
  finalState: CommunicationState;
  steps: CommunicationStepTrace[];
}

type CommunicationRunResultBase = { state: CommunicationState; trace: CommunicationRunTrace };
export type CommunicationRunResult =
  | (CommunicationRunResultBase & { status: "completed" })
  | (CommunicationRunResultBase & { status: "blocked"; reason: string })
  | (CommunicationRunResultBase & { status: "step_limit" })
  | (CommunicationRunResultBase & { status: "stalled"; reason: string });
