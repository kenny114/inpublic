import "server-only";

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const ANON_COOKIE_NAME = "ip_anon";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180; // 180 days

function secret() {
  return process.env.RATE_LIMIT_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "development-only";
}

function sign(anonId: string) {
  return createHmac("sha256", secret()).update(anonId).digest("hex");
}

/** Cookie value is `<uuid>.<hmac>` so a client can't forge or extend another visitor's trial by guessing an id. */
export function mintAnonCookieValue(): string {
  const anonId = randomUUID();
  return `${anonId}.${sign(anonId)}`;
}

export function verifyAnonCookieValue(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const [anonId, signature] = raw.split(".");
  if (!anonId || !signature || !/^[0-9a-f-]{36}$/i.test(anonId)) return null;
  const expected = sign(anonId);
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return anonId;
}

export const anonCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: COOKIE_MAX_AGE_SECONDS,
};

export function hashIp(ip: string) {
  return createHash("sha256").update(`${secret()}:ip:${ip}`).digest("hex");
}

export function clientIpFrom(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

/** Reads a single cookie's raw value off a standard Request's Cookie header (no next/headers dependency, works in any Route Handler). */
export function readRequestCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** Verified anon_id off the request's signed cookie, or null if absent/invalid. */
export function anonIdFromRequest(request: Request): string | null {
  return verifyAnonCookieValue(readRequestCookie(request, ANON_COOKIE_NAME));
}
