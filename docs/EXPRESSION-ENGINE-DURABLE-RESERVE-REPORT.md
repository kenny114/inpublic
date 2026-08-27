# Durable-anchor ranking inside the persist reserve

Feature freeze held: extraction, identity, references, lifecycle, metrics,
world importance, scene budget, rendering primitives, and the semantic
vocabulary are all unchanged. This pass touches exactly one thing —
how the 3-slot persist reserve in `lib/expression/planner/plan.ts`
(`attachRelatedEntities`) chooses WHICH standing-persist entities fill its
slots, when more standing items are eligible than there is room for.

## The failure

`PERSIST_RESERVE = 3` frees up to 3 of the 8 region slots for entities that
are visually "supporting" tier but haven't been mentioned recently
(`isStandingPersist`). Competition for those slots was resolved by
`rankEntity`, and for the supporting tier that function reduced to:

```
TIER_RANK.supporting - entity.lastTouchedSeq / 1000
```

Every standing-persist candidate has the same `TIER_RANK`, so the only thing
that decided who got a seat was **how recently it was last touched** — the
one signal `visibility.ts`'s own tiering already uses to keep the *working*
context alive. A durable decision from early in the meeting (`fix-step-four`)
and a durable decision from five minutes ago (pricing tier, hiring) are not
equally "recent" by construction, so the older one lost every time it competed
directly, regardless of how load-bearing it was. This is the gap the last
pass (`docs/EXPRESSION-ENGINE-VISIBILITY-REPORT.md`) flagged and left open.

## The fix

`lib/expression/planner/visibility.ts` gains `durabilityRank(entity, world)`
— a small, deterministic ordering over the *reasons* an entity is in the
persist tier at all, reusing signals `persistSticky` already computes rather
than adding anything new:

| Rank | Signal | Reading |
|---|---|---|
| 0 | `hasMetricSignal` (a stated target/threshold) | an active goal |
| 1 | `hasArchivedNeighbor` + action/object/concept | a decision or problem that outlived a rejected/superseded alternative — a surviving conclusion |
| 2 | action/event, no archived neighbour | a committed action / next step |
| 3 | object | weaker standing signal |
| 4 | bare concept | weakest |

`plan.ts`'s `rankEntity` now uses this, scaled to stay strictly inside the
supporting-tier band so it can never outrank the primary/supporting/
contextual ordering itself:

```
tier === "supporting"
  ? TIER_RANK.supporting + durabilityRank(entity, world) / 10 + prevBonus
  : TIER_RANK[tier] + prevBonus - entity.lastTouchedSeq / 1000   // unchanged
```

Working-context tiers (contextual/historical) are untouched — recency still
governs there, as the brief asked. Ties within a durability rank fall back to
array order, which is oldest-first, so two equally durable anchors resolve to
the older one rather than flapping.

This derives entirely from current semantic state, recomputed every round:
an entity loses its durability rank the instant the structural signal that
earned it is gone (its status turns archived, its neighbour is no longer
archived, its metric target is dropped), never on a turn-count decree.
Nothing is pinned — `durabilityRank` only breaks ties inside a pool that
`persistSticky`/`isStandingPersist` already gate.

One bug caught during this pass and fixed before landing: an unscaled
`durabilityRank` (0–4) could push a weak supporting-tier candidate's score
above a strong contextual candidate's, inverting the tier hierarchy the
whole system depends on. The `/10` scale keeps the perturbation inside the
supporting band only.

## Frozen 118-turn replay, same deltas, same identity report

| Metric | Before this pass | After |
|---|---|---|
| `fix-step-four` visible ratio (persist-kind heuristic) | 67% | **83%** |
| `fix-step-four` at 20min snapshot | omitted | omitted (unchanged — see below) |
| `fix-step-four` at close snapshot | omitted | **visible** |
| Mean stale-visible | 2.35 | **2.17** |
| Last-quarter visible retention | 0.738 | **0.779** |
| Mean visible retention | 0.826 | 0.822 |
| Visual-focus changes | 57 / 118 | 57 / 118 (unchanged — untouched code path) |
| "expression planner omitted an important concept" (41-check audit) | 14 | **13** |
| "supporting detail failed to collapse" | 2 | **1** |
| Scene object count | 10 at every snapshot | 10 (budget not touched) |

`fix-step-four` now survives to the close of the meeting, where the previous
pass explicitly left it losing. It still loses at the 20-minute mark: at that
point five standing-persist candidates tie at durability rank 2
(`fix-step-four`, `move-forward-with-15-tier`, `real-timeline`,
`affected-customers`, `activation` — all committed decisions/problems with no
archived neighbour of their own) and only one reserve slot is free, so the
oldest-first tie-break picks whichever of them has the lowest `firstSeenSeq`
— not always `fix-step-four` once several genuinely-tied decisions have
accumulated. This is a **capacity** limit (5 durable candidates, 1 free
slot), not a recency regression: nothing here is being evicted by a fresher
mention, the reserve is simply smaller than the set of things that now
legitimately qualify as durable at that point in the meeting. Raising
`PERSIST_RESERVE` would trade against the scene budget, which is out of
scope for this pass.

## Regression

Identity 13/13, reference 13/13, lifecycle 10/10, critical 9/9, offline
corpus 119/119 (984 checks) mean preservation 1.000 — byte-identical to
before this pass, as expected: nothing outside `attachRelatedEntities`'s
tie-break for the supporting tier changed.
