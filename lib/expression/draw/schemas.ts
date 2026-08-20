/**
 * A hand-drawn icon for one concept, normalized to a 100x100 unit square so
 * it can be scaled into whatever box the deterministic layout already
 * reserved for it — the sketch never decides its own position or size.
 *
 * Strokes only, never a raster image. Everything already on the canvas is
 * ink from the same hand — a photo or a generated picture would be the one
 * element on the page that visibly came from somewhere else.
 */

import { z } from "zod";

export const StrokeSchema = z
  .object({
    /** A pen path: the sequence of points it moves through in one unbroken motion. */
    points: z
      .array(z.tuple([z.number().min(0).max(100), z.number().min(0).max(100)]))
      .min(2)
      .max(20),
  })
  .strict();
export type Stroke = z.infer<typeof StrokeSchema>;

export const SketchSchema = z
  .object({
    strokes: z.array(StrokeSchema).min(1).max(12),
  })
  .strict();
export type Sketch = z.infer<typeof SketchSchema>;
