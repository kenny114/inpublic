/**
 * Deterministic renderers: MathVisualSpec (symbolic values only) -> pixels.
 *
 * The model chooses WHICH visual and what numbers go in it; every coordinate
 * below is computed here, never emitted by a model. This is what the brief
 * means by "do not let the language model freely invent graph coordinates."
 *
 * Follows lib/ops.ts's conventions deliberately — same font, same ink colours
 * — so a math visual reads as part of the same sketchnote, not a bolted-on
 * widget.
 */

import type { Pen } from "../ops";
import { place } from "../ops";
import type { SceneElement } from "../scene";
import type { MathVisualSpec } from "./types";

const HAND = 1;
const INK = "#1e1e1e";
const SOFT = "#495057";
const ACCENT = "#e8590c";
const MATH_FILL = "#1971c2";

export interface BuiltMathVisual {
  elements: SceneElement[];
  w: number;
  h: number;
}

export interface BuiltMathStep {
  elements: SceneElement[];
  nodeId: string;
  mark: { key: string; x: number; y: number; w: number; h: number; elementId?: string };
}

/**
 * Longest single line a math step box will grow to before wrapping instead
 * of widening — keeps a step from becoming a page-spanning bar that pushes
 * neighbouring steps out of their controlled region or off the page edge.
 * Matched to a comfortable ~2-column layout inside `CONTENT_W` (lib/ops.ts).
 */
const MAX_STEP_BOX_W = 460;
const STEP_BOX_PAD_X = 48;

export interface WrappedMathText {
  lines: string[];
  width: number;
  height: number;
}

/**
 * A `(...)` group ("(76 × 2)") is one mathematical unit — a carry
 * annotation or partial-product note — and must never be split across two
 * lines. Ordinary greedy word-wrap treats every space as an equally valid
 * break point, which happily separates "(76" from "× 2)". Tokenizing
 * parenthesized spans as atomic units before wrapping is what "never split
 * a mathematical expression at an arbitrary whitespace boundary when a
 * better structural boundary exists" means in practice here.
 */
function tokenizeMathLine(line: string): string[] {
  const tokens = line.match(/\([^)]*\)|\S+/g);
  return tokens ?? [];
}

/** Greedy wrap of ONE line's tokens to a character budget — good enough for short math expressions/reasons, not prose. */
function wrapLineTokens(tokens: string[], budget: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const token of tokens) {
    const next = current ? `${current} ${token}` : token;
    if (next.length > budget && current) {
      lines.push(current);
      current = token;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Wraps math-step text to a pixel width WITHOUT destroying the model's own
 * line structure. `39 × 8\n        2  (carry 7)` is the model deliberately
 * separating the base equation from a carry annotation onto its own line —
 * the previous wrapToWidth() split on `/\s+/`, which treats `\n` as
 * ordinary whitespace and re-flows the whole string as one paragraph,
 * collapsing that into "39 × 8 2 (carry 7)". Reproduced against real model
 * output during the audio-replay audit; this is the fix.
 *
 * Explicit lines are split first and each is wrapped independently — a line
 * only grows a soft-wrap continuation if it alone doesn't fit the budget,
 * and an explicit blank line is preserved as a blank line rather than
 * dropped.
 */
export function wrapMathTextPreservingLines(text: string, size: number, maxWidth: number): WrappedMathText {
  const normalized = text.replace(/\r\n/g, "\n");
  const budget = Math.max(4, Math.floor((maxWidth - STEP_BOX_PAD_X) / (size * 0.55)));
  const rawLines = normalized.split("\n");
  const lines: string[] = [];
  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (!trimmed) {
      lines.push("");
      continue;
    }
    lines.push(...wrapLineTokens(tokenizeMathLine(trimmed), budget));
  }
  const finalLines = lines.length ? lines : [""];
  const longestLine = Math.max(1, ...finalLines.map((l) => l.length));
  const width = Math.min(maxWidth, Math.max(160, Math.round(longestLine * size * 0.55) + STEP_BOX_PAD_X));
  const lineHeight = size * 1.3;
  const height = Math.max(64, Math.round(finalLines.length * lineHeight) + 28);
  return { lines: finalLines, width, height };
}

/**
 * A boxed expression, coloured by verification state — the visible
 * "unverified" flag the brief asks for instead of confidently committing a
 * wrong step. Mirrors buildConceptNode in lib/ops.ts so a math step reads as
 * the same kind of object as any other concept box on the sheet.
 *
 * Width is capped at MAX_STEP_BOX_W and text wraps within it instead of the
 * box growing arbitrarily wide with the label — an unbounded width (the
 * previous behaviour) let one long equation run off the page edge and
 * crowd/overlap whatever the pen placed next to it.
 */
export const MATH_STEP_FONT_SIZE = 22;

/** Same measurement buildMathStepBox uses, exposed so a caller can check willOverflow() BEFORE placing — the pagination check the Scribe/diagram paths already do and math previously skipped. */
export function measureMathStepBox(label: string): { w: number; h: number } {
  const { width, height } = wrapMathTextPreservingLines(label, MATH_STEP_FONT_SIZE, MAX_STEP_BOX_W);
  return { w: width, h: height };
}

export async function buildMathStepBox(
  nodeId: string,
  label: string,
  verified: boolean,
  pen: Pen,
): Promise<BuiltMathStep | null> {
  const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
  const size = MATH_STEP_FONT_SIZE;
  const { lines, width: w, height: h } = wrapMathTextPreservingLines(label, size, MAX_STEP_BOX_W);
  const p = place(pen, w, h);
  const stroke = verified ? MATH_FILL : ACCENT;

  const elements = convertToExcalidrawElements([
    {
      id: nodeId,
      type: "rectangle",
      x: p.x,
      y: p.y,
      width: w,
      height: h,
      strokeColor: stroke,
      backgroundColor: "transparent",
      roughness: 2,
      strokeWidth: verified ? 1 : 2,
      strokeStyle: verified ? "solid" : "dashed",
      label: { text: lines.join("\n"), fontSize: size, fontFamily: HAND, strokeColor: INK },
    },
  ] as never) as unknown as SceneElement[];

  const node = elements.find((el) => el.type === "rectangle");
  if (!node) return null;
  return {
    elements,
    nodeId: node.id,
    mark: { key: label.trim().toLowerCase(), x: p.x, y: p.y, w, h, elementId: node.id },
  };
}

/** Visual box footprint. Fixed, so the pen can reserve space before drawing. */
export const VISUAL_W = 420;
export const VISUAL_H = 240;

/**
 * Most visuals have a fixed footprint; long_multiplication's grows with the
 * number of partial-product rows and explanation lines, so it needs its own
 * measurement before the pen reserves space — same reasoning as
 * buildMathStepBox's dynamic width/height.
 */
export function measureMathVisual(spec?: MathVisualSpec): { w: number; h: number } {
  if (spec?.type === "long_multiplication") return measureLongMultiplication(spec);
  return { w: VISUAL_W, h: VISUAL_H };
}

export async function buildMathVisual(
  spec: MathVisualSpec,
  pen: Pen,
): Promise<BuiltMathVisual | null> {
  const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
  const conv = (s: Record<string, unknown>[]) =>
    convertToExcalidrawElements(s as never) as unknown as SceneElement[];

  const { w, h } = measureMathVisual(spec);
  const p = place(pen, w, h, true);

  switch (spec.type) {
    case "number_line":
      return { elements: conv(numberLineSkeleton(spec, p.x, p.y, w, h)), w, h };
    case "balance_model":
      return { elements: conv(balanceModelSkeleton(spec, p.x, p.y, w, h)), w, h };
    case "fraction_bar":
      return { elements: conv(fractionBarSkeleton(spec, p.x, p.y, w, h)), w, h };
    case "counters":
      return { elements: conv(countersSkeleton(spec, p.x, p.y, w, h)), w, h };
    case "coordinate_axes":
      return { elements: conv(coordinateAxesSkeleton(spec, p.x, p.y, w, h)), w, h };
    case "table":
      return { elements: conv(tableSkeleton(spec, p.x, p.y, w, h)), w, h };
    case "long_multiplication":
      return { elements: conv(longMultiplicationSkeleton(spec, p.x, p.y, w, h)), w, h };
    default:
      return null;
  }
}

// --- number line ------------------------------------------------------------

function numberLineSkeleton(
  spec: Extract<MathVisualSpec, { type: "number_line" }>,
  x: number,
  y: number,
  w: number,
  h: number,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const padX = 20;
  const lineY = y + h / 2;
  const span = Math.max(1e-9, spec.max - spec.min);
  const toX = (v: number) => x + padX + ((v - spec.min) / span) * (w - padX * 2);

  out.push({ type: "line", x: toX(spec.min), y: lineY, points: [[0, 0], [toX(spec.max) - toX(spec.min), 0]], strokeColor: INK, strokeWidth: 2, roughness: 1 });

  const step = Math.max(1, Math.round(span / 10));
  for (let v = Math.ceil(spec.min / step) * step; v <= spec.max; v += step) {
    const tx = toX(v);
    out.push({ type: "line", x: tx, y: lineY - 8, points: [[0, 0], [0, 16]], strokeColor: SOFT, strokeWidth: 1, roughness: 1 });
    out.push({ type: "text", x: tx - 8, y: lineY + 14, text: String(v), fontSize: 14, fontFamily: HAND, strokeColor: SOFT });
  }

  for (const pt of spec.points) {
    const tx = toX(pt);
    out.push({ type: "ellipse", x: tx - 6, y: lineY - 6, width: 12, height: 12, strokeColor: ACCENT, backgroundColor: ACCENT, fillStyle: "solid", roughness: 1 });
  }

  if (spec.label) {
    out.push({ type: "text", x, y: y + 4, text: spec.label, fontSize: 16, fontFamily: HAND, strokeColor: INK });
  }
  return out;
}

// --- balance model -----------------------------------------------------------

/**
 * Both sides of an equation as counted groups on a beam — "two groups of x
 * plus four units, balanced against ten units", matching the worked example
 * in the brief (2x + 4 = 10).
 */
function balanceModelSkeleton(
  spec: Extract<MathVisualSpec, { type: "balance_model" }>,
  x: number,
  y: number,
  w: number,
  h: number,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const beamY = y + 40;
  const midX = x + w / 2;
  const panW = w / 2 - 30;

  out.push({ type: "line", x: x + 10, y: beamY, points: [[0, 0], [w - 20, 0]], strokeColor: INK, strokeWidth: 2, roughness: 1 });
  out.push({ type: "line", x: midX, y: beamY, points: [[0, 0], [0, -30]], strokeColor: INK, strokeWidth: 2, roughness: 1 });
  out.push({ type: "text", x: midX - 8, y: beamY - 50, text: "=", fontSize: 24, fontFamily: HAND, strokeColor: INK });

  const cell = 22;
  const gap = 6;

  // Left pan: leftGroups boxes labelled with the variable, then leftUnits dots.
  let cx = x + 20;
  const panY = beamY + 20;
  for (let g = 0; g < spec.leftGroups; g++) {
    out.push({
      type: "rectangle", x: cx, y: panY, width: cell, height: cell,
      strokeColor: MATH_FILL, backgroundColor: "transparent", roughness: 1, strokeWidth: 1,
      label: { text: spec.variableLabel, fontSize: 14, fontFamily: HAND, strokeColor: MATH_FILL },
    });
    cx += cell + gap;
  }
  for (let u = 0; u < Math.abs(spec.leftUnits); u++) {
    out.push({ type: "ellipse", x: cx, y: panY + 4, width: 14, height: 14, strokeColor: SOFT, backgroundColor: SOFT, fillStyle: "solid", roughness: 1 });
    cx += 14 + gap;
    if (cx > x + panW) { cx = x + 20; }
  }

  // Right pan: rightUnits dots.
  let rx = midX + 20;
  for (let u = 0; u < Math.abs(spec.rightUnits); u++) {
    out.push({ type: "ellipse", x: rx, y: panY + 4, width: 14, height: 14, strokeColor: SOFT, backgroundColor: SOFT, fillStyle: "solid", roughness: 1 });
    rx += 14 + gap;
    if (rx > x + w - 20) { rx = midX + 20; }
  }

  out.push({ type: "text", x, y: y + h - 24, text: `${spec.leftGroups} group${spec.leftGroups === 1 ? "" : "s"} of ${spec.variableLabel} + ${spec.leftUnits} = ${spec.rightUnits}`, fontSize: 14, fontFamily: HAND, strokeColor: SOFT });

  return out;
}

// --- fraction bar -------------------------------------------------------------

function oneFractionBar(
  numerator: number,
  denominator: number,
  x: number,
  y: number,
  w: number,
  barH: number,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const segW = w / denominator;
  for (let i = 0; i < denominator; i++) {
    out.push({
      type: "rectangle",
      x: x + i * segW,
      y,
      width: segW,
      height: barH,
      strokeColor: SOFT,
      backgroundColor: i < numerator ? MATH_FILL : "transparent",
      fillStyle: "solid",
      roughness: 1,
      strokeWidth: 1,
    });
  }
  return out;
}

function fractionBarSkeleton(
  spec: Extract<MathVisualSpec, { type: "fraction_bar" }>,
  x: number,
  y: number,
  w: number,
  h: number,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const barW = w - 40;
  const barH = 50;
  out.push(...oneFractionBar(spec.numerator, spec.denominator, x + 20, y + 20, barW, barH));
  out.push({
    type: "text", x: x + 20, y: y + 20 + barH + 8,
    text: `${spec.numerator}/${spec.denominator}`, fontSize: 16, fontFamily: HAND, strokeColor: INK,
  });

  if (spec.secondNumerator !== undefined && spec.secondDenominator) {
    out.push(...oneFractionBar(spec.secondNumerator, spec.secondDenominator, x + 20, y + 20 + barH + 40, barW, barH));
    out.push({
      type: "text", x: x + 20, y: y + 20 + barH + 40 + barH + 8,
      text: `${spec.secondNumerator}/${spec.secondDenominator}`, fontSize: 16, fontFamily: HAND, strokeColor: INK,
    });
  }
  if (spec.label) {
    out.push({ type: "text", x, y: y + 4, text: spec.label, fontSize: 16, fontFamily: HAND, strokeColor: INK });
  }
  return out;
}

// --- counters -----------------------------------------------------------------

function countersSkeleton(
  spec: Extract<MathVisualSpec, { type: "counters" }>,
  x: number,
  y: number,
  w: number,
  h: number,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const groupGap = 24;
  const dot = 14;
  const dotGap = 4;
  const groupW = spec.perGroup * (dot + dotGap);
  let gx = x + 10;
  const gy = y + 30;
  for (let g = 0; g < spec.groups; g++) {
    out.push({
      type: "rectangle", x: gx - 6, y: gy - 6, width: groupW + 4, height: dot + 12,
      strokeColor: SOFT, backgroundColor: "transparent", roughness: 1, strokeWidth: 1,
    });
    let dx = gx;
    for (let d = 0; d < spec.perGroup; d++) {
      out.push({ type: "ellipse", x: dx, y: gy, width: dot, height: dot, strokeColor: MATH_FILL, backgroundColor: MATH_FILL, fillStyle: "solid", roughness: 1 });
      dx += dot + dotGap;
    }
    gx += groupW + groupGap;
  }
  const label = spec.label ?? `${spec.groups} × ${spec.perGroup} = ${spec.groups * spec.perGroup}`;
  out.push({ type: "text", x, y: y + h - 24, text: label, fontSize: 14, fontFamily: HAND, strokeColor: SOFT });
  return out;
}

// --- coordinate axes -----------------------------------------------------------

function coordinateAxesSkeleton(
  spec: Extract<MathVisualSpec, { type: "coordinate_axes" }>,
  x: number,
  y: number,
  w: number,
  h: number,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const padX = 24;
  const padY = 24;
  const spanX = Math.max(1e-9, spec.xMax - spec.xMin);
  const spanY = Math.max(1e-9, spec.yMax - spec.yMin);
  const toPx = (px: number, py: number) => ({
    x: x + padX + ((px - spec.xMin) / spanX) * (w - padX * 2),
    // Screen y grows downward; math y grows upward.
    y: y + padY + (1 - (py - spec.yMin) / spanY) * (h - padY * 2),
  });

  const origin = toPx(0, 0);
  const xAxisY = Math.min(Math.max(origin.y, y + padY), y + h - padY);
  const yAxisX = Math.min(Math.max(origin.x, x + padX), x + w - padX);

  out.push({ type: "line", x: x + padX, y: xAxisY, points: [[0, 0], [w - padX * 2, 0]], strokeColor: SOFT, strokeWidth: 1, roughness: 1 });
  out.push({ type: "line", x: yAxisX, y: y + padY, points: [[0, 0], [0, h - padY * 2]], strokeColor: SOFT, strokeWidth: 1, roughness: 1 });

  for (const pt of spec.points) {
    const px = toPx(pt.x, pt.y);
    out.push({ type: "ellipse", x: px.x - 5, y: px.y - 5, width: 10, height: 10, strokeColor: ACCENT, backgroundColor: ACCENT, fillStyle: "solid", roughness: 1 });
  }

  if (spec.line) {
    const { slope, intercept } = spec.line;
    const yAtXMin = slope * spec.xMin + intercept;
    const yAtXMax = slope * spec.xMax + intercept;
    const a = toPx(spec.xMin, Math.min(Math.max(yAtXMin, spec.yMin), spec.yMax));
    const b = toPx(spec.xMax, Math.min(Math.max(yAtXMax, spec.yMin), spec.yMax));
    out.push({ type: "line", x: a.x, y: a.y, points: [[0, 0], [b.x - a.x, b.y - a.y]], strokeColor: MATH_FILL, strokeWidth: 2, roughness: 1 });
  }

  if (spec.label) {
    out.push({ type: "text", x, y: y + h - 4, text: spec.label, fontSize: 14, fontFamily: HAND, strokeColor: SOFT });
  }
  return out;
}

// --- table -----------------------------------------------------------------

function tableSkeleton(
  spec: Extract<MathVisualSpec, { type: "table" }>,
  x: number,
  y: number,
  w: number,
  h: number,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const cols = spec.headers.length;
  const colW = w / cols;
  const rowH = Math.min(36, h / (spec.rows.length + 1));

  spec.headers.forEach((header, c) => {
    out.push({
      type: "rectangle", x: x + c * colW, y, width: colW, height: rowH,
      strokeColor: INK, backgroundColor: "transparent", roughness: 1, strokeWidth: 1,
      label: { text: header, fontSize: 14, fontFamily: HAND, strokeColor: INK },
    });
  });

  spec.rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      out.push({
        type: "rectangle", x: x + c * colW, y: y + (r + 1) * rowH, width: colW, height: rowH,
        strokeColor: SOFT, backgroundColor: "transparent", roughness: 1, strokeWidth: 1,
        label: { text: cell, fontSize: 13, fontFamily: HAND, strokeColor: SOFT },
      });
    });
  });

  return out;
}

// --- long multiplication -----------------------------------------------------
//
// Digits are placed one character per text element, each in a fixed-width
// cell keyed by place-value column — never as one string relying on space
// padding for alignment. Excalifont is proportional; a padded string like
// "        2  (carry 7)" has no reliable relationship between character
// count and pixel position, so it can't actually align a carry over the
// digit it belongs to. A fixed cell grid sidesteps font metrics entirely:
// every digit at column c sits at the same x regardless of what glyph it is.

type LongMultiplicationSpec = Extract<MathVisualSpec, { type: "long_multiplication" }>;

const ALGO_SIZE = 26;
const ALGO_DIGIT_W = 20;
const CARRY_SIZE = 13;
const EXPL_SIZE = 14;
const ALGO_ROW_H = 34;
const ALGO_ROW_GAP = 6;
const ALGO_PAD = 20;
const ALGO_MAX_W = 460;

export function digitsOf(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

/** How many place-value columns a value spans, given where its rightmost digit is anchored. */
function columnSpan(value: string, anchorColumn: number): number {
  return anchorColumn + Math.max(1, digitsOf(value).length);
}

/**
 * Places `value`'s digits right-to-left, one text element per character, so
 * column c always lands at the same x regardless of font metrics — exported
 * so alignment itself (not just the full Excalidraw-dependent render) is
 * unit-testable without a browser.
 */
export function placeDigitsAtColumn(
  value: string,
  anchorColumn: number,
  rightEdge: number,
  y: number,
  size: number,
  color: string,
): Record<string, unknown>[] {
  const cellW = ALGO_DIGIT_W * (size / ALGO_SIZE);
  const chars = value.split("");
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < chars.length; i++) {
    const fromRight = chars.length - 1 - i;
    const col = anchorColumn + fromRight;
    const cx = rightEdge - (col + 1) * cellW;
    out.push({ type: "text", x: cx, y, text: chars[i], fontSize: size, fontFamily: HAND, strokeColor: color });
  }
  return out;
}

function longMultiplicationColumns(spec: LongMultiplicationSpec): number {
  return Math.max(
    digitsOf(spec.multiplicand).length,
    digitsOf(spec.multiplier).length,
    digitsOf(spec.result).length,
    ...spec.carries.map((c) => c.column + 1),
    ...spec.partialProducts.map((p) => columnSpan(p.value, p.shift)),
    1,
  );
}

export function measureLongMultiplication(spec: LongMultiplicationSpec): { w: number; h: number } {
  const cellW = ALGO_DIGIT_W;
  const columns = longMultiplicationColumns(spec);
  const gridW = columns * cellW;
  const symbolAllowance = ALGO_DIGIT_W * 2; // room for the "×" to the left of the grid
  const w = Math.min(ALGO_MAX_W, Math.max(200, ALGO_PAD * 2 + symbolAllowance + gridW));

  const explanationLines = spec.partialProducts.filter((p) => p.explanation).length;
  const rows =
    1 + // multiplicand
    1 + // × multiplier (+ rule under it)
    (spec.carries.length ? 1 : 0) +
    Math.max(1, spec.partialProducts.length) +
    (spec.partialProducts.length > 1 ? 1 : 0) + // rule above the sum
    1; // result
  const h = ALGO_PAD * 2 + rows * (ALGO_ROW_H + ALGO_ROW_GAP) + explanationLines * (EXPL_SIZE + 6) + 8;
  return { w, h: Math.max(160, h) };
}

/**
 * Renders the standard long-multiplication algorithm as separate,
 * column-aligned rows: multiplicand, multiplier (with a rule beneath),
 * carries as small annotations above the column they were carried into,
 * each partial product right-aligned at its place-value shift, and the
 * final result in a visually distinct row. The model supplies the
 * structure (which digits, which columns); every coordinate here is
 * computed, never emitted by the model.
 */
function longMultiplicationSkeleton(
  spec: LongMultiplicationSpec,
  x: number,
  y: number,
  w: number,
  h: number,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const rightEdge = x + w - ALGO_PAD;
  let cy = y + ALGO_PAD;

  // Carries sit above the multiplicand row, each over its own column.
  if (spec.carries.length) {
    for (const carry of spec.carries) {
      out.push(...placeDigitsAtColumn(carry.value, carry.column, rightEdge, cy, CARRY_SIZE, ACCENT));
    }
    cy += ALGO_ROW_H * 0.55;
  }

  // Multiplicand.
  out.push(...placeDigitsAtColumn(spec.multiplicand, 0, rightEdge, cy, ALGO_SIZE, INK));
  cy += ALGO_ROW_H;

  // "× multiplier" — the × symbol sits left of the digit grid, not inside it.
  const multiplierCols = digitsOf(spec.multiplier).length;
  const cellW = ALGO_DIGIT_W;
  out.push({
    type: "text",
    x: rightEdge - (multiplierCols + 1.6) * cellW,
    y: cy,
    text: "×",
    fontSize: ALGO_SIZE,
    fontFamily: HAND,
    strokeColor: SOFT,
  });
  out.push(...placeDigitsAtColumn(spec.multiplier, 0, rightEdge, cy, ALGO_SIZE, INK));
  cy += ALGO_ROW_H;

  // Rule under the multiplier — closes off the "inputs" section.
  out.push({
    type: "line",
    x: x + ALGO_PAD * 0.5,
    y: cy,
    points: [[0, 0], [w - ALGO_PAD, 0]],
    strokeColor: SOFT,
    strokeWidth: 1.5,
    roughness: 1,
  });
  cy += ALGO_ROW_GAP + 6;

  // Partial products, each right-aligned at its own shift — the standard
  // algorithm's per-row leftward step, never split across boxes.
  const products = spec.partialProducts.length
    ? spec.partialProducts
    : [{ value: spec.result, shift: 0, explanation: undefined }];
  const explanations: string[] = [];
  for (const product of products) {
    out.push(...placeDigitsAtColumn(product.value, product.shift, rightEdge, cy, ALGO_SIZE, MATH_FILL));
    if (product.explanation) explanations.push(product.explanation);
    cy += ALGO_ROW_H;
  }

  if (spec.partialProducts.length > 1) {
    out.push({
      type: "line",
      x: x + ALGO_PAD * 0.5,
      y: cy,
      points: [[0, 0], [w - ALGO_PAD, 0]],
      strokeColor: SOFT,
      strokeWidth: 1.5,
      roughness: 1,
    });
    cy += ALGO_ROW_GAP + 6;
  }

  // Final answer — a distinct row: bordered box behind the digits, not just
  // another line of the same size/colour as the working.
  const resultDigits = digitsOf(spec.result).length || 1;
  const resultBoxW = resultDigits * cellW + 16;
  out.push({
    type: "rectangle",
    x: rightEdge - resultBoxW + 8,
    y: cy - 6,
    width: resultBoxW,
    height: ALGO_ROW_H + 4,
    strokeColor: MATH_FILL,
    backgroundColor: "transparent",
    roughness: 1,
    strokeWidth: 2,
  });
  out.push(...placeDigitsAtColumn(spec.result, 0, rightEdge, cy, ALGO_SIZE, MATH_FILL));
  cy += ALGO_ROW_H + ALGO_ROW_GAP;

  // Explanations, below the algorithm — kept to the box's own width via the
  // same line-preserving wrap the equation boxes use, rather than running
  // past the page edge.
  for (const explanation of explanations) {
    const { lines } = wrapMathTextPreservingLines(explanation, EXPL_SIZE, w);
    for (const line of lines) {
      out.push({ type: "text", x: x + ALGO_PAD * 0.5, y: cy, text: line, fontSize: EXPL_SIZE, fontFamily: HAND, strokeColor: SOFT });
      cy += EXPL_SIZE + 6;
    }
  }

  return out;
}
