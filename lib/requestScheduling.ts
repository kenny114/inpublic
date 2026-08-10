export interface RequestDelayInput {
  nowMs: number;
  lastRunAtMs: number;
  retryAtMs: number;
  lastPointerAtMs: number;
  minIntervalMs: number;
  touchLockMs: number;
}

/**
 * Keep every entry point on the same clock. Queued work, pointer activity and
 * a server cooldown must all pass through this calculation before a request.
 */
export function requestDelayMs(input: RequestDelayInput): number {
  return Math.max(
    0,
    input.minIntervalMs - (input.nowMs - input.lastRunAtMs),
    input.retryAtMs - input.nowMs,
    input.touchLockMs - (input.nowMs - input.lastPointerAtMs),
  );
}

/** Parse Retry-After in either seconds or HTTP-date form. */
export function retryAfterMs(
  value: string | null,
  fallbackMs: number,
  nowMs = Date.now(),
): number {
  if (!value) return fallbackMs;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }
  const retryAt = Date.parse(value);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - nowMs) : fallbackMs;
}
