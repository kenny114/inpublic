/**
 * Workspace preferences that the dashboard actually acts on.
 *
 * Deliberately small. A preference only belongs here once something reads it —
 * a select that writes a key nothing consults is a dead control, and the
 * dashboard should not have any.
 */

import type { InPublicMode } from "./story";

export interface Preferences {
  /** Which mode "New session" opens by default. */
  defaultMode: InPublicMode;
  /** Shown in the greeting and the account menu when set. */
  displayName: string;
  /** Seeds the recorder's camera toggle. Read by hooks/useCanvasRecorder. */
  recordCameraByDefault: boolean;
  /** Seeds the canvas transcript strip. Read by components/Board. */
  showTranscriptByDefault: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  defaultMode: "standard",
  displayName: "",
  recordCameraByDefault: false,
  showTranscriptByDefault: false,
};

const KEY = "inpublic-preferences";
const EVENT = "inpublic-preferences-change";

export function readPreferences(): Preferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      // Story Mode was removed entirely — a preference set to "story" from
      // before removal (still sitting in someone's localStorage) must not
      // silently route "New session" into a mode that no longer exists.
      defaultMode: "standard",
      displayName: typeof parsed.displayName === "string" ? parsed.displayName : "",
      recordCameraByDefault: parsed.recordCameraByDefault === true,
      showTranscriptByDefault: parsed.showTranscriptByDefault === true,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function writePreferences(next: Preferences): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode — preferences last for the tab only */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function subscribePreferences(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}
