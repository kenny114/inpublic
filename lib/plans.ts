export const PLAN_DEFINITIONS = {
  free: { allowanceSeconds: 1_800, maxSessionSeconds: 1_200 },
  creator: { allowanceSeconds: 12_000, maxSessionSeconds: 3_600 },
} as const;

export type Plan = keyof typeof PLAN_DEFINITIONS;

export function utcCalendarMonth(date: Date) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return { start, end };
}

export function remainingAllowance(plan: Plan, consumedSeconds: number, reservedSeconds: number) {
  return Math.max(0, PLAN_DEFINITIONS[plan].allowanceSeconds - Math.max(0, consumedSeconds) - Math.max(0, reservedSeconds));
}
