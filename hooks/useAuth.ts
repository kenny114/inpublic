"use client";

import { useEffect, useState } from "react";
import { readAuth, subscribeAuth, SIGNED_OUT, type AuthState } from "@/lib/auth";

/**
 * Auth state for rendering.
 *
 * The first client render must match the server's HTML, so this starts at
 * `{ ready: false, user: null }` on both sides and only reads localStorage in
 * an effect. Callers render a neutral placeholder while `ready` is false rather
 * than guessing at "Log in" or "Log out".
 */
export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>(SIGNED_OUT);

  useEffect(() => {
    const sync = () => setState({ ready: true, user: readAuth() });
    sync();
    return subscribeAuth(sync);
  }, []);

  return state;
}
