"use client";

import { useEffect, useState } from "react";

/**
 * The signed-in user's real plan and allowance.
 *
 * Every number here comes from `public.current_entitlement` via
 * /api/entitlement. Nothing that shows a user their plan, their minutes or
 * their founding position may compute those locally — the server is the only
 * thing that knows what a membership actually entitles someone to.
 */
export interface ClientEntitlement {
  plan: "free" | "creator";
  allowanceSeconds: number;
  consumedSeconds: number;
  reservedSeconds: number;
  remainingSeconds: number;
  maxSessionSeconds: number;
  periodStart: string;
  periodEnd: string;
  membershipStatus: string;
  mayStart: boolean;
  blockedReason: string | null;
  foundingNumber: number | null;
}

export function useEntitlement() {
  const [entitlement, setEntitlement] = useState<ClientEntitlement | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/entitlement", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((value: ClientEntitlement | null) => {
        if (cancelled) return;
        setEntitlement(value && "plan" in value ? value : null);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) { setEntitlement(null); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  return { entitlement, loading };
}

/** "Creator · Founding #8", or "Free". */
export function planLabel(entitlement: ClientEntitlement) {
  if (entitlement.plan !== "creator") return "Free";
  return entitlement.foundingNumber ? `Creator · Founding #${entitlement.foundingNumber}` : "Creator";
}
