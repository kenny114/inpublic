# Development replay authorization

The deterministic replay lab uses the production Deepgram SDK, WebSocket,
48 kHz PCM16 conversion, 80 ms pacing, transcript handlers, V2, and Visual
Re-entry. It differs only at the product-usage authorization seam.

In local development, `POST /api/dev/replay-authorization` issues a random,
30-second, one-use capability bound to the requesting browser fingerprint.
Only `/api/deepgram/token` opts into consuming it. A successful replay grant
does not create, renew, end, reserve, or reconcile a product `usage_sessions`
or `anonymous_trials` row. Deepgram is still called and therefore still incurs
provider usage.

The production credential lifetime remains 60 seconds. A credential issued
through the development replay capability lasts 180 seconds so the existing
87.96-second benchmark can keep one real WebSocket open through endpointing;
this changes authorization lifetime only, not audio pacing or transcript code.
The replay coordinator discards that credential after every run so an A/B
pair cannot begin its second file with a partially aged first-run token.
Late `Close` events from the prior socket are identity-checked and ignored so
they cannot cancel the next run in a repeated A/B sequence.
If Deepgram closes a socket during a long file, the single replay sender pauses,
uses the existing credential/socket reconnect path, and resumes at the next
unsent chunk. Its pacing clock restarts at the reconnect boundary so queued
audio is never burst; chunks remain ordered and 80 ms apart.

The authorization route requires `NODE_ENV=development`, a loopback request,
and a same-origin browser request. The consumer independently requires
`NODE_ENV=development`. Production therefore fails closed even if a caller
adds `?replay=1`, copies the header name, or calls the route directly. Normal
development microphone startup does not request a replay capability and keeps
using the ordinary usage-session and provider-cost guards.
