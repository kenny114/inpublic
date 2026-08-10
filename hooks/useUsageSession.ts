"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { setActiveUsageSessionId } from "@/lib/usage-client";

export interface ClientEntitlement { plan: "free" | "creator"; remainingSeconds: number; maxSessionSeconds: number; periodEnd: string; mayStart: boolean; }
interface Options { projectId: () => string; mode: () => "standard" | "story"; onForcedStop: (reason: string) => void; onWarning?: (message: string) => void; }

export function useUsageSession({ projectId, mode, onForcedStop, onWarning }: Options) {
  const [entitlement, setEntitlement] = useState<ClientEntitlement | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const lastFinalRef = useRef(Date.now());
  const backgroundTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnedRef = useRef(new Set<number>());

  const refreshEntitlement = useCallback(async () => {
    const response = await fetch("/api/entitlement", { cache: "no-store" });
    if (!response.ok) return null;
    const value = await response.json() as ClientEntitlement;
    setEntitlement(value); setRemainingSeconds(value.remainingSeconds); return value;
  }, []);

  const stop = useCallback(async (reason = "user_stopped") => {
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null; setActiveUsageSessionId(null);
    if (sessionId) {
      await fetch("/api/usage/session", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, reason }), keepalive: true }).catch(() => undefined);
      await refreshEntitlement();
    }
  }, [refreshEntitlement]);

  const forceStop = useCallback((reason: string, message: string) => {
    onForcedStop(reason); onWarning?.(message); void stop(reason);
  }, [onForcedStop, onWarning, stop]);

  const start = useCallback(async () => {
    const current = await refreshEntitlement();
    if (!current?.mayStart || current.remainingSeconds <= 0) { onWarning?.("Your visual-speech minutes are finished for this period."); return false; }
    const response = await fetch("/api/usage/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: projectId(), mode: mode(), clientSessionId: crypto.randomUUID() }) });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      onWarning?.(payload?.error?.message ?? "Listening could not start."); return false;
    }
    const value = await response.json() as { id?: string } | { id?: string }[];
    const id = Array.isArray(value) ? value[0]?.id : value.id;
    if (!id) return false;
    sessionIdRef.current = id; setActiveUsageSessionId(id); lastFinalRef.current = Date.now(); warnedRef.current.clear(); return true;
  }, [mode, onWarning, projectId, refreshEntitlement]);

  useEffect(() => { void refreshEntitlement(); }, [refreshEntitlement]);
  useEffect(() => { const final = () => { lastFinalRef.current = Date.now(); }; window.addEventListener("inpublic-final-transcript", final); return () => window.removeEventListener("inpublic-final-transcript", final); }, []);
  useEffect(() => {
    const timer = window.setInterval(async () => {
      const sessionId = sessionIdRef.current; if (!sessionId) return;
      if (Date.now() - lastFinalRef.current >= 90_000) return forceStop("idle_microphone", "Listening paused after 90 seconds without finalized speech.");
      const response = await fetch("/api/usage/session", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId }) });
      if (!response.ok) return forceStop("lease_rejected", "Listening stopped because its server lease could not be renewed.");
      const updated = await refreshEntitlement(); if (updated && updated.remainingSeconds <= 0) forceStop("quota_exhausted", "Your visual-speech minutes are finished for this period.");
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [forceStop, refreshEntitlement]);
  useEffect(() => { const timer = window.setInterval(() => { if (sessionIdRef.current) setRemainingSeconds((value) => value === null ? value : Math.max(0, value - 1)); }, 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { if (remainingSeconds === null) return; for (const threshold of [300, 60]) if (remainingSeconds <= threshold && !warnedRef.current.has(threshold)) { warnedRef.current.add(threshold); onWarning?.(threshold === 300 ? "Five minutes of visual-speech time remain." : "One minute of visual-speech time remains."); } }, [onWarning, remainingSeconds]);
  useEffect(() => {
    const changed = () => { if (backgroundTimerRef.current) clearTimeout(backgroundTimerRef.current); if (document.hidden && sessionIdRef.current) { const seconds = Number(process.env.NEXT_PUBLIC_BACKGROUND_PAUSE_SECONDS) || 30; backgroundTimerRef.current = setTimeout(() => forceStop("tab_backgrounded", "Listening paused while this tab was in the background."), seconds * 1000); } };
    document.addEventListener("visibilitychange", changed); return () => { document.removeEventListener("visibilitychange", changed); if (backgroundTimerRef.current) clearTimeout(backgroundTimerRef.current); };
  }, [forceStop]);
  useEffect(() => () => { void stop("page_closed"); }, [stop]);
  return { start, stop, sessionIdRef, entitlement, remainingSeconds };
}
