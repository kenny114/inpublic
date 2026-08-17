# InPublic ASR / Domain Vocabulary Accuracy V1 Validation Report

## Result

Narrow pass. The proven `Aline` defect is fixed at the provider-hint layer.
No other vocabulary candidate was shipped because the six natural-session
exports contain transcripts but not their source audio, so an exact-audio
provider A/B cannot be run for those terms.

The only production vocabulary change is the addition of `Aline`. `Airline`
is retained because repository prompts, product examples, replay fixtures, and
tests consistently establish it as an intentional product/domain term.

## Current vocabulary architecture

The implemented path is:

1. PCM speech is streamed by `useDeepgram` to Deepgram Nova-3.
2. `keyterms()` builds an ordered, case-insensitively deduplicated list from
   current section titles, concepts, canvas marks, environment terms, and seed
   terms, capped at 40.
3. The hook passes each unweighted string through Deepgram's `keyterm` array
   when the socket opens. Terms discovered later do not reach Deepgram until a
   reconnect. No numeric boost/weight is used.
4. Deepgram emits raw interim and final transcripts.
5. `correctTranscript()` first applies seven narrow exact-pattern known-error
   mappings, then permits conservative phonetic repair only toward an active
   explicitly named seed/environment term.
6. Protected ordinary words block unsafe phonetic replacement. `Aline` is
   additionally provider-only: it may guide Deepgram but may not fuzzy-rewrite
   downstream text.
7. Final logs preserve `rawTranscript`, `normalizedTranscript`, and
   `displayTranscript`; the normalized/display values are identical after the
   conservative correction stage.

Phrases are already supported by the implementation as individual keyterm
strings (`AI agents`, `Affiliate Capital`, `Trinidad and Tobago`). Casing is
preserved in seed strings, while list deduplication and post-correction matching
are case-insensitive. Acronyms are plain strings; there is no acronym-specific
engine. `MLBB` is not currently seeded.

Terms that cannot be repaired later include protected ordinary single words,
terms not explicitly present in seed/environment vocabulary, and provider-only
`Aline`. Board text alone is contextual keyterm evidence but is not authority
for general fuzzy rewriting.

## Existing seed terms

After V1:

`Airline`, `Aline`, `AI agents`, `Affiliate Capital`, `InPublic`, `ClickLabs`,
`Excalidraw`, `Deepgram`, `Anthropic`, `Claude`, `Trinidad and Tobago`,
`Kenny Farmer`, `sketchnote`, `keyterm`, `agentic`, `LLM`.

No stale seed was proven. The broad historical list was not expanded with
speculative corpus terms.

## Aline / Airline finding

`Airline` is intentional. It is the product used throughout repository prompts,
README examples, organizer/reference tests, and historical replay fixtures.
Removing it would damage a real domain term.

`Aline` was missing even though the controlled corpus contains five utterances
of that proper name. On the same five audio files, repeated three times:

- pre-V1 production seeds: `Aline` 0/15;
- `Aline` keyterm: 15/15;
- both `Aline` and `Airline`: 15/15;
- actual `airline` wording in the two confusable controls: 6/6 preserved in
  every tested condition.

V1 therefore adds `Aline`, retains `Airline`, and keeps `airline` protected from
single-word post-repair. This is intentional: provider recognition solves the
measured defect, while fuzzy repair could hijack ordinary `a line` or the name
`Elaine`.

## Corpus-derived target terms

The six session identifiers below correspond to the six 2026-08-16 exports,
P1 through P6 in replay order.

| Term | Baseline output | Expected | Session/source region | Confidence | In scope? |
|---|---|---|---|---|---|
| Affiliate Capital | `Affiliate Capital` | Affiliate Capital | P1, 115677/123921 ms; P4, 112016/122605 ms | High | Yes, already correct/seeded |
| sales cycle | `sales cycle` | sales cycle | P1, 135309 ms | High | Yes, already correct |
| sales-cycle continuation | `make sales cycle salvo` | uncertain continuation after `sales cycle` | P4, 128320 ms | Low | No; ambiguous wording |
| MLBB | `MLB` once; `MLBB` twice | MLBB | P3, 12851 and 147079 ms | High from repeated neighboring gaming context | Candidate, not shipped without audio A/B |
| roamer | `roaming`, `room`, `Rome` | roamer / roaming role wording | P3, 12851-102465 ms | Medium-high from repeated MLBB role/tank/vision context | Candidate, not shipped without audio/negative controls |
| content | `conduct` once; `content` repeatedly elsewhere | possibly content | P6, 90288 ms | Low for the corrupt occurrence | No; generic and ambiguous |
| InPublic | `InPublic` throughout; narrow known-error repairs in two finals | InPublic | P1/P3/P5/P6 | High | Already working/seeded |

## Domain vs general ASR errors

Classification of important corruptions:

- A — domain vocabulary candidate: `Aline` (proven and shipped), `MLBB`
  (one miss, two correct), and `roamer` (repeated corruption but not safely
  testable from the retained artifacts).
- B — ordinary acoustic/ASR error: `I'm Patrick Williams`, `bad food`, generic
  pronoun/verb corruption, and most phone-story corruption.
- C — segmentation: none was reclassified as a vocabulary issue; V3 remains
  the frozen owner of thought boundaries.
- D — ambiguous: `creating conduct` and the word after `sales cycle` in
  `make sales cycle salvo`.

`Affiliate Capital`, `InPublic`, `AI agents`, and the later `MLBB` repetitions
show that already-correct terms do not justify more boosting.

## Candidate vocabulary

| Candidate | Decision | Evidence | Collateral risk |
|---|---|---|---|
| Aline | Ship | Exact-audio 0/15 to 15/15 | Confusion with `a line`, `Elaine`, `Airline`; mitigated by provider-only correction and controls |
| MLBB | Defer | 1 likely miss, 2 correct raw recognitions | Could force genuine `MLB`; natural source audio absent |
| roamer | Defer | Repeated `roaming`/`room`/`Rome` in one gaming session | Could hijack `roam`, `roaming`, `room`, `role`; natural source audio absent |
| Affiliate Capital | Keep existing | Four clear raw recognitions across two sessions | No new change justified |
| sales cycle | Do not add | One correct occurrence; one ambiguous continuation | Generic business phrase |
| content | Do not add | Many correct occurrences; one ambiguous `conduct` | High generic-word substitution risk |

## Same-audio A/B methodology

The changed term uses the existing reproducible benchmark in
`scripts/stt/aline.mjs` and the retained PCM files `p1`, `p7`, `p8`, `c1`, and
`c6`. Each file was streamed three times at production cadence. Model,
interims, formatting, endpointing, utterance-end timing, punctuation, VAD,
encoding, sample rate, channel count, and trailing-silence behavior remained
fixed; only keyterm state changed. Raw provider messages are retained in
`scripts/stt/results/aline.json`.

The six natural-session JSON files preserve 166 provider finals but do not
contain or reference retained audio bytes. Consequently, no claim is made that
`MLBB`, `roamer`, or the ambiguous sales-cycle region has passed a same-natural-
audio provider A/B.

## Target-term results

| Term | Baseline accuracy | New accuracy | Delta |
|---|---:|---:|---:|
| Aline | 0/15 | 15/15 | +100 percentage points |
| MLBB | 2/3 likely attempts | Not retested / unchanged | 0 shipped change |
| roamer | 0 clear canonical outputs in the natural log | Not retested / unchanged | 0 shipped change |
| Affiliate Capital | 4/4 clear occurrences | Not retested / unchanged | 0 shipped change |
| sales cycle | 2/2 phrase anchors recognized; one following word ambiguous | Not retested / unchanged | 0 shipped change |

## Negative controls

Provider benchmark:

- actual `airline` phrases remained correct 6/6 with both terms present;
- adding `Airline` alongside `Aline` did not reduce `Aline` accuracy (15/15).

Post-correction tests:

- `Please draw a line here` remains unchanged;
- `Elaine is on the call` remains unchanged;
- `Airline is on the board` remains unchanged;
- `Align the boxes` remains unchanged.

No generic word was added or boosted.

## Raw vs normalized improvements

For `Aline`, the improvement is layer A: Deepgram raw output changes from
variants such as `Align`/`a line` to `Aline`. Normalization and display preserve
the correct provider output verbatim. V1 intentionally does not implement a
layer-B/C fuzzy repair for this name.

Across the six retained natural logs, replaying all 166 raw finals through the
new correction vocabulary produced zero normalized/display changes because
none contains `Aline`.

## Final vocabulary changes

### Added: Aline

- Why: repeated proper name absent from production vocabulary.
- Evidence: exact-audio provider A/B, 0/15 to 15/15.
- Expected benefit: reliable recognition whenever the speaker uses this name.
- Risk: similar-sounding ordinary/name terms. Mitigated by provider-only
  correction and explicit controls.

### Retained: Airline

- Why: established intentional product/domain term.
- Evidence: repository-wide prompts, examples, replay fixtures, and tests;
  provider negative controls preserve actual airline wording.
- Risk: acoustic similarity to `Aline`; measured coexistence causes no loss in
  the controlled benchmark.

No term was removed. No post-provider known-error mapping was added.

## Six-session corpus replay

Transcript-layer replay covered all six exports and 166 provider finals:

- raw transcript changes: 0 (stored raw inputs are immutable);
- normalized/display transcript changes: 0;
- V3 output: 128 thoughts, all words preserved;
- premature thoughts: 0;
- over-combined thoughts: 0;
- maximum presentation unit: 32 words;
- candidate changes: 0, because semantic input text is byte-equivalent;
- visual commit changes: 0 for the same reason;
- newly corrupted structures: 0.

This is not a substitute for a new Deepgram pass over missing natural audio.
It establishes that the post-provider and downstream paths are unchanged.

## ASR-blocked structures recovered

None of the seven previously ASR-blocked structures contains `Aline`, so the
single justified vocabulary change cannot recover them. Classification:

- recovered: 0;
- partially recovered: 0;
- unchanged: 7;
- worse: 0.

The MLBB/roamer structure remains the clearest next domain-vocabulary candidate
once its natural audio is retained. The ambiguous `content` and sales-cycle
continuations remain unoptimized.

## New regressions

None found in the vocabulary scope. TypeScript compilation passed, 290 unit
checks passed, 48 live-presentation checks passed, 242 Visual Re-entry/Cause
Safety checks passed, and 40 product checks passed.

The repository-wide `npm test` command is not fully green because the existing
feature suite reports `directorV1 defaults off` while the already-modified
`lib/features.ts` currently sets that unrelated flag to `true`. This task did
not alter either side of that pre-existing mismatch.

## V3 integrity

The exact six-session V3 replay remains at 128 thoughts with zero premature
thoughts, zero over-combined thoughts, a 32-word maximum, and exact word
preservation. No boundary or interim code changed. Live ink behavior is
untouched.

## Cause Safety integrity

All exact natural-corpus false-positive regressions pass, including POST to
CREATE CONTENT, pricing/minutes question fragments, `SO IT'S LIKE`, and the
corrupted camera relation. No Cause/Effect false positive returned.

## Visual Re-entry integrity

All 242 deterministic candidate, evidence, grounding, rendering, ownership,
and Cause Safety checks pass. No family, camera, pagination, commit policy,
semantic context, or renderer changed. Model-call count is unchanged.

The new keyterm is fixed once at socket construction; microphone capture, PCM
cadence, transport, endpointing, replay pacing, and per-chunk processing are
unchanged. Therefore the change adds no live audio-path work and no measured
speech latency regression.

## Explicit answers

1. Vocabulary terms changed: added `Aline` only.
2. Was `Aline` added? Yes.
3. Was `Airline` retained or removed, and why? Retained; it is an intentional
   product/domain term and coexistence was safe in the exact-audio control.
4. Did MLBB recognition improve? No shipped change; it remains 2/3 likely
   attempts in the retained natural transcript.
5. Did roamer recognition improve? No; deferred pending exact-audio and
   collateral controls.
6. Did Affiliate Capital recognition improve? No change was needed; clear
   occurrences were already 4/4.
7. Did sales-cycle recognition improve? No; the phrase anchor was already
   recognized and the following corruption is ambiguous.
8. Did any generic words become worse? No observed or code-path change; no
   generic term was added.
9. How many of the seven ASR-blocked semantic structures improved? 0.
10. How many became fully usable? 0.
11. Did V3 segmentation regress? No.
12. Did any Cause/Effect false positive return? No.
13. Did visual candidate volume change materially? No; deterministic replay
    input and candidate volume are unchanged.
14. Did the vocabulary change affect live speech latency? No live-path work was
    added and no regression was measured.
15. Next highest-priority problem: retain exact natural audio for the
    MLBB/roamer regions and run the same-audio positive plus `MLB`/`room`/`roam`/
    `role` negative-control A/B before considering those two vocabulary terms.
