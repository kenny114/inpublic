export interface AudioTiming {
  audioEndMs: number;
  streamEpoch: number;
}

export interface LatencySample {
  valid: boolean;
  lagMs?: number;
  reason?: "stream-epoch-mismatch" | "future-audio" | "stale-audio" | "non-finite";
}

export const MAX_VALID_LIVE_LAG_MS = 10_000;
export const MAX_AUDIO_CLOCK_LEAD_MS = 250;

/** Never compares timestamps from different Deepgram socket epochs. */
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

