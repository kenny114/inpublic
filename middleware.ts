import type { NextRequest } from "next/server";
import { refreshSupabaseSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return refreshSupabaseSession(request);
}

/*
 * Static media is excluded deliberately.
 *
 * refreshSupabaseSession sets "Cache-Control: private, no-store" on everything
 * it touches, which is right for pages carrying a session and wrong for a
 * public asset. The list used to cover images only, so when the recorded demos
 * arrived the 1 MB hero video was re-downloaded on every single page view —
 * and each request also paid for a Supabase session refresh to serve a file
 * that has nothing to do with the session.
 *
 * Nothing is opened up by this: the only access control here is the redirect
 * for /create, /dashboard and /admin, and none of those is a media file.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|webm|mp4|mov|m4a|mp3|wav|woff2?)$).*)",
  ],
};
