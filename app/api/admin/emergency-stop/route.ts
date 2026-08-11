import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { spendLimits } from "@/lib/server/limits";
import { isAdminAccount } from "@/lib/server/admin";

async function authorized() {
  const user = await getAuthenticatedUser().catch(() => null);
  return (await isAdminAccount(user)) ? user : null;
}

export async function GET() {
  if (!(await authorized())) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { data } = await createAdminClient().from("system_budget_periods").select("emergency_stop").lte("period_start", new Date().toISOString()).gt("period_end", new Date().toISOString());
  return NextResponse.json({ enabled: (data ?? []).some((row) => row.emergency_stop) });
}

export async function POST(request: Request) {
  if (!(await authorized())) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { enabled?: boolean };
  if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "invalid request" }, { status: 400 });
  const now = new Date();
  const hour = new Date(now); hour.setUTCMinutes(0, 0, 0);
  const day = new Date(now); day.setUTCHours(0, 0, 0, 0);
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const rows = [
    { period_type: "hour", period_start: hour.toISOString(), period_end: new Date(hour.getTime() + 3600000).toISOString(), budget_limit: spendLimits.globalHourlyUsd, emergency_stop: body.enabled },
    { period_type: "day", period_start: day.toISOString(), period_end: new Date(day.getTime() + 86400000).toISOString(), budget_limit: spendLimits.globalDailyUsd, emergency_stop: body.enabled },
    { period_type: "month", period_start: month.toISOString(), period_end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(), budget_limit: spendLimits.globalMonthlyUsd, emergency_stop: body.enabled },
  ];
  const { error } = await createAdminClient().from("system_budget_periods").upsert(rows, { onConflict: "period_type,period_start" });
  if (error) return NextResponse.json({ error: "update failed" }, { status: 503 });
  return NextResponse.json({ enabled: body.enabled });
}
