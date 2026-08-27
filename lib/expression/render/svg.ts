/**
 * SVG renderer — the reference implementation of the Renderer interface.
 *
 * Deliberately the FIRST renderer rather than Excalidraw. It is pure
 * (ScenePlan in, string out), has no editor, no async import and no canvas,
 * so the whole engine can be exercised and asserted on in a plain Node test
 * with no browser and no network. If a picture is wrong, this renderer
 * proves whether the wrongness is in the meaning or in the drawing.
 *
 * It also keeps the abstraction honest: an interface with one
 * implementation is a guess, and this one exists specifically so that
 * lib/canvas/excalidraw/conversion.ts cannot quietly start making semantic
 * decisions — anything it needs that ScenePlan does not carry is
 * immediately visible as a difference between the two outputs.
 *
 * Colour is intentionally absent. Everything is drawn in `currentColor` at
 * varying stroke weight, so the visual hierarchy the composer built out of
 * size and weight is the only hierarchy there is, and it survives a
 * greyscale print and a dark theme without a palette.
 */

import type { RenderPatch, Renderer, ScenePlan, SceneConnector, SceneObject, WorldMetric } from "../schemas";
import { sketchLooksAbstract, type Sketch } from "../draw/schemas";
import { formatMetricPoint } from "./metricFormat";

const STROKE_FOR_WEIGHT: Record<number, number> = { 0: 1.1, 1: 1.75, 2: 2.5, 3: 3.75 };
const FONT_FOR_WEIGHT: Record<number, number> = { 0: 12, 1: 14, 2: 18, 3: 22 };
const FONT = "ui-sans-serif, system-ui, 'Segoe UI', sans-serif";

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Splits a label across at most two lines so a long name never overflows its mark. */
function wrap(label: string, maxChars: number): string[] {
  if (label.length <= maxChars) return [label];
  const words = label.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) current = word;
    else if ((current + " " + word).length <= maxChars) current += " " + word;
    else {
      lines.push(current);
      current = word;
    }
    if (lines.length === 2) break;
  }
  if (current && lines.length < 2) lines.push(current);
  return lines.slice(0, 2);
}

function text(content: string, cx: number, y: number, size: number, weight = 500): string {
  return `<text x="${cx}" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="currentColor">${escapeText(content)}</text>`;
}

function label(object: SceneObject, cx: number, y: number, size: number): string {
  if (!object.label) return "";
  const lines = wrap(object.label, Math.max(10, Math.floor(object.w / (size * 0.55))));
  return lines.map((line, i) => text(line, cx, y + i * (size + 3), size, object.weight >= 3 ? 700 : object.weight <= 0 ? 400 : 500)).join("");
}

// ─────────────────────────────────────────────────────────── metrics

const DIRECTION_ARROW: Record<"increase" | "decrease" | "flat", string> = { increase: "↑", decrease: "↓", flat: "→" };

/** metric_value: a single number, or a before -> after pair read inline — the "single value" and "before/after" shapes from one primitive. */
function metricValue(object: SceneObject, metric: WorldMetric, x: number, y: number, w: number, h: number, stroke: number, fontSize: number): string {
  const cx = x + w / 2;
  const points = metric.history;
  const parts: string[] = [];
  if (points.length <= 1) {
    const value = points[0] ? formatMetricPoint(points[0], metric) : "—";
    parts.push(text(value, cx, y + h * 0.42, fontSize + 8, 700));
    const badge =
      metric.direction && !metric.changePercent
        ? DIRECTION_ARROW[metric.direction]
        : metric.changePercent !== undefined
          ? `${metric.changePercent > 0 ? "↑" : metric.changePercent < 0 ? "↓" : "→"} ${Math.abs(Math.round(metric.changePercent))}%`
          : "";
    if (badge) parts.push(text(badge, cx, y + h * 0.42 + fontSize + 6, fontSize - 1, 600));
  } else {
    const [before, after] = [points[points.length - 2], points[points.length - 1]];
    parts.push(text(`${formatMetricPoint(before, metric)}  →  ${formatMetricPoint(after, metric)}`, cx, y + h * 0.42, fontSize + 2, 700));
    const pct =
      metric.changePercent !== undefined
        ? metric.changePercent
        : before.value !== 0
          ? ((after.value - before.value) / Math.abs(before.value)) * 100
          : undefined;
    if (pct !== undefined) {
      const arrow = pct > 0 ? "↑" : pct < 0 ? "↓" : "→";
      parts.push(text(`${arrow} ${Math.abs(Math.round(pct))}%`, cx, y + h * 0.42 + fontSize + 8, fontSize - 1, 600));
    }
  }
  return roundedRect(x, y, w, h, 10, stroke) + parts.join("") + label(object, cx, y + h - 4, fontSize - 2);
}

/** metric_series: an ordered run of 3+ points as simple bars — extent for MEASUREMENTS, the same "the marks are the number" idea quantity_array already uses for counted things. */
function metricSeries(object: SceneObject, metric: WorldMetric, x: number, y: number, w: number, h: number, stroke: number, fontSize: number): string {
  const points = metric.history;
  const chartTop = y + 12;
  const chartBottom = y + h - 30;
  const chartH = Math.max(chartBottom - chartTop, 10);
  const values = points.map((p) => p.value);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const gap = 10;
  const barW = Math.max(12, (w - 24 - gap * (points.length - 1)) / points.length);
  const startX = x + (w - (barW * points.length + gap * (points.length - 1))) / 2;

  const bars = points
    .map((p, i) => {
      const bx = startX + i * (barW + gap);
      const barH = Math.max(2, ((p.value - min) / span) * chartH);
      const by = chartBottom - barH;
      return [
        `<rect x="${bx}" y="${by}" width="${barW}" height="${barH}" rx="2" fill="none" stroke="currentColor" stroke-width="${Math.max(1.25, stroke - 0.5)}"${p.approximate ? ` stroke-dasharray="3 3"` : ""}/>`,
        text(formatMetricPoint(p, metric), bx + barW / 2, by - 6, fontSize - 3, 600),
        p.label ? text(p.label, bx + barW / 2, chartBottom + 14, fontSize - 4, 500) : "",
      ].join("");
    })
    .join("");

  return `<line x1="${x + 8}" y1="${chartBottom}" x2="${x + w - 8}" y2="${chartBottom}" stroke="currentColor" stroke-width="1"/>` +
    bars +
    label(object, x + w / 2, y + h - 4, fontSize - 2);
}

/** metric_gauge: current filled against a stated target — the one shape that IS a comparison against a threshold, not a value. */
function metricGauge(object: SceneObject, metric: WorldMetric, x: number, y: number, w: number, h: number, stroke: number, fontSize: number): string {
  const cx = x + w / 2;
  const current = metric.history[metric.history.length - 1];
  const target = metric.target;
  const trackX = x + 16;
  const trackW = w - 32;
  const trackY = y + h * 0.42;
  const trackH = 22;
  const ratio = current && target && target.value !== 0 ? Math.max(0, current.value / target.value) : 0;
  const fillW = Math.min(1, ratio) * trackW;
  const met = ratio >= 1;

  const parts = [
    target ? text(`target ${formatMetricPoint(target, metric)}`, cx, trackY - 10, fontSize - 3, 600) : "",
    `<rect x="${trackX}" y="${trackY}" width="${trackW}" height="${trackH}" rx="4" fill="none" stroke="currentColor" stroke-width="${stroke}"/>`,
    fillW > 0
      ? `<rect x="${trackX}" y="${trackY}" width="${fillW}" height="${trackH}" rx="4" fill="currentColor" opacity="${met ? 0.85 : 0.45}"/>`
      : "",
    // The target line sits at the track's own right edge (100% of target) —
    // drawn explicitly so "the bar reaches the line" reads as "met the
    // target" even when current overshoots and the fill itself is clipped.
    `<line x1="${trackX + trackW}" y1="${trackY - 6}" x2="${trackX + trackW}" y2="${trackY + trackH + 6}" stroke="currentColor" stroke-width="${stroke}"/>`,
    current
      ? text(formatMetricPoint(current, metric), cx, trackY + trackH + 22, fontSize, 700)
      : text("—", cx, trackY + trackH + 22, fontSize, 700),
    !met && target && current
      ? text(`gap: ${formatMetricPoint({ value: Math.abs(target.value - current.value) }, metric)}`, cx, trackY + trackH + 22 + fontSize + 4, fontSize - 4, 500)
      : "",
  ];
  return parts.join("") + label(object, cx, y + 12, fontSize - 2);
}

/**
 * One human figure: head and shoulders. Drawn as geometry rather than an
 * icon lookup, because the primitive is chosen from the entity's TYPE — the
 * renderer must be able to draw a person it has never seen a name for.
 */
function figure(x: number, y: number, w: number, h: number, stroke: number): string {
  const cx = x + w / 2;
  const headR = Math.min(w, h) * 0.22;
  const headCy = y + headR + h * 0.06;
  const bodyTop = headCy + headR + h * 0.05;
  const bodyBottom = y + h * 0.92;
  const shoulder = w * 0.34;
  return [
    `<circle cx="${cx}" cy="${headCy}" r="${headR}" fill="none" stroke="currentColor" stroke-width="${stroke}"/>`,
    `<path d="M ${cx - shoulder} ${bodyBottom} Q ${cx - shoulder} ${bodyTop} ${cx} ${bodyTop} Q ${cx + shoulder} ${bodyTop} ${cx + shoulder} ${bodyBottom}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round"/>`,
  ].join("");
}

function roundedRect(x: number, y: number, w: number, h: number, r: number, stroke: number, dash?: string): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="none" stroke="currentColor" stroke-width="${stroke}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
}

/**
 * Scales a Sketch's normalized 0-100 strokes into one object's actual box,
 * inset so the icon never touches the edge it shares with its label. The
 * renderer only draws what it is given — the strokes themselves came from
 * the Drawing Agent (lib/expression/draw/), resolved before render ever runs.
 */
/** How long one stroke takes to draw in, and the gap before the next one starts. Both in ms. */
const STROKE_DRAW_MS = 220;
const STROKE_STAGGER_MS = 55;

/**
 * Scales a Sketch's normalized 0-100 strokes into one object's actual box,
 * inset so the icon never touches the edge it shares with its label, and
 * reveals them in the order the Drawing Agent listed them — contour first,
 * detail after — one at a time, the way the strokes were drawn rather than
 * all at once. `pathLength="1"` makes the dash-based draw-in independent of
 * each path's real length, so the same CSS animation (defined once in
 * app/dev/express/express.css) works for a two-point line and a twelve-point
 * curve alike. The renderer only draws what it is given — the strokes
 * themselves came from the Drawing Agent (lib/expression/draw/), resolved
 * before render ever runs.
 */
function renderSketch(sketch: Sketch, x: number, y: number, w: number, h: number, stroke: number): string {
  const inset = Math.min(w, h) * 0.16;
  const boxW = w - inset * 2;
  const boxH = h - inset * 2;
  const sx = (px: number) => x + inset + (px / 100) * boxW;
  const sy = (py: number) => y + inset + (py / 100) * boxH;
  return sketch.strokes
    .map((s, i) => {
      const d = s.points.map(([px, py], j) => `${j === 0 ? "M" : "L"} ${sx(px).toFixed(1)} ${sy(py).toFixed(1)}`).join(" ");
      const delay = (i * STROKE_STAGGER_MS).toFixed(0);
      return `<path d="${d}" pathLength="1" class="ip-sketch-stroke" style="animation-delay:${delay}ms" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join("");
}

function usableSketch(object: SceneObject, sketches?: Map<string, Sketch>): Sketch | undefined {
  if (!object.sketchKey) return undefined;
  const sketch = sketches?.get(object.sketchKey);
  if (!sketch || sketchLooksAbstract(sketch)) return undefined;
  return sketch;
}

function renderObject(object: SceneObject, sketches?: Map<string, Sketch>): string {
  const stroke = STROKE_FOR_WEIGHT[object.weight] ?? 1.75;
  const { x, y, w, h } = object;
  const cx = x + w / 2;
  const fontSize = FONT_FOR_WEIGHT[object.weight] ?? 14;

  switch (object.primitive) {
    case "figure":
      return figure(x, y, w, h * 0.78, stroke) + label(object, cx, y + h - 4, fontSize);

    case "figure_group": {
      // The count IS the quantity — no number is written alongside it.
      const count = object.count ?? 3;
      const each = Math.min(48, (w - 24) / count);
      const startX = cx - (count * each) / 2;
      const marks = Array.from({ length: count }, (_, i) =>
        figure(startX + i * each, y, each, h * 0.72, Math.max(1.25, stroke - 0.5)),
      ).join("");
      return marks + label(object, cx, y + h - 2, fontSize);
    }

    case "place_marker": {
      // A ground line with a marker standing on it — a location, not a flag.
      const baseY = y + h * 0.72;
      const pinR = h * 0.14;
      return [
        `<path d="M ${x + 12} ${baseY} Q ${cx} ${baseY + 14} ${x + w - 12} ${baseY}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round"/>`,
        `<circle cx="${cx}" cy="${baseY - pinR * 2.2}" r="${pinR}" fill="none" stroke="currentColor" stroke-width="${stroke}"/>`,
        `<line x1="${cx}" y1="${baseY - pinR}" x2="${cx}" y2="${baseY}" stroke="currentColor" stroke-width="${stroke}"/>`,
        label(object, cx, y + h - 2, fontSize),
      ].join("");
    }

    case "object_glyph": {
      const sketch = usableSketch(object, sketches);
      const mark = sketch ? renderSketch(sketch, x, y, w, h * 0.7, stroke) : roundedRect(x, y, w, h * 0.7, 8, stroke);
      return mark + label(object, cx, y + h - 2, fontSize);
    }

    case "container": {
      // Title in the header band; the boundary itself states containment.
      const title = object.label ? text(object.label, cx, y + 30, fontSize + 1, 600) : "";
      return roundedRect(x, y, w, h, 16, stroke) + title;
    }

    case "quantity_array": {
      const count = object.count ?? 1;
      const size = Math.min(26, (w - 24) / count);
      const startX = cx - (count * size) / 2;
      const topY = y + 8;
      const marks = Array.from(
        { length: count },
        (_, i) => `<rect x="${startX + i * size + 3}" y="${topY}" width="${size - 6}" height="${size - 6}" rx="3" fill="none" stroke="currentColor" stroke-width="${Math.max(1.25, stroke - 0.5)}"/>`,
      ).join("");
      return marks + label(object, cx, topY + size + 22, fontSize);
    }

    case "state_marker": {
      const sketch = usableSketch(object, sketches);
      const mark = sketch
        ? renderSketch(sketch, x, y, w, h * 0.7, stroke)
        : `<ellipse cx="${cx}" cy="${y + h * 0.38}" rx="${w * 0.4}" ry="${h * 0.28}" fill="none" stroke="currentColor" stroke-width="${stroke}"/>`;
      return mark + label(object, cx, y + h - 6, fontSize);
    }

    case "moment": {
      // A beat in time: a soft-cornered band, or the Drawing Agent's icon when one is cached.
      const sketch = usableSketch(object, sketches);
      const mark = sketch ? renderSketch(sketch, x, y, w, h * 0.72, stroke) : roundedRect(x, y, w, h, h / 2, stroke);
      return mark + label(object, cx, y + h / 2 + 5, fontSize);
    }

    case "text_label":
      return label(object, cx, y + 18, 13);

    case "metric_value":
      return object.metric ? metricValue(object, object.metric, x, y, w, h, stroke, fontSize) : roundedRect(x, y, w, h, 10, stroke) + label(object, cx, y + h / 2 + 5, fontSize);

    case "metric_series":
      return object.metric ? metricSeries(object, object.metric, x, y, w, h, stroke, fontSize) : roundedRect(x, y, w, h, 10, stroke) + label(object, cx, y + h / 2 + 5, fontSize);

    case "metric_gauge":
      return object.metric ? metricGauge(object, object.metric, x, y, w, h, stroke, fontSize) : roundedRect(x, y, w, h, 10, stroke) + label(object, cx, y + h / 2 + 5, fontSize);

    case "node":
    default: {
      const sketch = usableSketch(object, sketches);
      const mark = sketch ? renderSketch(sketch, x, y, w, h * 0.72, stroke) : roundedRect(x, y, w, h, 10, stroke);
      return mark + label(object, cx, y + h / 2 + 5, fontSize);
    }
  }
}

function renderConnector(connector: SceneConnector): string {
  if (connector.style === "none" && !connector.label) return "";
  const [[x1, y1], [x2, y2]] = [connector.points[0], connector.points[connector.points.length - 1]];
  const mid = [(x1 + x2) / 2, (y1 + y2) / 2];
  const labelSvg = connector.label ? text(connector.label, mid[0], mid[1] - 6, 12, 500) : "";

  if (connector.style === "tension") {
    // Every point, not just the ends — the zigzag the composer routed IS the
    // mark. Same stroke weight as a plain line: it is a different KIND of
    // connection, not a louder one.
    const d = connector.points.map(([px, py], i) => `${i === 0 ? "M" : "L"} ${px} ${py}`).join(" ");
    return `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>${labelSvg}`;
  }
  if (connector.style === "bracket") {
    return `<path d="M ${x1} ${y1} L ${mid[0]} ${mid[1]} L ${x2} ${y2}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 5"/>${labelSvg}`;
  }
  if (connector.style === "none") return labelSvg;

  const arrow = connector.style === "arrow" ? ` marker-end="url(#ip-arrow)"` : "";
  const width = connector.style === "arrow" ? 2.4 : 1.6;
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-width="${width}" stroke-linecap="round"${arrow}/>${labelSvg}`;
}

const ARROW_MARKER = `<defs><marker id="ip-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>`;

export interface SvgRenderOptions {
  /** Marks objects the patch just added with a subtle entrance class, so a live view can animate them. */
  markNew?: boolean;
}

export class SvgRenderer implements Renderer<string> {
  readonly name = "svg";

  private readonly options: SvgRenderOptions;

  constructor(options: SvgRenderOptions = {}) {
    this.options = options;
  }

  render(scene: ScenePlan, patch: RenderPatch, sketches?: Map<string, Sketch>): string {
    if (!scene.objects.length) {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 120" width="400" height="120"></svg>`;
    }
    const added = new Set(patch.added.map((o) => o.id));

    // Containers first, so their children draw on top of the boundary.
    const objects = [...scene.objects].sort((a, b) => {
      if (a.primitive === "container" && b.primitive !== "container") return -1;
      if (b.primitive === "container" && a.primitive !== "container") return 1;
      return a.weight - b.weight;
    });

    const body = [
      ...scene.connectors.map((connector) => {
        const inner = renderConnector(connector);
        if (!inner) return inner;
        // Hypothetical/hedged relations ("if someone offered us $500K, I'd
        // reconsider") get the same dashed-and-faint treatment as their
        // endpoints — stroke-dasharray and opacity are inherited SVG
        // presentation properties, so wrapping is enough; no draw function
        // needs to know about tentativeness itself.
        return connector.tentative ? `<g stroke-dasharray="5 4" opacity="0.55">${inner}</g>` : inner;
      }),
      ...objects.map((object) => {
        const inner = renderObject(object, sketches);
        const isNew = this.options.markNew && added.has(object.id);
        const classes = [isNew ? "ip-new" : "", object.tentative ? "ip-tentative" : ""].filter(Boolean).join(" ");
        const tentativeAttrs = object.tentative ? ' stroke-dasharray="5 4" opacity="0.55"' : "";
        const lightAttrs = !object.tentative && object.weight <= 0 ? ' opacity="0.5"' : "";
        return `<g data-object-id="${object.id}"${object.entityId ? ` data-entity-id="${object.entityId}"` : ""}${classes ? ` class="${classes}"` : ""}${tentativeAttrs}${lightAttrs}>${inner}</g>`;
      }),
    ].join("");

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.width} ${scene.height}" width="${scene.width}" height="${scene.height}" role="img">${ARROW_MARKER}${body}</svg>`;
  }
}

export const svgRenderer = new SvgRenderer({ markNew: true });
