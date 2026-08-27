# Agent Architecture Audit

## Does InPublic have a genuine agent loop, or a generation pipeline?

**Mostly a generation pipeline with one real, bounded feedback loop inside
it** — not an observe/reason/act/observe-again agent in the full sense.

Evidence for "pipeline, not agent":
- The dominant shape, traced in full in `CANVAS_AUDIT.md` and
  `RUNTIME_FLOWS.md`, is linear: meaning delta in → deterministic fold →
  deterministic plan/compose → render. No step chooses between multiple
  candidate *actions* against an external environment and observes a result
  before choosing the next one. It is closer to a compiler pipeline (input
  language → IR → target) than to an agent's action loop.
- The engine does not perceive the canvas (see CANVAS_AUDIT.md's "How the AI
  sees the canvas") — a precondition for a real observe step is missing for
  the canvas itself. It only "observes" its own prior output (`WorldState`,
  last `ScenePlan`), not ground truth.

Evidence for a real, if narrow, loop:
- `evaluate/evaluate.ts` → `evaluate/repair.ts` is a genuine
  observe(reverse-interpret scene) → reason(diagnose problems) → act(patch
  plan or recompose) → observe-again(re-evaluate) → keep-or-discard cycle,
  bounded to one grammar-change recompose (`pipeline.ts:514-554`). This is
  the one place in the codebase that matches the classical agent loop shape
  the audit brief asks about — but it operates entirely on the engine's own
  internal representations, once per turn, not across multiple turns or
  against the live canvas.

## Where "the agent" begins and ends

- **Begins**: at `express_meaning` (`lib/expression/tool.ts`) for an external
  agent, or at a settled speech thought (`Board.tsx:handleSettledExpression`)
  for a human speaker — both funnel into the identical
  `ExpressionLiveController`/`ExpressionSession` machinery.
- **Ends**: at the `RenderPatch` applied via Excalidraw's `updateScene`. There
  is no post-render step where the "agent" looks at what actually landed on
  the canvas and decides whether to continue — the repair loop (above) checks
  its own intermediate `ScenePlan`, not the post-`updateScene` canvas state.
- **In between**: everything is deterministic TypeScript except the four
  model call sites cataloged in `RESPONSIBILITY_MAP.md` (meaning extraction,
  two opt-in judges, the Drawing Agent). This matches the product's own
  framing in `lib/features.ts`'s doc comments ("One model call, at the
  meaning layer only; every other layer is deterministic").

## Component inventory (found vs. not found)

| Component the brief asks about | Found? | Where |
|---|---|---|
| Agent session | Partial — `ExpressionSession` is a real per-turn-fold session object, but it's a pipeline session (holds `WorldState` + config), not an agent session with goals/memory-of-intent | `lib/expression/pipeline.ts` |
| Action manager | Not found as a distinct concept — no module chooses among discrete "actions" (draw/move/delete/connect) as first-class objects the way a tool-calling agent would | — |
| Tool system | Yes, but singular and external-facing only — one tool (`express_meaning`) for agents talking *to* InPublic; nothing internal to the Expression Engine is modeled as a tool the engine calls on itself | `lib/expression/tool.ts` |
| Todo/planning system | The word "plan" is heavily used (`planner/plan.ts`, `composition/plan.ts`, `clean/plan.ts`, `presentation/plan.ts`) but these are single-shot deterministic decision functions, not a multi-step task list an agent works through over time | `lib/expression/{planner,composition,clean,presentation}/plan.ts` |
| Review system | Yes — `evaluate/evaluate.ts` | see above |
| Continuation logic | Yes, at the discourse level — `compose.ts:isContinuation` decides patch-vs-full-redraw per turn, and `WorldState.seq`/`firstSeenSeq`/`lastTouchedSeq` give cross-turn continuity within a session | `compose/compose.ts`, `world/apply.ts` |
| Recovery | Only at the data layer (persistence conflict handling, see STATE_AND_PERSISTENCE.md), not at the reasoning/agent layer — no "if the last turn's plan was bad, retry differently next turn" mechanism beyond the single-turn repair loop | `app/api/projects/[id]/route.ts` (409 handling) |
| Retry logic | Present in the persistence layer (`lib/persist.ts` cloud-sync retry/backoff) and in `expressionAnticipation`'s rationed re-extraction, but not a general agent-level "retry the reasoning" mechanism | `lib/persist.ts`, `lib/expression/live.ts` |
| Error containment | Yes — the repair loop's keep-or-discard logic (only accept a repaired plan if strictly better) is itself an error-containment mechanism | `pipeline.ts:536-553` |

## Assessment

InPublic today implements what the product intent describes as an eventual
goal ("an AI that can genuinely inhabit and manipulate a visual workspace")
only partially, and the missing piece is specific and identifiable: **the
Expression Engine has no perception of the canvas it draws on.** It has a
memory (`WorldState`), a plan (`ExpressionPlan`/`ScenePlan`), a bounded
self-check (the repair loop), and a real external tool interface
(`express_meaning`) — genuine agent-shaped pieces. What it lacks is the
observe-the-environment step that would let it operate on a canvas a *human*
has also been editing, or recover from drift between its internal model and
what's actually on screen. This is a precise, falsifiable gap, not a vague
"needs more agent-iness" impression — see CANVAS_AUDIT.md's "How the AI sees
the canvas" section for the supporting trace.
