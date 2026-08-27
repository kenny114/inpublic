"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MoonshineBridgeClient, type MicStatus, type WebSocketLike } from "@/lib/moonshineBridge";

const isDev = process.env.NODE_ENV === "development";

const BRIDGE_URL = process.env.NEXT_PUBLIC_MOONSHINE_BRIDGE_URL || "ws://127.0.0.1:8765";

export type { MicStatus };

interface Options {
  /** Fired once per finalized line. Times are ms since the bridge socket opened. */
  onFinal: (text: string, tStart: number, tEnd: number, audioEndMs: number, streamEpoch: number) => void;
  /** Fired on every partial. Overwrites the previous partial. */
  onInterim: (text: string, audioEndMs: number, streamEpoch: number) => void;
  /** Called the first time the bridge connects, to anchor the session clock. */
  onSessionStart: () => void;
  /** Anything worth showing the user or writing to the log. */
  onNote?: (text: string) => void;
  /** Surfaced in the UI. Null clears the banner. */
  onError?: (message: string | null) => void;
  /** False when another engine owns the microphone. */
  enabled?: boolean;
}

/**
 * Local speech engine: connects to local/moonshine-bridge/server.py, a
 * native process that owns the microphone itself (unlike Deepgram, no audio
 * ever crosses into the browser — only small JSON line events come back over
 * the socket). See lib/moonshineBridge.ts for the connection/backoff logic
 * and wire-event normalization this hook wraps.
 */
export function useMoonshine({ onFinal, onInterim, onSessionStart, onNote, onError, enabled = true }: Options) {
  const [status, setStatus] = useState<MicStatus>("idle");
  const clientRef = useRef<MoonshineBridgeClient | null>(null);

  const cbs = useRef({ onFinal, onInterim, onSessionStart, onNote, onError });
  cbs.current = { onFinal, onInterim, onSessionStart, onNote, onError };

  if (!clientRef.current) {
    clientRef.current = new MoonshineBridgeClient(
      BRIDGE_URL,
      (url) => new WebSocket(url) as unknown as WebSocketLike,
      {
        onFinal: (...args) => cbs.current.onFinal(...args),
        onInterim: (...args) => cbs.current.onInterim(...args),
        onSessionStart: () => cbs.current.onSessionStart(),
        onStatus: setStatus,
        onError: (message) => cbs.current.onError?.(message),
        onNote: (text) => {
          if (isDev) console.warn("[moonshine]", text);
          cbs.current.onNote?.(text);
        },
      },
    );
  }

  const start = useCallback(async () => {
    if (!enabled) return false;
    clientRef.current?.start();
    return true;
  }, [enabled]);

  const stop = useCallback(() => {
    clientRef.current?.stop();
  }, []);

  const toggle = useCallback(() => {
    if (status === "idle" || status === "error") void start();
    else stop();
  }, [status, start, stop]);

  useEffect(() => stop, [stop]);

  return { status, start, stop, toggle };
}
