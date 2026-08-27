# State and Persistence

## The two persistence layers, and how they actually relate

- **Session** (browser-local, IndexedDB, `inpublic` DB, `sessions` store) —
  `lib/persist.ts:1-42`, type `PersistedSession`: `id, savedAt, startedAt,
  page, elements (SceneElement[]), semantic (SemanticSnapshot), log
  (LogEvent[]), mode, story, composition, title, starred, cloudUpdatedAt`.
  Stored under key `"current"` (the live pointer) and `session:<id>` (library).
- **Project** (Supabase row) — `supabase/migrations/202608090001_
  foundation.sql:16-31`: `id, user_id, title, mode, canvas_json jsonb,
  transcript_json jsonb, preview_data, created_at, updated_at,
  last_opened_at, deleted_at`, 4MB combined-size check constraint, RLS scoped
  to `user_id`.
- **The mapping is exact and verified against both the route code and the
  migration**: `app/api/projects/route.ts` and `app/api/projects/[id]/
  route.ts` both spread the `PersistedSession` (minus `log`/`cloudUpdatedAt`/
  `savedAt`/`userId`) directly into `canvas_json`, and put `log` into
  `transcript_json`. So `canvas_json` contains `elements`, `semantic`,
  `story`, `composition`, `page`, `title`, `starred` — matching the migration
  schema field-for-field.
- **There is no separate Supabase "sessions" table.** `usage_sessions` exists
  but is an unrelated concept — billing/lease tracking, not canvas state.
  `lib/sessions.ts` is a pure client-side derivation (title/status summaries
  for the dashboard) that merges IndexedDB + cloud data; it never writes to
  Supabase itself.

## What is NOT persisted: Expression Engine `WorldState`

Grepping `lib/persist.ts`, `lib/exports.ts`, `lib/recordings.ts` for
`world`/`WorldState` returns zero matches. None of `PersistedSession`'s
fields carry the Expression Engine's semantic graph — `semantic`, `story`,
and `composition` are all typed against the *legacy* engine
(`lib/semantic.ts`, `lib/story.ts`, `lib/composition.ts`), not
`lib/expression/schemas.ts`.

`WorldState` lives only inside `ExpressionLiveController`/`ExpressionSession`,
instantiated into a plain React ref on `Board.tsx` mount
(`Board.tsx:812,870`). It is pure in-memory, per-session, per-page-load
state.

**Consequence, confirmed by tracing rather than assumed**: a page reload
restores the drawn Excalidraw `elements` (the pixels) via IndexedDB, but the
`WorldState` that produced them does not come back — the Expression Engine
starts folding from empty on every fresh page load, even against a canvas
that already has content on it. This directly limits `AGENT.md`'s claim that
"the board is one continuing world" to within a single browser session/page
load, not across reloads or across returning to a saved project. This is
worth stating plainly: **it is the single most concrete gap between the
product's stated intent and its current implementation.**

## Optimistic concurrency / recovery

`app/api/projects/[id]/route.ts:31-32` — PUT requires the client's last-known
`cloudUpdatedAt` and does `.eq("updated_at", expected)`; a mismatch returns
409 with the current cloud copy. `lib/persist.ts:113-120` turns that into a
recovered duplicate session on the client rather than silently overwriting —
a real, deliberate conflict-recovery mechanism, evidence of care in this
specific corner of the system.

## Anonymous / guest sessions

`/try` sessions stay local-only (IndexedDB, no cloud sync) until claimed
post-signup — documented directly in `lib/persist.ts`'s `syncCloud` option.

## Supabase client construction

Three purpose-built clients, correctly separated by execution context:
- `lib/supabase/browser.ts` — memoized singleton, client components.
- `lib/supabase/server.ts` — per-request via `cookies()`, wrapped in React
  `cache()`.
- `lib/supabase/admin.ts` — service-role key, explicitly documented as
  "never retain across Fluid Compute requests," used only from
  `lib/server/*` guard/entitlement code.
- **One real (minor) duplication**: `middleware.ts` has its own inline
  `createServerClient(...)` call rather than reusing `server.ts`'s — same
  shape, justified by Next middleware's request-scoped cookie-mutation
  requirements, but it is duplicated client-construction logic worth noting.

## Exports / Recordings — wired to the legacy engine's types

`lib/exports.ts` (`exportSceneJson`) and `lib/recordings.ts`
(`RecordingMetadata`) both type against `StoryState`/`CompositionState`
(legacy `lib/story.ts`/`lib/composition.ts` types), never `WorldState` or
`ExpressionTrace`. They persist raw `elements` plus these legacy-typed
fields as metadata regardless of which engine actually drew the board — so
they're functionally engine-agnostic in practice (they don't break), but
they have never been updated to represent what the Expression Engine
actually knows about a board it produced. An export or recording of an
Expression-Engine-drawn board carries no Expression Engine provenance.

## Summary: what survives what

| Event | Elements (pixels) | Legacy `semantic`/`story`/`composition` | Expression Engine `WorldState` |
|---|---|---|---|
| Same-tab reload | Yes (IndexedDB) | Yes (IndexedDB) | **No — lost** |
| Sign-in / cross-device (same project) | Yes (Supabase `canvas_json`) | Yes (Supabase `canvas_json`) | **No — never written** |
| New session in same browser tab | N/A (new session) | N/A | N/A (fresh controller) |
| Anonymous → claimed account | Yes, once claimed | Yes, once claimed | **No — never captured** |
