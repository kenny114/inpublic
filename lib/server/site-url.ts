import "server-only";

/*
 * The origin we put in confirmation and password-reset emails.
 *
 * `new URL(request.url).origin` is whatever host the *server process* was
 * reached on. Behind a proxy that is an internal name, so the link in the
 * email pointed somewhere the reader's browser could not follow — one of the
 * ways "verify your email" dead-ended. Prefer the configured public URL, then
 * the forwarded host, and only fall back to the request URL locally.
 */
export function siteOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Misconfigured value: fall through to the request headers.
    }
  }
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host);
    return `${forwarded || (local ? "http" : "https")}://${host}`;
  }
  return new URL(request.url).origin;
}

/** Only same-origin paths may be used as a post-auth destination. */
export function safeNext(value: string | null | undefined, fallback = "/dashboard") {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}
