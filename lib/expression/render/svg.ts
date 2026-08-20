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
 * lib/expression/render/excalidraw.ts cannot quietly start making semantic
 * decisions — anything it needs that ScenePlan does not carry is
 * immediately visible as a difference between the two outputs.
 *
 * Colour is intentionally absent. Everything is drawn in `currentColor` at
 * varying stroke weight, so the visual hierarchy the composer built out of
 * size and weight is the only hierarchy there is, and it survives a
 * greyscale print and a dark theme without a palette.
 */

import type { RenderPatch, Renderer, ScenePlan, SceneConnector, SceneObject } from "../schemas";
import type { Sketch } from "../draw/schemas";

const STROKE_FOR_WEIGHT: Record<number, number> = { 0: 1.25, 1: 1.75, 2: 2.25, 3: 3 };
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
  return lines.map((line, i) => text(line, cx, y + i * (size + 3), size, object.weight >= 2 ? 600 : 500)).join("");
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
function renderSketch(sketch: Sketch, x: number, y: number, w: number, h: number, stroke: number): string {
  const inset = Math.min(w, h) * 0.16;
  const boxW = w - inset * 2;
  const boxH = h - inset * 2;
  const sx = (px: number) => x + inset + (px / 100) * boxW;
  const sy = (py: number) => y + inset + (py / 100) * boxH;
  return sketch.strokes
    .map((s) => {
      const d = s.points.map(([px, py], i) => `${i === 0 ? "M" : "L"} ${sx(px).toFixed(1)} ${sy(py).toFixed(1)}`).join(" ");
      return `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join("");
}

function renderObject(object: SceneObject, sketches?: Map<string, Sketch>): string {
  const stroke = STROKE_FOR_WEIGHT[object.weight] ?? 1.75;
  const { x, y, w, h } = object;
  const cx = x + w / 2;
  const fontSize = object.weight >= 2 ? 16 : 14;

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
      const sketch = object.sketchKey ? sketches?.get(object.sketchKey) : undefined;
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
      const sketch = object.sketchKey ? sketches?.get(object.sketchKey) : undefined;
      const mark = sketch
        ? renderSketch(sketch, x, y, w, h * 0.7, stroke)
        : `<ellipse cx="${cx}" cy="${y + h * 0.38}" rx="${w * 0.4}" ry="${h * 0.28}" fill="none" stroke="currentColor" stroke-width="${stroke}"/>`;
      return mark + label(object, cx, y + h - 6, fontSize);
    }

    case "moment": {
      // A beat in time: a soft-cornered band, or the Drawing Agent's icon when one is cached.
      const sketch = object.sketchKey ? sketches?.get(object.sketchKey) : undefined;
      const mark = sketch ? renderSketch(sketch, x, y, w, h * 0.72, stroke) : roundedRect(x, y, w, h, h / 2, stroke);
      return mark + label(object, cx, y + h / 2 + 5, fontSize);
    }

    case "text_label":
      return label(object, cx, y + 18, 13);

    case "node":
    default: {
      const sketch = object.sketchKey ? sketches?.get(object.sketchKey) : undefined;
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

  if (connector.style === "bracket") {
    return `<path d="M ${x1} ${y1} L ${mid[0]} ${mid[1]} L ${x2} ${y2}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 5"/>${labelSvg}`;
  }
  if (connector.style === "none") return labelSvg;

  const arrow = connector.style === "arrow" ? ` marker-end="url(#ip-arrow)"` : "";
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"${arrow}/>${labelSvg}`;
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
      ...scene.connectors.map(renderConnector),
      ...objects.map((object) => {
        const inner = renderObject(object, sketches);
        const isNew = this.options.markNew && added.has(object.id);
        return `<g data-object-id="${object.id}"${object.entityId ? ` data-entity-id="${object.entityId}"` : ""}${isNew ? ' class="ip-new"' : ""}>${inner}</g>`;
      }),
    ].join("");

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.width} ${scene.height}" width="${scene.width}" height="${scene.height}" role="img">${ARROW_MARKER}${body}</svg>`;
  }
}

export const svgRenderer = new SvgRenderer({ markNew: true });
