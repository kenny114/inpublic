/**
 * Deterministic renderer: VisualReentrySpec (symbolic values only) ->
 * pixels. Mirrors lib/math/visuals.ts's buildMathVisual exactly: the
 * decision pipeline (lib/visualReentry/fastPath.ts) chooses the content
 * that goes in the visual; every coordinate below is computed here, never
 * emitted upstream (codebase-wide invariant, restated for V1 as "the
 * renderer owns geometry"). Same ink/font conventions as lib/ops.ts and
 * lib/math/visuals.ts so a re-entry visual reads as part of the same
 * sketchnote.
 *
 * Only one visual family survives here: cause_effect (box-and-arrow).
 */

import { resolveIcon } from "../icons";
import type { Pen } from "../ops";
import { place } from "../ops";
import type { SceneElement } from "../scene";
import { wrapMathTextPreservingLines } from "../math/visuals";
import { displayLabel } from "./compress";
import type { CauseEffectIntent, VisualReentrySpec } from "./types";

const HAND = 1;
const INK = "#1e1e1e";
const SOFT = "#495057";
const ACCENT = "#e8590c";

export interface BuiltVisual {
  elements: SceneElement[];
  w: number;
  h: number;
  /** Where the visual was placed — the exact spot `place()` reserved. The caller needs this to check viewport containment (Part 11's camera contract) without re-deriving it. */
  x: number;
  y: number;
}

const VISUAL_W = 420;
const TITLE_SIZE = 16;
const ITEM_SIZE = 18;
const LINE_H = 26;
const BOX_PAD_X = 14;
const BOX_PAD_Y = 12;
const BOX_ICON = 22;
const BOX_ICON_GAP = 10;
const CAUSE_NODE_W = 330;
const CAUSE_ARROW_H = 30;

export function measureVisual(spec: VisualReentrySpec): { w: number; h: number } {
  return measureCauseEffect(spec);
}

function boxTextWidth(boxW: number, label: string): number {
  return iconForLabel(label) ? boxW - BOX_PAD_X * 2 - BOX_ICON - BOX_ICON_GAP : boxW - BOX_PAD_X * 2;
}

function measureBoxedStack(labels: string[], title: string | undefined, boxW: number, arrowH: number): { w: number; h: number } {
  let h = title ? TITLE_SIZE + 16 : 0;
  for (const label of labels) {
    const { lines } = wrapMathTextPreservingLines(displayLabel(label), ITEM_SIZE, boxTextWidth(boxW, label));
    h += Math.max(1, lines.length) * LINE_H + BOX_PAD_Y * 2;
  }
  h += Math.max(0, labels.length - 1) * arrowH;
  return { w: VISUAL_W, h: Math.max(130, h) };
}

function measureCauseEffect(spec: CauseEffectIntent): { w: number; h: number } {
  return measureBoxedStack(spec.nodes, spec.title, CAUSE_NODE_W, CAUSE_ARROW_H);
}

/**
 * Places on the `pen` it is given, exactly like buildMathVisual does — so
 * callers that want a "tentative, discardable" placement (Visual Re-entry's
 * async decision may finish after the pen has moved on) MUST pass a scratch
 * clone, never the live shared pen, and only apply the same reservation to
 * the real pen once they've confirmed they're actually committing. See
 * lib/visualReentry/orchestrate.ts.
 */
export async function buildVisual(spec: VisualReentrySpec, pen: Pen): Promise<BuiltVisual | null> {
  const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
  const conv = (s: Record<string, unknown>[]) =>
    convertToExcalidrawElements(s as never) as unknown as SceneElement[];

  const { w, h } = measureVisual(spec);
  const p = place(pen, w, h, true);

  return { elements: conv(causeEffectSkeleton(spec, p.x, p.y, w, h)), w, h, x: p.x, y: p.y };
}

function iconForLabel(label: string) {
  for (const word of label.split(/\s+/)) {
    const art = resolveIcon(word);
    if (art) return art;
  }
  return resolveIcon(label);
}

function iconSkeleton(art: NonNullable<ReturnType<typeof resolveIcon>>, x: number, y: number, size: number): Record<string, unknown>[] {
  const sx = (value: number) => x + (value / 100) * size;
  const sy = (value: number) => y + (value / 100) * size;
  const out: Record<string, unknown>[] = [];
  for (const stroke of art.strokes) {
    const [hx, hy] = stroke[0];
    out.push({
      type: "line",
      x: sx(hx),
      y: sy(hy),
      points: stroke.map(([px, py]) => [sx(px) - sx(hx), sy(py) - sy(hy)]),
      strokeColor: SOFT,
      strokeWidth: 1,
      roughness: 2,
    });
  }
  for (const [cx, cy, rx, ry] of art.ellipses) {
    out.push({
      type: "ellipse",
      x: sx(cx - rx),
      y: sy(cy - ry),
      width: (rx * 2 / 100) * size,
      height: (ry * 2 / 100) * size,
      strokeColor: SOFT,
      backgroundColor: "transparent",
      strokeWidth: 1,
      roughness: 2,
    });
  }
  return out;
}

function boxedLabel(
  label: string,
  x: number,
  y: number,
  w: number,
  stroke: string,
): { elements: Record<string, unknown>[]; height: number } {
  const shown = displayLabel(label);
  const art = iconForLabel(shown);
  const textW = boxTextWidth(w, shown);
  const { lines } = wrapMathTextPreservingLines(shown, ITEM_SIZE, textW);
  const height = Math.max(1, lines.length) * LINE_H + BOX_PAD_Y * 2;
  const textX = art ? x + BOX_PAD_X + BOX_ICON + BOX_ICON_GAP : x + BOX_PAD_X;
  const elements: Record<string, unknown>[] = [
    {
      type: "rectangle",
      x,
      y,
      width: w,
      height,
      strokeColor: stroke,
      backgroundColor: "transparent",
      strokeWidth: 1,
      roughness: 1,
      roundness: { type: 3 },
    },
    {
      type: "text",
      x: textX,
      y: y + BOX_PAD_Y,
      text: lines.join("\n"),
      fontSize: ITEM_SIZE,
      fontFamily: HAND,
      strokeColor: INK,
    },
  ];
  if (art) {
    const iconY = y + Math.max(BOX_PAD_Y, (height - BOX_ICON) / 2);
    elements.push(...iconSkeleton(art, x + BOX_PAD_X, iconY, BOX_ICON));
  }
  return { elements, height };
}

function stackConnector(
  fromX: number,
  fromBottom: number,
  toTop: number,
  color: string,
  label?: string,
): Record<string, unknown>[] {
  const midX = fromX;
  const out: Record<string, unknown>[] = [
    {
      type: "line",
      x: midX,
      y: fromBottom,
      points: [[0, 0], [0, toTop - fromBottom]],
      strokeColor: color,
      strokeWidth: 2,
      roughness: 1,
      endArrowhead: "arrow",
    },
  ];
  if (label) {
    out.push({
      type: "text",
      x: midX + 10,
      y: (fromBottom + toTop) / 2 - 8,
      text: label,
      fontSize: 11,
      fontFamily: HAND,
      strokeColor: color,
    });
  }
  return out;
}

// --- cause/effect ------------------------------------------------------

/** Noun boxes on a warm spine. No stamp, no caps — a sketchnote, not a schema. */
export function causeEffectSkeleton(
  spec: CauseEffectIntent,
  x: number,
  y: number,
  w: number,
  h: number,
): Record<string, unknown>[] {
  void h;
  const out: Record<string, unknown>[] = [];
  const nodeX = x + (w - CAUSE_NODE_W) / 2;
  let cy = y;
  if (spec.title) {
    out.push({ type: "text", x, y: cy, text: displayLabel(spec.title), fontSize: TITLE_SIZE, fontFamily: HAND, strokeColor: SOFT });
    cy += TITLE_SIZE + 16;
  }
  const bands: Array<{ x: number; top: number; bottom: number }> = [];
  for (const node of spec.nodes) {
    const box = boxedLabel(node, nodeX, cy, CAUSE_NODE_W, INK);
    out.push(...box.elements);
    bands.push({ x: nodeX + CAUSE_NODE_W / 2, top: cy, bottom: cy + box.height });
    cy += box.height + CAUSE_ARROW_H;
  }
  for (const edge of spec.edges) {
    const from = bands[edge.from];
    const to = bands[edge.to];
    if (!from || !to) continue;
    const downward = to.top >= from.bottom;
    const startY = downward ? from.bottom : from.top;
    const endY = downward ? to.top : to.bottom;
    out.push(...stackConnector(from.x, startY, endY, ACCENT));
  }
  return out;
}

// --- cause/effect incremental append ------------------------------------
//
// Board.tsx draws a cause_effect chain node-by-node as evidence.ts reports
// each clause ("opened" for the first edge, "completed" for the rest — see
// lib/visualReentry/evidence.ts's doc comment; cause_effect never actually
// reaches an "extended" step because a chain of >=2 consecutive edges
// completes immediately). The whole pen region is reserved once, up front,
// with headroom for the schema's 4-node cap (CauseEffectIntentSchema), so a
// later append never has to move the pen again — moving it could land the
// next reservation on top of content placed in between (a live line, an
// unrelated visual). Growing only *inside* an already-reserved region keeps
// the incremental draw exactly as overlap-safe as the one-shot draw.

/** Generous per-node headroom for a node not yet known when the region is reserved. checkEndpoint (lib/visualReentry/cause.ts) caps a causal endpoint at 160 chars / 24 tokens, so five wrapped lines at CAUSE_NODE_W is comfortably more than any admitted label will ever need. */
const CAUSE_NODE_MAX_LINES = 5;
const CAUSE_NODE_RESERVE_H = CAUSE_NODE_MAX_LINES * LINE_H + BOX_PAD_Y * 2;
/** CauseEffectIntentSchema's node cap (lib/visualReentry/types.ts) — headroom is never reserved past this. */
const CAUSE_EFFECT_NODE_CAP = 4;

function causeEffectNodeHeight(label: string): number {
  const shown = displayLabel(label);
  const { lines } = wrapMathTextPreservingLines(shown, ITEM_SIZE, boxTextWidth(CAUSE_NODE_W, shown));
  return Math.max(1, lines.length) * LINE_H + BOX_PAD_Y * 2;
}

/**
 * Reserves the pen region for a cause/effect chain that will be drawn one
 * node at a time. `knownNodes` are the labels already known right now;
 * `extraNodes` reserves headroom for nodes that may still arrive (capped at
 * the schema's 4-node total) so later `appendCauseEffectNode` calls only
 * ever draw inside this one reservation.
 */
export function measureCauseEffectProgress(knownNodes: string[], extraNodes: number): { w: number; h: number } {
  let h = 0;
  knownNodes.forEach((node, index) => {
    h += causeEffectNodeHeight(node);
    if (index > 0) h += CAUSE_ARROW_H;
  });
  const reserved = Math.max(0, Math.min(extraNodes, CAUSE_EFFECT_NODE_CAP - knownNodes.length));
  if (reserved > 0) h += reserved * (CAUSE_NODE_RESERVE_H + CAUSE_ARROW_H);
  return { w: VISUAL_W, h: Math.max(130, h) };
}

export interface CauseEffectAppendAnchor {
  bottom: number;
  centerX: number;
}

export interface CauseEffectAppendResult {
  elements: Record<string, unknown>[];
  anchor: CauseEffectAppendAnchor;
}

/**
 * Draws exactly one more cause/effect node — and, when `prev` is given, the
 * arrow from the previously-drawn node into it — inside a region already
 * reserved by `measureCauseEffectProgress`. Shares `boxedLabel`/
 * `stackConnector` with `causeEffectSkeleton` so a chain drawn one clause at
 * a time is pixel-identical to the same chain drawn in a single shot.
 */
export function appendCauseEffectNode(
  node: string,
  regionX: number,
  y: number,
  regionW: number,
  prev?: CauseEffectAppendAnchor,
): CauseEffectAppendResult {
  const nodeX = regionX + (regionW - CAUSE_NODE_W) / 2;
  const out: Record<string, unknown>[] = [];
  if (prev) out.push(...stackConnector(prev.centerX, prev.bottom, y, ACCENT));
  const box = boxedLabel(node, nodeX, y, CAUSE_NODE_W, INK);
  out.push(...box.elements);
  return { elements: out, anchor: { bottom: y + box.height, centerX: nodeX + CAUSE_NODE_W / 2 } };
}

/** Where the next appended node should start, given the previous node's bottom — keeps the CAUSE_ARROW_H gap constant out of Board.tsx. */
export function nextCauseEffectNodeY(prevBottom: number): number {
  return prevBottom + CAUSE_ARROW_H;
}

/** Same raw-shape -> SceneElement conversion `buildVisual` uses, exposed so the incremental cause/effect path never has to duplicate the dynamic Excalidraw import. */
export async function convertCauseEffectAppend(elements: Record<string, unknown>[]): Promise<SceneElement[]> {
  const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
  return convertToExcalidrawElements(elements as never) as unknown as SceneElement[];
}
