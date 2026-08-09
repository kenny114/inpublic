import type { LogEvent } from "./types";
import type { InPublicMode, StoryState } from "./story";

export function downloadLog(
  events: LogEvent[],
  startedAt: number | null,
  story?: StoryState,
  mode: InPublicMode = "standard",
) {
  const payload = {
    version: 2,
    startedAt: startedAt ? new Date(startedAt).toISOString() : null,
    mode,
    story,
    events,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const a = document.createElement("a");
  a.href = url;
  a.download = `session-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
