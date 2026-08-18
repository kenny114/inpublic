# InPublic Replay Pacing V2 Report

Fixture: `WhatsApp Ptt 2026-08-14 at 4.50.36 PM.ogg` (87.96 seconds, 1,100 80 ms PCM16 chunks at 48 kHz).

## Old scheduler

The sender scheduled chunk N+1 at the previous actual send plus 80 ms. Ordinary timer overhead therefore accumulated over the complete fixture. Across the previous five clean runs, median send lag was 1,927 ms P50, 3,750 ms P95, and 4,003 ms max. End-of-file was approximately 3.9–4.3 seconds late.

## New absolute-clock scheduler

The development replay sender now schedules every next-unsent chunk from a monotonic replay anchor plus the chunk's source-sample start time. A late send does not move later targets. Production AudioWorklet and MediaRecorder paths do not use this scheduler.

`sendLag` now means positive source-clock drift relative to the current uninterrupted replay epoch. `scheduledSendError` is the signed execution error relative to that same absolute deadline. Deliberate wall-clock displacement from stalls or reconnects is separate as `intentionalRebaseDelayMs`.

## Jitter policy

Normal timer jitter remains attached to the absolute source clock. The genuine-stall threshold is 160 ms: two complete 80 ms chunks overdue. This is conservatively above the observed 3–9 ms timer noise while preventing multiple queued chunks after an actual pause.

## Genuine-stall policy

When a timer wakes more than 160 ms after its absolute deadline, the scheduler rebases once at that next-unsent chunk. It does not skip, duplicate, restart, or catch up queued source audio. The implementation uses one-shot timers only—no polling loop, spin wait, or repeated zero-delay timer.

## Rebase behavior

Reconnects explicitly request the same safe rebase, regardless of the exact pause duration. The new anchor is `now - nextUnsentSourceStartMs`; the following chunk remains 80 ms later.

## Five clean-run results

All values are milliseconds except buffer bytes, rebase count, and long-task count. “Latest-chunk proximity” is retained only as a non-causal legacy comparison.

| Run | Legacy interim P50/P95 | Latest-chunk proximity P50/P95 | Grounded region P50/P95/max | Live edge P50/P95/max | Send lag P50/P95/max | Scheduled error P50/P95/max | Rebases/reasons | Buffer max | Long tasks |
|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|
| 1 | 83/141 | 38/79 | 85/900/1927 | 160/640/1040 | 1/9/73 | 1/9/73 | 0/none | 7680 | 2 |
| 2 | 84/286 | 19/78 | 89/989/2105 | 160/800/2110 | 1/8/14 | 1/8/14 | 0/none | 7680 | 0 |
| 3 | 82/104 | 15/78 | 85/882/1925 | 160/640/1040 | 1/9/17 | 1/9/17 | 0/none | 7680 | 0 |
| 4 | 56/132 | 52/75 | 64/847/1929 | 80/560/1040 | 1/8/16 | 1/8/16 | 0/none | 7680 | 0 |
| 5 | 78/128 | 19/79 | 86/937/1933 | 160/640/1040 | 1/9/53 | 1/9/53 | 0/none | 7680 | 0 |

Clean-run medians: send lag 1/9/17 ms P50/P95/max; scheduled error 1/9/17 ms; grounded region 85/900 ms P50/P95; live edge 160/640 ms P50/P95; legacy interim lag 82/132 ms P50/P95.

## Clean send-lag comparison

| Source position | Old clean range | New clean range | New median |
|---:|---:|---:|---:|
| 10 s | 350–610 ms | 0–5 ms | 3 ms |
| 30 s | 1,210–1,580 ms | 0–1 ms | 0 ms |
| 60 s | 2,610–2,950 ms | 0–10 ms | 0 ms |
| 87 s/end | 3,780–4,190 ms | 0–3 ms | 1 ms |

The clean runs sent all 1,100 chunks, had zero scheduler rebases, and did not accumulate drift.

## Provider live-edge after pacing fix

Clean median P50/P95 was 160/640 ms. Per-run maxima were 1,040–2,110 ms. The prior clean median was 160/960 ms, so pacing correction removed sender drift without inventing a provider-side multi-second baseline.

## Grounded provider-region latency

Clean median source-region-to-response P50/P95 was 85/900 ms. Per-run maxima were 1,925–2,105 ms. This is the causal replay latency measurement.

## Legacy interimLag after pacing fix

Clean median legacy interim lag fell from 2,242/3,937 ms P50/P95 to 82/132 ms. That removes 2,160 ms at P50 (96.3%) and 3,805 ms at P95 (96.6%). This metric remains labeled legacy and is not used as a causal provider metric.

## WebSocket buffer behavior

Every clean and reconnect run reported 7,680 bytes P50/P95/max. The old clean maximum was 7,700 bytes. Absolute pacing did not increase buffering.

## Reconnect run

The forced close after source 20.00 s produced exactly one reconnect and one `reconnect` rebase. Chunk 251, the next unsent chunk at 20.00 s, resumed after a legitimate 941 ms wall-clock gap; chunks 252 and 253 followed after 84 ms and 78 ms. All 1,100 sequences were unique and contiguous. Intentional rebase delay was 864 ms; source-clock send lag remained 1/9/27 ms P50/P95/max; buffer max remained 7,680 bytes.

## Two-reconnect run

Forced closes after source 20.00 s and 40.00 s produced exactly two reconnects and two `reconnect` rebases. Chunks 251 and 501 were the next unsent chunks. Their legitimate gaps were 811 ms and 937 ms; the immediately following gaps returned to 83 ms and 81 ms. All 1,100 sequences were unique and contiguous. Total intentional rebase delay was 1,589 ms; source-clock send lag remained 1/9/31 ms P50/P95/max; buffer max remained 7,680 bytes.

## Transcript continuity

Clean runs remained exactly 1,299 characters. The one-close run produced 1,237 characters (62 fewer); the two-close run produced 1,191 characters (108 fewer). This reproduces the known reconnect-boundary transcript loss and was intentionally not changed.

## Main-thread behavior

Four clean runs and both reconnect runs had no long tasks. Clean run 1 recorded an 87 ms task before audio transport and one 54 ms task during transport. The latter caused no rebase (that run's maximum scheduled-send error was 73 ms). There was no evidence of busy-looping, repeated zero-delay timers, or scheduler-generated pressure.

## Tests

Deterministic tests cover:

1. A +4 ms send does not shift the next 80 ms absolute deadline.
2. Repeated +3 ms overhead across 1,100 chunks does not accumulate.
3. A genuine stall triggers exactly one rebase.
4. Rebase resumes at the next unsent chunk.
5. No chunk duplication.
6. No chunk skip.
7. No post-stall catch-up burst.
8. Reconnect explicitly triggers a safe rebase.
9. Tiny clean jitter does not continuously rebase.
10. Production microphone capture kinds cannot use replay pacing.

Validation passed: TypeScript, replay-lab deterministic tests, foundation safeguards, five real clean Deepgram runs, one forced-close run, and one two-forced-close run. The broader repository suite reaches an unrelated pre-existing `directorV1 defaults off` feature-flag failure after all replay tests pass.

## Explicit answers

1. **Did normal replay drift stop accumulating?** Yes. Clean end-of-file lag was 0–3 ms (1 ms median), versus approximately 3.78–4.19 seconds before.
2. **Clean send lag at 10/30/60/end before vs after?** 350–610/1,210–1,580/2,610–2,950/3,780–4,190 ms before; 0–5/0–1/0–10/0–3 ms after. New medians were 3/0/0/1 ms.
3. **Corrected Deepgram live-edge P50/P95?** 160/640 ms across clean-run medians.
4. **Corrected grounded audio-region→response P50/P95?** 85/900 ms across clean-run medians.
5. **How much old interimLag disappeared?** 2,160 ms P50 and 3,805 ms P95, or 96.3% and 96.6%.
6. **Did absolute scheduling create send bursts?** No. Clean playback kept absolute 80 ms targets; reconnects paused and then resumed normal ~80 ms cadence.
7. **Did WebSocket buffering increase?** No. Max was 7,680 bytes versus 7,700 bytes in the old clean runs.
8. **Did reconnect behavior regress?** No. There were no skipped or duplicated chunks, no burst, bounded ~0.8–0.9 s pauses, and source-clock drift remained 9 ms P95.
9. **Is there still a meaningful speech-latency problem worth investigating?** There is no longer a pervasive 2–4 second replay latency problem. A residual provider tail remains meaningful if the product target requires reliably subsecond transcript response: grounded-region P95 is ~900 ms and maxima are ~1.9–2.1 s.
10. **At exactly which boundary is the remaining delay?** Between the last causally relevant source-audio region being sent and Deepgram's transcript response arriving (provider recognition/VAD/response), not replay scheduling, WebSocket buffering, Visual Re-entry, rendering, or microphone capture.
