"use client";

import type { User } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

export type AuthUser = Pick<User, "id" | "email">;
export type AuthState = { ready: boolean; user: AuthUser | null };
export const SIGNED_OUT: AuthState = { ready: false, user: null };

/** Why an attempt failed, so the form can say something useful about it. */
export type AuthFailure = "email-unconfirmed" | "invalid-credentials" | "rate-limited" | "unknown";

type AuthPayload = { authenticated?: boolean; error?: string; reason?: AuthFailure };

async function post(path: string, body: Record<string, unknown>) {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({})) as AuthPayload;
  if (response.ok) return { error: null, reason: null, data: { session: payload.authenticated ? {} : null } };
  const reason: AuthFailure = payload.reason ?? (response.status === 429 ? "rate-limited" : "unknown");
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
  const response = await fetch("/api/auth/resend", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, next }) });
  return { error: response.ok ? null : new Error("Could not send that email. Please try again in a minute.") };
}

export async function signOut() {
  // End the server usage lease before removing the authenticated cookie.
  await fetch("/api/usage/session", { method: "DELETE", keepalive: true }).catch(() => undefined);
  return createBrowserSupabaseClient().auth.signOut();
}

export async function requestPasswordReset(email: string) {
  const response = await fetch("/api/auth/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
  return { error: response.ok ? null : new Error("Password reset failed") };
}

export async function updatePassword(password: string) {
  return createBrowserSupabaseClient().auth.updateUser({ password });
}
