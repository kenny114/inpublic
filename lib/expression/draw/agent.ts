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
 */

import { complete, ARTIST_MODEL, type CompletionUsage } from "../../llm";
import { SketchSchema, type Sketch } from "./schemas";
import { extractJsonObject } from "../meaning/extract";

export const SKETCH_MODEL = process.env.SKETCH_MODEL || ARTIST_MODEL;

export const SKETCH_SYSTEM = `You are a skilled sketch artist drawing on a shared page, live, in front of someone. Given one concept, draw it properly — real proportion, real contour, real shading — using nothing but pen strokes.

You draw with STROKES ONLY. Each stroke is one unbroken pen motion: a list of points the pen passes through in order. No fill, no color (except one small accent where the concept genuinely has one identifying color, like a red mark for a cut), no text, no letters.

Coordinate system: a 100x100 square, (0,0) top-left, (100,100) bottom-right. Use most of the square. Keep the drawing roughly centered.

DRAW THE THING PROPERLY. Not an icon, not a symbol standing in for it — an actual sketch of the thing itself, the way a person would draw it if asked to sketch it well. A "hand" is a palm and five distinct fingers in correct proportion to each other, not a mitten shape. A "cut" is a specific short jagged wound mark drawn ON something (skin, a surface) with a few short crossing strokes around it suggesting the break in the surface — not a single line floating in space.

REAL DETAIL COMES FROM MORE STROKES, NOT BIGGER ONES. Shading and texture are cross-hatching: dozens of short, roughly parallel strokes laid close together, the way pencil shading actually works. A contour is not one perfect curve — it is several shorter strokes that together read as the outline, the way a hand actually draws a confident line. Use as many strokes as the concept genuinely needs to read as itself: a simple concept might be 10-15 strokes, something with real form and shading — a hand, a face, an object with volume — should be 40-100+.

STROKE ORDER MATTERS: you are drawing live, and each stroke will appear on the page in the order you list it, one after another, the way a real sketch is built up. List them the way an artist actually works — the big proportion and contour strokes FIRST, so the shape is recognisable early, THEN the interior detail and shading strokes after, so texture builds up over an already-correct form. Never draw shading before the shape it belongs to exists.

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
      maxTokens: 6000,
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
