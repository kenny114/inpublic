"use client";

import { useCallback, useEffect, useState } from "react";
import { listSessionSummaries, type SessionSummary } from "@/lib/sessions";

/**
 * Session summaries from this browser.
 *
 * `sessions` is null until IndexedDB answers, which is how every page tells
 * "still loading" apart from "genuinely empty" — the two must never render the
 * same, or an empty state flashes on every visit.
 */
export function useSessionSummaries() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSessions(await listSessionSummaries());
    } catch {
      setSessions([]);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return { sessions, loading: sessions === null, refresh };
}
