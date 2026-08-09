/**
 * The dashboard's view of a session.
 *
 * The canvas stores raw state — elements, a semantic snapshot, a log. None of
 * that is a list row. This joins the session library with the recording store
 * and derives exactly the fields the dashboard shows, so no page has to reach
 * into a SemanticSnapshot to find a title.
 *
 * Everything here is derived from what is actually in this browser. A field
 * that cannot be derived is absent, not guessed.
 */

import { listSessions, type PersistedSession } from "./persist";
import { listRecordings, type SavedRecording } from "./recordings";
import type { InPublicMode } from "./story";

export interface SessionSummary {
  id: string;
  title: string;
  /** True when the title was derived rather than chosen by the user. */
  derivedTitle: boolean;
  mode: InPublicMode;
  updatedAt: number;
  /** Wall-clock length of the session, or null when it was never started. */
  durationMs: number | null;
  pages: number;
  elementCount: number;
  conceptCount: number;
  recordings: SavedRecording[];
  spokenWords: number;
  starred: boolean;
}

export type SessionStatus = "recorded" | "in-progress" | "draft";

export function statusOf(session: SessionSummary): SessionStatus {
  if (session.recordings.length > 0) return "recorded";
  if (session.elementCount > 0) return "in-progress";
  return "draft";
}

export const STATUS_LABEL: Record<SessionStatus, string> = {
  recorded: "Recorded",
  "in-progress": "In progress",
  draft: "Empty",
};

/**
 * A session has no name until someone gives it one. The best available stand-in
 * is what the speaker actually talked about: the first section heading the
 * organizer wrote, then the first concept it found.
 */
export function deriveTitle(session: PersistedSession): string {
  // Every board opens with a section literally called "Untitled" (see
  // SemanticBoard's constructor), so that one is a placeholder, not a heading.
  const section = session.semantic?.sections?.find(
    (item) => item.title?.trim() && item.title.trim().toLowerCase() !== "untitled",
  );
  if (section) return section.title.trim();

  const concept = session.semantic?.concepts?.find((item) => item.label?.trim());
  if (concept) return concept.label.trim();

  // Same fallback the recorder uses for its own titles: the opening words.
  const spoken = (session.log ?? []).find(
    (event): event is Extract<typeof event, { type: "transcript" }> =>
      event.type === "transcript" && Boolean(event.text?.trim()),
  );
  if (spoken) {
    const opening = spoken.text.trim().split(/\s+/).slice(0, 7).join(" ");
    if (opening) return opening;
  }

  return "Untitled session";
}

export function summarize(
  session: PersistedSession,
  recordings: SavedRecording[],
): SessionSummary {
  const id = session.id ?? "";
  const transcript = (session.log ?? []).filter(
    (event): event is Extract<typeof event, { type: "transcript" }> => event.type === "transcript",
  );
  return {
    id,
    title: session.title?.trim() || deriveTitle(session),
    derivedTitle: !session.title?.trim(),
    mode: session.mode ?? "standard",
    updatedAt: session.savedAt,
    durationMs: session.startedAt === null ? null : Math.max(0, session.savedAt - session.startedAt),
    // `page` is a zero-based index of the page last drawn on.
    pages: (session.page ?? 0) + 1,
    elementCount: session.elements?.length ?? 0,
    conceptCount: session.semantic?.concepts?.length ?? 0,
    starred: session.starred === true,
    recordings: recordings.filter((item) => item.metadata.sessionId === id),
    spokenWords: transcript.reduce(
      (total, event) => total + event.text.trim().split(/\s+/).filter(Boolean).length,
      0,
    ),
  };
}

export async function listSessionSummaries(): Promise<SessionSummary[]> {
  const [sessions, recordings] = await Promise.all([listSessions(), listRecordings()]);
  return sessions
    .filter((session) => Boolean(session.id))
    .map((session) => summarize(session, recordings));
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** "2 hours ago" reads better than a timestamp in a list of recent work. */
export function formatRelative(timestamp: number, now = Date.now()): string {
  const seconds = Math.round((now - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(timestamp).toLocaleDateString();
}

export const MODE_LABEL: Record<InPublicMode, string> = {
  standard: "Standard",
  story: "Story",
};
