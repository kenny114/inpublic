"use client";

import { Mic2 } from "lucide-react";
import { useCallback, useMemo, useState, type FormEvent } from "react";
import { Button, ButtonLink, EmptyState, Modal, Skeleton, Toast } from "@/components/ProductUI";
import { exportSession, type SessionAction } from "@/components/SessionActions";
import { SessionRow } from "@/components/SessionRow";
import { usePreferences } from "@/hooks/usePreferences";
import { useSessionSummaries } from "@/hooks/useSessionSummaries";
import { deleteSession, duplicateSession, loadSessionById, renameSession, restoreDeletedSession, type PersistedSession } from "@/lib/persist";
import { deriveTitle, type SessionSummary } from "@/lib/sessions";

type ToastState = { message: string; actionLabel?: string; onAction?: () => void };

function SessionSkeleton() {
  return <div className="session-row session-row-skeleton"><Skeleton className="session-preview" /><span><Skeleton className="h-4 w-52 max-w-full" /><Skeleton className="mt-2 h-3 w-32" /></span><Skeleton className="h-4 w-14" /></div>;
}

export function DashboardHome() {
  const { sessions, loading, refresh } = useSessionSummaries();
  const { preferences } = usePreferences();
  const recent = (sessions ?? []).slice(0, 8);
  const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);
  const newSessionHref = `/create?mode=${preferences.defaultMode}&new=1`;

  const monthMinutes = useMemo(() => {
    const now = new Date();
    const total = (sessions ?? []).filter((session) => {
      const date = new Date(session.updatedAt);
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    }).reduce((sum, session) => sum + (session.durationMs ?? 0), 0);
    return Math.round(total / 60_000);
  }, [sessions]);

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

  return (
    <div className="dashboard-home">
      <section className="dashboard-welcome">
        <div><p className="dashboard-kicker">Your visual workspace</p><h1>What do you want to bring to life?</h1><p>Start a new thought or continue one that is already taking shape.</p></div>
        <ButtonLink href={newSessionHref}><Mic2 size={16} />New visual session</ButtonLink>
      </section>

      <section className="recent-sessions" aria-labelledby="recent-title">
        <div className="recent-heading"><div><h2 id="recent-title">Recent Sessions</h2>{recent.length > 0 ? <p>You brought {monthMinutes} minute{monthMinutes === 1 ? "" : "s"} of ideas to life this month.</p> : null}</div>{recent.length > 0 ? <ButtonLink href="/dashboard/sessions" tone="ghost">View all sessions</ButtonLink> : null}</div>
        {loading ? <div className="session-list" aria-label="Loading recent sessions"><SessionSkeleton /><SessionSkeleton /><SessionSkeleton /></div> : recent.length === 0 ? (
          <EmptyState title="Create your first visual session." body="Press record, start talking and watch InPublic build with you." action={<ButtonLink href={newSessionHref}><Mic2 size={16} />Start speaking</ButtonLink>} />
        ) : <div className="session-list">{recent.map((session) => <SessionRow key={session.id} session={session} onAction={(action) => void act(session, action)} />)}</div>}
      </section>

      <Modal open={Boolean(renameTarget)} title="Rename session" onClose={() => setRenameTarget(null)} footer={<><Button tone="secondary" onClick={() => setRenameTarget(null)}>Cancel</Button><Button type="submit" form="rename-session-form" disabled={!renameValue.trim()}>Save name</Button></>}>
        <form id="rename-session-form" onSubmit={submitRename}><label className="dashboard-field-label" htmlFor="session-name">Session title</label><input id="session-name" className="ui-input" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} maxLength={120} autoFocus /></form>
      </Modal>

      <Modal open={Boolean(deleteTarget)} title="Delete this session?" description={deleteTarget ? `“${deleteTarget.title}” will be removed from this browser. You will have a few seconds to undo.` : undefined} onClose={() => setDeleteTarget(null)} footer={<><Button tone="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button><Button tone="destructive" onClick={() => void confirmDelete()}>Delete session</Button></>} />
      {toast ? <Toast message={toast.message} actionLabel={toast.actionLabel} onAction={toast.onAction} onDismiss={dismissToast} /> : null}
    </div>
  );
}
