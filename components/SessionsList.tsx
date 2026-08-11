"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "@/components/DashboardUI";
import { ModeBadge } from "@/components/DashboardUI";
import { deleteRecording, downloadBlob, downloadRecordingMetadata, extensionForMimeType, listRecordings, type SavedRecording } from "@/lib/recordings";
import { formatRelative } from "@/lib/sessions";

function duration(value: number) {
  const seconds = Math.round(value / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The recording library. Everything shown is a video actually stored here. */
export function SessionsList() {
  const [items, setItems] = useState<SavedRecording[] | null>(null);

  const refresh = useCallback(() => {
    void listRecordings().then(setItems).catch(() => setItems([]));
  }, []);
  useEffect(refresh, [refresh]);

  if (items === null) return <p className="mt-6 text-sm text-zinc-400">Loading recordings from this browser…</p>;

  if (!items.length) {
    return (
      <div className="mt-6">
        <EmptyState
          title="Your recordings will appear here once you record a session."
          body="Recording captures the canvas, your microphone, and an optional camera. Start it from the control bar on the canvas."
          action={<Link href="/create?mode=standard&new=1" className="inline-flex rounded-lg bg-zinc-950 px-3.5 py-2 text-sm font-medium text-white hover:bg-zinc-800">Start a session</Link>}
        />
      </div>
    );
  }

  return (
    <div className="mt-6 grid gap-3">
      {items.map((item) => (
        <article key={item.id} className="rounded-2xl border border-zinc-200 bg-white p-5">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-sm font-semibold">{item.metadata.title}</h2>
                <ModeBadge mode={item.metadata.mode} />
              </div>
              <p className="mt-1.5 text-xs text-zinc-500">
                {formatRelative(Date.parse(item.metadata.timestamp))} · {duration(item.metadata.durationMs)} · {(item.blob.size / 1_048_576).toFixed(1)} MB
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Canvas {item.metadata.includesCanvas ? "included" : "not included"} · Microphone {item.metadata.includesMicrophone ? "on" : "off"} · Camera {item.metadata.includesWebcam ? "on" : "off"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/create?session=${encodeURIComponent(item.metadata.sessionId)}&mode=${item.metadata.mode}`} className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-50">Open canvas</Link>
              <button type="button" onClick={() => downloadBlob(item.blob, `inpublic-${item.id}.${extensionForMimeType(item.metadata.mimeType || item.blob.type)}`)} className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-50">Download video</button>
              <button type="button" onClick={() => downloadRecordingMetadata(item.metadata)} className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-50">Session JSON</button>
              <button
                type="button"
                onClick={() => { if (window.confirm("Delete this local recording? This cannot be undone.")) void deleteRecording(item.id).then(refresh); }}
                className="rounded-md px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
