/**
 * Turns one validated `CommunicationDecision` into real state, entirely
 * through the EXISTING `VisualActionDispatcher` — this module never touches
 * Canvas, Excalidraw, or WorldState directly. `speak` is the only decision
 * that dispatches nothing.
 */

import type { VisualActionDispatcher, VisualActionResult } from "../visual-actions";
import type { WorldState } from "../expression/schemas";
import type { CompletionUsage } from "../llm";
import { shapeVisualIntent } from "./shape";
import type { CommunicationDecision } from "./types";

export interface CommunicationExecution {
  status: "applied" | "noop" | "rejected" | "spoken";
  reason: string;
  action?: VisualActionResult;
}

export interface ExecuteOptions {
  world: WorldState;
  dispatcher: VisualActionDispatcher;
  onShapingUsage?: (usage: CompletionUsage) => void;
}

/**
 * `visualize` and `recompose` both resolve through the same shape → express
 * path in this v0. They are semantically different requests (recompose asks
 * for the SAME facts under new organization/emphasis; visualize asks for
 * genuinely new content) but the deterministic composer has no first-class
 * "re-render this WorldState under a different grammar, unchanged" entry
 * point today — see the spec's Known Limitations. Passing `aboutEntityIds`
 * on a recompose intent is what steers the shaping call toward restating
 * existing entities (reusing their id/label) rather than inventing new ones,
 * which is the closest honest approximation available without adding a new
 * production capability.
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
  const meaning = await shapeVisualIntent(intent, { world: options.world, onUsage: options.onShapingUsage });
  if (!meaning.entities.length) {
    return { status: "rejected", reason: `shaping produced no entities for goal "${intent.goal}"` };
  }
  const result = await options.dispatcher.dispatch({ type: "express", meaning });
  return { status: result.status, reason: result.reason, action: result };
}
