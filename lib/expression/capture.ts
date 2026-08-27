/**
 * Live-session capture: records enough of every pipeline turn to
 * deterministically reconstruct a live session offline, without repeating
 * model extraction — see scripts/expression-live-replay.mjs for the replay
 * side of this.
 *
 * `ExpressionTrace` (lib/expression/pipeline.ts) already carries everything
 * a single turn decided: the settled input segment, the sanitized
 * MeaningDelta, identity/reference/discourse/metric resolutions, the
 * resulting WorldState before and after, the visibility snapshot, the
 * ExpressionPlan, the ScenePlan, and the RenderPatch (the canvas
 * operations). This module does not compute anything new — it just brackets
 * each trace with wall-clock timing (for correlating a captured session
 * against a recorded screen session afterwards) and buffers the stream in
 * memory until it is explicitly exported.
 *
 * A developer evaluation tool, not a product feature: nothing here uploads,
 * aggregates, or persists automatically. Same posture as
 * lib/sessionLog.ts's downloadLog — an on-demand, client-side JSON download,
 * gated by lib/features.ts's isLiveCaptureModeEnabled() (dev-only).
 */
import type { ExpressionTrace } from "./pipeline";

export interface CaptureTurn {
  index: number;
  /** Wall-clock ms (Date.now()), bracketing this turn's pipeline run — the correlation anchor for a recorded screen session. */
  wallClockStart: number;
  wallClockEnd: number;
  trace: ExpressionTrace;
}

export interface CaptureSessionData {
  version: 1;
  sessionId: string;
  /** ISO wall-clock time the capture session started. */
  startedAt: string;
  turns: CaptureTurn[];
}

/**
 * Buffers one live session's turns in memory. Call `recordTurn(trace)` from
 * wherever the pipeline's per-turn callback already fires (`onTrace` in
 * lib/expression/live.ts) — it fires once per run, changed or not, which is
 * exactly the granularity capture wants. `wallClockStart` is read from the
 * segment's own arrival timestamp (lib/expression/live.ts stamps it with
 * `Date.now()` when the debounced batch flushes) rather than a separately
 * threaded "call started" hook, so no change to the controller's call
 * signature was needed to add capture.
 */
export class LiveCaptureSession {
  readonly sessionId: string;
  readonly startedAt: number;
  private turns: CaptureTurn[] = [];

  constructor(sessionId: string = `capture-${Date.now()}`) {
    this.sessionId = sessionId;
    this.startedAt = Date.now();
  }

  recordTurn(trace: ExpressionTrace): void {
    const wallClockEnd = Date.now();
    const wallClockStart = trace.input.timestamp ?? wallClockEnd;
    this.turns.push({ index: this.turns.length, wallClockStart, wallClockEnd, trace });
  }

  get turnCount(): number {
    return this.turns.length;
  }

  toJSON(): CaptureSessionData {
    return {
      version: 1,
      sessionId: this.sessionId,
      startedAt: new Date(this.startedAt).toISOString(),
      turns: this.turns,
    };
  }

  reset(): void {
    this.turns = [];
  }
}

function downloadArtifact(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** On-demand client-side JSON download — see scripts/expression-live-replay.mjs for how to feed the file back in. */
export function downloadCapture(session: LiveCaptureSession): void {
  const payload = session.toJSON();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  downloadArtifact(blob, `expression-capture-${stamp}.json`);
}
