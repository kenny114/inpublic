"use client";

import { useState, type FormEvent } from "react";
import { track } from "@vercel/analytics";
import { Logo } from "@/components/ProductUI";

/**
 * The whole page InPublic shows while the real build is in progress — one
 * screen, one decision, same as /try's "minimize time to first action"
 * pattern. No pitch deck, no pricing, no feature list: just the promise and
 * an email field, matching the calm tone the rest of the product uses.
 */
export function Waitlist() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("submitting");
    setError(null);
    track("waitlist_submit");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "Something went wrong. Try again.");
      setStatus("done");
      track("waitlist_joined");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    }
  };

  return (
    <main className="waitlist-landing">
      <Logo />
      <div className="waitlist-copy">
        <h1>Speak. Watch your ideas take shape.</h1>
        <p>
          InPublic is still being built, carefully — not rushed out half-finished. Leave
          your email and we&apos;ll let you know the moment it&apos;s ready.
        </p>
      </div>
      {status === "done" ? (
        <p className="waitlist-success">You&apos;re on the list. We&apos;ll email you when InPublic is ready.</p>
      ) : (
        <form className="waitlist-form" onSubmit={(event) => void submit(event)}>
          <input
            type="email"
            required
            placeholder="you@example.com"
            className="ui-input"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={status === "submitting"}
            aria-label="Email address"
          />
          <button type="submit" className="ui-button ui-button-primary" disabled={status === "submitting"}>
            {status === "submitting" ? "Joining…" : "Join the waitlist"}
          </button>
        </form>
      )}
      {error ? <p className="waitlist-error" role="alert">{error}</p> : null}
      <p className="waitlist-fineprint">No spam — one email, when it&apos;s ready.</p>
    </main>
  );
}
