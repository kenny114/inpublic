/**
 * Visual Re-entry V1.1 lifecycle.
 *
 * Decision/grounding and rendering/commit are deliberately separate. A
 * grounded spec is durable data: continued speech may delay its placement,
 * but does not invalidate it. Geometry is only built against the current pen
 * after the caller reports a safe speech gap.
 */

import type { Pen } from "../ops";
import type { LogEventInput } from "../types";
import type { ReplayExperimentMode } from "../replayLab";
import { evaluateVisualCandidate } from "./candidate";
import { requestVisualIntent } from "./client";
import { groundDecision } from "./ground";
import { buildVisual } from "./render";
import { tryDeterministicVisualIntent, type VisualDecisionSource } from "./fastPath";
import type { SettledThought, VisualReentrySpec } from "./types";
import { REASON_MODEL_UNAVAILABLE, REASON_PARSE_FAILED, REASON_REQUEST_REJECTED } from "./types";

const FAILURE_REASONS = new Set<string>([REASON_MODEL_UNAVAILABLE, REASON_PARSE_FAILED, REASON_REQUEST_REJECTED]);
const SOURCE_EXCERPT_MAX = 80;
const SUPPORTED_APPROXIMATION = /\b(?:about|around|roughly|approximately)\b/i;

function excerpt(text: string): string {
  return text.length > SOURCE_EXCERPT_MAX ? `${text.slice(0, SOURCE_EXCERPT_MAX)}…` : text;
}

export interface PreparedVisualReentry {
  thought: SettledThought;
  spec: VisualReentrySpec;
  decidedAt: number;
  decisionLatencyMs: number;
  decisionSource: VisualDecisionSource;
  candidateCompletedAt: number;
}

export interface PrepareVisualReentryContext {
  signal: AbortSignal;
  log: (event: LogEventInput) => void;
  now?: () => number;
  experimentMode?: "vr_decision" | "vr_full";
  candidateCompletedAt?: number;
}

export interface CommitPreparedVisualContext {
  pen: Pen;
  isSafe: () => boolean;
  isRelevant: () => boolean;
  /** Guards the exact pen revision used by the async renderer. */
  isPlacementCurrent?: () => boolean;
  commitVisual: (elements: unknown[]) => void;
  revealIfNeeded: (bounds: { x: number; y: number; w: number; h: number }) => void;
  log: (event: LogEventInput) => void;
  now?: () => number;
  build?: typeof buildVisual;
}

/** Real request + parse + grounding. Never builds geometry or mutates a pen. */
export async function prepareVisualReentry(
  thought: SettledThought,
  ctx: PrepareVisualReentryContext,
): Promise<PreparedVisualReentry | null> {
  const now = ctx.now ?? Date.now;
  const candidateCompletedAt = ctx.candidateCompletedAt ?? now();
  const fastStartedAt = now();
  const candidateFamily = evaluateVisualCandidate(thought.text).family;
  ctx.log({ type: "visual-reentry", event: "fast-path-attempted", thoughtId: thought.id });
  const fast = tryDeterministicVisualIntent(thought);
  let intent: VisualReentrySpec | Awaited<ReturnType<typeof requestVisualIntent>>;
  let decisionSource: VisualDecisionSource;
  let decisionLatencyMs: number;
  if (fast.intent) {
    intent = fast.intent;
    decisionSource = "deterministic_fast_path";
    decisionLatencyMs = now() - fastStartedAt;
    ctx.log({
      type: "visual-reentry",
      event: "fast-path-succeeded",
      thoughtId: thought.id,
      reason: fast.reason,
      decisionSource,
      visualFamily: fast.intent.type,
      ...(fast.intent.type === "quantitative_change" ? {
        fromModality: fast.intent.fromQualifier ? "approximate" as const : "exact" as const,
        toModality: fast.intent.toQualifier ? "approximate" as const : "exact" as const,
      } : {}),
      candidateCompleteToIntentMs: now() - candidateCompletedAt,
    });
  } else {
    ctx.log({ type: "visual-reentry", event: "fast-path-rejected", thoughtId: thought.id, reason: fast.reason });
    decisionSource = "model_fallback";
    ctx.log({
      type: "visual-reentry",
      event: "model-fallback-started",
      thoughtId: thought.id,
      decisionSource,
      visualFamily: candidateFamily,
      approximationPresent: SUPPORTED_APPROXIMATION.test(thought.text),
    });
    const decisionStartedAt = now();
    ctx.log({ type: "visual-reentry", event: "decision-started", thoughtId: thought.id, decisionSource });
    intent = await requestVisualIntent(thought.text, ctx.signal);
    decisionLatencyMs = now() - decisionStartedAt;
    ctx.log({ type: "visual-reentry", event: "decision-ended", thoughtId: thought.id, decisionLatencyMs, decisionSource });
  }

  // V1.1 only aborts on reset/teardown. Ordinary continued speech is not a
  // staleness condition; a valid result waits for a safe placement window.
  if (ctx.signal.aborted) {
    ctx.log({ type: "visual-reentry", event: "request-aborted", thoughtId: thought.id });
    ctx.log({ type: "visual-reentry", event: "stale-result-dropped", thoughtId: thought.id });
    return null;
  }

  if (intent.type === "none") {
    const isPipelineFailure = FAILURE_REASONS.has(intent.reason);
    ctx.log({
      type: "visual-reentry",
      event: isPipelineFailure ? "parse-failed" : "decision-none",
      thoughtId: thought.id,
      reason: intent.reason,
      decisionLatencyMs,
      decisionSource,
    });
    return null;
  }

  ctx.log({
    type: "visual-reentry",
    event: intent.type === "enumeration" ? "decision-enumeration" : intent.type === "quantitative_change" ? "decision-quantitative" : intent.type === "sequence" ? "decision-sequence" : intent.type === "cause_effect" ? "decision-cause-effect" : "decision-comparison",
    thoughtId: thought.id,
    decisionLatencyMs,
    decisionSource,
    visualFamily: intent.type,
  });
  if (ctx.experimentMode === "vr_decision") return null;

  const { decision: grounded, result } = groundDecision(intent, thought);
  if (grounded.type === "none") {
    ctx.log({ type: "visual-reentry", event: "grounding-failed", thoughtId: thought.id, reason: result.reason, decisionSource, visualFamily: intent.type });
    return null;
  }
  ctx.log({ type: "visual-reentry", event: "grounding-passed", thoughtId: thought.id, decisionSource, visualFamily: grounded.type });

  const prepared = {
    thought,
    spec: grounded,
    decidedAt: now(),
    decisionLatencyMs,
    decisionSource,
    candidateCompletedAt,
  } satisfies PreparedVisualReentry;
  ctx.log({ type: "visual-reentry", event: "durable-result-ready", thoughtId: thought.id, decisionSource, visualFamily: grounded.type, candidateCompleteToDurableReadyMs: now() - candidateCompletedAt });
  return prepared;
}

/** Builds against a disposable current-pen clone, then atomically commits. */
export async function commitPreparedVisualReentry(
  prepared: PreparedVisualReentry,
  ctx: CommitPreparedVisualContext,
): Promise<"committed" | "held" | "dropped"> {
  const now = ctx.now ?? Date.now;
  const thoughtId = prepared.thought.id;
  if (!ctx.isRelevant()) {
    ctx.log({ type: "visual-reentry", event: "durable-result-expired", thoughtId, reason: "thought no longer belongs to the active page/session" });
    return "dropped";
  }
  if (!ctx.isSafe()) return "held";

  const renderStartedAt = now();
  ctx.log({ type: "visual-reentry", event: "render-started", thoughtId });
  const penSnapshot: Pen = { ...ctx.pen };
  const built = await (ctx.build ?? buildVisual)(prepared.spec, penSnapshot);
  const renderLatencyMs = now() - renderStartedAt;
  if (!built) return "dropped";

  if (!ctx.isRelevant()) {
    ctx.log({ type: "visual-reentry", event: "durable-result-expired", thoughtId, renderLatencyMs, reason: "page/session changed while rendering" });
    return "dropped";
  }
  if (!ctx.isSafe()) {
    ctx.log({ type: "visual-reentry", event: "durable-result-held", thoughtId, renderLatencyMs, reason: "speech resumed while rendering" });
    return "held";
  }
  if (ctx.isPlacementCurrent && !ctx.isPlacementCurrent()) {
    ctx.log({ type: "visual-reentry", event: "durable-result-held", thoughtId, renderLatencyMs, reason: "placement changed while rendering" });
    return "held";
  }

  Object.assign(ctx.pen, penSnapshot);
  ctx.commitVisual(built.elements);
  ctx.log({ type: "visual-reentry", event: "render-completed", thoughtId, renderLatencyMs });
  ctx.log({ type: "visual-reentry", event: "durable-result-committed", thoughtId, decisionSource: prepared.decisionSource, visualFamily: prepared.spec.type, candidateCompleteToCommitMs: now() - prepared.candidateCompletedAt });
  ctx.revealIfNeeded({ x: built.x, y: built.y, w: built.w, h: built.h });
  return "committed";
}

/** Compatibility wrapper used by isolated tests and non-queued callers. */
export interface VisualReentryContext {
  pen: Pen;
  signal: AbortSignal;
  isFresh: () => boolean;
  commitVisual: (elements: unknown[]) => void;
  revealIfNeeded: (bounds: { x: number; y: number; w: number; h: number }) => void;
  log: (event: LogEventInput) => void;
  now?: () => number;
  experimentMode?: Exclude<ReplayExperimentMode, "v2_only">;
}

export async function runVisualReentry(thought: SettledThought, ctx: VisualReentryContext): Promise<void> {
  ctx.log({ type: "visual-reentry", event: "thought-received", thoughtId: thought.id, sourceExcerpt: excerpt(thought.text) });
  const candidate = evaluateVisualCandidate(thought.text);
  ctx.log({
    type: "visual-reentry",
    event: candidate.candidate ? "candidate-accepted" : "candidate-rejected",
    thoughtId: thought.id,
    reason: candidate.reason,
  });
  if (!candidate.candidate || ctx.experimentMode === "vr_shell") return;

  const prepared = await prepareVisualReentry(thought, {
    signal: ctx.signal,
    log: ctx.log,
    now: ctx.now,
    experimentMode: ctx.experimentMode === "vr_decision" ? "vr_decision" : "vr_full",
    candidateCompletedAt: (ctx.now ?? Date.now)(),
  });
  if (!prepared) return;
  await commitPreparedVisualReentry(prepared, {
    pen: ctx.pen,
    isSafe: ctx.isFresh,
    isRelevant: ctx.isFresh,
    commitVisual: ctx.commitVisual,
    revealIfNeeded: ctx.revealIfNeeded,
    log: ctx.log,
    now: ctx.now,
  });
}
