/**
 * Visual Pulse — brief, deterministic settle animations for content that is
 * already true and already on the sheet.
 *
 * This is NOT a way to manufacture activity. It never invents words, never
 * animates content the speaker hasn't said, and never delays information —
 * every pulse animates an element that is already visible at its final text.
 * It only gives an existing, truthful mark a moment of temporal life: a
 * speculative guess fading in as it's confirmed, a promoted guess settling
 * to full opacity instead of snapping there, a retracted one fading out
 * instead of vanishing. See LATENCY-AUDIT.md's brief, Part 5.
 *
 * Deliberately built as two pure/small pieces so each is independently
 * testable and neither can block the live-ink path:
 *
 * - `opacityPulse` computes the keyframes. Pure, synchronous, no timers.
 * - `runPulse` schedules them with `setTimeout` (not `requestAnimationFrame`
 *   — a handful of `commit()` calls over ~150-250ms doesn't need frame
 *   precision, and setTimeout composes more simply with the cancellation
 *   check every call site needs anyway) and is cancellable at every step.
 */

export interface PulseStep {
  /** Opacity to apply at this step, 0-100 (Excalidraw's own scale). */
  opacity: number;
  /** Milliseconds after the pulse starts that this step fires. */
  delayMs: number;
}

/**
 * A short, deterministic ramp from one opacity to another.
 *
 * `steps` and `durationMs` default to a value that reads as "settling" rather
 * than "blinking" — under ~250ms per the brief, a handful of steps so it's a
 * visible ramp rather than a single jump.
 */
export function opacityPulse(from: number, to: number, steps = 4, durationMs = 200): PulseStep[] {
  const clampedSteps = Math.max(1, Math.round(steps));
  const out: PulseStep[] = [];
  for (let i = 1; i <= clampedSteps; i++) {
    const t = i / clampedSteps;
    out.push({
      opacity: Math.round(from + (to - from) * t),
      delayMs: Math.round(durationMs * t),
    });
  }
  return out;
}

export interface RunningPulse {
  /** Stop any steps that haven't fired yet. Already-fired steps are not undone. */
  cancel: () => void;
}

/**
 * Schedule a precomputed sequence of opacity steps.
 *
 * `isCancelled` is checked immediately before every step, not just once at
 * the start — the caller's own epoch/generation guard (the same pattern
 * `writeLive` uses for `liveSeqRef`) is what keeps this from ever touching a
 * board state it was computed against but that has since changed (a clear,
 * an undo, a page turn). A step that finds itself cancelled is simply
 * skipped, not retried — a stale pulse has nothing correct left to animate
 * toward.
 */
export function runPulse(
  steps: PulseStep[],
  apply: (opacity: number) => void,
  isCancelled: () => boolean,
): RunningPulse {
  const timers = steps.map((step) =>
    setTimeout(() => {
      if (isCancelled()) return;
      apply(step.opacity);
    }, step.delayMs),
  );
  return {
    cancel: () => {
      for (const timer of timers) clearTimeout(timer);
    },
  };
}
