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
    void supabase.auth.getUser().then(({ data }) =>
      setState({ ready: true, user: data.user }),
    );
    const { data } = supabase.auth.onAuthStateChange((_event, session) =>
      setState({ ready: true, user: session?.user ?? null }),
    );
    return () => data.subscription.unsubscribe();
  }, []);

  return state;
}
