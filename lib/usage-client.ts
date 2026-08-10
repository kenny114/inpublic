"use client";

let activeUsageSessionId: string | null = null;
export function setActiveUsageSessionId(value: string | null) { activeUsageSessionId = value; }
export function getActiveUsageSessionId() { return activeUsageSessionId; }
export function providerRequestHeaders(extra: Record<string, string> = {}) {
  return activeUsageSessionId ? { ...extra, "x-inpublic-session-id": activeUsageSessionId } : extra;
}
export function noteFinalTranscript() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("inpublic-final-transcript"));
}
