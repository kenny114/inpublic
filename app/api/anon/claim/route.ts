import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { anonIdFromRequest } from "@/lib/server/anonId";

/**
 * Bookkeeping only (see supabase/migrations/202608130001_anonymous_trials.sql)
 * — marks the trial row as claimed for analytics/audit. The actual board data
 * is re-keyed by the client re-calling saveSession() now that it's
 * authenticated (lib/persist.ts's POST to /api/projects derives user_id from
 * the session server-side, so re-saving is the entire "transfer"). Best-effort
 * and idempotent from the caller's perspective: no anon cookie, no matching
 * trial, or an already-claimed trial are all treated as a no-op success
 * rather than an error the signup flow needs to handle.
 */
export async function POST(request: Request) {
  const user = await getAuthenticatedUser().catch(() => null);
  if (!user) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in to continue." } }, { status: 401 });
  const anonId = anonIdFromRequest(request);
  if (!anonId) return NextResponse.json({ claimed: false });
  const { data, error } = await createAdminClient().rpc("claim_anonymous_trial", { p_anon_id: anonId, p_user_id: user.id });
  if (error) return NextResponse.json({ claimed: false });
  return NextResponse.json({ claimed: Boolean(data) });
}
