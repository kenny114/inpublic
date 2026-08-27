/**
 * A hand-drawn illustration of one concept, normalized to a 100x100 unit
 * square so it can be scaled into whatever box the deterministic layout
 * already reserved for it — the sketch never decides its own position or
 * size.
 *
 * Strokes only, never a raster image. Everything already on the canvas is
 * ink from the same hand — a photo or a generated picture would be the one
 * element on the page that visibly came from somewhere else.
 *
 * The schema's parse ceiling (120) is deliberately above what a drawing is
 * allowed to SHOW. SKETCH_SYSTEM asks for 8-20 confident strokes; anything
 * busier is rejected at the quality gate and the renderer falls back to a
 * labelled node — a noisy glyph is worse than a clean word.
 */

import { z } from "zod";

export const StrokeSchema = z
  .object({
    /** A pen path: the sequence of points it moves through in one unbroken motion. */
    points: z
      .array(z.tuple([z.number().min(0).max(100), z.number().min(0).max(100)]))
      .min(2)
      .max(40),
  })
  .strict();
export type Stroke = z.infer<typeof StrokeSchema>;

export const SketchSchema = z
  .object({
    strokes: z.array(StrokeSchema).min(1).max(120),
  })
  .strict();
export type Sketch = z.infer<typeof SketchSchema>;

/**
 * A stroke long enough to be reading as contour rather than as texture.
 * Cross-hatch strokes are legitimately shorter than this — that is what
 * cross-hatching is.
 */
const CONTOUR_MIN_LENGTH = 10;
/**
 * How many contour strokes a sketch needs before its short strokes read as
 * shading rather than as scribble. Three is the fewest that can describe a
 * closed form; a sketch with fewer than that and nothing but short marks is
 * a smudge, not a drawing.
 */
const MIN_CONTOUR_STROKES = 3;
/** A sketch that arrives busier than this is a labelled node, not a drawing. */
export const MAX_SKETCH_STROKES = 20;

/** Total pen distance travelled by one stroke. */
function strokeLength(stroke: Stroke): number {
  let length = 0;
  for (let i = 1; i < stroke.points.length; i += 1) {
    const [x0, y0] = stroke.points[i - 1];
    const [x1, y1] = stroke.points[i];
    length += Math.hypot(x1 - x0, y1 - y0);
  }
  return length;
}

/**
 * Why this sketch cannot be drawn, or null when it can.
 *
 * Named rather than boolean because the gate is invisible in production
 * otherwise: a rejected sketch is a full model call paid for and silently
 * thrown away, and until this returned a reason there was no way to tell
 * that from "the model never answered" (docs/EXPRESSION-ENGINE-FULL-AUDIT.md
 * §6, and the R0/R1/R6 brief).
 *
 * Stroke count IS a quality gate again, with a different job than the old
 * one: the prompt now asks for 8-20 confident strokes and no shading, so a
 * 100-stroke hatch is the model ignoring its brief, not a drawing to keep.
 * Cross-hatch is no longer asked for and no longer protected.
 */
export function sketchRejectionReason(sketch: Sketch): string | null {
  if (sketch.strokes.length < 2) return "single stroke";
  if (sketch.strokes.length > MAX_SKETCH_STROKES) {
    return `too many strokes (${sketch.strokes.length} > ${MAX_SKETCH_STROKES})`;
  }
  const all = sketch.strokes.flatMap((stroke) => stroke.points);
  if (all.length < 4) return "too few points";
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const span = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  if (span < 900) return `clustered (span ${Math.round(span)} < 900)`;
  const contour = sketch.strokes.filter((stroke) => strokeLength(stroke) >= CONTOUR_MIN_LENGTH).length;
  const required = Math.min(MIN_CONTOUR_STROKES, sketch.strokes.length);
  if (contour < required) return `no contour (${contour} strokes >= ${CONTOUR_MIN_LENGTH} units, needs ${required})`;
  return null;
}

/**
 * True when a sketch is too thin, too scribbly, or too clustered to read as
 * the concept — in which case the renderer should fall back to a clean
 * labelled node rather than noisy strokes. The renderers want a boolean;
 * everything that logs wants the reason, so both read the same function.
 */
export function sketchLooksAbstract(sketch: Sketch): boolean {
  return sketchRejectionReason(sketch) !== null;
}
