"use client";

import Link from "next/link";
import { FileDown, Mic2, PlayCircle, Video } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, ButtonLink, EmptyState, Modal, Skeleton, Toast } from "@/components/ProductUI";
import { exportSession, type SessionAction } from "@/components/SessionActions";
import { SessionRow } from "@/components/SessionRow";
import { UsagePanel } from "@/components/UsageSurfaces";
import { VisualDemoTabs } from "@/components/VisualDemo";
import { usePreferences } from "@/hooks/usePreferences";
import { useSessionSummaries } from "@/hooks/useSessionSummaries";
import { deleteSession, duplicateSession, loadSessionById, renameSession, restoreDeletedSession, type PersistedSession } from "@/lib/persist";
import { downloadBlob, extensionForMimeType, listRecordings, type SavedRecording } from "@/lib/recordings";
import { deriveTitle, formatRelative, type SessionSummary } from "@/lib/sessions";

type ToastState = { message: string; actionLabel?: string; onAction?: () => void };

function SessionSkeleton() {
  return <div className="session-row session-row-skeleton"><Skeleton className="session-preview" /><span><Skeleton className="h-4 w-52 max-w-full" /><Skeleton className="mt-2 h-3 w-32" /></span><Skeleton className="h-4 w-14" /></div>;
}

function greeting(name: string) {
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return name.trim() ? `${part}, ${name.trim()}` : part;
}

function formatSize(bytes: number) {
  return bytes > 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function DashboardHome() {
  const { sessions, loading, refresh } = useSessionSummaries();
  const { preferences } = usePreferences();
  const recent = (sessions ?? []).slice(0, 5);
  const [recordings, setRecordings] = useState<SavedRecording[] | null>(null);
  const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [exampleOpen, setExampleOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);
  const newSessionHref = `/create?mode=${preferences.defaultMode}&new=1`;

  useEffect(() => {
    void listRecordings().then(setRecordings).catch(() => setRecordings([]));
  }, []);

  const act = async (session: SessionSummary, action: SessionAction) => {
    if (action === "rename") {
      setRenameValue(session.title);
      setRenameTarget(session);
    } else if (action === "duplicate") {
      await duplicateSession(session.id, (from) => `${from.title?.trim() || deriveTitle(from)} (copy)`);
      await refresh();
      setToast({ message: "Session duplicated" });
    } else if (action === "export") {
      await exportSession(session);
      setToast({ message: "Session download started" });
    } else if (action === "delete") {
      setDeleteTarget(session);
    }
  };

  const submitRename = async (event: FormEvent) => {
    event.preventDefault();
    const title = renameValue.trim();
    if (!renameTarget || !title) return;
    await renameSession(renameTarget.id, title);
    setRenameTarget(null);
    await refresh();
    setToast({ message: "Session renamed" });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const removed: PersistedSession | null = await loadSessionById(deleteTarget.id);
    await deleteSession(deleteTarget.id);
    setDeleteTarget(null);
    await refresh();
    setToast({
      message: "Session deleted",
      actionLabel: removed ? "Undo" : undefined,
      onAction: removed ? () => { void restoreDeletedSession(removed).then(refresh); setToast(null); } : undefined,
    });
  };

  const latestRecordings = (recordings ?? []).slice(0, 3);

  return (
    <div className="dashboard-home">
      <section className="dashboard-welcome">
        <div>
          <p className="dashboard-kicker">Your visual workspace</p>
          <h1>{greeting(preferences.displayName)}</h1>
        </div>
        <div className="dashboard-welcome-actions">
          <ButtonLink href={newSessionHref}><Mic2 size={16} />New visual session</ButtonLink>
          {/* Secondary on purpose: someone who isn't ready to talk yet should
              have somewhere to go, but speaking is still the product. */}
          <Button tone="ghost" onClick={() => setExampleOpen(true)}><PlayCircle size={16} />See an example</Button>
        </div>
      </section>

      <UsagePanel />

      <section className="dashboard-block" aria-labelledby="recent-title">
        <div className="recent-heading">
          <h2 id="recent-title">Recent sessions</h2>
          {recent.length > 0 ? <ButtonLink href="/dashboard/sessions" tone="ghost">View all</ButtonLink> : null}
        </div>
        {loading ? (
          <div className="session-list" aria-label="Loading recent sessions"><SessionSkeleton /><SessionSkeleton /><SessionSkeleton /></div>
        ) : recent.length === 0 ? (
          <EmptyState
            title="No visual sessions yet."
            body="Start speaking and InPublic will organize your thoughts visually as you talk."
            action={<ButtonLink href={newSessionHref}><Mic2 size={16} />Start speaking</ButtonLink>}
          />
        ) : (
          <div className="session-list">{recent.map((session) => <SessionRow key={session.id} session={session} onAction={(action) => void act(session, action)} />)}</div>
        )}
      </section>

      {/* Recordings and exports only appear once there is something in them.
          An empty table teaches a new user nothing. */}
      {latestRecordings.length > 0 ? (
        <section className="dashboard-block" aria-labelledby="recordings-title">
          <div className="recent-heading">
            <h2 id="recordings-title">Recent recordings</h2>
            <ButtonLink href="/dashboard/recordings" tone="ghost">View all</ButtonLink>
          </div>
          <ul className="simple-list">
            {latestRecordings.map((recording) => (
              <li key={recording.id}>
                <span className="simple-list-icon"><Video size={15} /></span>
                <span className="simple-list-copy">
                  <strong>{recording.metadata.title || "Untitled recording"}</strong>
                  <span>{formatRelative(Date.parse(recording.metadata.timestamp))} · {formatSize(recording.metadata.fileSize)}</span>
                </span>
                <button type="button" onClick={() => downloadBlob(recording.blob, `inpublic-${recording.id}.${extensionForMimeType(recording.metadata.mimeType || recording.blob.type)}`)}>
                  <FileDown size={14} />Download
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {(sessions ?? []).length > 0 || latestRecordings.length > 0 ? (
        <p className="dashboard-footnote">
          Everything downloadable from this browser is on the <Link href="/dashboard/exports">Exports</Link> page.
        </p>
      ) : null}

      <Modal open={exampleOpen} size="wide" title="A real InPublic session" description="Recorded from the product. Nothing here is illustrated." onClose={() => setExampleOpen(false)}>
        <VisualDemoTabs />
      </Modal>

      <Modal open={Boolean(renameTarget)} title="Rename session" onClose={() => setRenameTarget(null)} footer={<><Button tone="secondary" onClick={() => setRenameTarget(null)}>Cancel</Button><Button type="submit" form="rename-session-form" disabled={!renameValue.trim()}>Save name</Button></>}>
        <form id="rename-session-form" onSubmit={submitRename}><label className="dashboard-field-label" htmlFor="session-name">Session title</label><input id="session-name" className="ui-input" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} maxLength={120} autoFocus /></form>
      </Modal>

      <Modal open={Boolean(deleteTarget)} title="Delete this session?" description={deleteTarget ? `“${deleteTarget.title}” will be removed from this browser. You will have a few seconds to undo.` : undefined} onClose={() => setDeleteTarget(null)} footer={<><Button tone="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button><Button tone="destructive" onClick={() => void confirmDelete()}>Delete session</Button></>} />
      {toast ? <Toast message={toast.message} actionLabel={toast.actionLabel} onAction={toast.onAction} onDismiss={dismissToast} /> : null}
    </div>
  );
}
