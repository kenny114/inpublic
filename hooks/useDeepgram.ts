"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { noteFinalTranscript, providerRequestHeaders } from "@/lib/usage-client";
import { latency, latencyNow, type DiagnosticTraceEvent } from "@/lib/latency";
import { sttDebug } from "@/lib/sttDebug";
import { exactMicAudio } from "@/lib/corpusAudio";
import type { ReplayAudioInfo, ReplayChunkDiagnostic, ReplayConnectionDiagnostic, ReplayDisconnectPlan, ReplayPreparedSource, ReplayProviderDiagnostic, ReplaySpeechDiagnostics, ReplayStartOptions } from "@/lib/replayLab";
import { mayUseReplayScheduler, ReplayAbsoluteScheduler, type ReplayRebase } from "@/lib/replayPacing";

const isDev = process.env.NODE_ENV === "development";

export type MicStatus = "idle" | "connecting" | "live" | "reconnecting" | "error";

export interface DeepgramResultTiming {
  receivedAtMs: number;
  firstWordEndMs?: number;
  kind: "interim" | "final";
  /**
   * Wall-clock ms from the last audio chunk sent to this message arriving —
   * the same non-causal latest-chunk proximity measurement as the
   * "chunk_to_message" sample. It is carried through for backwards-compatible
   * diagnostics, not as an association between text and source audio.
   */
  sinceChunkSentMs?: number;
}

export interface SpeechStreamMetrics {
  streamEpoch: number;
  capture: "audio-worklet-pcm16" | "media-recorder" | "replay-pcm16";
  sampleRate?: number;
  audioChunks: number;
  chunkGapP50: number;
  chunkGapP95: number;
  chunkGapMax: number;
  interimResults: number;
  interimGapP50: number;
  interimGapP95: number;
  interimGapMax: number;
  interimLagP50: number;
  interimLagP95: number;
  interimLagMax: number;
  firstVisibleWordMs?: number;
  finalLagMs?: number;
}

interface Options {
  /** Fired once per finalized utterance. Times are ms since the mic was first opened. */
  onFinal: (
    text: string,
    tStart: number,
    tEnd: number,
    audioEndMs: number,
    streamEpoch: number,
    timing?: DeepgramResultTiming,
  ) => void;
  /**
   * Fired on every partial. Overwrites the previous partial.
   *
   * `audioEndMs` is where this partial ends on Deepgram's audio timeline,
   * which starts with the socket — the same instant the session clock does.
   * Comparing it against the clock is how mic-to-ink latency gets measured
   * without a stopwatch.
   */
  onInterim: (
    text: string,
    audioEndMs: number,
    streamEpoch: number,
    confidence?: number,
    timing?: DeepgramResultTiming,
  ) => void;
  /** Called the first time the mic opens, to anchor the session clock. */
  onSessionStart: () => void;
  /** Reads the current session clock in ms. */
  now: () => number;
  /** Stable application session identity for development corpus artifacts. */
  sessionId?: () => string;
  /** Anything worth showing the user or writing to the log. */
  onNote?: (text: string) => void;
  /** Surfaced in the UI. Null clears the banner. */
  onError?: (message: string | null) => void;
  /** False when another engine owns the microphone. */
  enabled?: boolean;
  /**
   * Terms to bias recognition toward, read fresh each time the socket opens.
   *
   * A getter rather than a value because the list grows as the board fills —
   * the most valuable keyterms are the ones already on the canvas, and those
   * don't exist yet when the hook is first rendered.
   *
   * Deepgram fixes keyterms at connection time, so terms discovered mid-take
   * only take effect on the next reconnect. That is a real limit and the
   * transcript-correction layer exists to cover it.
   */
  keyterms?: () => string[];
  /** Called with the terms actually sent, once per socket open. */
  onKeyterms?: (terms: string[]) => void;
  /** One compact latency/cadence summary per finalized utterance. */
  onStreamMetrics?: (metrics: SpeechStreamMetrics) => void;
}

/** Backoff schedule. Capped so a long outage still retries every few seconds. */
const BACKOFF_MS = [400, 900, 2000, 4000, 8000];
const MAX_ATTEMPTS = 12;

function percentile(values: number[], quantile: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))]);
}

interface StreamMetricAccumulator {
  chunkGaps: number[];
  interimGaps: number[];
  interimLags: number[];
  audioChunks: number;
  lastChunkAt: number;
  lastInterimAt: number;
  firstVisibleWordMs?: number;
}

const emptyMetrics = (): StreamMetricAccumulator => ({
  chunkGaps: [],
  interimGaps: [],
  interimLags: [],
  audioChunks: 0,
  lastChunkAt: 0,
  lastInterimAt: 0,
});

type CaptureState =
  | {
      kind: "audio-worklet-pcm16";
      context: AudioContext;
      source: MediaStreamAudioSourceNode;
      node: AudioWorkletNode;
      sink: GainNode;
      sampleRate: number;
    }
  | { kind: "media-recorder" }
  | {
      kind: "replay-pcm16";
      samples: Float32Array;
      sourceSampleRate: number;
      sampleRate: number;
      fileName: string;
      durationMs: number;
    };

/**
 * Browser-side Deepgram live transcription. The root key stays on the server;
 * we fetch a 60s scoped credential from /api/deepgram/token and connect with
 * that.
 *
 * A dropped socket used to end the take silently. It now reconnects with
 * exponential backoff, keeping the same MediaStream so the browser never
 * re-prompts for the microphone, and reports what is happening.
 */
export function useDeepgram({
  onFinal,
  onInterim,
  onSessionStart,
  now,
  sessionId,
  onNote,
  onError,
  enabled = true,
  keyterms,
  onKeyterms,
  onStreamMetrics,
}: Options) {
  const [status, setStatus] = useState<MicStatus>("idle");

  const connectionRef = useRef<any>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const captureRef = useRef<CaptureState | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedRef = useRef(false);
  const reconnectingRef = useRef(false);
  const attemptsRef = useRef(0);
  const socketOpenRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Aborts an in-flight token fetch when the user stops mid-connect. */
  const abortRef = useRef<AbortController | null>(null);
  const replayCancelledRef = useRef(false);
  const replaySenderActiveRef = useRef(false);
  const replayCompletionRef = useRef<{
    resolve: (info: ReplayAudioInfo) => void;
    reject: (error: Error) => void;
  } | null>(null);
  const replayStartedAtRef = useRef(0);
  const replayAudioStartedAtRef = useRef(0);
  const replayDisconnectPlanRef = useRef<ReplayDisconnectPlan>({ atAudioMs: [] });
  const replayForcedDisconnectsRef = useRef<Set<number>>(new Set());
  const replayChunksRef = useRef<ReplayChunkDiagnostic[]>([]);
  const replayProviderResponsesRef = useRef<ReplayProviderDiagnostic[]>([]);
  const replayConnectionsRef = useRef<ReplayConnectionDiagnostic[]>([]);
  const connectionGenerationRef = useRef(0);
  const socketGenerationRef = useRef(0);
  const currentConnectionGenerationRef = useRef(0);
  const currentSocketGenerationRef = useRef(0);
  const socketAudioBaseMsRef = useRef<Map<number, number>>(new Map());
  const replayLatestProviderAudioMsRef = useRef<number | null>(null);
  const replaySendAttemptsRef = useRef(0);
  const replayPausedSendsRef = useRef(0);
  const replayRebasesRef = useRef<ReplayRebase[]>([]);
  const replayStartOptionsRef = useRef<ReplayStartOptions>({});

  const replayElapsed = useCallback(() => replayStartedAtRef.current ? performance.now() - replayStartedAtRef.current : 0, []);
  const noteReplayConnection = useCallback((event: ReplayConnectionDiagnostic["event"], detail?: string, audioPositionMs: number | null = null, chunkSequence: number | null = null) => {
    if (!isDev || captureRef.current?.kind !== "replay-pcm16") return;
    replayConnectionsRef.current.push({
      event,
      atMs: Math.round(replayElapsed()),
      wallClockTimeMs: performance.now(),
      connectionGeneration: currentConnectionGenerationRef.current,
      socketGeneration: currentSocketGenerationRef.current,
      audioPositionMs,
      chunkSequence,
      ...(detail ? { detail } : {}),
    });
  }, [replayElapsed]);

  /**
   * Where this socket's audio timeline sits on the session clock.
   *
   * Deepgram stamps every result with its position on an audio timeline that
   * starts at zero when the SOCKET opens — not when the session does. On a
   * reconnect that timeline restarts while the session clock keeps running,
   * so `now() - audioEnd` silently starts measuring time-since-reconnect
   * instead of latency. In the 10:09 session that put 53 of 84 utterances at a
   * reported lag of ~202 seconds. The real numbers were fine; the meter was
   * broken. Anchoring the timeline per socket fixes the measurement.
   */
  const audioEpochRef = useRef(0);
  /** Monotonic identity for timestamps produced by each socket. */
  const streamEpochRef = useRef(0);
  const streamMetricsRef = useRef<StreamMetricAccumulator>(emptyMetrics());

  /**
   * Diagnostic-only instrumentation for the "is Deepgram slow, or is our own
   * bookkeeping wrong" question, temporary and additive — it changes no
   * transcription behaviour.
   *
   * `lastChunkSentAtRef` measures wall-clock proximity to the latest send. It
   * is independent of Deepgram's `start`/`duration`, but it is not causal:
   * continuous audio means the latest chunk is usually newer than the audio
   * represented by the response. ReplaySpeechDiagnostics provides the causal
   * sample-clock association for development investigations.
   */
  const lastChunkSentAtRef = useRef(0);
  /** Set on Deepgram's own SpeechStarted VAD event; cleared once consumed by
   * the first raw interim that follows, so it is measured once per utterance
   * rather than accumulating. */
  const speechStartedAtRef = useRef<number | null>(null);

  const currentTraceRef = useRef<DiagnosticTraceEvent[]>([]);
  const currentTraceStartRef = useRef(0);
  const firstTraceRef = useRef<DiagnosticTraceEvent[] | null>(null);
  const worstTraceRef = useRef<{ maxGap: number; events: DiagnosticTraceEvent[] } | null>(null);
  const MAX_TRACE_EVENTS = 60;

  const pushTrace = useCallback((event: Omit<DiagnosticTraceEvent, "tMs">, atMs: number) => {
    if (!currentTraceStartRef.current) currentTraceStartRef.current = atMs;
    const trace = currentTraceRef.current;
    if (trace.length < MAX_TRACE_EVENTS) {
      trace.push({ ...event, tMs: Math.round(atMs - currentTraceStartRef.current) });
    }
  }, []);

  const closeTrace = useCallback(() => {
    const events = currentTraceRef.current;
    const maxGap = Math.max(0, ...events.map((e) => e.sinceChunkSentMs ?? 0));
    if (!firstTraceRef.current && events.length) firstTraceRef.current = events;
    if (events.length && (!worstTraceRef.current || maxGap > worstTraceRef.current.maxGap)) {
      worstTraceRef.current = { maxGap, events };
    }
    currentTraceRef.current = [];
    currentTraceStartRef.current = 0;
  }, []);

  /**
   * The Deepgram SDK module, once imported.
   *
   * The import is a network fetch of a lazy chunk on a cold load, and it used
   * to sit in the middle of the startup chain between the token and the
   * socket. Hoisting it into prewarm takes it off the critical path entirely.
   */
  const sdkRef = useRef<typeof import("@deepgram/sdk") | null>(null);
  /**
   * The last minted credential, kept until shortly before it expires.
   *
   * This is the fix for a real mismatch: /api/deepgram/token is rate limited
   * to 3 mints per 10 minutes (lib/server/limits.ts), while the reconnect
   * ladder below will try up to 12 times and used to mint a fresh credential
   * on every single attempt. A session that dropped four times in ten minutes
   * could not come back — the 4th mint returned 429 and the remaining
   * attempts burned against a wall.
   *
   * Reusing an unexpired credential also makes the common case (a brief
   * network blip) reconnect without a server round trip at all.
   */
  const tokenRef = useRef<{ accessToken?: string; key?: string; expiresAtMs: number } | null>(null);
  /** In-flight prewarm, so concurrent callers share one microphone request. */
  const prewarmRef = useRef<Promise<void> | null>(null);

  const cbs = useRef({
    onFinal,
    onInterim,
    onSessionStart,
    now,
    sessionId,
    onNote,
    onError,
    keyterms,
    onKeyterms,
    onStreamMetrics,
  });
  cbs.current = {
    onFinal,
    onInterim,
    onSessionStart,
    now,
    sessionId,
    onNote,
    onError,
    keyterms,
    onKeyterms,
    onStreamMetrics,
  };

  /** Tear down the socket and recorder but KEEP the microphone stream. */
  const teardownSocket = useCallback(() => {
    socketOpenRef.current = false;
    if (keepAliveRef.current) {
      clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
    try {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
    } catch {
      /* already stopped */
    }
    recorderRef.current = null;
    try {
      connectionRef.current?.requestClose();
    } catch {
      /* already closed */
    }
    connectionRef.current = null;
  }, []);

  const noteAudioChunk = useCallback(() => {
    const at = performance.now();
    const metrics = streamMetricsRef.current;
    if (metrics.lastChunkAt) {
      const gap = at - metrics.lastChunkAt;
      metrics.chunkGaps.push(gap);
      latency.observe("chunk_gap", gap);
    }
    metrics.lastChunkAt = at;
    metrics.audioChunks += 1;
    latency.mark("first_audio_chunk", at);
  }, []);

  const socketBufferedAmount = useCallback((connection: any): number | null => {
    // The Deepgram SDK does not expose bufferedAmount, but its browser client
    // retains the native WebSocket as `conn`. Replay diagnostics inspect that
    // runtime field without making production transport depend on it.
    const value = Number(connection?.conn?.bufferedAmount);
    return Number.isFinite(value) ? value : null;
  }, []);

  const findReplayChunkAt = useCallback((globalAudioMs: number | null) => {
    if (globalAudioMs === null || !Number.isFinite(globalAudioMs)) return null;
    const chunks = replayChunksRef.current;
    for (let index = chunks.length - 1; index >= 0; index -= 1) {
      const chunk = chunks[index];
      if (globalAudioMs >= chunk.audioStartMs - 1 && globalAudioMs <= chunk.audioEndMs + 1) return chunk;
      if (chunk.audioEndMs <= globalAudioMs) return chunk;
    }
    return null;
  }, []);

  const collectReplayDiagnostics = useCallback((): ReplaySpeechDiagnostics => {
    const chunks = replayChunksRef.current.map((chunk) => ({ ...chunk }));
    const providerResponses = replayProviderResponsesRef.current.map((response) => ({ ...response }));
    const connections = replayConnectionsRef.current.map((event) => ({ ...event }));
    const nullable = (values: Array<number | null>, quantile: number) => {
      const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
      return finite.length ? percentile(finite, quantile) : null;
    };
    const maximum = (values: Array<number | null>) => {
      const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
      return finite.length ? Math.round(Math.max(...finite)) : null;
    };
    const scheduleErrors = chunks.map((chunk) => chunk.scheduleErrorMs);
    const sendLags = chunks.map((chunk) => chunk.sendLagMs);
    const buffers = chunks.map((chunk) => chunk.bufferedAmount);
    const regionLags = providerResponses.map((response) => response.providerRegionLagMs);
    const wordLags = providerResponses.map((response) => response.latestWordLagMs);
    const liveEdgeLags = providerResponses.map((response) => response.audioLiveEdgeLagMs);
    const checkpointLag = (sourceMs: number) => {
      const chunk = chunks.find((candidate) => candidate.audioEndMs >= sourceMs);
      return chunk ? Math.round(chunk.sendLagMs) : null;
    };
    return {
      disconnectPlan: { atAudioMs: [...replayDisconnectPlanRef.current.atAudioMs] },
      chunks,
      providerResponses,
      connections,
      summary: {
        sendAttempts: replaySendAttemptsRef.current,
        successfulSends: chunks.length,
        pausedSends: replayPausedSendsRef.current,
        reconnectCount: connections.filter((event) => event.event === "reconnect_scheduled").length,
        forcedDisconnectCount: connections.filter((event) => event.event === "forced_close").length,
        rebaseCount: replayRebasesRef.current.length,
        rebaseReasons: replayRebasesRef.current.map((rebase) => rebase.reason),
        intentionalRebaseDelayMs: Math.round(replayRebasesRef.current.at(-1)?.totalIntentionalDelayMs ?? 0),
        scheduleErrorP50: nullable(scheduleErrors, .5),
        scheduleErrorP95: nullable(scheduleErrors, .95),
        scheduleErrorMax: maximum(scheduleErrors),
        scheduledSendErrorP50: nullable(scheduleErrors, .5),
        scheduledSendErrorP95: nullable(scheduleErrors, .95),
        scheduledSendErrorMax: maximum(scheduleErrors),
        sendLagP50: nullable(sendLags, .5),
        sendLagP95: nullable(sendLags, .95),
        sendLagMax: maximum(sendLags),
        bufferedAmountP50: nullable(buffers, .5),
        bufferedAmountP95: nullable(buffers, .95),
        bufferedAmountMax: maximum(buffers),
        providerRegionLagP50: nullable(regionLags, .5),
        providerRegionLagP95: nullable(regionLags, .95),
        providerRegionLagMax: maximum(regionLags),
        latestWordLagP50: nullable(wordLags, .5),
        latestWordLagP95: nullable(wordLags, .95),
        latestWordLagMax: maximum(wordLags),
        audioLiveEdgeLagP50: nullable(liveEdgeLags, .5),
        audioLiveEdgeLagP95: nullable(liveEdgeLags, .95),
        audioLiveEdgeLagMax: maximum(liveEdgeLags),
        sendLagAt10s: checkpointLag(10_000),
        sendLagAt30s: checkpointLag(30_000),
        sendLagAt60s: checkpointLag(60_000),
        sendLagAt87s: checkpointLag(87_000),
      },
    };
  }, []);

  const prepareCapture = useCallback(async (stream: MediaStream) => {
    if (captureRef.current) return;
    if (typeof AudioWorkletNode !== "undefined") {
      let context: AudioContext | null = null;
      try {
        context = new AudioContext({ latencyHint: "interactive" });
        await context.audioWorklet.addModule("/pcm-capture-worklet.js");
        const source = context.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(context, "inpublic-pcm-capture");
        const sink = context.createGain();
        sink.gain.value = 0;
        node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
          const capture = captureRef.current;
          const sampleRate = capture?.kind === "audio-worklet-pcm16" ? capture.sampleRate : context?.sampleRate ?? 48000;
          const connection = connectionRef.current;
          let sent = false;
          let bufferedAmount: number | null = null;
          if (socketOpenRef.current && connection) {
            noteAudioChunk();
            try {
              // This remains first. Corpus retention observes the same buffer
              // only after the normal transport send has returned.
              connection.send(event.data);
              lastChunkSentAtRef.current = cbs.current.now();
              sent = true;
              bufferedAmount = socketBufferedAmount(connection);
              if (sttDebug.enabled) sttDebug.recordAudio(event.data, sampleRate);
            } catch {
              /* socket closed between the open check and send */
            }
          }
          // During reconnect gaps the worklet continues producing PCM. Keep
          // those samples continuous and mark them unsent/null-epoch rather
          // than silently splicing two transport epochs together.
          if (isDev && exactMicAudio.retaining) {
            exactMicAudio.recordChunk(event.data, sampleRate, {
              sent,
              streamEpoch: sent ? streamEpochRef.current : null,
              bufferedAmount,
            });
          }
        };
        source.connect(node);
        node.connect(sink);
        sink.connect(context.destination);
        await context.resume();
        captureRef.current = {
          kind: "audio-worklet-pcm16",
          context,
          source,
          node,
          sink,
          sampleRate: context.sampleRate,
        };
        latency.mark("worklet_ready", latencyNow());
        return;
      } catch (error) {
        await context?.close().catch(() => {});
        cbs.current.onNote?.(`PCM capture unavailable; using MediaRecorder: ${String(error)}`);
      }
    }
    captureRef.current = { kind: "media-recorder" };
    latency.mark("worklet_ready", latencyNow());
  }, [noteAudioChunk, socketBufferedAmount]);

  /** Import the SDK once and hold it. Safe to call repeatedly. */
  const loadSdk = useCallback(async () => {
    if (!sdkRef.current) sdkRef.current = await import("@deepgram/sdk");
    latency.mark("sdk_ready", latencyNow());
    return sdkRef.current;
  }, []);

  /**
   * Everything that can happen before we are allowed to send audio anywhere.
   *
   * Acquiring the microphone, building the worklet graph and fetching the SDK
   * chunk are all local to the browser: none of them contacts Deepgram, none
   * of them costs money, and none of them depends on the usage lease. They
   * used to run *after* the entitlement check and the lease POST had both
   * completed, which made the whole startup a single serial chain.
   *
   * Running this concurrently with the lease is safe precisely because no
   * audio can leave the machine until `socketOpenRef` is true, and the socket
   * is not opened until the lease has been granted and a token minted with it.
   * The microphone light may come on a few hundred milliseconds before the
   * lease resolves; nothing is transmitted in that window.
   */
  const prewarm = useCallback(async () => {
    if (prewarmRef.current) return prewarmRef.current;
    const task = (async () => {
      // Kick the SDK fetch off first — it is pure network and overlaps the
      // permission prompt, which is usually the longest part of this.
      const sdk = loadSdk();
      if (!streamRef.current) {
        streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
        latency.mark("mic_permission", latencyNow());
      }
      await prepareCapture(streamRef.current);
      await sdk;
    })();
    prewarmRef.current = task;
    try {
      await task;
    } catch (err) {
      // A failed prewarm must not be cached as a success; the next attempt
      // gets a clean run at it.
      prewarmRef.current = null;
      throw err;
    }
    return task;
  }, [loadSdk, prepareCapture]);

  const stop = useCallback((preserveCredential = false) => {
    replayCancelledRef.current = true;
    startedRef.current = false;
    reconnectingRef.current = false;
    attemptsRef.current = 0;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;
    prewarmRef.current = null;
    // The credential is scoped to the listening session that is ending. Even
    // though it may still be valid for a few seconds, holding it across a stop
    // would outlive the lease it was minted under.
    if (!preserveCredential) tokenRef.current = null;

    exactMicAudio.finishSession();
    teardownSocket();
    const capture = captureRef.current;
    captureRef.current = null;
    if (capture?.kind === "audio-worklet-pcm16") {
      capture.source.disconnect();
      capture.node.disconnect();
      capture.sink.disconnect();
      void capture.context.close();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    setStatus("idle");
    cbs.current.onError?.(null);
  }, [teardownSocket]);

  // openSocket and scheduleReconnect are mutually recursive; a ref breaks the
  // cycle without making either callback unstable.
  const reconnectRef = useRef<() => void>(() => {});

  const openSocket = useCallback(async () => {
    if (captureRef.current?.kind === "replay-pcm16") {
      currentConnectionGenerationRef.current = ++connectionGenerationRef.current;
      noteReplayConnection("connecting");
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    // Reuse a credential that is still comfortably valid rather than minting
    // a new one. See tokenRef for why this is load-bearing and not just an
    // optimisation.
    const cached = tokenRef.current;
    let credential = cached && cached.expiresAtMs > Date.now() ? cached : null;
    if (credential) noteReplayConnection("credential_reused");

    if (!credential) {
      let headers = providerRequestHeaders();
      if (captureRef.current?.kind === "replay-pcm16") {
        const replayResponse = await fetch("/api/dev/replay-authorization", {
          method: "POST",
          signal: ac.signal,
          headers: { "content-type": "application/json" },
        });
        if (!replayResponse.ok) throw new Error(`replay authorization ${replayResponse.status}`);
        const replay = await replayResponse.json() as { authorization?: string };
        if (!replay.authorization) throw new Error("replay authorization missing");
        headers = { ...headers, "x-inpublic-replay-authorization": replay.authorization };
      }
      const res = await fetch("/api/deepgram/token", { signal: ac.signal, headers });
      if (!res.ok) {
      const body = await res.text();
      // The Owner/Admin hint is only ever relevant to a 500 here — that's
      // the one path (app/api/deepgram/token/route.ts's catch block) where
      // the actual Deepgram credential-mint call failed, which a
      // usage-only key can do. A 429/503 is our OWN guardProviderRequest
      // rejecting the request (rate limit, spend limit, session lease) —
      // entirely unrelated to what the key is allowed to do, and the guard's
      // own message in `body` already explains the real reason. Appending
      // the hint unconditionally previously told a correctly-configured key
      // it needed permissions it already had, whenever the real cause was
      // just "too many requests, wait and retry."
        const hint =
          res.status === 500
            ? " The Deepgram key needs a role that can mint credentials (Owner or Admin); a usage-only key cannot."
            : "";
        throw new Error(`token ${res.status}: ${body}.${hint}`);
      }
      const { accessToken, key, expiresIn } = (await res.json()) as {
        accessToken?: string;
        key?: string;
        expiresIn?: number;
      };
      if (!accessToken && !key) throw new Error("no credential returned");

      // Retire the cached copy well before the real expiry. A credential that
      // dies during the WebSocket handshake fails the connection outright, and
      // the margin costs nothing.
      const ttlSeconds = Number.isFinite(expiresIn) ? Number(expiresIn) : 60;
      credential = {
        accessToken,
        key,
        expiresAtMs: Date.now() + Math.max(0, ttlSeconds - 10) * 1000,
      };
      tokenRef.current = credential;
      noteReplayConnection("credential_minted");
    }
    latency.mark("token_ready", latencyNow());

    const { createClient, LiveTranscriptionEvents } = await loadSdk();

    const stream = streamRef.current;
    if (!stream && captureRef.current?.kind !== "replay-pcm16") throw new Error("microphone stream is gone");

    // /auth/grant returns a bearer token; createProjectKey returns an API key.
    const deepgram = credential.accessToken
      ? createClient({ accessToken: credential.accessToken })
      : createClient(credential.key as string);

    // Bias recognition toward what the speaker actually says. nova-3 takes
    // `keyterm`, repeated once per term; the SDK accepts an array. This is the
    // only fix that works before the mistake is made — everything downstream
    // is repair.
    const terms = (cbs.current.keyterms?.() ?? []).slice(0, 40);

    const capture = captureRef.current;
    const connection = deepgram.listen.live({
      model: "nova-3",
      interim_results: true,
      smart_format: true,
      // Endpointing is how long Deepgram waits for silence before it will
      // finalise. It is the single biggest contributor to the "pause and it
      // writes" feel, so keep it short.
      endpointing: 150,
      utterance_end_ms: 1000,
      punctuate: true,
      // Diagnostic only: adds SpeechStarted/UtteranceEnd events to the socket.
      // Deepgram documents this as informational — it does not change
      // endpointing, interim behaviour, or transcription accuracy, so this is
      // additive instrumentation, not a behavioural change. It gives a
      // ground-truth "the user started talking" timestamp from Deepgram's own
      // VAD, independent of anything InPublic infers from text.
      vad_events: true,
      ...(capture?.kind === "audio-worklet-pcm16" || capture?.kind === "replay-pcm16"
        ? { encoding: "linear16" as const, sample_rate: capture.sampleRate, channels: 1 }
        : {}),
      ...(terms.length ? { keyterm: terms } : {}),
    });
    connectionRef.current = connection;
    const connectionGeneration = currentConnectionGenerationRef.current;
    let socketGeneration = 0;

    connection.on(LiveTranscriptionEvents.Open, () => {
      cbs.current.onSessionStart();
      // Anchor this socket's audio timeline to the session clock.
      audioEpochRef.current = cbs.current.now();
      streamEpochRef.current += 1;
      if (captureRef.current?.kind === "replay-pcm16") {
        socketGeneration = ++socketGenerationRef.current;
        currentSocketGenerationRef.current = socketGeneration;
        noteReplayConnection("open");
      }
      streamMetricsRef.current = emptyMetrics();
      currentTraceRef.current = [];
      currentTraceStartRef.current = 0;
      speechStartedAtRef.current = null;
      socketOpenRef.current = true;
      latency.mark("socket_open", latencyNow());
      if (terms.length) cbs.current.onKeyterms?.(terms);
      attemptsRef.current = 0;
      reconnectingRef.current = false;
      setStatus("live");
      cbs.current.onError?.(null);

      // AudioWorklet is primary; MediaRecorder is a compatibility fallback.
      // Its timeslice is advisory, so the real chunk cadence is measured.
      if (capture?.kind === "media-recorder") {
        if (!stream) return;
        const recorder = new MediaRecorder(stream);
        recorderRef.current = recorder;
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            noteAudioChunk();
            try {
              connection.send(event.data);
              lastChunkSentAtRef.current = cbs.current.now();
            } catch {
              /* socket closed mid-chunk */
            }
          }
        };
        recorder.start(80);
      }

      if (capture?.kind === "replay-pcm16" && mayUseReplayScheduler(capture.kind)) {
        replayCancelledRef.current = false;
        // Reconnects run this Open handler too. The existing sender owns the
        // file offset and resumes against connectionRef; never start a second
        // sender from offset zero.
        if (replaySenderActiveRef.current) return;
        replaySenderActiveRef.current = true;
        void (async () => {
          const framesPerChunk = Math.round(capture.sampleRate * 0.08);
          let chunkCount = 0;
          try {
            await replayStartOptionsRef.current.beforeAudioStart?.();
            const startedAt = performance.now();
            replayAudioStartedAtRef.current = startedAt;
            const scheduler = new ReplayAbsoluteScheduler(startedAt);
            let reconnectRebasePending = false;
            const recordRebase = (rebase: ReplayRebase | null, chunkSequence: number) => {
              if (!rebase) return;
              replayRebasesRef.current.push(rebase);
              noteReplayConnection(
                "scheduler_rebase",
                `${rebase.reason}; +${Math.round(rebase.addedIntentionalDelayMs)}ms; total ${Math.round(rebase.totalIntentionalDelayMs)}ms`,
                rebase.sourceTimeMs,
                chunkSequence,
              );
            };
            for (let offset = 0; offset < capture.samples.length; offset += framesPerChunk) {
              const end = Math.min(offset + framesPerChunk, capture.samples.length);
              const audioStartMs = offset / capture.sampleRate * 1000;
              const audioEndMs = end / capture.sampleRate * 1000;
              const chunkSequence = chunkCount + 1;
              const pcm = new Int16Array(end - offset);
              for (let index = offset; index < end; index += 1) {
                const sample = Math.max(-1, Math.min(1, capture.samples[index]));
                pcm[index - offset] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
              }
              let sent = false;
              let disconnectedAt: number | null = null;
              let pausedBeforeSend = false;
              let sendAttempts = 0;
              while (!sent) {
                if (replayCancelledRef.current) throw new Error("Replay cancelled by the run coordinator");
                if (!socketOpenRef.current || !connectionRef.current) {
                  if (!pausedBeforeSend) {
                    pausedBeforeSend = true;
                    replayPausedSendsRef.current += 1;
                  }
                  disconnectedAt ??= performance.now();
                  reconnectRebasePending = true;
                  if (performance.now() - disconnectedAt > 20_000) {
                    throw new Error(`Replay reconnect timed out at ${Math.round(offset / capture.sampleRate * 1000)}ms`);
                  }
                  await new Promise((resolve) => setTimeout(resolve, 25));
                  continue;
                }
                let deadline = scheduler.resolve(
                  audioStartMs,
                  performance.now(),
                  reconnectRebasePending ? "reconnect" : undefined,
                );
                reconnectRebasePending = false;
                recordRebase(deadline.rebase, chunkSequence);
                if (deadline.delayMs > 1) await new Promise((resolve) => setTimeout(resolve, deadline.delayMs));
                // Re-check after the one-shot timer. A suspended browser may
                // wake far past the deadline; rebase this next unsent chunk
                // once instead of bursting every overdue chunk.
                deadline = scheduler.resolve(audioStartMs, performance.now());
                recordRebase(deadline.rebase, chunkSequence);
                const activeConnection = connectionRef.current;
                if (!socketOpenRef.current || !activeConnection) {
                  reconnectRebasePending = true;
                  continue;
                }
                try {
                  sendAttempts += 1;
                  replaySendAttemptsRef.current += 1;
                  const idealScheduledAt = startedAt + audioStartMs;
                  const scheduledAt = deadline.targetAtMs;
                  activeConnection.send(pcm.buffer);
                  const sentAt = performance.now();
                  noteAudioChunk();
                  lastChunkSentAtRef.current = cbs.current.now();
                  const socketGeneration = currentSocketGenerationRef.current;
                  if (!socketAudioBaseMsRef.current.has(socketGeneration)) {
                    socketAudioBaseMsRef.current.set(socketGeneration, audioStartMs);
                    if (socketGeneration > 1) noteReplayConnection("resume", undefined, audioStartMs, chunkSequence);
                  }
                  const elapsed = sentAt - startedAt;
                  const sendLeadMs = audioEndMs - elapsed;
                  replayChunksRef.current.push({
                    chunkSequence,
                    sampleStart: offset,
                    sampleEnd: end,
                    audioStartMs,
                    audioEndMs,
                    idealScheduledAtMs: idealScheduledAt - startedAt,
                    cadenceScheduledAtMs: scheduledAt - startedAt,
                    sentAtMs: elapsed,
                    wallClockSendTimeMs: sentAt,
                    scheduleErrorMs: sentAt - scheduledAt,
                    scheduledSendErrorMs: sentAt - scheduledAt,
                    cadenceErrorMs: sentAt - scheduledAt,
                    sourceClockDriftMs: sentAt - scheduledAt,
                    intentionalRebaseDelayMs: scheduler.intentionalRebaseDelayMs,
                    sendLeadMs,
                    sendLagMs: Math.max(0, sentAt - scheduledAt),
                    socketGeneration,
                    connectionGeneration: currentConnectionGenerationRef.current,
                    bufferedAmount: socketBufferedAmount(activeConnection),
                    sendAttempts,
                    pausedBeforeSend,
                  });
                  sent = true;

                  const forcedAt = replayDisconnectPlanRef.current.atAudioMs.find((target) =>
                    audioEndMs >= target && !replayForcedDisconnectsRef.current.has(target));
                  if (forcedAt !== undefined) {
                    replayForcedDisconnectsRef.current.add(forcedAt);
                    noteReplayConnection("forced_close", `planned at ${forcedAt}ms`, audioEndMs, chunkSequence);
                    // Development-only abrupt transport close. requestClose()
                    // asks Deepgram to finalize normally, which would not test
                    // the reconnect/resume path under investigation.
                    // Pause the replay sender synchronously: WebSocket.close()
                    // changes readyState immediately, but the SDK's Close
                    // callback can arrive later after its queued frame drains.
                    socketOpenRef.current = false;
                    activeConnection?.conn?.close(4000, "dev replay forced disconnect");
                  }
                } catch {
                  disconnectedAt ??= performance.now();
                  reconnectRebasePending = true;
                  await new Promise((resolve) => setTimeout(resolve, 25));
                }
              }
              chunkCount += 1;
              replayStartOptionsRef.current.onProgress?.(audioEndMs, chunkCount);
            }
            const pacingDriftMs = Math.round(replayChunksRef.current.at(-1)?.sourceClockDriftMs ?? 0);
            // Give endpointing and the final transcript time to arrive before
            // handing control back to the lab. The socket itself is stopped by
            // the run coordinator, consistently for every mode.
            await new Promise((resolve) => setTimeout(resolve, 1800));
            replayCompletionRef.current?.resolve({
              name: capture.fileName,
              durationMs: Math.round(capture.durationMs),
              sourceSampleRate: capture.sourceSampleRate,
              replaySampleRate: capture.sampleRate,
              chunkCount,
              pacingDriftMs,
              diagnostics: collectReplayDiagnostics(),
            });
          } catch (error) {
            replayCompletionRef.current?.reject(error instanceof Error ? error : new Error(String(error)));
          } finally {
            replaySenderActiveRef.current = false;
            replayCompletionRef.current = null;
          }
        })();
      }

      // Deepgram closes idle sockets after ~10s of silence.
      keepAliveRef.current = setInterval(() => {
        try {
          connection.keepAlive();
        } catch {
          /* noop */
        }
      }, 8000);
    });

    connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
      // Before the empty-text early return on purpose: an empty result still
      // carries is_final/speech_final timing that a segmentation question needs.
      if (sttDebug.enabled) sttDebug.recordMessage(data);

      const alt = data?.channel?.alternatives?.[0];
      const text: string = alt?.transcript ?? "";
      const receivedAtMs = cbs.current.now();
      if (isDev && captureRef.current?.kind === "replay-pcm16") {
        const wallClockReceiveTimeMs = performance.now();
        const providerStart = Number(data?.start);
        const providerDuration = Number(data?.duration);
        const providerStartMs = Number.isFinite(providerStart) ? providerStart * 1000 : null;
        const providerDurationMs = Number.isFinite(providerDuration) ? providerDuration * 1000 : null;
        const providerRegionEndMs = providerStartMs !== null && providerDurationMs !== null
          ? providerStartMs + providerDurationMs
          : null;
        const wordEnds = Array.isArray(alt?.words)
          ? alt.words.map((word: any) => Number(word?.end) * 1000).filter(Number.isFinite)
          : [];
        const latestWordEndMs = wordEnds.length ? Math.max(...wordEnds) : null;
        const base = socketAudioBaseMsRef.current.get(socketGeneration) ?? null;
        const globalRegionEndMs = base !== null && providerRegionEndMs !== null ? base + providerRegionEndMs : null;
        const globalLatestWordEndMs = base !== null && latestWordEndMs !== null ? base + latestWordEndMs : null;
        const regionChunk = findReplayChunkAt(globalRegionEndMs);
        const wordChunk = findReplayChunkAt(globalLatestWordEndMs);
        const latestChunk = replayChunksRef.current.at(-1) ?? null;
        const latestAudioSentMs = latestChunk?.audioEndMs ?? null;
        if (globalRegionEndMs !== null) {
          replayLatestProviderAudioMsRef.current = Math.max(
            replayLatestProviderAudioMsRef.current ?? Number.NEGATIVE_INFINITY,
            globalRegionEndMs,
          );
        }
        const latestProviderConfirmedAudioMs = replayLatestProviderAudioMsRef.current;
        replayProviderResponsesRef.current.push({
          responseSequence: replayProviderResponsesRef.current.length + 1,
          receivedAtMs: replayAudioStartedAtRef.current ? wallClockReceiveTimeMs - replayAudioStartedAtRef.current : 0,
          wallClockReceiveTimeMs,
          socketGeneration,
          connectionGeneration,
          requestId: typeof data?.metadata?.request_id === "string" ? data.metadata.request_id : null,
          providerStartMs,
          providerDurationMs,
          providerRegionEndMs,
          latestWordEndMs,
          globalRegionEndMs,
          globalLatestWordEndMs,
          relevantRegionSentAtMs: regionChunk?.sentAtMs ?? null,
          relevantWordSentAtMs: wordChunk?.sentAtMs ?? null,
          providerRegionLagMs: regionChunk ? wallClockReceiveTimeMs - regionChunk.wallClockSendTimeMs : null,
          latestWordLagMs: wordChunk ? wallClockReceiveTimeMs - wordChunk.wallClockSendTimeMs : null,
          latestAudioSentMs,
          latestProviderConfirmedAudioMs,
          audioLiveEdgeLagMs: latestAudioSentMs !== null && latestProviderConfirmedAudioMs !== null
            ? Math.max(0, latestAudioSentMs - latestProviderConfirmedAudioMs)
            : null,
          legacyLatestChunkToMessageMs: lastChunkSentAtRef.current
            ? Math.max(0, Math.round(receivedAtMs - lastChunkSentAtRef.current))
            : null,
          transcriptExcerpt: text.slice(0, 120),
          isFinal: Boolean(data?.is_final),
          speechFinal: Boolean(data?.speech_final),
          fromFinalize: Boolean(data?.from_finalize),
        });
      }
      if (!text.trim()) return;

      const audioEndMs =
        audioEpochRef.current +
        ((data.start ?? 0) + (data.duration ?? 0)) * 1000;
      const firstWordEnd = Number(alt?.words?.[0]?.end);
      const firstWordEndMs = Number.isFinite(firstWordEnd)
        ? audioEpochRef.current + firstWordEnd * 1000
        : undefined;
      const metrics = streamMetricsRef.current;

      // Diagnostic only, see lastChunkSentAtRef above: proximity to the most
      // recent send, not the causal latency of the transcript's audio region.
      const sinceChunkSentMs = lastChunkSentAtRef.current
        ? Math.max(0, Math.round(receivedAtMs - lastChunkSentAtRef.current))
        : undefined;
      if (sinceChunkSentMs !== undefined) latency.observe("chunk_to_message", sinceChunkSentMs);
      if (speechStartedAtRef.current !== null) {
        // Only the first raw text after a SpeechStarted event consumes it —
        // this is meant to measure "VAD said you started talking" to "the
        // first text about it", once per utterance, not every revision.
        latency.observe(
          "speech_onset_to_raw_interim",
          Math.max(0, Math.round(receivedAtMs - speechStartedAtRef.current)),
        );
        speechStartedAtRef.current = null;
      }
      pushTrace(
        { kind: data.is_final ? "final" : "interim", text: text.slice(0, 80), sinceChunkSentMs },
        receivedAtMs,
      );

      if (data.is_final) {
        noteFinalTranscript();
        const tEnd = receivedAtMs;
        const durationMs = (data.duration ?? 0) * 1000;
        const finalLagMs = Math.max(0, Math.round(receivedAtMs - audioEndMs));
        latency.observe("final_lag", finalLagMs);
        cbs.current.onFinal(
          text,
          Math.max(0, tEnd - durationMs),
          tEnd,
          audioEndMs,
          streamEpochRef.current,
          { receivedAtMs, firstWordEndMs, kind: "final", sinceChunkSentMs },
        );
        cbs.current.onInterim("", audioEndMs, streamEpochRef.current, Number(alt?.confidence ?? 0));
        const captureNow = captureRef.current;
        cbs.current.onStreamMetrics?.({
          streamEpoch: streamEpochRef.current,
          capture: captureNow?.kind ?? "media-recorder",
          sampleRate: captureNow?.kind === "audio-worklet-pcm16" ? captureNow.sampleRate : undefined,
          audioChunks: metrics.audioChunks,
          chunkGapP50: percentile(metrics.chunkGaps, 0.5),
          chunkGapP95: percentile(metrics.chunkGaps, 0.95),
          chunkGapMax: metrics.chunkGaps.length ? Math.round(Math.max(...metrics.chunkGaps)) : 0,
          interimResults: metrics.interimLags.length,
          interimGapP50: percentile(metrics.interimGaps, 0.5),
          interimGapP95: percentile(metrics.interimGaps, 0.95),
          interimGapMax: metrics.interimGaps.length ? Math.round(Math.max(...metrics.interimGaps)) : 0,
          interimLagP50: percentile(metrics.interimLags, 0.5),
          interimLagP95: percentile(metrics.interimLags, 0.95),
          interimLagMax: metrics.interimLags.length ? Math.round(Math.max(...metrics.interimLags)) : 0,
          firstVisibleWordMs: metrics.firstVisibleWordMs,
          finalLagMs,
        });
        streamMetricsRef.current = emptyMetrics();
        closeTrace();
      } else {
        latency.mark("first_interim", latencyNow());
        latency.countInterim();
        if (metrics.lastInterimAt) {
          const gap = receivedAtMs - metrics.lastInterimAt;
          metrics.interimGaps.push(gap);
          latency.observe("interim_gap", gap);
        }
        metrics.lastInterimAt = receivedAtMs;
        const interimLag = Math.max(0, receivedAtMs - audioEndMs);
        metrics.interimLags.push(interimLag);
        latency.observe("interim_lag", interimLag);
        if (metrics.firstVisibleWordMs === undefined && firstWordEndMs !== undefined) {
          metrics.firstVisibleWordMs = Math.max(0, Math.round(receivedAtMs - firstWordEndMs));
          latency.observe("first_visible_word", metrics.firstVisibleWordMs);
        }
        cbs.current.onInterim(
          text,
          audioEndMs,
          streamEpochRef.current,
          Number(alt?.confidence ?? 0),
          { receivedAtMs, firstWordEndMs, kind: "interim", sinceChunkSentMs },
        );
      }
    });

    // Diagnostic only — see the `vad_events: true` comment above. Neither
    // handler changes what gets transcribed or when it finalises.
    connection.on(LiveTranscriptionEvents.SpeechStarted, () => {
      speechStartedAtRef.current = cbs.current.now();
      pushTrace({ kind: "speech-started" }, speechStartedAtRef.current);
    });
    connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
      pushTrace({ kind: "utterance-end" }, cbs.current.now());
    });

    connection.on(LiveTranscriptionEvents.Error, (err: unknown) => {
      if (isDev) console.warn("[deepgram]", err);
      cbs.current.onNote?.(`deepgram error: ${String(err)}`);
      // A socket error is the one signal that the cached credential might be
      // the problem (revoked, or expiring sooner than advertised). Drop it so
      // the reconnect mints a fresh one rather than retrying a bad token
      // twelve times.
      tokenRef.current = null;
      // Don't declare failure here — Close follows, and that path reconnects.
    });

    connection.on(LiveTranscriptionEvents.Close, (event: unknown) => {
      if (isDev && captureRef.current?.kind === "replay-pcm16") {
        console.warn("[deepgram] replay socket closed", event);
      }
      // A stopped run may deliver its Close event after the next replay has
      // already installed a fresh connection. That obsolete event must not
      // tear down/cancel the new run or schedule a reconnect for the old one.
      if (connectionRef.current !== connection) return;
      if (!startedRef.current) return;
      const latestChunk = replayChunksRef.current.at(-1);
      noteReplayConnection("close", String((event as { code?: number; reason?: string })?.code ?? "unknown"), latestChunk?.audioEndMs ?? null, latestChunk?.chunkSequence ?? null);
      teardownSocket();
      reconnectRef.current();
    });
  }, [collectReplayDiagnostics, findReplayChunkAt, noteAudioChunk, noteReplayConnection, socketBufferedAmount, teardownSocket]);

  reconnectRef.current = () => {
    if (!startedRef.current || reconnectingRef.current) return;
    reconnectingRef.current = true;

    const attempt = attemptsRef.current;
    if (attempt >= MAX_ATTEMPTS) {
      setStatus("error");
      cbs.current.onError?.(
        "Lost connection to Deepgram and could not reconnect. Press Mic to retry.",
      );
      startedRef.current = false;
      reconnectingRef.current = false;
      return;
    }

    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    const latestChunk = replayChunksRef.current.at(-1);
    noteReplayConnection("reconnect_scheduled", `attempt ${attempt + 1} in ${delay}ms`, latestChunk?.audioEndMs ?? null, latestChunk?.chunkSequence ?? null);
    attemptsRef.current = attempt + 1;
    setStatus("reconnecting");
    cbs.current.onError?.(
      `Reconnecting to Deepgram… (attempt ${attempt + 1})`,
    );
    cbs.current.onNote?.(`deepgram reconnect attempt ${attempt + 1} in ${delay}ms`);

    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      void (async () => {
        try {
          await openSocket();
        } catch (err) {
          if ((err as Error)?.name === "AbortError") return;
          if (isDev) console.warn("[deepgram] reconnect failed", err);
          cbs.current.onNote?.(`deepgram reconnect failed: ${String(err)}`);
          reconnectingRef.current = false;
          reconnectRef.current();
          return;
        }
        reconnectingRef.current = false;
      })();
    }, delay);
  };

  const start = useCallback(async () => {
    if (!enabled) return false;
    if (startedRef.current) return true;
    startedRef.current = true;
    attemptsRef.current = 0;
    setStatus("connecting");
    cbs.current.onError?.(null);

    try {
      // The stream is acquired once and reused across reconnects, so a dropped
      // socket never re-prompts for the microphone. When the caller has
      // already prewarmed, this resolves immediately and the socket opens on
      // the next tick.
      await prewarm();
      exactMicAudio.beginSession(cbs.current.sessionId?.() ?? `speech-${Date.now()}`);
      if (exactMicAudio.retaining) cbs.current.onNote?.("exact microphone PCM corpus retention enabled");
      await openSocket();
      return true;
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        exactMicAudio.finishSession();
        return false;
      }
      // console.warn, not console.error: Next's dev overlay intercepts errors
      // and throws a full-screen panel over the canvas. A mic that won't start
      // should be a red dot on the control bar, not a takeover mid-recording.
      // Dev-only now too — a real user's console shouldn't see raw internals.
      if (isDev) console.warn("[deepgram] start failed", err);
      exactMicAudio.finishSession();
      startedRef.current = false;
      // The prewarmed graph is being torn down here, so the memo of it has to
      // go too — otherwise the next attempt would await a resolved promise and
      // then find no microphone.
      prewarmRef.current = null;
      const capture = captureRef.current;
      captureRef.current = null;
      if (capture?.kind === "audio-worklet-pcm16") {
        capture.source.disconnect();
        capture.node.disconnect();
        capture.sink.disconnect();
        await capture.context.close().catch(() => {});
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStatus("error");
      cbs.current.onError?.(
        (err as Error)?.name === "NotAllowedError"
          ? "Microphone permission denied. Allow access and press Mic again."
          : `Could not start listening: ${String((err as Error)?.message ?? err)}`,
      );
      return false;
    }
  }, [enabled, openSocket, prepareCapture]);

  /** Dev-only source swap: decode/resample a file, then use the same socket. */
  const startReplay = useCallback(async (
    input: File | ReplayPreparedSource,
    disconnectPlan: ReplayDisconnectPlan = { atAudioMs: [] },
    options: ReplayStartOptions = {},
  ): Promise<ReplayAudioInfo> => {
    if (!isDev || !enabled) throw new Error("Replay mode is unavailable");
    if (startedRef.current) throw new Error("A speech source is already active");
    setStatus("connecting");
    cbs.current.onError?.(null);
    replayStartedAtRef.current = performance.now();
    replayAudioStartedAtRef.current = 0;
    replayDisconnectPlanRef.current = { atAudioMs: [...disconnectPlan.atAudioMs].sort((a, b) => a - b) };
    replayForcedDisconnectsRef.current = new Set();
    replayChunksRef.current = [];
    replayProviderResponsesRef.current = [];
    replayConnectionsRef.current = [];
    socketAudioBaseMsRef.current = new Map();
    replayLatestProviderAudioMsRef.current = null;
    replaySendAttemptsRef.current = 0;
    replayPausedSendsRef.current = 0;
    replayRebasesRef.current = [];
    replayStartOptionsRef.current = options;
    const context = new AudioContext({ sampleRate: 48000 });
    try {
      let prepared: ReplayPreparedSource;
      if (input instanceof File) {
        const decoded = await context.decodeAudioData(await input.arrayBuffer());
        const targetRate = 48000;
        const frameCount = Math.ceil(decoded.duration * targetRate);
        const offline = new OfflineAudioContext(1, frameCount, targetRate);
        const source = offline.createBufferSource();
        source.buffer = decoded;
        source.connect(offline.destination);
        source.start();
        const rendered = await offline.startRendering();
        prepared = {
          name: input.name,
          sourceSampleRate: decoded.sampleRate,
          sampleRate: targetRate,
          durationMs: decoded.duration * 1000,
          samples: new Float32Array(rendered.getChannelData(0)),
        };
      } else {
        prepared = input;
      }
      captureRef.current = {
        kind: "replay-pcm16",
        samples: prepared.samples,
        sourceSampleRate: prepared.sourceSampleRate,
        sampleRate: prepared.sampleRate,
        fileName: prepared.name,
        durationMs: prepared.durationMs,
      };
      latency.mark("worklet_ready", latencyNow());
      await loadSdk();
      startedRef.current = true;
      attemptsRef.current = 0;
      const completion = new Promise<ReplayAudioInfo>((resolve, reject) => {
        replayCompletionRef.current = { resolve, reject };
      });
      await openSocket();
      return await completion;
    } catch (error) {
      startedRef.current = false;
      captureRef.current = null;
      replayStartOptionsRef.current = {};
      setStatus("error");
      throw error;
    } finally {
      await context.close().catch(() => {});
    }
  }, [enabled, loadSdk, openSocket]);

  const toggle = useCallback(() => {
    if (startedRef.current) stop();
    else void start();
  }, [start, stop]);

  useEffect(() => stop, [stop]);

  /**
   * Diagnostic traces for the two most informative utterances of the session:
   * the first one (a representative example) and whichever had the largest
   * chunk-to-message gap (a worst case worth looking at directly). Read once,
   * at session stop — see the comment on lastChunkSentAtRef above for why
   * these exist.
   */
  const getDiagnosticTraces = useCallback(() => {
    closeTrace(); // in case a session stops mid-utterance
    return {
      first: firstTraceRef.current,
      worst: worstTraceRef.current?.events ?? null,
    };
  }, [closeTrace]);

  return { status, start, startReplay, stop, toggle, prewarm, getDiagnosticTraces };
}
