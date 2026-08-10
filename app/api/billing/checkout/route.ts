import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { createWhopClient } from "@/lib/server/whop";

export async function POST(request: Request) {
  const user = await getAuthenticatedUser().catch(() => null);
  if (!user) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in to continue." } }, { status: 401 });
  const planId = process.env.WHOP_CREATOR_PLAN_ID;
  const companyId = process.env.WHOP_COMPANY_ID;
  if (!planId || !companyId) return NextResponse.json({ error: { code: "billing_unavailable", message: "Checkout is not configured yet." } }, { status: 503 });
  try {
    const origin = new URL(request.url).origin;
    const checkout = await createWhopClient().checkoutConfigurations.create({
      account_id: companyId, plan_id: planId,
      metadata: { supabase_user_id: user.id },
      redirect_url: `${origin}/billing/complete`,
      "Idempotency-Key": `creator-checkout:${user.id}:${Math.floor(Date.now() / 300000)}`,
    });
    return NextResponse.json({ checkoutUrl: checkout.purchase_url, checkoutId: checkout.id });
  } catch {
    return NextResponse.json({ error: { code: "billing_unavailable", message: "Checkout could not be started." } }, { status: 503 });
  }
}
