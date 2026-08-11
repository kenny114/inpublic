/**
 * Plan shapes, mirrored from the database.
 *
 * `public.current_entitlement` is the authority — every surface that shows a
 * user their real allowance reads it from /api/entitlement, never from here.
 * This module exists so the marketing pages and the tests have one place to
 * state what a plan *is*, and so both stay in step with the SQL.
 */

export const PLAN_DEFINITIONS = {
  free: { allowanceSeconds: 1_800, maxSessionSeconds: 1_200 },
  creator: { allowanceSeconds: 7_200, maxSessionSeconds: 3_600 },
} as const;

export type Plan = keyof typeof PLAN_DEFINITIONS;

/**
 * Founding 100.
 *
 * There is exactly one Creator subscription — $15/month, one Whop plan. The
 * founding programme is an InPublic-side allowance, keyed to the order in
 * which Creator memberships first verified, and held for as long as the
 * subscription stays continuously active. It buys more minutes, nothing else.
 */
export const FOUNDING_TIERS = [
  { upTo: 10, allowanceSeconds: 14_400 },
  { upTo: 25, allowanceSeconds: 12_600 },
  { upTo: 50, allowanceSeconds: 10_800 },
  { upTo: 100, allowanceSeconds: 9_000 },
] as const;

export const FOUNDING_PLACES = 100;

/** Allowance for a Creator at this founding position. 101+ is the base plan. */
export function foundingAllowanceSeconds(position: number | null | undefined) {
  if (!position || position < 1) return PLAN_DEFINITIONS.creator.allowanceSeconds;
  const tier = FOUNDING_TIERS.find((candidate) => position <= candidate.upTo);
  return tier ? tier.allowanceSeconds : PLAN_DEFINITIONS.creator.allowanceSeconds;
}

export function utcCalendarMonth(date: Date) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return { start, end };
}

export function remainingAllowance(plan: Plan, consumedSeconds: number, reservedSeconds: number) {
  return Math.max(0, PLAN_DEFINITIONS[plan].allowanceSeconds - Math.max(0, consumedSeconds) - Math.max(0, reservedSeconds));
}

/** "9" for 536 seconds — always rounds down, so it never over-promises. */
export function minutesRemaining(seconds: number) {
  return Math.max(0, Math.floor(Math.max(0, seconds) / 60));
}

/** "30" for 1800 seconds. Allowances are whole minutes by construction. */
export function minutesOf(seconds: number) {
  return Math.round(Math.max(0, seconds) / 60);
}
