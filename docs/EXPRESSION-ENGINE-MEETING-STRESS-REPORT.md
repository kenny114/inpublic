# 30-minute five-speaker meeting stress replay

Real pipeline, real model calls (no hand-built deltas). Transcript:
[scripts/fixtures/meeting-transcript.mjs](../scripts/fixtures/meeting-transcript.mjs) (118 turns, 5 speakers,
0:00–28:45). Runner: [scripts/expression-meeting-stress-replay.mjs](../scripts/expression-meeting-stress-replay.mjs).
Full per-turn trace log and snapshots (WorldState/ExpressionPlan/ScenePlan/SVG) at 5, 10, 20 min:
`scripts/fixtures/.meeting-replay-out/`. The meeting's natural close landed at 28:45, before the
30-minute mark fired — the last turn's trace stands in for the 30-minute snapshot below.

No fixes were made in response to this replay's findings, per the brief. This is a measurement pass only.

## Headline

**IDENTITY resolution — the deterministic layer failing to recognize that "the rebuild," "full rebuild," and
"rebuild" (or "step four fix," "fix step four," and "step-four fix") name the same thing — is the dominant
degradation category.** It doesn't fail loudly; it fails by quietly minting a second entity, and that one failure
mode cascades into every other measurement below. Nothing downstream is misbehaving on its own — REFERENCE and
LIFECYCLE resolution are correctly abstaining rather than guessing wrong, and SALIENCE/COMPOSITION correctly holds
the canvas to a bounded, comprehensible object count. But both are working with a world that's 2–3x larger than it
should be, and that's where the semantic preservation score comes from.

## Measurements

| Metric | Result |
|---|---|
| Total entities created | 142 (140 still live) across 118 turns |
| Final scene object count | 10 (held constant at every snapshot — the composer's display budget) |
| Reference-mention resolution rate | 4/8 = 50% |
| Discourse-act (lifecycle) application rate | 11/23 = 48% |
| Canvas churn | 61 added, 17 updated, **68 moved**, 51 removed over 118 turns (0.58 moves/turn) |
| Visible-concept-vs-speech ratio | 0.45 (5 min) → 0.23 (10 min) → 0.11 (20 min) |
| Semantic preservation (engine's own evaluator) | 1.00 (turn 1) → ~0.38 (turn ~10) → ~0.22 (turn ~90) → 0.35 (final, after repair) |

## Category-by-category

### IDENTITY — dominant, root cause

By the 20-minute mark, 6 of 112 entities carry an exact-label-collision suffix (`step-four-fix-2`,
`step-four-fix-3`, `email-verification-step-2`, `rebuild-2`, `blog-post-2`, `affected-customers-2`) — cases where
the model reused the identical label and the resolver *still* minted a new entity. That's the visible tip; the
larger share of duplication is entities that got a *different* label for the same referent, which the resolver has
no way to catch by design (`resolveMention` matches on label/alias similarity, not meaning):

```
full-rebuild        (turn 5,  "rebuild it from scratch")
rebuild              (turn 47, "the rebuild")               <- distinct entity, same referent
fix-step-four        (turn 10, "fix step four")
step-four-fix        (turn 14, "step-four fix")              <- distinct entity, same referent
step-four-fix-2      (turn 40, exact re-label, still didn't match step-four-fix)
step-four-fix-3      (turn 41)
email-verification-step   (turn 18)
email-verification-step-2 (turn 19, one turn later, same conversation)
```

This is a conversational-speech problem this engine hasn't had to face before: prior fixture suites feed fairly
consistent phrasing per feature under test. A real 30-minute meeting has five people each naming the same idea
their own way, and `resolveMention`'s fuzzy-label matching isn't built to close that gap.

### REFERENCE — 50%, but zero *wrong* resolutions

All 4 failed reference mentions are `topic_recall` phrases whose `topicHint` doesn't textually match any stored
label ("the second pricing option Sam mentioned in the doc" → nothing named "annual discount" exists, because it
was never extracted as its own entity in the first place). Every one of them correctly returned `UNRESOLVED`
rather than attaching to the wrong thing — the "abstain rather than guess" design held under real speech. The 4
that succeeded were all exact label matches at `[high]` confidence. This is a downstream symptom of IDENTITY: the
target the speaker means usually does exist in the world, just under a different label than the recall phrase
implies.

### LIFECYCLE (discourse acts) — 48%, and one specific reproducible bug

Same abstain-don't-guess pattern as REFERENCE for most failures. But 8 of the 12 `UNAPPLIED` cases show an
oddly specific signature: the ambiguity is reported as being between the correct target and **"incident from
last week"** — an entity with no textual relationship to the utterance at all (e.g. reactivating "the growth
marketer role" reports ambiguity against "incident from last week," not against anything about hiring or
marketing):

```
DISCOURSE   reactivate -> UNAPPLIED  [low] (said: "the growth marketer role that was paused")
            ambiguous between "incident from last week" and "rebuild"
DISCOURSE   reactivate -> UNAPPLIED  [low] (said: "the growth marketer role that was paused a few weeks ago")
            ambiguous between "incident from last week" and "full rebuild"
```

"incident from last week" was the meeting's early primary-subject entity. This looks like a salience-based
candidate — not a textually-relevant one — leaking into the ambiguity check regardless of topic, which then forces
an abstain that a purely textual match would not have. Worth a follow-up look at the candidate-ranking function
behind discourse-act resolution (shared with reference resolution, per `references.ts`), specifically whether a
high-salience entity is always included as a candidate rather than only when it's textually plausible.

### SALIENCE / COMPOSITION — working as designed, but the design doesn't scale to this world size

Scene object count held flat at 10 across every snapshot — the bounded-canvas guarantee worked exactly as
intended, and every spot-checked snapshot (e.g. the 20-minute mark: usage-based pricing, the $15 tier, the billing
bug, Q4 planning, the parked topic) was genuinely on-topic for that point in the conversation, not garbage. The
cost is coverage: with a fixed object budget and a 140-entity world, the fraction of speech visible on canvas at
any moment necessarily shrinks as the meeting goes on (0.45 → 0.11), and the evaluator's own semantic-preservation
score reflects that (dropping to ~0.22–0.35). Some of that drop is real — a bounded canvas cannot show
everything ever said in a 30-minute meeting, and it shouldn't try to. But a meaningful share of it is inflated by
IDENTITY's duplicate entities competing for the same limited slots as the real ones.

### PROVENANCE, METRIC, LAYOUT, RENDERING, EXTRACTION-proper — no material findings

Provenance (`speakerId`/`timestamp`) attached correctly on every touched entity throughout, confirmed by spot
checks in the trace log. No metric-unit mixing or corruption occurred (fewer metrics were spoken here than in the
dedicated metric harness, but signups/activation/churn all merged cleanly). No SVG rendering failures. No layout
overlap issues observed in the snapshot SVGs. Per-utterance extraction was schema-valid and reasonable on every
single turn in isolation — the paraphrase-drift problem is a cross-turn *consistency* issue, not a per-turn
extraction-quality issue, which is why it's filed under IDENTITY rather than EXTRACTION.

## Bottom line

One evolving semantic world can follow a realistic, messy 30-minute conversation and end with a comprehensible,
on-topic visual — the canvas at every snapshot was legible and roughly right for its moment. What it cannot yet
do is stay a *single, non-duplicated* world once five people start naming the same three or four recurring things
in five different ways. Fixing IDENTITY resolution's tolerance for paraphrase (not just alias/exact-label
matching) is the one change most likely to move every other number in this report at once.
