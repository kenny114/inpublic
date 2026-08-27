# Browser smoke suite

Added in Strip-Down Phase 2 (`audit/TEST_COVERAGE_MAP.md` found zero
automated browser coverage repo-wide). Deliberately narrow — this protects
the specific behaviors Phase 2's `Board.tsx` surgery touches, not a general
E2E framework.

Run: `npm run test:smoke` (starts `next dev` on port 3100 automatically if
not already running).

## Why tests use deterministic development seams

Most tests use `lib/expression/entry.ts`'s `express({ delta })` path, which skips meaning
extraction entirely and feeds structured meaning straight into the world
fold — no Deepgram connection, no LLM call, fully deterministic. It's the
same debug hook `window.inpublic.express` exposes (`components/Board.tsx`,
dev-only), and it drives the *real* pipeline: world fold → intent →
composition/clean/presentation → compose → evaluate/repair → RenderPatch →
Excalidraw. Nothing here is a mock of the engine. Agent and live-interaction
tests inject scripted decisions through their development seams; they exercise
the real bounded loop and dispatcher without a paid provider.

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
- `worldstate-restore.spec.ts` — a real autosave/reload restores both the
  Excalidraw scene and the identical versioned Expression `WorldState` from
  IndexedDB. `?restore=1` affects only the development replay route's
  `startFresh` flag and never enables cloud writes.
- `visual-action.spec.ts` — an exact semantic entity removal issued through
  the development `VisualAction` harness first leaves WorldState, then the
  existing Expression/Canvas reconciliation removes its derived live marks.
- `visual-agent.spec.ts` — the bounded agent consumes the live world/canvas,
  executes one scripted geometry-free action, re-observes the resulting real
  canvas, and stops without a paid model call.
- `agent-presence.spec.ts` — mounted lifecycle and semantic attention remain
  ephemeral, non-interfering, and cleaned up.
- `live-interaction.spec.ts` — one scenario exercises both settled branches:
  direct Expression for new meaning, then visible Agent/VisualAction execution
  for an existing-world correction, with unchanged viewport and idle cleanup.

## What's NOT covered, and why

Authenticated `/create` cloud restoration is not exercised because it needs
a real Supabase session and could write to the configured project. Phase 6
instead uses the existing development replay authorization plus a narrow
`restore=1` flag to drive Board's real `loadSession`/`restoreSession` path
against real IndexedDB with guest cloud sync disabled.

Live Deepgram speech and any live LLM call remain out of scope by design.
Structured meaning and scripted decisions are the deterministic substitutes,
not shortcuts around the production orchestration paths.
