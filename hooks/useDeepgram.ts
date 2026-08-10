"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { noteFinalTranscript, providerRequestHeaders } from "@/lib/usage-client";

export type MicStatus = "idle" | "connecting" | "live" | "reconnecting" | "error";

interface Options {
  /** Fired once per finalized utterance. Times are ms since the mic was first opened. */
  onFinal: (
    text: string,
    tStart: number,
    tEnd: number,
    audioEndMs: number,
    streamEpoch: number,
  ) => void;
  /**
   * Fired on every partial. Overwrites the previous partial.
   *
   * `audioEndMs` is where this partial ends on Deepgram's audio timeline,
   * which starts with the socket — the same instant the session clock does.
   * Comparing it against the clock is how mic-to-ink latency gets measured
   * without a stopwatch.
   */
  onInterim: (text: string, audioEndMs: number, streamEpoch: number, confidence?: number) => void;
  /** Called the first time the mic opens, to anchor the session clock. */
  onSessionStart: () => void;
  /** Reads the current session clock in ms. */
  now: () => number;
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
}

/** Backoff schedule. Capped so a long outage still retries every few seconds. */
const BACKOFF_MS = [400, 900, 2000, 4000, 8000];
const MAX_ATTEMPTS = 12;

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
  onNote,
  onError,
  enabled = true,
  keyterms,
  onKeyterms,
}: Options) {
  const [status, setStatus] = useState<MicStatus>("idle");

  const connectionRef = useRef<any>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedRef = useRef(false);
  const reconnectingRef = useRef(false);
  const attemptsRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Aborts an in-flight token fetch when the user stops mid-connect. */
  const abortRef = useRef<AbortController | null>(null);

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

  const cbs = useRef({
    onFinal,
    onInterim,
    onSessionStart,
    now,
    onNote,
    onError,
    keyterms,
    onKeyterms,
  });
  cbs.current = {
    onFinal,
    onInterim,
    onSessionStart,
    now,
    onNote,
    onError,
    keyterms,
    onKeyterms,
  };

  /** Tear down the socket and recorder but KEEP the microphone stream. */
  const teardownSocket = useCallback(() => {
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

  const stop = useCallback(() => {
    startedRef.current = false;
    reconnectingRef.current = false;
    attemptsRef.current = 0;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;

    teardownSocket();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    setStatus("idle");
    cbs.current.onError?.(null);
  }, [teardownSocket]);

  // openSocket and scheduleReconnect are mutually recursive; a ref breaks the
  // cycle without making either callback unstable.
  const reconnectRef = useRef<() => void>(() => {});

  const openSocket = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const res = await fetch("/api/deepgram/token", { signal: ac.signal, headers: providerRequestHeaders() });
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
    const { accessToken, key } = (await res.json()) as {
      accessToken?: string;
      key?: string;
    };
    if (!accessToken && !key) throw new Error("no credential returned");

    const { createClient, LiveTranscriptionEvents } = await import(
      "@deepgram/sdk"
    );

    const stream = streamRef.current;
    if (!stream) throw new Error("microphone stream is gone");

    // /auth/grant returns a bearer token; createProjectKey returns an API key.
    const deepgram = accessToken
      ? createClient({ accessToken })
      : createClient(key as string);

    // Bias recognition toward what the speaker actually says. nova-3 takes
    // `keyterm`, repeated once per term; the SDK accepts an array. This is the
    // only fix that works before the mistake is made — everything downstream
    // is repair.
    const terms = (cbs.current.keyterms?.() ?? []).slice(0, 40);

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
      ...(terms.length ? { keyterm: terms } : {}),
    });
    connectionRef.current = connection;

    connection.on(LiveTranscriptionEvents.Open, () => {
      cbs.current.onSessionStart();
      // Anchor this socket's audio timeline to the session clock.
      audioEpochRef.current = cbs.current.now();
      streamEpochRef.current += 1;
      if (terms.length) cbs.current.onKeyterms?.(terms);
      attemptsRef.current = 0;
      reconnectingRef.current = false;
      setStatus("live");
      cbs.current.onError?.(null);

      // Audio leaves in 100ms chunks. This is a hard floor under how soon an
      // interim can come back, and the interims are now what the page is
      // written from — so it is a hard floor under the whole product.
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          try {
            connection.send(event.data);
          } catch {
            /* socket closed mid-chunk */
          }
        }
      };
      recorder.start(100);

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
      const alt = data?.channel?.alternatives?.[0];
      const text: string = alt?.transcript ?? "";
      if (!text.trim()) return;

      const audioEndMs =
        audioEpochRef.current +
        ((data.start ?? 0) + (data.duration ?? 0)) * 1000;

      if (data.is_final) {
        noteFinalTranscript();
        const tEnd = cbs.current.now();
        const durationMs = (data.duration ?? 0) * 1000;
        cbs.current.onFinal(
          text,
          Math.max(0, tEnd - durationMs),
          tEnd,
          audioEndMs,
          streamEpochRef.current,
        );
        cbs.current.onInterim("", audioEndMs, streamEpochRef.current, Number(alt?.confidence ?? 0));
      } else {
        cbs.current.onInterim(text, audioEndMs, streamEpochRef.current, Number(alt?.confidence ?? 0));
      }
    });

    connection.on(LiveTranscriptionEvents.Error, (err: unknown) => {
      console.warn("[deepgram]", err);
      cbs.current.onNote?.(`deepgram error: ${String(err)}`);
      // Don't declare failure here — Close follows, and that path reconnects.
    });

    connection.on(LiveTranscriptionEvents.Close, () => {
      if (!startedRef.current) return;
      teardownSocket();
      reconnectRef.current();
    });
  }, [teardownSocket]);

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
          console.warn("[deepgram] reconnect failed", err);
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
    if (!enabled || startedRef.current) return;
    startedRef.current = true;
    attemptsRef.current = 0;
    setStatus("connecting");
    cbs.current.onError?.(null);

    try {
      // The stream is acquired once and reused across reconnects, so a dropped
      // socket never re-prompts for the microphone.
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      await openSocket();
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      // console.warn, not console.error: Next's dev overlay intercepts errors
      // and throws a full-screen panel over the canvas. A mic that won't start
      // should be a red dot on the control bar, not a takeover mid-recording.
      console.warn("[deepgram] start failed", err);
      startedRef.current = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStatus("error");
      cbs.current.onError?.(
        (err as Error)?.name === "NotAllowedError"
          ? "Microphone permission denied. Allow access and press Mic again."
          : `Could not start listening: ${String((err as Error)?.message ?? err)}`,
      );
    }
  }, [enabled, openSocket]);

  const toggle = useCallback(() => {
    if (startedRef.current) stop();
    else void start();
  }, [start, stop]);

  useEffect(() => stop, [stop]);

  return { status, start, stop, toggle };
}
