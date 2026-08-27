/**
 * Provider-agnostic core of the local Moonshine speech bridge: normalizes the
 * bridge's wire events and manages the WebSocket connection lifecycle
 * (connect, reconnect with backoff, status).
 *
 * Split out of hooks/useMoonshine.ts so it can be unit tested with a fake
 * socket, deterministically, with no React renderer and no real network —
 * see scripts/moonshine-bridge-test.mjs.
 *
 * The bridge (local/moonshine-bridge/server.py) owns the microphone itself —
 * unlike Deepgram, audio never crosses into the browser. The client here only
 * exchanges small JSON control/event messages: {"type":"start"} to begin a
 * take, {"type":"stop"} to end it, and three event types back —
 * "line_started" and "line_changed" (Moonshine's still-settling line, mapped
 * to "interim") and "line_completed" (mapped to "final") — matching Deepgram's
 * interim/final split so lib/liveSpeech.ts needs no changes at all.
 */

export type MicStatus = "idle" | "connecting" | "live" | "reconnecting" | "error";

export interface MoonshineRawEvent {
  type?: unknown;
  lineId?: unknown;
  text?: unknown;
  atMs?: unknown;
}

export type NormalizedMoonshineEvent =
  | { kind: "interim"; lineId: string; text: string; atMs: number }
  | { kind: "final"; lineId: string; text: string; atMs: number };

/** Pure mapping, no I/O — the one place the bridge's wire shape is known. */
export function normalizeMoonshineEvent(raw: unknown): NormalizedMoonshineEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as MoonshineRawEvent;
  const lineId = typeof r.lineId === "string" ? r.lineId : "";
  if (!lineId) return null;
  const text = typeof r.text === "string" ? r.text : "";
  const atMs = Number.isFinite(r.atMs) ? Number(r.atMs) : 0;
  if (r.type === "line_started" || r.type === "line_changed") return { kind: "interim", lineId, text, atMs };
  if (r.type === "line_completed") return { kind: "final", lineId, text, atMs };
  return null;
}

/** The subset of the browser WebSocket API this client depends on — swappable in tests. */
export interface WebSocketLike {
  onopen: ((this: WebSocketLike, ev: unknown) => void) | null;
  onmessage: ((this: WebSocketLike, ev: { data: string }) => void) | null;
  onclose: ((this: WebSocketLike, ev: unknown) => void) | null;
  onerror: ((this: WebSocketLike, ev: unknown) => void) | null;
  readyState: number;
  send(data: string): void;
  close(): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface MoonshineBridgeCallbacks {
  onFinal: (text: string, tStart: number, tEnd: number, audioEndMs: number, streamEpoch: number) => void;
  onInterim: (text: string, audioEndMs: number, streamEpoch: number) => void;
  onSessionStart: () => void;
  onStatus: (status: MicStatus) => void;
  onError?: (message: string | null) => void;
  onNote?: (text: string) => void;
}

/** Same shape as useDeepgram.ts's backoff: capped so a long outage still retries every few seconds. */
const BACKOFF_MS = [400, 900, 2000, 4000, 8000];
const MAX_ATTEMPTS = 8;

export class MoonshineBridgeClient {
  private readonly url: string;
  private readonly createSocket: WebSocketFactory;
  private readonly callbacks: MoonshineBridgeCallbacks;
  private socket: WebSocketLike | null = null;
  private streamEpoch = 0;
  private lineStartAtMs = new Map<string, number>();
  private attempts = 0;
  private started = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(url: string, createSocket: WebSocketFactory, callbacks: MoonshineBridgeCallbacks) {
    this.url = url;
    this.createSocket = createSocket;
    this.callbacks = callbacks;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.attempts = 0;
    this.connect();
  }

  stop(): void {
    this.started = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    try {
      socket?.send(JSON.stringify({ type: "stop" }));
    } catch {
      /* already closed */
    }
    socket?.close();
    this.callbacks.onStatus("idle");
  }

  private connect(): void {
    this.callbacks.onStatus(this.attempts > 0 ? "reconnecting" : "connecting");
    const socket = this.createSocket(this.url);
    this.socket = socket;

    socket.onopen = () => {
      this.attempts = 0;
      this.streamEpoch += 1;
      this.lineStartAtMs.clear();
      this.callbacks.onSessionStart();
      this.callbacks.onStatus("live");
      this.callbacks.onError?.(null);
      try {
        socket.send(JSON.stringify({ type: "start" }));
      } catch {
        /* closed between construction and this handler */
      }
    };

    socket.onmessage = (ev) => {
      let raw: unknown;
      try {
        raw = JSON.parse(ev.data);
      } catch {
        return;
      }
      const normalized = normalizeMoonshineEvent(raw);
      if (!normalized) return;
      if (normalized.kind === "interim") {
        if (!this.lineStartAtMs.has(normalized.lineId)) this.lineStartAtMs.set(normalized.lineId, normalized.atMs);
        this.callbacks.onInterim(normalized.text, normalized.atMs, this.streamEpoch);
        return;
      }
      const tStart = this.lineStartAtMs.get(normalized.lineId) ?? normalized.atMs;
      this.lineStartAtMs.delete(normalized.lineId);
      this.callbacks.onFinal(normalized.text, tStart, normalized.atMs, normalized.atMs, this.streamEpoch);
      this.callbacks.onInterim("", normalized.atMs, this.streamEpoch);
    };

    socket.onerror = () => {
      this.callbacks.onError?.("moonshine bridge connection error");
    };

    socket.onclose = () => {
      this.socket = null;
      if (!this.started) return;
      if (this.attempts >= MAX_ATTEMPTS) {
        this.callbacks.onStatus("error");
        this.callbacks.onError?.("Lost connection to the local Moonshine bridge. Press Mic to retry.");
        this.started = false;
        return;
      }
      const delay = BACKOFF_MS[Math.min(this.attempts, BACKOFF_MS.length - 1)];
      this.attempts += 1;
      this.callbacks.onNote?.(`moonshine bridge reconnect attempt ${this.attempts} in ${delay}ms`);
      this.callbacks.onStatus("reconnecting");
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, delay);
    };
  }
}
