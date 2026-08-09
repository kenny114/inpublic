"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_PREFERENCES,
  readPreferences,
  subscribePreferences,
  writePreferences,
  type Preferences,
} from "@/lib/preferences";

/**
 * Starts at the defaults on both server and first client render, then reads
 * localStorage in an effect. `ready` lets callers avoid rendering a stored
 * value before it is known.
 */
export function usePreferences() {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => { setPreferences(readPreferences()); setReady(true); };
    sync();
    return subscribePreferences(sync);
  }, []);

  const update = useCallback((patch: Partial<Preferences>) => {
    const next = { ...readPreferences(), ...patch };
    writePreferences(next);
    setPreferences(next);
  }, []);

  return { preferences, ready, update };
}
