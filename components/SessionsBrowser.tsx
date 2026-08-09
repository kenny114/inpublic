"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { StarIcon } from "@/components/DashboardIcons";
import { EmptyState, ModeBadge, StatusBadge } from "@/components/DashboardUI";
import { exportSession, SessionActionsMenu, type SessionAction } from "@/components/SessionActions";
import { SessionDetailsPanel } from "@/components/SessionDetailsPanel";
import { useSessionSummaries } from "@/hooks/useSessionSummaries";
import { deleteSession, duplicateSession, renameSession, setSessionStarred } from "@/lib/persist";
import { deriveTitle, formatDuration, formatRelative, statusOf, type SessionSummary } from "@/lib/sessions";

const filters = ["All sessions", "Standard Mode", "Story Mode", "Recorded", "Unrecorded", "Starred"] as const;
type Filter = (typeof filters)[number];

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
        const next = window.prompt("Rename session", session.title);
        if (next && next.trim()) { await renameSession(session.id, next.trim()); await refresh(); }
        return;
      }
      case "duplicate":
        await duplicateSession(session.id, (from) => `${from.title?.trim() || deriveTitle(from)} (copy)`);
        await refresh();
        return;
      case "export":
        await exportSession(session);
        return;
      case "delete":
        if (window.confirm(`Delete “${session.title}”? This removes it from this browser and cannot be undone.`)) {
          await deleteSession(session.id);
          if (selectedId === session.id) setSelectedId(null);
          await refresh();
        }
    }
  };

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Filter sessions">
        {filters.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setFilter(name)}
            aria-pressed={filter === name}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${filter === name ? "bg-indigo-50/80 text-indigo-950" : "text-zinc-500 hover:bg-zinc-100/70"}`}
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
            <div key={session.id} className={`rounded-2xl border bg-white p-4 ${selectedId === session.id ? "border-indigo-300" : "border-zinc-200"}`}>
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
      <div className="mt-6 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
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
            <li key={session.id} className={selectedId === session.id ? "bg-indigo-50/40" : ""}>
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
          <aside className="sticky top-24 hidden h-[calc(100vh-8rem)] rounded-2xl border border-zinc-200 bg-white lg:block">
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
    </div>
  );
}
