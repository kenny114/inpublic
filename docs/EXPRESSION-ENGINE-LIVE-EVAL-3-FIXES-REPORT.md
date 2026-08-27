# Two fixes from live evaluation #3

Scope held to exactly the two named targets. Identity, reference resolution,
lifecycle semantics, metrics, scene budget, rendering primitives: untouched.
No new visual capabilities — the `relationship` grammar id, `REGION_BUDGET`,
and every rendering primitive are unchanged; only which entities a
low-confidence round is allowed to select changed. `classifyIntent`'s own
scoring (lib/expression/intent/classify.ts) is untouched — both fixes live
entirely in the planner/visibility layer, downstream of intent, per the
brief's framing of intent classification as the *diagnosis*, not necessarily
the *fix site*.

## Fix 1 — real elapsed-time-aware persistence

**Root cause, confirmed in eval #3**: `CURRENT_WINDOW`/`PERSIST_WINDOW`
(`lib/expression/planner/visibility.ts`) age entities by
`world.seq - entity.lastTouchedSeq` — ingested-turn count. A session left
idle for 40 real minutes with almost no intervening turns looks, to that
counter, like almost no time passed. `trying` was still inside a 36-turn
window 40 minutes and a full topic later because only a handful of turns
had actually been ingested in between.

**Fix**: entities already carry a real wall-clock signal that nothing had
to be added to get — `WorldEntity.provenance`, whose last entry (append-
ordered, oldest-evicted) has an optional `timestamp` taken from
`InputSegment.timestamp`. `lib/expression/live.ts` already stamps that with
`Date.now()` on every live segment (added the pass before this one, for
capture correlation). `visibility.ts` now reads it:

- `VisibilityOptions.nowMs` — the wall-clock time this round is being
  planned at, threaded from `segment.timestamp` through
  `PlanOptions.nowMs` (`plan.ts`) into every `assignVisibility` call in
  `pipeline.ts`. Absent by default.
- `hasGoneIdle(entity, nowMs)` — true only when `nowMs` is supplied AND the
  entity has a recorded touch timestamp AND the gap exceeds `IDLE_GAP_MS`
  (15 minutes). Any of those three conditions failing makes it `false`,
  which is the exact old behavior — this is why every fixture and test that
  never supplies a timestamp (which is all of them except the frozen
  meeting corpus, see below) is untouched.
- `persistSticky` now runs `hasGoneIdle` as a gate **after** its three
  durable-signal checks (`importance === "primary"`, a stated metric
  target, an archived-neighbor decision) and **before** its one age-based
  check (plain actionish/object within `PERSIST_WINDOW`). Durable
  understanding is checked first and returns unconditionally — a standing
  decision, an unresolved problem, or an active goal never reaches the
  idle gate at all, exactly matching "may remain durable across long idle
  gaps." An ordinary action/object whose only claim to persistence is "the
  turn window" is exactly the case the gate targets — "generic
  conversational entity / supporting detail should decay with wall-clock
  inactivity."
- The plain `age <= CURRENT_WINDOW` → `"contextual"` tier assignment gets
  the same treatment as a defensive second layer (an entity re-touched
  just before a long idle gap shouldn't ride a short recency window
  either), though `persistSticky`'s gate is what eval #3's reproduction
  actually turns on.

**World semantic state is untouched** — nothing here deletes an entity,
changes its status, or writes to anything but the derived visibility view
computed fresh every round. This is a visibility concern, per instruction.

**Frozen 118-turn benchmark: byte-identical.** The corpus fixtures never
supply a real timestamp (the offline test scripts don't pass one at all).
The one fixture that *does* carry a `timestamp` field — the frozen meeting
replay (`scripts/fixtures/meeting-transcript-deltas-v1.mjs`) — supplies it
in **seconds since the meeting started** (0 to ~1725), not epoch
milliseconds; `IDLE_GAP_MS` is 900,000. Every gap in that fixture, read as
milliseconds, is therefore under two seconds — the gate never fires, and
`primary-focus changes: 56/118`, `mean stale-visible: 2.19`, and the
13/12/7/5/1/1/1 concept-level failure distribution all reproduce exactly,
confirmed by re-running `expression-visibility-audit.mjs` after this fix.

**Regression**: `scripts/expression-idle-gap-test.mjs` — deterministic, no
real sleeps, wall-clock entirely simulated via `Provenance.timestamp`.
Topic A (two ordinary actions + one durable decision with a stated target)
at `T0`, topic B (one fresh entity) at `T0 + 40 minutes`. 9 checks: the two
ordinary topic-A entities lose persist-eligibility and fall to `historical`
tier; the durable decision keeps it; the fresh topic-B entity is eligible
immediately; a control run with no `nowMs` reproduces the untouched
turn-count behavior exactly (proving this is wall-clock-*gated*, not a
general expiry); and an end-to-end `planExpression` call confirms the
stale topic-A entities don't make it onto the fresh-topic plan. Verified
both directions: reverting the gate drops the suite to 5/9 with the exact
symptom (`review the budget` still `tier=supporting` after the gap).

## Fix 2 — a safe low-confidence intent fallback

**Root cause, confirmed in eval #3**: `express_uncertainty` is the intent
`classifyIntent` emits when nothing else scored higher — the classifier's
own priority list ranks it second-to-last, and its evidence
(`uncertain = hedged claims + low-confidence relations`) accumulates over
the *entire world*, monotonically, for the whole session. `GRAMMAR_FOR_INTENT.express_uncertainty`
maps to `relationship`, which selects its regions by **world importance**
— the same authority a confidently-classified grammar earns by actually
matching the utterance's structure, handed instead to the one intent that
exists purely because nothing else matched.

**Fix**: `lib/expression/planner/plan.ts`'s `weakConfidenceFallback`,
triggered when `intent.primary === "express_uncertainty"` — the smallest
trigger condition that targets the named bug precisely, leaving every other
intent's grammar selection untouched. It replaces both `firstUsable`
(grammar matching) and `attachRelatedEntities` (budget-filling) for that
one intent, so nothing downstream can refill the region budget from an
importance-ranked pool after it runs. Scope, enforced structurally rather
than by a threshold:

1. The resolved focus (if any) is kept.
2. Everything in `previousVisibleIds` is kept, filtered only by ordinary
   `canvasEligible` — "preserve the existing scene."
3. Only entities `newEntityIds` (this round's own `ADD_ENTITY` ops) are
   added on top — "add a newly created current entity."
4. A relation is drawn only when **both** endpoints are already in scope
   — "connect an explicitly extracted current relation," never a bridge to
   a third, unrelated entity.

No entity absent from both `previousVisibleIds` and `newEntityIds` can
appear, full stop — no importance ranking runs at all for this path. The
plan's `grammar` field stays `"relationship"` (no schema change, no new
`GrammarId`); only which entities `relationship` is populated with changed.
`reason` names the fallback explicitly (`"low-confidence fallback: kept N
existing, added M new — no importance-based reselection"`) — the
instrumentation the brief asked for (intent → reason → strength is already
on `ExpressionIntent`; fallback-chosen and candidate-scope are now
readable straight from `plan.reason`/`plan.regions` without a new field).

**Frozen 118-turn benchmark: byte-identical** (same audit re-run as above;
the corpus's own scripted content doesn't happen to trigger
`express_uncertainty` as primary intent, so this path is simply never
exercised there — confirmed rather than assumed by the unchanged output).

**Regression**: `scripts/expression-intent-fallback-test.mjs`, three parts.
(A) A hand-constructed `express_uncertainty` intent against a world with an
old, unrelated, high-degree entity cluster plus one fresh entity: the fresh
entity lands on the plan, the old cluster does not (it was never
previously visible). (A2) The same old entities, but already in
`previousVisibleIds`: they're kept — proving this is "preserve," not
"wipe everything not new." (B) The real pipeline end-to-end
(`ExpressionSession`, fixture deltas, no model): six consecutive rounds,
each hedged enough that every single one lands on `express_uncertainty`
(verified, not assumed), each introducing one small topic-B entity — all
six survive to the final plan, accumulated rather than rotating one-in/
one-out. This directly reproduces, and fixes, eval #3's exact "sacrifice →
patience → things still to do → ..." pattern in miniature. Verified both
directions: reverting the trigger drops the suite to 5/7, with the old
cluster pulled back in exactly as eval #3 showed.

## What "re-run the exact live-eval-3 replay" could and couldn't do here

Eval #3's session was a live mic recording, captured as the shallow
session-log export (transcript text and plan/patch summaries), not a
fixture of `MeaningDelta`s — there is no deterministic replay of it to
re-run, because reproducing it exactly would mean re-extracting the same
disfluent transcript through the real model and hoping for byte-identical
output, which the offline test suite deliberately never depends on for
anything. What *is* deterministic and re-run above: the frozen 118-turn
meeting corpus (unaffected, confirmed) and a purpose-built synthetic
idle-gap scenario reproducing eval #3's structural shape (a 40-minute gap,
ordinary vs. durable entities, a fresh topic) with exact assertions instead
of a read-through. A real capture (`inpublic.captureDownload()`) of a
session that reproduces eval #3's pattern would let the *actual* eval #3
turns be replayed against these fixes directly — still not available three
rounds running, noted rather than worked around.

## Regression summary

| Suite | Result |
|---|---|
| `expression-test.mjs` | 988/988 |
| `expression-idle-gap-test.mjs` (new) | 9/9 |
| `expression-intent-fallback-test.mjs` (new) | 7/7 |
| `expression-plan-reason-bound-test.mjs` | 4/4 |
| `expression-evaluator-test.mjs` | 33/33 |
| `expression-critical-replay.mjs` | 9/9 |
| `expression-identity-replay.mjs` | 13/13 |
| `expression-lifecycle-replay.mjs` | 10/10 |
| `expression-reference-replay.mjs` | 13/13 |
| `tsc --noEmit` | clean (one pre-existing, out-of-scope error in `resolveTarget.ts`, untouched) |
| 118-turn frozen meeting replay | byte-identical on every measured number, both fixes, confirmed by re-run not assumption |

Success criteria from the brief, checked against the above: unrelated old
supporting entities no longer dominate a fresh topic's first plan after a
40-minute gap (idle-gap test); durable cross-topic anchors survive when
justified (same test, the metric-target decision); weak/disfluent speech no
longer invokes a global importance-based `relationship` composition
(intent-fallback test, parts A/B); fresh-topic nodes accumulate across
consecutive uncertain turns (part B, 6/6 survived); no identity/reference/
lifecycle regressions (all four replay suites still fully passing); scene
budget unchanged (`REGION_BUDGET`/`ANNOTATION_BUDGET` untouched, and the
fallback explicitly caps at `REGION_BUDGET` using the same constant).
