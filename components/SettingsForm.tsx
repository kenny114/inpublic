"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button, Modal, Toast } from "@/components/ProductUI";
import { CreatorCheckoutButton } from "@/components/CreatorCheckoutButton";
import { useAuth } from "@/hooks/useAuth";
import { planLabel, useEntitlement } from "@/hooks/useEntitlement";
import { usePreferences } from "@/hooks/usePreferences";
import { signOut } from "@/lib/auth";
import { minutesOf, minutesRemaining } from "@/lib/plans";
import { deleteRecording, listRecordings, type SavedRecording } from "@/lib/recordings";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-section">
      <h2>{title}</h2>
      <div className="settings-rows">{children}</div>
    </section>
  );
}

/** One control per row: label on the left, the thing you change on the right. */
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div><span>{label}</span>{hint ? <small>{hint}</small> : null}</div>
      <div className="settings-control">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="settings-toggle" onClick={() => onChange(!checked)}>
      <i />
    </button>
  );
}

export function SettingsForm() {
  const { ready: authReady, user } = useAuth();
  const { preferences, update } = usePreferences();
  const { entitlement, loading } = useEntitlement();
  const [recordings, setRecordings] = useState<SavedRecording[] | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const loadRecordings = useCallback(() => {
    void listRecordings().then(setRecordings).catch(() => setRecordings([]));
  }, []);
  useEffect(loadRecordings, [loadRecordings]);

  const clearRecordings = async () => {
    for (const recording of recordings ?? []) await deleteRecording(recording.id);
    setConfirmClear(false);
    loadRecordings();
    setToast("Local recordings cleared");
  };

  const storedBytes = (recordings ?? []).reduce((sum, recording) => sum + (recording.metadata.fileSize ?? 0), 0);

  return (
    <div className="settings-page">
      <Section title="Account">
        <Row label="Display name">
          <input
            className="ui-input"
            value={preferences.displayName}
            onChange={(event) => update({ displayName: event.target.value })}
            placeholder="Your name"
            maxLength={80}
          />
        </Row>
        <Row label="Email">
          <input className="ui-input" value={authReady && user ? user.email ?? "" : ""} readOnly placeholder="Not signed in" />
        </Row>
        {authReady ? (
          <Row label="Session">
            {user
              ? <Button tone="secondary" onClick={() => void signOut()}>Log out</Button>
              : <Link href="/login" className="ui-button ui-button-secondary">Log in</Link>}
          </Row>
        ) : null}
      </Section>

      {/* Only defaults that are genuinely stored and genuinely read appear
          here. Device choice and permissions belong to the browser, so they
          are not dressed up as InPublic settings. */}
      <Section title="Recording defaults">
        <Row label="Camera on by default" hint="Applies when you open the recorder. You can still toggle it per take.">
          <Toggle
            label="Camera on by default"
            checked={preferences.recordCameraByDefault}
            onChange={(next) => update({ recordCameraByDefault: next })}
          />
        </Row>
        <Row label="Show transcript by default" hint="Shows the transcript strip when a canvas opens.">
          <Toggle
            label="Show transcript by default"
            checked={preferences.showTranscriptByDefault}
            onChange={(next) => update({ showTranscriptByDefault: next })}
          />
        </Row>
      </Section>

      <Section title="Plan and usage">
        {!user ? (
          <Row label="Plan"><Link href="/login" className="ui-button ui-button-secondary">Sign in to see your plan</Link></Row>
        ) : loading ? (
          <Row label="Plan"><span className="settings-value">Checking…</span></Row>
        ) : !entitlement ? (
          <Row label="Plan"><span className="settings-value">Unavailable right now</span></Row>
        ) : (
          <>
            <Row label="Plan"><span className="settings-value">{planLabel(entitlement)}</span></Row>
            <Row label="Monthly allowance"><span className="settings-value">{entitlement.unlimitedMinutes ? "Unlimited" : `${minutesOf(entitlement.allowanceSeconds)} minutes`}</span></Row>
            <Row label="Used this period"><span className="settings-value">{minutesOf(entitlement.consumedSeconds)} minutes</span></Row>
            <Row label="Remaining"><span className="settings-value">{entitlement.unlimitedMinutes ? "Unlimited" : `${minutesRemaining(entitlement.remainingSeconds)} minutes`}</span></Row>
            <Row label="Maximum session length"><span className="settings-value">{entitlement.unlimitedMinutes ? "Unlimited" : `${minutesOf(entitlement.maxSessionSeconds)} minutes`}</span></Row>
            {/* UTC, to match the server's period boundaries. */}
            {!entitlement.unlimitedMinutes ? <Row label="Resets"><span className="settings-value">{new Date(entitlement.periodEnd).toLocaleDateString(undefined, { timeZone: "UTC" })}</span></Row> : null}
            {entitlement.plan === "free" && !entitlement.isAdmin ? (
              <Row label="Upgrade" hint="Creator gives you more live time. Same product, same canvas.">
                <CreatorCheckoutButton label="Upgrade to Creator" />
              </Row>
            ) : entitlement.isAdmin ? (
              <Row label="Access" hint="Administrative access includes unlimited visual-speech time.">
                <span className="settings-value">Active</span>
              </Row>
            ) : (
              <Row label="Subscription" hint="Your Creator subscription is managed where you bought it, on Whop.">
                <span className="settings-value">{entitlement.membershipStatus}</span>
              </Row>
            )}
          </>
        )}
      </Section>

      <Section title="Recordings and data">
        <Row label="Where recordings are stored" hint="This browser only. Clearing site data removes them.">
          <span className="settings-value">
            {recordings === null ? "Checking…" : `${recordings.length} recording${recordings.length === 1 ? "" : "s"} · ${(storedBytes / 1_048_576).toFixed(1)} MB`}
          </span>
        </Row>
        <Row label="Clear local recordings">
          <Button tone="secondary" disabled={!recordings?.length} onClick={() => setConfirmClear(true)}>Clear</Button>
        </Row>
        <Row label="Export your data" hint="Sessions as JSON, recordings as video.">
          <Link href="/dashboard/exports" className="ui-button ui-button-secondary">Open exports</Link>
        </Row>
      </Section>

      <Modal
        open={confirmClear}
        title="Clear local recordings?"
        description={`${recordings?.length ?? 0} recording${recordings?.length === 1 ? "" : "s"} will be deleted from this browser. This cannot be undone.`}
        onClose={() => setConfirmClear(false)}
        footer={<><Button tone="secondary" onClick={() => setConfirmClear(false)}>Cancel</Button><Button tone="destructive" onClick={() => void clearRecordings()}>Delete recordings</Button></>}
      />
      {toast ? <Toast message={toast} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}
