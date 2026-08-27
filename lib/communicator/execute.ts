/**
 * Turns one validated `CommunicationDecision` into real state, entirely
 * through the EXISTING `VisualActionDispatcher` — this module never touches
 * Canvas, Excalidraw, or WorldState directly. `speak` is the only decision
 * that dispatches nothing.
 */

import type { VisualActionDispatcher, VisualActionResult } from "../visual-actions";
import type { MeaningDelta, WorldState } from "../expression/schemas";
import type { CompletionUsage } from "../llm";
import type { PresentationIntent } from "../expression/presentation/intent";
import { shapeVisualIntent } from "./shape";
import type { CommunicationDecision } from "./types";

export interface CommunicationExecution {
  status: "applied" | "noop" | "rejected" | "spoken";
  reason: string;
  action?: VisualActionResult;
  meaningDelta?: MeaningDelta;
  presentationIntent?: PresentationIntent;
}

export interface ExecuteOptions {
  world: WorldState;
  dispatcher: VisualActionDispatcher;
  visualEstablished: boolean;
  shapeIntent?: typeof shapeVisualIntent;
  onShapingUsage?: (usage: CompletionUsage) => void;
}

/**
 * New visualization shapes semantic meaning without seeing visual form, then
 * sends meaning and presentation to Expression together. Recomposition skips
 * shaping and invokes Expression on the unchanged current WorldState.
 */
export async function executeCommunicationDecision(
  decision: CommunicationDecision,
  options: ExecuteOptions,
): Promise<CommunicationExecution> {
  if (decision.type === "speak") {
    return { status: "spoken", reason: decision.message };
  }
  if (decision.type === "done") {
    return { status: "noop", reason: "done" };
  }
  if (decision.type === "emphasize") {
    const result = await options.dispatcher.dispatch({ type: "focus", entityId: decision.target });
    return { status: result.status, reason: result.reason, action: result };
  }

  const intent = decision.intent;
  const semanticIds = new Set(options.world.entities.map((entity) => entity.id));
  const scopedIds = intent.scope?.entityIds.filter((id) => semanticIds.has(id));
  const primaryIds = intent.emphasis?.primaryEntityIds?.filter((id) => semanticIds.has(id));
  const presentation: PresentationIntent = {
    form: intent.form,
    ...(scopedIds?.length ? { scope: { entityIds: scopedIds } } : {}),
    ...(primaryIds?.length ? { emphasis: { primaryEntityIds: primaryIds } } : {}),
    ...(intent.spatial ? { spatial: intent.spatial } : {}),
  };
  if (decision.type === "recompose") {
    if (!options.visualEstablished) {
      return {
        status: "noop",
        reason: "No existing visual expression is available to recompose. Establish the visual world first.",
        presentationIntent: presentation,
      };
    }
    const result = await options.dispatcher.dispatch({ type: "recompose_expression", presentation });
    return {
      status: result.status,
      reason: result.reason,
      action: result,
      presentationIntent: presentation,
    };
  }

  const { scope: _unvalidatedScope, emphasis: _unvalidatedEmphasis, ...meaningIntent } = intent;
  const meaning = await (options.shapeIntent ?? shapeVisualIntent)(
    { ...meaningIntent, ...(presentation.scope ? { scope: presentation.scope } : {}) },
    { world: options.world, onUsage: options.onShapingUsage },
  );
  if (!meaning.entities.length) {
    return { status: "rejected", reason: `shaping produced no entities for goal "${intent.goal}"` };
  }
  const result = await options.dispatcher.dispatch({ type: "express", meaning, presentation });
  return {
    status: result.status,
    reason: result.reason,
    action: result,
    meaningDelta: meaning,
    presentationIntent: presentation,
  };
}
