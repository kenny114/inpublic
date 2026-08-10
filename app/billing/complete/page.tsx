"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function BillingCompletePage() {
  const [status, setStatus] = useState("Verifying your membership with Whop…");
  useEffect(() => {
    void fetch("/api/billing/reconcile", { method: "POST" }).then((response) => setStatus(response.ok ? "Membership verification finished. Your server-authoritative allowance is ready." : "Payment may still be processing. Your plan will update after Whop verifies it.")).catch(() => setStatus("Payment may still be processing. Your plan will update after Whop verifies it."));
  }, []);
  return <main className="grid min-h-screen place-items-center bg-white px-5"><section className="max-w-lg rounded-2xl border border-zinc-200 p-8 text-center"><p className="eyebrow">Creator</p><h1 className="mt-3 text-3xl font-semibold">Thanks for supporting InPublic</h1><p className="mt-4 leading-7 text-zinc-600" role="status">{status}</p><Link href="/dashboard" className="button-primary mt-7">Return to dashboard</Link></section></main>;
}
