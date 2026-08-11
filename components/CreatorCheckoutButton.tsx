"use client";

import { useState } from "react";

export function CreatorCheckoutButton({ label = "Choose Creator" }: { label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checkout = async () => {
    setBusy(true); setError(null);
    const response = await fetch("/api/billing/checkout", { method: "POST" });
    const payload = await response.json().catch(() => null) as { checkoutUrl?: string; error?: { message?: string } } | null;
    if (response.ok && payload?.checkoutUrl) { window.location.assign(payload.checkoutUrl); return; }
    setError(payload?.error?.message ?? "Checkout is temporarily unavailable."); setBusy(false);
  };
  return (
    <>
      <button type="button" disabled={busy} onClick={() => void checkout()} className="ui-button ui-button-primary">
        {busy ? "Opening checkout…" : label}
      </button>
      {error ? <p role="alert" className="checkout-error">{error}</p> : null}
    </>
  );
}
