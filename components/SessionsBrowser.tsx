"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { StarIcon } from "@/components/DashboardIcons";
import { EmptyState, ModeBadge, StatusBadge } from "@/components/DashboardUI";
import { Button, Modal, Toast } from "@/components/ProductUI";
import { exportSession, SessionActionsMenu, type SessionAction } from "@/components/SessionActions";
import { SessionDetailsPanel } from "@/components/SessionDetailsPanel";
import { useSessionSummaries } from "@/hooks/useSessionSummaries";
import { deleteSession, duplicateSession, loadSessionById, renameSession, restoreDeletedSession, setSessionStarred, type PersistedSession } from "@/lib/persist";
import { deriveTitle, formatDuration, formatRelative, statusOf, type SessionSummary } from "@/lib/sessions";
import { features } from "@/lib/features";

const filters = ["All sessions", "Standard Mode", "Story Mode", "Recorded", "Unrecorded", "Starred"] as const;
type Filter = (typeof filters)[number];
// Story Mode is parked (lib/features.ts) — the filter chip is hidden from
// the main sessions view, but "All sessions" still includes any existing
// story sessions (matches() below is untouched), so they stay findable.
const visibleFilters = features.storyMode ? filters : filters.filter((name) => name !== "Story Mode");

const sorts = { recent: "Recently edited", newest: "Newest first", oldest: "Oldest first" } as const;
type Sort = keyof typeof sorts;

function matches(session: SessionSummary, filter: Filter) {
  switch (filter) {
    case "Standard Mode": return session.mode === "standard";
    case "Story Mode": return session.mode === "story";
    case "Recorded": return session.recordings.length > 0;
    case "Unrecorded": return session.recordings.length === 0;
    case "Starred": return session.starred;
    default: return true;
  }
}

export function SessionsBrowser() {
  const router = useRouter();
  const params = useSearchParams();
  const { sessions, loading, refresh } = useSessionSummaries();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("All sessions");
  const [sort, setSort] = useState<Sort>("recent");
  const [layout, setLayout] = useState<"list" | "grid">("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(null);
  const [toast, setToast] = useState<{ message: string; actionLabel?: string; onAction?: () => void } | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);

  // The top-bar search writes ?q=, so this page is the one place the query lives.
  useEffect(() => { setQuery(params.get("q") ?? ""); }, [params]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const found = (sessions ?? []).filter(
      (session) => matches(session, filter) && (!needle || session.title.toLowerCase().includes(needle)),
    );
    const ordered = [...found];
    if (sort === "oldest") ordered.sort((a, b) => a.updatedAt - b.updatedAt);
    else ordered.sort((a, b) => b.updatedAt - a.updatedAt);
    return ordered;
  }, [filter, query, sessions, sort]);

  const selected = visible.find((session) => session.id === selectedId) ?? null;

  const star = async (session: SessionSummary, starred: boolean) => {
    await setSessionStarred(session.id, starred);
    await refresh();
  };

  const act = async (session: SessionSummary, action: SessionAction) => {
    switch (action) {
      case "open":
        router.push(`/create?session=${encodeURIComponent(session.id)}&mode=${session.mode}`);
        return;
      case "rename": {
        setRenameValue(session.title);
        setRenameTarget(session);
        return;
      }
      case "duplicate":
        await duplicateSession(session.id, (from) => `${from.title?.trim() || deriveTitle(from)} (copy)`);
        await refresh();
        setToast({ message: "Session duplicated" });
        return;
      case "export":
        await exportSession(session);
        setToast({ message: "Session download started" });
        return;
      case "delete":
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
    if (selectedId === deleteTarget.id) setSelectedId(null);
    setDeleteTarget(null);
    await refresh();
    setToast({
      message: "Session deleted",
      actionLabel: removed ? "Undo" : undefined,
      onAction: removed ? () => { void restoreDeletedSession(removed).then(refresh); setToast(null); } : undefined,
    });
  };

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative mb-2 w-full" htmlFor="session-search">
        <span className="sr-only">Search sessions</span>
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input id="session-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sessions" className="h-10 w-full rounded-[10px] border border-zinc-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-[#5b5bd6] focus:ring-2 focus:ring-[#eff0ff]" />
      </label>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Filter sessions">
        {visibleFilters.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setFilter(name)}
            aria-pressed={filter === name}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${filter === name ? "bg-[#eff0ff] text-[#4b4db2]" : "text-zinc-500 hover:bg-zinc-100"}`}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <label className="sr-only" htmlFor="sort">Sort sessions</label>
        <select id="sort" value={sort} onChange={(event) => setSort(event.target.value as Sort)} className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs">
          {Object.entries(sorts).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <div className="flex rounded-lg border border-zinc-200 bg-white p-0.5" role="group" aria-label="Layout">
          {(["list", "grid"] as const).map((value) => (
            <button key={value} type="button" onClick={() => setLayout(value)} aria-pressed={layout === value} className={`rounded-md px-2 py-1 text-xs font-medium capitalize ${layout === value ? "bg-zinc-100 text-zinc-900" : "text-zinc-500"}`}>{value}</button>
          ))}
        </div>
      </div>
    </div>
  );

  const body = () => {
    if (loading) return <p className="mt-6 text-sm text-zinc-400">Loading sessions from this browser…</p>;

    if ((sessions ?? []).length === 0) {
      return (
        <div className="mt-6">
          <EmptyState
            title="No sessions yet."
            body="Start speaking and your first visual session will appear here."
            action={<Link href="/create?mode=standard&new=1" className="inline-flex rounded-lg bg-zinc-950 px-3.5 py-2 text-sm font-medium text-white hover:bg-zinc-800">Create your first session</Link>}
          />
        </div>
      );
    }

    if (visible.length === 0) {
      return (
        <div className="mt-6">
          <EmptyState title="No sessions match this view." body="Try a different filter, or clear the search." />
        </div>
      );
    }

    if (layout === "grid") {
      return (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((session) => (
            <div key={session.id} className={`rounded-[10px] border bg-white p-4 ${selectedId === session.id ? "border-[#9598ea]" : "border-zinc-200"}`}>
              <div className="flex items-start justify-between gap-2">
                <button type="button" onClick={() => setSelectedId(session.id)} className="min-w-0 flex-1 text-left">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {session.starred && <StarIcon className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500" />}
                    <span className="truncate">{session.title}</span>
                  </span>
                </button>
                <SessionActionsMenu label={session.title} onAction={(action) => void act(session, action)} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <ModeBadge mode={session.mode} />
                <StatusBadge status={statusOf(session)} />
              </div>
              <p className="mt-3 text-xs text-zinc-500">
                {formatRelative(session.updatedAt)} · {session.pages} page{session.pages === 1 ? "" : "s"} · {formatDuration(session.durationMs)}
              </p>
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="mt-6 overflow-hidden rounded-[10px] border border-zinc-200 bg-white">
        <div className="hidden border-b border-zinc-100 bg-zinc-50/50 px-5 py-2 text-[11px] font-medium uppercase tracking-wider text-zinc-400 md:flex">
          <span className="flex-1">Session</span>
          <span className="w-24">Mode</span>
          <span className="w-28">Last edited</span>
          <span className="w-20 text-right">Duration</span>
          <span className="w-28 text-right">Status</span>
          <span className="w-8" />
        </div>
        <ul className="divide-y divide-zinc-100">
          {visible.map((session) => (
            <li key={session.id} className={selectedId === session.id ? "bg-[#f5f5ff]" : ""}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 md:flex-nowrap">
                <button type="button" onClick={() => setSelectedId(session.id)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-medium hover:underline">
                  {session.starred && <StarIcon className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500" />}
                  <span className="truncate">{session.title}</span>
                </button>
                <span className="w-24"><ModeBadge mode={session.mode} /></span>
                <span className="w-28 text-xs text-zinc-500">{formatRelative(session.updatedAt)}</span>
                <span className="w-20 text-right text-xs tabular-nums text-zinc-500">{formatDuration(session.durationMs)}</span>
                <span className="w-28 text-right"><StatusBadge status={statusOf(session)} /></span>
                <span className="w-8 text-right"><SessionActionsMenu label={session.title} onAction={(action) => void act(session, action)} /></span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div className={selected ? "lg:grid lg:grid-cols-[1fr_320px] lg:gap-6" : ""}>
      <div className="min-w-0">
        {controls}
        {body()}
      </div>

      {selected && (
        <>
          {/* Desktop: a column beside the list. Below lg it becomes a drawer. */}
          <aside className="sticky top-24 hidden h-[calc(100vh-8rem)] rounded-[10px] border border-zinc-200 bg-white lg:block">
            <SessionDetailsPanel session={selected} onClose={() => setSelectedId(null)} onStar={(value) => void star(selected, value)} />
          </aside>
          <div className="fixed inset-0 z-40 lg:hidden">
            <button type="button" aria-label="Close details" onClick={() => setSelectedId(null)} className="absolute inset-0 bg-zinc-900/20" />
            <div className="absolute inset-x-0 bottom-0 h-[75vh] rounded-t-2xl border-t border-zinc-200 bg-white">
              <SessionDetailsPanel session={selected} onClose={() => setSelectedId(null)} onStar={(value) => void star(selected, value)} />
            </div>
          </div>
        </>
      )}

      <Modal open={Boolean(renameTarget)} title="Rename session" onClose={() => setRenameTarget(null)} footer={<><Button tone="secondary" onClick={() => setRenameTarget(null)}>Cancel</Button><Button type="submit" form="sessions-rename-form" disabled={!renameValue.trim()}>Save name</Button></>}>
        <form id="sessions-rename-form" onSubmit={submitRename}><label className="dashboard-field-label" htmlFor="sessions-session-name">Session title</label><input id="sessions-session-name" className="ui-input" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} maxLength={120} autoFocus /></form>
      </Modal>
      <Modal open={Boolean(deleteTarget)} title="Delete this session?" description={deleteTarget ? `“${deleteTarget.title}” will be removed from this browser. You will have a few seconds to undo.` : undefined} onClose={() => setDeleteTarget(null)} footer={<><Button tone="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button><Button tone="destructive" onClick={() => void confirmDelete()}>Delete session</Button></>} />
      {toast ? <Toast message={toast.message} actionLabel={toast.actionLabel} onAction={toast.onAction} onDismiss={dismissToast} /> : null}
    </div>
  );
}
