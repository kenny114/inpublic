# Expression Engine V1 — gap analysis against the "meaning → persistent visual expression" spec

Companion to [EXPRESSION-ENGINE-V1.md](./EXPRESSION-ENGINE-V1.md). That doc describes what
`lib/expression/` is; this one answers a narrower question raised by a proposed V1 overhaul:
**how much of that overhaul is already built, and what's actually missing?**

Conclusion up front: most of it is already built. The task's non-negotiable architecture —
`speech → settled speech → semantic fold → persistent world model → expression planner →
semantic visual operations → deterministic compiler → canvas` — is not a proposal here, it's
the system that shipped on 2026-08-20. The two hard rules (renderer never interprets raw
transcript; LLM never emits coordinates) hold by construction, verified below. What's missing
is two specific, additive capabilities, not a new architecture.

## Method

1. Traced the live path end to end: `hooks/useDeepgram.ts` → `lib/liveSpeech.ts`
   (`pushPresentationSegment`, `SettledThought`) → `components/Board.tsx`
   (`handleSettledExpression`) → `lib/expression/live.ts` (`ExpressionLiveController`) →
   `lib/expression/pipeline.ts` (`ExpressionSession.ingest`) → `applyExpressionUpdate` →
   `lib/expression/render/excalidrawSync.ts`.
2. Read every stage's schema in `lib/expression/schemas.ts` (818 lines, the single source of
   truth for the whole chain) to check where geometry and raw text could leak in.
3. Wrote three new fixtures — [scripts/fixtures/critical-scenarios.mjs](../scripts/fixtures/critical-scenarios.mjs)
   — encoding this task's three critical test conversations (5-turn raise/bootstrap decision
   with reversal and a hypothetical reconsideration; the awareness→users→revenue causal chain;
   the traffic→activation correction), and replayed them turn-by-turn against the real
   `ExpressionSession` with [scripts/expression-critical-replay.mjs](../scripts/expression-critical-replay.mjs):

   ```bash
   node --no-warnings --import ./scripts/ts-register.mjs scripts/expression-critical-replay.mjs --verbose
   ```

   All 9 per-turn meaning-level expectations passed with zero new code.

## What already exists (verified, not assumed)

- **Persistent world model.** `WorldState` (`schemas.ts:338`) — typed entities/relations/claims,
  a recency-ordered `salience` stack, a monotonic `seq`. Held as instance state on
  `ExpressionSession` (`pipeline.ts:97`) and threaded through every turn — this *is* the
  semantic fold the task asks for, not an analogue of it.
- **The fold itself is deterministic, not a second LLM call.** `applyDelta()`
  (`lib/expression/world/apply.ts:388`) merges one `MeaningDelta` into the world: pronoun
  resolution via a type-compatible salience stack, proper-name subsumption, definite-anaphora
  matching, single-valued-relation replacement, contradiction retirement, importance
  recomputed every round from graph degree + recency (never taken from the extractor).
- **Rule 1 holds.** Raw transcript/`SettledThought.text` never reaches a renderer call. The
  only text on canvas is `SceneObject.label`/`SceneConnector.label`, computed in
  `compose.ts:labelFor()` from `entity.label` (an extracted 1–4 word noun phrase) or
  `claim.text` — both bounded, both already meaning, not transcript.
- **Rule 2 holds.** `schemas.ts:9-14` states the invariant explicitly and the schemas enforce
  it structurally: no `x`/`y`/`w`/`h` field exists on `MeaningDelta`, `ExpressionIntent`, or
  `ExpressionPlan` — only `SceneObjectSchema` (`schemas.ts:592`) has coordinates, and it's
  computed by `compose.ts`'s five deterministic layout routines, never by a model.
- **Reference resolution** for pronouns, proper names, and definite anaphora — the task's "that
  isn't the problem anymore", "she", "the company" cases — already implemented in `apply.ts`.
- **Corrections change the world, not the caption.** `supersededMentions` marks an entity
  `status: "superseded"` (never deleted); a `role_of` correction (brother→cousin) replaces
  rather than duplicates. Verified against the task's own Step 9 test structure.
- **Causal chains render as a spine**, not disconnected boxes — confirmed against this task's
  own "awareness/users/revenue" example turn-for-turn: one `cause_effect` grammar, one causal
  spine, both relations `readable` off the drawing.
- **Quantity as extent**, capped at 12 marks, never a numeral in a box.
- **Full instrumentation** — `ExpressionTrace` captures every stage; `formatTrace()`,
  `attributeFailure()`/`attributeContinuity()` name which of 12 ordered failure classes broke
  first; an existing offline replay corpus (`scripts/expression-discover.mjs`).
- **Source-agnostic input**, already. `InputSegment.source` (`schemas.ts:42`) is
  `"human_text" | "human_speech" | "ai_agent"` today — the agent-input milestone this task asks
  to "prepare for" already has a slot in the type, and `/dev/express` proves the engine runs
  with no microphone at all.
- **Incremental reconciliation.** Scenes are diffed (`diffScenes`), not redrawn; canvas elements
  are signature-matched in `excalidrawSync.ts` so an unchanged element is never touched.

## Confirmed gaps (empirically, via the new fixtures)

### 1. Hypothetical / low-confidence content has no visual treatment

Turn 4 of the decision scenario ("hypothetically, if someone offered us $500K, I'd reconsider")
correctly produces `confidence: "low"` entities and relations in the world — the meaning layer
already distinguishes hypothetical from committed. But their `SceneObject`s are
field-for-field identical to a normal object's (checked: `claimId`, `regionId`, `primitive`,
`sketchKey`, `count`, `weight`, `parentObjectId` — no difference). Nothing between
`WorldState.confidence` and the renderer currently reads that field. The task's dashed
hypothetical-region requirement (Step 6, Turn 4/5 of the critical test) has no attachment
point today.

**This is additive, not architectural.** The fold, the world, and the intent classifier
already know a thing is hypothetical — evaluate.ts even says so out loud
(`evaluate.ts:545-559`, "nothing in ScenePlan can currently say 'this is uncertain'"). The fix
is: thread confidence through `RegionSchema`/`SceneObjectSchema` as a style hint, and add a
composer treatment (dashed stroke, a labelled `hypothetical` grouping region) for low-confidence
regions.

### 2. De-emphasized entities disappear instead of staying visible-but-secondary

Turn 3 of the correction scenario ("Activation is the thing that's broken") correctly drops
`traffic`'s `importance` to `"detail"` in the world — it is *not* superseded, still `status:
"active"`. But the `describe`/`scene` grammar only ever plans a region for the single primary
subject with zero context regions, so traffic is removed from the canvas entirely
(`CANVAS +1 added, 0 updated, 0 moved, 1 removed`). The task's Test 3 expects both to stay
visible — traffic shown de-emphasized beside activation starred as primary.

**Also additive.** `grammars/index.ts`'s `scene` grammar needs to include non-primary
`importance: "supporting"`/`"detail"` entities as context regions (as `relationship` and
`cause_effect` already do), rather than only the focus entity.

### Not yet investigated (out of scope for this pass)

- Quantitative-series charts (multi-point comparisons like "traffic 200→500, conversion
  10%→4%") — no chart primitive exists; would currently fall through to extent-mark boxes.
- Ordinal/topic-recall reference resolution ("the second option", "go back to the pricing
  problem") — salience handles recency, not ordinal indexing or explicit topic recall by name.
- `Claim`'s `speakerId`/`timestamp`/`sourceSegmentIds` fields for multi-speaker readiness —
  schema not re-checked for these specific fields in this pass.

## Recommendation

Do not rewrite. Close gap #2 first (smaller, purely a grammar change — no new schema fields,
no renderer changes). Then close gap #1 (schema addition for a style hint + composer/render
treatment for dashed hypothetical regions), and re-run
`scripts/expression-critical-replay.mjs` as the regression gate — the `⚠ hypothetical gap`
warning it currently prints should disappear once #1 lands, and turn 3 of the correction
scenario should show both `traffic` and `activation` as scene objects once #2 lands.
