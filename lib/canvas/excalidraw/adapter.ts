import type { SceneElement } from "../../scene";
import { EMPTY_SCENE_PLAN, type ScenePlan } from "../../expression/schemas";
import type { ApplyExpressionInput, CanvasRuntime } from "../types";
import { createCanvasPresenceController } from "../presence/controller";
import type { AgentPresenceTarget, CanvasPresenceGeometry } from "../presence/types";
import {
  createExpressionIdentity,
  syncExpressionCanvas,
  type ExpressionElementConverter,
  type ExpressionIdentity,
} from "./sync";
import {
  applyExcalidrawViewport,
  isExcalidrawApiPort,
  readExcalidrawViewport,
  type ExcalidrawApiPort,
} from "./viewport";
import { observeExcalidraw } from "./observation";

class ExcalidrawCanvasRuntime implements CanvasRuntime {
  private api: ExcalidrawApiPort | null = null;
  private expressionIdentity: ExpressionIdentity = createExpressionIdentity();
  private scene: ScenePlan = EMPTY_SCENE_PLAN;
  private readonly convertElements?: ExpressionElementConverter;
  readonly presence = createCanvasPresenceController({ resolve: (target) => this.resolvePresenceTarget(target) });

  constructor(convertElements?: ExpressionElementConverter) {
    this.convertElements = convertElements;
  }

  attach(api: unknown): void {
    this.api = isExcalidrawApiPort(api) ? api : null;
  }

  async preload(): Promise<void> {
    await import("@excalidraw/excalidraw");
  }

  applyElements(elements: SceneElement[]): void {
    this.api?.updateScene({ elements });
  }

  readViewport() {
    return readExcalidrawViewport(this.api);
  }

  applyViewport(viewport: Parameters<CanvasRuntime["applyViewport"]>[0]): void {
    applyExcalidrawViewport(this.api, viewport);
  }

  observe() {
    return observeExcalidraw(this.api);
  }

  async applyExpression(input: ApplyExpressionInput) {
    const result = await syncExpressionCanvas(
      input.scene,
      input.patch,
      input.elements,
      input.pen,
      input.pageIndex,
      this.expressionIdentity,
      input.onOverflow,
      input.sketches,
      input.overflowPolicy,
      this.convertElements,
    );
    if (!result.skipped) this.scene = input.scene;
    return result;
  }

  resetExpressionIdentity(): void {
    this.expressionIdentity = createExpressionIdentity();
    this.scene = EMPTY_SCENE_PLAN;
    this.presence.clear();
  }

  private resolvePresenceTarget(target: AgentPresenceTarget): CanvasPresenceGeometry | null {
    const observation = this.observe();
    if (!observation) return null;
    const objectIds = this.scene.objects
      .filter((object) => object.entityId === target.entityId)
      .map((object) => object.id);
    if (!objectIds.length) return null;
    const elements = observation.elements.filter((element) =>
      objectIds.some((objectId) => element.id === objectId || element.id.startsWith(`${objectId}-`)),
    );
    if (!elements.length) return null;
    const minX = Math.min(...elements.map((element) => element.x));
    const minY = Math.min(...elements.map((element) => element.y));
    const maxX = Math.max(...elements.map((element) => element.x + element.width));
    const maxY = Math.max(...elements.map((element) => element.y + element.height));
    const zoom = observation.viewport.zoom;
    const x = (minX + observation.viewport.scrollX) * zoom;
    const y = (minY + observation.viewport.scrollY) * zoom;
    const width = (maxX - minX) * zoom;
    const height = (maxY - minY) * zoom;
    return {
      entityId: target.entityId,
      elementIds: elements.map((element) => element.id),
      point: { x: x + width / 2, y: y + height / 2 },
      bounds: { x, y, width, height },
    };
  }
}

export function createExcalidrawCanvasRuntime(options: { convertElements?: ExpressionElementConverter } = {}): CanvasRuntime {
  return new ExcalidrawCanvasRuntime(options.convertElements);
}
