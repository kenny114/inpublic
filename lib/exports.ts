/**
 * Getting the board off the machine.
 *
 * Excalidraw's own export UI is deliberately disabled (it sits where the
 * control bar goes and it is not styleable), so these call the library's
 * export functions directly.
 */

import type { SceneElement } from "./scene";
import type { SemanticSnapshot } from "./semantic";
import type { LogEvent } from "./types";
import type { InPublicMode, StoryState } from "./story";

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

/** Native Excalidraw scene — reopens in excalidraw.com with everything intact. */
export function exportExcalidraw(elements: SceneElement[]) {
  const payload = {
    type: "excalidraw",
    version: 2,
    source: "inpublic",
    elements,
    appState: { viewBackgroundColor: "#ffffff", gridSize: null },
    files: {},
  };
  download(
    new Blob([JSON.stringify(payload)], { type: "application/json" }),
    `inpublic-${stamp()}.excalidraw`,
  );
}

/**
 * The board as meaning: concepts, relationships, sections, the operation
 * history, and the transcript. This is the format worth keeping — the pixels
 * can always be redrawn from it, but the reasoning cannot be recovered from
 * the pixels.
 */
export function exportSceneJson(
  elements: SceneElement[],
  semantic: SemanticSnapshot,
  log: LogEvent[],
  startedAt: number | null,
  story?: StoryState,
  mode: InPublicMode = "standard",
) {
  const payload = {
    version: 2,
    startedAt: startedAt ? new Date(startedAt).toISOString() : null,
    exportedAt: new Date().toISOString(),
    semantic,
    story,
    mode,
    log,
    elements,
  };
  download(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    `inpublic-scene-${stamp()}.json`,
  );
}

export async function exportPng(elements: SceneElement[]) {
  const { exportToBlob } = await import("@excalidraw/excalidraw");
  const blob = await exportToBlob({
    elements: elements as never,
    appState: { exportBackground: true, viewBackgroundColor: "#ffffff" } as never,
    files: null,
    mimeType: "image/png",
    exportPadding: 32,
  });
  download(blob, `inpublic-${stamp()}.png`);
}

export async function exportSvg(elements: SceneElement[]) {
  const { exportToSvg } = await import("@excalidraw/excalidraw");
  const svg = await exportToSvg({
    elements: elements as never,
    appState: { exportBackground: true, viewBackgroundColor: "#ffffff" } as never,
    files: null,
    exportPadding: 32,
  });
  download(
    new Blob([new XMLSerializer().serializeToString(svg)], {
      type: "image/svg+xml",
    }),
    `inpublic-${stamp()}.svg`,
  );
}
