import type { SceneElement } from "../../scene";
import type { ApplyExpressionInput, CanvasRuntime } from "../types";
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
  private readonly convertElements?: ExpressionElementConverter;

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

  applyExpression(input: ApplyExpressionInput) {
    return syncExpressionCanvas(
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
  }

  resetExpressionIdentity(): void {
    this.expressionIdentity = createExpressionIdentity();
  }
}

export function createExcalidrawCanvasRuntime(options: { convertElements?: ExpressionElementConverter } = {}): CanvasRuntime {
  return new ExcalidrawCanvasRuntime(options.convertElements);
}
