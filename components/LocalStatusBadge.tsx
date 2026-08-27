"use client";

import { useEffect, useState } from "react";

/**
 * Development-only "what's actually running" indicator for the local
 * intelligence stack (Ollama + Moonshine). Polls
 * app/api/dev/local-status/route.ts, which 404s outside NODE_ENV
 * development, so this renders nothing and costs nothing in production.
 *
 * Never rendered outside development — see the NODE_ENV gate where this is
 * mounted in Board.tsx, next to LatencyOverlay.
 */
interface LocalStatus {
  llmProvider: string;
  ollamaModel: string;
  speechEngine: string;
  remoteCallCount: number;
}

export function LocalStatusBadge() {
  const [status, setStatus] = useState<LocalStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/dev/local-status", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as LocalStatus;
        if (!cancelled) setStatus(data);
      } catch {
        /* dev-only, best effort */
      }
    };
    void poll();
    const id = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!status) return null;

  const isLocal = status.llmProvider === "ollama";
  const isLocalSpeech = status.speechEngine === "moonshine";

  return (
    <div
      style={{
        position: "fixed",
        left: 12,
        bottom: 12,
        zIndex: 90,
        fontFamily: "monospace",
        fontSize: 11,
        lineHeight: 1.5,
        background: "rgba(0,0,0,0.75)",
        color: "#e5e5e5",
        padding: "6px 10px",
        borderRadius: 6,
        pointerEvents: "none",
      }}
    >
      <div>STT: {status.speechEngine} — {isLocalSpeech ? "Local" : "Cloud"}</div>
      <div>LLM: {isLocal ? status.ollamaModel : status.llmProvider} — {isLocal ? "Ollama Local" : "Cloud"}</div>
      <div>Cloud calls: {status.remoteCallCount}</div>
    </div>
  );
}
