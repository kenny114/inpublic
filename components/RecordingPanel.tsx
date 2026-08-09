"use client";

import { useState } from "react";
import { useCanvasRecorder, type RecordingSnapshot } from "@/hooks/useCanvasRecorder";
import { DISCORD_URL, FREE_RECORDING_LIMIT_MS } from "@/lib/product";
import type { InPublicMode } from "@/lib/story";

function formatDuration(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1_000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function RecordingPanel({
  target,
  getSnapshot,
  mode,
  onTranscriptVisibilityChange,
}: {
  target: HTMLElement | null;
  getSnapshot: () => RecordingSnapshot;
  mode: InPublicMode;
  onTranscriptVisibilityChange: (visible: boolean) => void;
}) {
  const recorder = useCanvasRecorder(target, getSnapshot);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const active = recorder.status === "recording" || recorder.status === "paused";

  return (
    <>
      {recorder.options.webcam && recorder.cameraStream && (
        <div className="pointer-events-none fixed right-4 top-20 z-[60] aspect-video w-[min(320px,28vw)] min-w-44 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-950 shadow-lg" aria-label="Camera preview">
          <video
            ref={(node) => {
              if (node && node.srcObject !== recorder.cameraStream) {
                node.srcObject = recorder.cameraStream;
                void node.play().catch(() => {});
              }
            }}
            autoPlay
            muted
            playsInline
            className="h-full w-full -scale-x-100 object-cover"
          />
          <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-[10px] font-medium text-white">Camera preview</span>
        </div>
      )}

      {recorder.options.interface && (
        <div className="pointer-events-none fixed left-4 top-20 z-[60] flex items-center gap-2 rounded-lg border border-zinc-200 bg-white/95 px-3 py-2 text-xs font-medium text-zinc-700 shadow-sm" aria-label="Recorded interface preview">
          <span className={`h-2 w-2 rounded-full ${active ? "animate-pulse bg-red-500" : "bg-zinc-300"}`} />
          InPublic · <span className="capitalize">{mode} Mode</span>{active ? ` · ${formatDuration(recorder.durationMs)}` : ""}
        </div>
      )}

      {recorder.error && (
        <div className="fixed right-3 top-3 z-[70] max-w-sm rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 shadow-sm" role="alert">
          <div className="flex items-start gap-3">
            <span>{recorder.error}</span>
            <button type="button" onClick={() => recorder.setError(null)} aria-label="Dismiss recording error">×</button>
          </div>
        </div>
      )}

      <div
        className="fixed bottom-3 right-3 z-[65] flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center justify-end gap-1.5 rounded-xl border border-zinc-200 bg-white/95 p-1.5 text-xs shadow-sm backdrop-blur"
        onPointerDown={(event) => event.stopPropagation()}
        aria-label="Recording controls"
      >
        <span className="flex min-w-[72px] items-center gap-1.5 px-1.5 font-medium text-zinc-700" role="status">
          <span className={`h-2 w-2 rounded-full ${recorder.status === "recording" ? "animate-pulse bg-red-500" : recorder.status === "paused" ? "bg-amber-500" : recorder.status === "ready" ? "bg-emerald-500" : "bg-zinc-300"}`} />
          {active ? formatDuration(recorder.durationMs) : recorder.status === "ready" ? "Saved" : "Ready"}
        </span>

        {!active ? (
          <button type="button" onClick={() => void recorder.start()} className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white hover:bg-zinc-700">
            Record
          </button>
        ) : recorder.status === "paused" ? (
          <button type="button" onClick={recorder.resume} className="rounded-md bg-zinc-900 px-2.5 py-1.5 font-medium text-white">Resume</button>
        ) : (
          <button type="button" onClick={recorder.pause} className="rounded-md px-2.5 py-1.5 font-medium text-zinc-700 hover:bg-zinc-100">Pause</button>
        )}

        {active && (
          <>
            <button type="button" onClick={recorder.stop} className="rounded-md px-2 py-1.5 font-medium text-red-600 hover:bg-red-50">Stop</button>
            <button type="button" onClick={recorder.restart} className="rounded-md px-2 py-1.5 text-zinc-600 hover:bg-zinc-100" title="Discard this take and restart">Restart</button>
            {recorder.options.microphone && <button
              type="button"
              aria-pressed={muted}
              onClick={() => setMuted(recorder.toggleMute())}
              className={`rounded-md px-2 py-1.5 ${muted ? "bg-amber-50 text-amber-800" : "text-zinc-600 hover:bg-zinc-100"}`}
              title="Mute the recording microphone without stopping speech recognition"
            >
              {muted ? "Unmute" : "Mute"}
            </button>}
          </>
        )}

        <button type="button" aria-pressed={recorder.options.webcam} onClick={() => void recorder.toggleWebcam()} className={`rounded-md px-2 py-1.5 ${recorder.options.webcam ? "bg-indigo-50 text-indigo-700" : "text-zinc-600 hover:bg-zinc-100"}`} title="Show a live camera preview and include it in the WebM">
          Camera
        </button>
        <button type="button" aria-pressed={recorder.options.transcript} onClick={() => { const next = !recorder.options.transcript; recorder.setOptions((current) => ({ ...current, transcript: next })); onTranscriptVisibilityChange(next); }} className={`rounded-md px-2 py-1.5 ${recorder.options.transcript ? "bg-indigo-50 text-indigo-700" : "text-zinc-600 hover:bg-zinc-100"}`} title="Show the transcript on the workspace and include it in the WebM">
          Transcript
        </button>
        <button type="button" aria-pressed={recorder.options.interface} onClick={() => recorder.setOptions((current) => ({ ...current, interface: !current.interface }))} className={`rounded-md px-2 py-1.5 ${recorder.options.interface ? "bg-indigo-50 text-indigo-700" : "text-zinc-600 hover:bg-zinc-100"}`} title="Preview and include a minimal InPublic status badge in the WebM">
          Interface
        </button>

        {recorder.lastRecording && (
          <button type="button" onClick={recorder.exportLast} className="rounded-md bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-500">
            Export WebM
          </button>
        )}

        <div className="relative">
          <button type="button" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((value) => !value)} className="rounded-md px-2 py-1.5 text-zinc-600 hover:bg-zinc-100" title="Recording settings">Settings</button>
          {settingsOpen && (
            <div className="absolute bottom-10 right-0 w-64 rounded-xl border border-zinc-200 bg-white p-3 text-zinc-700 shadow-lg">
              <p className="mb-3 font-semibold text-zinc-950">Recording settings</p>
              <label className="mb-2 flex items-center justify-between gap-4"><span>Canvas video</span><input type="checkbox" checked={recorder.options.canvas} disabled={active} onChange={(event) => recorder.setOptions((current) => ({ ...current, canvas: event.target.checked }))} /></label>
              <label className="mb-2 flex items-center justify-between gap-4"><span>Microphone audio</span><input type="checkbox" checked={recorder.options.microphone} disabled={active} onChange={(event) => recorder.setOptions((current) => ({ ...current, microphone: event.target.checked }))} /></label>
              <label className="mb-2 flex items-center justify-between gap-4"><span>Quality</span><select value={recorder.options.quality} disabled={active} onChange={(event) => recorder.setOptions((current) => ({ ...current, quality: event.target.value as "720p" | "1080p" }))} className="rounded border border-zinc-200 px-1 py-0.5"><option value="720p">720p</option><option value="1080p">1080p</option></select></label>
              <p className="mt-3 border-t border-zinc-100 pt-2 text-[11px] leading-4 text-zinc-500">Early access recordings are limited to {FREE_RECORDING_LIMIT_MS / 60_000} minutes. Files and session data stay in this browser.</p>
            </div>
          )}
        </div>
      </div>

      {recorder.status === "ready" && recorder.lastRecording && (
        <div className="fixed bottom-16 right-3 z-[60] w-72 rounded-xl border border-zinc-200 bg-white p-3 text-xs text-zinc-600 shadow-md" onPointerDown={(event) => event.stopPropagation()}>
          <p className="font-semibold text-zinc-950">Recording saved locally</p>
          <p className="mt-1">{formatDuration(recorder.lastRecording.metadata.durationMs)} · {(recorder.lastRecording.blob.size / 1_048_576).toFixed(1)} MB · WebM</p>
          <div className="mt-3 flex items-center gap-3"><a href="/dashboard/sessions" className="font-medium text-indigo-600">View session</a><a href={DISCORD_URL} target="_blank" rel="noreferrer" className="font-medium text-zinc-700">Share in Discord</a></div>
        </div>
      )}
    </>
  );
}
