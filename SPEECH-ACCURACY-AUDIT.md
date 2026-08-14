# InPublic Speech Recognition Accuracy Audit

Measured 2026-08-13. All numbers come from `scripts/stt/`, which streams audio
to Deepgram exactly the way `hooks/useDeepgram.ts` does. Raw results are in
`scripts/stt/results/*.json` — every Deepgram message is kept, so any follow-up
question is answered from the files rather than by re-spending.

**Headline:** the losses are Deepgram recognition errors on proper nouns, not
InPublic dropping words. The merge layer is clean. The single highest-value fix
costs no latency and is a data change, not an architecture change — and the
current seed vocabulary is actively making the reported `Aline` case worse by
telling Deepgram to expect the word **"Airline"**.

## 0. What was and was not measured

| Covered by evidence | Not covered — needs human recordings |
|---|---|
| Full static audit of every layer | Trinidad/Tobago and other accented speech |
| WER on 35 utterances × 5 configs, real Deepgram streaming | Desktop vs mobile microphone |
| Word-level confidence for right and wrong words | Near vs far mic, background noise |
| Interim vs final revision rate | Real-user "Aline → airline" reproduction |
| Keyterm A/B on byte-identical audio, 60 trials | Real-world packet loss / congestion |

The corpus is Windows TTS (`Microsoft Zira`, en-US). That is a weak proxy for a
real speaker — no accent, no room, no microphone. It was chosen for the one
property human recordings cannot offer: **byte-identical audio across
conditions**, which is what makes the keyterm and smart_format comparisons
valid. Drop real `.wav` files into `scripts/stt/audio/<id>.wav` and every script
prefers them, no code change needed. Until that happens, treat the accent and
microphone rows above as genuinely unknown, not as passing.

---

## 1. Current Architecture

```
microphone
  └─ getUserMedia({ audio: true })                    hooks/useDeepgram.ts:389
      └─ AudioContext({ latencyHint: "interactive" }) hooks/useDeepgram.ts:321
          └─ AudioWorklet "inpublic-pcm-capture"      public/pcm-capture-worklet.js
              └─ Float32 → Int16, 80ms chunks, mono, context sample rate
                  └─ connection.send(ArrayBuffer)     hooks/useDeepgram.ts:337
                      └─ Deepgram nova-3 WebSocket
                          └─ LiveTranscriptionEvents.Transcript
                              ├─ is_final = false → onInterim → Board.handleInterim:5231
                              │     ├─ correctTranscript() → setInterim() → writeLive(settled:false)
                              │     └─ two-consecutive-interim agreement → settled words → Scribe / Reflex
                              └─ is_final = true  → onFinal   → Board.handleFinal:5147
                                    ├─ correct() → finalsRef (canonical) → writeLive(settled:true)
                                    └─ scribePendingRef → Scribe (Claude) → visual ops
```

MediaRecorder exists only as a fallback when `AudioWorkletNode` is unavailable
(`hooks/useDeepgram.ts:356`); it uses `recorder.start(80)` and the browser's
default codec (Opus/WebM) with no explicit encoding parameters sent to Deepgram.
On every browser InPublic realistically targets, the AudioWorklet PCM path is
the one that runs.

**Layer map:**

| Layer | Where |
|---|---|
| A — what was spoken | — |
| B — what Deepgram returned | `useDeepgram.ts:581` Transcript handler |
| C — canonical transcript | `finalsRef.current` (`Board.tsx:5158`), after `correct()` |
| D — text sent to Claude / visuals | `scribePendingRef` / `pendingTextRef` (`Board.tsx:5181`) |
| E — what appears visually | `writeLive()` (`Board.tsx:2470`) and Scribe marks |

Dev-only instrumentation for B/C/D and for the transmitted audio was added in
this audit — see §13.

## 2. Current Deepgram Configuration

From `hooks/useDeepgram.ts:511`:

| Parameter | Value | Why it matters |
|---|---|---|
| `model` | `nova-3` | Confirmed. Keyterm Prompting applies; Nova-2 `keywords` does not. |
| `interim_results` | `true` | The live line depends on this entirely. |
| `smart_format` | `true` | Formatting only — but see §5, it corrupted a math utterance. |
| `punctuate` | `true` | Redundant; `smart_format` implies punctuation. |
| `endpointing` | `150` | Aggressive. Drives the "pause and it writes" feel. |
| `utterance_end_ms` | `1000` | At Deepgram's documented minimum. |
| `vad_events` | `true` | Diagnostic only, no accuracy effect. |
| `encoding` | `linear16` | Only on the AudioWorklet path. |
| `sample_rate` | `AudioContext.sampleRate` | Whatever the device gives, typically 48000. |
| `channels` | `1` | Correct. |
| `keyterm` | `SEED_TERMS` + board terms, capped 40 | **This is where the Aline bug lives.** |
| `language` | *not set* | Defaults to `en`. |

Post-Deepgram processing, all in `lib/vocab.ts`:

- `KNOWN_ERRORS` — 7 exact-phrase regex rewrites (`air agents` → `AI agents`).
- Phonetic canvas-term correction — gated on `MIN_CONFIDENCE = 0.86`, on the
  term being explicitly named in `SEED_TERMS`/env, and on a `PROTECTED` list of
  ordinary English words. This gate is well designed and I found no case where
  it damaged a transcript.
- Interim dedup — two consecutive interims must agree on a word before it is
  "settled" (`Board.tsx:5275`).

## 3. Current Accuracy

35 utterances, 369 reference words, real Deepgram streaming, real-time paced.

| Config | Description | WER | sub | del | ins |
|---|---|---|---|---|---|
| A | production params, no keyterms | 6.5% | 15 | 5 | 4 |
| **E** | **production as shipped today** (`SEED_TERMS`) | **5.7%** | 13 | 5 | 3 |
| B | production + a correct user vocabulary | **4.1%** | 7 | 5 | 3 |
| C | `smart_format: false` | 5.4% | 14 | 2 | 4 |
| D | `endpointing: 400` | 7.0% | 15 | 6 | 5 |

Two of E's 21 errors are British/American orthography (`recogniser`→`recognizer`,
`finalises`→`finalizes`) and are not real errors. Adjusted, production sits at
**~5.1% WER** and config B at **~3.5%**.

**By category — this is the answer to "what kinds of speech does InPublic get wrong":**

| Category | A (no keyterms) | E (production today) | B (correct vocabulary) |
|---|---|---|---|
| normal | 0.0% | **0.0%** | 0.0% |
| fast | 1.4% | **1.4%** | 1.4% |
| **proper-noun** | 20.0% | **14.5%** | **7.3%** |
| **confusable** | 7.1% | **7.1%** | **2.4%** |
| technical | 5.2% | 5.2% | 5.2% |
| numbers | 12.5% | 12.5% | 12.5% |
| disfluency | 3.9% | 3.9% | 3.9% |

Normal and fast conversational speech is essentially perfect. Disfluency is fine
(the only "errors" are `um`/`uh` being dropped, which is arguably correct
behaviour for this product). **Every meaningful loss is concentrated in proper
nouns and the confusable words that neighbour them.**

Keyterm recall — the metric that matters most for InPublic:

| Config | Recall | Detail |
|---|---|---|
| A | 6/16 (37.5%) | Aline 0/5, Claude 0/2, Whop 0/1, Kehmon 0/1, InPublic 0/1 |
| **E (today)** | **8/16 (50.0%)** | **Aline 0/5**, Claude 2/2, Whop 0/1, Kehmon 0/1, InPublic 0/1 |
| **B** | **15/16 (93.8%)** | **Aline 5/5**, Claude 2/2, Whop 1/1, Kehmon 1/1, InPublic 0/1 |

`InPublic` fails in every configuration — Deepgram splits it to "in public" even
when it is a keyterm. That one needs the existing `KNOWN_ERRORS` path, not a
keyterm.

## 4. Error Breakdown

Attributing all 21 errors in config E (production as shipped):

| Cause | Errors | Share | Evidence |
|---|---|---|---|
| Deepgram recognition error, proper noun / vocabulary | 11 | **52%** | Fixed by keyterm in config B on identical audio |
| Deepgram recognition error, genuine ambiguity | 3 | 14% | `clawed`/`Claude`, `endpointing`→`end pointing` |
| `smart_format` corruption | 4 | 19% | `"Thirty nine times eight"` → `"39Times8."`; config C = 0 errors on this item |
| Orthography, not an error | 2 | 10% | `recogniser`/`recognizer` |
| Disfluency removal (arguably correct) | 1 | 5% | `um` dropped |
| **Transcript merging / interim handling** | **0** | **0%** | §7 |
| **Downstream InPublic logic** | **0** | **0%** | §7 |
| Low-quality audio | unknown | — | Not measurable without real recordings; see §8 |
| Endpointing | 0 | 0% | §5 |

**InPublic is not losing words after Deepgram sends them.** I traced every path
that could and found none firing: the correction layer's guard rails held on all
35 utterances, the settled-word counter stayed synchronised with the final, and
no final was discarded. The one word-loss mechanism that exists —
`MAX_PENDING_WORDS = 120` trimming `pendingTextRef` (`Board.tsx:5171`) — only
trims the *beat's context window*, never the canonical transcript or the live
line.

## 5. Aline → Airline Investigation

**Where the substitution happens: inside Deepgram, before InPublic sees the text.
And InPublic's own vocabulary is making it worse.**

`lib/vocab.ts:34` — the first entry of `SEED_TERMS`:

```js
export const SEED_TERMS: string[] = [
  "Airline",          // ← this is sent to Deepgram as a keyterm on every session
  "AI agents",
  ...
```

Every take opens the socket with `keyterm=Airline` (`useDeepgram.ts:531`; at the
start of a take the board is empty, so `SEED_TERMS` *is* the whole list). The
name is spelled **Aline**. InPublic is explicitly instructing the recogniser to
expect the wrong word — and `Aline` appears nowhere in the vocabulary at all.

The damage is compounded twice more, both in `lib/vocab.ts`:

- `PROTECTED` (line 199) contains `air`, `line`, `lines`, **`airline`**. Once
  Deepgram returns "airline" or "a line", the phonetic correction layer is
  forbidden from repairing it.
- The comment at line 276 — `The recogniser both splits a name into pieces
  ("Airline" -> "your line")` — shows the misspelling was believed to be the
  real name, so the repair path was built around the wrong target too.

**Controlled experiment**, 5 utterances × 4 conditions × 3 repeats = 60 streams
on byte-identical audio (`scripts/stt/aline.mjs`, raw in `results/aline.json`):

| Keyterm condition | "Aline" correct | Avg confidence of the target word |
|---|---|---|
| none | **0/15** | 0.900 — as "align" |
| **`SEED_TERMS` (production today)** | **0/15** | 0.850 — as "align" |
| `["Aline"]` | **15/15** | **0.993** |
| `["Aline", "Airline"]` | **15/15** | 0.992 |

Three things this proves:

1. Adding `Aline` as a keyterm fixes it **completely and deterministically** —
   15/15, zero variance across repeats.
2. Production's current vocabulary is **no better than sending nothing at all**
   for this name.
3. Keeping `"Airline"` in the list does **not** poison `Aline` once `Aline` is
   also present (15/15 either way). So the fix is purely additive — you do not
   have to remove anything to get the benefit.

**Honest caveat.** With US-accented TTS the failure surfaces as `Aline → "Align"`
or `"a line"`, not the literal `"airline"` you observed. I could not reproduce
your exact string with synthetic audio. That is a difference in *which* wrong
word comes out, not in the mechanism or the fix: it is the same
proper-noun-not-in-vocabulary failure, and the keyterm resolves it in every
trial. Confirming the literal `"airline"` output needs a recording of you saying
it — see §13, step 0.

## 6. Word Confidence Findings

| Config | Avg confidence, correct words | Avg confidence, incorrect words | Gap |
|---|---|---|---|
| A | 0.970 (n=349) | 0.833 (n=19) | 0.136 |
| E | 0.972 (n=351) | 0.835 (n=16) | 0.137 |
| B | 0.974 (n=357) | 0.862 (n=10) | 0.111 |

Distribution of confidence for **incorrect** words (config A):

```
0.00–0.50  # 1
0.50–0.70  ## 2
0.70–0.80  #### 4
0.80–0.90  ## 2
0.90–0.95  ### 3
0.95–1.00  ####### 7      ← more than a third of errors are >0.95 confident
```

Threshold behaviour:

| Threshold | Errors caught | Correct words falsely flagged |
|---|---|---|
| < 0.70 | 3/19 (16%) | 9/349 |
| < 0.80 | 7/19 (37%) | 13/349 |
| < 0.90 | 9/19 (47%) | 36/349 |

**Conclusion: confidence is not a usable error detector for InPublic.** At the
most generous threshold it catches under half the errors while flagging four
times as many correct words. The worst cases are the most confident ones —
`Aline → "align"` at **0.991**, `InPublic → "public"` at **0.987**,
`Whop → "WAP"` at 0.948. A proper noun the model has never seen is not a word
the model is unsure about; it is a word the model is confidently sure is
something else.

Where confidence **is** useful:

- **Diagnostics.** The 0.99 → 0.85 drop when a keyterm is missing is a clean
  signal for measuring vocabulary coverage offline.
- **Verifying a keyterm took effect.** `Aline` moves 0.850 → 0.993 when the
  keyterm is present. That is a reliable automated check.
- **Vocabulary discovery** (§12), scored over many sessions in aggregate — never
  on a single word in a single utterance.

It should **not** gate corrections, trigger LLM repair, or drive any live
behaviour.

## 7. Interim vs Final Findings

| Config | Interims/utterance | Utterances where the final retracted an interim word | Words retracted |
|---|---|---|---|
| A | 2.5 | 7/35 (20%) | 16 / 369 (4.3%) |
| E | 2.5 | 7/35 | 16 |
| C | 2.3 | 6/35 | 12 |
| D (endpointing 400) | 2.7 | 9/35 | 18 |

Interim instability is **low**. Deepgram retracts about 4% of words, and almost
all retractions are the tail of a partial word being completed (`"book"` →
`"booked"`, `"air"` → `"airline"`) rather than a semantic reversal.

**InPublic's two-consecutive-interim agreement rule (`Board.tsx:5275`) is the
right design and is working.** It is why the retraction rate does not translate
into visible churn: a word must appear identically in two updates (~100–300ms)
before it is handed to the Scribe or Reflex. The live line still shows every
interim immediately, so responsiveness is unaffected.

I specifically checked for every failure mode you listed and found **none** of
them: no appended-instead-of-replaced interims (`setInterim` overwrites), no
discarded finalized segments, no duplicate words (`firedCommandRef` guards
double-firing), no `is_final`/`speech_final` confusion (InPublic keys off
`is_final` only, which is correct for its merge model).

One genuine finding, and it runs the *opposite* way to expectation: on the math
utterance the **interim was right and the final was wrong**.

```
interim: "Thirty nine times"
final  : "39Times8."
```

That is `smart_format` mangling a short numeric utterance, not interim
instability. It is a real product bug — that string reaches the Scribe and the
math engine as Layer D.

**Recommendation: keep the current architecture.** You already have exactly the
structure the brief describes — immediate interim display, a separate
authoritative final, and asynchronous reconciliation. Do not add a delay.

## 8. Audio Quality Findings

The capture path is sound. `public/pcm-capture-worklet.js` converts Float32 to
Int16 with correct asymmetric scaling, buffers exactly 80ms, and drops nothing —
every sample is accounted for. No resampling happens in the browser: the
`AudioContext`'s native rate is declared to Deepgram verbatim, so there is no
quality loss and no rate mismatch. Chunk cadence, gaps and congestion are
already measured in production (`SpeechStreamMetrics`, `chunk_gap` p50/p95/max).

Two things I could **not** verify and one real gap:

- **Constraints are unspecified.** `getUserMedia({ audio: true })`
  (`useDeepgram.ts:389`) passes no constraints, so echo cancellation, noise
  suppression and automatic gain control run at browser defaults — all three are
  **on** by default in Chrome. AGC and noise suppression are tuned for
  telephony, and are a plausible contributor to consonant smearing on names
  ("Aline" → "a line" is exactly the kind of boundary error aggressive gain
  riding produces). This is worth an experiment; it is not yet evidence.
- **Mobile browsers** were not tested.
- **Whether Deepgram receives clean audio in the field** was unanswerable before
  this audit. It is answerable now: §13 adds a dev-only recorder that captures
  the exact bytes sent to the socket as a playable WAV.

## 9. Deepgram Research

From current documentation (August 2026):

**Keyterm Prompting** — Nova-3 and Flux only; Nova-2 uses the older `keywords`
feature. Syntax is `keyterm=TERM` repeated per term, URL-encoded for phrases; the
`term:weight` intensifier syntax is **invalid** for keyterm and is silently
treated as a literal term. Limit is **500 tokens across all keyterms**, not a
term count. Recommended range is **20–50 terms**. Works on streaming and
prerecorded. Capitalisation should match intent (`Deepgram`, not `deepgram`).
The docs do not state that large lists degrade general accuracy — and my
measurements agree: config B (9 keyterms) and config E (15 keyterms) both left
`normal` and `fast` speech at 0.0% and 1.4% WER, identical to no keyterms. The
one measured cost is homophone over-triggering (§10).

**Keyterms cannot be changed mid-connection on Nova-3** — only Flux supports
dynamic reconfiguration via a `Configure` control message. This confirms the
existing comment at `useDeepgram.ts:85`. Terms are fixed at socket open.

**Cost** — no additional charge documented for keyterm.

**Confidence** — documented as a 0–1 reliability estimate per word, with the
suggested use being threshold-based transcript rejection. My data (§6) shows
that suggestion does not transfer to proper-noun errors.

**Endpointing** — default `10`ms; controls **only when finals are emitted**, not
recognition accuracy. Confirmed experimentally: config D (400ms) did not improve
WER (7.0% vs 5.7%) and cost **+1.3s** to first final. `utterance_end_ms` has a
documented **1000ms minimum**, which InPublic already sits at.

**Smart formatting** — documented as post-processing that "does not alter which
words are transcribed". Broadly true in my data: configs A and C differ by only
one item. But that item, the math utterance, was corrupted into `"39Times8."`,
which *does* change the words downstream consumers see.

**Flux** — a newer conversational model with integrated turn detection, marketed
for voice agents. It supports keyterms and mid-connection reconfiguration. Not
recommended here: InPublic is a monologue-lettering product, not a turn-taking
agent, and switching models is exactly the un-evidenced provider change the
brief rules out. Worth a measured comparison later, not now.

Sources: [Keyterm Prompting](https://developers.deepgram.com/docs/keyterm),
[Endpointing](https://developers.deepgram.com/docs/endpointing),
[Interim Results](https://developers.deepgram.com/docs/interim-results),
[Smart Format](https://developers.deepgram.com/docs/smart-format),
[End of Speech Detection](https://developers.deepgram.com/docs/understanding-end-of-speech-detection),
[Models & Languages](https://developers.deepgram.com/docs/models-languages-overview).

## 10. Keyterm Experiment

Before/after on identical audio, config E (today) → config B (correct vocabulary):

| Metric | Production today | With correct vocabulary | Change |
|---|---|---|---|
| Overall WER | 5.7% | **4.1%** | **−28%** |
| Proper-noun WER | 14.5% | **7.3%** | **−50%** |
| Confusable WER | 7.1% | **2.4%** | **−66%** |
| Keyterm recall | 50.0% | **93.8%** | **+88%** |
| Normal-speech WER | 0.0% | 0.0% | no regression |
| Fast-speech WER | 1.4% | 1.4% | no regression |
| Time to first interim (p50) | 1472ms | 1473ms | **+1ms** |
| Time to first final (p50) | 3043ms | 3179ms | +136ms |

*(These are file-relative times including each clip's leading silence, so treat
them as comparative, not as absolute mic-to-text latency.)*

Terms recovered: `Aline` 0/5 → 5/5, `Whop` 0/1 → 1/1, `Kehmon` 0/1 → 1/1.
Still failing: `InPublic` 0/1 in every config.

**The one measured cost.** In config E, `"Claude clawed through the document"`
became `"Claude Claude through..."` — the `Claude` keyterm pulled the genuine
homophone `clawed` toward it. This is real and worth knowing: keyterms trade a
small false-positive rate on true homophones for a large true-positive gain on
names. At 11 errors fixed versus 1 introduced, the trade is clearly worth
taking, but it argues for a curated vocabulary rather than an
everything-on-the-canvas list.

## 11. Best Improvements

Ranked by accuracy gain ÷ (latency cost × implementation risk).

| # | Change | Accuracy gain | Latency cost | Risk | Verdict |
|---|---|---|---|---|---|
| 1 | Fix `SEED_TERMS`: `"Airline"` → add `"Aline"` | **Aline 0/15 → 15/15**; overall WER −28% | **+1ms** | Trivial — one array | **Do now** |
| 2 | Remove `airline`/`air`/`line` from `PROTECTED`, or make the guard term-aware | Unblocks the repair path as a second net | 0 | Low | Do now |
| 3 | Add `InPublic` split to `KNOWN_ERRORS` | Fixes the one term keyterms can't | 0 | Low | Do now |
| 4 | Disable `smart_format` for short numeric utterances, or handle `"39Times8."` downstream | Fixes 4 of 21 production errors | 0 (or −100ms) | Medium — affects all formatting | Measure first |
| 5 | User vocabulary feature (§12) | Generalises #1 to every user | ~0 | Medium | Next milestone |
| 6 | Explicit `getUserMedia` constraints experiment | Unknown, plausibly real | 0 | Low to test | Experiment |
| 7 | Change endpointing | **Negative** (7.0% vs 5.7%, +1.3s) | +1300ms | — | **Do not** |
| 8 | Switch model / add LLM correction to the live path | Unevidenced | High | High | **Do not** |

## 12. Recommended Architecture

**Almost none.** The pipeline is well built and the live path should not be
touched. The recommended shape is the one you already have, with the vocabulary
made correct and made per-user:

```
  session start
     └─ load user vocabulary (localStorage / Supabase)
         └─ merge: user terms → board terms → seeds, cap 40 / 500 tokens
             └─ keyterm= on socket open          ← the only accuracy change
  live path: UNCHANGED
     interim → correctTranscript → live line     (no model, no delay)
     final   → canonical → Scribe                (async, behind the ink)
  offline, never in the live path:
     low-confidence + frequently-corrected terms → suggest to the user
```

**User vocabulary feasibility** (Phase 6, investigation only — not implemented):

- **Feasible, and cheap.** Terms are fixed at socket open, which InPublic
  already handles: `keyterms()` is a getter read fresh on every connect
  (`useDeepgram.ts:89`).
- **Limit:** 500 tokens total, 20–50 terms recommended. The existing cap of 40
  is already in the right range; it should become a *token* budget, since 40
  multi-word phrases can exceed 500 tokens.
- **Cannot be changed mid-connection** on Nova-3. A term added mid-session takes
  effect on the next reconnect. The existing `correctTranscript` layer is the
  correct cover for that window — it already is.
- **Latency:** measured at +1ms. Non-issue.
- **Privacy:** names and company terms are personal data. Store per-user, never
  in a shared list, and never log the vocabulary to shared telemetry. The
  existing `log({type:"keyterms"})` call (`Board.tsx:5466`) writes terms into
  the session log — review that before shipping a user vocabulary.
- **Persistence:** a plain `string[]` per user. No schema complexity needed.
- **Auto-discovery:** viable but should only ever *suggest*. Track terms that
  are repeatedly corrected by `correctTranscript`, or that sit persistently
  below 0.85 confidence across many sessions, and surface them as "add to your
  vocabulary?" — never apply silently. §6 shows single-word confidence is far
  too noisy to act on automatically.

## 13. Exact Implementation Plan

**Step 0 — before any fix, confirm the real-user case (5 minutes).**
Dev-only instrumentation was added in this audit and is already wired:

- `lib/sttDebug.ts` — new. Captures every raw Deepgram message (Layer B, with
  per-word start/end/confidence and `is_final`/`speech_final`), the canonical
  transcript (Layer C), the text handed to the visual layer (Layer D), and the
  exact PCM transmitted to the socket. Inert unless `NODE_ENV === "development"`
  **and** `localStorage["inpublic:stt-debug"] === "1"`. Memory-bounded, never
  uploaded.
- `hooks/useDeepgram.ts` — 2 guarded call sites (raw message capture at the
  Transcript handler; audio copy in the worklet `onmessage`, taken before
  `send`).
- `components/Board.tsx` — 2 guarded call sites recording Layers C and D.

To use it:

```bash
npm run dev
```

Then in the browser console: set `localStorage["inpublic:stt-debug"] = "1"`,
reload, record yourself saying "Aline", and call `__inpublicSTT.compare()`,
`__inpublicSTT.saveWav()` and `__inpublicSTT.saveJson()`. That WAV answers
whether Deepgram heard bad audio; the JSON answers what it did with it. Drop the
WAV into `scripts/stt/audio/p1.wav` and the whole corpus harness re-runs against
your real voice.

**Step 1 — the fix (`lib/vocab.ts`).** In `SEED_TERMS`, add `"Aline"` (keep
`"Airline"`; §5 proved it does no harm). Add the other real proper nouns:
`Kehmon`, `Whop`, `Tobago`. This is a one-line-per-term data change with a
measured 28% WER reduction and +1ms latency.

**Step 2 — unblock the repair path (`lib/vocab.ts:199`).** `PROTECTED` contains
`air`, `line`, `lines`, `airline`, which forbids repairing exactly the error
under investigation. Either remove those four, or make the guard skip words that
are phonetically identical to an explicitly named vocabulary term. The second is
safer and keeps the guard's original purpose intact.

**Step 3 — `InPublic` (`lib/vocab.ts:107`).** The existing rule only fires
before `app|board|canvas`. Broaden it, since `InPublic` fails in 100% of
configurations and is the product's own name.

**Step 4 — the smart_format math bug.** Reproduce with
`node --env-file=.env.local scripts/stt/run.mjs C m1`, then decide between
disabling `smart_format` (config C measured *better* overall: 5.4% vs 5.7%) and
handling the concatenated form downstream. Do not change this blind — it affects
every number, date and currency in the product.

**Step 5 — the audio-constraints experiment.** Add explicit
`echoCancellation/noiseSuppression/autoGainControl: false` behind a dev flag at
`useDeepgram.ts:389`, record the same phrase both ways with `saveWav()`, and
compare. Only ship if it measurably wins.

**Step 6 — user vocabulary.** Per §12. After steps 1–3 have been validated on
real sessions.

**Re-running the measurements:**

```bash
node scripts/stt/synth.mjs && node --env-file=.env.local scripts/stt/run.mjs B && node scripts/stt/analyze.mjs A B C D E
```

## 14. Things We Should NOT Change

- **The live interim path.** Interim → `correctTranscript` → live line, with no
  model and no throttle. It is measured, it is fast, and interim instability is
  only 4%.
- **The two-consecutive-interim settling rule** (`Board.tsx:5275`). This is the
  mechanism that makes acting on interims safe. §7 shows it working.
- **Endpointing at 150ms.** Measured: raising it made accuracy *worse* and cost
  1.3 seconds.
- **The `correctTranscript` guard rails** — `MIN_CONFIDENCE`, the
  explicitly-named-terms restriction, span scoring. This layer is unusually
  careful and it never once damaged a transcript across 175 streamed utterances.
  Step 2 narrows one specific list; leave the rest alone.
- **The AudioWorklet capture path.** Verified sample-accurate.
- **`nova-3`.** No evidence supports moving to Flux or another provider.
- **No LLM in the critical path.** Nothing in this audit justifies it; the
  dominant error class is fixed by a data change costing 1ms.
- **The reconnect / epoch / lease machinery.** Untouched by this investigation
  and working.

---

### Appendix — harness

| File | Purpose |
|---|---|
| `scripts/stt/corpus.mjs` | 35 utterances across 7 categories + reference transcripts |
| `scripts/stt/synth.mjs` | Renders the corpus to 16kHz mono WAV (Windows TTS) |
| `scripts/stt/stream.mjs` | Streams a WAV to Deepgram live, mirroring `useDeepgram.ts` |
| `scripts/stt/run.mjs` | Runs the corpus through one config; configs A–E |
| `scripts/stt/score.mjs` | WER with full alignment and number normalisation |
| `scripts/stt/analyze.mjs` | All Phase 3/4/6 metrics |
| `scripts/stt/interims.mjs` | Interim → final revision detail |
| `scripts/stt/aline.mjs` | The isolated Aline keyterm experiment |
| `scripts/stt/results/*.json` | Every raw Deepgram message from every run |
