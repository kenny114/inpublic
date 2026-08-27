import type {
  CanvasObservation,
  CanvasObservedElement,
  CanvasSelection,
  CanvasViewport,
} from "../types";
import { readExcalidrawViewport, type ExcalidrawApiPort } from "./viewport";

interface ExcalidrawObservedElementPort {
  id?: unknown;
  type?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  angle?: unknown;
  text?: unknown;
  groupIds?: unknown;
  frameId?: unknown;
  containerId?: unknown;
  version?: unknown;
}

function numberOr(value: unknown, fallback: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Object.is(number, -0) ? 0 : number;
}

function nullableId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function idList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

function selectedIds(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value)
    .filter(([, selected]) => selected === true)
    .map(([id]) => id)
    .sort();
}

function normalizeElement(value: unknown, order: number): CanvasObservedElement | null {
  if (!value || typeof value !== "object") return null;
  const element = value as ExcalidrawObservedElementPort;
  if (typeof element.id !== "string" || typeof element.type !== "string") return null;

  const observed: CanvasObservedElement = {
    id: element.id,
    type: element.type,
    x: numberOr(element.x, 0),
    y: numberOr(element.y, 0),
    width: numberOr(element.width, 0),
    height: numberOr(element.height, 0),
    angle: numberOr(element.angle, 0),
    groupIds: idList(element.groupIds),
    frameId: nullableId(element.frameId),
    containerId: nullableId(element.containerId),
    revision: numberOr(element.version, 0),
    order,
  };
  if (typeof element.text === "string") observed.text = element.text;
  return observed;
}

/** Compact deterministic hash of an already-normalized snapshot component. */
function fingerprint(prefix: string, value: unknown): string {
  const input = JSON.stringify(value);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${prefix}-${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizeSelection(appState: ReturnType<ExcalidrawApiPort["getAppState"]>): CanvasSelection {
  return {
    elementIds: selectedIds(appState.selectedElementIds),
    groupIds: selectedIds(appState.selectedGroupIds),
  };
}

/**
 * Reads and normalizes one explicit snapshot. It registers no subscriptions,
 * retains no previous snapshot, and never writes to the editor.
 */
export function observeExcalidraw(api: ExcalidrawApiPort | null): CanvasObservation | null {
  if (!api) return null;
  const viewport = readExcalidrawViewport(api);
  if (!viewport) return null;

  const elements = api
    .getSceneElements()
    .map(normalizeElement)
    .filter((element): element is CanvasObservedElement => element !== null);
  const selection = normalizeSelection(api.getAppState());

  return {
    elements,
    selection,
    viewport,
    revisions: {
      scene: fingerprint("scene", elements),
      selection: fingerprint("selection", selection),
      viewport: fingerprint("viewport", viewport satisfies CanvasViewport),
    },
  };
}
