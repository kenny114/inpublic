export interface AudioTiming {
  audioEndMs: number;
  streamEpoch: number;
  kind?: "interim" | "final";
  receivedAtMs?: number;
  firstWordEndMs?: number;
  /** See DeepgramResultTiming.sinceChunkSentMs in hooks/useDeepgram.ts. */
  sinceChunkSentMs?: number;
}

export interface LatencySample {
  valid: boolean;
  lagMs?: number;
  reason?: "stream-epoch-mismatch" | "future-audio" | "stale-audio" | "non-finite";
}

export const MAX_VALID_LIVE_LAG_MS = 10_000;
export const MAX_AUDIO_CLOCK_LEAD_MS = 250;

/**
 * Elapsed time on Deepgram's self-reported audio timeline (`timing.audioEndMs`,
 * itself derived from Deepgram's `start`/`duration` fields), not wall-clock
 * provider/network latency — Deepgram's own docs say `start`/`duration` should
 * not be used for precise latency measurement. See LATENCY-AUDIT.md and
 * lib/latency.ts's `SampleKey` doc comment for `"lag"`/`"interim_lag"`/
 * `"final_lag"`. Kept for audio/transcript alignment and back-compat with the
 * existing `latency_samples` columns — never label output of this function as
 * "latency" in UI copy. Use `chunkToInkSample` below for a true wall-clock
 * measurement of the same event.
 *
 * Never compares timestamps from different Deepgram socket epochs.
 */
export function liveLatencySample(
  inkedAtMs: number,
  timing: AudioTiming,
  activeStreamEpoch: number,
): LatencySample {
  if (![inkedAtMs, timing.audioEndMs, timing.streamEpoch, activeStreamEpoch].every(Number.isFinite)) {
    return { valid: false, reason: "non-finite" };
  }
  if (timing.streamEpoch !== activeStreamEpoch) {
    return { valid: false, reason: "stream-epoch-mismatch" };
  }
  const lagMs = Math.round(inkedAtMs - timing.audioEndMs);
  if (lagMs < -MAX_AUDIO_CLOCK_LEAD_MS) return { valid: false, reason: "future-audio" };
  if (lagMs > MAX_VALID_LIVE_LAG_MS) return { valid: false, reason: "stale-audio" };
  return { valid: true, lagMs: Math.max(0, lagMs) };
}

/**
 * True wall-clock speech-to-ink: last audio chunk sent → ink committed.
 * `sinceChunkSentMs` (chunk sent → Deepgram message received) plus the time
 * from message received to ink committed — no Deepgram `start`/`duration`
 * anywhere in this computation. This is the metric to use for real latency
 * claims; `liveLatencySample` above is not.
 *
 * Reuses the same stream-epoch guard as `liveLatencySample` so a reconnect
 * mid-utterance can't corrupt this measurement either.
 */
export function chunkToInkSample(
  inkedAtMs: number,
  timing: AudioTiming,
  activeStreamEpoch: number,
): LatencySample {
  if (timing.sinceChunkSentMs === undefined || timing.receivedAtMs === undefined) {
    return { valid: false, reason: "non-finite" };
  }
  if (
    ![inkedAtMs, timing.sinceChunkSentMs, timing.receivedAtMs, timing.streamEpoch, activeStreamEpoch].every(
      Number.isFinite,
    )
  ) {
    return { valid: false, reason: "non-finite" };
  }
  if (timing.streamEpoch !== activeStreamEpoch) {
    return { valid: false, reason: "stream-epoch-mismatch" };
  }
  const chunkToInkMs = Math.round(timing.sinceChunkSentMs + (inkedAtMs - timing.receivedAtMs));
  if (chunkToInkMs < -MAX_AUDIO_CLOCK_LEAD_MS) return { valid: false, reason: "future-audio" };
  if (chunkToInkMs > MAX_VALID_LIVE_LAG_MS) return { valid: false, reason: "stale-audio" };
  return { valid: true, lagMs: Math.max(0, chunkToInkMs) };
}
