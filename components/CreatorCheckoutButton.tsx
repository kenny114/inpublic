"use client";

import { useState } from "react";

export function CreatorCheckoutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checkout = async () => {
    setBusy(true); setError(null);
    const response = await fetch("/api/billing/checkout", { method: "POST" });
    const payload = await response.json().catch(() => null) as { checkoutUrl?: string; error?: { message?: string } } | null;
    if (response.ok && payload?.checkoutUrl) { window.location.assign(payload.checkoutUrl); return; }
    setError(payload?.error?.message ?? "Checkout is temporarily unavailable."); setBusy(false);
  };
  return <div className="mt-8"><button type="button" disabled={busy} onClick={() => void checkout()} className="button-primary">{busy ? "Opening checkout…" : "Choose Creator"}</button>{error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}</div>;
}
