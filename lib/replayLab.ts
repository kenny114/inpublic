import { percentile, type LatencySampleEvent, type LatencySummary } from "./latency";
import type { CorpusSceneEvidence, SettledThoughtEvidence, VisualSourceEvidence } from "./corpus";
import type { ReplayRebaseReason } from "./replayPacing";
import type { LogEvent } from "./types";

export const REPLAY_MODES = ["v2_only", "vr_shell", "vr_decision", "vr_full"] as const;
export type ReplayExperimentMode = (typeof REPLAY_MODES)[number];

export interface ReplayDisconnectPlan {
  /** Global source-audio positions after whose first successful send the socket is closed. */
  atAudioMs: number[];
}

/** Fully decoded, mono source used by development replay and Demo Studio. */
export interface ReplayPreparedSource {
  name: string;
  sourceSampleRate: number;
  sampleRate: number;
  durationMs: number;
  samples: Float32Array;
}

/** Optional synchronization/heartbeat hooks around the existing replay sender. */
export interface ReplayStartOptions {
  /** Runs after the real Deepgram socket opens and before source sample zero. */
  beforeAudioStart?: () => void | Promise<void>;
  /** Runs after each successful 80 ms PCM send. */
  onProgress?: (audioEndMs: number, chunkSequence: number) => void;
}

export interface ReplayChunkDiagnostic {
  chunkSequence: number;
  sampleStart: number;
  sampleEnd: number;
  audioStartMs: number;
  audioEndMs: number;
  idealScheduledAtMs: number;
  cadenceScheduledAtMs: number;
  sentAtMs: number;
  wallClockSendTimeMs: number;
  scheduleErrorMs: number;
  scheduledSendErrorMs: number;
  cadenceErrorMs: number;
  /** Jitter relative to the current (possibly rebased) absolute source clock. */
  sourceClockDriftMs: number;
  /** Deliberate wall-clock displacement caused by stalls/reconnects. */
  intentionalRebaseDelayMs: number;
  sendLeadMs: number;
  sendLagMs: number;
  socketGeneration: number;
  connectionGeneration: number;
  bufferedAmount: number | null;
  sendAttempts: number;
  pausedBeforeSend: boolean;
}

export interface ReplayProviderDiagnostic {
  responseSequence: number;
  receivedAtMs: number;
  wallClockReceiveTimeMs: number;
  socketGeneration: number;
  connectionGeneration: number;
  requestId: string | null;
  providerStartMs: number | null;
  providerDurationMs: number | null;
  providerRegionEndMs: number | null;
  latestWordEndMs: number | null;
  globalRegionEndMs: number | null;
  globalLatestWordEndMs: number | null;
  relevantRegionSentAtMs: number | null;
  relevantWordSentAtMs: number | null;
  providerRegionLagMs: number | null;
  latestWordLagMs: number | null;
  latestAudioSentMs: number | null;
  latestProviderConfirmedAudioMs: number | null;
  audioLiveEdgeLagMs: number | null;
  legacyLatestChunkToMessageMs: number | null;
  transcriptExcerpt: string;
  isFinal: boolean;
  speechFinal: boolean;
  fromFinalize: boolean;
}

export interface ReplayConnectionDiagnostic {
  event: "credential_minted" | "credential_reused" | "connecting" | "open" | "close" | "reconnect_scheduled" | "resume" | "forced_close" | "scheduler_rebase";
  atMs: number;
  wallClockTimeMs: number;
  connectionGeneration: number;
  socketGeneration: number;
  audioPositionMs: number | null;
  chunkSequence: number | null;
  detail?: string;
}

export interface ReplayDiagnosticSummary {
  sendAttempts: number;
  successfulSends: number;
  pausedSends: number;
  reconnectCount: number;
  forcedDisconnectCount: number;
  rebaseCount: number;
  rebaseReasons: ReplayRebaseReason[];
  intentionalRebaseDelayMs: number;
  scheduleErrorP50: number | null;
  scheduleErrorP95: number | null;
  scheduleErrorMax: number | null;
  scheduledSendErrorP50: number | null;
  scheduledSendErrorP95: number | null;
  scheduledSendErrorMax: number | null;
  sendLagP50: number | null;
  sendLagP95: number | null;
  sendLagMax: number | null;
  bufferedAmountP50: number | null;
  bufferedAmountP95: number | null;
  bufferedAmountMax: number | null;
  providerRegionLagP50: number | null;
  providerRegionLagP95: number | null;
  providerRegionLagMax: number | null;
  latestWordLagP50: number | null;
  latestWordLagP95: number | null;
  latestWordLagMax: number | null;
  audioLiveEdgeLagP50: number | null;
  audioLiveEdgeLagP95: number | null;
  audioLiveEdgeLagMax: number | null;
  sendLagAt10s: number | null;
  sendLagAt30s: number | null;
  sendLagAt60s: number | null;
  sendLagAt87s: number | null;
}

export interface ReplaySpeechDiagnostics {
  disconnectPlan: ReplayDisconnectPlan;
  chunks: ReplayChunkDiagnostic[];
  providerResponses: ReplayProviderDiagnostic[];
  connections: ReplayConnectionDiagnostic[];
  summary: ReplayDiagnosticSummary;
}

export function isReplayLabEnabled(search = "", nodeEnv = process.env.NODE_ENV): boolean {
  return nodeEnv !== "production" && new URLSearchParams(search).get("replay") === "1";
}

export function parseReplayMode(value: unknown): ReplayExperimentMode {
  return REPLAY_MODES.includes(value as ReplayExperimentMode) ? value as ReplayExperimentMode : "v2_only";
}

export interface ReplayAudioInfo {
  name: string;
  durationMs: number;
  sourceSampleRate: number;
  replaySampleRate: number;
  chunkCount: number;
  pacingDriftMs: number;
  diagnostics: ReplaySpeechDiagnostics;
}

export interface VrRunMetrics {
  settledThoughtCount: number;
  candidateAcceptedCount: number;
  candidateRejectedCount: number;
  evidenceHeldCount: number;
  evidenceCombinedCount: number;
  visualDecisionCount: number;
  decisionLatencyP50: number | null;
  decisionLatencyP95: number | null;
  staleResultDroppedCount: number;
  abortedRequestCount: number;
  noneCount: number;
  groundingCount: number;
  renderedVisualCount: number;
  durableResultReadyCount: number;
  durableResultHeldCount: number;
  durableResultCommittedCount: number;
  quietCommittedCount: number;
  maxRequestConcurrency: number;
  fastPathAttemptCount: number;
  fastPathSuccessCount: number;
  fastPathRejectedCount: number;
  modelFallbackCount: number;
  fastPathEnumerationCount: number;
  fastPathQuantitativeCount: number;
  exactFastPathCount: number;
  approximateFastPathCount: number;
  approximateFallbackCount: number;
  fastPathGroundingPassCount: number;
  fastPathGroundingFailCount: number;
  fastPathCommittedCount: number;
  modelCommittedCount: number;
  modelCallsAvoidedByCandidateGate: number;
  modelCallsAvoidedByFastPath: number;
  overallModelCallRate: number;
  sequenceEvidenceOpened: number;
  sequenceEvidenceExtended: number;
  sequenceEvidenceCompleted: number;
  sequenceCandidateCount: number;
  sequenceFastPathCount: number;
  sequenceModelFallbackCount: number;
  sequenceGroundingPass: number;
  sequenceGroundingFail: number;
  sequenceCommittedCount: number;
  causeEvidenceOpened: number;
  causeEvidenceExtended: number;
  causeEvidenceCompleted: number;
  causeCandidateCount: number;
  causeFastPathCount: number;
  causeModelFallbackCount: number;
  causeGroundingPassCount: number;
  causeGroundingFailCount: number;
  causeCommittedCount: number;
  causeRejectedUncertain: number;
  causeRejectedNegated: number;
  causeRejectedTemporal: number;
  causeRejectedCorrelation: number;
  comparisonEvidenceOpened: number;
  comparisonEvidenceExtended: number;
  comparisonEvidenceCompleted: number;
  comparisonCandidateCount: number;
  comparisonFastPathCount: number;
  comparisonModelFallbackCount: number;
  comparisonGroundingPassCount: number;
  comparisonGroundingFailCount: number;
  comparisonCommittedCount: number;
  comparisonRejectedCooccurrence: number;
  comparisonRejectedUncertain: number;
  comparisonRejectedNegated: number;
  pageTurnInvalidationCount: number;
  candidateToDurableReady: DecisionSourceLatencyMetrics;
  candidateToCommit: DecisionSourceLatencyMetrics;
}

export interface SourceLatencySummary { count: number; p50: number | null; p95: number | null }
export interface DecisionSourceLatencyMetrics {
  deterministic_fast_path: SourceLatencySummary;
  model_fallback: SourceLatencySummary;
}

export interface ReplayCorrelation {
  inFlight: Record<string, { count: number; p50: number | null; p95: number | null }>;
  idle: Record<string, { count: number; p50: number | null; p95: number | null }>;
}

export interface ReplayRunReport {
  mode: ReplayExperimentMode;
  round: number;
  audio: ReplayAudioInfo;
  latency: LatencySummary;
  vr: VrRunMetrics;
  correlation: ReplayCorrelation;
  /** performance.now() timestamps for each real visual-intent request. */
  decisionWindows: DecisionWindow[];
  visualLifecycles: Array<{
    thoughtId: string;
    sourceExcerpt: string;
    candidateCompletedAtMs: number;
    durableReadyAtMs: number | null;
    commitAtMs: number | null;
    quietCommitAtMs: number | null;
    groundingPassedAtMs: number | null;
    decisionSource: "deterministic_fast_path" | "model_fallback" | null;
    fromModality: "exact" | "approximate" | null;
    toModality: "exact" | "approximate" | null;
    cameraRequested: boolean;
    cameraSuppressed: boolean;
  }>;
  /** Exact V2 semantic units and their unmodified Visual Re-entry outcomes. */
  settledThoughts: SettledThoughtEvidence[];
  /** Candidate-boundary evidence, including bounded multi-thought sources. */
  visualSources: VisualSourceEvidence[];
  /** Native final scene used by research exports and offline page capture. */
  scene: CorpusSceneEvidence;
  /** Complete run-local event stream for offline research and audit replay. */
  events: LogEvent[];
  pageTurns: Array<{ atMs: number; page: number; trigger: string; reason: string }>;
  transcript: string;
  startedAt: string;
  longTasks: Array<{ atMs: number; durationMs: number }>;
}

export interface DecisionWindow { start: number; end?: number }

export function correlateSamples(samples: LatencySampleEvent[], windows: DecisionWindow[]): ReplayCorrelation {
  const keys = ["interim_lag", "chunk_to_message", "chunk_to_ink"] as const;
  const buckets = { inFlight: {} as ReplayCorrelation["inFlight"], idle: {} as ReplayCorrelation["idle"] };
  for (const key of keys) {
    const relevant = samples.filter((sample) => sample.key === key);
    const active: number[] = [];
    const idle: number[] = [];
    for (const sample of relevant) {
      const isActive = windows.some((window) => sample.at >= window.start && sample.at <= (window.end ?? Infinity));
      (isActive ? active : idle).push(sample.value);
    }
    buckets.inFlight[key] = { count: active.length, p50: percentile(active, .5), p95: percentile(active, .95) };
    buckets.idle[key] = { count: idle.length, p50: percentile(idle, .5), p95: percentile(idle, .95) };
  }
  return buckets;
}

function median(values: Array<number | null>): number | null {
  return percentile(values.filter((value): value is number => value !== null), .5);
}

export function buildReplayComparison(runs: ReplayRunReport[]) {
  return Object.fromEntries(REPLAY_MODES.map((mode) => {
    const selected = runs.filter((run) => run.mode === mode);
    return [mode, {
      runCount: selected.length,
      interimLagP50: median(selected.map((run) => run.latency.interimLagP50)),
      interimLagP95: median(selected.map((run) => run.latency.interimLagP95)),
      finalLagP50: median(selected.map((run) => run.latency.finalLagP50)),
      chunkToMessageP50: median(selected.map((run) => run.latency.chunkToMessageP50)),
      chunkToInkP50: median(selected.map((run) => run.latency.chunkToInkP50)),
      renderP50: median(selected.map((run) => run.latency.renderP50)),
      paintP50: median(selected.map((run) => run.latency.paintP50)),
      visualDecisionCount: selected.reduce((sum, run) => sum + run.vr.visualDecisionCount, 0),
      candidateAcceptedCount: selected.reduce((sum, run) => sum + run.vr.candidateAcceptedCount, 0),
      durableResultCommittedCount: selected.reduce((sum, run) => sum + run.vr.durableResultCommittedCount, 0),
      evidenceCombinedCount: selected.reduce((sum, run) => sum + run.vr.evidenceCombinedCount, 0),
      quietCommittedCount: selected.reduce((sum, run) => sum + run.vr.quietCommittedCount, 0),
      fastPathSuccessCount: selected.reduce((sum, run) => sum + run.vr.fastPathSuccessCount, 0),
      exactFastPathCount: selected.reduce((sum, run) => sum + run.vr.exactFastPathCount, 0),
      approximateFastPathCount: selected.reduce((sum, run) => sum + run.vr.approximateFastPathCount, 0),
      approximateFallbackCount: selected.reduce((sum, run) => sum + run.vr.approximateFallbackCount, 0),
      modelFallbackCount: selected.reduce((sum, run) => sum + run.vr.modelFallbackCount, 0),
      fastPathCommittedCount: selected.reduce((sum, run) => sum + run.vr.fastPathCommittedCount, 0),
      modelCommittedCount: selected.reduce((sum, run) => sum + run.vr.modelCommittedCount, 0),
      modelCallsAvoidedByFastPath: selected.reduce((sum, run) => sum + run.vr.modelCallsAvoidedByFastPath, 0),
      sequenceCandidateCount: selected.reduce((sum, run) => sum + (run.vr.sequenceCandidateCount ?? 0), 0),
      sequenceFastPathCount: selected.reduce((sum, run) => sum + (run.vr.sequenceFastPathCount ?? 0), 0),
      sequenceCommittedCount: selected.reduce((sum, run) => sum + (run.vr.sequenceCommittedCount ?? 0), 0),
      causeCandidateCount: selected.reduce((sum, run) => sum + (run.vr.causeCandidateCount ?? 0), 0),
      causeFastPathCount: selected.reduce((sum, run) => sum + (run.vr.causeFastPathCount ?? 0), 0),
      causeCommittedCount: selected.reduce((sum, run) => sum + (run.vr.causeCommittedCount ?? 0), 0),
      comparisonCandidateCount: selected.reduce((sum, run) => sum + (run.vr.comparisonCandidateCount ?? 0), 0),
      comparisonFastPathCount: selected.reduce((sum, run) => sum + (run.vr.comparisonFastPathCount ?? 0), 0),
      comparisonCommittedCount: selected.reduce((sum, run) => sum + (run.vr.comparisonCommittedCount ?? 0), 0),
    }];
  }));
}

export function formatHumanReplayReport(runs: ReplayRunReport[]): string {
  const clean = runs.filter((run) => run.audio.diagnostics.disconnectPlan.atAudioMs.length === 0).slice(0, 5);
  const oneReconnect = runs.find((run) => run.audio.diagnostics.disconnectPlan.atAudioMs.length === 1);
  const twoReconnect = runs.find((run) => run.audio.diagnostics.disconnectPlan.atAudioMs.length === 2);
  const summaryMedian = (selector: (run: ReplayRunReport) => number | null) => median(clean.map(selector));
  const cleanTranscriptLength = median(clean.map((run) => run.transcript.length));
  const lines = [
    "# InPublic Replay Pacing V2 Report",
    "",
    `Audio: ${runs[0]?.audio.name ?? "unknown"} (${runs[0] ? (runs[0].audio.durationMs / 1000).toFixed(2) : "—"}s)`,
    "",
    "## Old scheduler",
    "",
    "The prior sender scheduled each chunk from the previous actual send. Ordinary 3–9 ms timer overhead accumulated to 3.9–4.3 seconds by end-of-file.",
    "",
    "## New absolute-clock scheduler",
    "",
    "Every unsent chunk targets the current monotonic replay anchor plus its source sample start time. Scheduled-send error and source-clock drift exclude deliberate rebase delay, which is reported separately.",
    "",
    "## Jitter policy",
    "",
    "Normal jitter stays attached to the absolute source clock. The genuine-stall threshold is 160 ms: two complete 80 ms source chunks overdue, far above the observed 3–9 ms timer noise.",
    "",
    "## Genuine-stall policy",
    "",
    "Lateness beyond 160 ms rebases once at the next unsent chunk. There is no polling loop, spin wait, or queued-audio burst.",
    "",
    "## Rebase behavior",
    "",
    "Reconnects explicitly rebase at the next unsent source sample. Source sequence and sample identity are unchanged.",
    "",
    "## Five clean-run results",
    "",
    "| RUN | LEGACY INTERIM P50/P95 | LATEST-CHUNK PROXIMITY P50/P95 | GROUNDED REGION P50/P95/MAX | LIVE EDGE P50/P95/MAX | SEND LAG P50/P95/MAX | SCHEDULED ERROR P50/P95/MAX | REBASES | BUFFER MAX | LONG TASKS |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const [index, run] of clean.entries()) {
    const diagnostic = run.audio.diagnostics.summary;
    lines.push(`| ${index + 1} | ${run.latency.interimLagP50 ?? "—"}/${run.latency.interimLagP95 ?? "—"} | ${run.latency.chunkToMessageP50 ?? "—"}/${run.latency.chunkToMessageP95 ?? "—"} | ${diagnostic.providerRegionLagP50 ?? "—"}/${diagnostic.providerRegionLagP95 ?? "—"}/${diagnostic.providerRegionLagMax ?? "—"} | ${diagnostic.audioLiveEdgeLagP50 ?? "—"}/${diagnostic.audioLiveEdgeLagP95 ?? "—"}/${diagnostic.audioLiveEdgeLagMax ?? "—"} | ${diagnostic.sendLagP50 ?? "—"}/${diagnostic.sendLagP95 ?? "—"}/${diagnostic.sendLagMax ?? "—"} | ${diagnostic.scheduledSendErrorP50 ?? "—"}/${diagnostic.scheduledSendErrorP95 ?? "—"}/${diagnostic.scheduledSendErrorMax ?? "—"} | ${diagnostic.rebaseCount} | ${diagnostic.bufferedAmountMax ?? "—"} | ${run.longTasks.length} |`);
  }
  lines.push(
    "",
    "## Clean send-lag comparison",
    "",
    `Clean median send lag P50/P95/max: ${summaryMedian((run) => run.audio.diagnostics.summary.sendLagP50) ?? "—"}/${summaryMedian((run) => run.audio.diagnostics.summary.sendLagP95) ?? "—"}/${summaryMedian((run) => run.audio.diagnostics.summary.sendLagMax) ?? "—"} ms.`,
    "",
    `Checkpoint medians at source 10/30/60/87 seconds: ${summaryMedian((run) => run.audio.diagnostics.summary.sendLagAt10s) ?? "—"}/${summaryMedian((run) => run.audio.diagnostics.summary.sendLagAt30s) ?? "—"}/${summaryMedian((run) => run.audio.diagnostics.summary.sendLagAt60s) ?? "—"}/${summaryMedian((run) => run.audio.diagnostics.summary.sendLagAt87s) ?? "—"} ms.`,
    "",
    "## Provider live-edge after pacing fix",
    "",
    `Clean-run median P50/P95: ${summaryMedian((run) => run.audio.diagnostics.summary.audioLiveEdgeLagP50) ?? "—"}/${summaryMedian((run) => run.audio.diagnostics.summary.audioLiveEdgeLagP95) ?? "—"} ms.`,
    "",
    "## Grounded provider-region latency",
    "",
    `Clean-run median P50/P95: ${summaryMedian((run) => run.audio.diagnostics.summary.providerRegionLagP50) ?? "—"}/${summaryMedian((run) => run.audio.diagnostics.summary.providerRegionLagP95) ?? "—"} ms.`,
    "",
    "## Legacy interimLag after pacing fix",
    "",
    `Clean-run median P50/P95: ${summaryMedian((run) => run.latency.interimLagP50) ?? "—"}/${summaryMedian((run) => run.latency.interimLagP95) ?? "—"} ms. This remains a legacy comparison metric, not a causal provider measurement.`,
    "",
    "## WebSocket buffer behavior",
    "",
    `Clean-run maximum: ${clean.length ? Math.max(...clean.map((run) => run.audio.diagnostics.summary.bufferedAmountMax ?? 0)) : "—"} bytes.`,
    "",
    "## Reconnect run",
    "",
    oneReconnect ? describeReconnectRun(oneReconnect) : "Not run.",
    "",
    "## Two-reconnect run",
    "",
    twoReconnect ? describeReconnectRun(twoReconnect) : "Not run.",
    "",
    "## Transcript continuity",
    "",
    `Clean/one-close/two-close character counts: ${cleanTranscriptLength ?? "—"}/${oneReconnect?.transcript.length ?? "—"}/${twoReconnect?.transcript.length ?? "—"}. Reconnect-boundary loss is measured but intentionally unchanged.`,
    "",
    "## Main-thread behavior",
    "",
    `Long tasks across clean runs: ${clean.reduce((sum, run) => sum + run.longTasks.length, 0)}.`,
    "",
    "## Tests",
    "",
    "Deterministic coverage includes non-accumulating jitter, 1,100 chunks of repeated overhead, one-time stall rebase, next-unsent resume, no duplicate/skip/burst, reconnect rebase, clean non-rebasing, and production-capture exclusion.",
  );
  return `${lines.join("\n")}\n`;
}

function describeReconnectRun(run: ReplayRunReport): string {
  const summary = run.audio.diagnostics.summary;
  return `Plan ${run.audio.diagnostics.disconnectPlan.atAudioMs.map((value) => `${value / 1000}s`).join(", ")}: ${summary.successfulSends} sends, ${summary.reconnectCount} reconnect(s), ${summary.rebaseCount} rebase(s) [${summary.rebaseReasons.join(", ")}], ${summary.intentionalRebaseDelayMs} ms intentional delay, send-lag P50/P95/max ${summary.sendLagP50}/${summary.sendLagP95}/${summary.sendLagMax} ms, buffer max ${summary.bufferedAmountMax} bytes.`;
}
