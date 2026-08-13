import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { anonymousTrialSeconds } from "@/lib/server/limits";
import { anonIdFromRequest } from "@/lib/server/anonId";
import type { ClientEntitlement } from "@/hooks/useUsageSession";

export const dynamic = "force-dynamic";

/**
 * Mirrors the shape of /api/entitlement so useUsageSession's anonymous mode
 * can reuse it unchanged. `plan: "free"` is a placeholder — nothing in the UI
 * currently branches on plan text for a live session, only on
 * `unlimitedMinutes` (always false here).
 */
export async function GET(request: Request) {
  const anonId = anonIdFromRequest(request);
  const fresh: ClientEntitlement = {
    plan: "free",
    remainingSeconds: anonymousTrialSeconds,
    maxSessionSeconds: anonymousTrialSeconds,
    periodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    mayStart: true,
    unlimitedMinutes: false,
  };
  if (!anonId) return NextResponse.json(fresh, { headers: { "Cache-Control": "private, no-store" } });

  const { data: trial } = await createAdminClient().from("anonymous_trials")
    .select("allowance_seconds,consumed_seconds,reserved_seconds")
    .eq("anon_id", anonId).maybeSingle();
  if (!trial) return NextResponse.json(fresh, { headers: { "Cache-Control": "private, no-store" } });

  const remaining = Math.max(0, Number(trial.allowance_seconds) - Number(trial.consumed_seconds) - Number(trial.reserved_seconds));
  const value: ClientEntitlement = {
    plan: "free",
    remainingSeconds: remaining,
    maxSessionSeconds: Number(trial.allowance_seconds),
    periodEnd: fresh.periodEnd,
    mayStart: remaining > 0,
    unlimitedMinutes: false,
  };
  return NextResponse.json(value, { headers: { "Cache-Control": "private, no-store" } });
}
