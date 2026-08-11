import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/server/site-url";

/*
 * Everything an emailed auth link can arrive as.
 *
 * This route used to understand `?code=` and nothing else, which broke the
 * two most common ways people actually confirm an address:
 *
 *   1. Supabase's default email template sends the reader through
 *      /auth/v1/verify, which hands the session back in the URL *fragment*
 *      (#access_token=...). A server route cannot see a fragment, so the old
 *      code saw no `code`, assumed failure, and bounced to /login?error=auth.
 *   2. `?code=` is PKCE. The verifier lives in a cookie belonging to the
 *      browser that submitted the form — so opening the email on a phone,
 *      or in any other browser, could never complete the exchange.
 *
 * So: handle `token_hash` (verifyOtp, works from any device), handle `code`,
 * pass a fragment-only link to the client helper at /auth/finish, and forward
 * Supabase's own error text instead of flattening it into "try again".
 */

const OTP_TYPES: EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

function otpType(value: string | null): EmailOtpType | null {
  return OTP_TYPES.includes(value as EmailOtpType) ? (value as EmailOtpType) : null;
}

/** Recovery links must land on the password form, whatever `next` says. */
function destination(type: EmailOtpType | null, next: string | null) {
  return type === "recovery" ? "/reset-password" : safeNext(next);
}

function failure(url: URL, reason: string, next: string | null) {
  const login = new URL("/login", url);
  login.searchParams.set("error", reason);
  if (next && next.startsWith("/") && !next.startsWith("//")) login.searchParams.set("next", next);
  return NextResponse.redirect(login);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = url.searchParams.get("next");
  const type = otpType(url.searchParams.get("type"));

  // Supabase reports expired or already-consumed links here. Say so plainly;
  // the reader needs to know a *new* link is required, not to retype a password.
  const reported = url.searchParams.get("error_code") ?? url.searchParams.get("error");
  if (reported) {
    const expired = /expired|otp_expired|invalid/i.test(reported);
    return failure(url, expired ? "link-expired" : "auth", next);
  }

  const tokenHash = url.searchParams.get("token_hash") ?? url.searchParams.get("token");
  if (tokenHash && type) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(destination(type, next), url));
    return failure(url, /expired/i.test(error.message) ? "link-expired" : "auth", next);
  }

  const code = url.searchParams.get("code");
  if (code) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(destination(type, next), url));
    // Almost always the missing PKCE verifier: the link was opened somewhere
    // other than the browser that started sign-up.
    return failure(url, "other-device", next);
  }

  /*
   * No query parameters we can act on. The tokens are probably in the
   * fragment, which only the browser can read — and browsers re-attach a
   * fragment across a redirect, so handing off to a client page keeps them.
   */
  const finish = new URL("/auth/finish", url);
  finish.searchParams.set("next", destination(type, next));
  return NextResponse.redirect(finish);
}
