import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { usageLeaseSeconds } from "@/lib/server/limits";
import { spendLimits } from "@/lib/server/limits";
import { reconcileOpenAudioReservations } from "@/lib/server/provider-guard";

async function userOr401() {
  return getAuthenticatedUser().catch(() => null);
}

function errorResponse(message: string) {
  if (message.includes("active_session_conflict")) return NextResponse.json({ error: { code: "active_session_conflict", message: "Another listening session is already active." } }, { status: 409 });
  if (message.includes("quota_exhausted")) return NextResponse.json({ error: { code: "quota_exhausted", message: "Your visual-speech minutes are finished for this period." } }, { status: 429 });
  if (message.includes("expired_lease")) return NextResponse.json({ error: { code: "expired_lease", message: "The listening lease expired." } }, { status: 429 });
  if (message.includes("emergency_stop") || message.includes("global_session_capacity")) return NextResponse.json({ error: { code: "cost_protection_active", message: "Listening is temporarily unavailable." } }, { status: 503 });
  return NextResponse.json({ error: { code: "session_unavailable", message: "The listening session could not be updated." } }, { status: 503 });
}

export async function POST(request: Request) {
  const user = await userOr401();
  if (!user) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in to continue." } }, { status: 401 });
  let body: { projectId?: string; mode?: string; clientSessionId?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: { code: "invalid_request", message: "Invalid session request." } }, { status: 400 }); }
  if (!body.clientSessionId || body.clientSessionId.length > 128 || !["standard", "story"].includes(body.mode ?? "")) return NextResponse.json({ error: { code: "invalid_request", message: "Invalid session request." } }, { status: 400 });
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("start_usage_session", { p_user_id: user.id, p_project_id: body.projectId ?? null, p_mode: body.mode, p_client_session_id: body.clientSessionId, p_lease_seconds: usageLeaseSeconds, p_global_session_limit: spendLimits.globalConcurrentSessions });
  if (error) return errorResponse(error.message);
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: Request) {
  const user = await userOr401();
  if (!user) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in to continue." } }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { sessionId?: string };
  if (!body.sessionId) return NextResponse.json({ error: { code: "invalid_request", message: "A session ID is required." } }, { status: 400 });
  const { data, error } = await createAdminClient().rpc("renew_usage_session", { p_user_id: user.id, p_session_id: body.sessionId, p_lease_seconds: usageLeaseSeconds });
  if (error) return errorResponse(error.message);
  return NextResponse.json(data);
}

export async function DELETE(request: Request) {
  const user = await userOr401();
  if (!user) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in to continue." } }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { sessionId?: string; reason?: string };
  let sessionId = body.sessionId;
  if (!sessionId) {
    const { data } = await createAdminClient().from("usage_sessions").select("id").eq("user_id", user.id).in("status", ["active", "paused"]).limit(1).maybeSingle();
    sessionId = data?.id;
  }
  if (!sessionId) return new NextResponse(null, { status: 204 });
  const { data } = await createAdminClient().rpc("end_usage_session", { p_user_id: user.id, p_session_id: sessionId, p_reason: body.reason ?? "user_stopped" });
  const ended = (Array.isArray(data) ? data[0] : data) as { consumed_seconds?: number } | null;
  await reconcileOpenAudioReservations(sessionId, Number(ended?.consumed_seconds ?? 0), body.reason === "provider_aborted" ? "aborted" : "succeeded");
  return new NextResponse(null, { status: 204 });
}
