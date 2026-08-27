import type { RenderPatch, ScenePlan } from "../expression/schemas";
import type { Sketch } from "../expression/draw/schemas";
import type { Pen } from "../ops";
import type { SceneElement } from "../scene";
import type { OverflowInfo, OverflowPolicy, SyncExpressionCanvasResult } from "./excalidraw/sync";
import type { CanvasPresenceController } from "./presence/types";

export interface CanvasViewport {
  scrollX: number;
  scrollY: number;
  zoom: number;
  width: number;
  height: number;
}

/** A canvas-owned description of one live object, independent of Excalidraw's schema. */
export interface CanvasObservedElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  text?: string;
  groupIds: string[];
  frameId: string | null;
  containerId: string | null;
  /** Canvas-native content revision. Identity remains `id`; this changes when the object changes. */
  revision: number;
  /** Normalized scene order, useful for understanding overlap without exposing editor indices. */
  order: number;
}

export interface CanvasSelection {
  elementIds: string[];
  groupIds: string[];
}

export interface CanvasObservationRevisions {
  /** Element content, geometry, relationships, deletion, and ordering. */
  scene: string;
  /** Selection only; does not change for scene or camera changes. */
  selection: string;
  /** Viewport only; does not change for scene or selection changes. */
  viewport: string;
}

/** A read-only snapshot of what actually exists in the mounted canvas. */
export interface CanvasObservation {
  elements: CanvasObservedElement[];
  selection: CanvasSelection;
  viewport: CanvasViewport;
  revisions: CanvasObservationRevisions;
}

export interface ApplyExpressionInput {
  scene: ScenePlan;
  patch: RenderPatch;
  elements: SceneElement[];
  pen: Pen;
  pageIndex: number;
  onOverflow?: (info: OverflowInfo) => void;
  sketches?: Map<string, Sketch>;
  overflowPolicy?: OverflowPolicy;
}

/** The current application-facing canvas contract. Observation is snapshot-only and read-only. */
export interface CanvasRuntime {
  /** Ephemeral host-layer presence; never part of the semantic canvas snapshot. */
  readonly presence: CanvasPresenceController;
  attach(api: unknown): void;
  preload(): Promise<void>;
  applyElements(elements: SceneElement[]): void;
  readViewport(): CanvasViewport | null;
  applyViewport(viewport: Pick<CanvasViewport, "scrollX" | "scrollY" | "zoom">): void;
  observe(): CanvasObservation | null;
  applyExpression(input: ApplyExpressionInput): Promise<SyncExpressionCanvasResult>;
  resetExpressionIdentity(): void;
}
