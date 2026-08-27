# Long-horizon salience, compression, and visible-board stability

Identity, reference, and lifecycle are frozen. This pass audits, then
repairs, visible-board behaviour on the same 118-turn meeting. Extraction,
metrics, provenance, rendering primitives, and the scene budget were not
modified.

## Failure audit (before any fix)

Taken from the frozen 118 deltas with identity merges replayed from
`report-AFTER-target.json` (the 0-duplicate, 75% reference, 100% lifecycle
baseline). Full per-turn traces and snapshots at 5 / 10 / 20 min and close
via `scripts/expression-visibility-audit.mjs`.

The board did not become a better representation of the group's current
understanding. It also did not cycle. It **froze** on the densest early
cluster.

World importance is degree × 3 + recency. `fix-step-four` wins that race
by turn ~10 and never loses it. Intent focus is that world-primary.
Grammars organise around it. `attachRelatedEntities` fills the remaining
budget from its neighbourhood. Later decisions (`$15 tier`, incident fix,
growth marketer) are degree-0 or low-degree, so they score `detail` and
never enter the picture.

| Metric | Before |
|---|---|
| Last-quarter visible-object retention | **1.000** (identical 10 objects from ~10 min to 28:45) |
| Mean visible-object retention | 0.958 |
| Primary/visual-focus changes | 6 / 118 |
| Mean stale-visible | 4.16 |
| Mean important-but-hidden | 35.8 |
| `$15 tier` visible ratio | 0% |
| `free tier` visible ratio | 0% |
| `growth marketer role` visible ratio | 0% |
| Scene object count | 10 at every snapshot (budget held) |

Failure distribution across expected major concepts at the four snapshots
(41 checks):

| Class | Count |
|---|---|
| expression planner omitted an important concept | **14** (dominant) |
| ok-visible | 11 |
| ok-hidden | 7 |
| stale high importance, still visually competitive | 5 |
| supporting detail failed to collapse | 2 |
| extraction-absent | 1 |
| correctly in world but incorrectly low importance | 1 |

The 14 omissions are later decisions and problems the world already holds:
`$15 tier`, free-tier stays, incident / real timeline, affected customers,
growth marketer, NPS, mocks. They lose the budget to `rebuild`, `the number`,
`sends the code twice`, and `email verification` — the onboarding
neighbourhood of the degree-primary.

Snapshot boards, before:

- **5 min** — fix step four (good) + rebuild + race condition + "the number"
- **10 min** — same onboarding cluster, plus activation (good)
- **20 min** — still the onboarding cluster. Hiring and incident are the
  current conversation. Neither is on the canvas.
- **final** — still the onboarding cluster. The recap of four decisions is
  invisible.

Scene budget was not the problem. The 10 slots were occupied by the wrong
10 things, and they stopped changing.

## What changed

A derived **visual horizon** in `lib/expression/planner/visibility.ts`,
read only by the planner. World `importance` is untouched, so identity,
reference, and lifecycle keep the same scores they had.

Tiers, assigned every round from the world as it stands:

| Tier | Meaning | Canvas |
|---|---|---|
| primary | current visual focus (recency + new entities + persist, not graph degree) | organises the picture |
| supporting | standing decisions / measured problems / surviving conclusions | reserved slots |
| contextual | live and recent, not sticky | fills remaining budget |
| historical | live, old, not sticky, or the losing arm of a resolved branch | memory only |
| archived | suspended / rejected / superseded | memory only |

Policy, smallest that distinguishes those five:

1. **Focus follows the current topic**, with hysteresis so a passing
   topic-recall does not steal it. World-primary is no longer the grammar
   subject once the conversation has moved.
2. **Standing persist** (actions/objects still live, metrics with a target,
   world-primary, surviving conclusions next to an archived neighbour)
   keeps 3 of the existing 8 region slots even after a topic shift.
   `REGION_BUDGET` is unchanged.
3. **Losing alternatives collapse.** Same-era competing actions, or an
   explicit `contrasts_with` / shared decision claim against the structural
   primary, become historical and stop competing. Causal predecessors are
   not treated as losers.
4. **Archived status never competes.** Rejected "remove the free tier" and
   parked usage-based billing stay in the world and off the canvas.
5. A disconnected component is still seeded when it is persist, newly
   introduced this turn, or already visible — so the two-tree / bird-under-
   tree cases still draw. A passing recall of an old entity is not seeded.

## Frozen 118-turn replay, same deltas

| Metric | Before | After |
|---|---|---|
| Last-quarter visible retention | 1.000 | **0.738** |
| Mean visible retention | 0.958 | 0.826 |
| Visual-focus changes | 6 / 118 | **57 / 118** |
| Mean stale-visible | 4.16 | 2.35 |
| Mean additions / removals per turn | 0.37 / 0.31 | 1.38 / 1.32 |
| `$15 tier` visible ratio | 0% | **51%** |
| `free tier` visible ratio | 0% | **63%** |
| `growth marketer role` visible ratio | 0% | **88%** |
| rebuild on 20-min canvas | yes | **no** |
| usage-based / rejected free-tier removal on canvas | n/a / hidden | **hidden** |
| Scene object count | 10 | 10–11 (budget not raised) |
| World entity count | 108 | 108 (history intact) |

Snapshot boards, after:

- **5 min** — Priya's list, email verification, **fix step four**, seven-step
  signup / drop-off. Rebuild is off the canvas. Race-condition detail still
  hangs off the current email-verification work item.
- **10 min** — **Morgan's proposal**, pricing traffic, blog post, email
  verification as standing persist. "The number" collapsed. Activation is
  still missing at this exact snapshot (it is current-window, and the new
  pricing neighbourhood used the current cap).
- **20 min** — **hiring**, incident, **`$15 tier`**, **free tier**. Rebuild
  parked. Usage-based parked. This is the first snapshot that looks like
  the meeting that actually just happened.
- **final** — **NPS**, real timeline, mocks, **growth marketer**. Recap
  of the close, not a rerun of minute five.

The board now tracks the conversation and keeps recent standing decisions
underneath. It is no longer a frozen onboarding drawing. Semantic history
is still the full world (108 entities); only the visible layer compresses.

Remaining misses are mostly standing decisions older than the 3-slot persist
reserve (step-four fix at 20 min / close loses to more recently touched
pricing and hiring persist items) and a few supporting details of the
*current* topic that have not yet collapsed. Those are budget-ranking
issues inside the new policy, not a return of the freeze.

## Regression

Identity 13/13, reference 13/13, lifecycle 10/10, critical 9/9, offline
corpus 119/119 mean preservation 1.000. `enableIdentityLayer` still
defaults off. World importance, target resolution, and lifecycle status
transitions are byte-identical to the previous pass.
