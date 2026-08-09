import Link from "next/link";
import { Clock3 } from "lucide-react";
import { SessionActionsMenu, type SessionAction } from "@/components/SessionActions";
import { formatDuration, formatRelative, type SessionSummary } from "@/lib/sessions";

function CanvasPreview({ labels }: { labels: string[] }) {
  const shown = labels.length > 0 ? labels : ["Your idea"];
  return (
    <span className="session-preview" aria-hidden="true">
      <i className="session-preview-line" />
      {shown.slice(0, 3).map((label, index) => <b key={`${label}-${index}`} className={`preview-node preview-node-${index + 1}`}>{label}</b>)}
    </span>
  );
}

export function SessionRow({ session, onAction }: { session: SessionSummary; onAction: (action: SessionAction) => void }) {
  return (
    <div className="session-row">
      <Link href={`/create?session=${encodeURIComponent(session.id)}&mode=${session.mode}`} className="session-row-link">
        <CanvasPreview labels={session.previewLabels} />
        <span className="session-row-copy"><strong title={session.title}>{session.title}</strong><span><Clock3 size={13} /> Edited {formatRelative(session.updatedAt)}</span></span>
        <span className="session-row-duration">{formatDuration(session.durationMs)}</span>
      </Link>
      <SessionActionsMenu label={session.title} onAction={onAction} />
    </div>
  );
}
