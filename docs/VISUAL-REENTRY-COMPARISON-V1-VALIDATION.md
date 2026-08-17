# Visual Re-entry Comparison V1 Validation Report

## Comparison schema

Added one strict `comparison` branch with exactly two distinct subject labels, one to four rows, row-level evidence, and whole-intent evidence. Each row requires at least one claim. The schema admits no coordinates, geometry, colors, scores, ranking, or model-selected layout.

## Candidate detection

The candidate gate requires explicit contrast syntax plus two stable subjects. It accepts conservative forms such as `while`, `whereas`, `on the other hand`, named subject/value clauses, and literal `X ... than Y` comparisons. `but` alone, two-topic prose, and bare co-occurrence fail closed.

## Subject extraction

Local parsing extracts exactly two named subjects and rejects empty, duplicate, unstable, or more-than-two-subject structures. One-letter option labels such as A/B are supported without weakening general stop-word handling.

## Contrast extraction

Claims retain literal spoken wording. Multi-claim clauses may produce uneven sides; claims are paired only when the utterance presents them as a contrast. No synthetic dimension is introduced.

## Multi-thought evidence

A comparison-only evidence window is bounded to the same page, 16 seconds, four thought fragments, and 720 characters. It can combine a stable opener with an explicit contrasting continuation and can briefly extend an uneven explicit comparison for a pronoun continuation. Other family windows are unchanged.

## Deterministic fast path

Clear, explicit comparisons are parsed locally. The matrix verifies Option A/B, Claude/Gemini, Plan A/B values, and relational `A is faster than B` with zero model calls.

## Haiku fallback

Fallback is available only after the conservative comparison gate establishes a real comparison but local alignment declines. A mocked replay verifies one hard diffuse comparison makes exactly one fallback call, validates against the strict schema, grounds, and commits. Ordinary two-topic prose never reaches fallback.

## Grounding

Both labels, every rendered claim, every row evidence span, and the overall comparison evidence must ground to source speech. One unsupported material claim rejects the entire visual.

## Mirror-inference prevention

`A is faster than B` renders only A's literal `faster than B` claim; it never manufactures `B is slower`. Tests also reject model output containing an unsupported inverse or an unstated winner.

## Uncertainty / negation / correction

Tentative, negated, and correction discourse fail closed when modality or the corrected state cannot be represented exactly. The system does not strengthen `might`, negate away `isn't`, or visualize an abandoned claim.

## Numeric comparison vs quantitative change

Named entity values (`Plan A costs 10 dollars and Plan B costs 20 dollars`) belong to comparison. Temporal change (`Price went from 10 dollars to 20 dollars`, last-year/this-year framing) remains `quantitative_change`.

## Family ownership

Ownership tests cover comparison against enumeration, quantitative change, sequence, and cause/effect. Each source is claimed at most once; no dual visual is emitted. A causal-parser guard also prevents explicit `first ... then ...` sequence language from being captured merely because a weak verb appears.

## Renderer

The renderer is deterministic and neutral: two labeled columns, a restrained rule/divider, and up to four uneven rows. It adds no checkmarks, X marks, good/bad color coding, score, winner, or inferred dimension. Identical input and placement produce byte-identical geometry.

## Capability replay

The 18.585-second deterministic fixture produced one combined comparison from three source fragments:

- Option A: `Cheaper`; `Faster to set up`
- Option B: `Costs more`; `Gives you more control`

Metrics: evidence opened/extended/completed `1/1/1`, candidates `1`, fast paths `1`, fallbacks `0`, grounding pass/fail `1/0`, commits `1`, rendered visuals `1`, quiet commits `1`, and page-turn losses `0`.

Deepgram provider diagnostics also observed: `I've also been testing Claude and Gemini. But I'm not comparing them right now.` That trailing region remained interim rather than becoming a settled V2 thought. It generated no additional comparison, no additional visual, and no model call. The explicit comparison itself settled normally.

Artifacts: `artifacts/visual-reentry-comparison-v1/comparison-capability-proof.wav`, `capability-replay-export.json`, and `replay-metrics.json`.

## Natural replay

The untouched 87.96-second benchmark produced 10 settled thoughts and zero comparison evidence windows, candidates, fallbacks, grounding attempts, or commits. The recording's `Compared to yesterday, today was a much better day` did not capture comparison ownership. The one committed visual remained the pre-existing quantitative-change fast path. Replay pacing stayed stable: interim lag p50/p95 `84/100 ms`, chunk-to-ink p50/p95 `14/76 ms`, schedule-error p95 `13 ms`, send lag at 87 seconds `2 ms`, with zero rebases and reconnects.

Artifact: `artifacts/visual-reentry-comparison-v1/natural-replay-export.json`.

## Model calls

Capability replay: `0` model calls; natural replay: `0`. Deterministic comparison share was `1/1 = 100%` of observed comparison candidates. The deterministic suite separately proves the guarded Haiku fallback remains functional.

## Candidate→durable latency

Capability deterministic comparison candidate-to-durable-ready p50 was `1 ms`; candidate-to-commit p50 was `3362 ms`, including the intentional quiet/durable hold. Natural benchmark's existing quantitative visual was `2 ms` to durable-ready and `5022 ms` to commit.

## Commit behavior

The capability comparison became durable once, was held once, and quiet-committed once. No duplicate ownership, stale result, page-turn invalidation, or second visual occurred.

## Camera/live-text integrity

The capability lifecycle recorded `cameraRequested: false` and `cameraSuppressed: true`. Protected V2 checks passed 20/20, and replay pacing/Deepgram code was not changed for this family. Live text continued during both recordings with no reconnect or rebase.

## Explicit answers

1. **Did explicit comparison render?** Yes—one grounded, two-column Option A/Option B comparison rendered and committed.
2. **Can comparison span multiple V2 thoughts?** Yes—the fixture combined three fragments, and the Claude/Gemini two-thought case passes deterministically.
3. **Did it require Haiku?** No. The explicit fixture used zero Haiku calls; fallback remains available only for gated hard syntax.
4. **Did the system invent any opposite/mirrored claim?** No.
5. **Did it invent a winner or ranking?** No.
6. **Did Plan A $10 vs Plan B $20 remain comparison rather than quantitative change?** Yes.
7. **Did temporal 10→20 remain quantitative change?** Yes.
8. **Did mere co-occurrence generate a comparison?** No.
9. **Did uncertainty or negation get visually strengthened?** No.
10. **Did enumeration/sequence/cause/quantity regress?** No in the targeted ownership matrix and protected checks. The full suite reaches the unrelated, pre-existing `directorV1 defaults off` feature-flag failure after all comparison/V2 tests pass.
11. **What percentage of comparison candidates were deterministic?** 100% in measured browser replays (`1/1`); the natural replay had no comparison candidates.
12. **What is the next most valuable missing expressive family?** Hierarchy/structure (for explicit parent-child or part-whole organization). It was not implemented.

## Verification

- `npm run typecheck`: passed.
- Protected Live Speech Presentation V2: 20/20 passed.
- Visual Re-entry matrix: 203/203 passed.
- Replay-lab deterministic checks: passed.
- Full `npm test`: all earlier suites and comparison checks passed; it ends at the unrelated existing `directorV1 defaults off` feature-flag assertion (17 passed, 1 failed in that final suite).
