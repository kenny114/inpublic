# Current Architecture — InPublic

Static map of the repository as it exists today. Facts only; no redesign. Evidence
comes from direct file inspection plus four parallel research passes (UI/voice
runtime, Expression Engine internals, legacy code archaeology, persistence/tests/
Excalidraw boundary) whose citations are folded into the other audit files.

## Framework / runtime

- Next.js 15 (App Router), React 19, TypeScript 5.8, deployed to Vercel
  (`.vercel/`). `package.json`.
- Canvas: `@excalidraw/excalidraw ^0.18.0` + `@excalidraw/mermaid-to-excalidraw
  ^1.1.2` (the latter used only inside `lib/scene.ts` as a mermaid→layout engine
  for the Drawing Agent's diagram output).
- LLM providers: Anthropic SDK (`@anthropic-ai/sdk`) for Claude models, raw
  `fetch` against Google's `generativelanguage.googleapis.com` for Gemini text
  models — both wrapped by the single file `lib/llm.ts`. Realtime voice is
  separate: Deepgram (`@deepgram/sdk`) and Gemini Live (`@google/genai`,
  WebSocket) via dedicated token routes.
- Persistence: Supabase (Postgres + Auth), `@supabase/ssr` /
  `@supabase/supabase-js`, plus browser IndexedDB for local-first session state.
- Billing/entitlement: Whop (`@whop/sdk`).

## High-level tree (architecturally meaningful paths only)

```
app/
  page.tsx                    marketing landing page (NOT the canvas — see RUNTIME_FLOWS)
  create/page.tsx             real canvas entry point (dynamic import, ssr:false) -> <Board>
  try/page.tsx                guest/replay-lab canvas entry -> <Board guest>
  dev/express/page.tsx        dev-only text-first harness for the Expression Engine (noindex)
  api/
    express/route.ts          Expression Engine's one model call (meaning extraction)
    sketch/route.ts           Drawing Agent (concept -> Sketch), cached
    beat/route.ts              \
    artist/route.ts             > legacy Tier-3 pipeline, orphaned under current flags
    scribe/route.ts            /
    math/route.ts              math-mode Artist step, reachable only from dead code + parked AudioReplay
    story/route.ts             Story Mode, reachable only for resumed legacy sessions
    projects/route.ts, projects/[id]/route.ts   Supabase project CRUD
    deepgram/token/route.ts, gemini/token/route.ts   realtime voice token issuance
    admin/emergency-stop, billing/*, webhooks/whop, entitlement, anon/*   billing/entitlement plumbing
components/
  Board.tsx                   ~7500 lines; the actual orchestrator of everything canvas+voice
  ControlBar.tsx               UI chrome rendered inside Board
  ProductUI.tsx                shared UI atoms (Button/Modal/Toast/...), consumed BY Board, not a parent of it
  ExpressionLab.tsx             dev harness UI for app/dev/express (SVG output, no Board involvement)
  AudioReplayPanel.tsx          parked (audioReplay: false) but fully wired
  DemoStudio.tsx, DevReplayLab.tsx   dev-only recording/replay tooling
  Dashboard*.tsx, Sessions*.tsx, Exports*.tsx   account/session management UI
hooks/
  useDeepgram.ts, useGeminiLive.ts   realtime STT engines (Deepgram is the live default)
  useEntitlement.ts, useAuth.ts, usePreferences.ts, useUsageSession.ts
lib/
  features.ts                 the single feature-flag file; governs almost everything below
  llm.ts                      the one centralized LLM client (Anthropic + Google text)
  expression/                 Expression Engine V1 — the current default visual engine (~46 files)
  persist.ts, sessions.ts, exports.ts, recordings.ts   persistence/session layer (legacy-typed)
  scene.ts, composition.ts, cameraReplay.ts, ops.ts     shared rendering/camera infra (still live)
  semantic.ts, story.ts, storyV2.ts, storyPrimitives.ts, storyAssets.ts   legacy "semantic board" + Story Mode
  director.ts, directorState.ts, choreographerComparison.ts, choreographerProcess.ts,
  organizer.ts, beat.ts, beatPrefilter.ts, scribeScheduler.ts, speculative.ts,
  reference.ts, pulse.ts, actions.ts, routing.ts, vocab.ts, attention.ts   Tier-2/Tier-3 legacy speech pipeline (dead at runtime, see LEGACY_AND_DEAD_CODE.md)
  math/*.ts                   math-domain actions/parse/verify (Artist's math step)
  server/*.ts                 provider-guard, entitlement, admin, anonId, limits, whop, site-url
  supabase/*.ts               browser/server/admin/middleware Supabase clients
scripts/                      ~58 node/ps1 scripts: expression replays+tests, story/math/camera tests,
                               STT corpus tooling, demo capture, latency/cost benchmarking
docs/                          ~25 EXPRESSION-ENGINE-*.md narrative eval reports (human-reviewed, not CI)
supabase/migrations/*.sql      schema: projects, usage_sessions, entitlements, spend controls, latency samples
```

## Feature-flag spine (`lib/features.ts`)

This one file is the actual router of the whole system. Current committed values:

```
standardMode: true        storyMode: false        audioReplay: false
reflex: true               choreographerComparison: true    directorV1: true
livePresentationV2: true   expressionEngineV1: true          expressionAnticipation: true
```

The load-bearing gate is `livePresentationV2`. It is hard-coded `true` in
production (`isLivePresentationV2Enabled()`, `lib/features.ts:157-162`, returns
`true` before even checking `NODE_ENV` or the query string). Its own doc comment
states that when on, it suppresses Reflex (Tier 2), Scribe (Tier 3a), and
Beat→Artist→Director→Math (Tier 3b/3c) entirely. This is verified in code, not
just claimed: `components/Board.tsx:6221-6227` gates the *only* path into
`resetSilenceTimer` → `runBeat` → the rest of that chain behind `if
(!v2Enabled)`, and `!v2Enabled` never happens on the committed flag. So
`reflex`, `choreographerComparison`, and `directorV1` are `true` in the flags
file but **dead in practice** — a real discrepancy between declared
configuration and actual runtime behavior. Full evidence in
`LEGACY_AND_DEAD_CODE.md`.

## Product generations found in the codebase (oldest to newest)

1. **Story Mode** (`lib/story.ts`, `storyV2.ts`, `storyPrimitives.ts`,
   `storyAssets.ts`, `app/api/story/route.ts`) — a narrative/scene-based mode.
   Parked by `storyMode: false` for new sessions, but `app/create/page.tsx`
   still allows resuming an existing story session by id — so it is reachable,
   not dead.
2. **Standard Mode's three-tier speech pipeline** (Tier 1 `writeLive`, Tier 2
   Reflex/`lib/speculative.ts`, Tier 3 Scribe/Beat/Artist/Director/
   Choreographer/Math) — fully implemented, fully wired, and entirely
   unreachable today because Tier 1's successor (Live Presentation V2) never
   calls into it. See LEGACY_AND_DEAD_CODE.md for the file-by-file table.
3. **Two deleted predecessor visual engines**: `lib/visualReentry/` and
   `lib/meaning/` (a `SemanticState`-based engine). Confirmed deleted —
   `lib/features.ts:110-124` documents the deletion and both directories are
   confirmed absent from the filesystem.
4. **Live Presentation V2** (`components/Board.tsx`'s live-transcript
   handling, `lib/liveSpeech.ts`) — the current "protected baseline" for how
   the live transcript renders and moves. Governs presentation only, not
   meaning.
5. **Expression Engine V1** (`lib/expression/*`) — the current default visual
   engine: meaning → world → intent → grammar/composition/clean/presentation →
   scene → render → evaluate/repair. The subject of most of this audit's
   depth; see CANVAS_AUDIT.md and RESPONSIBILITY_MAP.md.

Every prior generation except the two explicitly deleted engines is still
present in the repository, still type-checked, and in most cases still
covered by its own test file in `npm test` — while being unreachable from the
running product. This is the single largest fact this audit surfaces.
