import type { ReplayPreparedSource, ReplayRunReport, ReplayStartOptions } from "./replayLab";
import type { LogEvent } from "./types";

export const DEMO_MAX_DURATION_MS = 90_000;
export const DEMO_NORMALIZED_SAMPLE_RATE = 48_000;
export const DEMO_PCM_CHUNK_MS = 80;
export const DEMO_PCM_SAMPLES_PER_CHUNK = 3_840;
export const DEMO_CAPTURE_FPS = 30;

export type DemoStudioStatus =
  | "IDLE"
  | "DECODING"
  | "PREFLIGHTING"
  | "CONNECTING"
  | "READY"
  | "RECORDING"
  | "SETTLING"
  | "VALIDATING"
  | "COMPLETE"
  | "FAILED";

export interface PreparedDemoAudio {
  file: File;
  format: "WAV" | "MP3" | "OGG/OPUS";
  originalBuffer: AudioBuffer;
  replay: ReplayPreparedSource;
  originalChannels: number;
  sourceMime: string;
  pcmChunkCount: number;
}

export interface DemoBoardApi {
  run: (source: ReplayPreparedSource, options?: ReplayStartOptions) => Promise<ReplayRunReport>;
  stop: () => void;
}

export interface CaptureFrameSample {
  atMs: number;
  hash: Uint8Array;
}

export interface CaptureHeartbeat {
  frameCount: number;
  maxFrameGapMs: number;
  canvasCount: number;
  drawErrors: number;
  visibilityChanges: number;
  recorderState: string;
  rafTimestamps: number[];
}

export interface CaptureValidationMetrics {
  decoded: boolean;
  expectedResolution: boolean;
  measuredFps: number;
  audioTrackPresent: boolean;
  audioPeak: number;
  durationMs: number;
  expectedDurationMs: number;
  durationDeltaMs: number;
  sampledFrames: number;
  changingFramePairs: number;
  frozenSuffixMs: number;
  finalFrameDifference: number;
  eventResults: Array<{
    type: "text" | "visual" | "page" | "camera";
    atMs: number;
    maxDifference: number;
    changedFrames: number;
    passed: boolean;
  }>;
  failures: string[];
  warnings: string[];
}

export interface DemoArtifactBundle {
  demoId: string;
  source: File;
  video: Blob;
  videoExtension: "mp4" | "webm";
  session: Blob;
  transcript: Blob;
  metadata: Blob;
  thumbnail: Blob;
  report: ReplayRunReport;
  validation: CaptureValidationMetrics;
  videoUrl: string;
  thumbnailUrl: string;
}

export class DemoRunGate {
  private active = false;
  private generation = 0;

  begin() {
    if (this.active) throw new Error("A DEMO RUN IS ALREADY ACTIVE");
    this.active = true;
    this.generation += 1;
    return this.generation;
  }

  end(generation: number) {
    if (generation === this.generation) this.active = false;
  }

  isCurrent(generation: number) {
    return this.active && generation === this.generation;
  }
}

export function captureMayComplete(status: DemoStudioStatus, failures: readonly string[]) {
  return status === "VALIDATING" && failures.length === 0;
}

export function containerFailures(input: {
  decoded: boolean;
  widthMatches: boolean;
  fps: number;
  audioTrackPresent: boolean;
  audioPeak: number;
  durationDeltaMs: number;
}) {
  const failures: string[] = [];
  if (!input.decoded) failures.push("VIDEO FAILED DECODE");
  if (!input.widthMatches) failures.push("VIDEO RESOLUTION MISMATCH");
  if (input.fps < 20 || input.fps > 31) failures.push("CAPTURE FPS OUT OF RANGE");
  if (!input.audioTrackPresent) failures.push("AUDIO TRACK MISSING");
  else if (input.audioPeak < .0005) failures.push("AUDIO TRACK IS SILENT");
  if (input.durationDeltaMs > 1_250) failures.push("VIDEO DURATION MISMATCH");
  return failures;
}

declare global {
  interface Window {
    __inpublicDemoStudioBoard?: DemoBoardApi;
  }
}

function extensionOf(name: string) {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

export function supportedDemoFormat(name: string, mime = ""): PreparedDemoAudio["format"] | null {
  const ext = extensionOf(name);
  const normalizedMime = mime.toLowerCase();
  if (ext === "wav" || normalizedMime === "audio/wav" || normalizedMime === "audio/x-wav") return "WAV";
  if (ext === "mp3" || normalizedMime === "audio/mpeg" || normalizedMime === "audio/mp3") return "MP3";
  if (["ogg", "opus"].includes(ext) || normalizedMime.includes("ogg") || normalizedMime.includes("opus")) return "OGG/OPUS";
  return null;
}

export function validateDecodedAudio(durationMs: number, channels: number, samples: Float32Array) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error("AUDIO DURATION IS INVALID");
  if (durationMs > DEMO_MAX_DURATION_MS) throw new Error("AUDIO EXCEEDS 90 SECOND LIMIT");
  if (!Number.isInteger(channels) || channels < 1) throw new Error("AUDIO HAS NO CHANNEL");
  if (!samples.length || samples.some((sample) => !Number.isFinite(sample))) throw new Error("NORMALIZED PCM IS INVALID");
}

export function assertVisible(state: DocumentVisibilityState = document.visibilityState) {
  if (state !== "visible") throw new Error("TAB IS NOT VISIBLE");
}

export async function decodeDemoAudio(file: File): Promise<PreparedDemoAudio> {
  const format = supportedDemoFormat(file.name, file.type);
  if (!format) throw new Error("UNSUPPORTED AUDIO FORMAT");
  const context = new AudioContext({ sampleRate: DEMO_NORMALIZED_SAMPLE_RATE });
  try {
    let decoded: AudioBuffer;
    try {
      decoded = await context.decodeAudioData(await file.arrayBuffer());
    } catch {
      throw new Error("AUDIO DECODE FAILED");
    }
    const durationMs = decoded.duration * 1000;
    if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error("AUDIO DURATION IS INVALID");
    if (durationMs > DEMO_MAX_DURATION_MS) throw new Error("AUDIO EXCEEDS 90 SECOND LIMIT");
    if (decoded.numberOfChannels < 1) throw new Error("AUDIO HAS NO CHANNEL");
    const frameCount = Math.ceil(decoded.duration * DEMO_NORMALIZED_SAMPLE_RATE);
    const offline = new OfflineAudioContext(1, frameCount, DEMO_NORMALIZED_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const normalized = await offline.startRendering();
    const samples = new Float32Array(normalized.getChannelData(0));
    validateDecodedAudio(durationMs, decoded.numberOfChannels, samples);
    return {
      file,
      format,
      originalBuffer: decoded,
      replay: {
        name: file.name,
        sourceSampleRate: decoded.sampleRate,
        sampleRate: DEMO_NORMALIZED_SAMPLE_RATE,
        durationMs,
        samples,
      },
      originalChannels: decoded.numberOfChannels,
      sourceMime: file.type || `audio/${extensionOf(file.name)}`,
      pcmChunkCount: Math.ceil(samples.length / DEMO_PCM_SAMPLES_PER_CHUNK),
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}

export function preferredDemoRecorderMime() {
  // Chromium currently advertises MediaRecorder MP4 support before its
  // generated files can be seeked reliably for mandatory frame validation.
  // V1 therefore records honest WebM; MP4 may return only after an actual
  // record/decode/seek preflight (or a local transcode) is added.
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

export function sampleCanvasPixels(canvas: HTMLCanvasElement, size = 32): Uint8Array {
  const scratch = document.createElement("canvas");
  scratch.width = size;
  scratch.height = size;
  const context = scratch.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("VIDEO FRAME SAMPLING FAILED");
  context.drawImage(canvas, 0, 0, size, size);
  const data = context.getImageData(0, 0, size, size).data;
  const result = new Uint8Array(size * size);
  for (let index = 0; index < result.length; index += 1) {
    const offset = index * 4;
    result[index] = Math.round(data[offset] * .2126 + data[offset + 1] * .7152 + data[offset + 2] * .0722);
  }
  return result;
}

export function frameDifference(a: Uint8Array, b: Uint8Array) {
  if (!a.length || a.length !== b.length) return 1;
  let sum = 0;
  for (let index = 0; index < a.length; index += 1) sum += Math.abs(a[index] - b[index]);
  return sum / (a.length * 255);
}

export function frozenSuffixDuration(samples: CaptureFrameSample[], threshold = .0015) {
  if (samples.length < 2) return 0;
  const final = samples.at(-1)!;
  let start = final.atMs;
  for (let index = samples.length - 2; index >= 0; index -= 1) {
    if (frameDifference(samples[index].hash, final.hash) > threshold) break;
    start = samples[index].atMs;
  }
  return Math.max(0, final.atMs - start);
}

export function classifyPixelEvent(event: LogEvent): "text" | "visual" | "page" | "camera" | null {
  if (event.type === "page") return "page";
  if (event.type === "camera" && event.event === "started") return "camera";
  if (event.type === "settled-thought" || event.type === "live") return "text";
  if (event.type === "visual-reentry" && event.event === "durable-result-committed") return "visual";
  return null;
}

export function validateEventPixels(events: LogEvent[], samples: CaptureFrameSample[], eventOffsetMs: number) {
  const results: CaptureValidationMetrics["eventResults"] = [];
  let previousCamera = { scrollX: 0, scrollY: 0, zoom: 1 };
  for (const event of events) {
    const type = classifyPixelEvent(event);
    if (!type) continue;
    if (event.type === "camera") {
      const distance = Math.hypot(event.target.scrollX - previousCamera.scrollX, event.target.scrollY - previousCamera.scrollY);
      const zoomDelta = Math.abs(event.target.zoom - previousCamera.zoom);
      previousCamera = event.target;
      // Tiny live-follow retargets are telemetry, but not material camera
      // moves. Validate them through the heartbeat/final-state gates rather
      // than demanding broad-region motion from a sub-threshold adjustment.
      if (distance < 60 && zoomDelta < .04) continue;
    }
    const atMs = event.t + eventOffsetMs;
    const window = samples.filter((sample) => sample.atMs >= atMs - 300 && sample.atMs <= atMs + (type === "camera" ? 1_500 : 700));
    const differences = window.slice(1).map((sample, index) => frameDifference(window[index].hash, sample.hash));
    const threshold = type === "text" ? .00025 : type === "visual" ? .0005 : type === "camera" ? .00025 : .002;
    const changedFrames = differences.filter((difference) => difference >= threshold).length;
    const requiredFrames = type === "camera" ? 2 : 1;
    results.push({ type, atMs, maxDifference: differences.length ? Math.max(...differences) : 0, changedFrames, passed: changedFrames >= requiredFrames });
  }
  return results;
}

export function downloadDemoBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function jsonBlob(value: unknown) {
  return new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
}
