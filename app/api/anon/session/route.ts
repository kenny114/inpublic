import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { usageLeaseSeconds, anonymousIpDailyLimit, anonymousTrialSeconds } from "@/lib/server/limits";
import { ANON_COOKIE_NAME, anonCookieOptions, clientIpFrom, hashIp, mintAnonCookieValue, readRequestCookie, verifyAnonCookieValue } from "@/lib/server/anonId";

function errorResponse(message: string) {
  if (message.includes("active_session_conflict")) return NextResponse.json({ error: { code: "active_session_conflict", message: "A trial session is already active." } }, { status: 409 });
  if (message.includes("quota_exhausted")) return NextResponse.json({ error: { code: "quota_exhausted", message: "Your free trial is finished. Create a free account to keep going." } }, { status: 429 });
  if (message.includes("ip_trial_limit")) return NextResponse.json({ error: { code: "ip_trial_limit", message: "Too many trials from this network. Create a free account to continue." } }, { status: 429 });
  if (message.includes("expired_lease")) return NextResponse.json({ error: { code: "expired_lease", message: "The trial session lease expired." } }, { status: 429 });
  return NextResponse.json({ error: { code: "session_unavailable", message: "The trial session could not be updated." } }, { status: 503 });
}

function readRawAnonCookie(request: Request): string | null {
  return readRequestCookie(request, ANON_COOKIE_NAME);
}

function withAnonCookie(response: NextResponse, cookieValue: string) {
  response.cookies.set(ANON_COOKIE_NAME, cookieValue, anonCookieOptions);
  return response;
}

export async function POST(request: Request) {
  const rawCookie = readRawAnonCookie(request);
  const existingAnonId = verifyAnonCookieValue(rawCookie);
  // Reuse the existing signed cookie value verbatim if valid; otherwise mint
  // a fresh one. Never re-derive a cookie value from a bare anon_id — the
  // signature has to travel with it.
  const cookieValue = existingAnonId ? rawCookie! : mintAnonCookieValue();
  const anonId = existingAnonId ?? cookieValue.split(".")[0];

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("start_anonymous_trial", {
    p_anon_id: anonId,
    p_ip_hash: hashIp(clientIpFrom(request)),
    p_allowance_seconds: anonymousTrialSeconds,
    p_lease_seconds: usageLeaseSeconds,
    p_ip_daily_limit: anonymousIpDailyLimit,
  });
  if (error) return withAnonCookie(errorResponse(error.message), cookieValue);
  return withAnonCookie(NextResponse.json(data, { status: 201 }), cookieValue);
}

export async function PATCH(request: Request) {
  const anonId = verifyAnonCookieValue(readRawAnonCookie(request));
  if (!anonId) return NextResponse.json({ error: { code: "no_trial", message: "No trial in progress." } }, { status: 401 });
  const { data, error } = await createAdminClient().rpc("renew_anonymous_trial", { p_anon_id: anonId, p_lease_seconds: usageLeaseSeconds });
  if (error) return errorResponse(error.message);
  return NextResponse.json(data);
}

export async function DELETE(request: Request) {
  const anonId = verifyAnonCookieValue(readRawAnonCookie(request));
  if (!anonId) return new NextResponse(null, { status: 204 });
  const body = await request.json().catch(() => ({})) as { reason?: string };
  await createAdminClient().rpc("end_anonymous_trial", { p_anon_id: anonId, p_reason: body.reason ?? "user_stopped" });
  return new NextResponse(null, { status: 204 });
}
