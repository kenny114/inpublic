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
import type { RenderPatch, Renderer, ScenePlan, SceneConnector, SceneObject } from "../schemas";

/** Excalidraw's own vocabulary. Weight becomes stroke width, exactly as in the SVG renderer, so the two agree. */
const STROKE_WIDTH: Record<number, number> = { 0: 1, 1: 1, 2: 2, 3: 2 };
const FONT_SIZE: Record<number, number> = { 0: 16, 1: 16, 2: 20, 3: 20 };

interface Skeleton {
  id?: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  [key: string]: unknown;
}

function common(object: SceneObject) {
  return {
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    strokeWidth: STROKE_WIDTH[object.weight] ?? 1,
    roughness: 1,
    fillStyle: "solid" as const,
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
 * is what lets lib/expression/render/excalidrawSync.ts patch instead of
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
      textAlign: "center",
      verticalAlign: "middle",
      strokeColor: "#1e1e1e",
    },
  ];
}

/**
 * One SceneObject becomes one or more skeleton elements. A figure is drawn
 * rather than looked up — same reasoning as the SVG renderer: the primitive
 * was chosen from the entity's type, so the renderer has to be able to draw
 * a person whose name it has never seen.
 */
function skeletonsFor(object: SceneObject): Skeleton[] {
  const base = common(object);
  const id = object.id;

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
      return [
        { id, type: "ellipse", x: object.x, y: object.y, width: object.w, height: object.h, ...base },
        ...labelSkeleton(object, object.x, object.y + object.h / 2 - 12, object.w, 24),
      ];

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
  return {
    id: connector.id,
    type: connector.style === "arrow" ? "arrow" : "line",
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1,
    points: connector.points.map(([px, py]) => [px - x1, py - y1]),
    strokeColor: "#1e1e1e",
    strokeWidth: 1,
    roughness: 1,
    backgroundColor: "transparent",
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
      fontSize: 14,
      textAlign: "center",
      verticalAlign: "middle",
      strokeColor: "#1e1e1e",
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
 * or what else is already drawn. lib/expression/render/excalidrawSync.ts
 * owns that and passes the offset in.
 *
 * Deterministic and idempotent: the same scene and origin always produce the
 * same skeletons, with the same ids, in the same order.
 */
export function skeletonsForScene(scene: ScenePlan, origin: { x: number; y: number }): ExpressionSkeleton[] {
  const shift = (skeleton: Skeleton): Skeleton => ({ ...skeleton, x: skeleton.x + origin.x, y: skeleton.y + origin.y });
  return [
    // Containers first so their children land on top of the boundary.
    ...scene.objects.filter((o) => o.primitive === "container").flatMap(skeletonsFor).map(shift),
    ...scene.objects.filter((o) => o.primitive !== "container").flatMap(skeletonsFor).map(shift),
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
   * lib/expression/render/excalidrawSync.ts: it does the same conversion but
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
