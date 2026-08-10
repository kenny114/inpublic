"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { updatePassword } from "@/lib/auth";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const { error } = await updatePassword(password);
    if (error) return setMessage("The link may have expired. Request a new password reset and try again.");
    router.replace("/dashboard");
    router.refresh();
  };
  return <main className="grid min-h-screen place-items-center bg-white px-5"><form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-zinc-200 p-6"><h1 className="text-2xl font-semibold">Choose a new password</h1><label htmlFor="new-password" className="mt-6 block text-sm font-medium">New password</label><input id="new-password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2.5" />{message ? <p role="alert" className="mt-4 text-sm text-red-700">{message}</p> : null}<button className="button-primary mt-5 w-full justify-center">Update password</button></form></main>;
}
