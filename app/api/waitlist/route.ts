import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2048;
const generic = "We couldn't add you to the waitlist. Check your email and try again.";

function hash(value: string) {
  const secret = process.env.RATE_LIMIT_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "development-only";
  return createHash("sha256").update(`${secret}:${value}`).digest("hex");
}

async function withinRateLimit(ip: string) {
  const { data, error } = await createAdminClient().rpc("consume_rate_limit", {
    p_scope: "waitlist",
    p_subject_hash: hash(ip),
    p_window_seconds: 900,
    p_limit: 5,
  });
  if (error || !data?.[0]) return false;
  return Boolean(data[0].allowed);
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: generic }, { status: 413 });
  }
  let body: { email?: string };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: generic }, { status: 400 });
  }
  const email = body.email?.trim().toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return NextResponse.json({ error: generic }, { status: 400 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  if (!(await withinRateLimit(ip))) {
    return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }

  // ON CONFLICT keeps a repeat submission a normal success instead of an
  // error — a visitor who taps "Join" twice, or who is already on the list,
  // should never see a failure state.
  const { error } = await createAdminClient()
    .from("waitlist_signups")
    .upsert({ email, source: "landing" }, { onConflict: "email", ignoreDuplicates: true });
  if (error) {
    console.error("[waitlist]", error);
    return NextResponse.json({ error: generic }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
