/**
 * Client-side counterpart of lib/expression/draw/resolve.ts: the browser has
 * no Anthropic key, so this calls app/api/sketch/route.ts instead of the
 * model directly. Mirrors lib/expression/meaning/client.ts's shape for the
 * same reason that module exists — one fetch, one JSON parse, fails closed.
 */

import { sketchRejectionReason, type Sketch } from "./schemas";

/**
 * What happened to one sketchKey in one resolve pass.
 *
 * The sketch path was entirely invisible in production: no event fired on a
 * cache hit, a fetch, a fetch duration, or the render-time quality gate
 * discarding the result (docs/EXPRESSION-ENGINE-FULL-AUDIT.md §8, unknown
 * #5). Reported per key rather than aggregated because the interesting
 * question is which concepts cost a model call, not how many did.
 *
 * `rejectedReason` is the verdict the RENDERER will reach on this sketch —
 * same pure function, same input — computed here so the log can say a call
 * was paid for and thrown away. Reporting it does not cause the fallback;
 * lib/canvas/excalidraw/conversion.ts still decides that for itself.
 */
export interface SketchResolutionEvent {
  key: string;
  label: string;
  outcome: "cache_hit" | "fetched" | "missing";
  /** Wall-clock ms for the fetch. Absent on a cache hit, which costs nothing. */
  ms?: number;
  strokes?: number;
  rejectedReason?: string;
}

/**
 * Same one-use, fingerprint-bound dev grant lib/expression/meaning/client.ts
 * mints for app/api/express — the text-first lab has no listening session to
 * authorize with, and the sketch route needs its own token because a grant
 * is consumed on first use, not shared across routes.
 */
async function developmentAuthorization(): Promise<Record<string, string>> {
  if (process.env.NODE_ENV === "production") return {};
  try {
    const res = await fetch("/api/dev/replay-authorization", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    if (!res.ok) return {};
    const body = (await res.json()) as { authorization?: string };
    return body.authorization ? { "x-inpublic-replay-authorization": body.authorization } : {};
  } catch {
    return {};
  }
}

export async function fetchSketch(entityType: string, label: string): Promise<Sketch | undefined> {
  try {
    const authHeaders = await developmentAuthorization();
    const res = await fetch("/api/sketch", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders },
      body: JSON.stringify({ type: entityType, label }),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { sketch: Sketch | null };
    return data.sketch ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every unique sketchKey in one scene, resolved to its Sketch (via the
 * client-side cache first, the route on a miss) and returned as a lookup map
 * the renderer draws from. Deduplicated so a scene with three "cut" moments
 * only ever fetches "cut" once.
 *
 * Takes `label` alongside `sketchKey` rather than recovering it from the
 * key: sketchKeyFor slugifies the label for use as a cache key (lowercased,
 * punctuation stripped), and that slug is not what should be sent to the
 * model as the concept to draw.
 */
export async function resolveSketches(
  objects: Array<{ sketchKey?: string; label?: string }>,
  clientCache: Map<string, Sketch>,
  onEvent?: (event: SketchResolutionEvent) => void,
): Promise<Map<string, Sketch>> {
  const pairs = sketchPairs(objects);
  const missing = [...pairs.entries()].filter(([key]) => !clientCache.has(key));

  if (onEvent) {
    for (const [key, label] of pairs) {
      if (!clientCache.has(key)) continue;
      onEvent({ key, label, outcome: "cache_hit", strokes: clientCache.get(key)!.strokes.length });
    }
  }

  await Promise.all(
    missing.map(async ([key, label]) => {
      const entityType = key.split(":")[0];
      const startedAt = Date.now();
      const sketch = await fetchSketch(entityType, label);
      const ms = Date.now() - startedAt;
      if (sketch) clientCache.set(key, sketch);
      onEvent?.(
        sketch
          ? {
              key,
              label,
              outcome: "fetched",
              ms,
              strokes: sketch.strokes.length,
              ...(sketchRejectionReason(sketch) ? { rejectedReason: sketchRejectionReason(sketch)! } : {}),
            }
          : { key, label, outcome: "missing", ms },
      );
    }),
  );
  return clientCache;
}

/** Every distinct sketchKey in a scene, mapped to the label that should be drawn for it. */
function sketchPairs(objects: Array<{ sketchKey?: string; label?: string }>): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const o of objects) {
    if (o.sketchKey && o.label && !pairs.has(o.sketchKey)) pairs.set(o.sketchKey, o.label);
  }
  return pairs;
}

/**
 * The sketchKeys in this scene that are NOT already in the cache — i.e. the
 * ones that would cost a model call.
 *
 * Board's two-phase render asks this before committing the first structural
 * frame: an empty answer means every sketch in this scene is already in hand,
 * so the first frame is also the final one and there is no second commit to
 * schedule. See components/Board.tsx applyExpressionUpdate.
 */
export function pendingSketchKeys(
  objects: Array<{ sketchKey?: string; label?: string }>,
  clientCache: Map<string, Sketch>,
): string[] {
  return [...sketchPairs(objects).keys()].filter((key) => !clientCache.has(key));
}
