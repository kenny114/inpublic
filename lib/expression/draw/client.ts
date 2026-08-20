/**
 * Client-side counterpart of lib/expression/draw/resolve.ts: the browser has
 * no Anthropic key, so this calls app/api/sketch/route.ts instead of the
 * model directly. Mirrors lib/expression/meaning/client.ts's shape for the
 * same reason that module exists — one fetch, one JSON parse, fails closed.
 */

import type { Sketch } from "./schemas";

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
): Promise<Map<string, Sketch>> {
  const pairs = new Map<string, string>();
  for (const o of objects) {
    if (o.sketchKey && o.label && !pairs.has(o.sketchKey)) pairs.set(o.sketchKey, o.label);
  }
  const missing = [...pairs.entries()].filter(([key]) => !clientCache.has(key));
  await Promise.all(
    missing.map(async ([key, label]) => {
      const entityType = key.split(":")[0];
      const sketch = await fetchSketch(entityType, label);
      if (sketch) clientCache.set(key, sketch);
    }),
  );
  return clientCache;
}
