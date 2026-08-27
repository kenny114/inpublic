# Target resolution substrate: failure audit and after-fix frozen replay

Identity is frozen. Duplicate clusters on the frozen 118-turn meeting are 0.
This pass audits, then repairs, the remaining reference and lifecycle
abstentions. Identity, composition, rendering, salience, metrics, visual
grammar, MCP, and meeting UI were not modified.

## Failure audit (before any fix)

Taken from the frozen 118 deltas and the type-reconciliation live replay
(`report-live.json`: refs 2/8 = 25%, discourse 6/13 = 46.2%). Full candidate
lists reconstructed by replaying with that run's recorded identity merges.

13 unsuccessful pointers. Dominant class: **correct target present but ranking
tie/ambiguity** (10/13). The matcher was label Jaccard plus a flat 40 for any
shared claim word. Extra words in the pointer diluted the real target;
one coincidental claim word (`discussion`, `growth`, `weeks`) promoted an
unrelated neighbor to the same score. A 25-point margin then forced abstention.

| # | Turn | Pointer | Expected | Existed | Status | Why it failed | Class |
|---|---|---|---|---|---|---|---|
| R1 | 31 | `topic_recall` "step-four problem" | biggest drop-off point | yes, active | hyphen `step-four` ≠ alias `step four`; claim-40s tied | retrieval miss → ranking |
| R2 | 37 | `topic_recall` "the rebuild" / Priya | rebuild | yes | **resolved** (baseline) | — |
| R3 | 38 | `topic_recall` "rebuild" | rebuild | yes | **resolved** (baseline) | — |
| R4 | 60 | `topic_recall` "annual discount pricing" (speech is ordinal) | annual discount | **no** | off-meeting doc; never extracted as an entity | ordinal/group + extraction-absent |
| R5 | 61 | same | annual discount | **no** | prior unresolved skip meant it still never entered the world | same |
| R6 | 76 | `topic_recall` "step-four onboarding issue" | biggest drop-off point | yes | 40–40 claim tie vs seven-step signup | ranking tie |
| R7 | 78 | `topic_recall` "usage-based pricing" | usage-based billing | yes | `usage-based` kept as one token; `pricing` tied with the generic | ranking tie |
| R8 | 79 | same | usage-based billing | yes | same | ranking tie |
| D1 | 13 | `suspend` "the full rebuild" | rebuild | yes | **applied** (baseline) | — |
| D2 | 27 | `invalidate` activation 25% | claim | yes | **applied** (baseline) | — |
| D3 | 39 | `reactivate` "the rebuild" | rebuild | yes | **applied** (baseline) | — |
| D4 | 51 | `invalidate` tiers/conversion | claim | yes | **applied** (baseline) | — |
| D5 | 56 | `reject` "removing the free tier" | revisit the free tier | yes | 53–53 vs the product `free tier` | ranking tie (parent/child) |
| D6 | 79 | `suspend` "discussion of usage-based pricing" | usage-based billing | yes | `discussion` claimed onto "incident from last week" | ranking tie |
| D7 | 80 | `reactivate` "usage-based pricing discussion" | usage-based billing | yes | same incident leak | ranking tie |
| D8 | 82 | `suspend` same | usage-based billing | yes | same | ranking tie |
| D9 | 92 | `reactivate` "growth marketer role that was paused" | growth marketer role | yes | 60 vs Signups-via-claim 40, margin 20 | ranking tie |
| D10 | 93 | `reactivate` longer surface | growth marketer role | yes | extra words diluted Jaccard below the claim-40s | ranking tie |
| D11 | 94 | same | growth marketer role | yes | same | ranking tie |
| D12 | 104 | `suspend` "usage-based billing" | usage-based billing | yes | **applied** (baseline) | — |
| D13 | 108 | `invalidate` rebuild parked | claim | yes | **applied** (baseline) | — |

Distribution of the 13 failures:

- correct target present but ranking tie/ambiguity: **10**
- ordinal / target absent from world (annual discount in a doc): **2**
- correct target absent from candidate retrieval (hyphen vs alias): **1** (same mechanism as ranking)

Dominant class is candidate retrieval/ranking, not missing extraction. The
resolver is rewritten; the extraction contract is left alone.

## What changed

Shared substrate in `lib/expression/world/resolveTarget.ts`, used by topic
recall (`references.ts`) and discourse-act targets (`apply.ts`):

- hyphen-split + stemmed lexical/alias evidence (so `step-four` matches `step four`)
- claim overlap scaled by hint coverage and capped at 55 (so one shared word
  cannot tie an exact label match)
- ranking bonuses — topic, recency, neighborhood, lifecycle — only on already
  lexical matches, never as eligibility
- speaker boost only on lexical evidence, not claim-only hits
- exact label match wins against a partial sibling (`usage-based billing` vs
  `usage-based pricing`)
- parent/child label-subset (`free tier` ⊂ `revisit the free tier`): never
  auto-picks the parent. If the pointer carries a verb and the child is an
  action, pick the child; otherwise abstain. A live judge is **not** asked —
  it previously rejected the product.

Optional constrained target judge (`targetJudge.ts`): candidate indices only,
verdicts `resolved` | `uncertain`, never a world id. Wired through
`SessionOptions.targetJudge` the same way identity is. Defaults to abstain.

## Frozen 118-turn replay, same deltas

| Metric | Baseline (type-reconciliation) | After |
|---|---|---|
| Duplicate clusters | 0 | **0** |
| Reference resolution | 2/8 = 25% | **6/8 = 75%** |
| Lifecycle application | 6/13 = 46.2% | **13/13 = 100%** |
| Incorrect target mutations | 0 known | **0 known** (see below) |
| Abstentions | 6 refs + 7 acts | **2 refs + 0 acts** |
| Semantic preservation, mean | 0.414 | 0.409 |
| Semantic preservation, last quarter | 0.245 | 0.264 |
| Final entities | 98 | 97 |

The two remaining unresolved references are the annual-discount pair. That
option was mentioned as existing in a doc, never as a world entity. The
target judge returned `uncertain` both times rather than attaching to
"last pricing test" / "effect of more tiers". That is a correct abstention.

Lifecycle: "forget removing the free tier" now rejects `revisit the free
tier` (the proposal) and leaves the `free tier` product active. Usage-based
park/reactivate cycles all land on `usage-based billing`. The three
growth-marketer reactivates land on `growth marketer role`, not Signups.

Two step-four *recalls* attach to `fix step four` (the decided remedy,
currently primary) rather than `biggest drop-off point` (the problem
entity). They are tightly coupled, not two competing ideas; they are named
here rather than counted as wrong mutations. Forcing them onto the problem
entity would need a different signal than ranking currently has.

An earlier live run of this pass let the target judge reject the free-tier
*product* on the parent/child case. That is the wrong mutation this
substrate exists to prevent. The judge is no longer consulted for
label-subset ties; the deterministic child-action rule handles that one
case, and the fixture now asserts both sides.

## Regression

`enableIdentityLayer` still defaults off. Target judge defaults to abstain.
Existing suites: identity 13/13, reference 13/13 (two new), lifecycle 10/10
(two new), provenance 8/8, metric 11/11, critical 9/9.
