"use client";

import { getActiveUsageSessionId } from "./usage-client";
import type { LatencySummary, DiagnosticTraces } from "./latency";

/**
 * Transport for latency summaries. Deliberately dumb and deliberately silent.
 *
 * Three properties matter more than completeness here:
 *
 * - **It cannot block the live path.** Nothing in this file is ever awaited by
 *   a caller on the speech path. `record()` returns void after a synchronous
 *   array push.
 * - **It cannot throw into the live path.** Every branch is wrapped. A broken
 *   analytics endpoint, a full localStorage quota, a browser with storage
 *   disabled — all of them must degrade to "no telemetry", never to "no ink".
 * - **It cannot grow without bound.** The queue and the local ring buffer are
 *   both capped.
 *
 * Two destinations, because they answer different questions. localStorage is
 * for the developer sitting in front of the machine right now and works with
 * no infrastructure at all. The API is for aggregating across sessions and
 * machines, and is skipped entirely when there is no usage session to attach
 * the rows to.
 */

const STORAGE_KEY = "inpublic-latency-samples";
/** Roughly a day of ordinary use; small enough to stay well inside quota. */
const MAX_STORED = 50;
const FLUSH_DELAY_MS = 2000;
const MAX_QUEUE = 20;

/**
 * Each summary carries the id of the session it belongs to at the moment it
 * was recorded, not a reference to the mutable global.
 *
 * `getActiveUsageSessionId()` is cleared the instant a session stops, and a
 * summary is only ever recorded *after* that stop resolves — so reading the
 * global at flush time (up to `FLUSH_DELAY_MS` later, or on pagehide) would
 * always see null. Capturing it per-entry at record time, and letting the
 * caller override it with the id `usage.stop()` just handed back, is what
 * makes the id available at all.
 */
interface QueuedSample {
  summary: LatencySummary;
  sessionId: string | null;
  traces: DiagnosticTraces | null;
}

let queue: QueuedSample[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const isDev = process.env.NODE_ENV === "development";

function readStored(): LatencySummary[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LatencySummary[]) : [];
  } catch {
    return [];
  }
}

function storeLocally(summary: LatencySummary): void {
  try {
    if (typeof window === "undefined") return;
    const rows = readStored();
    rows.push(summary);
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(rows.slice(-MAX_STORED)),
    );
  } catch {
    /* quota exceeded, storage disabled, private mode — all non-events */
  }
}

/** Everything stored locally, newest last. For the console and the export. */
export function storedLatencySamples(): LatencySummary[] {
  if (typeof window === "undefined") return [];
  return readStored();
}

export function clearStoredLatencySamples(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do and nothing worth reporting */
  }
}

function postSamples(
  sessionId: string,
  items: { summary: LatencySummary; traces: DiagnosticTraces | null }[],
): void {
  try {
    const samples = items.map(({ summary, traces }) => ({ ...summary, traces }));
    void fetch("/api/telemetry/latency", {
      method: "POST",
      headers: { "content-type": "application/json", "x-inpublic-session-id": sessionId },
      body: JSON.stringify({ samples }),
      keepalive: true,
    })
      .then((response) => {
        if (!response.ok && isDev) {
          void response
            .text()
            .catch(() => "")
            .then((text) => {
              console.warn(
                `[latency] telemetry POST rejected (${response.status}): ${text || "no body"}`,
              );
            });
        }
      })
      .catch((err) => {
        if (isDev) console.warn("[latency] telemetry POST threw", err);
      });
  } catch (err) {
    /* fetch itself unavailable; give up quietly in production */
    if (isDev) console.warn("[latency] telemetry POST could not be started", err);
  }
}

function send(batch: QueuedSample[]): void {
  if (!batch.length) return;
  // Grouped by session id rather than sent as one array, because the queue
  // can span more than one stopped session (rare, but MAX_QUEUE allows it),
  // and each row needs to attach to the session that actually produced it.
  const groups = new Map<string, { summary: LatencySummary; traces: DiagnosticTraces | null }[]>();
  for (const { summary, sessionId, traces } of batch) {
    if (!sessionId) {
      // No lease means no row to attach this to server-side, and minting one
      // just to carry telemetry would be a cost and abuse surface for no
      // benefit. The local copy already happened, so nothing is lost that we
      // had — but in development this should be loud, because a session that
      // silently drops its summary is exactly the bug this file exists to
      // catch.
      if (isDev) console.warn("[latency] summary has no session id — dropped, not sent", summary);
      continue;
    }
    const list = groups.get(sessionId) ?? [];
    list.push({ summary, traces });
    groups.set(sessionId, list);
  }
  for (const [sessionId, items] of groups) postSamples(sessionId, items);
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushLatency();
  }, FLUSH_DELAY_MS);
}

/** Push whatever is queued. Safe to call at any time, including on unload. */
export function flushLatency(): void {
  if (!queue.length) return;
  const batch = queue;
  queue = [];
  send(batch);
}

/**
 * Record one finished session summary.
 *
 * Called at most once per listening session, on stop, so the batching here
 * is generous rather than tight.
 *
 * `sessionId` should be the id the caller's own stop call just resolved
 * with — `usage.stop()` returns it for exactly this reason. Falling back to
 * `getActiveUsageSessionId()` exists only for callers that record a summary
 * without having just stopped a session themselves; by the time a session's
 * own stop has resolved, that global is already null.
 */
export function recordLatencySummary(
  summary: LatencySummary,
  sessionId: string | null = getActiveUsageSessionId(),
  traces: DiagnosticTraces | null = null,
): void {
  try {
    storeLocally(summary);
    queue.push({ summary, sessionId, traces });
    if (isDev && !sessionId) {
      console.warn(
        "[latency] recordLatencySummary called with no session id — this summary will be kept locally but never reach the server",
      );
    }
    if (queue.length >= MAX_QUEUE) flushLatency();
    else scheduleFlush();
  } catch {
    /* never let measurement break the thing being measured */
  }
}

if (typeof window !== "undefined") {
  // pagehide beats unload on mobile Safari, and both are best-effort. The
  // keepalive flag on the fetch is what actually makes this land.
  window.addEventListener("pagehide", () => flushLatency());
}
