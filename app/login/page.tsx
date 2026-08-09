"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { useAuth } from "@/hooks/useAuth";
import { signIn, signOut } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const { ready, user } = useAuth();
  const [email, setEmail] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = email.trim();
    if (!value) return;
    signIn(value);
    router.push("/dashboard");
  };

  return (
    <main className="min-h-screen bg-white text-zinc-950">
      <SiteHeader />
      <section className="mx-auto max-w-md px-5 py-20 sm:py-28">
        <p className="eyebrow">Account</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em]">Sign in to InPublic</h1>

        {ready && user ? (
          <div className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6">
            <p className="text-sm text-zinc-600">Signed in as</p>
            <p className="mt-1 font-medium">{user.email}</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link href="/dashboard" className="button-primary">Go to dashboard</Link>
              <button type="button" onClick={() => signOut()} className="button-secondary">Log out</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6">
            <label htmlFor="email" className="text-sm font-medium">Email</label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-sm outline-none focus:border-zinc-400"
            />
            <button type="submit" className="button-primary mt-5 w-full justify-center">Continue</button>
          </form>
        )}

        <p className="mt-5 text-sm leading-6 text-zinc-500">
          Accounts are not connected yet. This preview sign-in asks for no password, sends nothing to a
          server, and only records an email in this browser so the dashboard can show a signed-in state.
        </p>
        <p className="mt-5 text-sm text-zinc-500">
          You can also <Link href="/dashboard" className="font-medium text-zinc-900 underline">continue without signing in</Link>.
        </p>
      </section>
    </main>
  );
}
