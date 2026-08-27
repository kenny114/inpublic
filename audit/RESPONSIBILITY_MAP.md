# Responsibility Map

For each subsystem: responsibility, entry point, important files, state owned,
dependencies, callers, side effects. Where one responsibility has multiple
owners, all owners are listed explicitly with the evidence.

## App / UI shell

- **Responsibility**: page routing, canvas mounting, top-level layout/chrome.
- **Entry points**: `app/create/page.tsx` (real product), `app/try/page.tsx`
  (guest), `app/dev/express/page.tsx` (dev harness), `app/page.tsx` (marketing,
  does not mount the canvas).
- **Important files**: `components/Board.tsx` (the de facto app controller —
  ~7500 lines, owns voice wiring, Expression Engine wiring, camera, page/
  overflow logic, persistence triggers, dev-tool gating, UI chrome
  composition), `components/ControlBar.tsx`, `components/ProductUI.tsx`
  (shared atoms, not a container).
- **State owned**: nearly everything at the React-ref/state level — mic
  session, `ExpressionLiveController` instance, camera state, save state,
  page/viewport state, dev-tool toggles.
- **Dependencies**: `hooks/*`, `lib/expression/*`, `lib/persist.ts`,
  `lib/features.ts`, legacy Tier-2/3 modules (imported, mostly unreachable).
- **Callers**: `app/create/page.tsx`, `app/try/page.tsx`.
- **Side effects**: Excalidraw canvas mutation, IndexedDB/Supabase writes,
  network calls to `/api/express`, `/api/sketch`, `/api/deepgram/token`, etc.
- **Note**: `Board.tsx` is the strongest "god object" candidate in the
  codebase — see AGENT_AUDIT.md / AUDIT_SUMMARY.md Phase 6 findings.

## Projects / Sessions

- **"Project"** = the Supabase row (`supabase/migrations/202608090001_
  foundation.sql:16-31`): `canvas_json`, `transcript_json`, metadata. Owner:
  `app/api/projects/route.ts`, `app/api/projects/[id]/route.ts`.
- **"Session"** = the browser IndexedDB record (`lib/persist.ts:1-42`,
  `PersistedSession`): `elements`, `semantic`, `story`, `composition`, `log`,
  `page`, plus cloud-sync metadata. Owner: `lib/persist.ts`.
- These are two names for two layers of the *same* data — `canvas_json`
  literally contains the spread of `PersistedSession` minus a few fields
  (`app/api/projects/route.ts:27,31`). `lib/sessions.ts` is a third,
  purely-derived layer (dashboard summaries) that never talks to Supabase
  directly.
- **Not owned by this layer**: Expression Engine `WorldState`. See
  `STATE_AND_PERSISTENCE.md` — this is a genuine gap, not a naming overlap.

## Agent runtime (the `express_meaning` tool)

- **Responsibility**: expose the Expression Engine to an external agent.
- **Entry point**: `lib/expression/tool.ts` (`createExpressTool`).
- **Important files**: `lib/expression/entry.ts`, `lib/expression/
  agentBridge.ts`, `scripts/express-mcp-server.mjs`.
- **State owned**: none of its own — delegates entirely to `ExpressionSession`.
- **Dependencies**: `lib/expression/live.ts` / `pipeline.ts`.
- **Callers**: MCP clients (Claude Code, Codex, etc.) via stdio, dev-only.
- **Side effects**: same as the live path, when a board is attached; otherwise
  a queued call that times out.

## Model invocation

- **Single owner**: `lib/llm.ts` — confirmed via repo-wide grep to be the only
  file importing `@anthropic-ai/sdk`; Google text calls go through the same
  file's `fetch`-based `completeGoogle`. No bypass found anywhere in
  `lib/expression/*` server-side code.
- **Four call sites within the Expression Engine** (not one, despite the
  "one model call" doc claim being accurate for the *default-configured*
  path): `meaning/extract.ts:426` (unconditional), `world/identityJudge.ts:90`
  and `world/targetJudge.ts:76` (both opt-in, default-off), `draw/agent.ts:78`
  (gated to object-type entities, cached after first use).
- **Realtime voice** is a separate concern with its own providers (Deepgram
  SDK, Gemini Live via `@google/genai` websocket) — not routed through
  `lib/llm.ts`, and correctly so (different transport class).

## Prompts

- No standalone "prompts/" directory — prompt text lives inline next to its
  call site (`meaning/extract.ts`, `draw/agent.ts`, legacy `lib/beat.ts` /
  `lib/story.ts`). Not evaluated for quality here (out of scope per audit
  rules), but ownership is not scattered: each model call site owns its own
  prompt text, matching the single-call-site-per-purpose structure above.

## Source retrieval / context

- No RAG/document-ingestion subsystem exists. The only file-upload path in
  the repo is `app/api/audio/upload/route.ts` for the parked Audio Replay
  feature, which feeds the legacy semantic/story pipeline, not the Expression
  Engine. There is no "project source" or "canvas source" retrieval feeding
  meaning extraction today.

## Voice

- **Owner**: `hooks/useDeepgram.ts` (live default) and `hooks/useGeminiLive.ts`
  (code-complete, "dormant" per `Board.tsx:6623-6624` comment, only active via
  `NEXT_PUBLIC_ENGINE=gemini`).
- **Token issuance**: `app/api/deepgram/token/route.ts`,
  `app/api/gemini/token/route.ts`.
- **Downstream**: both funnel into `Board.tsx`'s `handleFinal`/`handleInterim`,
  which is the single ingestion point regardless of which engine produced the
  transcript — no duplicate downstream handling.

## Canvas perception

- Expression Engine does **not** perceive the live Excalidraw scene. Its
  notion of "what exists" is entirely `WorldState`, held in memory. See
  `RUNTIME_FLOWS.md` flow C and `CANVAS_AUDIT.md` for the full argument.
- The rendering layer does track its *own* last-rendered `ScenePlan` for
  diffing (`render/core.ts:diffScenes`), which is a rendering optimization,
  not a perception mechanism the reasoning layers consult.

## Canvas actions / drawing creation / drawing editing

- **Multiple owners across a sequenced pipeline, not a single "canvas action"
  layer**:
  - `planner/plan.ts` (`planExpression`) — chooses grammar, builds regions/
    connections.
  - `compose/compose.ts` — turns the plan into actual coordinates
    (`ScenePlan`).
  - `render/excalidraw.ts` — turns `ScenePlan` into Excalidraw element
    skeletons.
  - `render/excalidrawSync.ts` — reconciles skeletons against the live scene
    (its own diff algorithm, not Excalidraw's) and calls `updateScene`.
  - `draw/agent.ts` (+ `resolve.ts`, `library.ts`, `client.ts`) — a *separate*
    concern: what an individual object-type concept looks like as a stroke
    set (the "Drawing Agent"), cached and reused. This is drawing-creation-
    of-icons, distinct from drawing-creation-of-layout above.
- **Editing** an existing drawing is not a separate code path — it is the same
  pipeline re-run on updated `WorldState`, diffed against the last `ScenePlan`.

## Relationships / connections

- Decided in `planner/plan.ts` + `grammars/index.ts` (which relations become
  visible connectors, per grammar), routed/drawn in `compose/compose.ts`
  (line geometry) and `render/excalidraw.ts` (element skeletons, deliberately
  **not** using Excalidraw's arrow bindings — see `EXCALIDRAW_COMPARISON.md`).

## Layout / composition

- **Real, sequenced three-stage ownership** (not duplicated authority, but
  duplicated *mechanism* in places):
  - `lib/expression/composition/plan.ts` — decides the **story**: primary
    entity + causal/temporal spine + allowed set.
  - `lib/expression/clean/plan.ts` — decides **occupancy**: which entities fit
    within a 6-node cap, constrained to stay within composition's allowed set
    (`constrainCleanToComposition`, `clean/plan.ts:453`).
  - `lib/expression/presentation/plan.ts` — decides **visual form**: which
    layout routine (vertical-spine / left-to-right / hierarchy /
    central-primary), and may only subtract from clean's keep-set.
  - `compose/compose.ts` — the only place actual x/y coordinates are computed.
  - **Confirmed code duplication** (not duplicated authority): `clean/plan.ts`
    and `presentation/plan.ts` each define their own near-identical
    `speakerDuplicateIds` function; `clean/plan.ts` and `composition/plan.ts`
    each independently compute spine/hop-map logic. A maintenance-drift risk,
    not a runtime conflict — see CANVAS_AUDIT.md §7.
  - A **separate, older, still-imported** `lib/composition.ts` (root-level)
    exists and is about camera geometry, not layout — different concept,
    confusingly identical name. See LEGACY_AND_DEAD_CODE.md.

## Camera / viewport

- **Owner**: legacy-named but currently-active files — `lib/composition.ts`
  (root, camera geometry/spring types), `lib/cameraReplay.ts` (camera
  proposal/spring-physics, called unconditionally from `Board.tsx:1235,1999`
  regardless of the Expression Engine flags), plus `render/excalidrawSync.ts`'s
  `decideExpressionOverflow`/page-turn logic and `lib/ops.ts`'s page/place
  primitives.
- This is the one area where a **pre-Expression-Engine file is still the
  active, unreplaced owner** of a core capability — camera/viewport logic was
  never rebuilt inside `lib/expression/*`; the new engine's rendering output
  is driven onto a camera system that predates it.

## Object identity

- Two independent mechanisms for two different linguistic problems, not
  duplicate implementations of one (verified, not just categorized):
  - **Entity fold identity**: "is this new mention the same thing as
    something already known" — `world/apply.ts`'s always-on `resolveMention`,
    optionally overridden by the opt-in `world/identity.ts` two-stage
    resolver (deterministic scoring, then `identityJudge.ts` model call only
    on abstain; default off in production).
  - **Pointer/target resolution**: "what does this free-text reference point
    to" (ordinals, topic-recall, discourse-act targets) —
    `world/resolveTarget.ts` + `world/references.ts` + `world/targetJudge.ts`.
  - IDs are semantic slugs minted via `uniqueId(slugify(label))`
    (`world/apply.ts`), not raw Excalidraw element ids — Excalidraw ids are a
    separate, lower-level concern handled by `render/excalidraw.ts`'s
    `applyStableIds` workaround for Excalidraw minting fresh ids on every
    conversion call.

## Persistence / Recovery

- See `STATE_AND_PERSISTENCE.md` for full detail. Summary of ownership:
  `lib/persist.ts` (IndexedDB + cloud sync orchestration), `app/api/
  projects*` (Supabase read/write), `lib/supabase/*` (three client
  constructors: browser/server/admin, plus a fourth near-duplicate inline
  in `middleware.ts`). Recovery: optimistic-concurrency 409 handling on
  project PUT (`app/api/projects/[id]/route.ts:31-32`) surfaces conflicts to
  the client rather than silently overwriting.

## Provenance

- `WorldEntity`/`WorldRelation` carry a `provenance[]` field (max 6,
  `schemas.ts`) — the Expression Engine's own audit trail of what produced a
  given fact. This is in-memory only, not persisted (same gap as `WorldState`
  generally).

## Evaluation / tests

- See `TEST_COVERAGE_MAP.md`. Ownership: `scripts/*-test.mjs` (CI-run,
  deterministic), `scripts/expression-*-replay.mjs` and `expression-*-audit.mjs`
  (manual, human-reviewed, not CI-gated), `docs/EXPRESSION-ENGINE-*.md` (the
  human-authored findings from those manual runs).

## Multiple-owner summary table

| Responsibility | Owners found | Verdict |
|---|---|---|
| Layout/positioning decision | composition/plan.ts (story) → clean/plan.ts (occupancy) → presentation/plan.ts (form) → compose/compose.ts (coordinates) | Sequenced pipeline, not competing; but `speakerDuplicateIds`/spine-hop logic genuinely duplicated in code between clean and composition |
| Camera/viewport | lib/composition.ts + lib/cameraReplay.ts (pre-existing, still sole owner) | Single owner, but never migrated into the new engine — an ownership *gap*, not a conflict |
| Identity resolution | world/apply.ts (fold) vs world/resolveTarget.ts (pointer) | Two owners, two distinct problems — not duplication |
| "Plan"-named files | planner/plan.ts, planner/visibility.ts, composition/plan.ts, clean/plan.ts, presentation/plan.ts | 5 files, but a real, ordered precedence chain enforced by pipeline.ts wiring, not 5 competing planners |
| Speech pipeline | Tier 1 (writeLive, active) vs Tier 2/3 (Reflex/Scribe/Beat/Artist/Director, dead-at-runtime but fully present) | One owner is live, the other is a complete, unreachable duplicate left in place |
| Supabase client construction | browser.ts, server.ts, admin.ts, middleware.ts (inline) | Middleware duplicates server.ts's client-construction shape; minor, justified by Next middleware cookie semantics |
