/**
 * The Drawing Agent's one model call: a concept in, a Sketch out.
 *
 * Everything upstream of this (meaning, world, intent, grammar, scene)
 * decides WHAT exists and WHERE it goes, deterministically, and none of it
 * changes here. This is the one remaining question the deterministic layers
 * cannot answer: what does this concept look like, drawn?
 *
 * Deliberately as narrow a decision as extractMeaning's: given a label and a
 * type, return strokes in a normalized unit square. No position, no size, no
 * color, no text — the caller already knows where this goes and how big it
 * is; drawing it a second time here would be geometry duplicating geometry.
 *
 * Defaults to ARTIST_MODEL, not SCRIBE_MODEL: getting real proportion and
 * contour out of a list of coordinates is a harder spatial task than a fast
 * live decision, and it only has to run once per concept — every repeat
 * after the first is free from the sketch library.
 *
 * Only physical things reach here at all. A concept, a state, an action or
 * a moment keeps its clean labelled primitive, because a drawing of one is
 * a guess about what it looks like and there is nothing to guess — see
 * lib/expression/primitives/resolve.ts's withSketch.
 */

import { complete, ARTIST_MODEL, type CompletionUsage } from "../../llm";
import { SketchSchema, type Sketch } from "./schemas";
import { extractJsonObject } from "../meaning/extract";

export const SKETCH_MODEL = process.env.SKETCH_MODEL || ARTIST_MODEL;

/**
 * The output budget one draw is allowed, in tokens.
 *
 * Exported because app/api/sketch/route.ts has to reserve the same number
 * with the cost guard before this runs, and the two had drifted: the route
 * reserved 800 while the call below asked for 6000, under-reserving by 7.5x
 * (docs/EXPRESSION-ENGINE-FULL-AUDIT.md §6). One constant, both readers.
 *
 * 1800 is what a sketch actually costs now that SKETCH_SYSTEM asks for a
 * clean 8-20 stroke line drawing rather than the 40-100+ cross-hatched
 * strokes it used to. The old budget was 6000, sized for shading nobody
 * could read at node scale; the tokens were the latency, and the latency
 * was the late second commit on the board.
 */
export const SKETCH_MAX_OUTPUT_TOKENS = 1800;

export const SKETCH_SYSTEM = `You are drawing a small, confident line drawing in Excalidraw, live, on a shared page. Given one physical object, draw it so it is recognisable at a glance from a few metres away.

You draw with STROKES ONLY. Each stroke is one unbroken pen motion: a list of points the pen passes through in order. No fill, no color, no text, no letters, no numbers.

Coordinate system: a 100x100 square, (0,0) top-left, (100,100) bottom-right. Use most of the square. Keep the drawing roughly centered.

DRAW THE THING ITSELF. Correct proportion and a clear outline — not a symbol, not an icon, not a doodle of an association. A "mug" is a cylinder with a handle; a "bike" is two wheels, a frame and handlebars.

FEWER, CONFIDENT STROKES. 8-16 is the sweet spot. 20 is the hard maximum. Outline first, then the two or three interior lines that identify it, then STOP. No shading, no cross-hatching, no texture, no construction lines. At node size those collapse into a smudge.

This sits next to clean labelled boxes and one heavy subject. It has to look like the same hand: deliberate, sparse, readable. If a stroke does not help someone recognise the thing, leave it out.

STROKE ORDER MATTERS: you are drawing live. Big contour FIRST so the shape is recognisable early, then the few interior lines.

Respond with ONLY one JSON object, no other text:
{"strokes":[{"points":[[x,y],[x,y],...]}]}`;

/**
 * Never throws. A failed or malformed draw falls back to undefined, and the
 * caller draws the existing plain shape instead — a missing icon is a worse
 * outcome to hide than to show, but it must never be the outcome that blocks
 * the canvas from drawing anything at all.
 */
export async function drawSketch(
  entityType: string,
  label: string,
  onUsage?: (usage: CompletionUsage) => void,
): Promise<Sketch | undefined> {
  if (!label.trim()) return undefined;
  let raw = "";
  try {
    raw = await complete({
      model: SKETCH_MODEL,
      system: SKETCH_SYSTEM,
      user: JSON.stringify({ concept: label, type: entityType }),
      maxTokens: SKETCH_MAX_OUTPUT_TOKENS,
      temperature: 0.5,
      onUsage,
    });
  } catch (err) {
    console.error("[sketch-agent]", err);
    return undefined;
  }
  const json = extractJsonObject(raw);
  if (!json) return undefined;
  const parsed = SketchSchema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}
