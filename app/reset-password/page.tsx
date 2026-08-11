"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useAuth } from "@/hooks/useAuth";
import { updatePassword } from "@/lib/auth";

export default function ResetPasswordPage() {
  const { ready, user } = useAuth();
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const { error } = await updatePassword(password);
    if (error) return setMessage("The link may have expired. Request a new password reset and try again.");
    // Hard navigation so middleware and the client agree on the refreshed session.
    window.location.assign("/dashboard");
  };

  // Recovery links land here with a session already established. Saying so up
  // front beats letting someone type a new password into a dead form.
  if (ready && !user) {
    return (
      <main className="grid min-h-screen place-items-center bg-white px-5">
        <div className="w-full max-w-md rounded-2xl border border-zinc-200 p-6">
          <h1 className="text-2xl font-semibold">This reset link has expired</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-600">Password reset links can only be used once, and they time out. Request a fresh one and open it on this device.</p>
          <Link href="/login" className="button-primary mt-6">Back to sign in</Link>
        </div>
      </main>
    );
  }

  return <main className="grid min-h-screen place-items-center bg-white px-5"><form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-zinc-200 p-6"><h1 className="text-2xl font-semibold">Choose a new password</h1><label htmlFor="new-password" className="mt-6 block text-sm font-medium">New password</label><input id="new-password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2.5" />{message ? <p role="alert" className="mt-4 text-sm text-red-700">{message}</p> : null}<button disabled={!ready} className="button-primary mt-5 w-full justify-center">Update password</button></form></main>;
}
