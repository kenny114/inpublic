"use client";

import { useEffect, useState } from "react";
import { latency, type LatencySummary } from "@/lib/latency";

/**
 * Development-only "how does this actually feel" panel.
 *
 * The console (`inpublic.latency()`) already prints the same numbers, but
 * reading a snapshot after the fact tells you nothing about *which* word felt
 * slow. This polls the same recorder every 500ms and stays on screen while
 * you speak, so a stall can be correlated to what happened around it by eye,
 * then confirmed against the exported log (` key marks the moment).
 *
 * Never rendered outside development — see the NODE_ENV gate where this is
 * mounted in Board.tsx.
 */
export function LatencyOverlay({ onMarkStall }: { onMarkStall: () => void }) {
  const [summary, setSummary] = useState<LatencySummary | null>(null);

  useEffect(() => {
    const id = setInterval(() => setSummary(latency.summary()), 500);
    return () => clearInterval(id);
  }, []);

  const stt = summary?.chunkToMessageP50 ?? null;
  const ink = summary?.renderP50 ?? null;
  const paint = summary?.paintP50 ?? null;
  // True wall-clock chunk-sent → ink committed. See lib/latency.ts's
  // "chunk_to_ink" SampleKey doc — this replaces `lagP50/P95/Max` as the
  // headline number because those are an audio-timeline diagnostic, not a
  // wall-clock latency measurement (LATENCY-AUDIT.md).
  const total = summary?.chunkToInkP50 ?? null;
  const totalP95 = summary?.chunkToInkP95 ?? null;
  const totalMax = summary?.chunkToInkMax ?? null;
  // Kept only as a secondary reference — audio-timeline relative, not precise.
  const refTotal = summary?.lagP50 ?? null;

  const row = (label: string, value: number | null, unit = "ms") => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ opacity: 0.7 }}>{label}</span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>
        {value === null ? "—" : `${value}${unit}`}
      </span>
    </div>
  );

  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        right: 12,
        zIndex: 9999,
        width: 200,
        padding: "8px 10px",
        borderRadius: 8,
        background: "rgba(20,20,20,0.85)",
        color: "#fff",
        fontSize: 11,
        fontFamily: "ui-monospace, monospace",
        lineHeight: 1.5,
        pointerEvents: "auto",
      }}
      aria-hidden="true"
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>SPEECH → INK (wall-clock)</div>
      {row("STT (chunk→msg)", stt)}
      {row("INK", ink)}
      {row("PAINT", paint)}
      {row("TOTAL p50", total)}
      {row("TOTAL p95", totalP95)}
      {row("TOTAL max", totalMax)}
      <div style={{ opacity: 0.5, marginTop: 4, fontSize: 10 }}>
        audio-timeline ref: {refTotal === null ? "—" : `${refTotal}ms`}
      </div>
      <div style={{ opacity: 0.6, marginTop: 4 }}>
        {summary?.interimCount ?? 0} interims, {summary?.longTaskCount ?? 0} long tasks
      </div>
      <button
        type="button"
        onClick={onMarkStall}
        style={{
          marginTop: 6,
          width: "100%",
          padding: "3px 0",
          borderRadius: 4,
          border: "1px solid rgba(255,255,255,0.3)",
          background: "transparent",
          color: "#fff",
          cursor: "pointer",
          fontSize: 11,
        }}
      >
        Mark stall (`)
      </button>
    </div>
  );
}
