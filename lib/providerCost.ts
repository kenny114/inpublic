/**
 * Bound an audio-provider reservation to the window requested by the route,
 * while still respecting the user's remaining allowance and session limit.
 * Unlimited entitlements use a large integer sentinel, so the requested
 * window must participate in this minimum rather than merely acting as a flag.
 */
export function audioReservationSeconds(
  requestedSeconds: number,
  remainingSeconds: number,
  alreadyReservedSeconds: number,
  maxSessionSeconds: number,
  consumedSeconds: number,
) {
  if (!Number.isFinite(requestedSeconds) || requestedSeconds <= 0) return 0;
  return Math.max(0, Math.min(
    requestedSeconds,
    Math.max(0, remainingSeconds + alreadyReservedSeconds),
    Math.max(0, maxSessionSeconds - consumedSeconds),
  ));
}
