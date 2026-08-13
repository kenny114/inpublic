"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { track } from "@vercel/analytics";
import { Mic } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { loadSessionById, saveSession } from "@/lib/persist";
import { attributionProperties, captureAttribution, getAttribution } from "@/lib/attribution";

const Board = dynamic(() => import("@/components/Board"), {
  ssr: false,
  loading: () => <div className="h-dvh w-dvw bg-white" />,
});

/**
 * The whole point of /try is minimizing time-to-first-value, so this is one
 * client component with two states rather than two routes — no extra
 * navigation, no extra JS chunk boundary between "read the pitch" and "the
 * actual engine". Requesting mic permission here (rather than waiting for
 * Board's own ControlBar) surfaces the OS/browser prompt immediately on the
 * first tap, matching "Try InPublic → allow microphone → start talking".
 */
function TryLanding({ onStart }: { onStart: () => void }) {
  const [requesting, setRequesting] = useState(false);
  const [deniedError, setDeniedError] = useState<string | null>(null);

  useEffect(() => { track("try_page_view", attributionProperties(captureAttribution("/try"))); }, []);

  const start = useCallback(async () => {
    const props = attributionProperties(getAttribution());
    track("microphone_clicked", props);
    setRequesting(true);
    setDeniedError(null);
    // Fetch the Board chunk in parallel with the permission prompt rather
    // than after it resolves — not on page view (that would cost bandwidth
    // for visitors who never click), and not sequentially after permission
    // is granted, which would add its own wait on top of the OS dialog.
    // Swallowed here deliberately: a failed preload isn't fatal (next/dynamic's
    // own wrapper will just fetch it again on mount) and must never surface as
    // a misleading "microphone access" error below.
    void import("@/components/Board").catch(() => undefined);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Only warming the permission prompt up front — Board's own pipeline
      // opens its own stream when the visitor taps "Start speaking" there.
      stream.getTracks().forEach((mediaTrack) => mediaTrack.stop());
      track("microphone_permission_granted", props);
      onStart();
    } catch {
      track("microphone_permission_denied", props);
      setDeniedError("InPublic needs microphone access to work. Check your browser's permission settings and try again.");
      setRequesting(false);
    }
  }, [onStart]);

  return (
    <div className="try-landing">
      <div className="try-landing-copy">
        <h1>Talk. Watch your words become visual.</h1>
        <p>No signup required.</p>
        <button type="button" className="try-landing-cta" onClick={() => void start()} disabled={requesting}>
          <Mic size={18} />
          {requesting ? "Requesting microphone…" : "Start Speaking"}
        </button>
        {deniedError ? <p className="try-landing-error" role="alert">{deniedError}</p> : null}
        <Link href="/login" className="try-landing-signin">Already have an account? Sign in</Link>
      </div>
    </div>
  );
}

function TryClaim({ sessionId }: { sessionId: string | null }) {
  useEffect(() => { track("anonymous_session_completed"); }, []);
  const claimHref = `/login?next=${encodeURIComponent(`/try?claim=1${sessionId ? `&session=${sessionId}` : ""}`)}`;
  return (
    <div className="try-landing">
      <div className="try-landing-copy">
        <h1>Keep this session</h1>
        <p>Create a free account to save your recording and continue using InPublic.</p>
        <Link href={claimHref} className="try-landing-cta" onClick={() => { const props = attributionProperties(getAttribution()); track("claim_session_clicked", props); track("signup_started_from_trial", props); }}>
          Create free account
        </Link>
        <Link href="/try" className="try-landing-signin">Start another trial</Link>
      </div>
    </div>
  );
}

/**
 * Reached after signup/sign-in completes and lands back on /try?claim=1 —
 * covers every auth path (immediate sign-in, immediate sign-up, and the
 * delayed sign-up-then-confirm-email-then-/auth/callback path all redirect
 * through `next`, which carries this same URL). Marks the trial claimed
 * (best-effort, see /api/anon/claim) and re-keys the local session by simply
 * re-calling saveSession() now that requests carry a real auth cookie —
 * /api/projects derives user_id server-side, so this "transfer" is just a
 * normal save that finally has permission to reach the cloud. Recordings
 * need no equivalent step: lib/recordings.ts was always browser-local
 * IndexedDB, never account-scoped, so they're already there.
 */
function TryClaimComplete({ sessionId }: { sessionId: string | null }) {
  const router = useRouter();
  const { ready, user } = useAuth();
  const [status, setStatus] = useState<"working" | "done">("working");

  useEffect(() => {
    if (!ready || !user) return;
    let cancelled = false;
    void (async () => {
      await fetch("/api/anon/claim", { method: "POST" }).catch(() => undefined);
      if (sessionId) {
        const session = await loadSessionById(sessionId).catch(() => null);
        if (session) await saveSession({ ...session, savedAt: Date.now() }).catch(() => undefined);
      }
      if (cancelled) return;
      const props = attributionProperties(getAttribution());
      track("anonymous_session_claimed", props);
      track("signup_completed_from_trial", props);
      setStatus("done");
      router.replace(sessionId ? `/create?session=${encodeURIComponent(sessionId)}` : "/dashboard");
    })();
    return () => { cancelled = true; };
  }, [ready, user, router, sessionId]);

  if (ready && !user) {
    // Landed here without a session (e.g. the confirmation link was opened
    // in a different browser) — send them through sign-in with the same
    // claim URL as `next`, rather than stalling on a spinner forever.
    return (
      <div className="try-landing">
        <div className="try-landing-copy">
          <h1>Almost there</h1>
          <p>Sign in to finish saving your trial session.</p>
          <Link href={`/login?next=${encodeURIComponent(`/try?claim=1${sessionId ? `&session=${sessionId}` : ""}`)}`} className="try-landing-cta">Sign in</Link>
        </div>
      </div>
    );
  }
  return (
    <div className="try-landing">
      <div className="try-landing-copy">
        <h1>{status === "done" ? "Saved" : "Saving your session…"}</h1>
        <p>One moment.</p>
      </div>
    </div>
  );
}

function TryPageBody() {
  const params = useSearchParams();
  const done = params.get("done") === "1";
  const claim = params.get("claim") === "1";
  const sessionId = params.get("session");
  const [started, setStarted] = useState(false);

  if (started) return <Board guest startFresh />;
  if (claim) return <TryClaimComplete sessionId={sessionId} />;
  if (done) return <TryClaim sessionId={sessionId} />;
  return <TryLanding onStart={() => setStarted(true)} />;
}

export default function TryPage() {
  return (
    <Suspense fallback={<div className="h-dvh w-dvw bg-white" />}>
      <TryPageBody />
    </Suspense>
  );
}
