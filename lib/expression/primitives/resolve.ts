/**
 * Visual primitive resolution: what KIND of mark expresses this thing?
 *
 * Decided from the entity's semantic type and the role its region plays —
 * never from the words in its label. That distinction is the entire
 * difference between visual expression and keyword illustration. A person
 * is drawn as a figure because the meaning layer typed it `person`, not
 * because the label looked like a name; "Trinidad and Tobago" is a place
 * marker because it was extracted as a `place`, not because a gazetteer was
 * consulted.
 *
 * The corollary, which matters just as much: a `concept` gets a plain node.
 * When the meaning layer genuinely could not say what kind of thing
 * something is, the honest visual is a labelled node — not a guessed icon.
 * Guessing an icon from wording is the failure mode this architecture
 * exists to eliminate, and it would enter the system right here if it
 * entered anywhere.
 *
 * The Drawing Agent (lib/expression/draw/) does not violate this: a
 * `sketchKey` attached below is derived from the entity's TYPE and LABEL —
 * the same typed fact every primitive choice above already trusts — and
 * what it draws is decided by a model call, not a keyword lookup table.
 * Nothing here inspects the label to choose a shape; the label only becomes
 * the cache key once the shape has already been decided by type.
 */

import type { Region, VisualPrimitive, WorldEntity } from "../schemas";
import { sketchKeyFor } from "../draw/library";

export interface PrimitiveSize {
  w: number;
  h: number;
}

/**
 * Base footprints. A figure is tall and narrow because a person is; a node
 * is wide because it carries words. Emphasis scales these later
 * (lib/expression/compose/compose.ts) — these are the weight-1 sizes.
 */
export const PRIMITIVE_SIZE: Record<VisualPrimitive, PrimitiveSize> = {
  figure: { w: 96, h: 128 },
  figure_group: { w: 200, h: 128 },
  place_marker: { w: 168, h: 104 },
  object_glyph: { w: 120, h: 104 },
  node: { w: 200, h: 72 },
  container: { w: 280, h: 180 },
  quantity_array: { w: 200, h: 112 },
  state_marker: { w: 144, h: 96 },
  moment: { w: 168, h: 80 },
  text_label: { w: 200, h: 40 },
  metric_value: { w: 176, h: 96 },
  metric_series: { w: 240, h: 128 },
  metric_gauge: { w: 220, h: 120 },
};

/** How many marks a counted thing is drawn as. Beyond this a crowd reads as "many", and drawing more costs comprehension rather than adding it. */
export const MAX_COUNTED_MARKS = 12;

export interface ResolvedPrimitive {
  primitive: VisualPrimitive;
  /** Number of repeated marks, when the primitive repeats. */
  count?: number;
  size: PrimitiveSize;
  /** Set only for primitives that are otherwise a plain shape with a label — see withSketch below. */
  sketchKey?: string;
}

/**
 * Attaches a sketch cache key to a primitive that would otherwise be nothing
 * but a shape and a label. Not every primitive gets one: a figure already
 * draws a person, a place_marker already draws a place, a quantity_array
 * already draws the count itself — none of those need an icon to stop being
 * a caption.
 *
 * WHAT IS DRAWN AND WHAT IS NAMED. This used to be attached to `node`,
 * `moment`, `state_marker` and `object_glyph` alike — that is, to concepts,
 * actions, events, times and states as well as to physical things. A
 * physical thing has a shape a drawing can be right or wrong about. The
 * others do not: asked for "something new" or "the rebuild" the model
 * cannot draw the thing, so it draws an ASSOCIATION with it, and an
 * abstract scribble beside a correct label reads as neither the label nor
 * the concept — it is the guessed-icon failure this module's header rejects,
 * arriving through the drawing agent instead of through a lookup table.
 * A concept's honest visual is the clean labelled node it already has.
 *
 * It costs latency too, and the late kind: every uncached key is a model
 * call whose result lands as a second commit after the board already looked
 * settled (components/Board.tsx's phase 2). Restricting this to `object`
 * removes most of those calls from an ordinary sentence, so what the board
 * shows at the end of a thought is what it showed a moment into it.
 */
function withSketch(resolved: ResolvedPrimitive, entity: WorldEntity): ResolvedPrimitive {
  if (entity.type !== "object") return resolved;
  return { ...resolved, sketchKey: sketchKeyFor(entity.type, entity.label) };
}

function hasChildren(region: Region): boolean {
  return Boolean(region.childRegionIds && region.childRegionIds.length);
}

/** Marks wide enough to read, sized to the count. */
function repeated(primitive: VisualPrimitive, count: number, base: PrimitiveSize, per: number): ResolvedPrimitive {
  return { primitive, count, size: { w: Math.max(base.w, count * per + 32), h: base.h } };
}

export function resolvePrimitive(entity: WorldEntity | null, region: Region): ResolvedPrimitive {
  if (region.role === "annotation" || !entity) {
    return { primitive: "text_label", size: PRIMITIVE_SIZE.text_label };
  }

  /**
   * A metric ("200 visitors last week, 500 this week") is a measurement
   * over time, never an extent to count out in marks — checked first, and
   * unconditionally, so nothing below (the count-as-extent rule right after
   * this, or the per-type switch) can reinterpret "500" as five hundred
   * dots. Three shapes, chosen purely from the metric's own structure, never
   * from wording:
   *   target set                 -> metric_gauge (actual against a threshold)
   *   3+ points in history       -> metric_series (an ordered run)
   *   otherwise (1 or 2 points)  -> metric_value (a number, or a before/after pair)
   * Two-metric comparison is not a fourth case here — it is two
   * metric_value/metric_series regions placed as poles by the `comparison`
   * grammar (lib/expression/grammars/index.ts), decided from a
   * `contrasts_with` relation between two metric entities, same as any other
   * comparison.
   */
  if (entity.metric) {
    if (entity.metric.target) return { primitive: "metric_gauge", size: PRIMITIVE_SIZE.metric_gauge };
    if (entity.metric.history.length >= 3) return { primitive: "metric_series", size: PRIMITIVE_SIZE.metric_series };
    return { primitive: "metric_value", size: PRIMITIVE_SIZE.metric_value };
  }

  /**
   * A stated count is drawn as extent, whatever KIND of thing was counted.
   *
   * This used to be decided per entity type, which meant "six chairs" — an
   * `object` — reached the canvas as a single glyph with the six thrown
   * away, while "six people" kept it. The count is the meaning in both
   * cases, and which bucket the extractor put the noun in has nothing to do
   * with whether a number was said. Checked before the type switch so no
   * future type can quietly opt out of it again.
   *
   * A container is the exception: its members are drawn inside it, so the
   * enclosure already shows the extent and repeating it would double-count.
   */
  const count = entity.quantity && entity.quantity.value >= 2 ? Math.min(Math.round(entity.quantity.value), MAX_COUNTED_MARKS) : null;
  const enclosing = Boolean(region.childRegionIds && region.childRegionIds.length);
  if (count && !enclosing) {
    if (entity.type === "person" || entity.type === "group") {
      return repeated("figure_group", count, PRIMITIVE_SIZE.figure_group, 44);
    }
    return repeated("quantity_array", count, PRIMITIVE_SIZE.quantity_array, 32);
  }

  // A region with children drawn inside it is a container whatever it
  // semantically is — the enclosure is doing the communicating, so the
  // parent's own primitive must not compete with its contents.
  if (hasChildren(region) && entity.type !== "group") {
    return { primitive: "container", size: PRIMITIVE_SIZE.container };
  }

  switch (entity.type) {
    case "person":
      return { primitive: "figure", size: PRIMITIVE_SIZE.figure };

    case "group": {
      // A counted group is its members: "a family of five" is five marks in
      // one boundary, never a box with the number 5 written in it.
      const counted = entity.quantity?.value;
      const count = counted && counted >= 1 ? Math.min(Math.round(counted), MAX_COUNTED_MARKS) : undefined;
      if (hasChildren(region)) return { primitive: "container", count, size: PRIMITIVE_SIZE.container };
      const width = count ? Math.max(PRIMITIVE_SIZE.figure_group.w, count * 44 + 32) : PRIMITIVE_SIZE.figure_group.w;
      return { primitive: "figure_group", count, size: { w: width, h: PRIMITIVE_SIZE.figure_group.h } };
    }

    case "place":
      return { primitive: "place_marker", size: PRIMITIVE_SIZE.place_marker };

    case "object":
      return withSketch({ primitive: "object_glyph", size: PRIMITIVE_SIZE.object_glyph }, entity);

    case "state":
      return withSketch({ primitive: "state_marker", size: PRIMITIVE_SIZE.state_marker }, entity);

    case "event":
    case "action":
    case "time":
      return withSketch({ primitive: "moment", size: PRIMITIVE_SIZE.moment }, entity);

    case "quantity": {
      const value = entity.quantity?.value;
      const count = value && value >= 1 ? Math.min(Math.round(value), MAX_COUNTED_MARKS) : undefined;
      const width = count ? Math.max(PRIMITIVE_SIZE.quantity_array.w, count * 32 + 32) : PRIMITIVE_SIZE.quantity_array.w;
      return { primitive: "quantity_array", count, size: { w: width, h: PRIMITIVE_SIZE.quantity_array.h } };
    }

    case "concept":
    default: {
      // A counted concept ("twelve apples") still shows its count as extent.
      const value = entity.quantity?.value;
      if (value && value >= 2) {
        const count = Math.min(Math.round(value), MAX_COUNTED_MARKS);
        return {
          primitive: "quantity_array",
          count,
          size: { w: Math.max(PRIMITIVE_SIZE.quantity_array.w, count * 32 + 32), h: PRIMITIVE_SIZE.quantity_array.h },
        };
      }
      return withSketch({ primitive: "node", size: PRIMITIVE_SIZE.node }, entity);
    }
  }
}
