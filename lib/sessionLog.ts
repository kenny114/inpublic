import type { LogEvent } from "./types";
import type { InPublicMode, StoryState } from "./story";
import { exactMicAudio } from "./corpusAudio";

function downloadArtifact(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function downloadLog(
  events: LogEvent[],
  startedAt: number | null,
  story?: StoryState,
  mode: InPublicMode = "standard",
  sessionId?: string,
) {
  const exactMic = exactMicAudio.snapshot();
  const payload = {
    version: 2,
    sessionId: sessionId ?? null,
    startedAt: startedAt ? new Date(startedAt).toISOString() : null,
    mode,
    story,
    events,
    exactMicAudio: exactMic?.metadata ?? null,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  downloadArtifact(blob, `session-${stamp}.json`);
  if (exactMic) {
    downloadArtifact(exactMic.wav, "exact-mic-audio.wav");
    downloadArtifact(
      new Blob([JSON.stringify(exactMic.metadata, null, 2)], { type: "application/json" }),
      "exact-mic-audio.json",
    );
  }
}
