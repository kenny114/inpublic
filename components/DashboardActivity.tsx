"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { billing } from "@/lib/billing";
import { listRecordings, type SavedRecording } from "@/lib/recordings";

/**
 * Real local activity only.
 *
 * Everything shown here is derived from recordings actually saved in this
 * browser. There is no placeholder session and no sampled analytics: until a
 * take is recorded, the counters read zero and the list says so.
 */
function minutes(totalMs: number) {
  return Math.round(totalMs / 60_000);
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-zinc-500">{note}</p>
    </div>
  );
}

export function DashboardActivity() {
  const [items, setItems] = useState<SavedRecording[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listRecordings()
      .then((result) => { if (!cancelled) setItems(result); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, []);

  const loading = items === null;
  const recorded = items ?? [];
  const totalMs = recorded.reduce((sum, item) => sum + item.metadata.durationMs, 0);
  const plan = billing.configured ? "Paid" : "Free trial";

  return (
    <>
      <div className="mt-12 grid gap-4 sm:grid-cols-3">
        <Stat label="Total sessions" value={loading ? "—" : String(recorded.length)} note="Saved in this browser" />
        <Stat label="Minutes recorded" value={loading ? "—" : String(minutes(totalMs))} note="Across saved recordings" />
        <Stat label="Current plan" value={plan} note={billing.configured ? "Billing active" : "Billing is not connected yet"} />
      </div>

      <section className="mt-10">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">Recent sessions</h2>
          {recorded.length > 0 && (
            <Link href="/dashboard/sessions" className="text-sm text-zinc-600 hover:text-zinc-950">View all</Link>
          )}
        </div>

        {loading ? (
          <p className="mt-4 text-sm text-zinc-500">Loading local sessions…</p>
        ) : recorded.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center">
            <p className="text-sm text-zinc-500">Your sessions will appear here.</p>
          </div>
        ) : (
          <ul className="mt-4 grid gap-3">
            {recorded.slice(0, 5).map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-zinc-200 bg-white p-5">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{item.metadata.title}</h3>
                    <span className="rounded border border-zinc-200 px-2 py-0.5 text-[11px] capitalize text-zinc-600">{item.metadata.mode}</span>
                  </div>
                  <p className="mt-1 text-sm text-zinc-500">
                    {new Date(item.metadata.timestamp).toLocaleString()} · {minutes(item.metadata.durationMs)} min
                  </p>
                </div>
                <Link href={`/create?mode=${item.metadata.mode}`} className="rounded-lg border border-zinc-200 px-3.5 py-2 text-sm font-medium hover:bg-zinc-50">Open canvas</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
