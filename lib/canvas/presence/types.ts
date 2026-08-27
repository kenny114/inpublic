export type AgentPresenceStatus = "idle" | "observing" | "thinking" | "acting" | "speaking";
export type AgentPresenceGesture = "none" | "pointer" | "highlight";

/** Agent-facing target: semantic identity only, never editor coordinates. */
export interface AgentPresenceTarget {
  entityId: string;
}

export interface AgentPresenceState {
  status: AgentPresenceStatus;
  target?: AgentPresenceTarget;
  gesture?: AgentPresenceGesture;
}

export interface CanvasPresenceGeometry {
  entityId: string;
  elementIds: string[];
  point: { x: number; y: number };
  bounds: { x: number; y: number; width: number; height: number };
}

export interface CanvasPresenceSnapshot {
  status: AgentPresenceStatus;
  gesture: AgentPresenceGesture;
  visible: boolean;
  suppressed: boolean;
  target: CanvasPresenceGeometry | null;
  revision: number;
}

export interface AgentPresencePort {
  setState(state: AgentPresenceState): void;
  clear(): void;
}

export interface CanvasPresenceController extends AgentPresencePort {
  getSnapshot(): CanvasPresenceSnapshot;
  subscribe(listener: () => void): () => void;
  noteHumanInteraction(): void;
  setReducedMotion(reduced: boolean): void;
  tick(now?: number): void;
}

export type CanvasPresenceResolver = (target: AgentPresenceTarget) => CanvasPresenceGeometry | null;
