import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { FOUNDING_TIERS, PLAN_DEFINITIONS, foundingAllowanceSeconds, minutesOf, minutesRemaining, remainingAllowance, utcCalendarMonth } from "../lib/plans.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const schema = read("supabase/migrations/202608090001_foundation.sql");
const spend = read("supabase/migrations/202608090002_spend_controls.sql");
const whop = read("supabase/migrations/202608090003_whop_events.sql");
const guard = read("lib/server/provider-guard.ts");
const deepgramRoute = read("app/api/deepgram/token/route.ts");
const webhook = read("app/api/webhooks/whop/route.ts");
const projectRoute = read("app/api/projects/route.ts");
const projectItemRoute = read("app/api/projects/[id]/route.ts");
const persist = read("lib/persist.ts");
const authRoute = read("app/api/auth/[action]/route.ts");
const middleware = read("middleware.ts");
const replayAuthorizationRoute = read("app/api/dev/replay-authorization/route.ts");
const replayAuthorization = read("lib/server/developmentReplayAuthorization.ts");
const deepgramHook = read("hooks/useDeepgram.ts");
const board = read("components/Board.tsx");
const latencySink = read("lib/latencySink.ts");
const latencyRoute = read("app/api/telemetry/latency/route.ts");

const checks = [];
const check = (name, value) => { assert.equal(Boolean(value), true, name); checks.push(name); };

assert.deepEqual(PLAN_DEFINITIONS.free, { allowanceSeconds: 1800, maxSessionSeconds: 1200 });
assert.deepEqual(PLAN_DEFINITIONS.creator, { allowanceSeconds: 7200, maxSessionSeconds: 3600 });
assert.equal(remainingAllowance("free", 1799, 1), 0);
assert.equal(remainingAllowance("free", -20, -5), 1800);

// The founding ladder, at every boundary. These numbers are also written into
// public.founding_allowance_seconds — the two must not drift.
assert.equal(foundingAllowanceSeconds(null), 7200);
assert.equal(foundingAllowanceSeconds(0), 7200);
for (const [position, seconds] of [[1, 14400], [10, 14400], [11, 12600], [25, 12600], [26, 10800], [50, 10800], [51, 9000], [100, 9000], [101, 7200], [5000, 7200]]) {
  assert.equal(foundingAllowanceSeconds(position), seconds, `founding #${position}`);
}
const founding = read("supabase/migrations/202608110001_founding_allowances.sql");
const adminEntitlements = read("supabase/migrations/202608110002_admin_entitlements.sql");
for (const tier of FOUNDING_TIERS) {
  assert.equal(founding.includes(`<= ${tier.upTo} then ${tier.allowanceSeconds}`), true, `SQL ladder covers #${tier.upTo}`);
}
// Minutes never round up: telling someone they have a minute they cannot use
// is how a session gets refused right after the dashboard promised it.
assert.equal(minutesRemaining(536), 8);
assert.equal(minutesRemaining(-5), 0);
assert.equal(minutesOf(7200), 120);
checks.push("founding allowance ladder matches the migration and never over-reports remaining minutes");
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
check("admin flags are database-owned and default off", adminEntitlements.includes("is_admin boolean not null default false") && adminEntitlements.includes("unlimited_minutes boolean not null default false"));
check("unlimited minutes are explicit in the entitlement contract", adminEntitlements.includes("is_admin boolean, unlimited_minutes boolean") && adminEntitlements.includes("v_allowance := 2147483647") && adminEntitlements.includes("v_max := 2147483647"));
check("unlimited minutes retain provider cost controls", adminEntitlements.includes("cost and emergency controls still apply") && guard.includes("reserve_provider_cost"));
check("production replay authorization fails closed server-side", replayAuthorization.includes('process.env.NODE_ENV !== "development"') && replayAuthorizationRoute.includes("mintDevelopmentReplayAuthorization"));
check("replay authorization is one-use and short-lived", replayAuthorization.includes("TTL_MS = 30_000") && replayAuthorization.lastIndexOf("grants().delete(token)") < replayAuthorization.lastIndexOf("timingSafeEqual"));
check("only the Deepgram credential route opts into development replay", deepgramRoute.includes("allowDevelopmentReplay: true") && (guard.match(/allowDevelopmentReplay/g) ?? []).length === 2);
check("long replay credentials do not change the live credential lifetime", deepgramRoute.includes("DEVELOPMENT_REPLAY_TTL_SECONDS = 180") && deepgramRoute.includes('guard.sessionId === "development-replay"') && deepgramRoute.includes(": TTL_SECONDS"));
check("normal microphone startup cannot request replay authorization", deepgramHook.indexOf('captureRef.current?.kind === "replay-pcm16"') < deepgramHook.indexOf('fetch("/api/dev/replay-authorization"'));
check("replay coordinator does not start a product usage lease", !board.slice(board.indexOf("const runReplayExperiment"), board.indexOf("const wasListeningRef")).includes("usage.start()"));
check("each replay run discards its provider credential", board.slice(board.indexOf("const runReplayExperiment"), board.indexOf("const wasListeningRef")).includes("deepgram.stop(false)"));
check("a stale socket close cannot cancel the next replay run", deepgramHook.includes("if (connectionRef.current !== connection) return"));
check("replay reconnect resumes one sender without bursting or restarting", deepgramHook.includes("replaySenderActiveRef.current") && deepgramHook.includes('reconnectRebasePending ? "reconnect" : undefined') && deepgramHook.includes("scheduler.resolve(audioStartMs") && deepgramHook.includes("activeConnection.send(pcm.buffer)"));

// The session refresh stamps "private, no-store" on everything it handles.
// Public media must stay outside it, or a 1 MB demo video is re-downloaded on
// every page view and each request pays for a Supabase refresh it never needed.
// Checked by running the real matcher, not by grepping it for extensions.
{
  // JSON.parse resolves the TS string literal's escaping, so the pattern is
  // the same regex Next compiles rather than an approximation of it.
  const pattern = JSON.parse(`"${middleware.match(/matcher: \[\s*"([^"]+)"/s)[1]}"`);
  const runs = (path) => new RegExp(`^${pattern}$`).test(path);
  for (const asset of ["/demos/demo-a.webm", "/demos/demo-a.png", "/og.png", "/inter.woff2"]) {
    check(`static asset bypasses the session middleware: ${asset}`, runs(asset) === false);
  }
  for (const page of ["/", "/pricing", "/create", "/dashboard/settings", "/api/entitlement"]) {
    check(`session middleware still runs for ${page}`, runs(page) === true);
  }
}
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
check("project writes remain authenticated-only", projectRoute.includes("if (!user)") && projectRoute.includes("status: 401"));
check("guest autosave remains local and skips protected project sync", board.includes("{ syncCloud: !guest }") && persist.indexOf("await saveLocalSession(session)") < persist.indexOf("if (!syncCloud) return"));
check("authenticated autosave keeps cloud sync as the default", persist.includes("{ syncCloud = true }") && persist.indexOf("if (!syncCloud) return") < persist.indexOf("saveCloudSession(session)"));
check("anonymous allowance routing is unchanged", board.includes("anonymous: guest"));
check("latency ingestion remains authenticated-only", latencyRoute.includes("if (!user)") && latencyRoute.includes("status: 401"));
check("guest latency stays local without calling protected ingestion", board.includes("recordLatencySummary(summary, stoppedUsageSessionId, traces, !guest)") && latencySink.indexOf("storeLocally(summary)") < latencySink.indexOf("if (!sendRemotely) return"));
check("authenticated latency upload remains the default", latencySink.includes("sendRemotely = true") && latencySink.indexOf("if (!sendRemotely) return") < latencySink.indexOf("queue.push"));

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
