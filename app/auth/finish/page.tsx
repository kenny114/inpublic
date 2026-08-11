"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

/*
 * The client half of the email-link handler.
 *
 * Supabase's default templates finish the verification at
 * <project>.supabase.co/auth/v1/verify, which redirects back with the session
 * in the URL fragment. Fragments never reach the server, so /auth/callback
 * forwards here (browsers carry the fragment through the redirect) and this
 * page hands the tokens to the browser client, which writes the cookies the
 * server and middleware read.
 */

function safeNext(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

function FinishSignIn() {
  const router = useRouter();
  const params = useSearchParams();
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const next = safeNext(params.get("next"));
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));

    const reported = hash.get("error_code") ?? hash.get("error");
    if (reported) {
      const expired = /expired|otp_expired/i.test(reported);
      router.replace(`/login?error=${expired ? "link-expired" : "auth"}`);
      return;
    }

    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    let supabase: ReturnType<typeof createBrowserSupabaseClient>;
    try {
      supabase = createBrowserSupabaseClient();
    } catch {
      setFailed("config");
      return;
    }

    const complete = async () => {
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (error) {
          router.replace("/login?error=link-expired");
          return;
        }
        // Strip the tokens out of the address bar before moving on.
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        const recovery = hash.get("type") === "recovery";
        router.replace(recovery ? "/reset-password" : next);
        router.refresh();
        return;
      }

      // No tokens at all — but the cookie may already be good (a second click
      // on an already-consumed link, say). Send them on if so.
      const { data } = await supabase.auth.getUser();
      router.replace(data.user ? next : "/login?error=link-expired");
      router.refresh();
    };

    void complete();
  }, [params, router]);

  return (
    <main className="grid min-h-screen place-items-center bg-white px-5 text-zinc-950">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 p-6 text-center">
        {failed ? (
          <>
            <h1 className="text-xl font-semibold">Sign-in isn&rsquo;t available right now</h1>
            <p className="mt-2 text-sm text-zinc-600">The app is missing its authentication configuration. Please try again shortly.</p>
            <Link href="/login" className="button-secondary mt-6">Back to sign in</Link>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">Confirming your email…</h1>
            <p className="mt-2 text-sm text-zinc-600">One moment — we&rsquo;re signing you in.</p>
          </>
        )}
      </div>
    </main>
  );
}

export default function AuthFinishPage() {
  return <Suspense fallback={<main className="min-h-screen bg-white" />}><FinishSignIn /></Suspense>;
}
