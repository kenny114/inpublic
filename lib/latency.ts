/**
 * Latency measurement for the live path.
 *
 * The board already computed almost everything here — interim lag, render
 * time, paint time, chunk cadence — and then threw it away when the tab
 * closed. This module is the missing half: a place to put those numbers, a
 * clock for the startup sequence, and a formatter that prints only what was
 * actually measured.
 *
 * Two rules govern everything below.
 *
 * 1. **Nothing here may block.** Every entry point is a synchronous push into
 *    an in-memory map. Transport lives in lib/latencySink.ts and is fire and
 *    forget. A recorder that made the live line wait would be worse than no
 *    recorder at all.
 * 2. **Never invent a number.** Every field is `number | null`, and the
 *    formatter omits nulls rather than printing a zero. A missing measurement
 *    must look missing, because the whole point of this file is to stop
 *    guessing.
 */

/**
 * The startup sequence and the first appearance of each visual tier.
 *
 * Ordered as they occur. `first_*` markers are one-shot: the first write wins,
 * so they measure the first time the board did the thing rather than the last.
 */
export type MilestoneName =
  | "start_pressed"
  | "mic_permission"
  | "worklet_ready"
  | "sdk_ready"
  | "lease_ready"
  | "token_ready"
  | "socket_open"
  | "first_audio_chunk"
  | "first_interim"
  | "first_ink"
  | "first_speculative"
  | "first_scribe_mark"
  | "first_beat_request"
  | "first_artist_request"
  | "first_artist_action";

/**
 * Distributions worth a percentile rather than a single reading.
 *
 * The `speech_to_*` families are all measured the same way — ink time minus
 * Deepgram's own audio-timeline end for the words that caused the visual — so
 * they are directly comparable to each other and to `lag`. That comparability
 * is the point: it is what makes "the speculative mark beat the Scribe mark by
 * 800ms" a fact rather than a feeling.
 */
export type SampleKey =
  /**
   * ink time minus Deepgram's self-reported audio-timeline end
   * (`start`+`duration`). Deepgram's own docs say not to use those fields for
   * precise latency measurement, so despite the name this is NOT a wall-clock
   * provider/network latency figure — treat it as an audio/transcript
   * alignment diagnostic only. See LATENCY-AUDIT.md. For a true wall-clock
   * speech→ink number use `"chunk_to_ink"` below.
   */
  | "lag"
  | "render"
  | "paint"
  /** Same caveat as `"lag"` — derived from Deepgram `start`/`duration`, not wall clock. */
  | "final_lag"
  /** Same caveat as `"lag"` — derived from Deepgram `start`/`duration`, not wall clock. */
  | "interim_lag"
  | "chunk_gap"
  | "interim_gap"
  | "first_visible_word"
  | "speech_to_speculative"
  | "speech_to_scribe"
  | "speech_to_structure"
  | "scribe_request_wait"
  | "scribe_first_op"
  | "build_live_line"
  | "commit"
  | "long_task"
  /** Wall-clock time from the last audio chunk sent to any Deepgram message
   * arriving, independent of Deepgram's self-reported audio-timeline math —
   * see hooks/useDeepgram.ts's lastChunkSentAtRef for why this exists. */
  | "chunk_to_message"
  /** Deepgram's own VAD SpeechStarted event to the first raw interim text
   * that follows it — a ground-truth "how long from you actually speaking to
   * any text at all", independent of any InPublic-side heuristic. */
  | "speech_onset_to_raw_interim"
  /**
   * The true wall-clock speech→ink number: last audio chunk sent → ink
   * committed (`lib/telemetry.ts` `chunkToInkSample`). Never derived from
   * Deepgram `start`/`duration`. This is the metric to lead with; `"lag"` is
   * a diagnostic, not a latency claim.
   */
  | "chunk_to_ink";

export interface LatencySummary {
  sessionId: string | null;
  mode: string;
  startedAt: number | null;
  interimCount: number;
  /** Startup spans, ms. Null when the milestone pair was never recorded. */
  pressToListening: number | null;
  pressToMicPermission: number | null;
  pressToLeaseReady: number | null;
  pressToTokenReady: number | null;
  socketToFirstInterim: number | null;
  /** Steady-state distributions, ms. */
  lagP50: number | null;
  lagP95: number | null;
  lagMax: number | null;
  renderP50: number | null;
  paintP50: number | null;
  paintP95: number | null;
  finalLagP50: number | null;
  interimLagP50: number | null;
  interimLagP95: number | null;
  chunkGapP50: number | null;
  chunkGapP95: number | null;
  firstVisibleWordMs: number | null;
  speechToSpeculativeP50: number | null;
  speechToScribeP50: number | null;
  speechToStructureP50: number | null;
  scribeRequestWaitP50: number | null;
  scribeFirstOpP50: number | null;
  /** writeLive sub-stages, ms. Breaks the 1-6ms figure apart on demand. */
  buildLiveLineP50: number | null;
  commitP50: number | null;
  /** Main-thread contention. A long task overlapping an interim is the
   * clearest possible evidence of "something else blocked the ink". */
  longTaskCount: number;
  longTaskP50: number | null;
  longTaskMax: number | null;
  /** Ground-truth-adjacent, see the SampleKey comments above. */
  chunkToMessageP50: number | null;
  chunkToMessageP95: number | null;
  chunkToMessageMax: number | null;
  speechOnsetToRawInterimP50: number | null;
  speechOnsetToRawInterimP95: number | null;
  /** True wall-clock speech→ink, ms. See the `"chunk_to_ink"` SampleKey doc. */
  chunkToInkP50: number | null;
  chunkToInkP95: number | null;
  chunkToInkMax: number | null;
}

/**
 * Root-cause traces: the raw sequence of Deepgram messages for one utterance,
 * captured verbatim rather than reduced to a percentile — this is what lets
 * a single real sentence's development be reconstructed after the fact
 * (which text arrived when, how long each took) instead of only ever seeing
 * an aggregate number. Temporary/diagnostic, produced by hooks/useDeepgram.ts.
 */
export interface DiagnosticTraceEvent {
  /** ms since this utterance's first captured event. */
  tMs: number;
  kind: "speech-started" | "interim" | "final" | "utterance-end";
  text?: string;
  /** Wall-clock ms from the most recently sent audio chunk to this event. */
  sinceChunkSentMs?: number;
}
export interface DiagnosticTraces {
  /** The first utterance of the session — a representative example. */
  first: DiagnosticTraceEvent[] | null;
  /** The utterance with the largest chunk-to-message gap seen. */
  worst: DiagnosticTraceEvent[] | null;
}

/** Repo convention, kept identical to useDeepgram's so the two agree. */
export function percentile(values: number[], quantile: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))]);
}

/** Guards against NaN/Infinity reaching a percentile or a display string. */
function usable(value: number): boolean {
  return Number.isFinite(value);
}

/**
 * Bound on retained samples per key.
 *
 * A 40-minute session at ~5 interims/second would otherwise accumulate tens of
 * thousands of numbers per key for no analytical gain. Dropping the oldest
 * keeps the percentiles representative of the recent past, which is the part
 * anyone is asking about.
 */
const MAX_SAMPLES = 500;

export class LatencyRecorder {
  private milestones = new Map<MilestoneName, number>();
  private samples = new Map<SampleKey, number[]>();
  private interims = 0;
  sessionId: string | null = null;
  mode = "standard";

  /** First write wins — these mark the first occurrence, not the latest. */
  mark(name: MilestoneName, atMs: number): void {
    if (!usable(atMs)) return;
    if (this.milestones.has(name)) return;
    this.milestones.set(name, atMs);
  }

  at(name: MilestoneName): number | null {
    return this.milestones.get(name) ?? null;
  }

  span(from: MilestoneName, to: MilestoneName): number | null {
    const a = this.milestones.get(from);
    const b = this.milestones.get(to);
    if (a === undefined || b === undefined) return null;
    const delta = Math.round(b - a);
    // A negative span means the milestones were recorded out of order, which
    // is a bug in the caller rather than a fast startup. Report nothing.
    return delta >= 0 ? delta : null;
  }

  observe(key: SampleKey, value: number): void {
    if (!usable(value)) return;
    const list = this.samples.get(key) ?? [];
    list.push(value);
    if (list.length > MAX_SAMPLES) list.splice(0, list.length - MAX_SAMPLES);
    this.samples.set(key, list);
  }

  /** Bulk variant, for the arrays useDeepgram already accumulates. */
  observeAll(key: SampleKey, values: number[]): void {
    for (const value of values) this.observe(key, value);
  }

  countInterim(n = 1): void {
    this.interims += n;
  }

  quantile(key: SampleKey, q: number): number | null {
    return percentile(this.samples.get(key) ?? [], q);
  }

  max(key: SampleKey): number | null {
    const list = this.samples.get(key) ?? [];
    return list.length ? Math.round(Math.max(...list)) : null;
  }

  sampleCount(key: SampleKey): number {
    return (this.samples.get(key) ?? []).length;
  }

  summary(): LatencySummary {
    return {
      sessionId: this.sessionId,
      mode: this.mode,
      startedAt: this.at("start_pressed"),
      interimCount: this.interims,
      pressToListening: this.span("start_pressed", "socket_open"),
      pressToMicPermission: this.span("start_pressed", "mic_permission"),
      pressToLeaseReady: this.span("start_pressed", "lease_ready"),
      pressToTokenReady: this.span("start_pressed", "token_ready"),
      socketToFirstInterim: this.span("socket_open", "first_interim"),
      lagP50: this.quantile("lag", 0.5),
      lagP95: this.quantile("lag", 0.95),
      lagMax: this.max("lag"),
      renderP50: this.quantile("render", 0.5),
      paintP50: this.quantile("paint", 0.5),
      paintP95: this.quantile("paint", 0.95),
      finalLagP50: this.quantile("final_lag", 0.5),
      interimLagP50: this.quantile("interim_lag", 0.5),
      interimLagP95: this.quantile("interim_lag", 0.95),
      chunkGapP50: this.quantile("chunk_gap", 0.5),
      chunkGapP95: this.quantile("chunk_gap", 0.95),
      firstVisibleWordMs: this.quantile("first_visible_word", 0.5),
      speechToSpeculativeP50: this.quantile("speech_to_speculative", 0.5),
      speechToScribeP50: this.quantile("speech_to_scribe", 0.5),
      speechToStructureP50: this.quantile("speech_to_structure", 0.5),
      scribeRequestWaitP50: this.quantile("scribe_request_wait", 0.5),
      scribeFirstOpP50: this.quantile("scribe_first_op", 0.5),
      buildLiveLineP50: this.quantile("build_live_line", 0.5),
      commitP50: this.quantile("commit", 0.5),
      longTaskCount: this.sampleCount("long_task"),
      longTaskP50: this.quantile("long_task", 0.5),
      longTaskMax: this.max("long_task"),
      chunkToMessageP50: this.quantile("chunk_to_message", 0.5),
      chunkToMessageP95: this.quantile("chunk_to_message", 0.95),
      chunkToMessageMax: this.max("chunk_to_message"),
      speechOnsetToRawInterimP50: this.quantile("speech_onset_to_raw_interim", 0.5),
      speechOnsetToRawInterimP95: this.quantile("speech_onset_to_raw_interim", 0.95),
      chunkToInkP50: this.quantile("chunk_to_ink", 0.5),
      chunkToInkP95: this.quantile("chunk_to_ink", 0.95),
      chunkToInkMax: this.max("chunk_to_ink"),
    };
  }

  reset(): void {
    this.milestones.clear();
    this.samples.clear();
    this.interims = 0;
  }
}

/**
 * The board's recorder.
 *
 * A module singleton rather than a hook or context because the producers are
 * spread across `useDeepgram` (transport and provider timings), `Board`
 * (render and tier timings) and the startup coordinator, and threading a
 * recorder through all three would mean changing signatures on the live path
 * to serve measurement. The class above is exported separately so tests can
 * build their own instance without touching this one.
 */
export const latency = new LatencyRecorder();

/** One clock for every milestone. Monotonic, so a system clock change cannot
 * produce a negative span. */
export function latencyNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

interface Row {
  label: string;
  value: number | null;
}

/**
 * The developer-readable summary.
 *
 * Rows whose value was never measured are dropped entirely rather than
 * printed as zero or "—". If a line is absent from this output it is because
 * the session did not produce that measurement, and that absence is itself the
 * finding.
 */
export function formatLatencySummary(summary: LatencySummary): string {
  const groups: { title: string; rows: Row[] }[] = [
    {
      title: "STARTUP",
      rows: [
        { label: "Press → Mic permission", value: summary.pressToMicPermission },
        { label: "Press → Usage lease", value: summary.pressToLeaseReady },
        { label: "Press → Deepgram token", value: summary.pressToTokenReady },
        { label: "Press → Listening", value: summary.pressToListening },
        { label: "Listening → First interim", value: summary.socketToFirstInterim },
      ],
    },
    {
      title: "LIVE INK (tier 1) — true wall-clock",
      rows: [
        { label: "Chunk sent → Ink (p50)", value: summary.chunkToInkP50 },
        { label: "Chunk sent → Ink (p95)", value: summary.chunkToInkP95 },
        { label: "Chunk sent → Ink (max)", value: summary.chunkToInkMax },
        { label: "Interim → Ink", value: summary.renderP50 },
        { label: "Paint (p50)", value: summary.paintP50 },
        { label: "Paint (p95)", value: summary.paintP95 },
        { label: "  buildLiveLine (p50)", value: summary.buildLiveLineP50 },
        { label: "  commit (p50)", value: summary.commitP50 },
      ],
    },
    {
      title: "ROOT CAUSE: DEEPGRAM VS INPUBLIC",
      rows: [
        { label: "Chunk sent → any message (p50)", value: summary.chunkToMessageP50 },
        { label: "Chunk sent → any message (p95)", value: summary.chunkToMessageP95 },
        { label: "Chunk sent → any message (max)", value: summary.chunkToMessageMax },
        { label: "VAD speech start → raw interim (p50)", value: summary.speechOnsetToRawInterimP50 },
        { label: "VAD speech start → raw interim (p95)", value: summary.speechOnsetToRawInterimP95 },
      ],
    },
    {
      title: "AUDIO-TIMELINE DIAGNOSTIC (not precise latency — see lib/telemetry.ts)",
      rows: [
        { label: "Speech → First interim", value: summary.interimLagP50 },
        { label: "Speech → Ink (p50)", value: summary.lagP50 },
        { label: "Speech → Ink (p95)", value: summary.lagP95 },
        { label: "Speech → Ink (max)", value: summary.lagMax },
      ],
    },
    {
      title: "MAIN THREAD CONTENTION",
      rows: [
        { label: "Long tasks observed", value: summary.longTaskCount || null },
        { label: "Long task (p50)", value: summary.longTaskP50 },
        { label: "Long task (max)", value: summary.longTaskMax },
      ],
    },
    {
      title: "VISUAL TIERS",
      rows: [
        { label: "Speech → Speculative mark", value: summary.speechToSpeculativeP50 },
        { label: "Speech → Scribe mark", value: summary.speechToScribeP50 },
        { label: "Speech → Structure", value: summary.speechToStructureP50 },
      ],
    },
    {
      title: "PROVIDER / TRANSPORT",
      rows: [
        { label: "Final transcript lag", value: summary.finalLagP50 },
        { label: "Audio chunk gap (p50)", value: summary.chunkGapP50 },
        { label: "Audio chunk gap (p95)", value: summary.chunkGapP95 },
        { label: "First visible word", value: summary.firstVisibleWordMs },
        { label: "Scribe queue wait", value: summary.scribeRequestWaitP50 },
        { label: "Scribe → first op", value: summary.scribeFirstOpP50 },
      ],
    },
  ];

  const lines: string[] = ["SESSION LATENCY"];
  if (summary.interimCount) lines.push(`${summary.interimCount} interims, mode ${summary.mode}`);

  for (const group of groups) {
    const present = group.rows.filter((row) => row.value !== null);
    if (!present.length) continue;
    lines.push("", group.title);
    const width = Math.max(...present.map((row) => row.label.length));
    for (const row of present) {
      lines.push(`  ${row.label.padEnd(width)}  ${String(row.value).padStart(6)} ms`);
    }
  }

  if (lines.length === 1) {
    lines.push("", "(nothing measured yet — start listening and speak)");
  }
  return lines.join("\n");
}
