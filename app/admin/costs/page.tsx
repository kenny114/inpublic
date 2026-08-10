import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
const money = (value: number) => `$${value.toFixed(4)}`;
type CostRows = Array<[string, number]>;
const percentile = (values: number[], p: number) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)] : 0;
const group = (rows: Array<Record<string, unknown>>, key: string): CostRows => (Object.entries(rows.reduce<Record<string, number>>((map, row) => { const name = String(row[key] ?? "unknown"); map[name] = (map[name] ?? 0) + Number(row.actual_cost_usd ?? 0); return map; }, {})) as CostRows).sort((a, b) => b[1] - a[1]);

export default async function AdminCostsPage() {
  const user = await getAuthenticatedUser();
  const allowlist = new Set((process.env.ADMIN_EMAIL_ALLOWLIST ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
  if (!user?.email || !allowlist.has(user.email.toLowerCase())) redirect("/dashboard");
  const admin = createAdminClient();
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const monthStart = new Date(Date.UTC(dayStart.getUTCFullYear(), dayStart.getUTCMonth(), 1));
  const [eventsResult, sessionsResult, blockedResult, paymentsResult, subscriptionsResult, profilesResult, limitsResult] = await Promise.all([
    admin.from("cost_events").select("user_id,session_id,feature,provider,model,attempt,status,reserved_cost_usd,estimated_cost_usd,actual_cost_usd,occurred_at").gte("occurred_at", monthStart.toISOString()),
    admin.from("usage_sessions").select("id,user_id,consumed_seconds,actual_cost_usd,status,lease_expires_at").gte("created_at", monthStart.toISOString()),
    admin.from("security_events").select("event_type,reason_code").gte("occurred_at", dayStart.toISOString()),
    admin.from("payment_events").select("gross_amount,fees,affiliate_amount,net_amount,status").gte("provider_timestamp", monthStart.toISOString()),
    admin.from("subscriptions").select("user_id,plan,status,current_period_end"),
    admin.from("profiles").select("id", { count: "exact", head: true }),
    admin.from("rate_limit_buckets").select("count").gte("updated_at", dayStart.toISOString()),
  ]);
  const events = eventsResult.data ?? [];
  const finals = events.filter((event) => event.status !== "reserved");
  const sessions = sessionsResult.data ?? [];
  const today = finals.filter((event) => new Date(event.occurred_at) >= dayStart).reduce((sum, event) => sum + Number(event.actual_cost_usd), 0);
  const month = finals.reduce((sum, event) => sum + Number(event.actual_cost_usd), 0);
  const reserved = events.filter((event) => event.status === "reserved").reduce((sum, event) => sum + Number(event.reserved_cost_usd), 0);
  const estimated = finals.reduce((sum, event) => sum + Number(event.estimated_cost_usd), 0);
  const userCosts = new Map<string, number>();
  const sessionCosts = new Map<string, number>();
  for (const event of finals) {
    userCosts.set(event.user_id, (userCosts.get(event.user_id) ?? 0) + Number(event.actual_cost_usd));
    if (event.session_id) sessionCosts.set(event.session_id, (sessionCosts.get(event.session_id) ?? 0) + Number(event.actual_cost_usd));
  }
  const userValues = [...userCosts.values()];
  const topUsers: CostRows = [...userCosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topSessions: CostRows = [...sessionCosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const totalMinutes = sessions.reduce((sum, session) => sum + Number(session.consumed_seconds), 0) / 60;
  const activeSessions = sessions.filter((session) => session.status === "active" && new Date(session.lease_expires_at) > new Date()).length;
  const retries = finals.filter((event) => Number(event.attempt) > 1).reduce((sum, event) => sum + Number(event.actual_cost_usd), 0);
  const payments = paymentsResult.data ?? [];
  const gross = payments.reduce((sum, event) => sum + Number(event.gross_amount ?? 0), 0);
  const fees = payments.reduce((sum, event) => sum + Number(event.fees ?? 0) + Number(event.affiliate_amount ?? 0), 0);
  const plans = new Map((subscriptionsResult.data ?? []).map((subscription) => [subscription.user_id, subscription.plan]));
  const planRows = finals.map((event) => ({ ...event, plan: plans.get(event.user_id) ?? "free" }));
  const creatorCount = (subscriptionsResult.data ?? []).filter((subscription) => subscription.plan === "creator" && new Date(subscription.current_period_end ?? 0) > new Date()).length;
  const conversion = profilesResult.count ? (creatorCount / profilesResult.count) * 100 : 0;
  const rateLimitHits = (limitsResult.data ?? []).reduce((sum, row) => sum + Math.max(0, Number(row.count) - 1), 0);
  const dimensions: Array<[string, CostRows]> = [["Provider", group(finals, "provider")], ["Model", group(finals, "model")], ["Feature", group(finals, "feature")], ["Plan", group(planRows, "plan")]];

  return <main className="min-h-screen bg-zinc-50 px-6 py-10 text-zinc-950"><section className="mx-auto max-w-6xl"><p className="eyebrow">Internal</p><h1 className="mt-2 text-3xl font-semibold">Cost protection</h1><div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[["Spend today", money(today)],["Billing month", money(month)],["Reserved / estimated", `${money(reserved)} / ${money(estimated)}`],["Active sessions", String(activeSessions)],["Cost / visual minute", money(totalMinutes ? month / totalMinutes : 0)],["P50 / P90 / P99 user", `${money(percentile(userValues,.5))} / ${money(percentile(userValues,.9))} / ${money(percentile(userValues,.99))}`],["Retry cost", money(retries)],["Free → Creator", `${conversion.toFixed(1)}%`]].map(([label,value]) => <article key={label} className="rounded-xl border border-zinc-200 bg-white p-5"><p className="text-sm text-zinc-500">{label}</p><p className="mt-2 text-xl font-semibold">{value}</p></article>)}</div><div className="mt-6 grid gap-6 md:grid-cols-2">{dimensions.map(([label,rows]) => <article key={label} className="rounded-xl border border-zinc-200 bg-white p-5"><h2 className="font-semibold">Cost by {label.toLowerCase()}</h2><ul className="mt-4 space-y-2">{rows.map(([name,value]) => <li key={name} className="flex justify-between"><span>{name}</span><span>{money(value)}</span></li>)}</ul></article>)}</div><div className="mt-6 grid gap-6 md:grid-cols-3"><Ranked title="Highest-cost users" rows={topUsers} /><Ranked title="Highest-cost sessions" rows={topSessions} /><article className="rounded-xl border border-zinc-200 bg-white p-5"><h2 className="font-semibold">Protection and margin</h2><dl className="mt-4 grid grid-cols-2 gap-2 text-sm"><dt>Blocked events today</dt><dd>{blockedResult.data?.length ?? 0}</dd><dt>Rate-limit excess today</dt><dd>{rateLimitHits}</dd><dt>Creator gross</dt><dd>{money(gross)}</dd><dt>Known Whop fees</dt><dd>{money(fees)}</dd><dt>Gross margin</dt><dd>{money(gross - fees - month)}</dd></dl></article></div><p className="mt-6 text-sm text-zinc-500">No transcripts, raw webhook payloads, full user identifiers, or payment details are included.</p></section></main>;
}

function Ranked({ title, rows }: { title: string; rows: Array<[string, number]> }) {
  return <article className="rounded-xl border border-zinc-200 bg-white p-5"><h2 className="font-semibold">{title}</h2><ol className="mt-4 space-y-2 text-sm">{rows.map(([id,value]) => <li key={id} className="flex justify-between"><span>{id.slice(0, 8)}…</span><span>{money(value)}</span></li>)}</ol></article>;
}
