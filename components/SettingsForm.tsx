"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { usePreferences } from "@/hooks/usePreferences";
import { signOut } from "@/lib/auth";
import { billing } from "@/lib/billing";
import { FREE_RECORDING_LIMIT_MS, FREE_SESSION_LIMIT } from "@/lib/product";
import { features } from "@/lib/features";

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && <p className="mt-1.5 text-sm leading-6 text-zinc-500">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}

const inputClass = "rounded-lg border border-zinc-200 px-3 py-2 text-sm font-normal outline-none focus:border-zinc-400";

export function SettingsForm() {
  const { ready: authReady, user } = useAuth();
  const { preferences, update } = usePreferences();

  return (
    <div className="mt-6 grid max-w-3xl gap-4">
      <Section title="Profile">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Display name">
            <input
              value={preferences.displayName}
              onChange={(event) => update({ displayName: event.target.value })}
              placeholder="Your name"
              className={inputClass}
            />
          </Field>
          <Field label="Email">
            <input
              value={authReady && user ? user.email : ""}
              readOnly
              placeholder="Not signed in"
              className={`${inputClass} bg-zinc-50 text-zinc-500`}
            />
          </Field>
        </div>
        <p className="mt-3 text-xs leading-5 text-zinc-500">
          Your display name is used in the dashboard greeting and stays in this browser. Email comes from the
          preview sign-in; profile images arrive with real accounts.
        </p>
        {authReady && (
          <div className="mt-4">
            {user
              ? <button type="button" onClick={() => signOut()} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50">Log out</button>
              : <Link href="/login" className="inline-flex rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50">Log in</Link>}
          </div>
        )}
      </Section>

      {features.storyMode && (
        <Section title="Preferences" description="Used by the dashboard. The canvas keeps its own controls.">
          <Field label="Default mode">
            <select
              value={preferences.defaultMode}
              onChange={(event) => update({ defaultMode: event.target.value === "story" ? "story" : "standard" })}
              className={`${inputClass} max-w-xs`}
            >
              <option value="standard">Standard Mode</option>
              <option value="story">Story Mode</option>
            </select>
          </Field>
          <p className="mt-3 text-xs leading-5 text-zinc-500">
            The “New session” button opens this mode. The two buttons on the dashboard home still open a specific
            mode, and you can switch modes on the canvas at any time.
          </p>
        </Section>
      )}

      <Section
        title="Recording and capture"
        description="Microphone, camera, transcript visibility, and what gets captured are chosen on the canvas at the moment you record, using your browser's device permissions."
      >
        <ul className="grid gap-1.5 text-sm leading-6 text-zinc-500">
          <li>Canvas capture is always included; microphone and camera are toggled in the control bar.</li>
          <li>Recordings are saved as WebM in this browser, with their transcript and session state.</li>
          <li>Free preview limits: {Math.round(FREE_RECORDING_LIMIT_MS / 60000)} minutes per recording, {FREE_SESSION_LIMIT} saved recordings.</li>
        </ul>
        <Link href="/create?mode=standard&new=1" className="mt-4 inline-flex rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50">Open the canvas</Link>
      </Section>

      <Section title="Billing">
        <p className="text-sm font-medium">{billing.configured ? "Paid plan" : "Free plan"}</p>
        <p className="mt-1.5 text-sm leading-6 text-zinc-500">
          {billing.configured
            ? "Manage your subscription with your payment provider."
            : "Billing is not connected in this preview. No payment method is stored and no charge can be made. Usage tracking arrives with billing, so no usage figures are shown."}
        </p>
        {!billing.configured && (
          <button type="button" disabled className="mt-4 cursor-not-allowed rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-400">
            Upgrade — not available yet
          </button>
        )}
      </Section>

      <Section title="Self-hosting">
        <p className="text-sm leading-6 text-zinc-500">Self-hosting is planned for a future version.</p>
      </Section>
    </div>
  );
}
