# InPublic production foundation

## Supabase

1. Create separate development and production projects.
2. Add the project URL, publishable key, and server-only service-role key to Vercel.
3. Apply `supabase/migrations` in timestamp order with the Supabase CLI.
4. Run `supabase test db supabase/tests/foundation.sql` after a clean local reset.
5. In Auth URL Configuration, set the production Site URL and allow `/auth/callback` and `/reset-password` redirect URLs for production and local development.
6. Enable email/password auth, choose confirmation policy, configure branded email templates, and configure strict Supabase Auth endpoint rate limits/CAPTCHA before launch.
7. Schedule `select public.expire_abandoned_usage_sessions_with_costs();` every five minutes with Supabase Cron.
8. Review `provider_rate_cards` at launch and whenever a provider changes pricing. Prices are data, not application constants.

## Whop sandbox

Set `WHOP_BASE_URL=https://sandbox-api.whop.com/api/v1` while using sandbox resources. Leave it unset after replacing them with production resources.

1. In sandbox/test mode, create or select the Creator product and a recurring monthly plan priced at USD 15. Put its `plan_…` ID in `WHOP_CREATOR_PLAN_ID` and the company/account ID in `WHOP_COMPANY_ID`.
2. Create a company API key with checkout-configuration read/write, member basic/email read, and webhook-receive permissions. Store it only as `WHOP_API_KEY` on the server.
3. In Developer → Webhooks, create the production URL `https://YOUR_DOMAIN/api/webhooks/whop`, select API version `v1`, and store its signing secret as `WHOP_WEBHOOK_SECRET`.
4. Subscribe to `membership.activated`, `membership.deactivated`, `membership.cancel_at_period_end_changed`, `payment.succeeded`, `payment.failed`, `refund.created`, `refund.updated`, `dispute.created`, and `dispute.updated`.
5. Send Whop test events and verify `payment_events` contains one sanitized row per `webhook-id`. Duplicate and out-of-order deliveries must not change a newer membership.
6. Keep sandbox mode until the complete manual test passes. The application never treats a successful return URL as entitlement.

The configured sandbox resources are the private `InPublic` developer app, the visible `InPublic Creator` product, and its USD 15 monthly plan.

## Vercel and provider controls

Set every variable in `.env.example` separately for Preview and Production. Server secrets must never be prefixed `NEXT_PUBLIC_`. Set `ADMIN_EMAIL_ALLOWLIST` and a random `RATE_LIMIT_HASH_SECRET`. Choose production spend limits deliberately; the checked-in values are conservative development defaults.

Set a hard project spending limit/alert in Deepgram as the final backstop. Deepgram documents that a temporary token only needs to be valid when the WebSocket opens; an open stream continues after token TTL. Vercel Functions do not provide a reliable long-lived bidirectional WebSocket relay, so InPublic closes the browser socket on lease rejection, idle, backgrounding, sign-out, quota, or emergency stop, but cannot claim hard server termination of a malicious already-open Deepgram socket. A true hard cap requires a durable WebSocket relay on infrastructure designed for long-lived connections, which holds the provider credential and closes upstream immediately when the Postgres lease ends.

Official references: https://developers.deepgram.com/guides/fundamentals/token-based-authentication and https://docs.whop.com/developer/guides/webhooks.
