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
 */

import { complete, SCRIBE_MODEL, type CompletionUsage } from "../../llm";
import { SketchSchema, type Sketch } from "./schemas";
import { extractJsonObject } from "../meaning/extract";

export const SKETCH_MODEL = process.env.SKETCH_MODEL || SCRIBE_MODEL;

export const SKETCH_SYSTEM = `You are a sketchnote artist. Given one concept, draw a small hand-drawn icon for it — the kind of 2-second doodle a live notetaker draws next to a word, not an illustration and not a realistic picture.

You draw with STROKES ONLY. Each stroke is one unbroken pen motion: a list of points the pen passes through in order. No fill, no color, no text, no letters — only lines a pen could draw in one or two seconds.

Coordinate system: a 100x100 square, (0,0) top-left, (100,100) bottom-right. Use most of the square. Keep the drawing roughly centered.

Draw the THING the concept names, not its letters. A "cut" is a short jagged line with two or three small marks crossing it, the way a notetaker draws a wound — not the word "cut". "Trust" might be a simple handshake or a shield. "AI" might be a small chip or spark shape. If the concept is too abstract to have a physical form, draw the simplest possible symbol for it (an arrow, a spark, a spiral) rather than nothing.

2 to 8 strokes. Fewer, confident strokes read better at this size than many detailed ones.

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
      maxTokens: 800,
      temperature: 0.4,
      onUsage,
    });
  } catch {
    return undefined;
  }
  const json = extractJsonObject(raw);
  if (!json) return undefined;
  const parsed = SketchSchema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}
