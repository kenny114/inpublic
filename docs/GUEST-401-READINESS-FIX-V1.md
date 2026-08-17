# InPublic Guest 401 Readiness Fix V1

## Scope

This is an authentication/background-request lifecycle correction only. It does
not change presentation, speech, visuals, camera, page behavior, vocabulary,
mobile behavior, onboarding, or the anonymous five-minute allowance.

## Root cause: project autosave

The production Board already knows that `/try` is a guest route through its
`guest` prop. Every canvas `commit()` schedules a three-second trailing-edge
autosave, and session start explicitly flushes once before opening the
microphone. `makeAutosave()` correctly wrote the `current` and
`session:<session-id>` IndexedDB records first, but then always called
`saveCloudSession()`. A new session has no `cloudUpdatedAt`, so every flush used
`POST /api/projects`.

`/api/projects` is intentionally authenticated-only. The client treated its
401 as an offline cloud-save result, but the request itself was still invalid.
The retry loop did not cause the volume: it retries only transport failures,
429, and 5xx. A 401 exits immediately. The 19 requests were 19 separate
autosave flushes caused by the initial start flush and later board commits.

## Frozen validation request audit

Source: Vercel request logs for deployment
`dpl_6WpJycHaZHx4ocHJJaV5yNpZJQwz`, session-local `startedAt`
`2026-08-17T15:49:09.181Z`. Vercel retains the HTTP timestamp but not the
client-side commit label. Interior triggers are therefore classified from the
three-second autosave policy and their cadence; every row is conclusively a new
autosave, not a retry.

| # | UTC timestamp | Relative to session start | Trigger | Method | Auth state | Status | Retry / new autosave | User-visible effect |
|---:|---|---:|---|---|---|---:|---|---|
| 1 | 15:49:06.162 | -3.020 s | Explicit pre-listening `flushNow()` | POST | Guest | 401 | New autosave | None; local save succeeded |
| 2 | 15:49:13.855 | 4.674 s | Trailing-edge flush after board commit | POST | Guest | 401 | New autosave | None |
| 3 | 15:49:17.597 | 8.416 s | Trailing-edge flush after board commit | POST | Guest | 401 | New autosave | None |
| 4 | 15:49:21.111 | 11.930 s | Trailing-edge flush after board commit | POST | Guest | 401 | New autosave | None |
| 5 | 15:49:24.167 | 14.986 s | Trailing-edge flush after board commit | POST | Guest | 401 | New autosave | None |
| 6 | 15:49:29.119 | 19.938 s | Trailing-edge flush after board commit | POST | Guest | 401 | New autosave | None |
| 7 | 15:49:32.947 | 23.766 s | Trailing-edge flush after board commit | POST | Guest | 401 | New autosave | None |
| 8 | 15:49:36.632 | 27.451 s | Trailing-edge flush after board commit | POST | Guest | 401 | New autosave | None |
| 9 | 15:49:39.804 | 30.623 s | Trailing-edge flush after board commit | POST | Guest | 401 | New autosave | None |
| 10 | 15:49:44.038 | 34.857 s | Trailing-edge flush after board commit | POST | Guest | 401 | New autosave | None |
| 11 | 15:49:47.211 | 38.030 s | Trailing-edge flush after board commit | POST | Guest | 401 | New autosave | None |
| 12 | 15:49:50.951 | 41.770 s | Trailing-edge flush after board commit | POST | Guest | 401 | New autosave | None |
| 13 | 15:49:54.628 | 45.447 s | Trailing-edge flush after board commit | POST | Guest | 401 | New autosave | None |
| 14 | 15:49:57.836 | 48.655 s | Trailing-edge flush after board commit | POST | Guest | 401 | New autosave | None |
| 15 | 15:50:02.041 | 52.860 s | Trailing-edge flush after board commit | POST | Guest | 401 | New autosave | None |
| 16 | 15:50:05.205 | 56.024 s | Trailing-edge flush after board commit | POST | Guest | 401 | New autosave | None |
| 17 | 15:50:09.046 | 59.865 s | Trailing-edge flush after board commit | POST | Guest | 401 | New autosave | None |
| 18 | 15:50:12.753 | 63.572 s | Trailing-edge flush after board commit | POST | Guest | 401 | New autosave | None |
| 19 | 15:50:15.880 | 66.699 s | Final trailing-edge flush around listening stop | POST | Guest | 401 | New autosave | None |

## Root cause: latency telemetry

Listening stop creates one latency summary after the speech socket and usage
lease stop. `recordLatencySummary()` stores that summary in localStorage and
queues one remote POST. Anonymous usage returns a valid anonymous allowance
lease ID, so the generic “has a session ID” transport gate admitted it. The
protected endpoint then correctly returned 401 because it requires an
authenticated user and optionally associates only an owned authenticated
`usage_sessions` row.

The request is observational and does not affect speech, canvas, allowance, or
session completion. The detailed consented trial evidence already persists in
IndexedDB; the local latency ring also remains available.

## Intended contract and minimum correction

- Authenticated Board: IndexedDB first, then `/api/projects`; local latency
  summary plus authenticated `/api/telemetry/latency` upload.
- Guest `/try` Board: IndexedDB only; local latency summary only; anonymous
  allowance endpoints remain unchanged.
- Post-signup claim: calls `saveSession()` with its authenticated default, so
  the local guest session can still become a cloud project.

Both protected endpoints remain unchanged and authenticated-only. The existing
`guest` Board input controls only whether the already-local-first persistence
and telemetry functions may perform their remote step. No parallel auth
detector or swallowed invalid request was introduced.
