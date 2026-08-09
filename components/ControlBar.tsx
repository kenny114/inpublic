"use client";

import type { MicStatus } from "@/hooks/useDeepgram";
import type { InPublicMode } from "@/lib/story";

const DOT: Record<MicStatus, string> = {
  idle: "#9ca3af",
  connecting: "#f59e0b",
  live: "#ef4444",
  reconnecting: "#f59e0b",
  error: "#dc2626",
};

export function ControlBar({
  status,
  busy,
  onToggleMic,
  onDownload,
  onExport,
  mode,
  onModeChange,
}: {
  status: MicStatus;
  /** True while a beat check, artist call, or render is in flight. */
  busy: boolean;
  onToggleMic: () => void;
  onDownload: () => void;
  onExport: (kind: "png" | "svg" | "excalidraw" | "json") => void;
  mode: InPublicMode;
  onModeChange: (mode: InPublicMode) => void;
}) {
  const live = status === "live" || status === "reconnecting";

  return (
    <div
      className="pointer-events-auto fixed bottom-16 left-3 z-50 flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center gap-2 rounded-lg bg-white/80 px-2 py-1.5 opacity-40 shadow-sm ring-1 ring-black/5 transition-opacity duration-200 hover:opacity-100 sm:bottom-3"
      // Keep Excalidraw from treating bar clicks as canvas interaction.
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={onToggleMic}
        title={live ? "Stop listening (Space)" : "Start listening (Space)"}
        className="rounded px-2 py-0.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
      >
        {live ? "Stop" : "Mic"}
      </button>

      <span
        title={`${status}${busy ? " · working" : ""}`}
        className="h-2 w-2 rounded-full"
        style={{
          background: DOT[status],
          boxShadow: busy ? "0 0 0 3px rgba(59,130,246,0.35)" : undefined,
          animation:
            status === "reconnecting" ? "pulse 1s ease-in-out infinite" : undefined,
        }}
      />

      <span className="mx-0.5 h-3 w-px bg-neutral-300" />

      <div
        className="flex rounded bg-neutral-100 p-0.5"
        role="group"
        aria-label="Drawing mode"
      >
        {(["standard", "story"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onModeChange(value)}
            aria-pressed={mode === value}
            className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${
              mode === value
                ? "bg-white text-neutral-900 shadow-sm"
                : "text-neutral-500 hover:text-neutral-800"
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      <span className="mx-0.5 h-3 w-px bg-neutral-300" />

      {(["png", "svg", "excalidraw", "json"] as const).map((kind) => (
        <button
          key={kind}
          type="button"
          onClick={() => onExport(kind)}
          title={
            kind === "json"
              ? "Export the semantic board: concepts, relationships, history"
              : `Export the canvas as ${kind.toUpperCase()}`
          }
          className="rounded px-1.5 py-0.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
        >
          {kind === "excalidraw" ? "excal" : kind}
        </button>
      ))}

      <button
        type="button"
        onClick={onDownload}
        title="Download session log"
        className="rounded px-2 py-0.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
      >
        Log
      </button>
    </div>
  );
}

/**
 * Failures used to be silent — a dropped Deepgram socket simply ended the take
 * with no signal at all. This is deliberately non-modal: it must never cover
 * the canvas or steal focus mid-recording.
 */
export function ErrorBanner({
  text,
  onDismiss,
}: {
  text: string | null;
  onDismiss: () => void;
}) {
  if (!text) return null;
  return (
    <div
      className="pointer-events-auto fixed top-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-900 shadow-sm ring-1 ring-amber-200"
      onPointerDown={(e) => e.stopPropagation()}
      role="status"
    >
      <span>{text}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded px-1 text-amber-700 hover:bg-amber-100"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
