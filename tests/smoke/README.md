# Browser smoke suite

Added in Strip-Down Phase 2 (`audit/TEST_COVERAGE_MAP.md` found zero
automated browser coverage repo-wide). Deliberately narrow — this protects
the specific behaviors Phase 2's `Board.tsx` surgery touches, not a general
E2E framework.

Run: `npm run test:smoke` (starts `next dev` on port 3100 automatically if
not already running).

## Why every test uses `window.inpublic.express({ delta })`

`lib/expression/entry.ts`'s `express({ delta })` path skips meaning
extraction entirely and feeds structured meaning straight into the world
fold — no Deepgram connection, no LLM call, fully deterministic. It's the
same debug hook `window.inpublic.express` exposes (`components/Board.tsx`,
dev-only), and it drives the *real* pipeline: world fold → intent →
composition/clean/presentation → compose → evaluate/repair → RenderPatch →
Excalidraw. Nothing here is a mock of the engine.

## What's covered

- `board-boot.spec.ts` — `/create` loads (via `/try?replay=1`, the dev-only
  bypass that mounts `<Board guest startFresh />` without a mic permission
  click), Excalidraw mounts, no fatal console/page error.
- `undo.spec.ts` — undo reverts a real Expression Engine turn.
  `recordOperation("expression_engine", ...)` is genuinely shared
  infrastructure (`Board.tsx:5887`), not legacy-only — confirmed by tracing
  before writing this test.
- `page-camera.spec.ts` — a same-topic continuation extends the board
  rather than erasing the first turn's elements ("the board is never
  wiped", matching the real corpus's own incremental-expression case).
- `persistence-roundtrip.spec.ts` — a settled turn survives the debounced
  autosave (`lib/persist.ts:makeAutosave`, 3s) as a well-formed
  `PersistedSession` in real IndexedDB.
- `canvas-observation.spec.ts` — the read-only Canvas boundary observes a
  real mounted scene, then detects a user-style pointer drag while preserving
  the moved element's canvas identity.

## What's NOT covered, and why

Full session **restoration** through the real product UI (`/create`) is not
tested here. `/create` requires a real Supabase-authenticated session
(enforced server-side in `middleware.ts`); `/try` always mounts with
`startFresh: true` (`Board.tsx:6986`), so there is no unauthenticated route
that both persists and restores through the actual UI. Faking a Supabase
session was judged out of scope for a smoke test: it would either need real
test credentials (risk of writing rows into whatever Supabase project
`.env.local` points at) or a new test-only bypass in the product code, which
this phase's own rules forbid adding. `persistence-roundtrip.spec.ts`
verifies the save half of that mechanism for real instead — see its header
comment.

Live Deepgram speech and any live LLM call are out of scope by design (per
the strip-down prompt) — `express({ delta })` is the correct substitute, not
a shortcut around them.
