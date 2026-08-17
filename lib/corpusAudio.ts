/**
 * Development-only retention of the exact PCM16 buffers produced by the live
 * AudioWorklet. This is an observer: callers send to Deepgram first, then hand
 * the same ArrayBuffer here for an in-memory copy.
 */

const isDev = process.env.NODE_ENV === "development";
const MAX_SAMPLES = 48_000 * 60 * 20;

export interface ExactMicTransportEpoch {
  streamEpoch: number | null;
  firstChunk: number;
  lastChunk: number;
  chunkCount: number;
  sampleCount: number;
  sentChunkCount: number;
}

export interface ExactMicAudioMetadata {
  version: 1;
  sessionId: string;
  captureId: string;
  capture: "audio-worklet-pcm16";
  encoding: "linear16";
  sampleRate: number;
  channels: 1;
  bitsPerSample: 16;
  sampleCount: number;
  chunkCount: number;
  sentChunkCount: number;
  unsentChunkCount: number;
  durationMs: number;
  startedAt: string;
  endedAt: string | null;
  truncated: boolean;
  formatMismatch: boolean;
  transportEpochs: ExactMicTransportEpoch[];
  copyTimingMs: { p50: number; p95: number; max: number };
  websocketBufferedAmount: { p50: number | null; p95: number | null; max: number | null };
}

export interface ExactMicAudioSnapshot {
  wav: Blob;
  metadata: ExactMicAudioMetadata;
}

interface RetainedChunk {
  samples: Int16Array;
  sent: boolean;
  streamEpoch: number | null;
  bufferedAmount: number | null;
}

function percentile(values: number[], quantile: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))];
}

export function encodePcm16Wav(pcm: Int16Array, sampleRate: number, channels = 1): ArrayBuffer {
  const bytes = pcm.byteLength;
  const out = new ArrayBuffer(44 + bytes);
  const view = new DataView(out);
  const ascii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, bytes, true);
  new Int16Array(out, 44).set(pcm);
  return out;
}

export class ExactMicAudioRetention {
  private readonly enabledOverride?: () => boolean;
  private active = false;
  private sessionId = "";
  private captureId = "";
  private startedAt = "";
  private endedAt: string | null = null;
  private rate = 0;
  private sampleCount = 0;
  private chunks: RetainedChunk[] = [];
  private copyTimings: number[] = [];
  private truncated = false;
  private formatMismatch = false;

  constructor(enabledOverride?: () => boolean) {
    this.enabledOverride = enabledOverride;
  }

  get enabled(): boolean {
    if (this.enabledOverride) return this.enabledOverride();
    if (!isDev || typeof window === "undefined") return false;
    try {
      return new URLSearchParams(window.location.search).get("corpus") === "1" ||
        window.localStorage.getItem("inpublic:corpus-audio") === "1";
    } catch {
      return false;
    }
  }

  get retaining(): boolean {
    return this.active;
  }

  beginSession(sessionId: string): void {
    this.reset();
    if (!this.enabled) return;
    this.active = true;
    this.sessionId = sessionId;
    this.captureId = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `capture-${Date.now()}`;
    this.startedAt = new Date().toISOString();
  }

  /** Copy only after the caller's normal websocket send attempt has finished. */
  recordChunk(
    buffer: ArrayBuffer,
    sampleRate: number,
    options: { sent: boolean; streamEpoch: number | null; bufferedAmount?: number | null },
  ): void {
    if (!this.active || this.truncated || buffer.byteLength % 2 !== 0) return;
    const count = buffer.byteLength / 2;
    if (this.sampleCount + count > MAX_SAMPLES) {
      this.truncated = true;
      return;
    }
    const started = performance.now();
    if (!this.rate) this.rate = sampleRate;
    else if (this.rate !== sampleRate) this.formatMismatch = true;
    const copy = new Int16Array(count);
    copy.set(new Int16Array(buffer));
    this.chunks.push({
      samples: copy,
      sent: options.sent,
      streamEpoch: options.streamEpoch,
      bufferedAmount: options.bufferedAmount ?? null,
    });
    this.sampleCount += copy.length;
    this.copyTimings.push(performance.now() - started);
  }

  finishSession(): void {
    if (!this.active) return;
    this.active = false;
    this.endedAt = new Date().toISOString();
  }

  reset(): void {
    this.active = false;
    this.sessionId = "";
    this.captureId = "";
    this.startedAt = "";
    this.endedAt = null;
    this.rate = 0;
    this.sampleCount = 0;
    this.chunks = [];
    this.copyTimings = [];
    this.truncated = false;
    this.formatMismatch = false;
  }

  metadata(): ExactMicAudioMetadata | null {
    if (!this.captureId || !this.rate) return null;
    const epochs: ExactMicTransportEpoch[] = [];
    this.chunks.forEach((chunk, index) => {
      const previous = epochs.at(-1);
      if (!previous || previous.streamEpoch !== chunk.streamEpoch) {
        epochs.push({
          streamEpoch: chunk.streamEpoch,
          firstChunk: index,
          lastChunk: index,
          chunkCount: 1,
          sampleCount: chunk.samples.length,
          sentChunkCount: chunk.sent ? 1 : 0,
        });
      } else {
        previous.lastChunk = index;
        previous.chunkCount += 1;
        previous.sampleCount += chunk.samples.length;
        if (chunk.sent) previous.sentChunkCount += 1;
      }
    });
    const buffers = this.chunks
      .map((chunk) => chunk.bufferedAmount)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    const sent = this.chunks.filter((chunk) => chunk.sent).length;
    return {
      version: 1,
      sessionId: this.sessionId,
      captureId: this.captureId,
      capture: "audio-worklet-pcm16",
      encoding: "linear16",
      sampleRate: this.rate,
      channels: 1,
      bitsPerSample: 16,
      sampleCount: this.sampleCount,
      chunkCount: this.chunks.length,
      sentChunkCount: sent,
      unsentChunkCount: this.chunks.length - sent,
      durationMs: Math.round((this.sampleCount / this.rate) * 1000),
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      truncated: this.truncated,
      formatMismatch: this.formatMismatch,
      transportEpochs: epochs,
      copyTimingMs: {
        p50: percentile(this.copyTimings, 0.5),
        p95: percentile(this.copyTimings, 0.95),
        max: this.copyTimings.length ? Math.max(...this.copyTimings) : 0,
      },
      websocketBufferedAmount: {
        p50: buffers.length ? percentile(buffers, 0.5) : null,
        p95: buffers.length ? percentile(buffers, 0.95) : null,
        max: buffers.length ? Math.max(...buffers) : null,
      },
    };
  }

  snapshot(): ExactMicAudioSnapshot | null {
    const metadata = this.metadata();
    if (!metadata) return null;
    const pcm = new Int16Array(this.sampleCount);
    let offset = 0;
    for (const chunk of this.chunks) {
      pcm.set(chunk.samples, offset);
      offset += chunk.samples.length;
    }
    return {
      wav: new Blob([encodePcm16Wav(pcm, metadata.sampleRate, metadata.channels)], { type: "audio/wav" }),
      metadata,
    };
  }
}

export const exactMicAudio = new ExactMicAudioRetention();
