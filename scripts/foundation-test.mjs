import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PLAN_DEFINITIONS, remainingAllowance, utcCalendarMonth } from "../lib/plans.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const schema = read("supabase/migrations/202608090001_foundation.sql");
const spend = read("supabase/migrations/202608090002_spend_controls.sql");
const whop = read("supabase/migrations/202608090003_whop_events.sql");
const guard = read("lib/server/provider-guard.ts");
const webhook = read("app/api/webhooks/whop/route.ts");
const projectRoute = read("app/api/projects/route.ts");
const projectItemRoute = read("app/api/projects/[id]/route.ts");
const persist = read("lib/persist.ts");
const authRoute = read("app/api/auth/[action]/route.ts");

const checks = [];
const check = (name, value) => { assert.equal(Boolean(value), true, name); checks.push(name); };

assert.deepEqual(PLAN_DEFINITIONS.free, { allowanceSeconds: 1800, maxSessionSeconds: 1200 });
assert.deepEqual(PLAN_DEFINITIONS.creator, { allowanceSeconds: 12000, maxSessionSeconds: 3600 });
assert.equal(remainingAllowance("free", 1799, 1), 0);
assert.equal(remainingAllowance("free", -20, -5), 1800);
const feb = utcCalendarMonth(new Date("2028-02-29T23:00:00Z"));
assert.equal(feb.start.toISOString(), "2028-02-01T00:00:00.000Z");
assert.equal(feb.end.toISOString(), "2028-03-01T00:00:00.000Z");
checks.push("exact plan allowances, max sessions, non-negative remaining usage and UTC periods");

for (const table of ["profiles","projects","subscriptions","usage_periods","usage_sessions","cost_events","payment_events","rate_limit_buckets","system_budget_periods"]) check(`RLS enabled: ${table}`, schema.includes(`alter table public.${table} enable row level security`));
check("projects are scoped to auth.uid", /project_select_own[\s\S]*auth\.uid\(\)[\s\S]*user_id/.test(schema));
check("privileged billing and ledgers have no user insert policies", !/create policy .* on public\.(subscriptions|cost_events|payment_events) for insert/i.test(schema));
check("single active session is a partial unique index", /unique index one_active_usage_session_per_user[\s\S]*status in \('active','paused'\)/.test(schema));
check("users cannot hard-delete projects through RLS", !schema.includes("project_delete_own"));
check("authenticated table grants are least-privilege", schema.includes("grant insert(id,user_id,title,mode,canvas_json,transcript_json,preview_data,last_opened_at) on public.projects to authenticated") && !schema.includes("grant delete on public.projects") && schema.includes("grant select on public.subscriptions,public.usage_periods,public.usage_sessions to authenticated"));
check("usage mutations take transactional locks", schema.includes("pg_advisory_xact_lock") && schema.includes("for update"));
check("parallel provider spend takes global and user locks", (spend.match(/pg_advisory_xact_lock/g) ?? []).length >= 2);
check("cost reservations are server-only under RLS", spend.includes("alter table public.cost_reservations enable row level security") && spend.includes("revoke all on public.cost_reservations from anon,authenticated"));
check("public auth endpoints use atomic IP and email-hash limits", authRoute.includes("consume_rate_limit") && authRoute.includes("auth:${action}:ip") && authRoute.includes("auth:${action}:email"));
check("reservations precede provider execution in shared guard", guard.indexOf("reserve_provider_cost") < guard.lastIndexOf("return { userId"));
check("expired leases are rejected", guard.includes("lease_expires_at") && guard.includes("expired_lease"));
check("all budget classes are enforced", ["p_user_daily_limit","p_user_period_limit","p_global_hour_limit","p_global_day_limit","p_global_month_limit","p_artist_session_limit","p_session_call_limit"].every((name) => spend.includes(name)));
check("failed calls reconcile estimated exposure", guard.includes('status: "failed"') || guard.includes('"failed"'));
check("webhook signature is verified before event access", webhook.indexOf("webhooks.unwrap") < webhook.indexOf("event.api_version"));
check("invalid webhook signatures return 401", webhook.includes('status: 401'));
check("Whop event IDs are unique and duplicate-safe", schema.includes("whop_event_id text not null unique") && whop.includes("on conflict(whop_event_id) do nothing"));
check("out-of-order membership updates are ignored", whop.includes("p_provider_updated_at < existing.provider_updated_at"));
check("checkout redirect is absent from entitlement logic", !read("app/billing/complete/page.tsx").includes("subscriptions").valueOf());
check("client-supplied project user ID is ignored", projectRoute.includes("user_id: user.id") && projectRoute.includes("_ignoredUserId"));
check("cloud saves use updated_at compare-and-swap", projectItemRoute.includes('.eq("updated_at", expected)') && projectItemRoute.includes('status: 409'));
check("IndexedDB is written before cloud sync", persist.indexOf("await saveLocalSession(session)") < persist.indexOf("saveCloudSession(session)"));
check("offline failures retain local projects", persist.includes('state: "offline"') && persist.includes("IndexedDB remains the offline source"));

// Caught live: AudioReplayPanel.tsx called /api/audio/upload, /api/math and
// /api/artist without providerRequestHeaders(), so the server always saw
// "no active session" even while the user was genuinely listening — every
// other call site in the app attaches it. A missing header here is silent
// until someone hits exactly this UI path, so it's cheap to catch statically
// rather than relying on live testing to notice again.
const audioReplayPanel = read("components/AudioReplayPanel.tsx");
const audioReplayApiCalls = (audioReplayPanel.match(/fetch\(\s*"\/api\//g) ?? []).length;
const audioReplayHeaderCalls = (audioReplayPanel.match(/providerRequestHeaders\(/g) ?? []).length;
check(
  "every /api call in AudioReplayPanel attaches the active usage-session header",
  audioReplayApiCalls > 0 && audioReplayHeaderCalls >= audioReplayApiCalls,
);

const roots = ["app", "components", "hooks", "lib"];
const files = [];
function walk(path) { for (const name of readdirSync(path)) { const child = join(path, name); if (statSync(child).isDirectory()) walk(child); else if (/\.(ts|tsx)$/.test(name)) files.push(child); } }
for (const root of roots) walk(new URL(`../${root}`, import.meta.url).pathname.slice(1));
for (const file of files) {
  const source = readFileSync(file, "utf8");
  if (!source.startsWith('"use client"') && !source.startsWith("'use client'")) continue;
  check(`no server secret in client module ${file}`, !/SUPABASE_SERVICE_ROLE_KEY|WHOP_API_KEY|WHOP_WEBHOOK_SECRET|ANTHROPIC_API_KEY|DEEPGRAM_API_KEY|GEMINI_API_KEY/.test(source));
}

console.log(`✓ ${checks.length} authentication, RLS, usage, Whop, cost and persistence foundation checks passed`);
