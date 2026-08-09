"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, ModeBadge } from "@/components/DashboardUI";
import { exportSession } from "@/components/SessionActions";
import { useSessionSummaries } from "@/hooks/useSessionSummaries";
import { downloadBlob, downloadRecordingMetadata, listRecordings, type SavedRecording } from "@/lib/recordings";
import { formatRelative } from "@/lib/sessions";

/**
 * Everything in this browser that can be downloaded right now. PNG, SVG and
 * Excalidraw exports are produced by the canvas toolbar and are not stored, so
 * they are described here rather than listed.
 */
export function ExportsList() {
  const { sessions, loading } = useSessionSummaries();
  const [recordings, setRecordings] = useState<SavedRecording[] | null>(null);

  useEffect(() => {
    void listRecordings().then(setRecordings).catch(() => setRecordings([]));
  }, []);

  const busy = loading || recordings === null;
  const savedSessions = sessions ?? [];
  const savedRecordings = recordings ?? [];

  if (busy) return <p className="mt-6 text-sm text-zinc-400">Checking this browser…</p>;

  if (savedSessions.length === 0 && savedRecordings.length === 0) {
    return (
      <div className="mt-6">
        <EmptyState
          title="Nothing to export yet."
          body="Session state and recordings become downloadable once you have made something on the canvas."
          action={<Link href="/create?mode=standard&new=1" className="inline-flex rounded-lg bg-zinc-950 px-3.5 py-2 text-sm font-medium text-white hover:bg-zinc-800">Start a session</Link>}
        />
      </div>
    );
  }

  return (
    <div className="mt-6 grid gap-6">
      {savedSessions.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">Session state</h2>
          <ul className="mt-3 divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
            {savedSessions.map((session) => (
              <li key={session.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{session.title}</span>
                <ModeBadge mode={session.mode} />
                <span className="text-xs text-zinc-500">{formatRelative(session.updatedAt)}</span>
                <button type="button" onClick={() => void exportSession(session)} className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-50">Download JSON</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {savedRecordings.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">Recordings</h2>
          <ul className="mt-3 divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
            {savedRecordings.map((recording) => (
              <li key={recording.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{recording.metadata.title}</span>
                <span className="text-xs text-zinc-500">{(recording.blob.size / 1_048_576).toFixed(1)} MB</span>
                <button type="button" onClick={() => downloadBlob(recording.blob, `inpublic-${recording.id}.webm`)} className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-50">WebM</button>
                <button type="button" onClick={() => downloadRecordingMetadata(recording.metadata)} className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-50">JSON</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
