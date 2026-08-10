import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { resolveEntitlement } from "@/lib/server/entitlement";

export const dynamic = "force-dynamic";
export async function GET() {
  const user = await getAuthenticatedUser().catch(() => null);
  if (!user) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in to continue." } }, { status: 401 });
  try {
    return NextResponse.json(await resolveEntitlement(user.id), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: { code: "entitlement_unavailable", message: "Entitlement verification is temporarily unavailable." } }, { status: 503 });
  }
}
