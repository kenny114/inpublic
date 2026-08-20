/**
 * A hand-drawn illustration of one concept, normalized to a 100x100 unit
 * square so it can be scaled into whatever box the deterministic layout
 * already reserved for it — the sketch never decides its own position or
 * size.
 *
 * Strokes only, never a raster image. Everything already on the canvas is
 * ink from the same hand — a photo or a generated picture would be the one
 * element on the page that visibly came from somewhere else. Real detail
 * (proportion, contour, shading) comes from using MANY strokes — cross-
 * hatching is dozens of short parallel lines, not a fill — not from
 * abandoning strokes for something that isn't drawn at all.
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
