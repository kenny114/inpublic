"use client";

import { useEffect, useState } from "react";
import { SIGNED_OUT, type AuthState } from "@/lib/auth";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>(SIGNED_OUT);

  useEffect(() => {
    let supabase: ReturnType<typeof createBrowserSupabaseClient>;
    try { supabase = createBrowserSupabaseClient(); }
    catch { setState({ ready: true, user: null }); return; }
    // getSession() reads the already-validated session from local storage —
    // no network round trip unless the token is actually expired. This hook
    // only drives optimistic UI (account menu, avatar initial); it is never
    // the security boundary — middleware and each server layout already
    // authenticate every protected request server-side via getClaims()/
    // getUser(). Calling getUser() here paid for a third redundant
    // network validation of the same session on every single page load.
    void supabase.auth.getSession().then(({ data }) =>
      setState({ ready: true, user: data.session?.user ?? null }),
    );
    const { data } = supabase.auth.onAuthStateChange((_event, session) =>
      setState({ ready: true, user: session?.user ?? null }),
    );
    return () => data.subscription.unsubscribe();
  }, []);

  return state;
}
