import type { CanvasViewport } from "../types";

export interface ExcalidrawApiPort {
  updateScene(scene: {
    elements?: readonly unknown[];
    appState?: {
      scrollX: number;
      scrollY: number;
      zoom: { value: number };
    };
  }): void;
  getSceneElements(): readonly unknown[];
  getAppState(): {
    scrollX?: number;
    scrollY?: number;
    zoom?: { value?: number } | number;
    width?: number;
    height?: number;
    selectedElementIds?: Readonly<Record<string, boolean>>;
    selectedGroupIds?: Readonly<Record<string, boolean>>;
  };
}

export function isExcalidrawApiPort(value: unknown): value is ExcalidrawApiPort {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ExcalidrawApiPort>;
  return (
    typeof candidate.updateScene === "function" &&
    typeof candidate.getSceneElements === "function" &&
    typeof candidate.getAppState === "function"
  );
}

export function readExcalidrawViewport(api: ExcalidrawApiPort | null): CanvasViewport | null {
  if (!api) return null;
  const appState = api.getAppState();
  const zoom = typeof appState.zoom === "number" ? appState.zoom : appState.zoom?.value;
  return {
    scrollX: Number(appState.scrollX ?? 0),
    scrollY: Number(appState.scrollY ?? 0),
    zoom: Number(zoom ?? 1),
    width: Number(appState.width ?? 0),
    height: Number(appState.height ?? 0),
  };
}

/** Applies an already-decided camera state using the installed Excalidraw 0.18 API. */
export function applyExcalidrawViewport(
  api: ExcalidrawApiPort | null,
  viewport: Pick<CanvasViewport, "scrollX" | "scrollY" | "zoom">,
): void {
  api?.updateScene({
    appState: {
      scrollX: viewport.scrollX,
      scrollY: viewport.scrollY,
      zoom: { value: viewport.zoom },
    },
  });
}
