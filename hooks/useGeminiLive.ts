"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { noteFinalTranscript, providerRequestHeaders } from "@/lib/usage-client";
import type { Op } from "@/lib/ops";

const isDev = process.env.NODE_ENV === "development";

export type LiveStatus = "idle" | "connecting" | "live" | "error";

interface Options {
  /** Marks the model asked for, already normalised into our op shape. */
  onOps: (ops: Op[]) => void | Promise<void>;
  /** What it heard. Feeds the strip, the log and the wrap-up tier. */
  onTranscript: (text: string, isFinal: boolean) => void;
  onSessionStart: () => void;
  /** Reconnects and other things worth seeing in the session log. */
  onNote?: (text: string) => void;
  enabled?: boolean;
}

/**
 * The Live API wants raw 16-bit PCM at 16kHz. MediaRecorder can't produce that
 * — it gives webm/opus — so we tap the audio graph with a worklet and convert
 * frames ourselves. Delivered as a Blob URL so there's no public/ asset to
 * keep in sync with this file.
 */
const WORKLET_SRC = `
class PCMTap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(new Float32Array(ch));
    return true;
  }
}
registerProcessor('pcm-tap', PCMTap);
`;

const SAMPLE_RATE = 16000;
/** Worklet frames are 128 samples (~8ms); batch them into ~100ms sends. */
const SEND_EVERY_SAMPLES = SAMPLE_RATE / 10;
/**
 * How much silence ends a turn. This is the knob that decides whether the
 * board feels live: the model only acts at end-of-turn, so a long threshold
 * reproduces exactly the "pause and it writes" problem we're trying to escape.
 */
const SILENCE_MS = 400;

function floatToPcm16Base64(samples: Float32Array): string {
  const buf = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  let binary = "";
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** The model's mark shape -> our op shape. Unknown ops are dropped. */
function toOps(args: unknown): Op[] {
  const marks = (args as { marks?: unknown })?.marks;
  if (!Array.isArray(marks)) return [];
  const out: Op[] = [];
  for (const m of marks) {
    const op = String((m as { op?: unknown })?.op ?? "").toLowerCase();
    const text = String((m as { text?: unknown })?.text ?? "").trim();
    const icon = String((m as { icon?: unknown })?.icon ?? "").trim();

    if (op === "icon") {
      if (icon || text) out.push({ op: "icon", name: icon || text });
      continue;
    }
    if (!text) continue;
    if (
      op === "title" || op === "heading" || op === "word" ||
      op === "note" || op === "bullet" || op === "box" || op === "underline"
    ) {
      out.push({ op, text } as Op);
      // The model often names an icon alongside a mark; honour both.
      if (icon) out.push({ op: "icon", name: icon });
    }
  }
  return out;
}

export function useGeminiLive({
  onOps,
  onTranscript,
  onSessionStart,
  onNote,
  enabled = true,
}: Options) {
  const [status, setStatus] = useState<LiveStatus>("idle");

  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const startedRef = useRef(false);
  const reconnectingRef = useRef(false);
  /** Lets a dropped socket resume with its context instead of starting over. */
  const resumeHandleRef = useRef<string | null>(null);

  const cbs = useRef({ onOps, onTranscript, onSessionStart, onNote });
  cbs.current = { onOps, onTranscript, onSessionStart, onNote };

  const teardownAudio = useCallback(() => {
    try {
      nodeRef.current?.disconnect();
    } catch {
      /* already gone */
    }
    nodeRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const stop = useCallback(() => {
    startedRef.current = false;
    teardownAudio();
    try {
      sessionRef.current?.close();
    } catch {
      /* already closed */
    }
    sessionRef.current = null;
    setStatus("idle");
  }, [teardownAudio]);

  // connect and reconnect are mutually recursive; a ref breaks the cycle
  // without making either callback unstable.
  const reconnectRef = useRef<() => void>(() => {});

  const connect = useCallback(async (resume?: string) => {
    const res = await fetch("/api/gemini/token", { headers: providerRequestHeaders() });
    if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`);
    const { token, model } = (await res.json()) as {
      token: string;
      model: string;
    };

    const [
      { GoogleGenAI, Modality, Type, Behavior, FunctionResponseScheduling },
      { LIVE_SCRIBE_SYSTEM },
    ] = await Promise.all([import("@google/genai"), import("@/lib/prompts")]);

    const drawTool = {
      functionDeclarations: [
        {
          name: "draw",
          description:
            "Add marks to the sketchnote page the audience is watching.",
          // Non-blocking: the model must keep listening while we render.
          behavior: Behavior.NON_BLOCKING,
          parameters: {
            type: Type.OBJECT,
            properties: {
              marks: {
                type: Type.ARRAY,
                description: "One to five marks, in drawing order.",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    op: {
                      type: Type.STRING,
                      enum: [
                        "title", "heading", "word", "note",
                        "bullet", "box", "icon", "underline",
                      ],
                    },
                    text: {
                      type: Type.STRING,
                      description: "Two to four words, in their words.",
                    },
                    icon: {
                      type: Type.STRING,
                      description: "Optional pictogram name.",
                    },
                  },
                  required: ["op"],
                },
              },
            },
            required: ["marks"],
          },
        },
      ],
    };

    // Ephemeral tokens are served on v1alpha only; the default version closes
    // the socket with a bare "Internal error encountered".
    const ai = new GoogleGenAI({
      apiKey: token,
      httpOptions: { apiVersion: "v1alpha" },
    });

    const session = await ai.live.connect({
      model,
      config: {
        // TEXT is not supported by any general Live model — the drawing comes
        // back as tool calls instead. We never play the audio.
        responseModalities: [Modality.AUDIO],
        systemInstruction: LIVE_SCRIBE_SYSTEM,
        temperature: 0.4,
        tools: [drawTool],
        // We still need the words, for the strip, the log and the wrap-up.
        inputAudioTranscription: {},
        realtimeInputConfig: {
          automaticActivityDetection: { silenceDurationMs: SILENCE_MS },
        },
        // A 30-minute take outlives the default session; these two are what
        // let it survive.
        sessionResumption: resume ? { handle: resume } : {},
        contextWindowCompression: { slidingWindow: {} },
      },
      callbacks: {
        onopen: () => {
          cbs.current.onSessionStart();
          setStatus("live");
        },
        onmessage: (msg: any) => {
          const heard = msg?.serverContent?.inputTranscription?.text;
          if (heard) cbs.current.onTranscript(heard, false);
          if (msg?.serverContent?.turnComplete) {
            noteFinalTranscript();
            cbs.current.onTranscript("", true);
          }

          const calls = msg?.toolCall?.functionCalls;
          if (Array.isArray(calls) && calls.length) {
            for (const call of calls) {
              if (call?.name === "draw") void cbs.current.onOps(toOps(call.args));
            }
            // Acknowledge, or the model waits on us. SILENT so the
            // acknowledgement doesn't prompt it to generate speech.
            try {
              sessionRef.current?.sendToolResponse({
                functionResponses: calls.map((c: any) => ({
                  id: c.id,
                  name: c.name,
                  response: { output: "drawn" },
                  scheduling: FunctionResponseScheduling.SILENT,
                })),
              });
            } catch {
              /* socket mid-reconnect */
            }
          }

          const update = msg?.sessionResumptionUpdate;
          if (update?.resumable && update?.newHandle) {
            resumeHandleRef.current = update.newHandle;
          }

          // The server is about to hang up. Reconnect on the handle so the
          // page keeps its memory instead of starting over mid-sentence.
          if (msg?.goAway) reconnectRef.current();
        },
        onerror: (e: any) => {
          if (isDev) console.warn("[gemini-live]", e?.message ?? e);
          setStatus("error");
        },
        onclose: () => {
          if (startedRef.current) reconnectRef.current();
        },
      },
    });

    sessionRef.current = session;
  }, []);

  reconnectRef.current = () => {
    if (reconnectingRef.current || !startedRef.current) return;
    reconnectingRef.current = true;
    void (async () => {
      try {
        try {
          sessionRef.current?.close();
        } catch {
          /* already gone */
        }
        sessionRef.current = null;
        await connect(resumeHandleRef.current ?? undefined);
        cbs.current.onNote?.("gemini live reconnected");
      } catch (err) {
        if (isDev) console.warn("[gemini-live] reconnect failed", err);
        cbs.current.onNote?.(`gemini live reconnect failed: ${String(err)}`);
        setStatus("error");
      } finally {
        reconnectingRef.current = false;
      }
    })();
  };

  const start = useCallback(async () => {
    if (!enabled) return false;
    if (startedRef.current) return true;
    startedRef.current = true;
    setStatus("connecting");

    try {
      await connect();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      ctxRef.current = ctx;
      const url = URL.createObjectURL(
        new Blob([WORKLET_SRC], { type: "application/javascript" }),
      );
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);

      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "pcm-tap");
      nodeRef.current = node;

      let pending: number[] = [];
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        for (const s of event.data) pending.push(s);
        if (pending.length < SEND_EVERY_SAMPLES) return;
        const chunk = new Float32Array(pending);
        pending = [];
        try {
          sessionRef.current?.sendRealtimeInput({
            audio: {
              data: floatToPcm16Base64(chunk),
              mimeType: `audio/pcm;rate=${SAMPLE_RATE}`,
            },
          });
        } catch {
          /* socket mid-reconnect; the next chunk will land */
        }
      };

      source.connect(node);
      // Keep the graph pulling without routing your voice to the speakers.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      node.connect(sink).connect(ctx.destination);
      return true;
    } catch (err) {
      if (isDev) console.warn("[gemini-live] start failed", err);
      startedRef.current = false;
      teardownAudio();
      setStatus("error");
      return false;
    }
  }, [connect, enabled, teardownAudio]);

  const toggle = useCallback(() => {
    if (startedRef.current) stop();
    else void start();
  }, [start, stop]);

  useEffect(() => stop, [stop]);

  return { status, start, stop, toggle };
}
