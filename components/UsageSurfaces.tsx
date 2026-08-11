"use client";

import Link from "next/link";
import { planLabel, useEntitlement, type ClientEntitlement } from "@/hooks/useEntitlement";
import { minutesOf, minutesRemaining } from "@/lib/plans";

/**
 * Where a signed-in user meets their plan.
 *
 * Upgrading used to live at the end of avatar -> Settings -> scroll -> Billing.
 * These two surfaces replace that: a compact indicator that is always in the
 * header, and a panel on the dashboard home. Both read the real entitlement;
 * neither invents a number, and both render nothing at all rather than guess
 * while the answer is still loading.
 */

function usedFraction(entitlement: ClientEntitlement) {
  if (entitlement.unlimitedMinutes) return 0;
  if (entitlement.allowanceSeconds <= 0) return 0;
  const used = entitlement.consumedSeconds + entitlement.reservedSeconds;
  return Math.min(1, Math.max(0, used / entitlement.allowanceSeconds));
}

/** Header indicator: "9 min left · Free" plus an Upgrade link on Free. */
export function UsagePill() {
  const { entitlement } = useEntitlement();
  if (!entitlement) return null;
  const left = minutesRemaining(entitlement.remainingSeconds);
  return (
    <div className="usage-pill">
      <Link href="/dashboard/settings" className="usage-pill-status">
        <strong>{entitlement.unlimitedMinutes ? "Unlimited" : `${left} min left`}</strong>
        <span>{planLabel(entitlement)}</span>
      </Link>
      {entitlement.plan === "free" && !entitlement.unlimitedMinutes ? <Link href="/pricing" className="usage-pill-upgrade">Upgrade</Link> : null}
    </div>
  );
}

/** Dashboard panel: plan, minutes remaining, and the way to get more. */
export function UsagePanel() {
  const { entitlement, loading } = useEntitlement();
  if (loading || !entitlement) return null;

  const remaining = minutesRemaining(entitlement.remainingSeconds);
  const allowance = minutesOf(entitlement.allowanceSeconds);
  const resets = new Date(entitlement.periodEnd);

  return (
    <section className="usage-panel" aria-labelledby="usage-title">
      <div>
        <h2 id="usage-title">{planLabel(entitlement)}</h2>
        {entitlement.unlimitedMinutes ? (
          <p><strong>Unlimited visual-speech time</strong> · administrative access</p>
        ) : (
          <>
            <p>
              <strong>{remaining} of {allowance} minutes</strong> remaining · resets{" "}
              {/* Periods are UTC calendar months on the server. Rendering them in
                  local time turns "1 Sep" into "31 Aug" west of Greenwich. */}
              {resets.toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" })}
            </p>
            <div className="usage-meter" role="presentation">
              <i style={{ width: `${Math.round(usedFraction(entitlement) * 100)}%` }} />
            </div>
          </>
        )}
      </div>
      {entitlement.plan === "free" && !entitlement.unlimitedMinutes ? (
        <Link href="/pricing" className="ui-button ui-button-secondary">Upgrade</Link>
      ) : null}
    </section>
  );
}
