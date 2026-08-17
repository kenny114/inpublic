/**
 * Replay provider authorization is deliberately narrower than the UI flag.
 * It exists only for a loopback development server and always fails closed in
 * production. Query parameters are intentionally irrelevant here.
 */
export function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function mayIssueDevelopmentReplayAuthorization(
  nodeEnv: string | undefined,
  requestUrl: string,
  origin: string | null,
): boolean {
  if (nodeEnv !== "development" || !origin) return false;
  try {
    const target = new URL(requestUrl);
    const source = new URL(origin);
    return target.origin === source.origin && isLoopbackHostname(target.hostname);
  } catch {
    return false;
  }
}
