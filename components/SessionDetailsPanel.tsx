"use client";

import Link from "next/link";
import { useState } from "react";
import { CloseIcon, StarIcon } from "@/components/DashboardIcons";
import { ModeBadge, StatusBadge } from "@/components/DashboardUI";
import { exportSession } from "@/components/SessionActions";
import { downloadBlob, downloadRecordingMetadata, extensionForMimeType } from "@/lib/recordings";
import { formatDuration, formatRelative, statusOf, type SessionSummary } from "@/lib/sessions";

const tabs = ["Details", "Activity", "Exports"] as const;
type Tab = (typeof tabs)[number];

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-zinc-100 py-2.5 last:border-0">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="text-right text-sm">{value}</dd>
    </div>
  );
}

/**
 * Activity is read straight out of the session log the canvas already writes.
 * Nothing is synthesized: a session with no log shows an empty activity tab.
 */
function activityLines(session: SessionSummary) {
  return [
    { label: "Concepts on the board", value: session.conceptCount },
    { label: "Canvas elements", value: session.elementCount },
    { label: "Words spoken", value: session.spokenWords },
    { label: "Recordings saved", value: session.recordings.length },
  ].filter((line) => line.value > 0);
}

export function SessionDetailsPanel({
  session,
  onClose,
  onStar,
}: { session: SessionSummary; onClose: () => void; onStar: (starred: boolean) => void }) {
  const [tab, setTab] = useState<Tab>("Details");
  const activity = activityLines(session);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-zinc-200 p-4">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{session.title}</h2>
          <div className="mt-1.5 flex items-center gap-1.5">
            <ModeBadge mode={session.mode} />
            <StatusBadge status={statusOf(session)} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => onStar(!session.starred)}
            aria-pressed={session.starred}
            className={`rounded-md p-1 hover:bg-zinc-100 ${session.starred ? "text-amber-500" : "text-zinc-400 hover:text-zinc-700"}`}
          >
            <span className="sr-only">{session.starred ? "Remove star" : "Star this session"}</span>
            <StarIcon className={`h-4 w-4 ${session.starred ? "fill-amber-400" : ""}`} />
          </button>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
            <span className="sr-only">Close details</span>
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-zinc-200 px-3 py-2">
        {tabs.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            aria-pressed={tab === name}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium ${tab === name ? "bg-indigo-50/80 text-indigo-950" : "text-zinc-500 hover:bg-zinc-100/70"}`}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "Details" && (
          <dl>
            <Row label="Mode" value={session.mode === "story" ? "Story Mode" : "Standard Mode"} />
            <Row label="Last edited" value={formatRelative(session.updatedAt)} />
            <Row label="Duration" value={formatDuration(session.durationMs)} />
            <Row label="Pages" value={session.pages} />
            <Row label="Recording" value={session.recordings.length > 0 ? `${session.recordings.length} saved` : "None"} />
            <Row label="Title" value={session.derivedTitle ? "Derived from the session" : "Renamed"} />
          </dl>
        )}

        {tab === "Activity" && (
          activity.length === 0 ? (
            <p className="text-sm text-zinc-500">Nothing has been drawn or spoken in this session yet.</p>
          ) : (
            <dl>{activity.map((line) => <Row key={line.label} label={line.label} value={line.value} />)}</dl>
          )
        )}

        {tab === "Exports" && (
          <div className="grid gap-2">
            <button type="button" onClick={() => void exportSession(session)} className="rounded-lg border border-zinc-200 px-3 py-2 text-left text-sm font-medium hover:bg-zinc-50">
              Download session JSON
            </button>
            {session.recordings.map((recording) => (
              <div key={recording.id} className="rounded-lg border border-zinc-200 p-3">
                <p className="text-sm font-medium">{new Date(recording.metadata.timestamp).toLocaleString()}</p>
                <p className="mt-0.5 text-xs text-zinc-500">{(recording.blob.size / 1_048_576).toFixed(1)} MB · {recording.metadata.mimeType}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={() => downloadBlob(recording.blob, `inpublic-${recording.id}.${extensionForMimeType(recording.metadata.mimeType || recording.blob.type)}`)} className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-50">Download video</button>
                  <button type="button" onClick={() => downloadRecordingMetadata(recording.metadata)} className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-50">Recording JSON</button>
                </div>
              </div>
            ))}
            {session.recordings.length === 0 && (
              <p className="text-sm leading-6 text-zinc-500">No recording is attached to this session. PNG, SVG and Excalidraw exports are available from the canvas toolbar.</p>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-zinc-200 p-4">
        <Link href={`/create?session=${encodeURIComponent(session.id)}&mode=${session.mode}`} className="inline-flex w-full justify-center rounded-lg bg-zinc-950 px-3.5 py-2 text-sm font-medium text-white hover:bg-zinc-800">
          Open on canvas
        </Link>
      </div>
    </div>
  );
}
