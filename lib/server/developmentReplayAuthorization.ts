import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mayIssueDevelopmentReplayAuthorization } from "@/lib/replayAuthorizationPolicy";

const HEADER = "x-inpublic-replay-authorization";
const TTL_MS = 30_000;

interface Grant {
  expiresAt: number;
  fingerprint: string;
}

declare global {
  // One registry is shared across Next's development route modules. It is
  // process-local by design: replay authorization is never distributed or
  // persisted, and a dev-server restart invalidates every outstanding grant.
  // eslint-disable-next-line no-var
  var __inpublicDevelopmentReplayGrants: Map<string, Grant> | undefined;
}

function grants(): Map<string, Grant> {
  return globalThis.__inpublicDevelopmentReplayGrants ??=
    new Map<string, Grant>();
}

function clientFingerprint(request: Request): string {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "loopback";
  const agent = request.headers.get("user-agent") || "unknown";
  return createHash("sha256").update(`${ip}\n${agent}`).digest("hex");
}

function prune(now: number) {
  for (const [token, grant] of grants()) {
    if (grant.expiresAt <= now) grants().delete(token);
  }
}

/** Mint a short-lived capability after the route has proved it is local dev. */
export function mintDevelopmentReplayAuthorization(request: Request): string | null {
  if (!mayIssueDevelopmentReplayAuthorization(
    process.env.NODE_ENV,
    request.url,
    request.headers.get("origin"),
  )) return null;
  const now = Date.now();
  prune(now);
  const token = randomBytes(32).toString("base64url");
  grants().set(token, { expiresAt: now + TTL_MS, fingerprint: clientFingerprint(request) });
  return token;
}

/**
 * Consume (not merely inspect) a replay capability. It is accepted only by a
 * route that explicitly opts in, once, from the same browser fingerprint.
 */
export function consumeDevelopmentReplayAuthorization(request: Request): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  const token = request.headers.get(HEADER);
  if (!token || token.length > 128) return false;
  const now = Date.now();
  prune(now);
  const grant = grants().get(token);
  grants().delete(token);
  if (!grant || grant.expiresAt <= now) return false;
  const expected = Buffer.from(grant.fingerprint);
  const actual = Buffer.from(clientFingerprint(request));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const DEVELOPMENT_REPLAY_AUTHORIZATION_HEADER = HEADER;
