/**
 * The persistent, patient half of the Director.
 *
 * lib/director.ts's `detectComparison`/`detectProcessSignal` are stateless —
 * each call only ever sees one beat's transcript. Neither of them, alone,
 * can recognize a process: "first X, then Y, then Z, then W" is four
 * separate beats, each of which yields at most one directed edge. This
 * module is what accumulates those edges into a hypothesis across beats,
 * decides when a hypothesis has enough evidence to commit, and arbitrates
 * when Comparison and Process both have a claim on the same beat.
 *
 * Everything here is deterministic and pure: `advanceDirector` takes a state
 * and returns a new state plus an intent, the same "pure function called
 * from runBeat" shape `detectComparison` already used, just with state
 * threaded through instead of thrown away every beat. No model, no network,
 * no new serial stage in the pipeline — it reasons over the SemanticBoard
 * and a bounded window of recent beats, never the full transcript.
 */

import {
  detectComparison,
  detectProcessSignal,
  type ComparisonEvidence,
  type ProcessSignalEvidence,
} from "./director";
import type { SemanticBoard } from "./semantic";
import type { LogEventInput } from "./types";

export type StructureKind = "comparison" | "process";
// Deliberately kept separate from any future "expression" dimension (sketch /
// chart / equation / animated transformation — none of this is built in V1).
// A structure (WHAT the thought is) and its expression (HOW it's drawn) are
// different axes; nothing here assumes they're the same, so a future
// `expressionKind` field can be added to a hypothesis/intent later without
// reshaping this type.

/**
 * Ordinal, categorical evidence — never a synthesized percentage. Only
 * "sufficient" can ever produce a commit.
 */
export type EvidenceLevel = "none" | "weak" | "developing" | "strong" | "sufficient";

const EVIDENCE_LEVELS: EvidenceLevel[] = ["none", "weak", "developing", "strong", "sufficient"];

function demote(level: EvidenceLevel): EvidenceLevel {
  const i = EVIDENCE_LEVELS.indexOf(level);
  return EVIDENCE_LEVELS[Math.max(0, i - 1)];
}

export interface ProcessSignal {
  t: number;
  marker: string;
  fromConceptId: string;
  toConceptId: string;
  sourceText: string;
  confidence: number;
}

export interface ProcessHypothesis {
  id: string;
  structureKind: "process";
  conceptIdsInOrder: string[];
  evidenceLevel: EvidenceLevel;
  /** Ring buffer, most recent last, capped at 6. */
  supportingSignals: ProcessSignal[];
  firstObservedAt: number;
  lastObservedAt: number;
  trend: "rising" | "flat" | "conflicting";
  committed: boolean;
  /**
   * True once any signal has ever contradicted this hypothesis's order.
   * A hypothesis that has ever conflicted can be demoted/abandoned but can
   * never reach "sufficient" again — one bad signal shouldn't permanently
   * kill a chain, but it should permanently raise the bar for it.
   */
  hadConflict: boolean;
  /** Consecutive conflicting signals; enough in a row abandons the hypothesis. */
  consecutiveConflicts: number;
}

const MAX_SIGNALS_PER_HYPOTHESIS = 6;
const MAX_ACTIVE_HYPOTHESES = 8;
const MAX_RECENT_BEATS = 8;
const MAX_ABANDON_CONFLICTS = 2;

/** Spacing after a structural commit before another one is attempted. */
const COMPARISON_COOLDOWN_MS = 1200;
const PROCESS_COOLDOWN_MS = 2000;

export interface DirectorState {
  /** Active, not-yet-committed hypotheses. Capped at 8, oldest evicted. */
  processHypotheses: Map<string, ProcessHypothesis>;
  /**
   * One ordered entry per committed/extended process — ordering is kept (not
   * just a Set) so an extension can relayout the full chain in the order it
   * was actually spoken, and so undo can restore exact membership.
   */
  committedProcessConceptIds: string[][];
  /** Bounded window of recent beats, never the full transcript. */
  recentBeats: { t: number; textLen: number }[];
  /** No new structural commit is attempted before this time. */
  cooldownUntil: number;
}

export function createDirectorState(): DirectorState {
  return {
    processHypotheses: new Map(),
    committedProcessConceptIds: [],
    recentBeats: [],
    cooldownUntil: 0,
  };
}

export type DirectorIntent =
  | { kind: "wait"; reason: string }
  | { kind: "commit_comparison"; evidence: ComparisonEvidence }
  | { kind: "commit_process"; hypothesisId: string; stages: string[]; evidence: string; confidence: number }
  | { kind: "extend_process"; hypothesisId: string; stages: string[]; evidence: string; confidence: number };

function evidenceLevelFor(hyp: Pick<ProcessHypothesis, "supportingSignals" | "conceptIdsInOrder" | "firstObservedAt" | "lastObservedAt" | "hadConflict">): EvidenceLevel {
  const signalCount = hyp.supportingSignals.length;
  const distinctBeats = new Set(hyp.supportingSignals.map((s) => s.t)).size;
  const stageCount = hyp.conceptIdsInOrder.length;

  if (signalCount === 0) return "none";

  const meetsStrong = signalCount >= 3 || (signalCount >= 2 && stageCount >= 3);
  if (meetsStrong) {
    const spreadOverTime = hyp.lastObservedAt > hyp.firstObservedAt;
    const sufficient =
      !hyp.hadConflict && stageCount >= 3 && stageCount <= 6 && spreadOverTime;
    return sufficient ? "sufficient" : "strong";
  }
  if (signalCount >= 2 && distinctBeats >= 2) return "developing";
  return "weak";
}

/** Does `chain` (in order) already contain this edge as adjacent entries? */
function chainHasEdge(chain: string[], from: string, to: string): boolean {
  for (let i = 0; i < chain.length - 1; i += 1) {
    if (chain[i] === from && chain[i + 1] === to) return true;
  }
  return false;
}

function newHypothesisId(from: string, to: string): string {
  return `process:${from}->${to}`;
}

/**
 * Fold one new process signal into DirectorState: find (or start) the
 * hypothesis it's evidence for, extend/reinforce/conflict it, and prune the
 * active set back to its bounded size. Pure — returns a new Map, never
 * mutates the one it was given.
 */
function applyProcessSignal(
  hypotheses: Map<string, ProcessHypothesis>,
  committed: string[][],
  signal: ProcessSignalEvidence,
  now: number,
): { hypotheses: Map<string, ProcessHypothesis>; touchedId: string | null; previous: ProcessHypothesis | null } {
  const next = new Map(hypotheses);
  const signalRecord: ProcessSignal = {
    t: now,
    marker: signal.marker,
    fromConceptId: signal.fromConceptId,
    toConceptId: signal.toConceptId,
    sourceText: signal.evidence,
    confidence: signal.confidence,
  };

  let target: ProcessHypothesis | undefined;
  let mode: "reinforce" | "conflict" | "extend" | "prepend" = "extend";

  for (const h of next.values()) {
    if (h.committed) continue;
    const chain = h.conceptIdsInOrder;
    if (chainHasEdge(chain, signal.fromConceptId, signal.toConceptId)) {
      target = h;
      mode = "reinforce";
      break;
    }
    if (chainHasEdge(chain, signal.toConceptId, signal.fromConceptId)) {
      target = h;
      mode = "conflict";
      break;
    }
    if (chain[chain.length - 1] === signal.fromConceptId && !chain.includes(signal.toConceptId)) {
      target = h;
      mode = "extend";
      break;
    }
    if (chain[0] === signal.toConceptId && !chain.includes(signal.fromConceptId)) {
      target = h;
      mode = "prepend";
      break;
    }
  }

  // Either endpoint already belongs to a committed process: this signal is
  // evidence for *extending* that process, tracked as its own hypothesis
  // (conservative — extension needs fresh multi-beat evidence too, per the
  // brief's "be conservative about extending an already-formed process").
  if (!target) {
    for (const chain of committed) {
      if (chain.includes(signal.fromConceptId) && !chain.includes(signal.toConceptId)) {
        const id = `process:extend:${chain[0]}`;
        target = next.get(id) ?? {
          id,
          structureKind: "process",
          conceptIdsInOrder: [...chain],
          evidenceLevel: "none",
          supportingSignals: [],
          firstObservedAt: now,
          lastObservedAt: now,
          trend: "rising",
          committed: false,
          hadConflict: false,
          consecutiveConflicts: 0,
        };
        mode = "extend";
        break;
      }
    }
  }

  if (!target) {
    const id = newHypothesisId(signal.fromConceptId, signal.toConceptId);
    target = next.get(id) ?? {
      id,
      structureKind: "process",
      conceptIdsInOrder: [signal.fromConceptId, signal.toConceptId],
      evidenceLevel: "none",
      supportingSignals: [],
      firstObservedAt: now,
      lastObservedAt: now,
      trend: "rising",
      committed: false,
      hadConflict: false,
      consecutiveConflicts: 0,
    };
    mode = "reinforce"; // chain already contains this exact edge; don't append again
  }

  let hyp: ProcessHypothesis = {
    ...target,
    supportingSignals: [...target.supportingSignals, signalRecord].slice(-MAX_SIGNALS_PER_HYPOTHESIS),
    lastObservedAt: now,
  };

  if (mode === "conflict") {
    hyp.hadConflict = true;
    hyp.consecutiveConflicts = target.consecutiveConflicts + 1;
    hyp.trend = "conflicting";
    hyp.evidenceLevel = demote(evidenceLevelFor(hyp));
  } else {
    hyp.consecutiveConflicts = 0;
    hyp.trend = "rising";
    if (mode === "extend") {
      hyp.conceptIdsInOrder = [...hyp.conceptIdsInOrder, signal.toConceptId];
    } else if (mode === "prepend") {
      hyp.conceptIdsInOrder = [signal.fromConceptId, ...hyp.conceptIdsInOrder];
    }
    hyp.evidenceLevel = evidenceLevelFor(hyp);
  }

  const previous: ProcessHypothesis | null = target.evidenceLevel === "none" && target.supportingSignals.length === 0 ? null : target;

  if (hyp.evidenceLevel === "none" || hyp.consecutiveConflicts >= MAX_ABANDON_CONFLICTS) {
    next.delete(hyp.id);
    return { hypotheses: next, touchedId: null, previous };
  }

  next.set(hyp.id, hyp);

  // Evict oldest non-committed entries beyond the cap.
  if (next.size > MAX_ACTIVE_HYPOTHESES) {
    const ordered = [...next.values()].sort((a, b) => a.lastObservedAt - b.lastObservedAt);
    for (const stale of ordered.slice(0, next.size - MAX_ACTIVE_HYPOTHESES)) {
      next.delete(stale.id);
    }
  }

  return { hypotheses: next, touchedId: hyp.id, previous };
}

/**
 * Advance DirectorState by one beat. Pure: returns the next state, the
 * intent (possibly `wait`), and telemetry events for the caller to forward
 * to the real `log()` — this function never performs I/O itself.
 */
export function advanceDirector(
  state: DirectorState,
  board: SemanticBoard,
  sourceText: string,
  now: number,
  alreadyPairedComparisons: Set<string>,
  opts: { comparisonEnabled: boolean },
): { state: DirectorState; intent: DirectorIntent; events: LogEventInput[] } {
  const events: LogEventInput[] = [];

  const recentBeats = [...state.recentBeats, { t: now, textLen: sourceText.length }].slice(-MAX_RECENT_BEATS);

  const comparisonEvidence = opts.comparisonEnabled
    ? detectComparison(sourceText, board, alreadyPairedComparisons)
    : null;

  const processSignal = detectProcessSignal(sourceText, board);

  let hypotheses = state.processHypotheses;
  let touchedId: string | null = null;
  if (processSignal) {
    const result = applyProcessSignal(hypotheses, state.committedProcessConceptIds, processSignal, now);
    hypotheses = result.hypotheses;
    touchedId = result.touchedId;
    const before = result.previous;

    if (touchedId) {
      const after = hypotheses.get(touchedId)!;
      const observedMs = after.lastObservedAt - after.firstObservedAt;
      if (!before || before.evidenceLevel === "none") {
        events.push({
          type: "hypothesis",
          event: "created",
          structureKind: "process",
          hypothesisId: after.id,
          conceptIds: after.conceptIdsInOrder,
          evidenceLevel: after.evidenceLevel,
          observedMs,
        });
      } else if (after.trend === "conflicting") {
        events.push({
          type: "hypothesis",
          event: "weakened",
          structureKind: "process",
          hypothesisId: after.id,
          conceptIds: after.conceptIdsInOrder,
          evidenceLevel: after.evidenceLevel,
          observedMs,
        });
      } else if (EVIDENCE_LEVELS.indexOf(after.evidenceLevel) > EVIDENCE_LEVELS.indexOf(before.evidenceLevel)) {
        events.push({
          type: "hypothesis",
          event: "strengthened",
          structureKind: "process",
          hypothesisId: after.id,
          conceptIds: after.conceptIdsInOrder,
          evidenceLevel: after.evidenceLevel,
          observedMs,
        });
      }
    } else {
      const abandonedId = newHypothesisId(processSignal.fromConceptId, processSignal.toConceptId);
      events.push({
        type: "hypothesis",
        event: "abandoned",
        structureKind: "process",
        hypothesisId: before?.id ?? abandonedId,
        conceptIds: before?.conceptIdsInOrder ?? [processSignal.fromConceptId, processSignal.toConceptId],
        evidenceLevel: "none",
      });
    }
  }

  let nextState: DirectorState = { ...state, recentBeats, processHypotheses: hypotheses };

  // Commit gating for whichever hypothesis this beat touched.
  let processIntent:
    | { kind: "commit_process" | "extend_process"; hypothesisId: string; stages: string[]; evidence: string; confidence: number }
    | null = null;

  if (touchedId) {
    const hyp = hypotheses.get(touchedId)!;
    const stageCount = hyp.conceptIdsInOrder.length;
    const allResolve = hyp.conceptIdsInOrder.every((id) => board.concepts.has(id));
    const eligible =
      hyp.evidenceLevel === "sufficient" &&
      !hyp.committed &&
      now >= state.cooldownUntil &&
      stageCount >= 3 &&
      stageCount <= 6 &&
      allResolve;

    if (eligible) {
      const isExtension = state.committedProcessConceptIds.some(
        (chain) => chain.length > 0 && chain.length < hyp.conceptIdsInOrder.length && chain.every((id) => hyp.conceptIdsInOrder.includes(id)),
      );
      const evidenceText = hyp.supportingSignals.map((s) => s.sourceText).join(" ");
      processIntent = {
        kind: isExtension ? "extend_process" : "commit_process",
        hypothesisId: hyp.id,
        stages: hyp.conceptIdsInOrder,
        evidence: evidenceText,
        confidence: hyp.supportingSignals.reduce((min, s) => Math.min(min, s.confidence), 1),
      };
    }
  }

  let intent: DirectorIntent;

  if (processIntent && comparisonEvidence) {
    const overlap =
      processIntent.stages.includes(comparisonEvidence.leftConceptId) ||
      processIntent.stages.includes(comparisonEvidence.rightConceptId);
    events.push({
      type: "arbitration",
      chose: "process",
      competingKinds: ["comparison", "process"],
      reason: overlap
        ? "process and comparison share a concept — process reorganizes it, comparison would fight that"
        : "process reached its commit threshold this beat — the higher-consequence action wins",
    });
    intent = { kind: processIntent.kind, hypothesisId: processIntent.hypothesisId, stages: processIntent.stages, evidence: processIntent.evidence, confidence: processIntent.confidence };
  } else if (processIntent) {
    intent = { kind: processIntent.kind, hypothesisId: processIntent.hypothesisId, stages: processIntent.stages, evidence: processIntent.evidence, confidence: processIntent.confidence };
  } else if (comparisonEvidence && now >= state.cooldownUntil) {
    intent = { kind: "commit_comparison", evidence: comparisonEvidence };
  } else {
    intent = {
      kind: "wait",
      reason: comparisonEvidence
        ? "comparison evidence found but still in cooldown"
        : processSignal
          ? "process signal noted, insufficient evidence to commit"
          : "no structural evidence this beat",
    };
  }

  if (intent.kind === "commit_comparison") {
    nextState = { ...nextState, cooldownUntil: now + COMPARISON_COOLDOWN_MS };
  } else if (intent.kind === "commit_process" || intent.kind === "extend_process") {
    nextState = { ...nextState, cooldownUntil: now + PROCESS_COOLDOWN_MS };
  }

  return { state: nextState, intent, events };
}

/**
 * Called after `performProcess` actually succeeds (drawn nodes existed, user
 * wasn't mid-interaction, etc.) — mirrors comparedPairsRef's "only mark
 * formed on real success" contract. Removes any hypothesis that produced
 * this stage set (so it stops re-offering commit intents) and records the
 * ordered membership so future signals touching these concepts are treated
 * as extension evidence, and so the no-repeated-relayout gate in
 * performProcess has something to check against.
 */
export function markProcessCommitted(state: DirectorState, conceptIds: string[]): DirectorState {
  const hypotheses = new Map(state.processHypotheses);
  for (const h of hypotheses.values()) {
    const sameSet = h.conceptIdsInOrder.length === conceptIds.length && h.conceptIdsInOrder.every((id) => conceptIds.includes(id));
    if (sameSet) hypotheses.delete(h.id);
  }

  const committedProcessConceptIds = state.committedProcessConceptIds
    .filter((chain) => !chain.every((id) => conceptIds.includes(id)))
    .concat([conceptIds]);

  return { ...state, processHypotheses: hypotheses, committedProcessConceptIds };
}

/** Undo's counterpart to `markProcessCommitted`. */
export function unmarkProcessCommitted(state: DirectorState, conceptIds: string[]): DirectorState {
  const committedProcessConceptIds = state.committedProcessConceptIds.filter(
    (chain) => !(chain.length === conceptIds.length && chain.every((id) => conceptIds.includes(id))),
  );
  return { ...state, committedProcessConceptIds };
}
