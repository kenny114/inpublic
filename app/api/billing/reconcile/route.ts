import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyVerifiedMembership, createWhopClient } from "@/lib/server/whop";

export async function POST() {
  const user = await getAuthenticatedUser().catch(() => null);
  if (!user) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in to continue." } }, { status: 401 });
  const { data } = await createAdminClient().from("subscriptions").select("provider_membership_id").eq("user_id", user.id).eq("provider", "whop").maybeSingle();
  if (!data?.provider_membership_id) return NextResponse.json({ reconciled: true, plan: "free" });
  try {
    const membership = await createWhopClient().memberships.retrieve(data.provider_membership_id);
    await applyVerifiedMembership(`reconcile:${membership.id}:${membership.updated_at}`, "membership.reconciled", new Date().toISOString(), membership as never);
    return NextResponse.json({ reconciled: true });
  } catch {
    return NextResponse.json({ error: { code: "membership_unverified", message: "Membership could not be verified." } }, { status: 503 });
  }
}
