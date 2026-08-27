/**
 * Deterministic VisualAction dispatcher. It chooses no action and contains no
 * model: callers provide an explicit validated intent, this routes it.
 */

import type { CanvasObservation, CanvasRuntime } from "../canvas";
import type { SemanticVisualAction } from "../expression/actions";
import type { SemanticActionExecution } from "../expression/pipeline";
import { isLiveEntityStatus, type ScenePlan, type WorldState } from "../expression/schemas";
import { VisualActionSchema, type FocusVisualAction, type VisualAction, type VisualActionType } from "./schema";

export interface SemanticActionRuntime {
  executeSemanticAction(action: SemanticVisualAction): Promise<SemanticActionExecution>;
  getWorld(): WorldState;
  getScene(): ScenePlan;
}

export interface VisualActionSnapshot {
  world: WorldState;
  scene: ScenePlan;
  observation: CanvasObservation | null;
}

interface ActionResultBase {
  actionType: VisualActionType | "unknown";
  before: VisualActionSnapshot;
  after: VisualActionSnapshot;
  reason: string;
}

export type VisualActionResult =
  | (ActionResultBase & { status: "applied"; category: "semantic" | "presentation" })
  | (ActionResultBase & { status: "noop"; category: "semantic" | "presentation" })
  | (ActionResultBase & {
      status: "rejected";
      category: "validation" | "semantic" | "presentation";
      code: string;
    });

export interface VisualActionDispatcher {
  dispatch(input: unknown): Promise<VisualActionResult>;
}

function snapshot(runtime: SemanticActionRuntime, canvas: CanvasRuntime): VisualActionSnapshot {
  return {
    world: runtime.getWorld(),
    scene: runtime.getScene(),
    observation: canvas.observe(),
  };
}

function actionTypeOf(input: unknown): VisualActionType | "unknown" {
  if (!input || typeof input !== "object") return "unknown";
  const type = (input as { type?: unknown }).type;
  const supported = new Set<VisualActionType>([
    "express",
    "update_entity",
    "remove_entity",
    "relate_entities",
    "remove_relation",
    "focus",
  ]);
  return typeof type === "string" && supported.has(type as VisualActionType)
    ? (type as VisualActionType)
    : "unknown";
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function presentationFocus(
  action: FocusVisualAction,
  runtime: SemanticActionRuntime,
  canvas: CanvasRuntime,
  before: VisualActionSnapshot,
): VisualActionResult {
  const entity = before.world.entities.find((candidate) => candidate.id === action.entityId);
  if (!entity) {
    return {
      status: "rejected",
      category: "presentation",
      code: "unknown_entity",
      actionType: action.type,
      reason: `unknown entity ${action.entityId}`,
      before,
      after: before,
    };
  }
  if (!isLiveEntityStatus(entity.status)) {
    return {
      status: "rejected",
      category: "presentation",
      code: "inactive_entity",
      actionType: action.type,
      reason: `entity ${action.entityId} is not active`,
      before,
      after: before,
    };
  }
  const object = before.scene.objects.find((candidate) => candidate.entityId === entity.id);
  if (!object) {
    return {
      status: "rejected",
      category: "presentation",
      code: "entity_not_visible",
      actionType: action.type,
      reason: `entity ${action.entityId} has no current scene object`,
      before,
      after: before,
    };
  }
  const observation = before.observation;
  if (!observation || observation.viewport.width <= 0 || observation.viewport.height <= 0) {
    return {
      status: "rejected",
      category: "presentation",
      code: "canvas_unavailable",
      actionType: action.type,
      reason: "canvas is not attached",
      before,
      after: before,
    };
  }

  // SceneObject ids are derived from semantic region ids; Canvas conversion
  // preserves that base id and uses deterministic suffixes for its labels,
  // sketches, and compound marks. Text matching is never involved.
  const objectIds = before.scene.objects.map((candidate) => candidate.id);
  const elements = observation.elements.filter((element) => {
    const owners = objectIds
      .filter((id) => element.id === id || element.id.startsWith(`${id}-`))
      .sort((left, right) => right.length - left.length);
    return owners[0] === object.id;
  });
  if (!elements.length) {
    return {
      status: "rejected",
      category: "presentation",
      code: "canvas_identity_missing",
      actionType: action.type,
      reason: `no canvas elements map to semantic entity ${action.entityId}`,
      before,
      after: before,
    };
  }
  const left = Math.min(...elements.map((element) => element.x));
  const top = Math.min(...elements.map((element) => element.y));
  const right = Math.max(...elements.map((element) => element.x + Math.max(1, element.width)));
  const bottom = Math.max(...elements.map((element) => element.y + Math.max(1, element.height)));
  const width = right - left;
  const height = bottom - top;
  const viewport = observation.viewport;
  const fitZoom = Math.min(1.4, viewport.width / Math.max(1, width + 120), viewport.height / Math.max(1, height + 120));
  const zoom = clamp(Math.min(fitZoom, Math.max(1, viewport.zoom)), 0.4, 1.4);
  const target = {
    zoom,
    scrollX: viewport.width / (2 * zoom) - (left + width / 2),
    scrollY: viewport.height / (2 * zoom) - (top + height / 2),
  };
  if (
    Math.abs(target.scrollX - viewport.scrollX) < 0.5 &&
    Math.abs(target.scrollY - viewport.scrollY) < 0.5 &&
    Math.abs(target.zoom - viewport.zoom) < 0.001
  ) {
    return {
      status: "noop",
      category: "presentation",
      actionType: action.type,
      reason: `entity ${action.entityId} is already focused`,
      before,
      after: before,
    };
  }

  canvas.applyViewport(target);
  return {
    status: "applied",
    category: "presentation",
    actionType: action.type,
    reason: `focused entity ${action.entityId}`,
    before,
    after: snapshot(runtime, canvas),
  };
}

export function createVisualActionDispatcher(
  runtime: SemanticActionRuntime,
  canvas: CanvasRuntime,
): VisualActionDispatcher {
  return {
    async dispatch(input: unknown): Promise<VisualActionResult> {
      const before = snapshot(runtime, canvas);
      const parsed = VisualActionSchema.safeParse(input);
      if (!parsed.success) {
        return {
          status: "rejected",
          category: "validation",
          code: "invalid_action",
          actionType: actionTypeOf(input),
          reason: parsed.error.issues.map((issue) => issue.message).join("; "),
          before,
          after: before,
        };
      }
      const action: VisualAction = parsed.data;
      try {
        if (action.type === "focus") return presentationFocus(action, runtime, canvas, before);

        const result = await runtime.executeSemanticAction(action);
        const after = snapshot(runtime, canvas);
        if (result.status === "applied") {
          return { status: "applied", category: "semantic", actionType: action.type, reason: result.reason, before, after };
        }
        if (result.status === "noop") {
          return { status: "noop", category: "semantic", actionType: action.type, reason: result.reason, before, after };
        }
        return {
          status: "rejected",
          category: "semantic",
          code: result.code,
          actionType: action.type,
          reason: result.reason,
          before,
          after,
        };
      } catch (error) {
        const after = snapshot(runtime, canvas);
        return {
          status: "rejected",
          category: action.type === "focus" ? "presentation" : "semantic",
          code: "runtime_error",
          actionType: action.type,
          reason: error instanceof Error ? error.message : String(error),
          before,
          after,
        };
      }
    },
  };
}
