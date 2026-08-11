import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export interface Entitlement {
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
  /**
   * Position in the Founding 100, or null for Free and for Creators who
   * joined after the programme closed. Assigned once, in the database, when a
   * Creator membership first verifies — see the founding-allowances migration.
   */
  foundingNumber: number | null;
}

export async function resolveEntitlement(userId: string): Promise<Entitlement> {
  const admin = createAdminClient();
  let { data, error } = await admin.rpc("current_entitlement", { p_user_id: userId });
  const staleBefore = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
  const { data: stale } = await admin.from("subscriptions").select("provider_membership_id,last_verified_at").eq("user_id", userId).eq("provider", "whop").or(`last_verified_at.is.null,last_verified_at.lt.${staleBefore}`).maybeSingle();
  if (stale?.provider_membership_id && process.env.WHOP_API_KEY) {
    try {
      const { createWhopClient, applyVerifiedMembership } = await import("./whop");
      const membership = await createWhopClient().memberships.retrieve(stale.provider_membership_id);
      const day = new Date().toISOString().slice(0, 10);
      await applyVerifiedMembership(`scheduled-reconcile:${membership.id}:${day}`, "membership.reconciled", new Date().toISOString(), membership as never);
      ({ data, error } = await admin.rpc("current_entitlement", { p_user_id: userId }));
    } catch {
      // Fail closed: the first entitlement result remains Free.
    }
  }
  if (error || !data?.[0]) throw new Error(`entitlement_unavailable: ${error?.message ?? "missing row"}`);
  const row = data[0] as Record<string, unknown>;
  return {
    plan: row.plan === "creator" ? "creator" : "free",
    allowanceSeconds: Number(row.allowance_seconds),
    consumedSeconds: Number(row.consumed_seconds),
    reservedSeconds: Number(row.reserved_seconds),
    remainingSeconds: Number(row.remaining_seconds),
    maxSessionSeconds: Number(row.max_session_seconds),
    periodStart: String(row.period_start),
    periodEnd: String(row.period_end),
    membershipStatus: String(row.membership_status ?? "none"),
    mayStart: Boolean(row.may_start),
    blockedReason: row.blocked_reason ? String(row.blocked_reason) : null,
    // Absent until the founding-allowances migration is applied; a missing
    // column reads as "no founding position", which is the safe answer.
    foundingNumber: row.founding_number == null ? null : Number(row.founding_number),
  };
}

/**
 * How many of the 100 founding places are unclaimed.
 *
 * Returns null when the answer cannot be trusted — before the migration lands,
 * or if the call fails. Callers must render nothing in that case rather than
 * guess: a made-up scarcity number is worse than no number.
 */
export async function foundingPlacesRemaining(): Promise<number | null> {
  const { data, error } = await createAdminClient().rpc("founding_places_remaining");
  if (error || data == null) return null;
  const remaining = Number(data);
  return Number.isFinite(remaining) ? remaining : null;
}
