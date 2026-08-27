# InPublic

InPublic turns meaning into live visual expression.

## Structure

| Path | What's there |
| --- | --- |
| `app/` | Next.js routes and API handlers. |
| `components/` | UI. `Board.tsx` is application wiring only — no new domain logic. |
| `hooks/` | Speech transport (`useDeepgram`, `useGeminiLive`, `useMoonshine`) and client hooks. |
| `lib/` | Domain implementation. Read `lib/CONTEXT.md` before changing anything here. |
| `public/` | Static assets. |
| `supabase/` | Database schema/migrations. |

## Invariants

1. LLM output does not directly own raw Excalidraw geometry.
2. Meaning/state is independent of rendering technology.
3. Excalidraw-specific implementation belongs behind the Canvas boundary (`lib/canvas/`).
4. `Board.tsx` is application wiring, not a home for new domain logic.
5. Architectural ownership must be defined before adding substantial features.

## Process

This repo was stripped down to its runnable core on 2026-08-27 — no `planning/`,
`evaluation/`, `audit/`, or `docs/` yet. If that process (specs before
substantial work, ADRs for durable decisions, recorded evaluation) comes back,
document it here before reintroducing those directories.
