import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveEntitlement } from "./entitlement";
import { routeLimits, spendLimits } from "./limits";
import { audioReservationSeconds } from "@/lib/providerCost";
import { anonIdFromRequest } from "./anonId";

export type CostFeature = "deepgram" | "gemini" | "scribe" | "beat" | "artist" | "story" | "math" | "audio";
export interface GuardSpec {
  feature: CostFeature;
  provider: "anthropic" | "google" | "deepgram";
  model: string;
  requestBytes?: number;
  maxOutputTokens?: number;
  audioSeconds?: number;
}

/**
 * `reservationId: "anonymous"` is a sentinel, not a real cost_reservations row
 * id — anonymous /try traffic never enters the fine-grained per-token cost
 * ledger (which is hard-FK'd to auth.users and deliberately not touched by
 * the anonymous-trial schema, see supabase/migrations/202608130001). Spend
 * exposure is instead bounded by the trial's tight minute allowance plus
 * per-anon-id/per-IP rate limits. reconcileProviderCost() below no-ops when
 * it sees this sentinel, so none of the 8 call sites that guard a provider
 * route need to know or care whether the caller was anonymous.
 */
const ANONYMOUS_RESERVATION_SENTINEL = "anonymous";

export interface GuardContext {
  userId: string | null;
  sessionId: string;
  projectId: string | null;
  reservationId: string;
  reservedCostUsd: number;
  estimatedCostUsd: number;
  rates: { input: number; output: number; audio: number; cacheCreation: number; cacheRead: number };
  requestBytes: number;
  startedAt: number;
}

function jsonError(status: number, code: string, message: string, retryAfter?: number) {
  return NextResponse.json(
    { error: { code, message, ...(retryAfter ? { retryAfterSeconds: retryAfter } : {}) } },
    { status, headers: retryAfter ? { "Retry-After": String(retryAfter) } : undefined },
  );
}

function subjectHash(value: string) {
  const pepper = process.env.RATE_LIMIT_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "development-only";
  return createHash("sha256").update(`${pepper}:${value}`).digest("hex");
}

function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

async function recordBlock(userId: string | null, sessionId: string, feature: string, reason: string, metadata?: Record<string, unknown>) {
  await createAdminClient().from("security_events").insert({ user_id: userId, session_id: sessionId, event_type: reason === "rate_limited" ? "rate_limit" : "blocked_request", feature, reason_code: reason, metadata_json: metadata ?? {} }).then(() => undefined);
}

async function consumeLimit(scope: string, subject: string, limit: number, windowSeconds: number) {
  const { data, error } = await createAdminClient().rpc("consume_rate_limit", {
    p_scope: scope,
    p_subject_hash: subjectHash(subject),
    p_window_seconds: windowSeconds,
    p_limit: limit,
  });
  if (error || !data?.[0]) throw new Error(`rate_limit_unavailable: ${error?.message ?? "missing row"}`);
  return data[0] as { allowed: boolean; retry_after_seconds: number };
}

function mapReservationError(message: string) {
  if (message.includes("duplicate_provider_request")) return jsonError(409, "duplicate_request", "This request was already submitted.");
  if (message.includes("emergency_stop") || message.includes("global_budget_exhausted")) return jsonError(503, "cost_protection_active", "AI processing is temporarily unavailable. Saved work and exports remain available.");
  if (message.includes("user_cost_limit") || message.includes("artist_session_limit") || message.includes("session_call_limit")) return jsonError(429, "spend_limit", "This session has reached a safety limit. Try again later.", 60);
  if (message.includes("expired_lease")) return jsonError(429, "expired_lease", "The listening session lease expired. Restart listening to continue.", 1);
  return jsonError(503, "protection_unavailable", "AI processing is temporarily unavailable.");
}

/**
 * The anonymous counterpart of the authenticated path below: validates a
 * signed anon cookie, an active lease on that visitor's anonymous_trials
 * row, and per-anon-id/per-IP rate limits, then returns a GuardContext with
 * the reconcile-skip sentinel (see ANONYMOUS_RESERVATION_SENTINEL). Returns
 * null (not a Response) when there's simply no anon cookie to try, so the
 * caller can fall through to the normal "sign in to continue" 401 rather
 * than a confusing anon-specific error for a request that was never meant
 * to be anonymous.
 */
async function guardAnonymousRequest(request: Request, spec: GuardSpec): Promise<GuardContext | Response | null> {
  const anonId = anonIdFromRequest(request);
  if (!anonId) return null;
  const sessionId = request.headers.get("x-inpublic-session-id");
  if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) return jsonError(429, "usage_session_required", "Start a listening session first.", 1);

  const admin = createAdminClient();
  const { data: trial } = await admin.from("anonymous_trials")
    .select("id,anon_id,allowance_seconds,consumed_seconds,reserved_seconds,lease_status,lease_expires_at")
    .eq("id", sessionId).eq("anon_id", anonId).maybeSingle();
  if (!trial || trial.lease_status !== "active" || new Date(trial.lease_expires_at).getTime() <= Date.now()) {
    return jsonError(429, "expired_lease", "The trial session lease expired. Restart to continue.", 1);
  }
  const remaining = Math.max(0, Number(trial.allowance_seconds) - Number(trial.consumed_seconds) - Number(trial.reserved_seconds));
  if (remaining <= 0) { await recordBlock(null, sessionId, spec.feature, "quota_exhausted", { anonId }); return jsonError(429, "quota_exhausted", "Your free trial is finished. Create a free account to keep going."); }

  const now = new Date().toISOString();
  const { data: emergency } = await admin.from("system_budget_periods").select("id").eq("emergency_stop", true).lte("period_start", now).gt("period_end", now).limit(1);
  if (emergency?.length) { await recordBlock(null, sessionId, spec.feature, "emergency_stop", { anonId }); return jsonError(503, "cost_protection_active", "This experience is temporarily unavailable."); }

  const configured = routeLimits[spec.feature];
  try {
    const [anonLimit, ipLimit] = await Promise.all([
      consumeLimit(`${spec.feature}:anon`, anonId, configured.limit, configured.windowSeconds),
      consumeLimit(`${spec.feature}:ip`, clientIp(request), Math.max(configured.limit * 4, 8), configured.windowSeconds),
    ]);
    if (!anonLimit.allowed || !ipLimit.allowed) { await recordBlock(null, sessionId, spec.feature, "rate_limited", { anonId }); return jsonError(429, "rate_limited", "Too many requests. Please wait and try again.", Math.max(anonLimit.retry_after_seconds, ipLimit.retry_after_seconds)); }
  } catch {
    return jsonError(503, "rate_limit_unavailable", "This experience is temporarily unavailable.");
  }

  return {
    userId: null, sessionId, projectId: null, reservationId: ANONYMOUS_RESERVATION_SENTINEL,
    reservedCostUsd: 0, estimatedCostUsd: 0,
    rates: { input: 0, output: 0, audio: 0, cacheCreation: 0, cacheRead: 0 },
    requestBytes: spec.requestBytes ?? 0, startedAt: Date.now(),
  };
}

export async function guardProviderRequest(request: Request, spec: GuardSpec): Promise<GuardContext | Response> {
  // Which ledger this request belongs to is NOT implied by the auth cookie: a
  // signed-in visitor can open /try, and then holds a valid session while its
  // session id refers to anonymous_trials rather than usage_sessions. Routing
  // on the cookie sent those requests down the authenticated path, where the
  // trial id matched no usage_sessions row and surfaced as a bogus
  // "expired_lease" 429. The client says which ledger it is using; that is
  // only a routing hint, and guardAnonymousRequest below still verifies the
  // signed anon cookie and the trial's own lease before allowing anything.
  if (request.headers.get("x-inpublic-anon") === "1") {
    const anon = await guardAnonymousRequest(request, spec);
    // A null here means no valid anon cookie accompanied the claim, so there
    // is no trial to authorise against — never silently fall through to the
    // authenticated path, which would bill a signed-in user for a session
    // their client believes is anonymous.
    return anon ?? jsonError(401, "usage_session_required", "Start a trial session first.");
  }
  const user = await getAuthenticatedUser().catch(() => null);
  if (!user) {
    const anon = await guardAnonymousRequest(request, spec);
    if (anon) return anon;
    return jsonError(401, "unauthenticated", "Sign in to continue.");
  }
  const sessionId = request.headers.get("x-inpublic-session-id");
  if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) return jsonError(429, "usage_session_required", "Start a listening session first.", 1);

  const admin = createAdminClient();
  const { data: session } = await admin.from("usage_sessions").select("id,user_id,project_id,status,lease_expires_at,started_at,consumed_seconds,reserved_seconds").eq("id", sessionId).eq("user_id", user.id).maybeSingle();
  if (!session || session.status !== "active" || new Date(session.lease_expires_at).getTime() <= Date.now()) return jsonError(429, "expired_lease", "The listening session lease expired. Restart listening to continue.", 1);

  const entitlement = await resolveEntitlement(user.id).catch(() => null);
  if (!entitlement) return jsonError(503, "entitlement_unavailable", "Entitlement verification is temporarily unavailable.");
  if (entitlement.remainingSeconds <= 0) { await recordBlock(user.id, sessionId, spec.feature, "quota_exhausted"); return jsonError(429, "quota_exhausted", "Your visual-speech minutes are finished for this period."); }
  if (Number(session.consumed_seconds) >= entitlement.maxSessionSeconds) { await recordBlock(user.id, sessionId, spec.feature, "session_limit_reached"); return jsonError(429, "session_limit_reached", "This session reached its maximum length."); }

  const { count } = await admin.from("usage_sessions").select("id", { count: "exact", head: true }).eq("status", "active").gt("lease_expires_at", new Date().toISOString());
  if ((count ?? 0) > spendLimits.globalConcurrentSessions) { await recordBlock(user.id, sessionId, spec.feature, "global_session_capacity"); return jsonError(503, "global_session_capacity", "Listening capacity is temporarily full."); }

  const configured = routeLimits[spec.feature];
  try {
    const [userLimit, ipLimit] = await Promise.all([
      consumeLimit(`${spec.feature}:user`, user.id, configured.limit, configured.windowSeconds),
      consumeLimit(`${spec.feature}:ip`, clientIp(request), Math.max(configured.limit * 4, 8), configured.windowSeconds),
    ]);
    if (!userLimit.allowed || !ipLimit.allowed) { await recordBlock(user.id, sessionId, spec.feature, "rate_limited"); return jsonError(429, "rate_limited", "Too many requests. Please wait and try again.", Math.max(userLimit.retry_after_seconds, ipLimit.retry_after_seconds)); }
  } catch {
    return jsonError(503, "rate_limit_unavailable", "AI processing is temporarily unavailable.");
  }

  const now = new Date().toISOString();
  const { data: rate } = await admin.from("provider_rate_cards").select("id,unit,input_rate_usd,output_rate_usd,audio_rate_usd,cache_creation_rate_usd,cache_read_rate_usd").eq("provider", spec.provider).eq("model", spec.model).lte("effective_start", now).or(`effective_end.is.null,effective_end.gt.${now}`).order("effective_start", { ascending: false }).limit(1).maybeSingle();
  if (!rate) return jsonError(503, "rate_card_missing", "AI processing is temporarily unavailable.");
  const inputTokens = Math.ceil((spec.requestBytes ?? 0) / 3);
  const effectiveAudioSeconds = audioReservationSeconds(
    spec.audioSeconds ?? 0,
    entitlement.remainingSeconds,
    Number(session.reserved_seconds),
    entitlement.maxSessionSeconds,
    Number(session.consumed_seconds),
  );
  const raw = effectiveAudioSeconds
    ? effectiveAudioSeconds * Number(rate.audio_rate_usd)
    : inputTokens * Number(rate.input_rate_usd) + (spec.maxOutputTokens ?? 0) * Number(rate.output_rate_usd);
  const estimatedCostUsd = Math.max(0.000001, Math.ceil(raw * 1_000_000) / 1_000_000);
  const reservedCostUsd = Math.max(0.000001, Math.ceil(estimatedCostUsd * 1.25 * 1_000_000) / 1_000_000);
  if (effectiveAudioSeconds) {
    const { data: emergency } = await admin.from("system_budget_periods").select("id").eq("emergency_stop", true).lte("period_start", now).gt("period_end", now).limit(1);
    if (emergency?.length) { await recordBlock(user.id, sessionId, spec.feature, "emergency_stop"); return jsonError(503, "cost_protection_active", "AI processing is temporarily unavailable. Saved work and exports remain available."); }
    const { data: existing } = await admin.from("cost_reservations").select("id,reserved_cost_usd").eq("session_id", sessionId).eq("feature", spec.feature).eq("status", "reserved").limit(1).maybeSingle();
    if (existing) return { userId: user.id, sessionId, projectId: session.project_id, reservationId: existing.id, reservedCostUsd: Number(existing.reserved_cost_usd), estimatedCostUsd: Number(existing.reserved_cost_usd) / 1.25, rates: { input: Number(rate.input_rate_usd), output: Number(rate.output_rate_usd), audio: Number(rate.audio_rate_usd), cacheCreation: Number(rate.cache_creation_rate_usd), cacheRead: Number(rate.cache_read_rate_usd) }, requestBytes: spec.requestBytes ?? 0, startedAt: Date.now() };
  }
  const idempotencyKey = request.headers.get("idempotency-key")?.slice(0, 160) || `${user.id}:${sessionId}:${spec.feature}:${randomUUID()}`;
  const { data: reservation, error } = await admin.rpc("reserve_provider_cost", {
    p_user_id: user.id, p_project_id: session.project_id, p_session_id: sessionId,
    p_feature: spec.feature, p_provider: spec.provider, p_model: spec.model, p_unit: rate.unit,
    p_reserved_cost: reservedCostUsd, p_idempotency_key: idempotencyKey,
    p_user_daily_limit: spendLimits.userDailyUsd, p_user_period_limit: spendLimits.userPeriodUsd,
    p_global_hour_limit: spendLimits.globalHourlyUsd, p_global_day_limit: spendLimits.globalDailyUsd,
    p_global_month_limit: spendLimits.globalMonthlyUsd, p_artist_session_limit: spendLimits.artistSessionUsd,
    p_session_call_limit: spendLimits.providerCallsPerSession,
  });
  if (error || !reservation) {
    const reason = error?.message ?? "reservation_failed";
    console.warn("[provider-guard] reservation rejected", { feature: spec.feature, code: error?.code ?? null, reason });
    await recordBlock(user.id, sessionId, spec.feature, reason);
    return mapReservationError(reason);
  }
  const row = Array.isArray(reservation) ? reservation[0] : reservation;
  return { userId: user.id, sessionId, projectId: session.project_id, reservationId: row.id, reservedCostUsd, estimatedCostUsd, rates: { input: Number(rate.input_rate_usd), output: Number(rate.output_rate_usd), audio: Number(rate.audio_rate_usd), cacheCreation: Number(rate.cache_creation_rate_usd), cacheRead: Number(rate.cache_read_rate_usd) }, requestBytes: spec.requestBytes ?? 0, startedAt: Date.now() };
}

export interface ProviderUsage {
  providerRequestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  audioSeconds?: number;
  actualCostUsd?: number;
}

export async function reconcileProviderCost(context: GuardContext, status: "succeeded" | "failed" | "aborted", usage: ProviderUsage = {}, responseBytes = 0) {
  if (context.reservationId === ANONYMOUS_RESERVATION_SENTINEL) return;
  const actualKnown = usage.actualCostUsd !== undefined || Boolean(usage.inputTokens || usage.outputTokens || usage.audioSeconds);
  const calculated =
    (usage.inputTokens ?? 0) * context.rates.input +
    (usage.outputTokens ?? 0) * context.rates.output +
    (usage.cacheCreationInputTokens ?? 0) * context.rates.cacheCreation +
    (usage.cacheReadInputTokens ?? 0) * context.rates.cacheRead +
    (usage.audioSeconds ?? 0) * context.rates.audio;
  const actual = actualKnown ? usage.actualCostUsd ?? calculated : null;
  await createAdminClient().rpc("reconcile_provider_cost", {
    p_reservation_id: context.reservationId, p_status: status,
    p_estimated_cost: context.estimatedCostUsd, p_actual_cost: actual,
    p_provider_request_id: usage.providerRequestId ?? null,
    p_input_tokens: usage.inputTokens ?? 0, p_output_tokens: usage.outputTokens ?? 0,
    p_cache_creation_tokens: usage.cacheCreationInputTokens ?? 0, p_cache_read_tokens: usage.cacheReadInputTokens ?? 0,
    p_audio_seconds: usage.audioSeconds ?? 0, p_request_bytes: context.requestBytes,
    p_response_bytes: responseBytes, p_compute_ms: Date.now() - context.startedAt,
    p_metadata: { actual_cost_source: actualKnown ? "provider_usage_conservative_rate" : "estimated_exposure" },
  });
}

export async function reconcileOpenAudioReservations(sessionId: string, audioSeconds: number, status: "succeeded" | "aborted" = "succeeded") {
  const admin = createAdminClient();
  const { data: reservations } = await admin.from("cost_reservations").select("id,user_id,feature,provider,model,reserved_cost_usd").eq("session_id", sessionId).eq("status", "reserved").in("feature", ["deepgram", "gemini"]);
  for (const reservation of reservations ?? []) {
    const { data: rate } = await admin.from("provider_rate_cards").select("audio_rate_usd").eq("provider", reservation.provider).eq("model", reservation.model).lte("effective_start", new Date().toISOString()).order("effective_start", { ascending: false }).limit(1).maybeSingle();
    const actual = Math.max(0, audioSeconds) * Number(rate?.audio_rate_usd ?? 0);
    await admin.rpc("reconcile_provider_cost", {
      p_reservation_id: reservation.id, p_status: status, p_estimated_cost: actual, p_actual_cost: actual,
      p_provider_request_id: null, p_input_tokens: 0, p_output_tokens: 0, p_cache_creation_tokens: 0,
      p_cache_read_tokens: 0, p_audio_seconds: Math.max(0, audioSeconds), p_request_bytes: 0,
      p_response_bytes: 0, p_compute_ms: 0, p_metadata: { actual_cost_source: "server_authoritative_listening_seconds" },
    });
  }
}
