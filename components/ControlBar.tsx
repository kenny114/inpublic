"use client";

import { Mic, Pause, Play, Square } from "lucide-react";
import { useState } from "react";
import { RecordingStatus } from "@/components/ProductUI";
import type { MicStatus } from "@/hooks/useDeepgram";
import type { InPublicMode } from "@/lib/story";

export function ControlBar({ status, busy, onToggleMic, onFinish, mode, onModeChange }: { status: MicStatus; busy: boolean; onToggleMic: () => void; onFinish: () => void; mode: InPublicMode; onModeChange: (mode: InPublicMode) => void }) {
  const [started, setStarted] = useState(false);
  const live = status === "live" || status === "reconnecting";
  const connecting = status === "connecting" || status === "reconnecting";
  const toggle = () => { setStarted(true); onToggleMic(); };
  return (
    <div className="canvas-speaking-control" onPointerDown={(event) => event.stopPropagation()} aria-label="Speaking controls">
      <RecordingStatus active={live} busy={busy} connecting={connecting} error={status === "error"} />
      <span className="canvas-control-divider" />
      <div className="canvas-mode-control" role="group" aria-label="Canvas mode">
        {(["standard", "story"] as const).map((value) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => onModeChange(value)}>{value === "standard" ? "Standard" : "Story"}</button>)}
      </div>
      <span className="canvas-control-divider" />
      {!live ? (
        <>
          <button type="button" className="canvas-speak-primary" onClick={toggle} disabled={connecting}>{started ? <Play size={15} /> : <Mic size={15} />}{started ? "Resume" : "Start speaking"}</button>
          <button type="button" className="canvas-speak-secondary" onClick={onFinish}><Square size={13} />Finish</button>
        </>
      ) : (
        <>
          <button type="button" className="canvas-speak-secondary" onClick={toggle}><Pause size={15} />Pause</button>
          <button type="button" className="canvas-speak-primary" onClick={onFinish}><Square size={13} />Finish</button>
        </>
      )}
    </div>
  );
}

export function ErrorBanner({ text, onDismiss, onRetry }: { text: string | null; onDismiss: () => void; onRetry?: () => void }) {
  if (!text) return null;
  return (
    <div className="canvas-error" role="alert" onPointerDown={(event) => event.stopPropagation()}>
      <div><strong>InPublic needs your attention</strong><span>{text}</span></div>
      {onRetry ? <button type="button" onClick={onRetry}>Try again</button> : null}
      <button type="button" onClick={onDismiss}>Dismiss</button>
    </div>
  );
}
