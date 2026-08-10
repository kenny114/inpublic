"use client";

import type { User } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

export type AuthUser = Pick<User, "id" | "email">;
export type AuthState = { ready: boolean; user: AuthUser | null };
export const SIGNED_OUT: AuthState = { ready: false, user: null };

export async function signUp(email: string, password: string, displayName?: string) {
  const response = await fetch("/api/auth/sign-up", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, displayName }) });
  const payload = await response.json().catch(() => ({})) as { authenticated?: boolean; error?: string };
  return { error: response.ok ? null : new Error(payload.error ?? "Authentication failed"), data: { session: payload.authenticated ? {} : null } };
}

export async function signIn(email: string, password: string) {
  const response = await fetch("/api/auth/sign-in", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const payload = await response.json().catch(() => ({})) as { authenticated?: boolean; error?: string };
  return { error: response.ok ? null : new Error(payload.error ?? "Authentication failed"), data: { session: payload.authenticated ? {} : null } };
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
