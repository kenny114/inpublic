"use client";

import type { User } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

export type AuthUser = Pick<User, "id" | "email">;
export type AuthState = { ready: boolean; user: AuthUser | null };
export const SIGNED_OUT: AuthState = { ready: false, user: null };

/** Why an attempt failed, so the form can say something useful about it. */
export type AuthFailure = "email-unconfirmed" | "invalid-credentials" | "rate-limited" | "network" | "unknown";

type AuthPayload = { authenticated?: boolean; error?: string; reason?: AuthFailure };

const NETWORK_ERROR_MESSAGE = "Couldn't reach the server. Check your connection and try again.";

/**
 * Fetch with the "request never reached the server" case surfaced as a
 * return value instead of a throw — a dropped connection, offline, or (in
 * local dev) Next.js still lazily compiling this route on its first hit.
 * Every caller below builds on this so none of them can leak an unhandled
 * rejection the way a bare `fetch(...).then(...)` without a try/catch would.
 */
async function postJson(path: string, body: Record<string, unknown>): Promise<
  { ok: true; response: Response } | { ok: false; networkError: Error }
> {
  try {
    const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { ok: true, response };
  } catch (err) {
    return { ok: false, networkError: err instanceof Error ? err : new Error(NETWORK_ERROR_MESSAGE) };
  }
}

async function post(path: string, body: Record<string, unknown>) {
  const result = await postJson(path, body);
  if (!result.ok) {
    // Distinct from a rejected sign-in: nothing here says anything about
    // whether the entered credentials are right, so the caller must not
    // blame "check your details" for a network failure.
    return { error: result.networkError, reason: "network" as AuthFailure, data: { session: null } };
  }
  const payload = await result.response.json().catch(() => ({})) as AuthPayload;
  if (result.response.ok) return { error: null, reason: null, data: { session: payload.authenticated ? {} : null } };
  const reason: AuthFailure = payload.reason ?? (result.response.status === 429 ? "rate-limited" : "unknown");
  return { error: new Error(payload.error ?? "Authentication failed"), reason, data: { session: null } };
}

export async function signUp(email: string, password: string, displayName?: string, next?: string) {
  return post("/api/auth/sign-up", { email, password, displayName, next });
}

export async function signIn(email: string, password: string) {
  return post("/api/auth/sign-in", { email, password });
}

/** Send a fresh confirmation link — the way out of an unverified account. */
export async function resendConfirmation(email: string, next?: string) {
  const result = await postJson("/api/auth/resend", { email, next });
  if (!result.ok) return { error: new Error(NETWORK_ERROR_MESSAGE), reason: "network" as AuthFailure };
  return {
    error: result.response.ok ? null : new Error("Could not send that email. Please try again in a minute."),
    reason: result.response.ok ? null : ("unknown" as AuthFailure),
  };
}

export async function signOut() {
  // End the server usage lease before removing the authenticated cookie.
  await fetch("/api/usage/session", { method: "DELETE", keepalive: true }).catch(() => undefined);
  return createBrowserSupabaseClient().auth.signOut();
}

export async function requestPasswordReset(email: string) {
  const result = await postJson("/api/auth/reset", { email });
  if (!result.ok) return { error: new Error(NETWORK_ERROR_MESSAGE), reason: "network" as AuthFailure };
  return {
    error: result.response.ok ? null : new Error("Password reset failed"),
    reason: result.response.ok ? null : ("unknown" as AuthFailure),
  };
}

export async function updatePassword(password: string) {
  return createBrowserSupabaseClient().auth.updateUser({ password });
}
