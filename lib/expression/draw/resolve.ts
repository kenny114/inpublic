/**
 * Library-first, model on miss. The one function everything else calls —
 * nothing outside this module should call drawSketch or the cache directly.
 */

import { drawSketch } from "./agent";
import { getCachedSketch, cacheSketch, sketchKeyFor } from "./library";
import type { Sketch } from "./schemas";
import type { CompletionUsage } from "../../llm";

export async function sketchFor(
  entityType: string,
  label: string,
  onUsage?: (usage: CompletionUsage) => void,
): Promise<Sketch | undefined> {
  const key = sketchKeyFor(entityType, label);
  const cached = getCachedSketch(key);
  if (cached) return cached;
  const sketch = await drawSketch(entityType, label, onUsage);
  if (sketch) cacheSketch(key, sketch);
  return sketch;
}
