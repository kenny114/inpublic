/**
 * Excalidraw renderer.
 *
 * The second implementation of the Renderer interface, and deliberately not
 * the first. Everything it needs it takes from the ScenePlan; it makes no
 * semantic decisions, chooses no layout, and never looks at the world, the
 * intent or the plan. If it ever needs something ScenePlan does not carry,
 * that is a signal the composer is under-specifying the scene — not a
 * licence for this file to decide.
 *
 * Element ids are derived from SceneObject ids, which are derived from
 * region ids, which are derived from entity ids. That chain is what lets a
 * live board patch itself: the box for an entity mentioned ten minutes ago
 * is findable by id, so a later sentence moves it instead of drawing a
 * second one. It is the same "semantic id ↔ canvas id" pairing
 * lib/meaning/apply.ts uses, reached here through the scene rather than
 * through the semantic state directly.
 *
 * Async because @excalidraw/excalidraw is a browser-only ESM package that
 * must be imported dynamically; the SVG renderer stays synchronous and is
 * what tests use.
 */

import type { SceneElement } from "../../scene";
import { sketchLooksAbstract, type Sketch } from "../../expression/draw/schemas";
import type { RenderPatch, Renderer, ScenePlan, SceneConnector, SceneObject } from "../../expression/schemas";
import { formatMetricPoint } from "../../expression/render/metricFormat";

/**
 * Excalidraw's own vocabulary. Weight becomes stroke width, exactly as in
 * the SVG renderer, so the two agree.
 *
 * Weight 3 is what the round is ABOUT and used to be indistinguishable from
 * weight 2 here — same stroke, same font — so on the live board the thing
 * that had just been said looked exactly like the thing that had been on the
 * canvas for ten minutes. The SVG renderer had always separated them
 * (STROKE_FOR_WEIGHT tops out at 3 for weight 3); this is the two renderers
 * agreeing again. Excalidraw's stroke widths are the discrete 1 / 2 / 4.
 */
const STROKE_WIDTH: Record<number, number> = { 0: 1, 1: 1.5, 2: 2.5, 3: 4 };
const FONT_SIZE: Record<number, number> = { 0: 14, 1: 16, 2: 22, 3: 28 };
/** Excalidraw's Virgil — the hand that makes a board look drawn, not typeset. */
const FONT_FAMILY = 1;
const INK = "#1e1e1e";
const INK_LIGHT = "#6b6b6b";

interface Skeleton {
  id?: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  [key: string]: unknown;
}

/**
 * Hypothetical/hedged content ("if someone offered us $500K, I'd
 * reconsider") is drawn dashed and faint rather than solid, so a viewer can
 * tell it apart from what was actually committed to without reading a word.
 */
function tentativeStyle(object: SceneObject) {
  return object.tentative ? { strokeStyle: "dashed" as const, opacity: 60 } : {};
}

function common(object: SceneObject) {
  const light = object.weight <= 0;
  const heavy = object.weight >= 3;
  return {
    strokeColor: light ? INK_LIGHT : INK,
    backgroundColor: heavy ? "#f3f0e8" : "transparent",
    strokeWidth: STROKE_WIDTH[object.weight] ?? 1,
    roughness: heavy ? 0.7 : 1.1,
    fillStyle: heavy ? ("hachure" as const) : ("solid" as const),
    opacity: light ? 55 : 100,
    ...tentativeStyle(object),
  };
}

/**
 * Labels are STANDALONE text with a derived id, never Excalidraw's bound
 * `label:` shorthand.
 *
 * Bound labels are nicer to write and unusable here: convertToExcalidrawElements
 * mints a fresh random id for the text element it creates, so every re-render
 * would delete and re-add every label even when nothing about the label
 * changed. On a live board that is visible flicker on the exact elements a
 * viewer is reading. A derived id makes the whole conversion idempotent —
 * the same scene produces byte-identical elements with identical ids — which
 * is what lets lib/canvas/excalidraw/sync.ts patch instead of
 * redraw.
 */
function labelSkeleton(object: SceneObject, x: number, y: number, width: number, height: number): Skeleton[] {
  if (!object.label) return [];
  return [
    {
      id: `${object.id}-label`,
      type: "text",
      x,
      y,
      width,
      height,
      text: object.label,
      fontSize: FONT_SIZE[object.weight] ?? 16,
      fontFamily: FONT_FAMILY,
      fontWeight: object.weight >= 3 ? 700 : object.weight <= 0 ? 400 : 500,
      textAlign: "center",
      verticalAlign: "middle",
      strokeColor: object.weight <= 0 ? INK_LIGHT : INK,
      opacity: object.weight <= 0 ? 55 : object.tentative ? 60 : 100,
    },
  ];
}

/**
 * The Drawing Agent's strokes, as Excalidraw line elements.
 *
 * The exact counterpart of renderSketch in lib/expression/render/svg.ts, and
 * deliberately the same arithmetic: a sketch is normalised to a 100x100 unit
 * square, so both renderers inset it by the same fraction and scale it into
 * whatever box the composer already reserved. The sketch never decides its
 * own position or size — if the two files disagreed about that mapping, the
 * same concept would sit differently on the lab's SVG than on the live board.
 *
 * One stroke becomes exactly one element, with an id derived from the
 * object's, for the same reason every other id here is derived: it keeps the
 * conversion idempotent, so a sketched node is patchable rather than redrawn
 * on every sentence (see applyStableIds, which also requires this 1:1).
 */
function sketchSkeletons(object: SceneObject, sketch: Sketch, x: number, y: number, w: number, h: number): Skeleton[] {
  const base = common(object);
  const inset = Math.min(w, h) * 0.16;
  const boxW = w - inset * 2;
  const boxH = h - inset * 2;
  const sx = (px: number) => x + inset + (px / 100) * boxW;
  const sy = (py: number) => y + inset + (py / 100) * boxH;

  return sketch.strokes.map((strokePath, i) => {
    const points = strokePath.points.map(([px, py]) => [sx(px), sy(py)] as [number, number]);
    const [originX, originY] = points[0];
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    return {
      id: `${object.id}-sketch-${i}`,
      type: "line",
      x: originX,
      y: originY,
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      points: points.map(([px, py]) => [px - originX, py - originY]),
      ...base,
      backgroundColor: "transparent",
      fillStyle: "solid" as const,
      roundness: { type: 2 },
    };
  });
}

/**
 * One SceneObject becomes one or more skeleton elements. A figure is drawn
 * rather than looked up — same reasoning as the SVG renderer: the primitive
 * was chosen from the entity's type, so the renderer has to be able to draw
 * a person whose name it has never seen.
 *
 * `sketches` is the Drawing Agent's output for this scene, keyed by
 * sketchKey. It is optional and arrives late by nature — the agent is a
 * network call — so every primitive that can use one still draws its plain
 * geometric fallback when the map has no entry. A missing sketch degrades to
 * a rounded rect; it never blanks the node.
 */
function skeletonsFor(object: SceneObject, sketches?: Map<string, Sketch>): Skeleton[] {
  const base = common(object);
  const id = object.id;
  const rawSketch = object.sketchKey ? sketches?.get(object.sketchKey) : undefined;
  const sketch = rawSketch && !sketchLooksAbstract(rawSketch) ? rawSketch : undefined;

  switch (object.primitive) {
    case "figure": {
      const headR = Math.min(object.w, object.h) * 0.22;
      const cx = object.x + object.w / 2;
      return [
        { id: `${id}-head`, type: "ellipse", x: cx - headR, y: object.y, width: headR * 2, height: headR * 2, ...base },
        {
          id,
          type: "ellipse",
          x: object.x + object.w * 0.16,
          y: object.y + headR * 2 + 6,
          width: object.w * 0.68,
          height: object.h * 0.5,
          ...base,
        },
        ...labelSkeleton(object, object.x, object.y + object.h - 20, object.w, 20),
      ];
    }

    case "figure_group":
    case "quantity_array": {
      // The count is the quantity. No numeral is written beside it.
      const count = object.count ?? 3;
      const each = Math.min(44, (object.w - 16) / count);
      const startX = object.x + (object.w - count * each) / 2;
      const markH = object.primitive === "figure_group" ? object.h * 0.55 : Math.min(each - 6, object.h * 0.45);
      const marks: Skeleton[] = Array.from({ length: count }, (_, i) => ({
        id: `${id}-m${i}`,
        type: object.primitive === "figure_group" ? "ellipse" : "rectangle",
        x: startX + i * each + 3,
        y: object.y + 6,
        width: each - 6,
        height: markH,
        ...base,
      }));
      marks.push(...labelSkeleton(object, object.x, object.y + object.h - 20, object.w, 20));
      // The anchor keeps the object's identity and is what connectors bind to.
      marks.unshift({ id, type: "rectangle", x: object.x, y: object.y, width: object.w, height: object.h, ...base, strokeColor: "transparent" });
      return marks;
    }

    case "place_marker": {
      const cx = object.x + object.w / 2;
      const baseY = object.y + object.h * 0.72;
      const pinR = object.h * 0.14;
      return [
        { id, type: "ellipse", x: cx - pinR, y: baseY - pinR * 3.2, width: pinR * 2, height: pinR * 2, ...base },
        { id: `${id}-ground`, type: "line", x: object.x + 12, y: baseY, width: object.w - 24, height: 0, points: [[0, 0], [object.w - 24, 0]], ...base },
        ...labelSkeleton(object, object.x, object.y + object.h - 20, object.w, 20),
      ];
    }

    case "container":
      // The boundary states containment; the title sits in the header band so
      // it cannot be confused with a child.
      return [
        { id, type: "rectangle", x: object.x, y: object.y, width: object.w, height: object.h, ...base, roundness: { type: 3 } },
        ...labelSkeleton(object, object.x + 16, object.y + 14, object.w - 32, 24),
      ];

    case "state_marker":
      // With a sketch, the drawing takes the upper band and the label drops
      // below it — otherwise the text would sit on top of the strokes. The
      // same split the SVG renderer uses for this primitive.
      if (sketch) {
        return [
          ...sketchSkeletons(object, sketch, object.x, object.y, object.w, object.h * 0.7),
          ...labelSkeleton(object, object.x, object.y + object.h - 22, object.w, 22),
        ];
      }
      return [
        { id, type: "ellipse", x: object.x, y: object.y, width: object.w, height: object.h, ...base },
        ...labelSkeleton(object, object.x, object.y + object.h / 2 - 12, object.w, 24),
      ];

    case "metric_value": {
      const metric = object.metric;
      if (!metric) return [{ id, type: "rectangle", x: object.x, y: object.y, width: object.w, height: object.h, ...base, roundness: { type: 3 } }];
      const points = metric.history;
      const value =
        points.length <= 1
          ? points[0]
            ? formatMetricPoint(points[0], metric)
            : "—"
          : `${formatMetricPoint(points[points.length - 2], metric)}  ->  ${formatMetricPoint(points[points.length - 1], metric)}`;
      const before = points[points.length - 2];
      const after = points[points.length - 1];
      const pct =
        metric.changePercent !== undefined
          ? metric.changePercent
          : before && after && before.value !== 0
            ? ((after.value - before.value) / Math.abs(before.value)) * 100
            : undefined;
      const badge = pct !== undefined ? `${pct > 0 ? "^" : pct < 0 ? "v" : "->"} ${Math.abs(Math.round(pct))}%` : metric.direction ? metric.direction : "";
      return [
        { id, type: "rectangle", x: object.x, y: object.y, width: object.w, height: object.h, ...base, roundness: { type: 3 } },
        {
          id: `${id}-value`,
          type: "text",
          x: object.x,
          y: object.y + object.h * 0.28,
          width: object.w,
          height: 28,
          text: value,
          fontSize: 20,
          textAlign: "center",
          verticalAlign: "middle",
          strokeColor: "#1e1e1e",
        },
        ...(badge
          ? [
              {
                id: `${id}-badge`,
                type: "text",
                x: object.x,
                y: object.y + object.h * 0.56,
                width: object.w,
                height: 18,
                text: badge,
                fontSize: 13,
                textAlign: "center" as const,
                verticalAlign: "middle" as const,
                strokeColor: "#1e1e1e",
              },
            ]
          : []),
        ...labelSkeleton(object, object.x, object.y + object.h - 18, object.w, 16),
      ];
    }

    case "metric_series": {
      const metric = object.metric;
      const points = metric?.history ?? [];
      if (!metric || !points.length) return [{ id, type: "rectangle", x: object.x, y: object.y, width: object.w, height: object.h, ...base, roundness: { type: 3 } }];
      const chartBottom = object.y + object.h - 30;
      const chartTop = object.y + 20;
      const chartH = Math.max(chartBottom - chartTop, 10);
      const values = points.map((p) => p.value);
      const max = Math.max(...values, 0);
      const min = Math.min(...values, 0);
      const span = max - min || 1;
      const gap = 8;
      const barW = Math.max(10, (object.w - 16 - gap * (points.length - 1)) / points.length);
      const startX = object.x + (object.w - (barW * points.length + gap * (points.length - 1))) / 2;
      const bars: Skeleton[] = points.flatMap((p, i) => {
        const bx = startX + i * (barW + gap);
        const barH = Math.max(2, ((p.value - min) / span) * chartH);
        const by = chartBottom - barH;
        return [
          { id: `${id}-b${i}`, type: "rectangle", x: bx, y: by, width: barW, height: barH, ...base },
          {
            id: `${id}-b${i}-value`,
            type: "text",
            x: bx - 10,
            y: by - 20,
            width: barW + 20,
            height: 16,
            text: formatMetricPoint(p, metric),
            fontSize: 11,
            textAlign: "center",
            verticalAlign: "middle",
            strokeColor: "#1e1e1e",
          },
        ] as Skeleton[];
      });
      bars.unshift({ id, type: "rectangle", x: object.x, y: object.y, width: object.w, height: object.h, ...base, strokeColor: "transparent" });
      bars.push(...labelSkeleton(object, object.x, object.y + object.h - 18, object.w, 16));
      return bars;
    }

    case "metric_gauge": {
      const metric = object.metric;
      const current = metric?.history[metric.history.length - 1];
      const target = metric?.target;
      if (!metric) return [{ id, type: "rectangle", x: object.x, y: object.y, width: object.w, height: object.h, ...base, roundness: { type: 3 } }];
      const trackX = object.x + 16;
      const trackW = object.w - 32;
      const trackY = object.y + object.h * 0.42;
      const trackH = 20;
      const ratio = current && target && target.value !== 0 ? Math.max(0, current.value / target.value) : 0;
      const fillW = Math.min(1, ratio) * trackW;
      return [
        { id, type: "rectangle", x: object.x, y: object.y, width: object.w, height: object.h, ...base, strokeColor: "transparent" },
        ...(target
          ? [
              {
                id: `${id}-target-label`,
                type: "text",
                x: object.x,
                y: trackY - 24,
                width: object.w,
                height: 16,
                text: `target ${formatMetricPoint(target, metric)}`,
                fontSize: 12,
                textAlign: "center" as const,
                verticalAlign: "middle" as const,
                strokeColor: "#1e1e1e",
              },
            ]
          : []),
        { id: `${id}-track`, type: "rectangle", x: trackX, y: trackY, width: trackW, height: trackH, ...base, roundness: { type: 3 } },
        ...(fillW > 0
          ? [
              {
                id: `${id}-fill`,
                type: "rectangle",
                x: trackX,
                y: trackY,
                width: fillW,
                height: trackH,
                ...base,
                backgroundColor: "#1e1e1e",
                fillStyle: "solid" as const,
                roundness: { type: 3 },
              },
            ]
          : []),
        {
          id: `${id}-target-line`,
          type: "line",
          x: trackX + trackW,
          y: trackY - 6,
          width: 0,
          height: trackH + 12,
          points: [
            [0, 0],
            [0, trackH + 12],
          ],
          ...base,
        },
        {
          id: `${id}-current`,
          type: "text",
          x: object.x,
          y: trackY + trackH + 8,
          width: object.w,
          height: 20,
          text: current ? formatMetricPoint(current, metric) : "—",
          fontSize: 16,
          textAlign: "center",
          verticalAlign: "middle",
          strokeColor: "#1e1e1e",
        },
        ...labelSkeleton(object, object.x, object.y + 2, object.w, 16),
      ];
    }

    case "text_label":
      return [
        {
          id,
          type: "text",
          x: object.x,
          y: object.y,
          width: object.w,
          height: object.h,
          text: object.label ?? "",
          fontSize: 14,
          strokeColor: "#5c5c5c",
        },
      ];

    case "moment":
    case "object_glyph":
    case "node":
    default:
      // The whole point of the Drawing Agent: when it has drawn this concept,
      // the concept appears as itself rather than as a rectangle with its
      // name in it. Without a sketch this is unchanged from before.
      if (sketch) {
        return [
          ...sketchSkeletons(object, sketch, object.x, object.y, object.w, object.h * 0.72),
          ...labelSkeleton(object, object.x, object.y + object.h - 22, object.w, 22),
        ];
      }
      return [
        {
          id,
          type: "rectangle",
          x: object.x,
          y: object.y,
          width: object.w,
          height: object.h,
          ...base,
          roundness: { type: 3 },
        },
        ...labelSkeleton(object, object.x, object.y + object.h / 2 - 12, object.w, 24),
      ];
  }
}

function skeletonForConnector(connector: SceneConnector): Skeleton | null {
  // A connector the composer resolved to "none" is expressed by the
  // arrangement itself; drawing it would say the same thing twice.
  if (connector.style === "none") return null;
  const [[x1, y1]] = connector.points;
  const [x2, y2] = connector.points[connector.points.length - 1];
  const flow = connector.style === "arrow";
  return {
    id: connector.id,
    type: flow ? "arrow" : connector.style === "tension" ? "line" : "line",
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1,
    points: connector.points.map(([px, py]) => [px - x1, py - y1]),
    strokeColor: INK,
    strokeWidth: flow ? 2.5 : 1.25,
    roughness: 0.85,
    backgroundColor: "transparent",
    roundness: { type: 2 },
    ...(flow ? { endArrowhead: "arrow" } : {}),
    ...(connector.tentative ? { strokeStyle: "dashed" as const, opacity: 60 } : {}),
    // Deliberately NOT bound to its endpoints with start/end.
    //
    // Binding buys one thing: Excalidraw re-routes the arrow when a human
    // drags a bound element in the editor. It costs the ability to control
    // element ids, because a bound element carries cross-references that
    // would all have to be rewritten alongside the id (see applyStableIds).
    //
    // For this region the trade is one-sided. The composer already routed
    // this connector edge-to-edge, and the whole region is re-laid-out on the
    // next sentence anyway — so a manual drag would be overwritten within
    // seconds regardless. Stable ids are worth far more: they are what make
    // the region patchable instead of redrawn.
  };
}

/** A connector's own label, as standalone text at the midpoint — same id-stability reasoning as labelSkeleton. */
function connectorLabelSkeleton(connector: SceneConnector): Skeleton[] {
  if (!connector.label) return [];
  const [[x1, y1]] = connector.points;
  const [x2, y2] = connector.points[connector.points.length - 1];
  return [
    {
      id: `${connector.id}-label`,
      type: "text",
      x: (x1 + x2) / 2 - 60,
      y: (y1 + y2) / 2 - 20,
      width: 120,
      height: 20,
      text: connector.label,
      fontSize: 15,
      fontFamily: FONT_FAMILY,
      textAlign: "center",
      verticalAlign: "middle",
      strokeColor: INK,
      ...(connector.tentative ? { opacity: 60 } : {}),
    },
  ];
}

export type ExpressionSkeleton = Skeleton;

/**
 * Every skeleton for a scene, translated so the scene's own origin sits at
 * `origin` on the page.
 *
 * The translation lives here rather than in the composer because it is a
 * placement decision about a sheet, not about the meaning: the composer
 * produces a scene that starts at (0,0) and knows nothing about pages, pens
 * or what else is already drawn. lib/canvas/excalidraw/sync.ts
 * owns that and passes the offset in.
 *
 * Deterministic and idempotent: the same scene and origin always produce the
 * same skeletons, with the same ids, in the same order.
 */
export function skeletonsForScene(
  scene: ScenePlan,
  origin: { x: number; y: number },
  sketches?: Map<string, Sketch>,
): ExpressionSkeleton[] {
  const shift = (skeleton: Skeleton): Skeleton => ({ ...skeleton, x: skeleton.x + origin.x, y: skeleton.y + origin.y });
  return [
    // Containers first so their children land on top of the boundary.
    ...scene.objects.filter((o) => o.primitive === "container").flatMap((o) => skeletonsFor(o, sketches)).map(shift),
    ...scene.objects.filter((o) => o.primitive !== "container").flatMap((o) => skeletonsFor(o, sketches)).map(shift),
    ...scene.connectors.flatMap((c) => {
      const line = skeletonForConnector(c);
      return [...(line ? [line] : []), ...connectorLabelSkeleton(c)];
    }).map(shift),
  ];
}

/**
 * Restores our own ids onto the converted elements.
 *
 * convertToExcalidrawElements does NOT keep the `id` a skeleton supplies — it
 * rebuilds elements internally and emits its own. lib/ops.ts already hit this
 * and worked around it by reading back whichever id Excalidraw happened to
 * emit; that works when you only need one node's id, and not at all when the
 * entire point is that the same scene must produce the same ids every time.
 *
 * So the ids are re-applied here, by position. That is sound only because
 * every skeleton this module emits maps to exactly one element: there are no
 * bound `label:` shorthands (they expand to two) and no bound arrows (they
 * carry cross-references). If that ever stops being true the counts diverge,
 * and this returns null rather than silently pairing the wrong id to the
 * wrong element — which would put a viewer's box under a stranger's name.
 */
export function applyStableIds(converted: SceneElement[], skeletons: ExpressionSkeleton[]): SceneElement[] | null {
  if (converted.length !== skeletons.length) return null;
  return converted.map((element, index) => {
    const id = skeletons[index].id;
    return typeof id === "string" ? { ...element, id } : element;
  });
}

export interface ExcalidrawRenderResult {
  elements: SceneElement[];
  /** Ids to delete from the live scene before the new elements are merged in. */
  removedElementIds: string[];
}

export class ExcalidrawRenderer implements Renderer<Promise<ExcalidrawRenderResult>> {
  readonly name = "excalidraw";

  /**
   * Builds the elements for the whole scene, plus the ids the patch says are
   * gone. The caller merges rather than replaces — which is why `removed` is
   * returned separately instead of this method handing back a complete board.
   *
   * For the live board, prefer syncExpressionCanvas in
   * lib/canvas/excalidraw/sync.ts: it does the same conversion but
   * reconciles against what is already on the sheet, so unchanged elements
   * are left strictly alone.
   */
  async render(scene: ScenePlan, patch: RenderPatch): Promise<ExcalidrawRenderResult> {
    const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
    const skeletons = skeletonsForScene(scene, { x: 0, y: 0 });
    const converted = convertToExcalidrawElements(skeletons as never) as unknown as SceneElement[];
    return {
      elements: applyStableIds(converted, skeletons) ?? converted,
      removedElementIds: [...patch.removed, ...patch.connectorsRemoved],
    };
  }
}
