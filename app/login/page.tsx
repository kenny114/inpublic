"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { useAuth } from "@/hooks/useAuth";
import { requestPasswordReset, resendConfirmation, signIn, signOut, signUp } from "@/lib/auth";

type Mode = "sign-in" | "sign-up" | "reset";
const GENERIC_AUTH_ERROR = "We couldn't complete that request. Check your details and try again.";

/*
 * What /auth/callback tells us went wrong. Every one of these used to arrive
 * as "error=auth" and render the same "check your details" line, which is why
 * a confirmed-but-unsigned-in reader had no idea what to do next.
 */
const CALLBACK_MESSAGES: Record<string, string> = {
  auth: "That link didn't work. Sign in below, or send yourself a new confirmation email.",
  config: "Sign-in is temporarily unavailable. Please try again in a few minutes.",
  "link-expired": "That link has expired or was already used. Sign in below — or resend the confirmation email if you haven't verified yet.",
  "other-device": "Your email is confirmed. Because you opened the link in a different browser, finish by signing in here.",
};

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { ready, user } = useAuth();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const callbackError = params.get("error");
  const [message, setMessage] = useState<string | null>(
    callbackError ? CALLBACK_MESSAGES[callbackError] ?? GENERIC_AUTH_ERROR : null,
  );
  // Set when we know the account exists but the address is still unverified,
  // so the form can offer the one action that actually unblocks them.
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  const next = (() => {
    const value = params.get("next");
    return value?.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
  })();

  const clear = () => {
    setMessage(null);
    setNeedsConfirmation(false);
  };

  const resend = async () => {
    setBusy(true);
    try {
      const { error } = await resendConfirmation(email.trim(), next);
      setMessage(error ? error.message : "New confirmation email sent. Open it on this device if you can — it keeps you signed in automatically.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    clear();
    try {
      if (mode === "reset") {
        const result = await requestPasswordReset(email.trim());
        if (result.reason === "network") {
          // The request never went out at all — telling them a link "is on
          // its way" here would be a lie, not just enumeration-safe cover.
          setMessage("Couldn't reach the server. Check your connection and try again.");
          return;
        }
        // Otherwise deliberately identical whether or not the address
        // exists, including on an "unknown" server-side failure — that
        // cover is the point.
        setMessage("If an account exists for that email, a reset link is on its way.");
        return;
      }
      const result = mode === "sign-up"
        ? await signUp(email.trim(), password, displayName, next)
        : await signIn(email.trim(), password);
      if (result.error) {
        if (result.reason === "email-unconfirmed") {
          setNeedsConfirmation(true);
          setMessage("Your password is right, but this address hasn't been confirmed yet. Check your inbox for the confirmation link, or send a new one.");
          return;
        }
        setMessage(
          result.reason === "rate-limited"
            ? "Too many attempts. Please wait a few minutes and try again."
            : result.reason === "network"
              // The request never reached the server — says nothing about
              // whether the email/password are right, so don't imply it does.
              ? "Couldn't reach the server. Check your connection and try again."
              : GENERIC_AUTH_ERROR,
        );
        return;
      }
      if (mode === "sign-up" && !result.data.session) {
        setNeedsConfirmation(true);
        setMessage("Check your inbox to confirm your account. Open the link on this device and you'll come straight back, signed in.");
        return;
      }
      /*
       * A full navigation, not router.replace: the session cookie was set by
       * the API route, so the client Supabase instance and the middleware both
       * need a fresh load to agree that we're signed in. Soft-navigating left
       * people looking at a signed-out shell on a page they were already
       * authorised for.
       */
      window.location.assign(next);
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
              <Link href={next} className="button-primary">{next === "/dashboard" ? "Go to dashboard" : "Continue"}</Link>
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
            {needsConfirmation ? <button type="button" disabled={busy || !email.trim()} onClick={() => void resend()} className="button-secondary mt-4 w-full justify-center">Resend confirmation email</button> : null}
            <button disabled={busy} type="submit" className="button-primary mt-5 w-full justify-center">{busy ? "Working…" : mode === "sign-up" ? "Create account" : mode === "reset" ? "Send reset link" : "Sign in"}</button>
            <div className="mt-5 flex flex-wrap justify-between gap-3 text-sm">
              <button type="button" className="text-zinc-600 underline" onClick={() => { setMode(mode === "sign-up" ? "sign-in" : "sign-up"); clear(); }}>{mode === "sign-up" ? "Already have an account?" : "Create account"}</button>
              {mode !== "reset" ? <button type="button" className="text-zinc-600 underline" onClick={() => { setMode("reset"); clear(); }}>Forgot password?</button> : <button type="button" className="text-zinc-600 underline" onClick={() => { setMode("sign-in"); clear(); }}>Back to sign in</button>}
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
