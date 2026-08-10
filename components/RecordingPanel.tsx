"use client";

import {
  Camera,
  Circle,
  Download,
  GripHorizontal,
  MicOff,
  Pause,
  RotateCcw,
  Settings2,
  Square,
  Subtitles,
  UserRound,
  X,
} from "lucide-react";
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { useCanvasRecorder, type RecordingSnapshot } from "@/hooks/useCanvasRecorder";
import { FREE_RECORDING_LIMIT_MS } from "@/lib/product";
import type { InPublicMode } from "@/lib/story";

type SurfacePosition = { left: number; top: number };

function formatDuration(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1_000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function useMovableSurface() {
  const [position, setPosition] = useState<SurfacePosition | null>(null);
  const drag = useRef<{ offsetX: number; offsetY: number; width: number; height: number } | null>(null);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const surface = event.currentTarget.closest<HTMLElement>("[data-movable-surface]");
    if (!surface) return;
    const bounds = surface.getBoundingClientRect();
    drag.current = {
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
      width: bounds.width,
      height: bounds.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    const edge = 10;
    setPosition({
      left: Math.min(Math.max(edge, event.clientX - drag.current.offsetX), window.innerWidth - drag.current.width - edge),
      top: Math.min(Math.max(68, event.clientY - drag.current.offsetY), window.innerHeight - drag.current.height - edge),
    });
  }, []);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const style: CSSProperties | undefined = position
    ? { left: position.left, top: position.top, right: "auto", bottom: "auto" }
    : undefined;

  return { style, handleProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp } };
}

export function RecordingPanel({
  target,
  getSnapshot,
  mode,
  onTranscriptVisibilityChange,
  onRecordingFocusChange,
  onListeningPause,
}: {
  target: HTMLElement | null;
  getSnapshot: () => RecordingSnapshot;
  mode: InPublicMode;
  onTranscriptVisibilityChange: (visible: boolean) => void;
  onRecordingFocusChange?: (active: boolean) => void;
  onListeningPause?: () => void;
}) {
  const recorder = useCanvasRecorder(target, getSnapshot);
  const dock = useMovableSurface();
  const camera = useMovableSurface();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const active = recorder.status === "recording" || recorder.status === "paused";

  useEffect(() => {
    onRecordingFocusChange?.(active);
  }, [active, onRecordingFocusChange]);

  useEffect(() => {
    if (!settingsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [settingsOpen]);

  const toggleTranscript = () => {
    const next = !recorder.options.transcript;
    recorder.setOptions((current) => ({ ...current, transcript: next }));
    onTranscriptVisibilityChange(next);
  };

  const toggleCamera = async () => {
    const opening = !recorder.options.webcam;
    await recorder.toggleWebcam();
    if (opening) setSettingsOpen(false);
  };
  const pauseRecording = () => { recorder.pause(); onListeningPause?.(); };

  return (
    <>
      {recorder.options.webcam && recorder.cameraStream ? (
        <section className="canvas-camera-preview" data-movable-surface style={camera.style} onPointerDown={(event) => event.stopPropagation()} aria-label="Camera preview">
          <div className="canvas-camera-handle" {...camera.handleProps}>
            <span><GripHorizontal size={14} />Camera</span>
            <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => void toggleCamera()} aria-label="Hide camera preview"><X size={14} /></button>
          </div>
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
          />
        </section>
      ) : null}

      {recorder.options.interface ? (
        <div className="canvas-interface-preview" aria-label="Recorded interface preview">
          <i className={active ? "active" : ""} />
          InPublic · <span>{mode} mode</span>{active ? ` · ${formatDuration(recorder.durationMs)}` : ""}
        </div>
      ) : null}

      {recorder.error ? (
        <div className="canvas-recorder-error" role="alert">
          <span>{recorder.error}</span>
          <button type="button" onClick={() => recorder.setError(null)} aria-label="Dismiss recording error"><X size={14} /></button>
        </div>
      ) : null}

      <section className="canvas-recording-dock" data-movable-surface style={dock.style} onPointerDown={(event) => event.stopPropagation()} aria-label="Video recording controls">
        <button type="button" className="canvas-drag-handle" aria-label="Move video recording controls" title="Drag to move" {...dock.handleProps}><GripHorizontal size={15} /></button>
        <span className={`canvas-recorder-state ${recorder.status}`} role="status"><i />{active ? formatDuration(recorder.durationMs) : recorder.status === "ready" ? "Saved" : "Video"}</span>

        {!active ? (
          <button type="button" onClick={() => void recorder.start()} className="canvas-record-button"><Circle size={11} />Record</button>
        ) : recorder.status === "paused" ? (
          <button type="button" onClick={recorder.resume} className="canvas-record-button"><Circle size={11} />Resume</button>
        ) : (
          <button type="button" onClick={pauseRecording} className="canvas-recorder-icon-action" aria-label="Pause recording" title="Pause"><Pause size={14} /></button>
        )}

        {active ? <button type="button" onClick={recorder.stop} className="canvas-recorder-icon-action danger" aria-label="Stop recording" title="Stop"><Square size={12} /></button> : null}
        {recorder.options.microphone && active ? <button type="button" aria-pressed={muted} onClick={() => setMuted(recorder.toggleMute())} className={`canvas-recorder-icon-action ${muted ? "selected" : ""}`} aria-label={muted ? "Unmute recording" : "Mute recording"} title={muted ? "Unmute" : "Mute"}><MicOff size={14} /></button> : null}
        {recorder.lastRecording ? <button type="button" onClick={recorder.exportLast} className="canvas-recorder-icon-action" aria-label="Download recording" title="Download"><Download size={14} /></button> : null}

        <div className="canvas-recorder-settings-wrap">
          <button type="button" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((value) => !value)} className={`canvas-recorder-icon-action ${settingsOpen ? "selected" : ""}`} aria-label="Recording settings" title="Recording settings"><Settings2 size={15} /></button>
          {settingsOpen ? (
            <div className="canvas-recorder-settings" role="dialog" aria-label="Recording settings">
              <div className="canvas-recorder-settings-heading"><div><strong>Video recording</strong><span>Choose what appears in the file.</span></div><button type="button" onClick={() => setSettingsOpen(false)} aria-label="Close recording settings"><X size={15} /></button></div>

              <div className="canvas-recorder-toggle-list">
                <button type="button" aria-pressed={recorder.options.webcam} onClick={() => void toggleCamera()}><span><Camera size={15} />Camera</span><b>{recorder.options.webcam ? "On" : "Off"}</b></button>
                <button type="button" aria-pressed={recorder.options.transcript} onClick={toggleTranscript}><span><Subtitles size={15} />Transcript</span><b>{recorder.options.transcript ? "On" : "Off"}</b></button>
                <button type="button" aria-pressed={recorder.options.interface} onClick={() => recorder.setOptions((current) => ({ ...current, interface: !current.interface }))}><span><UserRound size={15} />Interface badge</span><b>{recorder.options.interface ? "On" : "Off"}</b></button>
              </div>

              <div className="canvas-recorder-options">
                <label><span>Canvas video</span><input type="checkbox" checked={recorder.options.canvas} disabled={active} onChange={(event) => recorder.setOptions((current) => ({ ...current, canvas: event.target.checked }))} /></label>
                <label><span>Microphone audio</span><input type="checkbox" checked={recorder.options.microphone} disabled={active} onChange={(event) => recorder.setOptions((current) => ({ ...current, microphone: event.target.checked }))} /></label>
                <label><span>Quality</span><select value={recorder.options.quality} disabled={active} onChange={(event) => recorder.setOptions((current) => ({ ...current, quality: event.target.value as "720p" | "1080p" }))}><option value="720p">720p</option><option value="1080p">1080p</option></select></label>
              </div>

              {active ? <button type="button" className="canvas-recorder-restart" onClick={recorder.restart}><RotateCcw size={13} />Discard and restart</button> : null}
              <p>Recordings are limited to {FREE_RECORDING_LIMIT_MS / 60_000} minutes and stay in this browser.</p>
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
