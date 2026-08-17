/**
 * Absolute source-clock pacing for the development replay harness.
 *
 * This module deliberately knows nothing about microphone capture or
 * WebSockets. A caller supplies the next unsent chunk's source time and a
 * monotonic wall-clock time; the scheduler supplies its absolute deadline.
 */

export const REPLAY_CHUNK_CADENCE_MS = 80;

/**
 * Timer jitter close to one 80 ms chunk must remain attached to the original
 * source clock. Lateness beyond two complete chunk cadences means at least two
 * packets are already overdue, which is transport interruption rather than
 * ordinary 3-9 ms timer noise. Rebasing at 160 ms prevents a queued-audio
 * catch-up burst while leaving ample margin for normal browser timer jitter.
 */
export const REPLAY_STALL_THRESHOLD_MS = REPLAY_CHUNK_CADENCE_MS * 2;

export type ReplayRebaseReason = "genuine_stall" | "reconnect";

export interface ReplayRebase {
  sequence: number;
  reason: ReplayRebaseReason;
  sourceTimeMs: number;
  atMonotonicMs: number;
  previousAnchorMs: number;
  newAnchorMs: number;
  addedIntentionalDelayMs: number;
  totalIntentionalDelayMs: number;
}

export interface ReplaySendDeadline {
  targetAtMs: number;
  delayMs: number;
  latenessMs: number;
  sourceClockDriftMs: number;
  intentionalRebaseDelayMs: number;
  rebase: ReplayRebase | null;
}

export interface ReplayAbsoluteSchedulerOptions {
  stallThresholdMs?: number;
}

export function mayUseReplayScheduler(captureKind: string): boolean {
  return captureKind === "replay-pcm16";
}

export class ReplayAbsoluteScheduler {
  private anchorMs: number;
  private readonly originalAnchorMs: number;
  private readonly stallThresholdMs: number;
  private readonly rebases: ReplayRebase[] = [];

  constructor(anchorMonotonicMs: number, options: ReplayAbsoluteSchedulerOptions = {}) {
    this.anchorMs = anchorMonotonicMs;
    this.originalAnchorMs = anchorMonotonicMs;
    this.stallThresholdMs = options.stallThresholdMs ?? REPLAY_STALL_THRESHOLD_MS;
    if (!Number.isFinite(this.stallThresholdMs) || this.stallThresholdMs <= 0) {
      throw new Error("Replay stall threshold must be a positive finite duration");
    }
  }

  targetFor(sourceTimeMs: number): number {
    return this.anchorMs + sourceTimeMs;
  }

  get intentionalRebaseDelayMs(): number {
    return this.anchorMs - this.originalAnchorMs;
  }

  get rebaseHistory(): readonly ReplayRebase[] {
    return this.rebases;
  }

  /** Explicit transport interruptions always resume at the next unsent chunk. */
  rebase(sourceTimeMs: number, nowMonotonicMs: number, reason: ReplayRebaseReason): ReplayRebase {
    const previousAnchorMs = this.anchorMs;
    const newAnchorMs = nowMonotonicMs - sourceTimeMs;
    this.anchorMs = newAnchorMs;
    const rebase: ReplayRebase = {
      sequence: this.rebases.length + 1,
      reason,
      sourceTimeMs,
      atMonotonicMs: nowMonotonicMs,
      previousAnchorMs,
      newAnchorMs,
      addedIntentionalDelayMs: newAnchorMs - previousAnchorMs,
      totalIntentionalDelayMs: this.intentionalRebaseDelayMs,
    };
    this.rebases.push(rebase);
    return rebase;
  }

  /**
   * Resolve the next absolute deadline immediately before sending. A browser
   * pause that makes multiple chunks overdue rebases once at this next unsent
   * chunk; ordinary jitter keeps the existing anchor.
   */
  resolve(sourceTimeMs: number, nowMonotonicMs: number, forceReason?: ReplayRebaseReason): ReplaySendDeadline {
    let targetAtMs = this.targetFor(sourceTimeMs);
    let latenessMs = nowMonotonicMs - targetAtMs;
    let rebase: ReplayRebase | null = null;
    if (forceReason || latenessMs > this.stallThresholdMs) {
      rebase = this.rebase(sourceTimeMs, nowMonotonicMs, forceReason ?? "genuine_stall");
      targetAtMs = this.targetFor(sourceTimeMs);
      latenessMs = nowMonotonicMs - targetAtMs;
    }
    return {
      targetAtMs,
      delayMs: Math.max(0, targetAtMs - nowMonotonicMs),
      latenessMs,
      sourceClockDriftMs: latenessMs,
      intentionalRebaseDelayMs: this.intentionalRebaseDelayMs,
      rebase,
    };
  }
}
