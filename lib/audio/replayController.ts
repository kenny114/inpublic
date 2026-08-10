/**
 * Audio Replay Mode's timing brain. Everything in this module is pure state
 * tracking, no React/DOM/network — it can be unit tested without a browser
 * or an <audio> element, and components/AudioReplayPanel.tsx is the only
 * caller.
 *
 * v2 — producer/consumer scheduler, replacing the onTimeUpdate-driven model.
 *
 * The bug this rewrite exists to fix: the previous version tracked lag as
 * `audioTime - displayedThroughTime` and drove EVERY piece of work
 * (prefetch, due-segment processing, AND the pause/resume decision) from the
 * <audio> element's own `timeupdate` event. Once lag crossed the pause
 * threshold, the caller paused the <audio> element — which stops
 * `timeupdate` from firing at all (browser behaviour, not a bug) — which
 * stopped prefetch AND due-segment processing AND the lag recheck, forever.
 * A segment could sit fully prepared in cache and never get displayed,
 * because "due" required `audioTime` to reach its startTime, and `audioTime`
 * could never move again. Reproduced on a real 385s lecture: paused at
 * audioTime=16.81s, committedVisualTime=14.72s, and never recovered for the
 * rest of the file.
 *
 * The fix separates "is the audio clock allowed to advance" from "is the
 * preparation pipeline making progress" into two independently-driven
 * concerns:
 *  - audioTime: where the <audio> element's playhead actually is.
 *  - processedThroughTime: how much of the timeline has been analyzed
 *    (chunked, topic/math-detected) — deterministic local work, not
 *    model-call-bound, so in practice this jumps to the full duration the
 *    moment the timeline is built.
 *  - preparedThroughTime: the latest segment end time whose draw response
 *    has been fetched and cached, READY but not necessarily shown yet. This
 *    advances via a background worker that runs on its own interval,
 *    independent of whether the <audio> element is playing, paused, or not
 *    firing events — so preparation never stalls just because playback did.
 *  - displayedThroughTime: the latest segment end time whose actions have
 *    actually landed on the canvas (applyActions resolved).
 *
 * Pause/resume is driven by how far `audioTime` has run past the "safe
 * frontier" — displayedThroughTime, extended for free through any silence
 * before the next segment that actually needs a visual (so idle transcript
 * gaps never count as lag) — and resume additionally requires the next
 * pending segment to already be PREPARED (cached), not merely for lag to
 * have numerically dropped. Since preparation keeps running while paused,
 * that condition is guaranteed to become true eventually, which is what
 * makes this version deadlock-free: pausing can no longer disable the one
 * thing that would let it un-pause.
 */

export type ReplayState =
  | "idle"
  | "buffering"
  | "playing"
  | "slowing"
  | "seeking"
  | "paused"
  | "ended";

type LagMode = "normal" | "slow" | "buffer";

export interface ReplayControllerSnapshot {
  audioTime: number;
  processedThroughTime: number;
  preparedThroughTime: number;
  displayedThroughTime: number;
  replayState: ReplayState;
  lagMs: number;
  playbackRate: number;
  isBuffering: boolean;
}

export interface ReplayControllerOptions {
  /** How many seconds of transcript/visual events to prepare before playback is allowed to start. */
  initialBufferSeconds?: number;
  /** How far ahead of audioTime the background worker tries to keep preparedThroughTime. */
  lookaheadSeconds?: number;
  /** Lag above this enters "slowing" (from normal). */
  slowEnterMs?: number;
  /** Lag must drop below this to leave "slowing" and return to normal. */
  slowExitMs?: number;
  /** Lag above this enters "buffering" (pause) from any mode. */
  bufferEnterMs?: number;
  /** Lag must drop below this — AND the next pending segment must be prepared — to leave "buffering". */
  bufferExitMs?: number;
  /** Playback rate used while lag is between normal and the buffering threshold. */
  slowedPlaybackRate?: number;
  onSnapshot?: (snapshot: ReplayControllerSnapshot) => void;
}

const DEFAULTS: Required<Omit<ReplayControllerOptions, "onSnapshot">> = {
  initialBufferSeconds: 6,
  lookaheadSeconds: 6,
  slowEnterMs: 1200,
  slowExitMs: 700,
  bufferEnterMs: 2200,
  bufferExitMs: 900,
  slowedPlaybackRate: 0.85,
};

export interface PlaybackDirective {
  /** What audio.playbackRate should be set to right now. */
  targetRate: number;
  /** True if the caller should pause the <audio> element until visuals catch up. */
  shouldPause: boolean;
  lagMs: number;
}

export interface EvaluateInput {
  /**
   * startTime of the earliest not-yet-displayed segment that actually needs
   * a visual (non-empty transcript), or undefined if every remaining
   * segment is already displayed. Silence before this point is free — it
   * does not count toward lag, per the "known silence must not be counted
   * as unprocessed visual lag" requirement.
   */
  nextPendingStartTime?: number;
}

export class ReplayController {
  private opts: Required<Omit<ReplayControllerOptions, "onSnapshot">>;
  private onSnapshot?: (snapshot: ReplayControllerSnapshot) => void;

  private generation = 0;
  private audioTime = 0;
  private processedThroughTime = 0;
  private preparedThroughTime = 0;
  private displayedThroughTime = 0;
  private replayState: ReplayState = "idle";
  private playbackRate = 1;
  private mode: LagMode = "normal";
  private lastLagMs = 0;
  private shutdownFlag = false;

  constructor(options: ReplayControllerOptions = {}) {
    const { onSnapshot, ...rest } = options;
    this.opts = { ...DEFAULTS, ...rest };
    this.onSnapshot = onSnapshot;
  }

  get initialBufferSeconds(): number {
    return this.opts.initialBufferSeconds;
  }

  get lookaheadSeconds(): number {
    return this.opts.lookaheadSeconds;
  }

  /** Identifies the current playback/seek epoch — bumped by beginSeek() and shutdown(). Callers tag in-flight async work with this and check isStale() before committing results. */
  get currentGeneration(): number {
    return this.generation;
  }

  isStale(generation: number): boolean {
    return this.shutdownFlag || generation !== this.generation;
  }

  snapshot(): ReplayControllerSnapshot {
    return {
      audioTime: this.audioTime,
      processedThroughTime: this.processedThroughTime,
      preparedThroughTime: this.preparedThroughTime,
      displayedThroughTime: this.displayedThroughTime,
      replayState: this.replayState,
      lagMs: this.lastLagMs,
      playbackRate: this.playbackRate,
      isBuffering: this.replayState === "buffering",
    };
  }

  private emit(): void {
    if (this.shutdownFlag) return;
    this.onSnapshot?.(this.snapshot());
  }

  // --- state transitions ----------------------------------------------------

  beginInitialBuffering(): void {
    this.replayState = "buffering";
    this.emit();
  }

  /** Called once the initial buffer window has been fully drawn — playback may now begin. */
  readyToPlay(): void {
    this.replayState = "paused";
    this.mode = "normal";
    this.emit();
  }

  markProcessed(throughTime: number): void {
    this.processedThroughTime = Math.max(this.processedThroughTime, throughTime);
    this.emit();
  }

  /** Background worker calls this once a segment's draw response is fetched and cached — independent of whether it has been displayed yet. */
  markPrepared(throughTime: number): void {
    this.preparedThroughTime = Math.max(this.preparedThroughTime, throughTime);
    this.emit();
  }

  markDisplayed(throughTime: number): void {
    this.displayedThroughTime = Math.max(this.displayedThroughTime, throughTime);
    this.emit();
  }

  updateAudioTime(t: number): void {
    this.audioTime = t;
    this.emit();
  }

  /**
   * Call on a fixed interval that runs regardless of play/pause state — NOT
   * from the <audio> element's timeupdate, which stops firing while paused
   * and was the root cause of the deadlock this version fixes. Computes the
   * safe frontier (displayedThroughTime, extended through any silence gap
   * that doesn't need a visual), the resulting lag, and applies hysteresis
   * so playbackRate doesn't warble across a threshold.
   */
  evaluate(input: EvaluateInput = {}): PlaybackDirective {
    const frontier = input.nextPendingStartTime === undefined
      ? this.audioTime
      : Math.max(this.displayedThroughTime, Math.min(this.audioTime, input.nextPendingStartTime));
    const lagMs = Math.max(0, (this.audioTime - frontier) * 1000);
    this.lastLagMs = lagMs;

    const nextIsPrepared = input.nextPendingStartTime === undefined ||
      this.preparedThroughTime >= input.nextPendingStartTime;

    let mode = this.mode;
    if (mode === "buffer") {
      if (lagMs < this.opts.bufferExitMs && nextIsPrepared) {
        mode = lagMs > this.opts.slowEnterMs ? "slow" : "normal";
      }
    } else if (mode === "slow") {
      if (lagMs > this.opts.bufferEnterMs) mode = "buffer";
      else if (lagMs < this.opts.slowExitMs) mode = "normal";
    } else {
      if (lagMs > this.opts.bufferEnterMs) mode = "buffer";
      else if (lagMs > this.opts.slowEnterMs) mode = "slow";
    }
    this.mode = mode;
    this.playbackRate = mode === "normal" ? 1 : this.opts.slowedPlaybackRate;
    this.replayState = mode === "buffer"
      ? "buffering"
      : mode === "slow"
        ? "slowing"
        : this.replayState === "seeking" ? "seeking" : "playing";
    this.emit();
    return { targetRate: this.playbackRate, shouldPause: mode === "buffer", lagMs };
  }

  pause(): void {
    this.replayState = "paused";
    this.emit();
  }

  end(): void {
    this.replayState = "ended";
    this.emit();
  }

  /**
   * Bumps the generation counter, invalidating any in-flight draw work
   * dispatched under the previous generation — callers should have captured
   * `currentGeneration` before starting async work and check `isStale()`
   * before committing its result to the canvas, so a late response from
   * before the seek can't paint over wherever the user jumped to.
   */
  beginSeek(): number {
    this.generation += 1;
    this.replayState = "seeking";
    this.emit();
    return this.generation;
  }

  /** Rebuild controller time state from the nearest checkpoint at/before the seek target, rather than trusting whatever was in flight before the jump. */
  completeSeek(newAudioTime: number, resumeFromTime: number): void {
    this.audioTime = newAudioTime;
    this.processedThroughTime = Math.max(this.processedThroughTime, resumeFromTime);
    this.preparedThroughTime = resumeFromTime;
    this.displayedThroughTime = resumeFromTime;
    this.mode = "normal";
    this.replayState = "paused";
    this.emit();
  }

  /**
   * Idempotent full shutdown — called once from AudioReplayPanel's unmount
   * cleanup. Bumps generation (so isStale() is true for every previously
   * captured generation, invalidating anything still in flight) and
   * detaches the snapshot callback so no further React state updates can
   * happen after the component is gone.
   */
  shutdown(): void {
    if (this.shutdownFlag) return;
    this.shutdownFlag = true;
    this.generation += 1;
    this.replayState = "ended";
    this.onSnapshot = undefined;
  }
}
