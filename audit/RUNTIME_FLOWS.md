# Runtime Flows — traced, not assumed

All chains below are what the code actually does today, with the current
committed flag values (`livePresentationV2: true`, `expressionEngineV1: true`).
Where the prompt's assumed pipeline shape ("user types → ? → model → ? → canvas")
turned out to be wrong, that correction is called out explicitly.

## A. Typed / spoken request (the real product flow — these two are one flow)

InPublic's "typed request" is, in practice, always mediated by live speech
transcription — there is no separate typed-text entry point into the
Expression Engine in the main product UI (only in the dev-only `ExpressionLab`,
flow D below).

Entry points:
- `app/create/page.tsx` — dynamically imports `components/Board` (`ssr:false`),
  renders `<Board initialMode initialSessionId startFresh />`. This is the real
  canvas.
- `app/try/page.tsx` — guest entry, renders `<Board guest startFresh />`
  directly.
- **Correction to the assumed chain**: `app/page.tsx` is the marketing landing
  page and never mounts `Board`. `components/ProductUI.tsx` is not a parent of
  `Board` — it's a shared UI-atom library (`Button`, `Modal`, `Toast`,
  `SavedStatus`, ...) that `Board.tsx` imports pieces *from*. The dependency
  direction is `Board.tsx → ProductUI.tsx`, not the reverse.

Voice → transcript:
```
mic
 -> hooks/useDeepgram.ts (ENGINE default; Board.tsx:371 NEXT_PUBLIC_ENGINE ?? "deepgram")
    fetches /api/deepgram/token (hooks/useDeepgram.ts:632)
    onFinal/onInterim callbacks wired at Board.tsx:6568-6591
 -> Board.tsx handleInterim (~6288) / handleFinal (~6040)
 -> writeLive(...) (multiple call sites, Board.tsx:6181,6187,6192,6195)
```
(`hooks/useGeminiLive.ts` is a parallel, code-complete but "dormant" second
engine — only active if `NEXT_PUBLIC_ENGINE=gemini` is set; Board.tsx's own
comment at line 6623-6624 calls it dormant.)

Transcript → meaning → canvas (Expression Engine V1, the live path):
```
Board.tsx: settled thought detected
 -> handleSettledExpression(thought)                         Board.tsx:6190,6284
 -> expressionControllerRef.current.submit({ id, text })     Board.tsx:6027
    (ExpressionLiveController, lib/expression/live.ts, constructed Board.tsx:869-920)
 -> controller.enqueue -> debounced flush()                  lib/expression/live.ts
 -> ExpressionSession.ingest / ingestDelta                   lib/expression/pipeline.ts
 -> requestMeaningDelta                                      lib/expression/meaning/client.ts:64
 -> fetch("/api/express")                                    app/api/express/route.ts
 -> extractMeaning                                           lib/expression/meaning/extract.ts:426
 -> lib/llm.ts complete() (the one unconditional model call)
 -> [back in pipeline.ts] ExpressionSession.foldDelta — the real orchestrator, 22-step
    sequence detailed in CANVAS_AUDIT.md — ends with a ScenePlan + RenderPatch
 -> render/excalidrawSync.ts syncExpressionCanvas (called from Board.tsx)
 -> apiRef.current.updateScene(...)  (Excalidraw's imperative API)
 -> pixels on the canvas
```

Two additional, faster paths run on every settled word while the sentence is
still in progress, both gated on `xeEnabled` only (not on `v2Enabled` or
`features.reflex`):
- `expressionControllerRef.current.reflex(settledSoFar)` (Board.tsx:6390) — a
  zero-model, closed-vocabulary fast path (`lib/expression/fast/reflex.ts`).
- `.anticipate(settledSoFar)` (`lib/expression/live.ts:353-365`) — up to 3
  rationed extra `/api/express` calls per utterance so the board keeps growing
  mid-sentence instead of freezing for 3-4s.

**Verified dead branch, same flow**: the pre-V2 three-tier pipeline
(Reflex/Scribe/Beat/Artist/Director/Choreographer/Math) is only reachable via
`if (!v2Enabled) { settleSpeculative(text); nudgeScribe(); resetSilenceTimer();
}` (`Board.tsx:6221-6227`) and `if (fresh && features.reflex && !v2Enabled)`
(`Board.tsx:6420`). Since `v2Enabled` is always `true` today, none of this
runs. Full file-by-file evidence in `LEGACY_AND_DEAD_CODE.md`.

## B. Voice request (same as A above)

There is no separate "voice flow" distinct from A in this codebase — voice
*is* the input channel for the typed/main flow. See A for the full chain.
Token issuance (`/api/deepgram/token`, `/api/gemini/token`) is the only
voice-specific server hop; everything downstream of a final transcript is
identical to A.

## C. Existing canvas edit (user asks AI to modify something already on canvas)

There is no separate "inspect canvas, then decide" step — Expression Engine
V1 does not read the live Excalidraw scene back before acting. Instead:
- The engine's own `WorldState` (in-memory, per-session, held in
  `ExpressionLiveController`/`ExpressionSession`, never persisted — see
  `STATE_AND_PERSISTENCE.md`) is the source of truth for "what already exists."
- A new utterance that refers to an existing concept is resolved against
  `WorldState`, not against the canvas, via one of two independent mechanisms:
  - `world/apply.ts`'s always-on `resolveMention` (pronoun/alias/name
    matching against the world's own entity list), optionally overridden by
    the opt-in two-stage `world/identity.ts` (deterministic scoring, then a
    model-backed `identityJudge.ts` only if the first stage abstains — default
    production config has this off, per `pipeline.ts:225-233,276-278`).
  - Free-text pointer resolution ("the pricing plan", "the second one") goes
    through the separate `world/resolveTarget.ts` + `world/references.ts` +
    `world/targetJudge.ts` machinery — a distinct linguistic phenomenon
    (discourse-act/topic-recall targeting) from entity identity, not a
    competing implementation of it. Full detail in `CANVAS_AUDIT.md`.
- Once resolved, the fold either updates the matched `WorldEntity`/`WorldRelation`
  in place or mints a new id. The resulting `ExpressionPlan`/`ScenePlan` is
  diffed against the last rendered scene (`render/core.ts:diffScenes`) to
  produce a `RenderPatch`, which is what actually touches Excalidraw — so the
  "canvas edit" is really "world-state edit, then re-render the delta,"
  never "read pixels, then edit pixels."
- There is a bounded self-repair loop (`evaluate/evaluate.ts` +
  `evaluate/repair.ts`) that re-checks the *plan* (via reverse-interpretation
  of the ScenePlan geometry back into implied relations, compared against
  `world.relations`) and can order one grammar-change + recompose if fidelity
  drops below threshold — this is the closest thing to "inspect, then repair"
  in the system, and it operates on the plan/scene structures the engine
  itself produced, not on raw Excalidraw elements.

## D. Source-aware / agent request

The one external tool, `express_meaning` (`lib/expression/tool.ts`,
documented in `AGENT.md` at repo root), is the agent-facing entry into the
same `ExpressionSession`/`pipeline.ts` machinery as flow A, minus the voice
layer:
```
agent call { text } or { delta }
 -> lib/expression/entry.ts createExpressionEntry().express(...)
 -> ExpressionLiveController (or directly ExpressionSession for the dev harness)
 -> same foldDelta sequence as flow A
 -> same render/excalidrawSync -> Excalidraw canvas, IF a board is attached
```
Two concrete "sources" for this path:
- **Local dev bridge**: `scripts/express-mcp-server.mjs` (MCP over stdio) talks
  to `lib/expression/agentBridge.ts`, which polls a loopback-only
  `127.0.0.1:3212` endpoint. Gated by `isAgentBridgeEnabled()`
  (`lib/features.ts:217`) — requires `NODE_ENV !== "production"` AND `?agent=1`
  in the URL, no committed-flag path exists. Confirmed unreachable in
  production.
- **Dev-only text harness**: `app/dev/express/page.tsx` +
  `components/ExpressionLab.tsx` — a standalone tool, not a variant of the
  product UI. It instantiates `ExpressionSession` directly, renders to raw SVG
  via `lib/expression/render/svg.ts` (not Excalidraw), has no mic, no
  `Board.tsx` involvement, and is marked `noindex`/unlinked from the product.
  It is genuinely useful as a "read the engine's reasoning without a canvas in
  the way" tool (see `lib/features.ts`'s `isExpressionDebugOnlyEnabled` doc
  comment) but is architecturally isolated from the live product path.

There is no other "project/canvas source retrieval" mechanism found — no
RAG-style document ingestion, no file/source upload feeding the Expression
Engine's context. The only "source" concept in the codebase is the audio file
upload path for the parked Audio Replay feature (`app/api/audio/upload/route.ts`,
`lib/audio/replayController.ts`), which is unrelated to Expression Engine
context and feeds the legacy Story/semantic pipeline instead.

## Diagrams

### Typed/voice flow (current default path)

```
 mic (Deepgram)
   │
   ▼
 Board.tsx: handleFinal/handleInterim ── writeLive() ── Excalidraw text element (raw transcript)
   │
   │ settled thought
   ▼
 ExpressionLiveController.submit()  (lib/expression/live.ts)
   │  ├─ reflex()      zero-model fast entities        (fast/reflex.ts)
   │  └─ anticipate()   rationed mid-sentence extraction (live.ts, up to 3 calls)
   ▼
 ExpressionSession.foldDelta()  (pipeline.ts — the real orchestrator)
   │
   ├─ identity/reference resolution   (world/*)
   ├─ applyDelta -> WorldState        (world/apply.ts)
   ├─ classifyIntent                  (intent/classify.ts)
   ├─ composition -> clean -> presentation   (sequential, narrowing passes)
   ├─ planExpression -> ExpressionPlan       (planner/plan.ts + grammars/*)
   ├─ compose -> ScenePlan (coordinates)     (compose/compose.ts)
   ├─ evaluateScene -> repair (bounded)      (evaluate/*)
   └─ diffScenes -> RenderPatch              (render/core.ts)
   ▼
 render/excalidrawSync.ts syncExpressionCanvas()
   ▼
 apiRef.current.updateScene()  (Excalidraw imperative API)
   ▼
 canvas
```

### Agent-tool flow (dev-only)

```
Claude Code / any MCP client
   │  express_meaning({text|delta})
   ▼
scripts/express-mcp-server.mjs (stdio MCP)  ── loopback fetch ──▶  lib/expression/agentBridge.ts (in-browser, ?agent=1, dev only)
   │                                                                       │
   ▼                                                                       ▼
lib/expression/entry.ts createExpressionEntry().express()   ═══════ same ExpressionSession as the live path ═══════▶ canvas (if a board is attached)
```
