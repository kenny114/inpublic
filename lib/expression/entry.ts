/**
 * The agent entry point: anything that can produce meaning asks for visual
 * expression here.
 *
 * There is deliberately almost nothing in this file, and that is the result
 * worth stating. "An agent can drive the board" needed no second drawing
 * system, no parallel schema and no separate renderer, because the pipeline
 * was already source-agnostic:
 *
 *   - `InputSegment.source` has carried `"ai_agent"` since the schema was
 *     written (lib/expression/schemas.ts), and nothing below the segment
 *     ever asks where the meaning came from;
 *   - `ExpressionSession.ingestDelta` is documented as the agent path — feed
 *     meaning in and skip extraction entirely;
 *   - `ExpressionLiveController` "takes text in and hands traces out, so the
 *     same controller drives a human speaking and an AI agent submitting
 *     meaning".
 *
 * So this is a facade over `ExpressionLiveController.express`, not a path
 * around it. Everything an agent's submission goes through — debounce,
 * serialisation, the world fold, intent, plan, compose, the patch/full
 * decision, the evaluator, the canvas sync — is the same code the microphone
 * drives, running in the same session against the same world. An agent
 * sentence and a spoken sentence can interleave in one conversation and the
 * engine cannot tell them apart, which is the property that makes "agents
 * are an input" true rather than aspirational.
 *
 * Two ways in, and the difference is only how much work the caller has
 * already done:
 *
 *   express({ text })   the caller has words. Identical to a settled thought:
 *                       the text goes to /api/express for extraction.
 *   express({ delta })  the caller has structured meaning already. No
 *                       extraction request is made — the delta goes straight
 *                       into the world fold.
 *
 * What this is NOT, deliberately: a way to hand the board shapes. There is
 * no path from here to a coordinate, an Excalidraw element, or a chosen
 * diagram type. A caller may say what it MEANS; what that looks like stays
 * the engine's decision, exactly as it is for speech.
 */

import type { ExpressionLiveController, ExpressionOutcome } from "./live";
import type { ExpressionTrace } from "./pipeline";
import { MeaningDeltaSchema, type GrammarId, type IntentType, type MeaningDelta } from "./schemas";

export interface ExpressRequest {
  /**
   * What to express, in words. Required unless `delta` is given, in which
   * case it defaults to the delta's own `interpretation` — the segment still
   * needs text because provenance, the extractor's rolling context window
   * and the session log all record what was said, not only what it meant.
   */
  text?: string;
  /** Meaning the caller already has. Skips extraction; validated before it is accepted. */
  delta?: MeaningDelta;
  /** Caller-chosen id, echoed back. Generated when absent. */
  id?: string;
  /** Who this is from — a slug like "codex" or "research-agent". Carried into provenance, never interpreted. */
  speakerId?: string;
}

/**
 * A run's outcome, flattened for a caller that wants an answer rather than a
 * trace. `mode` is Track B's patch/full decision, so an agent extending a
 * structure it built earlier can see that the board extended rather than
 * redrew. The full ExpressionTrace is still attached for anything that wants
 * to look deeper.
 */
export interface ExpressResult {
  id: string;
  status: ExpressionOutcome["status"];
  mode?: ExpressionTrace["mode"];
  intent?: IntentType;
  grammar?: GrammarId;
  /** The planner's own explanation — the one line worth logging on a failure. */
  reason?: string;
  objects?: number;
  connectors?: number;
  /** Set when status is "failed": a rejected request or a run that threw. */
  error?: string;
  trace?: ExpressionTrace;
}

export interface ExpressionEntryOptions {
  /**
   * Called the moment a request is accepted, before any pipeline work — the
   * hook Board uses to write the Phase 0 `expression/submitted` event, so an
   * agent's turn appears in the session log exactly where a spoken one does.
   * Kept as a callback rather than a log import because this module has no
   * business knowing what a session log is.
   */
  onSubmit?: (accepted: { id: string; text: string; structured: boolean }) => void;
}

export interface ExpressionEntry {
  express(request: ExpressRequest): Promise<ExpressResult>;
}

let counter = 0;

function nextId(): string {
  counter += 1;
  return `agent-${Date.now().toString(36)}-${counter}`;
}

function failed(id: string, error: string): ExpressResult {
  return { id, status: "failed", error };
}

/** The segment text cap (schemas.ts's InputSegmentSchema), applied before the schema can reject it. */
const TEXT_LIMIT = 4000;

export function createExpressionEntry(
  controller: ExpressionLiveController,
  options: ExpressionEntryOptions = {},
): ExpressionEntry {
  return {
    async express(request: ExpressRequest): Promise<ExpressResult> {
      const id = request.id ?? nextId();

      let delta: MeaningDelta | undefined;
      if (request.delta !== undefined) {
        // A caller-supplied delta is untrusted input at exactly the same
        // level a model's output is, and it enters the world fold at exactly
        // the same point — so it is validated by exactly the same schema.
        // That is also what keeps geometry out: MeaningDeltaSchema rejects
        // coordinates, so "express this" can never become "draw this here".
        const parsed = MeaningDeltaSchema.safeParse(request.delta);
        if (!parsed.success) {
          return failed(id, `delta rejected: ${parsed.error.issues[0]?.message ?? "invalid"}`);
        }
        delta = parsed.data;
      }

      const text = (request.text ?? delta?.interpretation ?? "").trim().slice(0, TEXT_LIMIT);
      if (!text) return failed(id, "nothing to express: neither text nor a delta with an interpretation");

      options.onSubmit?.({ id, text, structured: Boolean(delta) });

      const outcome = await controller.express({ id, text, delta, source: "ai_agent", speakerId: request.speakerId });
      const trace = outcome.trace;
      return {
        id,
        status: outcome.status,
        mode: trace?.mode,
        intent: trace?.intent.primary,
        grammar: trace?.plan.grammar,
        reason: trace?.plan.reason,
        objects: trace?.scene.objects.length,
        connectors: trace?.scene.connectors.length,
        error: outcome.error ? (outcome.error instanceof Error ? outcome.error.message : String(outcome.error)) : undefined,
        trace,
      };
    },
  };
}
