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
    progress: z
      .object({
        messagesSpoken: z.array(z.string().max(600)).max(8),
        previousDecision: CommunicationDecisionSchema.optional(),
        canvasChanged: z.boolean(),
        semanticStateChanged: z.boolean(),
        feedback: z.literal("This message has already been delivered.").optional(),
      })
      .strict(),
    step: z.number().int().positive(),
    remainingSteps: z.number().int().min(0).max(8),
  })
  .strict();
export type CommunicationContext = z.infer<typeof CommunicationContextSchema>;

export type CommunicationDecisionProvider = (context: CommunicationContext) => Promise<unknown>;

export interface CommunicationStepTrace {
  step: number;
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
  steps: CommunicationStepTrace[];
}

export type CommunicationRunResult =
  | { status: "completed"; trace: CommunicationRunTrace }
  | { status: "blocked"; reason: string; trace: CommunicationRunTrace }
  | { status: "step_limit"; trace: CommunicationRunTrace }
  | { status: "stalled"; reason: string; trace: CommunicationRunTrace };
