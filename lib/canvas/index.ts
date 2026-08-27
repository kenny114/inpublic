export { createExcalidrawCanvasRuntime } from "./excalidraw/adapter";
export { createCanvasPresenceController } from "./presence/controller";
export {
  boundsOf,
  createExpressionIdentity,
  decideExpressionOverflow,
  planCanvasDiff,
  syncExpressionCanvas,
  type CanvasDiff,
  type ExpressionIdentity,
  type ExpressionElementConverter,
  type OverflowDecision,
  type OverflowInfo,
  type OverflowPolicy,
  type SyncExpressionCanvasResult,
} from "./excalidraw/sync";
export type {
  ApplyExpressionInput,
  CanvasObservation,
  CanvasObservationRevisions,
  CanvasObservedElement,
  CanvasRuntime,
  CanvasSelection,
  CanvasViewport,
} from "./types";
export type {
  AgentPresenceGesture,
  AgentPresencePort,
  AgentPresenceState,
  AgentPresenceStatus,
  AgentPresenceTarget,
  CanvasPresenceController,
  CanvasPresenceGeometry,
  CanvasPresenceSnapshot,
} from "./presence/types";
