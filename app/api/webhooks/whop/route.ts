import { NextResponse } from "next/server";
import { applyVerifiedMembership, createWhopClient, recordVerifiedPaymentEvent } from "@/lib/server/whop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const raw = await request.text();
  let event: ReturnType<ReturnType<typeof createWhopClient>["webhooks"]["unwrap"]>;
  try {
    event = createWhopClient().webhooks.unwrap(raw, { headers: Object.fromEntries(request.headers) });
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  if (event.api_version !== "v1" || (process.env.WHOP_COMPANY_ID && event.company_id !== process.env.WHOP_COMPANY_ID)) return NextResponse.json({ error: "invalid webhook scope" }, { status: 400 });
  try {
    if (["membership.activated", "membership.deactivated", "membership.cancel_at_period_end_changed"].includes(event.type)) {
      await applyVerifiedMembership(event.id, event.type, event.timestamp, event.data as never);
    } else if (["payment.succeeded", "payment.failed", "refund.created", "refund.updated", "dispute.created", "dispute.updated"].includes(event.type)) {
      await recordVerifiedPaymentEvent(event as never);
      const resource = event.data as unknown as Record<string, unknown>;
      const paymentRecord = (resource.payment ?? resource) as Record<string, unknown>;
      const attachedMembership = paymentRecord.membership as { id?: string } | undefined;
      if (["payment.succeeded", "payment.failed"].includes(event.type) && attachedMembership?.id) {
        const remote = await createWhopClient().memberships.retrieve(attachedMembership.id);
        await applyVerifiedMembership(`${event.id}:membership`, `membership.reconciled_after_${event.type}`, event.timestamp, remote as never);
      }
      // Refund delivery is not ordered. Either the created or updated event may
      // be the first event we observe, so pending/succeeded refunds and all
      // dispute events fail closed when a membership is attached. A refund
      // explicitly marked failed/canceled is retained only as a ledger event.
      const refundInvalidates = event.type.startsWith("refund.") && !["failed", "canceled"].includes(String(resource.status));
      if (refundInvalidates || ["dispute.created", "dispute.updated"].includes(event.type)) {
        if (attachedMembership?.id) {
          const remote = await createWhopClient().memberships.retrieve(attachedMembership.id);
          await applyVerifiedMembership(`${event.id}:membership`, event.type, event.timestamp, { ...remote, status: "expired", updated_at: event.timestamp } as never);
        }
      }
    } else {
      await recordVerifiedPaymentEvent(event as never);
    }
    return new NextResponse("OK", { status: 200 });
  } catch {
    return NextResponse.json({ error: "webhook processing failed" }, { status: 500 });
  }
}
