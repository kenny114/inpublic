"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { track } from "@vercel/analytics";
import { setActiveUsageSessionId } from "@/lib/usage-client";

export interface ClientEntitlement { plan: "free" | "creator"; remainingSeconds: number; maxSessionSeconds: number; periodEnd: string; mayStart: boolean; unlimitedMinutes: boolean; }
interface Options { projectId: () => string; mode: () => "standard" | "story"; onForcedStop: (reason: string) => void; onWarning?: (message: string) => void; anonymous?: boolean }

/**
 * Anonymous /try sessions reuse this entire hook (heartbeat, idle detection,
 * background-pause, low-time warnings) unchanged — only the two endpoints
 * differ, and the anon POST body/response is deliberately the same shape
 * (`{id}` on start, ClientEntitlement-shaped on refresh) as the authenticated
 * ones so nothing else here needs to branch.
 */
/** Remaining-time marks worth telling the speaker about, in seconds. */
const WARNING_THRESHOLDS = [300, 60] as const;

function endpointsFor(anonymous: boolean) {
  return anonymous
    ? { entitlement: "/api/anon/entitlement", session: "/api/anon/session" }
    : { entitlement: "/api/entitlement", session: "/api/usage/session" };
}

export function useUsageSession({ projectId, mode, onForcedStop, onWarning, anonymous = false }: Options) {
  const endpoints = endpointsFor(anonymous);
  const [entitlement, setEntitlement] = useState<ClientEntitlement | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const lastFinalRef = useRef(Date.now());
  const backgroundTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnedRef = useRef(new Set<number>());
  // Anonymous-funnel timing markers. Never touched/read for authenticated
  // sessions — kept local to this hook rather than threaded through Board.tsx
  // so this stays a pure addition alongside existing logic.
  const anonSessionStartedAtRef = useRef<number | null>(null);
  const anonFirstTranscriptFiredRef = useRef(false);
  const anon60sFiredRef = useRef(false);

  const refreshEntitlement = useCallback(async () => {
    const response = await fetch(endpoints.entitlement, { cache: "no-store" });
    if (!response.ok) return null;
    const value = await response.json() as ClientEntitlement;
    setEntitlement(value); setRemainingSeconds(value.remainingSeconds); return value;
  }, [endpoints.entitlement]);

  // Returns the id of the session just stopped (or null if none was active),
  // because the caller may still need it after this resolves — most notably
  // to attach a closing latency summary to the right row. The module-level
  // active-session id is cleared immediately below and is gone by the time
  // any caller's own `await` resumes, so that global must never be the only
  // way to learn which session just ended.
  const stop = useCallback(async (reason = "user_stopped"): Promise<string | null> => {
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null; setActiveUsageSessionId(null);
    if (sessionId) {
      await fetch(endpoints.session, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, reason }), keepalive: true }).catch(() => undefined);
      await refreshEntitlement();
    }
    return sessionId;
  }, [endpoints.session, refreshEntitlement]);

  const forceStop = useCallback((reason: string, message: string) => {
    onForcedStop(reason); onWarning?.(message); void stop(reason);
  }, [onForcedStop, onWarning, stop]);

  // Extracted so it can be called once, on demand, right before the engine
  // mints a provider credential — not just from the 20s heartbeat interval
  // below (which also uses it). See listeningSession.ts for why: prewarm
  // (mic permission, SDK chunk) can take arbitrarily long while a lease
  // granted at press-time keeps ticking, and the credential mint is exactly
  // what checks that lease server-side.
  const renew = useCallback(async (): Promise<boolean> => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return false;
    const response = await fetch(endpoints.session, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId }) });
    if (!response.ok) { forceStop("lease_rejected", "Listening stopped because its server lease could not be renewed."); return false; }
    const updated = await refreshEntitlement();
    if (updated && updated.remainingSeconds <= 0) { forceStop("quota_exhausted", anonymous ? "Your free trial is finished. Create a free account to keep going." : "Your visual-speech minutes are finished for this period."); return false; }
    return true;
  }, [anonymous, endpoints.session, forceStop, refreshEntitlement]);

  const start = useCallback(async () => {
    const current = await refreshEntitlement();
    if (!current?.mayStart || current.remainingSeconds <= 0) { onWarning?.(anonymous ? "Your free trial is finished. Create a free account to keep going." : "Your visual-speech minutes are finished for this period."); return false; }
    const response = await fetch(endpoints.session, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: projectId(), mode: mode(), clientSessionId: crypto.randomUUID() }) });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      onWarning?.(payload?.error?.message ?? "Listening could not start."); return false;
    }
    const value = await response.json() as { id?: string } | { id?: string }[];
    const id = Array.isArray(value) ? value[0]?.id : value.id;
    if (!id) return false;
    sessionIdRef.current = id; setActiveUsageSessionId(id, { anonymous }); lastFinalRef.current = Date.now(); warnedRef.current.clear();
    // A threshold at or above the time available when listening STARTS is not
    // news — it is simply the whole allowance restated. An anonymous trial is
    // exactly 300s, so the 5-minute warning fired the instant the session
    // opened, on every single start, in a banner headed "InPublic needs your
    // attention". Seeding those as already-warned leaves only the marks the
    // speaker actually crosses mid-session.
    for (const threshold of WARNING_THRESHOLDS) {
      if (current.remainingSeconds <= threshold) warnedRef.current.add(threshold);
    }
    if (anonymous) {
      track("anonymous_session_started");
      anonSessionStartedAtRef.current = Date.now();
      anonFirstTranscriptFiredRef.current = false;
      anon60sFiredRef.current = false;
    }
    return true;
  }, [anonymous, endpoints.session, mode, onWarning, projectId, refreshEntitlement]);

  useEffect(() => { void refreshEntitlement(); }, [refreshEntitlement]);
  useEffect(() => {
    const final = () => {
      lastFinalRef.current = Date.now();
      if (anonymous && !anonFirstTranscriptFiredRef.current && anonSessionStartedAtRef.current) {
        anonFirstTranscriptFiredRef.current = true;
        const ms = Date.now() - anonSessionStartedAtRef.current;
        track("first_transcript_received", { ms });
        track("time_to_first_transcript", { ms });
      }
    };
    window.addEventListener("inpublic-final-transcript", final);
    return () => window.removeEventListener("inpublic-final-transcript", final);
  }, [anonymous]);
  useEffect(() => {
    const timer = window.setInterval(async () => {
      if (!sessionIdRef.current) return;
      if (Date.now() - lastFinalRef.current >= 90_000) return forceStop("idle_microphone", "Listening paused after 90 seconds without finalized speech.");
      await renew();
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [forceStop, renew]);
  useEffect(() => { const timer = window.setInterval(() => { if (sessionIdRef.current && !entitlement?.unlimitedMinutes) setRemainingSeconds((value) => value === null ? value : Math.max(0, value - 1)); }, 1000); return () => window.clearInterval(timer); }, [entitlement?.unlimitedMinutes]);
  useEffect(() => {
    if (!anonymous || anon60sFiredRef.current || remainingSeconds === null || !entitlement) return;
    const elapsed = entitlement.maxSessionSeconds - remainingSeconds;
    if (elapsed >= 60) { anon60sFiredRef.current = true; track("anonymous_60_seconds_used"); }
  }, [anonymous, entitlement, remainingSeconds]);
  useEffect(() => { if (remainingSeconds === null || entitlement?.unlimitedMinutes) return; for (const threshold of WARNING_THRESHOLDS) if (remainingSeconds <= threshold && !warnedRef.current.has(threshold)) { warnedRef.current.add(threshold); onWarning?.(threshold === 300 ? "Five minutes of visual-speech time remain." : "One minute of visual-speech time remains."); } }, [entitlement?.unlimitedMinutes, onWarning, remainingSeconds]);
  useEffect(() => {
    const changed = () => { if (backgroundTimerRef.current) clearTimeout(backgroundTimerRef.current); if (document.hidden && sessionIdRef.current) { const seconds = Number(process.env.NEXT_PUBLIC_BACKGROUND_PAUSE_SECONDS) || 30; backgroundTimerRef.current = setTimeout(() => forceStop("tab_backgrounded", "Listening paused while this tab was in the background."), seconds * 1000); } };
    document.addEventListener("visibilitychange", changed); return () => { document.removeEventListener("visibilitychange", changed); if (backgroundTimerRef.current) clearTimeout(backgroundTimerRef.current); };
  }, [forceStop]);
  useEffect(() => () => { void stop("page_closed"); }, [stop]);
  return { start, stop, renew, sessionIdRef, entitlement, remainingSeconds };
}
