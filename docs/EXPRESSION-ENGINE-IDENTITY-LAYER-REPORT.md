# Entity-identity layer: build report and before/after

A two-stage identity resolver — deterministic candidate retrieval, then a constrained model judgment for the
genuinely ambiguous zone — now runs before `apply.ts` creates or merges any world entity. Off by default
(`SessionOptions.enableIdentityLayer`); every existing fixture, test, and production call site is byte-identical
to before unless it explicitly opts in. The exact, unmodified 118-turn meeting transcript from the prior stress
report was replayed with it on and compared directly against the established baseline.

## Where it lives

- [lib/expression/world/identity.ts](../lib/expression/world/identity.ts) — stage 1 (`retrieveIdentityCandidates`,
  free, no network) and orchestration (`resolveEntityIdentity`). No model dependency, safe to import anywhere.
- [lib/expression/world/identityJudge.ts](../lib/expression/world/identityJudge.ts) — stage 2's real model call
  (`defaultIdentityJudge`), kept in its own file for the same reason `meaning/extract.ts` is separate from
  `pipeline.ts`: `pipeline.ts` is imported by a client component, so nothing that pulls in `../../llm` can live in
  a file it imports unconditionally.
- [lib/expression/world/apply.ts](../lib/expression/world/apply.ts) — `applyDelta` gained one optional trailing
  parameter (`identityDecisions`); absent, it behaves exactly as before.
- [lib/expression/pipeline.ts](../lib/expression/pipeline.ts) — runs the async pre-pass before `applyDelta` when
  `enableIdentityLayer` is on; records `identityResolutions` on the trace either way (empty when off).
- [lib/expression/trace.ts](../lib/expression/trace.ts) — one `IDENTITY` line per mention: candidates, score,
  judge verdict if invoked, action, resulting id.
- [scripts/fixtures/identity-scenarios.mjs](../scripts/fixtures/identity-scenarios.mjs) /
  [scripts/expression-identity-replay.mjs](../scripts/expression-identity-replay.mjs) — 7 adversarial scenarios,
  scripted (non-model) judge, no network — **7/7 passing**.

## How it decides

**Stage 1 (always runs, free).** Every live entity is a candidate only if some signal *other than recency*
supports it: exact label/alias, name containment, ≥34% content-word overlap, current primary topic, a shared
relation, a shared claim, or matching metric identity. Salience/recency never grant eligibility — only rank
already-eligible candidates and corroborate a decision. A candidate auto-merges without a model call only when its
score clears a high bar (85+, 25+ margin over the runner-up) **and** is corroborated by a second, independent
signal — a bare exact-label match on its own is not enough, because a short generic label ("the fix," "the plan")
can get reused for something genuinely different. A stated description that shares zero content words with the
candidate's own description is treated as active counter-evidence and vetoes auto-merge outright, regardless of
how many proximity signals agree.

**Stage 2 (only the ambiguous zone).** A small constrained model call chooses only among the candidates stage 1
already produced, by index — it cannot name an id of its own. Verdicts: `same_entity` (merges), `related_but_distinct`
/ `new_entity` / `uncertain` (all create). An unconfigured judge defaults to abstaining, so turning the layer on
without wiring a real judge still costs nothing and never merges wrong.

**Named bug fixed.** The stress report's "incident from last week" leak — a stale, once-salient entity becoming
eligible for unrelated ambiguity checks — traced to `references.ts`'s `rankEntitiesBySurface` counting *any*
shared word, including function words like "was" and "that," as topical evidence. Fixed with a stopword-filtered
`contentWords()` helper (now shared by both the new identity layer and the existing reference/discourse-act
matcher). Confirmed gone from the replay: zero occurrences in the new run, versus 8+ in the baseline.

**Two bugs my own adversarial fixtures caught before the meeting replay ran:**
1. "Exact match" and "≥34% lexical overlap" were being counted as two independent corroborating signals, when an
   exact match trivially satisfies both — the corroboration check was checking the same evidence twice. Fixed by
   making the two branches mutually exclusive.
2. Two speakers reusing an identical generic label for actively different things ("the plan" — redesign onboarding
   vs. cut pricing) still auto-merged, because topic-primary and recency bonuses fire for *any* immediate
   re-mention regardless of content. Fixed with the description-conflict veto described above.

## Before / after: the same 118-turn meeting, unmodified

| Metric | Baseline | With identity layer | Change |
|---|---|---|---|
| Total entities created | 142 | 110 | **−22.5%** |
| Final live entities | 140 | 108 | **−22.9%** |
| Exact-label duplicate clusters (`x-2`, `x-3`...) | 6 | 2 | **−67%** |
| Reference resolution | 4/8 = 50% | 4/8 = 50% | unchanged |
| Lifecycle (discourse-act) application | 11/23 = 48% | 9/23 = 39% | −9pp (see below) |
| Semantic preservation, mean | 0.370 | 0.427 | **+15%** |
| Semantic preservation, last quarter | 0.287 | 0.364 | **+27%** |
| Scene object count (every snapshot) | 10 | 10 | unchanged (by design) |

Identity-layer instrumentation for the replay: 223 mentions total, 110 created / 113 reused. 137 mentions (61%)
needed stage 2; of those, 45 came back `same_entity`, 22 `related_but_distinct`, 70 `new_entity`, and — notably —
**0 `uncertain`**. The real model always committed to a specific verdict rather than declining to judge; it never
needed to fall back on the engine's own "abstain" default during this run. No false merge was found on inspection
of the merge decisions in the log.

**Why lifecycle application went down, not up.** The "incident from last week" bug is confirmed fixed, but a
*different*, out-of-scope weakness in `rankEntitiesBySurface` remains: coincidental CONTENT-word overlap (not
function words) still produces topically-irrelevant candidates for discourse-act target resolution — e.g.
"the growth marketer role" showing "Signups" as an ambiguous competing candidate. That mechanism was not part of
this pass's brief and was left untouched. Separately, cleaner identity means "full rebuild" and "rebuild" are now
correctly recognized as two *legitimately distinct, competing* candidates in some turns rather than one or the
other winning by coincidence — triggering a correct abstain where the baseline's messier world happened to produce
a decisive (not necessarily correct) match. A lower applied-count is not proof of a regression; it is largely the
visible cost of removing false confidence elsewhere in a subsystem this pass did not touch.

## Remaining identity failure classes

1. **Suspended entities are invisible to ordinary re-mention, by design — and stay invisible.** A `suspend`
   discourse act correctly removes an entity from stage 1's candidate pool (only an explicit `topic_recall` or
   `reactivate` should revive something the speaker set aside). But when the group later brings the same idea back
   with an ordinary mention rather than "let's reconsider X" phrasing, the identity layer correctly can't find the
   suspended original, creates a new entity for it, and the two never reconcile — this is the direct cause of the
   `full-rebuild` (suspended) / `rebuild` (new) split still visible in the after-run. The system is not wrong to
   protect against silently reviving a rejected idea; it simply has no mechanism yet for "this new mention is the
   comeback of that suspended thing," short of the speaker phrasing it as an explicit recall.
2. **Topical noise in `rankEntitiesBySurface` beyond stopwords**, described above — genuine content-word
   coincidence still produces spurious discourse-act/reference candidates. In scope for a future pass, not this one.
3. **Word-form variation** ("rebuild" vs. "rebuilding") still falls outside stage 1's lexical-overlap check (no
   stemming), correctly escalating to the judge every time rather than ever auto-merging on its own — by design,
   not a defect, but worth knowing it always costs a model call.

## Regression safety

`enableIdentityLayer` defaults to `false`; `apply.ts`'s `identityDecisions` parameter defaults to `undefined`,
reproducing prior behavior exactly. Full `npm test` (976 + 51 checks) and all five pre-existing fixture suites
(critical 9/9, lifecycle 8/8, reference 11/11, provenance 8/8, metric 11/11) pass unchanged. The one unconditional
change — the stopword fix in `rankEntitiesBySurface` — altered no existing fixture's asserted outcome.
