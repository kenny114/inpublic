# InPublic Exact Natural Audio + Domain ASR A/B V1 Validation Report

## Validation status

Infrastructure pass; natural-provider trial pending. Exact development
microphone PCM can now be retained and exported, but no fresh user-spoken
MLBB/roamer recording exists after the implementation. Consequently neither
candidate has been promoted to production vocabulary and no provider accuracy
claim is fabricated.

## Exact microphone audio architecture

The live path is:

1. `navigator.mediaDevices.getUserMedia({ audio: true })` supplies the browser
   microphone stream.
2. `AudioContext.createMediaStreamSource()` connects it to
   `InPublicPcmCapture`, an `AudioWorkletProcessor`.
3. The worklet reads the first mono input channel, clamps each float sample to
   `[-1, 1]`, converts it to signed PCM16, and accumulates
   `round(sampleRate * 0.08)` frames.
4. Each 80 ms `ArrayBuffer` is transferred to the main thread.
5. `useDeepgram` calls `connection.send(event.data)` first with that buffer.
6. Only after the normal send call returns, development corpus retention copies
   the same PCM16 values to its in-memory session buffer.

The mirror is never awaited by transport. It performs no file write, WAV
encoding, Blob creation, compression, or metadata serialization in the send
path.

## PCM format

- capture: `audio-worklet-pcm16`;
- provider encoding: `linear16`;
- signed little-endian PCM16;
- one channel (the worklet reads `inputs[0][0]`);
- actual `AudioContext.sampleRate`, passed unchanged to Deepgram;
- observed development configuration: 48 kHz;
- chunk size at 48 kHz: 3,840 samples / 7,680 bytes;
- cadence: 80 ms;
- no corpus resampling or lossy encoding.

The WAV wrapper written at export is PCM format 1 and contains the concatenated
retained `Int16` payload without altering sample values or order.

## Passive capture implementation

`ExactMicAudioRetention` is enabled only in development by either:

- opening the canvas with `?corpus=1`; or
- setting `localStorage["inpublic:corpus-audio"] = "1"` before the session.

`beginSession()` resets PCM, counters, timings, capture identity, and transport
epochs for every new microphone start. A Deepgram reconnect does not reset the
capture. Worklet PCM remains continuous during the gap; chunks successfully
sent retain their stream epoch, while gap chunks are marked `sent: false` and
grouped under a null transport epoch. This prevents the export from pretending
that audio produced during a disconnected interval reached the provider.

Production and retention-off calls allocate no corpus snapshot. MediaRecorder
fallback audio is not mislabeled as exact PCM; exact export remains unavailable
when the AudioWorklet path is unavailable.

## Corpus export

The existing session-log export now includes:

- `exact-mic-audio.wav`;
- `exact-mic-audio.json`;
- the same exact-audio metadata embedded in the session JSON.

Metadata contains session and capture IDs, capture/encoding, sample rate,
channels, bits per sample, sample/chunk counts, sent/unsent counts, duration,
start/end time, truncation/format flags, transport epochs, copy timing, and
observed websocket `bufferedAmount` percentiles.

This extends the existing session/corpus evidence rather than introducing a
second session schema.

## Live-path impact

A deterministic local mirror benchmark processed 2,500 production-sized chunks
(200 seconds / 9,600,000 samples):

| Metric | Result |
|---|---:|
| Retention-off loop | 1.12 ms total |
| Retention-on loop | 11.14 ms total |
| Incremental cost | 0.0040 ms/chunk |
| Copy p50 | 0.0024 ms |
| Copy p95 | 0.0053 ms |
| Copy max | 0.8431 ms |
| WAV creation | 14.51 ms at export only |

This verifies that the observer is after `send()` and that its local copy cost
is very small. It is not a substitute for a paired real-microphone OFF/ON run.
The next retained natural sessions must compare existing `speech-stream`, paint,
render, long-task, and buffered-amount evidence before declaring the live
behavior measurement complete. Provider lag proxies are intentionally excluded.

## Natural audio collected

Zero fresh natural domain recordings were available after the new retention
path was installed. The older six session logs predate retention and still have
no source PCM. Existing unrelated audio files cannot be relabeled as natural
MLBB/roamer evidence.

## Controlled target clips

`scripts/stt/domain-natural-ab.mjs` accepts speaker-verified sample ranges from
`exact-mic-audio.wav`. It slices the PCM buffer by exact integer sample indexes
without resampling or re-encoding, then streams each identical subarray through
the production Deepgram live configuration and 80 ms pacing.

The manifest records clip identity, source file, exact start/end samples,
target, positive/negative role, expected term, and optional literal surrounding
transcript. An example covering MLBB, MLB, roamer, and room is provided at
`scripts/stt/domain-natural-clips.example.json`.

## MLBB positive cases

No post-retention verified natural MLBB occurrence is available. The historical
transcript-only observation (two `MLBB`, one likely `MLB` corruption) is useful
for clip discovery but is not valid same-audio A/B evidence.

## MLBB negative controls

No post-retention natural `MLB` or `Mobile Legends` control is available. The
runner is prepared to score expected-term survival and flag candidate hijacks.

## MLBB A/B results

Not run: 0 verified retained natural occurrences. Baseline and candidate
accuracy are therefore not reportable.

## Roamer positive cases

No post-retention verified natural `roamer` occurrence is available. The
historical `roaming`/`room`/`Rome` transcript variants have no retained source
PCM and cannot be replayed as provider evidence.

## Roamer negative controls

No post-retention natural `room`, `roam`, `roaming`, or `role` controls are
available. The runner supports both isolated `roamer` and contextual
`MLBB roamer` phrase treatments against the same clips.

## Roamer A/B results

Not run: 0 verified retained natural occurrences. Baseline and candidate
accuracy are therefore not reportable.

## Other terminology observations

- `Aline` remains in production vocabulary with provider-only downstream
  correction safety.
- `Airline` remains a valid protected product term.
- `Affiliate Capital` is unchanged and remains the required regression control.
- `sales cycle` remains unchanged because no repeated exact-audio phrase defect
  has been established.
- no generic word was added.

## Final vocabulary decision

| Term | Decision | Why |
|---|---|---|
| MLBB | DO NOT SHIP | No post-retention positive plus MLB/Mobile Legends negative-control A/B |
| roamer | DO NOT SHIP | No post-retention positive plus room/roam/roaming/role negative-control A/B |
| MLBB roamer | DO NOT SHIP | Contextual phrase treatment is implemented for testing but has no evidence |

The production seed list remains unchanged from Domain Vocabulary Accuracy V1.

## Raw transcript impact

None. No candidate vocabulary was enabled in production. The A/B runner records
raw provider output first and keeps normalized/display values separate; it does
not introduce an LLM or broad fuzzy repair.

## Semantic recovery impact

No previously ASR-blocked structure became usable because no new term passed
the acceptance bar. Visual semantics were not retuned.

## V3 integrity

TypeScript passes, 299 unit checks pass, 56 audio/replay-controller checks pass,
and 48 Live Presentation/V3 checks pass. No worklet, thought-boundary, interim,
or live-ink behavior changed.

## Cause Safety integrity

All exact natural-corpus Cause/Effect false-positive regressions remain green as
part of the 242-check Visual Re-entry suite. POST/CREATE CONTENT,
pricing/minutes fragments, `SO IT'S LIKE`, and the corrupted camera relation
remain rejected.

## Visual Re-entry integrity

All 242 candidate, evidence, grounding, ownership, rendering, and safety checks
pass. No family, semantic context, camera, pagination, quiet commit, renderer,
or model-call path changed. Replay-lab deterministic checks also pass.

## Explicit answers

1. Are retained samples the same PCM stream sent to Deepgram? Every sent chunk
   is copied from the same `ArrayBuffer` after `send()` returns. The continuous
   WAV additionally retains reconnect-gap chunks and labels them unsent.
2. Does enabling retention measurably affect live speech behavior? Local copy
   overhead is about 0.0040 ms per 80 ms chunk, with no transport ordering
   change. A paired real-microphone behavior comparison is still pending.
3. Verified natural MLBB occurrences tested: 0.
4. MLBB baseline accuracy: not reportable.
5. MLBB candidate accuracy: not reportable.
6. MLBB negative-control damage: not tested; therefore MLBB was not shipped.
7. Verified natural roamer occurrences tested: 0.
8. Roamer baseline accuracy: not reportable.
9. Roamer candidate accuracy: not reportable.
10. Did roamer hijack room/roam/roaming/role? Not tested; therefore roamer was
    not shipped.
11. Was MLBB added? No.
12. Was roamer added? No.
13. Did a previously blocked semantic structure become usable? No.
14. Did V3 regress? No regression in the scoped automated suites.
15. Did Cause/Effect Safety regress? No.
16. Next highest-priority problem: collect a small natural `?corpus=1` MLBB
    talk containing confirmed MLBB/roamer positives and genuine phonetic
    controls, mark exact sample ranges, then run the prepared paired provider
    A/B before changing vocabulary.
