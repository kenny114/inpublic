"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { useAuth } from "@/hooks/useAuth";
import { requestPasswordReset, signIn, signOut, signUp } from "@/lib/auth";

type Mode = "sign-in" | "sign-up" | "reset";
const GENERIC_AUTH_ERROR = "We couldn't complete that request. Check your details and try again.";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { ready, user } = useAuth();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(
    params.get("error") ? GENERIC_AUTH_ERROR : null,
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      if (mode === "reset") {
        await requestPasswordReset(email.trim());
        // Deliberately identical whether or not the address exists.
        setMessage("If an account exists for that email, a reset link is on its way.");
        return;
      }
      const result = mode === "sign-up"
        ? await signUp(email.trim(), password, displayName)
        : await signIn(email.trim(), password);
      if (result.error) {
        setMessage(GENERIC_AUTH_ERROR);
        return;
      }
      if (mode === "sign-up" && !result.data.session) {
        setMessage("Check your inbox to confirm your account, then sign in.");
        return;
      }
      const next = params.get("next");
      router.replace(next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
      router.refresh();
    } catch {
      setMessage(GENERIC_AUTH_ERROR);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-white text-zinc-950">
      <SiteHeader />
      <section className="mx-auto max-w-md px-5 py-20 sm:py-28">
        <p className="eyebrow">Account</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em]">
          {mode === "sign-up" ? "Create your InPublic account" : mode === "reset" ? "Reset your password" : "Sign in to InPublic"}
        </h1>
        {ready && user ? (
          <div className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6">
            <p className="text-sm text-zinc-600">Signed in as</p>
            <p className="mt-1 font-medium">{user.email}</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link href="/dashboard" className="button-primary">Go to dashboard</Link>
              <button type="button" onClick={() => void signOut().then(() => router.refresh())} className="button-secondary">Sign out</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6">
            {mode === "sign-up" ? <><label htmlFor="display-name" className="text-sm font-medium">Display name</label><input id="display-name" maxLength={80} autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="mt-2 mb-4 w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-sm outline-none focus:border-zinc-400" /></> : null}
            <label htmlFor="email" className="text-sm font-medium">Email</label>
            <input id="email" type="email" required autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-sm outline-none focus:border-zinc-400" />
            {mode !== "reset" ? <><label htmlFor="password" className="mt-4 block text-sm font-medium">Password</label><input id="password" type="password" required minLength={8} maxLength={128} autoComplete={mode === "sign-up" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-sm outline-none focus:border-zinc-400" /></> : null}
            {message ? <p role="status" className="mt-4 text-sm leading-6 text-zinc-600">{message}</p> : null}
            <button disabled={busy} type="submit" className="button-primary mt-5 w-full justify-center">{busy ? "Working…" : mode === "sign-up" ? "Create account" : mode === "reset" ? "Send reset link" : "Sign in"}</button>
            <div className="mt-5 flex flex-wrap justify-between gap-3 text-sm">
              <button type="button" className="text-zinc-600 underline" onClick={() => { setMode(mode === "sign-up" ? "sign-in" : "sign-up"); setMessage(null); }}>{mode === "sign-up" ? "Already have an account?" : "Create account"}</button>
              {mode !== "reset" ? <button type="button" className="text-zinc-600 underline" onClick={() => { setMode("reset"); setMessage(null); }}>Forgot password?</button> : <button type="button" className="text-zinc-600 underline" onClick={() => { setMode("sign-in"); setMessage(null); }}>Back to sign in</button>}
            </div>
          </form>
        )}
      </section>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense fallback={<main className="min-h-screen bg-white" />}><LoginForm /></Suspense>;
}
