"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, ModeBadge, StatusBadge } from "@/components/DashboardUI";
import { useAuth } from "@/hooks/useAuth";
import { usePreferences } from "@/hooks/usePreferences";
import { useSessionSummaries } from "@/hooks/useSessionSummaries";
import { formatDuration, formatRelative, statusOf } from "@/lib/sessions";

function greetingFor(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** "kenny.farmer@…" → "Kenny". Only ever a display nicety. */
function displayName(email: string) {
  const local = email.split("@")[0]?.split(/[._-]/)[0] ?? "";
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : "";
}

function Greeting() {
  const { ready, user } = useAuth();
  const { preferences, ready: prefsReady } = usePreferences();
  // The clock and the stored email are both browser-only. Rendering them
  // during SSR would guarantee a hydration mismatch, so the line starts empty
  // and fills in after mount; the space is reserved either way.
  const [greeting, setGreeting] = useState("");
  useEffect(() => setGreeting(greetingFor(new Date().getHours())), []);

  // A name set in settings wins over one guessed from the email address.
  const chosen = prefsReady ? preferences.displayName.trim() : "";
  const name = chosen || (ready && user ? displayName(user.email) : "");
  return (
    <p className="h-5 text-sm font-medium text-zinc-500">
      {greeting && (name ? `${greeting}, ${name}` : greeting)}
    </p>
  );
}

/**
 * One page. Both mode buttons open the canvas directly — there is no chooser
 * step, because the canvas already has a mode switch in its control bar.
 */
export function DashboardHome() {
  const { sessions, loading } = useSessionSummaries();
  const recent = (sessions ?? []).slice(0, 8);

  return (
    <div>
      <Greeting />
      <h1 className="mt-1 text-2xl font-semibold tracking-[-0.02em]">What are you creating today?</h1>
      <p className="mt-2 text-sm text-zinc-500">Speak naturally and turn your thoughts into visible ideas.</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Link href="/create?mode=standard&new=1" className="inline-flex rounded-lg bg-zinc-950 px-3.5 py-2 text-sm font-medium text-white hover:bg-zinc-800">Start Standard session</Link>
        <Link href="/create?mode=story&new=1" className="inline-flex rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50">Start Story session</Link>
      </div>

      <section className="mt-10">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">Recent sessions</h2>
          {recent.length > 0 && <Link href="/dashboard/sessions" className="text-sm text-zinc-500 hover:text-zinc-900">View all</Link>}
        </div>

        {loading ? (
          <p className="mt-4 text-sm text-zinc-400">Loading sessions from this browser…</p>
        ) : recent.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No sessions yet."
              body="Start speaking and your first visual session will appear here."
              action={<Link href="/create?mode=standard&new=1" className="inline-flex rounded-lg bg-zinc-950 px-3.5 py-2 text-sm font-medium text-white hover:bg-zinc-800">Create your first session</Link>}
            />
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
            {recent.map((session) => (
              <li key={session.id}>
                <Link href={`/create?session=${encodeURIComponent(session.id)}&mode=${session.mode}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 hover:bg-zinc-50/70">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{session.title}</span>
                  <ModeBadge mode={session.mode} />
                  <StatusBadge status={statusOf(session)} />
                  <span className="w-20 text-right text-xs tabular-nums text-zinc-500">{formatDuration(session.durationMs)}</span>
                  <span className="w-32 text-right text-xs text-zinc-500">{formatRelative(session.updatedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
