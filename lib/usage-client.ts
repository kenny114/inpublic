"use client";

let activeUsageSessionId: string | null = null;
/**
 * Whether the active session id belongs to `anonymous_trials` rather than
 * `usage_sessions`.
 *
 * These are two separate ledgers with separate id spaces, and the server
 * cannot infer which one a given id came from — least of all from the auth
 * cookie, because a signed-in visitor opening /try is a perfectly ordinary
 * thing to do. When that happened, guardProviderRequest saw a valid user,
 * took its authenticated branch, looked the trial id up in usage_sessions,
 * found nothing, and reported the resulting miss as "expired_lease" — a
 * confusing message for a session that had been alive for seconds.
 *
 * So the client states which ledger it is using, and the guard trusts that
 * only as a routing hint: the anonymous path still independently validates
 * the signed anon cookie and the trial row's own lease before allowing
 * anything.
 */
let anonymousMode = false;
export function setActiveUsageSessionId(value: string | null, options?: { anonymous?: boolean }) {
  activeUsageSessionId = value;
  // Clearing the id also clears the mode, so a stopped anonymous session can
  // never leave the flag set for whatever starts next.
  anonymousMode = value === null ? false : options?.anonymous ?? anonymousMode;
}
export function getActiveUsageSessionId() { return activeUsageSessionId; }
export function providerRequestHeaders(extra: Record<string, string> = {}) {
  if (!activeUsageSessionId) return extra;
  const headers = { ...extra, "x-inpublic-session-id": activeUsageSessionId };
  return anonymousMode ? { ...headers, "x-inpublic-anon": "1" } : headers;
}
export function noteFinalTranscript() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("inpublic-final-transcript"));
}
