/**
 * Deterministic renderers: VisualReentrySpec (symbolic values only) ->
 * pixels. Mirrors lib/math/visuals.ts's buildMathVisual exactly: the model
 * (lib/visualReentry/decide.ts) chooses WHICH visual and what content goes
 * in it; every coordinate below is computed here, never emitted by a model
 * (codebase-wide invariant, restated for V1 as "the renderer owns
 * geometry"). Same ink/font conventions as lib/ops.ts and lib/math/visuals.ts
 * so a re-entry visual reads as part of the same sketchnote.
 */

import { resolveIcon } from "../icons";
import type { Pen } from "../ops";
import { place } from "../ops";
import type { SceneElement } from "../scene";
import { wrapMathTextPreservingLines } from "../math/visuals";
import { displayLabel } from "./compress";
import type { CauseEffectIntent, ComparisonIntent, EnumerationIntent, QuantitativeChangeIntent, SequenceIntent, VisualReentrySpec } from "./types";

const HAND = 1;
const INK = "#1e1e1e";
const SOFT = "#495057";
const ACCENT = "#e8590c";
const FILL = "#1971c2";

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
/** Numbering column ("01", "02", …) — fixed width, no bullet glyph, matches the "clean visual notes" reference appearance rather than a bulleted card. */
const NUMBER_COL_W = 34;

export function measureVisual(spec: VisualReentrySpec): { w: number; h: number } {
  if (spec.type === "enumeration") return measureEnumeration(spec);
  if (spec.type === "sequence") return measureSequence(spec);
  if (spec.type === "cause_effect") return measureCauseEffect(spec);
  if (spec.type === "comparison") return measureComparison(spec);
  return { w: VISUAL_W, h: spec.fromLabel || spec.toLabel ? QUANT_H_WITH_LABELS : QUANT_H };
}

function measureEnumeration(spec: EnumerationIntent): { w: number; h: number } {
  let h = 0;
  if (spec.title) h += TITLE_SIZE + 16;
  for (const item of spec.items) {
    const { lines } = wrapMathTextPreservingLines(item, ITEM_SIZE, VISUAL_W - NUMBER_COL_W);
    h += Math.max(1, lines.length) * LINE_H;
  }
  return { w: VISUAL_W, h: Math.max(60, h) };
}

const SEQUENCE_ARROW_H = 28;
const BOX_PAD_X = 14;
const BOX_PAD_Y = 12;
const BOX_ICON = 22;
const BOX_ICON_GAP = 10;
const CAUSE_NODE_W = 330;
const CAUSE_ARROW_H = 30;

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

const COMPARISON_GAP = 34;
const COMPARISON_HEADER_H = 42;

function measureComparison(spec: ComparisonIntent): { w: number; h: number } {
  const colW = (VISUAL_W - COMPARISON_GAP) / 2;
  let h = COMPARISON_HEADER_H;
  for (const row of spec.rows) {
    const leftLines = row.left ? wrapMathTextPreservingLines(row.left, ITEM_SIZE, colW - 12).lines.length : 0;
    const rightLines = row.right ? wrapMathTextPreservingLines(row.right, ITEM_SIZE, colW - 12).lines.length : 0;
    h += Math.max(1, leftLines, rightLines) * LINE_H + 12;
  }
  return { w: VISUAL_W, h: Math.max(110, h) };
}

function measureSequence(spec: SequenceIntent): { w: number; h: number } {
  return measureBoxedStack(spec.steps, spec.title, VISUAL_W, SEQUENCE_ARROW_H);
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

  switch (spec.type) {
    case "enumeration":
      return { elements: conv(enumerationSkeleton(spec, p.x, p.y, w, h)), w, h, x: p.x, y: p.y };
    case "quantitative_change":
      return { elements: conv(quantitativeChangeSkeleton(spec, p.x, p.y, w, h)), w, h, x: p.x, y: p.y };
    case "sequence":
      return { elements: conv(sequenceSkeleton(spec, p.x, p.y, w, h)), w, h, x: p.x, y: p.y };
    case "cause_effect":
      return { elements: conv(causeEffectSkeleton(spec, p.x, p.y, w, h)), w, h, x: p.x, y: p.y };
    case "comparison":
      return { elements: conv(comparisonSkeleton(spec, p.x, p.y, w, h)), w, h, x: p.x, y: p.y };
    default:
      return null;
  }
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

// --- comparison --------------------------------------------------------

/** Neutral two-column contrast: no scores, checks, inferred dimensions, winner colors, or forced filler. */
export function comparisonSkeleton(
  spec: ComparisonIntent,
  x: number,
  y: number,
  w: number,
  h: number,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const colW = (w - COMPARISON_GAP) / 2;
  const rightX = x + colW + COMPARISON_GAP;
  out.push({ type: "text", x, y, text: displayLabel(spec.leftLabel), fontSize: TITLE_SIZE, fontFamily: HAND, strokeColor: INK });
  out.push({ type: "text", x: rightX, y, text: displayLabel(spec.rightLabel), fontSize: TITLE_SIZE, fontFamily: HAND, strokeColor: INK });
  out.push({ type: "line", x, y: y + 28, points: [[0, 0], [w, 0]], strokeColor: SOFT, strokeWidth: 1, roughness: 0 });
  out.push({ type: "line", x: x + colW + COMPARISON_GAP / 2, y: y + 4, points: [[0, 0], [0, h - 4]], strokeColor: SOFT, strokeWidth: 1, roughness: 0 });
  let cy = y + COMPARISON_HEADER_H;
  for (const row of spec.rows) {
    const leftLines = row.left ? wrapMathTextPreservingLines(row.left, ITEM_SIZE, colW - 12).lines : [];
    const rightLines = row.right ? wrapMathTextPreservingLines(row.right, ITEM_SIZE, colW - 12).lines : [];
    if (row.left) out.push({ type: "text", x, y: cy, text: leftLines.join("\n"), fontSize: ITEM_SIZE, fontFamily: HAND, strokeColor: INK });
    if (row.right) out.push({ type: "text", x: rightX, y: cy, text: rightLines.join("\n"), fontSize: ITEM_SIZE, fontFamily: HAND, strokeColor: INK });
    cy += Math.max(1, leftLines.length, rightLines.length) * LINE_H + 12;
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

// --- sequence ----------------------------------------------------------

/** Boxed steps on a cool spine. Short labels, a then-arrow, the hand not a numbered essay. */
export function sequenceSkeleton(
  spec: SequenceIntent,
  x: number,
  y: number,
  w: number,
  h: number,
): Record<string, unknown>[] {
  void h;
  const out: Record<string, unknown>[] = [];
  let cy = y;
  if (spec.title) {
    out.push({ type: "text", x, y: cy, text: displayLabel(spec.title), fontSize: TITLE_SIZE, fontFamily: HAND, strokeColor: SOFT });
    cy += TITLE_SIZE + 16;
  }
  spec.steps.forEach((step, index) => {
    const box = boxedLabel(step, x, cy, w, FILL);
    out.push(...box.elements);
    const bottom = cy + box.height;
    cy = bottom + SEQUENCE_ARROW_H;
    if (index < spec.steps.length - 1) {
      out.push(...stackConnector(x + w / 2, bottom, cy, FILL, "then"));
    }
  });
  return out;
}

// --- enumeration -------------------------------------------------------

/**
 * Clean visual notes, not a card: no bounding rectangle, no bullet glyphs,
 * no fill. A title (if any) in caps, then a plain two-digit-numbered list —
 * "01  Speed / 02  Accuracy / 03  Presentation" — the same restraint V2's
 * own ink asks for elsewhere in this codebase. Geometry only; the model
 * never supplies x/y/width/height/spacing, all of it is computed here.
 */
export function enumerationSkeleton(
  spec: EnumerationIntent,
  x: number,
  y: number,
  w: number,
  h: number,
): Record<string, unknown>[] {
  void h; // footprint already reserved via measureEnumeration; nothing here needs it directly
  const out: Record<string, unknown>[] = [];
  let cy = y;

  if (spec.title) {
    out.push({
      type: "text",
      x,
      y: cy,
      text: displayLabel(spec.title),
      fontSize: TITLE_SIZE,
      fontFamily: HAND,
      strokeColor: SOFT,
    });
    cy += TITLE_SIZE + 16;
  }

  const textWidth = w - NUMBER_COL_W;
  spec.items.forEach((item, i) => {
    const { lines } = wrapMathTextPreservingLines(displayLabel(item), ITEM_SIZE, textWidth);
    out.push({
      type: "text",
      x,
      y: cy,
      text: String(i + 1).padStart(2, "0"),
      fontSize: ITEM_SIZE,
      fontFamily: HAND,
      strokeColor: SOFT,
    });
    out.push({
      type: "text",
      x: x + NUMBER_COL_W,
      y: cy,
      text: lines.join("\n"),
      fontSize: ITEM_SIZE,
      fontFamily: HAND,
      strokeColor: INK,
    });
    cy += Math.max(1, lines.length) * LINE_H;
  });

  return out;
}

// --- quantitative_change -------------------------------------------------
//
// Deliberately NOT a bar chart: there is no real axis or scale here, so a
// proportional bar height would be a decorative fake graph, not a chart.
// Two plain value blocks with an arrow between them, matching the brief's
// own reference appearance exactly:
//
//   LAST WEEK                THIS WEEK
//   10 users   ─────────→    20 users

const LABEL_SIZE = 13;
const VALUE_SIZE = 22;
const ARROW_GAP = 90;
const QUANT_H = 60;
const QUANT_H_WITH_LABELS = QUANT_H + LABEL_SIZE + 12;

export function quantitativeChangeSkeleton(
  spec: QuantitativeChangeIntent,
  x: number,
  y: number,
  w: number,
  h: number,
): Record<string, unknown>[] {
  void h;
  const out: Record<string, unknown>[] = [];
  const colW = (w - ARROW_GAP) / 2;
  const leftX = x;
  const rightX = x + colW + ARROW_GAP;
  const rising = spec.to >= spec.from;
  const arrowColor = rising ? FILL : ACCENT;

  let cy = y;
  if (spec.fromLabel || spec.toLabel) {
    if (spec.fromLabel) {
      out.push({ type: "text", x: leftX, y: cy, text: displayLabel(spec.fromLabel), fontSize: LABEL_SIZE, fontFamily: HAND, strokeColor: SOFT });
    }
    if (spec.toLabel) {
      out.push({ type: "text", x: rightX, y: cy, text: displayLabel(spec.toLabel), fontSize: LABEL_SIZE, fontFamily: HAND, strokeColor: SOFT });
    }
    cy += LABEL_SIZE + 12;
  }

  const unit = spec.unit ? ` ${spec.unit}` : "";
  out.push({ type: "text", x: leftX, y: cy, text: `${formatQualifiedNumber(spec.from, spec.fromQualifier)}${unit}`, fontSize: VALUE_SIZE, fontFamily: HAND, strokeColor: INK });
  out.push({ type: "text", x: rightX, y: cy, text: `${formatQualifiedNumber(spec.to, spec.toQualifier)}${unit}`, fontSize: VALUE_SIZE, fontFamily: HAND, strokeColor: INK });

  out.push({
    type: "line",
    x: leftX + colW,
    y: cy + VALUE_SIZE / 2,
    points: [
      [0, 0],
      [ARROW_GAP, 0],
    ],
    strokeColor: arrowColor,
    strokeWidth: 2,
    roughness: 1,
    endArrowhead: "arrow",
  });

  return out;
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

function formatQualifiedNumber(n: number, qualifier?: string): string {
  const value = formatNumber(n);
  return qualifier ? `${qualifier} ${value}` : value;
}
