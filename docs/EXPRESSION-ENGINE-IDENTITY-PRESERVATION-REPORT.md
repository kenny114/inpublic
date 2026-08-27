# Option B — Identity / preservation

Chose **B** over perceived latency and visual-bar raising: the 118-turn freeze
was sitting at ~0.21 mean preservation because the same concept kept minting
new world ids (`full-rebuild-2`, `step-four-fix-3`, …). Duplicate nodes crowd
the region budget and tank the evaluator even when layout is stable.

No MCP/agents. Caption rail and overflow hysteresis untouched.

## What was wrong

1. **Live speech never ran the identity layer.** `ExpressionLiveController`
   constructed `ExpressionSession` with only `extract`/`contextWindow`, so
   `enableIdentityLayer` stayed off. The board used `resolveMention` only
   (exact label, proper-name subsumption, determiner+head). Phrase variants
   (`the rebuild` / `full rebuild`, `fix step four` / `step-four fix`) forked.
2. **Stage 1 was too timid without a judge.** Auto-merge needed score ≥ 85,
   a 25-point margin, *and* a second independent reason. In a long meeting
   every primary-topic entity was eligible (topic granted eligibility, not
   just a bonus), the candidate list filled with five neighbours, margin
   never cleared, the abstaining judge returned `hold`, and `hold` skipped
   `resolveMention` — minting `full-rebuild-2`.
3. **Hyphens and token order were identity-noise.** `email-verification-step`
   vs `email verification step`, `step four fix` vs `fix step four`.

## What changed

| File | Change |
|---|---|
| `lib/expression/world/identity.ts` | Hyphen-split tokens; phrase-head anaphora (`the rebuild` → `full rebuild`); token-set equality / shared 2-token core; description overlap as evidence; topic/relation/claim **bonus-only** (no longer grant eligibility); specific phrases and non-generic exact labels auto-merge with an 8-point margin |
| `lib/expression/live.ts` | Forward `enableIdentityLayer` / judges into the session |
| `components/Board.tsx` | Live controller: `enableIdentityLayer: true` (judge still abstains — no extra model on the live path) |
| `scripts/fixtures/identity-scenarios.mjs` | Three new fixtures: permutation, phrase-head, hyphen vs spaces |

The judge is **not** wired on `/try`. Stage 1 has to be good enough that
abstention is not a duplicate factory. Role-bridged type pairs (object vs
action for the same phrase) still go through the judge and will still split
when the judge abstains — that is the remaining residue below.

## 118-turn freeze (`meeting-transcript-deltas-v1.mjs`, judge off)

Same pipeline, same frozen deltas. Identity-off is `resolveMention` only.
Identity-on is this pass's stage 1.

| Metric | Identity off | This pass (identity on, abstain judge) |
|---|---|---|
| World entities | 121 | **107** (−14) |
| Live entities | 119 | **105** (−14) |
| Mean preservation | 0.148 | **0.366** (+0.218) |
| Last-quarter preservation | 0.152 | **0.216** |
| Stage-1 merges | — | 84 |
| Holds (still create) | — | 41 |
| Exact-label duplicate clusters | 3 | 7 |
| Suffix ids (`*-2`, `*-3`) | 4 | 10 |

Preservation more than doubled and the world shrank. The previous live-experience
freeze (identity on, old stage 1, abstain) was **0.21 mean** with **139**
entities; this pass is **0.366 / 107**.

Residual duplicates are almost all **cross-type** (object vs action `email
verification step`, concept vs action `rebuild`) or competing paraphrases
that still need the judge (`usage-based pricing` vs a later variant). Those
are the cases identity.ts still refuses to auto-merge.

Adversarial suite: **16/16** scenarios, including the three new ones, with
the false-merge guards intact (`the plan`, `the fix` after topic drift,
growth-marketer vs growth-in-signups, person/place Washington).

## /try speak check

Dev server `http://localhost:3000/try?v2=1&xe=1` returned **200**. No
microphone in this environment, so rail + pill + identity were not exercised
with live speech here. `tsc --noEmit` green; `expression-test.mjs` 1178/1178.

Human still owns the mic pass: speak a short chain that reuses a phrase
(`full rebuild` then `the rebuild`) and confirm one node, plus the pending
pill from the previous pass.
