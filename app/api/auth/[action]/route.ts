import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { safeNext, siteOrigin } from "@/lib/server/site-url";

type Context = { params: Promise<{ action: string }> };
const MAX_BODY_BYTES = 4096;
const generic = "We couldn't complete that request. Check your details and try again.";

function positive(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
function hash(value: string) {
  const secret = process.env.RATE_LIMIT_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "development-only";
  return createHash("sha256").update(`${secret}:${value}`).digest("hex");
}
async function limit(scope: string, subject: string, maximum: number) {
  const { data, error } = await createAdminClient().rpc("consume_rate_limit", { p_scope: scope, p_subject_hash: hash(subject), p_window_seconds: 900, p_limit: maximum });
  if (error || !data?.[0]) return { allowed: false, retry: 60 };
  return { allowed: Boolean(data[0].allowed), retry: Number(data[0].retry_after_seconds) };
}

export async function POST(request: Request, { params }: Context) {
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return NextResponse.json({ error: generic }, { status: 413 });
  const { action } = await params;
  if (!["sign-in", "sign-up", "reset", "resend"].includes(action)) return NextResponse.json({ error: "not found" }, { status: 404 });
  let body: { email?: string; password?: string; displayName?: string; next?: string };
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: generic }, { status: 400 }); }
  const email = body.email?.trim().toLowerCase() ?? "";
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return NextResponse.json({ error: generic }, { status: 400 });
  const needsPassword = action === "sign-in" || action === "sign-up";
  if (needsPassword && (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 128)) return NextResponse.json({ error: generic }, { status: 400 });
  // Where the reader should land once the emailed link is confirmed. Without
  // this the middleware's `next` was dropped and everyone was dumped on the
  // dashboard, mid-onboarding, wherever they had actually been headed.
  const destination = safeNext(body.next);
  const confirmRedirect = `${siteOrigin(request)}/auth/callback?next=${encodeURIComponent(destination)}`;
  try {
    const [ipLimit, emailLimit] = await Promise.all([
      limit(`auth:${action}:ip`, ip, positive("RATE_LIMIT_AUTH_IP_PER_15_MINUTES", 20)),
      limit(`auth:${action}:email`, email, positive("RATE_LIMIT_AUTH_EMAIL_PER_15_MINUTES", 8)),
    ]);
    if (!ipLimit.allowed || !emailLimit.allowed) return NextResponse.json({ error: "Too many requests. Please wait and try again." }, { status: 429, headers: { "Retry-After": String(Math.max(ipLimit.retry, emailLimit.retry)) } });
    const supabase = await createServerSupabaseClient();
    if (action === "sign-in") {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password: body.password as string });
      if (!error) return NextResponse.json({ authenticated: Boolean(data.session) });
      /*
       * "Email not confirmed" deserves its own answer. Collapsing it into the
       * generic message told people with the *correct* password to check their
       * details, with no way forward — the sign-in dead end. GoTrue only
       * returns this code after the password has already been verified, so
       * saying it out loud reveals nothing to someone who is guessing.
       */
      const unverified = error.code === "email_not_confirmed" || /not confirmed/i.test(error.message);
      return NextResponse.json(
        { error: unverified ? "Confirm your email address to finish signing in." : generic, reason: unverified ? "email-unconfirmed" : "invalid-credentials" },
        { status: unverified ? 403 : 400 },
      );
    }
    if (action === "sign-up") {
      const { data, error } = await supabase.auth.signUp({ email, password: body.password as string, options: { emailRedirectTo: confirmRedirect, data: { display_name: body.displayName?.trim().slice(0, 80) || null } } });
      return error ? NextResponse.json({ error: generic }, { status: 400 }) : NextResponse.json({ authenticated: Boolean(data.session) });
    }
    if (action === "resend") {
      // Same shape of answer whether or not the address is waiting on a
      // confirmation, so this cannot be used to enumerate accounts.
      await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: confirmRedirect } });
      return NextResponse.json({ accepted: true });
    }
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${siteOrigin(request)}/auth/callback?next=%2Freset-password` });
    return NextResponse.json({ accepted: true });
  } catch {
    return NextResponse.json({ error: generic }, { status: 503 });
  }
}
