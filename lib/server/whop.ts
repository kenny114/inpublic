import "server-only";

import Whop from "@whop/sdk";
import { createAdminClient } from "@/lib/supabase/admin";

export function createWhopClient() {
  const apiKey = process.env.WHOP_API_KEY;
  const secret = process.env.WHOP_WEBHOOK_SECRET;
  const baseURL = process.env.WHOP_BASE_URL;
  if (!apiKey) throw new Error("WHOP_API_KEY is not configured");
  return new Whop({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    ...(secret ? { webhookKey: Buffer.from(secret).toString("base64") } : {}),
  });
}

type MembershipLike = {
  id: string; status: string; updated_at: string; renewal_period_start: string | null;
  renewal_period_end: string | null; cancel_at_period_end: boolean; metadata?: Record<string, unknown> | null;
  user?: { id?: string } | null; plan?: { id?: string } | null;
};

function metadataUserId(membership: MembershipLike) {
  const value = membership.metadata?.supabase_user_id;
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

export function membershipIsValid(membership: MembershipLike) {
  const validStatus = ["active", "trialing", "canceling", "canceled"].includes(membership.status);
  return validStatus && Boolean(membership.renewal_period_end) && new Date(membership.renewal_period_end as string).getTime() > Date.now();
}

export async function applyVerifiedMembership(eventId: string, eventType: string, timestamp: string, membership: MembershipLike) {
  const configuredPlan = process.env.WHOP_CREATOR_PLAN_ID;
  const correctPlan = Boolean(configuredPlan && membership.plan?.id === configuredPlan);
  const valid = correctPlan && eventType !== "membership.deactivated" && membershipIsValid(membership);
  const userId = metadataUserId(membership);
  if (userId) {
    const { data } = await createAdminClient().from("profiles").select("id").eq("id", userId).maybeSingle();
    if (!data) throw new Error("membership metadata references an unknown user");
  }
  const { data, error } = await createAdminClient().rpc("apply_whop_membership_event", {
    p_event_id: eventId, p_event_type: eventType, p_event_timestamp: timestamp,
    p_membership_id: membership.id, p_user_id: userId, p_whop_user_id: membership.user?.id ?? null,
    p_plan_id: membership.plan?.id ?? null, p_status: membership.status, p_valid: valid,
    p_period_start: membership.renewal_period_start, p_period_end: membership.renewal_period_end,
    p_cancel_at_period_end: membership.cancel_at_period_end, p_provider_updated_at: membership.updated_at,
    p_sanitized: { membership_id: membership.id, plan_id: membership.plan?.id, status: membership.status, cancel_at_period_end: membership.cancel_at_period_end, renewal_period_start: membership.renewal_period_start, renewal_period_end: membership.renewal_period_end },
  });
  if (error) throw error;
  return data;
}

export async function recordVerifiedPaymentEvent(event: { id: string; type: string; timestamp: string; data: Record<string, unknown> }, forcedMembershipId?: string | null) {
  const data = event.data;
  const nestedPayment = (data.payment ?? data) as Record<string, unknown>;
  const membership = (nestedPayment.membership ?? data.membership) as { id?: string } | null | undefined;
  const membershipId = forcedMembershipId ?? membership?.id ?? null;
  let userId: string | null = null;
  if (membershipId) {
    const { data: subscription } = await createAdminClient().from("subscriptions").select("user_id").eq("provider_membership_id", membershipId).maybeSingle();
    userId = subscription?.user_id ?? null;
  }
  const gross = Number(nestedPayment.total ?? nestedPayment.amount ?? 0) || null;
  const fees = Number(nestedPayment.application_fee ?? nestedPayment.fees ?? 0) || null;
  const affiliate = Number(nestedPayment.affiliate_amount ?? 0) || null;
  const net = gross === null ? null : gross - (fees ?? 0) - (affiliate ?? 0);
  const { error } = await createAdminClient().rpc("record_whop_payment_event", {
    p_event_id: event.id, p_event_type: event.type, p_event_timestamp: event.timestamp,
    p_membership_id: membershipId, p_user_id: userId, p_gross: gross, p_fees: fees,
    p_affiliate: affiliate, p_net: net, p_currency: typeof nestedPayment.currency === "string" ? nestedPayment.currency : null,
    p_status: typeof nestedPayment.status === "string" ? nestedPayment.status : event.type,
    p_sanitized: { resource_id: typeof data.id === "string" ? data.id : null, membership_id: membershipId, status: nestedPayment.status ?? null, currency: nestedPayment.currency ?? null },
  });
  if (error) throw error;
}
