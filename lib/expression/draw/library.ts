/**
 * The sketch library: every icon this engine has ever drawn, cached by
 * concept so it is drawn once and reused forever after.
 *
 * This is the "inspiration" a repeated concept gets — not a fresh guess each
 * time, but the same stroke set an artist would reach for again, the way a
 * real sketchnote artist has a repertoire rather than reinventing "trust"
 * every time someone says it. The first "cut" ever spoken costs a model
 * call; every one after it, by anyone, is instant and visually consistent.
 *
 * In-memory and per-process for now — it does not survive a server restart.
 * Worth persisting once the mechanism is proven; premature to build that
 * before knowing the strokes are worth keeping.
 */

import type { Sketch } from "./schemas";

const cache = new Map<string, Sketch>();

/** Deterministic, not model-supplied — the same concept always maps to the same key. */
export function sketchKeyFor(entityType: string, label: string): string {
  const normalized = label.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return `${entityType}:${normalized}`;
}

export function getCachedSketch(key: string): Sketch | undefined {
  return cache.get(key);
}

export function cacheSketch(key: string, sketch: Sketch): void {
  cache.set(key, sketch);
}

/** Test-only: the library is module-level state, so a suite needs a way to reset it between cases. */
export function clearSketchLibrary(): void {
  cache.clear();
}
