# Fresh Natural MLBB / Roamer Exact-PCM A/B V1

## Session integrity

Session `e7a76c03-3248-4a0f-a183-eb41fc8a5304` passed the retained-audio contract. The sidecar and session export agree on `audio-worklet-pcm16`, `linear16`, 48,000 Hz, mono, 16-bit, 5,337,600 samples, 111,200 ms, 1,390 chunks, 1,334 sent chunks, 56 unsent startup chunks, `truncated: false`, and `formatMismatch: false`. The WAV contains 10,675,200 PCM bytes and has SHA-256 `346A956869936585B2344BE262A85BC99A80ABD398B6DA11DC84F8D86117A008`.

The two transport epochs reconcile exactly: 215,040 samples in 56 retained-but-unsent startup chunks plus 5,122,560 samples in 1,334 sent chunks equals the full 5,337,600-sample WAV. The MP4 soundtrack was not used for provider A/B.

Provider conditions were frozen at Nova-3, `interim_results`, `smart_format`, endpointing 150 ms, utterance end 1,000 ms, punctuation and VAD enabled, linear16, and 80 ms replay cadence. Three repetitions were run per clip and condition.

## Verified MLBB ground-truth clips

| Clip | Expected | Baseline raw (all 3 runs) | Sample range |
|---|---|---|---:|
| mlbb-positive-1 | MLBB is a five v five game | `MLBB is a five v five game.` | 226080–409920 |
| mlbb-positive-2 | But MLBB is really a simple, complex MOBA game | `But MLD is really a simple, complex, small area.` | 3097440–3242400 |
| mlbb-positive-3 | I really like MLBB for its complexity | `I didn't like him at before its complexity. While` | 3242400–3359520 |
| mlbb-positive-4 | But MLBB is a really nice game | `And the BBs are really nice game on` | 4098240–4192320 |
| mlbb-positive-5 | Some people play MLBB like their life depends on it | `Some people play at some people play in the beauty for the night, like, lives depended.` | 4862400–5028000 |
| mlbb-positive-6 | MLBB is really a nice game | `You know, is really a nice thing.` | 5093280–5177280 |

## MLBB baseline accuracy

Baseline recognized MLBB in 1/6 verified occurrences. Across repetitions this was 3/18 exact-term successes. `MLB`, `MLD`, `the BBs`, `in the beauty`, and missing tokens were scored wrong.

## MLBB candidate A/B

| Clip | Baseline R1 / R2 / R3 | `+MLBB` R1 / R2 / R3 |
|---|---|---|
| 1 | `MLBB is a five v five game.` ×3 | `MLBB is a five v five game.` ×3 |
| 2 | `But MLD is really a simple, complex, small area.` ×3 | `But MLBB is really a simple, complex, small area.` ×3 |
| 3 | `I didn't like him at before its complexity. While` ×3 | `I didn't like MLBB for its complexity. While` ×3 |
| 4 | `And the BBs are really nice game on` ×3 | `And the BBs are really nice game on` ×3 |
| 5 | `Some people play at some people play in the beauty for the night, like, lives depended.` ×3 | `Some people play at some people play MLBB for their life, like, lives depended.` ×3 |
| 6 | `You know, is really a nice thing.` ×3 | `MLBB is really a nice thing.` ×3 |

The candidate recognized 5/6 verified occurrences, or 15/18 repetitions. Every clip was deterministic across its three identical-PCM runs. Normalized and display text equalled raw text in every row; MLBB is deliberately provider-only and was not manufactured by correction. Mean clip WER improved or stayed equal on every clip; clip 4 was unchanged.

## Verified roam / roamer clips

| Clip | Expected | Baseline raw (all 3 runs) | Sample range |
|---|---|---|---:|
| roam-positive-1 | I was a roam slash gold laner | `Was a robot room slash colander` | 3478080–3588480 |
| roamers-positive-1 | one of the best roamers slash gold laners in Trinidad and Tobago | `I would consider myself one of the best. We're gonna start school in that engineer. Like to be able would consider myself that, but` | 3842400–4098240 |

The uninterrupted whole-session baseline did retain singular `roam` in `a robot roam slash koalena`; the isolated same-PCM clip produced `room`. This is context sensitivity, not a natural `room` negative.

## Roamer baseline and candidate A/B

| Clip | Baseline R1 / R2 / R3 | `+roamer` R1 / R2 / R3 | `+MLBB roamer` R1 / R2 / R3 |
|---|---|---|---|
| singular roam | `Was a robot room slash colander` ×3 | `Was a robot roam slash colander` ×3 | `Was a robot roam slash colander` ×3 |
| plural roamers | long corrupted phrase above ×3 | unchanged ×3 | unchanged ×3 |

The candidate repaired the isolated singular `roam` token without forcing it to `roamer`, but it recovered the actual plural `roamers` target 0/3. Gold laner remained wrong in both clips and all arms. The contextual phrase offered no benefit beyond plain `roamer`.

## Negative controls available

No genuine phonetic negative control was present. Genuine singular `roam` is a related positive morphology case, not a negative. Raw-provider `MLB`/`MLD`, `room`, and similar outputs on intended domain words are positive-case failures, not controls.

## Negative controls still missing

No natural spoken `MLB`, `room`, `role`, or `roaming` occurrence was found. A second recording is needed before making a stronger roamer decision or measuring those hijack risks. It is not needed for the MLBB positive-case shipping decision.

## Surrounding transcript regressions

No MLBB clip worsened by surrounding WER. Four failing clips improved, one already-correct clip stayed correct, and one clip stayed wrong. The candidate did not fix unrelated MOBA/game, gold-laner, picking, or drafting errors, and no extra vocabulary was added for them. `roamer` modestly improved the singular clip WER (0.714 to 0.571) but did not improve the plural clip (1.0 in all arms).

## Final vocabulary decision

- MLBB: **SHIP**
- Roamer: **DO NOT SHIP**
- Contextual MLBB-roamer phrase: **DO NOT USE**

## Changes made

`MLBB` was added immediately after `Aline` in the seed terms. It was added to the provider-only guard so fuzzy downstream correction cannot create MLBB. Roamer was not added. No model, endpointing, V3, semantic, Visual Re-entry, cause-safety, camera, or transport setting changed.

The replay helper's fixed 60-second timeout was also changed to scale with input duration plus finalization overhead; this is required to replay the full 111.2-second session and does not affect production streaming configuration.

## Full-session transcript impact

The full-session baseline recognized 1/6 MLBB occurrences. Its domain failures included `MLB`, `MLB before`, `maybe`, `in the beauty`, and `NLBD`. With the accepted seed it recognized 5/6: the initial occurrence remained correct; the simple/complex, complexity, life-depends, and closing-game occurrences became `MLBB`; the short `maybe`/`the BBs` occurrence remained wrong.

Key full-session raw change:

```text
BASELINE: ... but MLB is really a simple, complex, small idea. Really like MLB before its complexity. ... Some people play in the beauty ... NLBD is really a nice game.
NEW:      ... but MLBB is really a simple, complex, small idea. Really like MLBB for its complexity. ... Some people play MLBB ... MLBB is really a nice game.
```

The session is materially more understandable in repeated MLBB sections, though broad unrelated ASR corruption remains.

## V3 integrity

An offline V3 replay over the session finals preserved every input word in both conditions. The improved transcript yielded 21 coherent thoughts versus 22 baseline fragments because one previously fragmented MLBB passage joined at a corrected sentence boundary. No speech was lost.

## Cause Safety integrity

Both replay conditions produced zero visual candidates, zero candidate acceptances, and therefore zero durable or quiet commits. The 242-check Visual Re-entry suite, including the natural-corpus cause/effect false-positive matrix, passed.

## Visual Re-entry impact

Baseline session evidence had 22 thought-received and 22 candidate-rejected events, with no commits. Re-evaluating improved V3 thoughts yielded 21/21 candidate rejections, again with no commits. The vocabulary improvement changed legibility, not visual semantics.

## Exact-audio retention real-session overhead

- Copy timing: p50 0 ms, p95 0.1 ms, max 0.4 ms.
- WebSocket buffered amount: p50/p95/max 7,680 bytes, exactly one 80 ms 48 kHz mono PCM16 chunk.
- Retention: all 1,390 chunks and 5,337,600 samples preserved; no truncation or format mismatch.
- Speech-stream chunk-gap summary: session latency event p50 110 ms, p95 126 ms, max 130 ms; per-final maxima reached 132 ms. These timing gaps did not create corpus sample loss.
- Rendering/paint: render p50 1 ms; paint p50 16 ms and p95 24 ms in the session latency summary.
- Four long tasks (85, 141, 142, and 226 ms) were logged at `t=0`, attribution unknown, before the measured speech timeline. They cannot be causally assigned to retention.

Passive exact-PCM retention appears operationally safe in this real session. Provider backlog/final-lag and stale-audio-derived fields were not used as causal retention metrics.

## Explicit answers

1. Six verified MLBB occurrences exist.
2. Baseline recognized 1/6 occurrences (3/18 repeated attempts).
3. The MLBB candidate recognized 5/6 occurrences (15/18 repeated attempts).
4. Yes. Every clip/arm produced identical raw text across three runs; the gain was stable.
5. One genuine singular `roam` occurrence exists.
6. One genuine plural `roamers` occurrence exists.
7. Isolated baseline produced `room` for singular roam and a long corrupted phrase with no roamers/gold-laner recovery for plural roamers. Whole-session baseline retained singular `roam` but still corrupted its context.
8. It improves the isolated singular `roam` case, but does not improve the genuine `roamers` case.
9. No. It preserved the intended singular morphology as `roam`; it did not force `roamer`.
10. None of the requested phonetic negatives were genuinely present.
11. Natural `MLB`, `room`, `role`, and `roaming` controls are missing.
12. Yes, MLBB should ship.
13. No, roamer should not ship on this evidence.
14. Yes. Full-session MLBB accuracy improved materially from 1/6 to 5/6.
15. No semantic or visual regression was found; both paths produced zero candidates/commits and all scoped suites passed.
16. Yes. Exact PCM retention appears safe in this session, with complete samples and sub-millisecond copy overhead.
17. Another natural recording is needed for roamer morphology/negative-control evidence, but not for the accepted MLBB decision.

## Verification

Passed: TypeScript typecheck; 299 unit checks; 56 audio checks; 48 Thought-Boundary Safety V3 checks; 242 Visual Re-entry/cause-safety checks; replay-lab checks; and 103 foundation checks.

Raw paired results are in `scripts/stt/domain-natural-ab-1786931466365.json`; exact ranges are in `scripts/stt/domain-natural-clips-e7a76c03.json`.
