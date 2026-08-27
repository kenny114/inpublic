# Audit Summary

## Architectural scorecard

A score of 5 means the ownership/boundary is obvious and consistently
enforced in implementation, not just documented.

| Area | Score | Evidence |
|---|---|---|
| Responsibility clarity | 3 | Expression Engine's internal stages (composition/clean/presentation) have real, enforced precedence — but 5 files are named `plan*`, two functions (`speakerDuplicateIds`) are duplicated verbatim, and "reflex"/"composition" each name two unrelated systems |
| Module boundaries | 2 | `Board.tsx` (~7500 lines) owns voice wiring, engine wiring, camera, persistence triggers, and UI chrome in one file — the single largest boundary violation found |
| Canvas abstraction | 3 | The semantic-delta → deterministic-geometry pipeline is a genuinely good abstraction; undermined by zero scene-observation (the engine can't detect drift from its own model) |
| Agent abstraction | 2 | One real tool (`express_meaning`), one bounded repair loop, but no action-manager/todo-system concept — see AGENT_AUDIT.md's component inventory |
| State ownership | 2 | `WorldState` (the thing the product is actually about) is not persisted at all; "project" vs "session" is a real but confusingly-named 1:1 mapping across two storage layers |
| Model/provider separation | 4 | `lib/llm.ts` is confirmed the sole text-completion call site repo-wide; realtime voice is correctly kept separate |
| Prompt maintainability | 3 (unscored area, best-effort) | Prompts live inline at their call sites, one per purpose — no scattered duplication found, but not independently reviewed for quality per audit scope |
| Persistence design | 2 | Conflict handling (409 + recovery) is genuinely good; the fact that the product's core semantic state is never persisted is a serious design gap |
| Recovery design | 3 | Real at the data layer (optimistic concurrency); real but narrow at the reasoning layer (single-turn repair loop); nonexistent at the canvas-drift layer |
| Source/context design | 1 | No source/context retrieval subsystem exists for the Expression Engine at all |
| Testability | 3 | Deterministic core layers are thoroughly tested; the live model layer, rendering layer, and browser behavior are not covered by CI |
| Visual evaluation | 3 | Rigorous but entirely manual/human-reviewed (`docs/EXPRESSION-ENGINE-*.md`), not CI-gated |
| Excalidraw alignment | 4 | Deviations from native Excalidraw behavior (no bindings, no `onChange`) are deliberate and documented, not accidental; the one gap (scene observation) is a genuine miss, not a systemic misalignment |
| Ease for a new engineer/agent to understand | 2 | A newcomer reading `lib/features.ts` alone would believe Director/Choreographer/Reflex(old) are live (`true` flags); only tracing `Board.tsx`'s actual gating reveals they're dead. `AGENT.md` is excellent for the agent-tool surface specifically. |

## 1. What InPublic actually is today (≤10 sentences)

InPublic is a Next.js/Excalidraw product that turns live speech into a
continuously-updated semantic drawing, currently through a single default
pipeline: Deepgram transcribes speech, a settled thought is sent to one
Anthropic/Google model call that extracts entities/relations/claims, and a
fully deterministic TypeScript pipeline (identity resolution → world fold →
intent classification → composition/clean/presentation planning → coordinate
composition → Excalidraw rendering → a bounded evaluate/repair check) turns
that meaning into canvas patches. This pipeline, Expression Engine V1, is the
third visual-engine generation built for this product; the previous two
(`lib/visualReentry/`, `lib/meaning/`) were deleted, but an entire earlier
three-tier speech-to-canvas pipeline (Reflex, Scribe, Beat/Artist/Director/
Choreographer/Math) remains fully present, imported, type-checked, and
tested — while being completely unreachable because a single feature-flag
gate (`livePresentationV2: true`) routes every request around it. Story Mode
is similarly present but reachable only for previously-saved sessions. The
Expression Engine never reads back the live Excalidraw scene or the model's
own past output beyond its in-memory `WorldState`, and that `WorldState` is
never persisted — so a page reload keeps the drawing but loses the meaning
behind it. The product's real strength is the semantic-delta-in,
deterministic-geometry-out architecture of the Expression Engine itself,
which is unusually disciplined for a system built rapidly with AI
assistance. `Board.tsx` (~7500 lines) is the de facto application controller
for nearly everything — voice, engine wiring, camera, persistence, and UI
chrome all pass through it.

## 2. Current runtime architecture (one diagram)

```
 mic (Deepgram, live default)
   │
   ▼
 Board.tsx: handleFinal/handleInterim ──▶ writeLive() ──▶ raw transcript on canvas
   │  settled thought
   ▼
 ExpressionLiveController (lib/expression/live.ts)
   │   reflex() [zero-model]     anticipate() [rationed extra extraction]
   ▼
 ExpressionSession.foldDelta()  (pipeline.ts — the real orchestrator)
   │  identity/reference resolution → applyDelta(WorldState) → classifyIntent
   │  → composition (story) → clean (occupancy) → presentation (form)
   │  → planExpression → compose() [coordinates] → evaluate/repair [bounded]
   │  → diffScenes → RenderPatch
   ▼
 render/excalidrawSync.ts ──▶ apiRef.updateScene() ──▶ Excalidraw canvas
                                                            │
                                             (no path back up — the engine
                                              never reads this canvas again)

 [dead, parallel, still present]: Reflex(old)/Scribe/Beat/Artist/Organizer/
 Director/Choreographer/Math — reachable only if livePresentationV2 were false
 (it is hardcoded true), plus Story Mode — reachable only for resumed sessions.
```

## 3. Five strongest parts of the system (evidence-based)

1. **The meaning-delta contract.** `AGENT.md`'s rule — "submit entities,
   relations and claims; the engine chooses the form," with geometry
   literally rejected at the schema boundary — is enforced in code
   (`MeaningDelta` has no coordinate field, `.strict()` at every level) and
   is a genuinely rare discipline for a rapidly-built AI product.
2. **The composition→clean→presentation sequencing.** Three stages that look
   like triplicated responsibility from folder names alone are, on trace, a
   real precedence chain with each stage strictly subordinate to the last —
   confirmed by reading the actual wiring in `pipeline.ts`, not assumed.
3. **The bounded repair loop.** `evaluate/evaluate.ts` +
   `evaluate/repair.ts` is a real observe→diagnose→patch→re-evaluate→
   keep-or-discard cycle, capped at one grammar-change recompose — disciplined
   scope, not runaway retry logic.
4. **Provider-guard cost/rate enforcement.** `lib/server/provider-guard.ts`
   is a single, consistent chokepoint for spend across every provider —
   reservation before the call, reconciliation after, emergency-stop
   checks — the kind of infrastructure that's easy to skip under rapid
   iteration and wasn't skipped here.
5. **Deliberate, documented Excalidraw deviations.** The no-bindings and
   `onChange`-no-op decisions both carry explicit in-code rationale
   explaining the tradeoff, rather than being unexplained workarounds.

## 4. Five biggest architectural weaknesses (evidence-based)

1. **The Expression Engine has no canvas perception.** It cannot detect a
   human's manual edit to the canvas; its model of "what exists" is
   entirely self-authored `WorldState`. Excalidraw already exposes
   `getSceneElements()` — this gap is unforced.
2. **`WorldState` is never persisted.** The product's actual core
   asset — the meaning behind the drawing — is lost on every reload,
   contradicting `AGENT.md`'s "one continuing world" claim across sessions.
3. **`Board.tsx` is a god object.** ~7500 lines owning voice, engine
   wiring, camera, persistence triggers, dev-tool gating, and UI chrome.
4. **Flags lie about what's running.** `directorV1`, `choreographerComparison`,
   and `reflex` are all `true` in `lib/features.ts` while being fully dead
   at runtime — a newcomer or an agent reading the flags file alone would
   draw the wrong conclusion about the system's actual behavior.
5. **CI time is spent testing dead code.** At least 7 of ~21 `npm test`
   scripts regression-test Story Mode, Audio Replay, and Math — features
   either flagged off or reachable only through the dead Tier-3 branch —
   while the live model-extraction layer and the browser rendering layer
   have no CI coverage at all.

## 5. Biggest examples of accidental complexity

- Two unrelated systems both named "reflex" (`features.reflex` / old Tier-2
  vs. `lib/expression/fast/reflex.ts` / current engine), sharing no code but
  sharing a name a reader would assume implies a relationship.
- Two unrelated systems both named "composition" (`lib/composition.ts` =
  camera geometry, `lib/expression/composition/*` = story/spine selection),
  both currently active, adjacent import paths.
- `speakerDuplicateIds` implemented twice, nearly identically, in
  `clean/plan.ts` and `presentation/plan.ts`.
- A flags file whose doc comments describe a `?v2=1` dev override
  (`lib/features.ts:87-91`) that the function's own logic makes permanently
  unreachable (`157-162`) — the comment even admits this, but the dead
  branch remains.

## 6. Responsibilities with unclear ownership

- `lib/attention.ts`, `lib/vocab.ts`'s direct Board.tsx call site, and
  `lib/routing.ts`'s reachability via `lib/ops.ts` could not be resolved to a
  specific gate by two independent tracing passes — genuinely unclear from
  static inspection, not just unclear from naming.
- Arrow routing/elbow geometry: `lib/routing.ts` (legacy-era) vs.
  `compose/compose.ts` (current engine) — which one actually owns this for
  Expression-Engine-drawn arrows was not conclusively resolved.
- Camera/viewport: correctly owned by pre-Expression-Engine files
  (`lib/composition.ts`, `lib/cameraReplay.ts`), but never migrated or even
  referenced from within `lib/expression/*` — an ownership gap rather than a
  conflict, worth naming explicitly since it means the newest layer of the
  product depends on the oldest surviving layer for a core capability.

## 7. Architecture that appears obsolete

Entire Reflex(old)/Scribe/Beat/Artist/Organizer/Director/Choreographer/Math
Tier-2/Tier-3 pipeline (`lib/speculative.ts`, `scribeScheduler.ts`,
`beatPrefilter.ts`, `beat.ts`, `director.ts`, `directorState.ts`,
`choreographerComparison.ts`, `choreographerProcess.ts`, `organizer.ts`,
`reference.ts`, `pulse.ts`, `lib/math/*`, plus the corresponding
`/api/beat`, `/api/artist`, `/api/math`, `/api/scribe` routes) — full detail
and evidence in `LEGACY_AND_DEAD_CODE.md`. Story Mode is legacy but not
obsolete (still reachable for resumed sessions).

## 8. Things InPublic reimplements that Excalidraw may already solve

Scene observation is the one clear case (`getSceneElements()` exists,
unused). Everything else InPublic reimplements — collision avoidance, arrow
routing without bindings, camera spring physics — was found to be either
something Excalidraw doesn't natively provide, or a deliberate, documented
tradeoff against what Excalidraw does provide. Full table in
`EXCALIDRAW_COMPARISON.md`.

## 9. Things that must remain InPublic-specific

Meaning understanding, semantic/world state, visual intent/form selection,
agent reasoning (identity/target judges, repair loop), evaluation. See
`EXCALIDRAW_COMPARISON.md`'s closing section.

## 10. Recommended conceptual boundaries

Derived from what the code's actual dependency/state-ownership structure
already implies, not imposed:

- **Speech** — owns: mic capture, transcript settling, engine selection
  (Deepgram/Gemini). Must not own: meaning, layout, persistence. Existing
  files: `hooks/useDeepgram.ts`, `hooks/useGeminiLive.ts`. Currently
  entangled with everything else inside `Board.tsx`.
- **Meaning** — owns: `WorldState`, identity/reference resolution, intent
  classification. Must not own: geometry, rendering. Existing files: `lib/
  expression/{world,intent,meaning}/*`. Already well-isolated internally.
- **Expression** — owns: composition/clean/presentation planning, scene
  composition, evaluation/repair. Must not own: Excalidraw specifics, camera.
  Existing files: `lib/expression/{planner,composition,clean,presentation,
  compose,evaluate,grammars}/*`. Already well-isolated internally.
- **Canvas** — owns: Excalidraw embedding, render skeleton generation,
  scene diffing/reconciliation, camera/viewport. Must not own: meaning
  decisions. Existing files: `lib/expression/render/*` plus (currently
  outside the folder) `lib/composition.ts`, `lib/cameraReplay.ts`,
  `lib/ops.ts`, `lib/scene.ts` — the strongest case for the "first seam"
  below, since canvas ownership is currently split across `lib/expression/
  render/` and pre-existing `lib/` files that were never moved in.
- **Session** — owns: `PersistedSession`/project persistence, save/sync/
  conflict recovery. Must not own: engine internals. Existing files:
  `lib/persist.ts`, `app/api/projects*`. Should eventually also own
  `WorldState` persistence, once that's designed.
- **Agent** — owns: the `express_meaning` tool boundary, MCP bridge. Must
  not own: anything the Meaning/Expression boundaries already own — it should
  stay a thin facade. Existing files: `lib/expression/{tool,entry,
  agentBridge}.ts`. Already thin and well-isolated.
- **App** — owns: page routing, UI chrome, wiring the above together. Must
  not own: any domain logic itself. This is precisely what `Board.tsx`
  currently fails to respect — it owns wiring *and* a large amount of
  domain logic (camera decisions, persistence triggers, dev-tool gating)
  inline.

## 11. First restructuring seam (exactly one)

**Extract the camera/viewport responsibility (`lib/composition.ts`,
`lib/cameraReplay.ts`, and the overflow/page-turn logic currently inline in
`render/excalidrawSync.ts`) into a single, explicitly-named module that the
Expression Engine's render layer calls into, rather than `Board.tsx` calling
some of it directly and `render/excalidrawSync.ts` implementing the rest
itself.**

Why this is the safest first seam:
- **Reduces ambiguity**: camera is currently the one core capability owned by
  pre-Expression-Engine files with no home inside `lib/expression/`, split
  between `Board.tsx` call sites and `render/excalidrawSync.ts` logic. Naming
  and consolidating this boundary would make ownership obvious without
  touching meaning, geometry, or rendering decisions.
- **Manageable blast radius**: camera decisions are already isolated,
  pure-ish functions (`proposeCamera`, `stepCameraSpring`) — this is a move
  and a clarified interface, not a rewrite of decision logic.
- **Testable**: `camera-replay-test.mjs` and `camera-policy-ab.mjs` already
  exist and can validate that behavior is unchanged before/after.
- **Does not require touching the two most fragile areas found in this
  audit** — `Board.tsx`'s size, and `WorldState` persistence — both of which
  are much higher-risk, higher-value seams to tackle later with more
  deliberate planning, not first.
- It also directly sets up (without doing) the eventual `Canvas` boundary
  named in §10, without pre-committing to anything about the Meaning/
  Expression/App boundaries.

## 12. Confidence / unknowns

Could not be conclusively proven by static inspection alone:
- `lib/attention.ts`'s and `lib/vocab.ts`'s exact Board.tsx call sites, and
  `lib/routing.ts`'s live reachability via `lib/ops.ts` — see
  `LEGACY_AND_DEAD_CODE.md`'s closing note.
- Whether the live (non-fixture) meaning-extraction model still produces
  output compatible with the 100-case corpus's frozen fixtures — this would
  require a live run, not code reading.
- Whether `Board.tsx`'s camera call sites (lines 1235, 1999, etc., per the
  legacy-code research pass) are truly unconditional or have some other
  gating not surfaced by grep for `features.`/`v2Enabled` specifically.
- Whether any multi-user/collaboration surface exists — none was found, but
  this audit did not exhaustively search for it as a primary target.
- The actual behavior of the live Gemini Live voice path was not traced in
  the same depth as the Deepgram path, since it's "dormant" by default.
- No live/runtime execution of the app was performed for this audit — all
  findings are from static code reading and grep-based reachability
  analysis (as instructed). Where two independent research passes
  corroborated the same finding from different entry points (e.g. the
  `v2Enabled` gate killing Beat/Artist/Director), confidence is high. Single-
  source findings are noted as such where relevant in the individual audit
  files.
