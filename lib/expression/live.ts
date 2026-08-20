/**
 * Cadence controller for live speech: a stream of settled thoughts becomes a
 * paced sequence of pipeline runs.
 *
 * ExpressionSession deliberately has no cadence of its own — it processes one
 * segment and returns, which is exactly right for a text box and exactly
 * wrong for a microphone. Speech arrives in bursts, and a naive "run the
 * pipeline per settled thought" loop fires a model call per clause, several
 * concurrently, each seeing a world the others are about to change.
 *
 * So this does the three things the text path never needs, matching
 * lib/meaning/engine.ts's behaviour because the problem is the same one:
 *
 *  - DEBOUNCE. A burst of thoughts arriving close together is coalesced into
 *    one run instead of one per thought.
 *  - SERIALISE. At most one run is ever in flight. A thought that settles
 *    mid-run is buffered, never dropped and never fired concurrently — the
 *    world model is a sequence of folds, and two folds racing on the same
 *    state would silently lose one of them.
 *  - REPORT CONSUMPTION. `consumedIds` names the settled thoughts that
 *    contributed to a run which actually changed something, so the caller can
 *    fade their transcript ink. A run that produced no change never reports
 *    consumption, so that ink stays put.
 *
 * Knows nothing about Excalidraw, Deepgram, or React. It takes text in and
 * hands traces out, so the same controller drives a human speaking and an AI
 * agent submitting meaning.
 */

import { ExpressionSession, type ExpressionTrace, type SessionOptions } from "./pipeline";
import type { InputSegment, ScenePlan, WorldState } from "./schemas";

export interface ExpressionLiveUpdate {
  trace: ExpressionTrace;
  /** Settled-thought ids that contributed to this run. Empty when nothing changed. */
  consumedIds: string[];
}

export interface ExpressionLiveOptions extends SessionOptions {
  /** How long to wait after the last buffered thought before running. */
  debounceMs?: number;
  onUpdate: (update: ExpressionLiveUpdate) => void;
  /**
   * Fires once per run, changed or not. A no-op run matters just as much as a
   * change: "the engine correctly found nothing new" and "the engine is
   * broken and silently discarding everything" look identical from the canvas.
   */
  onTrace?: (trace: ExpressionTrace) => void;
}

const DEFAULT_DEBOUNCE_MS = 900;

interface Buffered {
  id: string;
  text: string;
}

export class ExpressionLiveController {
  private readonly session: ExpressionSession;
  private readonly debounceMs: number;
  private readonly opts: ExpressionLiveOptions;
  private buffer: Buffered[] = [];
  private inFlight = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  constructor(opts: ExpressionLiveOptions) {
    this.opts = opts;
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.session = new ExpressionSession({ extract: opts.extract, contextWindow: opts.contextWindow });
  }

  /** Buffers a settled thought and (re)schedules a debounced run. */
  submit(input: { id: string; text: string }): void {
    if (!input.text.trim()) return;
    this.buffer.push({ id: input.id, text: input.text });
    // While a run is in flight, flush() re-schedules itself on completion —
    // scheduling here too would stack timers for the same buffer.
    if (this.inFlight) return;
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
  }

  private async flush(): Promise<void> {
    if (this.inFlight || !this.buffer.length) return;
    const batch = this.buffer;
    this.buffer = [];
    this.inFlight = true;

    // The batch is one utterance as far as meaning is concerned: several
    // clauses a speaker produced in one breath. Joining them before
    // extraction is what lets "which creates a trust problem" be understood
    // against the clause it followed instead of on its own.
    const segment: InputSegment = {
      id: batch[batch.length - 1].id,
      source: "human_speech",
      text: batch.map((b) => b.text).join(" ").slice(0, 4000),
      seq: this.seq++,
    };

    try {
      const trace = await this.session.ingest(segment);
      this.opts.onTrace?.(trace);
      if (trace.changed) {
        this.opts.onUpdate({ trace, consumedIds: batch.map((b) => b.id) });
      }
    } catch {
      // A failed run must never take the session down or lose the buffer's
      // successors; the world simply does not advance this round.
    } finally {
      this.inFlight = false;
      // More speech settled mid-run: flush it on the same debounce cadence
      // rather than immediately, so a fast talker still gets coalesced
      // batches instead of a run per thought.
      if (this.buffer.length) this.schedule();
    }
  }

  getWorld(): WorldState {
    return this.session.getWorld();
  }

  getScene(): ScenePlan {
    return this.session.getScene();
  }

  /** New session or page: forget everything and cancel any pending run. */
  reset(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.buffer = [];
    this.seq = 0;
    this.session.reset();
  }
}
