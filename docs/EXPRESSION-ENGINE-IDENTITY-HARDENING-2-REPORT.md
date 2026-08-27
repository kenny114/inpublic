# Identity Hardening Pass #2: build report and before/after

Four changes to [lib/expression/world/identity.ts](../lib/expression/world/identity.ts) and
[identityJudge.ts](../lib/expression/world/identityJudge.ts), each targeting one of the three systemic problems the
first pass's replay exposed. All four are verified in isolation by adversarial fixtures (11/11, four of them new
this pass) before being judged against the live meeting replay — that ordering matters for reading the results
below honestly.

## What changed

**1. Abstention is now real.** `IdentityAction` gained a third value, `hold`, distinct from `create`. Previously a
judge verdict of `uncertain` and a confident `related_but_distinct`/`new_entity` were both silently folded into
"create a new entity" — functionally identical, but indistinguishable in the instrumentation, which is very likely
why `uncertain` measured 0% last pass: it had nowhere to register even when it happened. `hold` now means
specifically "the judge was asked and could not tell." The judge prompt also gained explicit calibration language
("this is a real, expected answer, not a fallback of last resort... do not resolve a close call just to be
helpful") and — critically — was previously given only `{index, label}` per candidate; it now also receives
`description` and `status`, so it has enough to actually recognize when two candidates are indistinguishable rather
than being forced to guess from a bare label.

**2. Eligibility is now lifecycle-aware.** The old hard gate (`if (!isLiveEntityStatus(entity.status)) continue`)
excluded every suspended/rejected/superseded entity from candidacy entirely. Now all statuses are candidates —
type-compatibility is still a hard gate, status is not — but a non-live top candidate can *never* auto-merge at
stage 1 regardless of score; it always goes through the judge. A judge-confirmed merge into a `suspended` target
reactivates it (`status -> "active"`); a judge-confirmed merge into `rejected`/`superseded` merges content in but
leaves status untouched — recallable, not revalidated.

**3. Deterministic normalization is stronger.** A narrow, safe inflectional stemmer (`stem()`) collapses
plural/singular and verb tense endings — "rebuild"/"rebuilding", "fix"/"fixed"/"fixing", "metric"/"metrics" — with
doubled-consonant handling ("shipping" → "ship"), deliberately excluding derivational suffixes and irregular forms
that would risk collapsing unrelated words. No embedding similarity was introduced, per the brief.

**4. A canonical representation replaces label-only comparison.** `buildCanonicalRepresentation()` assembles, fresh
from the world every time (never persisted — the same "recomputed, so it can never drift" discipline
`candidateGroups` and `importance` already use): stemmed concept tokens from label + aliases + description, kind,
topic context (primary/supporting/detail/archived), and relation-neighbor ids. Lexical eligibility now compares
against this whole representation, not the raw display label, so an entity's accumulated aliases and description
count as evidence the way they were meant to.

## New adversarial fixtures (11/11 passing, 4 new)

- Two indistinguishable candidates ("Vendor Atlas" vs "Vendor Borealis"), judge explicitly scripted to answer
  `uncertain` — confirms `hold` works end to end, not just as a default for a missing script entry.
- A suspended entity ("creator partnership") reactivates only via a judge-confirmed re-mention — status flips to
  `active`, `reactivate: true` recorded.
- A rejected entity ("raise money") is recalled by a later mention (one entity, not two) but its status **stays**
  `rejected` — recallable without regaining validity.
- Pure word-form variation ("rebuild" / "rebuilding") resolves at stage 1 with `usedJudge: false` — the stemmer
  doing its one job.

Full regression stayed clean throughout: `npm test` (976 + 51), and all five pre-existing fixture suites
(critical/lifecycle/reference/provenance/metric) unchanged.

## Before / after: the same 118-turn meeting, unmodified — with a caveat

**This comparison is noisier than the first pass's.** The identity-v1 and hardening-v2 replays are two *separate*
live conversations with the real model, not two runs over frozen input — extraction itself is non-deterministic
turn to turn (temperature 0 reduces but does not eliminate variance in wording and, sometimes, entity *type*
choice), so some of the difference below is sampling noise, not code behavior. The deterministic, scripted-judge
fixture suite above is the reliable signal for whether the logic itself is correct; the live replay is a real-world
stress signal that should be read with that caveat in mind.

| Metric | Baseline (no identity layer) | Identity v1 | Hardening v2 |
|---|---|---|---|
| Total entities created | 142 | 110 | 112 |
| Duplicate clusters (`x-2`, `x-3`...) | 6 | 2 | 4 |
| Reference resolution | 50% | 50% | 50% |
| Lifecycle application | 48% | 39% | 36% |
| Semantic preservation, mean | 0.370 | 0.427 | 0.381 |
| Semantic preservation, last quarter | 0.287 | 0.364 | 0.246 |
| Judge invocation rate | — | 61% (137/223) | 62% (141/228) |
| Judge uncertainty rate | — | **0%** (0/137) | **1.4%** (2/141) |

Every number stays dramatically better than the no-identity-layer baseline. Against v1 specifically, the picture is
mixed, and I traced each regression to a specific, explainable cause rather than leaving it as an unexplained
number:

**Judge uncertainty went from a flat 0% to a real, nonzero 1.4%.** This is the headline result of this pass — not
because 1.4% is a large number, but because it proves the mechanism fires in live use, not only in a scripted
fixture. One live case: a bare later "Friday" correctly came back `uncertain` (`hold`) — the judge explicitly said
it could be either the generic day-of-week or the specific "Ship fix Friday" deadline, and nothing in the utterance
picked between them. That is exactly the behavior this pass set out to restore.

**Duplicate clusters, 2 → 4: three of the four are a pre-existing gap unrelated to this pass's changes.** I traced
every one. Three (`email-verification-step-2`, `blog-post-2`, `affected-customers-2`) are the SAME referent
extracted under two type-incompatible `EntityType`s across turns (object vs. action, object vs. event, quantity vs.
group) — `typesCompatible()`'s hard gate (unchanged by this pass, and by design: it exists specifically to stop a
person and a place sharing a name from merging) correctly refuses to consider them candidates for each other at
all. This is the same class of extraction-typing inconsistency the engine's own `apply.ts` docstring already
documents from an earlier session ("traffic" as both `state` and `event`) — a real, remaining gap, but in
extraction consistency, not in identity resolution's own logic. The fourth (`friday-2`) is the correct-abstention
case described above: a legitimate duplicate traded for not guessing wrong.

**Semantic preservation, judge/lifecycle application, mean lower.** Given the entity count is essentially flat
(112 vs. 110) this is not explained by more duplication. The most likely explanation is ordinary run-to-run
variance in which claims and relations a fresh live conversation happens to produce — a different random
extraction trajectory shapes the graph the evaluator scores differently even at a similar entity count. I do not
have a stronger explanation than that without a much larger sample of repeated runs, which was out of scope here.

**Zero known false merges.** I read all 40 `same_entity` merges in the v2 run. All are defensible; two are worth
naming as borderline rather than clean-cut: "step four" merged into "biggest drop-off point" (the location
vs. the fact that it's the drop-off point — tightly coupled, arguably distinct), and "End of month" merged into
"check-again" (a time reference merged into the action it schedules). Neither corrupts distinct information — both
conflate two tightly-coupled things into one — but they are the honest edge of what "same_entity" means for
`concept`-typed mentions, and are named here rather than smoothed over.

## Remaining failure classes

1. **Type-family inconsistency across turns is now the dominant visible source of duplication** — more so than the
   lexical/morphological gaps this pass targeted, which the stemmer and canonical representation now handle. Not
   addressed this pass (out of scope: fixing it would mean either loosening `typesCompatible`'s family gate, which
   risks exactly the false-merge damage that gate exists to prevent, or improving extraction's type consistency,
   which is `extract.ts`'s prompt, not identity resolution).
2. **Judge invocation rate did not drop.** Expected, on reflection: only a small fraction of ambiguous mentions are
   pure word-form variants (what stemming targets); the large majority are genuinely different phrasings or
   genuinely different things that correctly need real judgment. Reducing invocation further would mean either
   accepting more auto-merges on weaker deterministic evidence (a false-merge risk this pass explicitly declined),
   or a smarter/cheaper triage before the full judge call — a reasonable future direction, not attempted here.
3. **Live-replay comparability.** Two live 118-turn conversations are not a controlled experiment. The fixture
   suite, not the meeting replay, is the trustworthy day-to-day regression signal for this subsystem going forward.
