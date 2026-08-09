/**
 * Mermaid -> Excalidraw conversion, frame construction, and board layout.
 *
 * The models never emit coordinates. mermaid-to-excalidraw lays the diagram
 * out; we only translate the finished cluster into its grid slot.
 */

// Excalidraw's element types aren't exported at a stable path across bundler
// resolutions, and we only ever touch a handful of fields.
export interface SceneElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  frameId?: string | null;
  name?: string | null;
  text?: string;
  containerId?: string | null;
  [key: string]: unknown;
}

export const FRAME_GAP = 160;
export const FRAMES_PER_ROW = 4;
/** Nominal cell size. Frames are sized by their contents; this is the stride. */
export const CELL_W = 1000;
export const CELL_H = 700;

export function slotOrigin(index: number): { x: number; y: number } {
  return {
    x: (index % FRAMES_PER_ROW) * (CELL_W + FRAME_GAP),
    y: Math.floor(index / FRAMES_PER_ROW) * (CELL_H + FRAME_GAP),
  };
}

export function truncateLabel(label: string, max = 60): string {
  const clean = label.trim().replace(/\s+/g, " ");
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

export interface BeatElements {
  frame: SceneElement;
  children: SceneElement[];
  /** Node labels, for the scene summary handed to the models. */
  nodes: string[];
}

/**
 * Convert a Mermaid string into a frame plus its children, positioned at the
 * given slot. Throws on parse failure — callers treat that as a silent no-op.
 */
export async function buildBeat(
  mermaid: string,
  label: string,
  slotIndex: number,
): Promise<BeatElements> {
  const [{ parseMermaidToExcalidraw }, { convertToExcalidrawElements }] =
    await Promise.all([
      import("@excalidraw/mermaid-to-excalidraw"),
      import("@excalidraw/excalidraw"),
    ]);

  // Leave the font alone — overriding themeVariables.fontSize desyncs
  // mermaid's text measurement from Excalidraw's and clips node labels.
  const { elements: skeleton } = await parseMermaidToExcalidraw(mermaid);

  if (!skeleton || skeleton.length === 0) {
    throw new Error("mermaid produced no elements");
  }

  const childIds = skeleton
    .map((el) => (el as { id?: string }).id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  const withFrame = [
    ...skeleton,
    { type: "frame", children: childIds, name: truncateLabel(label) },
  ];

  // If the frame skeleton is rejected for any reason, fall back to a bare
  // cluster with a synthetic frame around it.
  let converted: SceneElement[];
  try {
    converted = convertToExcalidrawElements(withFrame as never) as unknown as SceneElement[];
  } catch {
    converted = convertToExcalidrawElements(skeleton as never) as unknown as SceneElement[];
  }

  const frame = converted.find((el) => el.type === "frame");
  const children = converted.filter((el) => el.type !== "frame");
  if (!frame || children.length === 0) {
    throw new Error("conversion produced no frame");
  }

  // Anything the converter didn't bind to the frame gets bound here, so undo
  // and dimming can find every child.
  for (const child of children) child.frameId = frame.id;

  const origin = slotOrigin(slotIndex);
  const dx = origin.x - frame.x;
  const dy = origin.y - frame.y;
  for (const el of [frame, ...children]) {
    el.x += dx;
    el.y += dy;
  }

  const nodes = children
    .filter((el) => el.type === "text" && typeof el.text === "string")
    .map((el) => (el.text as string).trim())
    .filter(Boolean);

  return { frame, children, nodes };
}
