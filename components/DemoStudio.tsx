"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEMO_CAPTURE_FPS,
  DEMO_MAX_DURATION_MS,
  type DemoBoardApi,
  type CaptureFrameSample,
  type CaptureHeartbeat,
  type CaptureValidationMetrics,
  type DemoArtifactBundle,
  type DemoStudioStatus,
  type PreparedDemoAudio,
  assertVisible,
  decodeDemoAudio,
  downloadDemoBlob,
  frameDifference,
  frozenSuffixDuration,
  jsonBlob,
  preferredDemoRecorderMime,
  sampleCanvasPixels,
  validateEventPixels,
} from "@/lib/demoStudio";
import type { ReplayRunReport } from "@/lib/replayLab";

const Board = dynamic(() => import("@/components/Board"), {
  ssr: false,
  loading: () => <div className="h-dvh w-dvw bg-white" />,
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function once(target: EventTarget, event: string) {
  return new Promise<void>((resolve, reject) => {
    const onError = () => { cleanup(); reject(new Error("VIDEO FAILED DECODE")); };
    const onReady = () => { cleanup(); resolve(); };
    const cleanup = () => {
      target.removeEventListener(event, onReady);
      target.removeEventListener("error", onError);
    };
    target.addEventListener(event, onReady, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

async function canvasBlob(canvas: HTMLCanvasElement) {
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("THUMBNAIL EXTRACTION FAILED")), "image/png"));
}

async function validateVideo(
  blob: Blob,
  width: number,
  height: number,
  expectedDurationMs: number,
  eventOffsetMs: number,
  report: ReplayRunReport,
  finalLiveHash: Uint8Array,
  heartbeat: CaptureHeartbeat,
) {
  const failures: string[] = [];
  const warnings: string[] = [];
  if (!blob.size) throw new Error("VIDEO ENCODER PRODUCED AN EMPTY FILE");
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:0;top:0";
  document.body.appendChild(video);
  video.src = url;
  try {
    await once(video, "loadedmetadata");
    let decodedDurationSeconds = video.duration;
    if (!Number.isFinite(decodedDurationSeconds)) {
      const durationReady = Promise.race([once(video, "durationchange"), once(video, "seeked"), sleep(1_000)]);
      video.currentTime = 1e9;
      await durationReady;
      decodedDurationSeconds = Number.isFinite(video.duration) ? video.duration : video.currentTime;
      video.currentTime = 0;
    }
    if (!Number.isFinite(decodedDurationSeconds) || decodedDurationSeconds <= 0) {
      decodedDurationSeconds = expectedDurationMs / 1000;
      warnings.push("CONTAINER DID NOT EXPOSE FINITE DURATION; EXPECTED CAPTURE DURATION USED FOR SAMPLING");
    }
    if (video.videoWidth !== width || video.videoHeight !== height) failures.push("VIDEO RESOLUTION MISMATCH");
    const durationMs = decodedDurationSeconds * 1000;
    const durationDeltaMs = Math.abs(durationMs - expectedDurationMs);
    if (durationDeltaMs > 1_250) failures.push("VIDEO DURATION MISMATCH");

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("VIDEO FRAME SAMPLING FAILED");
    const samples: CaptureFrameSample[] = [];
    video.pause();
    for (let atMs = 0; atMs <= durationMs; atMs += 250) {
      const target = Math.min(atMs / 1000, Math.max(0, decodedDurationSeconds - .02));
      if (Math.abs(video.currentTime - target) > .0001) {
        const ready = once(video, "seeked");
        video.currentTime = target;
        await Promise.race([ready, sleep(100)]);
      }
      await sleep(16);
      context.drawImage(video, 0, 0, width, height);
      samples.push({ atMs: target * 1000, hash: sampleCanvasPixels(canvas) });
    }
    const thumbnail = await canvasBlob(canvas);
    const finalHash = sampleCanvasPixels(canvas);
    const finalFrameDifference = frameDifference(finalHash, finalLiveHash);
    if (finalFrameDifference > .035) failures.push("FINAL VIDEO FRAME DOES NOT MATCH LIVE CANVAS");
    const changingFramePairs = samples.slice(1).filter((sample, index) => frameDifference(samples[index].hash, sample.hash) > .00025).length;
    if (!changingFramePairs) failures.push("CANVAS STOPPED PAINTING");
    const frozenSuffixMs = frozenSuffixDuration(samples);
    const eventResults = validateEventPixels(report.events, samples, eventOffsetMs);
    for (const result of eventResults) {
      if (!result.passed && result.type === "page") failures.push("PAGE TURN NOT PRESENT IN VIDEO");
      if (!result.passed && result.type === "camera") failures.push("CAMERA EVENT NOT PRESENT IN VIDEO");
      if (!result.passed && (result.type === "text" || result.type === "visual")) warnings.push(`${result.type.toUpperCase()} EVENT PIXEL CHANGE WAS BELOW CONSERVATIVE THRESHOLD`);
    }
    const lastMaterialEvent = eventResults.filter((event) => event.type === "page" || event.type === "camera" || event.type === "visual").at(-1)?.atMs ?? 0;
    if (frozenSuffixMs > 4_000 && lastMaterialEvent > durationMs - frozenSuffixMs) failures.push("VIDEO HAS A FROZEN SUFFIX WHILE EVENTS CONTINUE");

    let audioPeak = 0;
    let audioTrackPresent = false;
    const audioContext = new AudioContext();
    try {
      const decoded = await audioContext.decodeAudioData(await blob.arrayBuffer());
      audioTrackPresent = decoded.numberOfChannels > 0 && decoded.duration > 0;
      for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
        const data = decoded.getChannelData(channel);
        const stride = Math.max(1, Math.floor(data.length / 50_000));
        for (let index = 0; index < data.length; index += stride) audioPeak = Math.max(audioPeak, Math.abs(data[index]));
      }
    } catch {
      failures.push("AUDIO TRACK MISSING");
    } finally {
      await audioContext.close().catch(() => undefined);
    }
    if (!audioTrackPresent) failures.push("AUDIO TRACK MISSING");
    if (audioTrackPresent && audioPeak < .0005) failures.push("AUDIO TRACK IS SILENT");

    const captureDurationSeconds = Math.max(.001, expectedDurationMs / 1000);
    const measuredFps = Math.min(DEMO_CAPTURE_FPS, heartbeat.frameCount / captureDurationSeconds);
    if (measuredFps < 20 || measuredFps > 31) failures.push("CAPTURE FPS OUT OF RANGE");
    const metrics: CaptureValidationMetrics = {
      decoded: true,
      expectedResolution: video.videoWidth === width && video.videoHeight === height,
      measuredFps,
      audioTrackPresent,
      audioPeak,
      durationMs,
      expectedDurationMs,
      durationDeltaMs,
      sampledFrames: samples.length,
      changingFramePairs,
      frozenSuffixMs,
      finalFrameDifference,
      eventResults,
      failures: [...new Set(failures)],
      warnings: [...new Set(warnings)],
    };
    return { metrics, thumbnail };
  } finally {
    video.removeAttribute("src");
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
  }
}

function waitForBoard(): Promise<DemoBoardApi> {
  if (window.__inpublicDemoStudioBoard) return Promise.resolve(window.__inpublicDemoStudioBoard);
  return new Promise<DemoBoardApi>((resolve) => {
    const ready = () => {
      if (!window.__inpublicDemoStudioBoard) return;
      window.removeEventListener("inpublic-demo-board-ready", ready);
      resolve(window.__inpublicDemoStudioBoard);
    };
    window.addEventListener("inpublic-demo-board-ready", ready);
  });
}

function formatTime(ms: number) {
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function DemoStudio() {
  const [boardKey, setBoardKey] = useState(1);
  const [prepared, setPrepared] = useState<PreparedDemoAudio | null>(null);
  const [status, setStatus] = useState<DemoStudioStatus>("IDLE");
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [sourceTimeMs, setSourceTimeMs] = useState(0);
  const [heartbeat, setHeartbeat] = useState<CaptureHeartbeat>({ frameCount: 0, maxFrameGapMs: 0, canvasCount: 0, drawErrors: 0, visibilityChanges: 0, recorderState: "inactive", rafTimestamps: [] });
  const [result, setResult] = useState<DemoArtifactBundle | null>(null);
  const [savedBundlePath, setSavedBundlePath] = useState<string | null>(null);
  const [manual, setManual] = useState({ bestMoment: "", bestTimestamp: "", postable: false, landing: false, tryPage: false, privacy: false });
  const runningRef = useRef(false);
  const urlsRef = useRef<string[]>([]);

  const discard = useCallback(() => {
    window.__inpublicDemoStudioBoard?.stop();
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    urlsRef.current = [];
    setResult(null);
    setSavedBundlePath(null);
    setPrepared(null);
    setError(null);
    setStatus("IDLE");
    setSourceTimeMs(0);
    setBoardKey((value) => value + 1);
  }, []);

  useEffect(() => () => urlsRef.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const chooseFile = useCallback(async (file: File | null) => {
    if (!file || runningRef.current) return;
    setResult(null);
    setPrepared(null);
    setError(null);
    setStatus("DECODING");
    try {
      const decoded = await decodeDemoAudio(file);
      setStatus("PREFLIGHTING");
      assertVisible();
      if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) throw new Error("VIDEO ENCODER IS UNAVAILABLE");
      if (!preferredDemoRecorderMime()) throw new Error("NO SAFE VIDEO CODEC IS AVAILABLE");
      setPrepared(decoded);
      setStatus("READY");
    } catch (reason) {
      setError(String((reason as Error)?.message ?? reason));
      setStatus("FAILED");
    }
  }, []);

  const run = useCallback(async () => {
    if (!prepared || runningRef.current) return;
    runningRef.current = true;
    setError(null);
    setResult(null);
    setSourceTimeMs(0);
    setStatus("CONNECTING");
    const demoId = crypto.randomUUID();
    let recorder: MediaRecorder | null = null;
    let sourceNode: AudioBufferSourceNode | null = null;
    let audioContext: AudioContext | null = null;
    let captureStream: MediaStream | null = null;
    let raf = 0;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let fatal: Error | null = null;
    let recordingStartedAt = 0;
    let recordingWallStartedAt = 0;
    let sourceStartedAt = 0;
    let finalLiveHash: Uint8Array<ArrayBufferLike> = new Uint8Array();
    const localHeartbeat: CaptureHeartbeat = { frameCount: 0, maxFrameGapMs: 0, canvasCount: 0, drawErrors: 0, visibilityChanges: 0, recorderState: "inactive", rafTimestamps: [] };
    const visibility = () => {
      if (document.visibilityState === "visible") return;
      localHeartbeat.visibilityChanges += 1;
      fatal = new Error("TAB BECAME HIDDEN");
      window.__inpublicDemoStudioBoard?.stop();
      try { sourceNode?.stop(); } catch { /* already stopped */ }
      if (recorder?.state !== "inactive") recorder?.stop();
    };
    document.addEventListener("visibilitychange", visibility);
    try {
      assertVisible();
      const boardApi = await Promise.race<DemoBoardApi>([
        waitForBoard(),
        sleep(10_000).then<never>(() => { throw new Error("BOARD DID NOT BECOME READY"); }),
      ]);
      const host = document.querySelector<HTMLElement>("[data-demo-board-host='true']");
      if (!host) throw new Error("BOARD CAPTURE SURFACE IS MISSING");
      const rect = host.getBoundingClientRect();
      const output = document.createElement("canvas");
      const ratio = Math.min(1, 1080 / Math.max(1, rect.height));
      output.width = Math.max(2, Math.round(rect.width * ratio / 2) * 2);
      output.height = Math.max(2, Math.round(rect.height * ratio / 2) * 2);
      const context = output.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("CANVAS COMPOSITOR FAILED");
      let lastFrameAt = 0;
      const compose = (at: number) => {
        const frameGap = lastFrameAt ? at - lastFrameAt : 0;
        lastFrameAt = at;
        localHeartbeat.maxFrameGapMs = Math.max(localHeartbeat.maxFrameGapMs, frameGap);
        localHeartbeat.frameCount += 1;
        localHeartbeat.rafTimestamps.push(at);
        if (localHeartbeat.rafTimestamps.length > 1_000) localHeartbeat.rafTimestamps.shift();
        const currentRect = host.getBoundingClientRect();
        const scaleX = output.width / Math.max(1, currentRect.width);
        const scaleY = output.height / Math.max(1, currentRect.height);
        context.fillStyle = "#fff";
        context.fillRect(0, 0, output.width, output.height);
        const canvases = [...host.querySelectorAll<HTMLCanvasElement>("canvas")].filter((canvas) => {
          const style = getComputedStyle(canvas);
          const bounds = canvas.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && bounds.width > 0 && bounds.height > 0;
        });
        localHeartbeat.canvasCount = canvases.length;
        for (const canvas of canvases) {
          const bounds = canvas.getBoundingClientRect();
          try {
            context.drawImage(canvas, (bounds.left - currentRect.left) * scaleX, (bounds.top - currentRect.top) * scaleY, bounds.width * scaleX, bounds.height * scaleY);
          } catch {
            localHeartbeat.drawErrors += 1;
          }
        }
        raf = requestAnimationFrame(compose);
      };
      raf = requestAnimationFrame(compose);
      heartbeatTimer = setInterval(() => setHeartbeat({ ...localHeartbeat, rafTimestamps: [...localHeartbeat.rafTimestamps] }), 500);
      await sleep(100);
      if (!localHeartbeat.canvasCount) throw new Error("NO EXCALIDRAW CANVAS LAYERS FOUND");

      audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();
      sourceNode = audioContext.createBufferSource();
      sourceNode.buffer = prepared.originalBuffer;
      sourceNode.connect(destination);
      await audioContext.resume();

      const mimeType = preferredDemoRecorderMime();
      captureStream = new MediaStream();
      output.captureStream(DEMO_CAPTURE_FPS).getVideoTracks().forEach((track) => captureStream!.addTrack(track));
      destination.stream.getAudioTracks().forEach((track) => captureStream!.addTrack(track));
      recorder = new MediaRecorder(captureStream, { mimeType });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      const stopped = new Promise<Blob>((resolve, reject) => {
        recorder!.onerror = () => reject(new Error("VIDEO ENCODER FAILED"));
        recorder!.onstop = () => resolve(new Blob(chunks, { type: recorder!.mimeType || mimeType }));
      });

      let sourceEndedResolve!: () => void;
      const sourceEnded = new Promise<void>((resolve) => { sourceEndedResolve = resolve; });
      sourceNode.onended = sourceEndedResolve;
      const runPromise = boardApi.run(prepared.replay, {
        beforeAudioStart: async () => {
          if (fatal) throw fatal;
          setStatus("READY");
          recorder!.start(1_000);
          localHeartbeat.recorderState = recorder!.state;
          recordingStartedAt = performance.now();
          recordingWallStartedAt = Date.now();
          await sleep(500);
          if (fatal) throw fatal;
          setStatus("RECORDING");
          sourceStartedAt = performance.now();
          sourceNode!.start(0);
        },
        onProgress: (audioEndMs) => {
          setSourceTimeMs(audioEndMs);
          if (performance.now() - sourceStartedAt - audioEndMs > 2_000) fatal = new Error("PCM SENDER STALLED");
        },
      });
      const tailTimeout = sourceEnded.then(() => Promise.race([
        runPromise,
        sleep(10_000).then(() => { throw new Error("TAIL TIMED OUT"); }),
      ]));
      const overallTimeout = sleep(prepared.replay.durationMs + 30_000).then(() => { throw new Error("RUN WATCHDOG TIMED OUT"); });
      const report = await Promise.race([tailTimeout, overallTimeout]);
      if (fatal) throw fatal;
      setStatus("SETTLING");
      await sleep(1_750);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      finalLiveHash = sampleCanvasPixels(output);
      const expectedDurationMs = performance.now() - recordingStartedAt;
      recorder.stop();
      localHeartbeat.recorderState = recorder.state;
      const video = await stopped;
      if (fatal) throw fatal;
      cancelAnimationFrame(raf);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      setHeartbeat({ ...localHeartbeat, rafTimestamps: [...localHeartbeat.rafTimestamps] });
      setStatus("VALIDATING");
      const eventOffsetMs = Date.parse(report.startedAt) - recordingWallStartedAt;
      const validated = await validateVideo(video, output.width, output.height, expectedDurationMs, eventOffsetMs, report, finalLiveHash, localHeartbeat);
      if (validated.metrics.failures.length) {
        (window as Window & { __inpublicDemoStudioFailure?: unknown }).__inpublicDemoStudioFailure = { metrics: validated.metrics, report };
        console.warn("[demo-studio-validation]", JSON.stringify({
          metrics: validated.metrics,
          camera: report.events.filter((event) => event.type === "camera"),
          pages: report.events.filter((event) => event.type === "page"),
        }));
        throw new Error(validated.metrics.failures.join("; "));
      }
      const extension = video.type.includes("mp4") ? "mp4" : "webm";
      const videoUrl = URL.createObjectURL(video);
      const thumbnailUrl = URL.createObjectURL(validated.thumbnail);
      urlsRef.current.push(videoUrl, thumbnailUrl);
      const metadataValue = {
        demoId,
        title,
        topic,
        sourceFileName: prepared.file.name,
        sourceMime: prepared.sourceMime,
        sourceBytes: prepared.file.size,
        sourceDurationMs: prepared.replay.durationMs,
        originalSampleRate: prepared.replay.sourceSampleRate,
        originalChannelCount: prepared.originalChannels,
        normalizedSampleRate: prepared.replay.sampleRate,
        normalizedChannels: 1,
        pcmChunkCount: prepared.pcmChunkCount,
        runSessionId: report.latency.sessionId,
        appCommit: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "local-working-tree",
        featureState: "production vr_full",
        videoWidth: output.width,
        videoHeight: output.height,
        fps: validated.metrics.measuredFps,
        codec: video.type,
        videoDurationMs: validated.metrics.durationMs,
        videoBytes: video.size,
        recordingStartToAudioStartMs: sourceStartedAt - recordingStartedAt,
        tailDurationMs: expectedDurationMs - (sourceStartedAt - recordingStartedAt) - prepared.replay.durationMs,
        settledThoughtCount: report.settledThoughts.length,
        pageCount: 1 + Math.max(0, ...report.pageTurns.map((event) => event.page)),
        pageTurnTimestamps: report.pageTurns.map((event) => event.atMs),
        visualFamilies: [...new Set(report.events.filter((event) => event.type === "visual-reentry" && "visualFamily" in event).map((event) => "visualFamily" in event ? event.visualFamily : undefined).filter(Boolean))],
        cameraEvents: report.events.filter((event) => event.type === "camera"),
        visibilityHealth: { passed: localHeartbeat.visibilityChanges === 0, changes: localHeartbeat.visibilityChanges },
        rafHealth: { passed: localHeartbeat.maxFrameGapMs < 1_000, maxGapMs: localHeartbeat.maxFrameGapMs, frameCount: localHeartbeat.frameCount },
        compositorHealth: { canvasCount: localHeartbeat.canvasCount, drawErrors: localHeartbeat.drawErrors },
        captureValidation: "PASS",
        validationMetrics: validated.metrics,
        errors: [],
        warnings: validated.metrics.warnings,
        manual: { bestMoment: "", bestTimestamp: "", postable: null, landingPageWorthy: null, tryPageWorthy: null, privacyCleared: null },
      };
      const bundle: DemoArtifactBundle = {
        demoId,
        source: prepared.file,
        video,
        videoExtension: extension,
        session: jsonBlob(report),
        transcript: new Blob([report.transcript], { type: "text/plain" }),
        metadata: jsonBlob(metadataValue),
        thumbnail: validated.thumbnail,
        report,
        validation: validated.metrics,
        videoUrl,
        thumbnailUrl,
      };
      setResult(bundle);
      setStatus("COMPLETE");
    } catch (reason) {
      const message = (fatal as Error | null)?.message || String((reason as Error)?.message ?? reason);
      setError(message);
      setStatus("FAILED");
      window.__inpublicDemoStudioBoard?.stop();
      try { sourceNode?.stop(); } catch { /* already stopped */ }
      if (recorder?.state && recorder.state !== "inactive") recorder.stop();
      setBoardKey((value) => value + 1);
    } finally {
      runningRef.current = false;
      document.removeEventListener("visibilitychange", visibility);
      cancelAnimationFrame(raf);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      captureStream?.getTracks().forEach((track) => track.stop());
      await audioContext?.close().catch(() => undefined);
    }
  }, [prepared, title, topic]);

  const pageCount = result ? 1 + Math.max(0, ...result.report.pageTurns.map((event) => event.page)) : 0;
  const visualFamilies = useMemo(() => result ? [...new Set(result.report.events.filter((event) => event.type === "visual-reentry" && "visualFamily" in event).map((event) => "visualFamily" in event ? event.visualFamily : undefined).filter(Boolean))] : [], [result]);
  const active = ["CONNECTING", "RECORDING", "SETTLING", "VALIDATING"].includes(status);

  const saveLocalBundle = useCallback(async () => {
    if (!result || savedBundlePath) return;
    const sourceExtension = result.source.name.split(".").at(-1) || "audio";
    const artifacts = [
      { key: "source", blob: result.source, extension: sourceExtension },
      { key: "video", blob: result.video, extension: result.videoExtension },
      { key: "session", blob: result.session, extension: "json" },
      { key: "transcript", blob: result.transcript, extension: "txt" },
      { key: "metadata", blob: result.metadata, extension: "json" },
      { key: "thumbnail", blob: result.thumbnail, extension: "png" },
    ] as const;
    const chunkSize = 5 * 1024 * 1024;
    let directory = "";
    for (const artifact of artifacts) {
      const chunkCount = Math.max(1, Math.ceil(artifact.blob.size / chunkSize));
      for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
        const response = await fetch("/api/dev/demo-artifacts", {
          method: "POST",
          headers: {
            "x-demo-id": result.demoId,
            "x-artifact": artifact.key,
            "x-extension": artifact.extension,
            "x-chunk-index": String(chunkIndex),
            "x-chunk-count": String(chunkCount),
          },
          body: artifact.blob.slice(chunkIndex * chunkSize, (chunkIndex + 1) * chunkSize),
        });
        const payload = await response.json() as { directory?: string; error?: string };
        if (!response.ok || !payload.directory) throw new Error(payload.error || "LOCAL BUNDLE SAVE FAILED");
        directory = payload.directory;
      }
    }
    setSavedBundlePath(directory);
  }, [result, savedBundlePath]);

  return (
    <main className="fixed inset-0 overflow-hidden bg-white text-zinc-900">
      <Board key={boardKey} guest startFresh demoStudio />
      <aside className="fixed right-4 top-4 z-[100] max-h-[calc(100vh-2rem)] w-[390px] overflow-y-auto rounded-2xl border border-zinc-200 bg-white/95 p-5 shadow-2xl backdrop-blur">
        <h1 className="text-xl font-semibold">InPublic Demo Studio</h1>
        <p className="mt-1 rounded-lg bg-amber-50 p-3 text-sm font-medium text-amber-900">Keep this tab visible and in front until the demo is complete.</p>
        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-zinc-500">Voice note (max 90 seconds)</label>
        <input className="mt-1 block w-full text-sm" type="file" accept=".wav,.mp3,.ogg,.opus,audio/wav,audio/mpeg,audio/ogg,audio/opus" disabled={active} onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)} />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <input className="rounded-lg border border-zinc-300 px-3 py-2 text-sm" placeholder="Title (optional)" value={title} onChange={(event) => setTitle(event.target.value)} disabled={active} />
          <input className="rounded-lg border border-zinc-300 px-3 py-2 text-sm" placeholder="Topic/category" value={topic} onChange={(event) => setTopic(event.target.value)} disabled={active} />
        </div>
        {prepared ? <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs"><dt>File</dt><dd className="max-w-52 truncate text-right">{prepared.file.name}</dd><dt>Format</dt><dd>{prepared.format}</dd><dt>Duration</dt><dd>{formatTime(prepared.replay.durationMs)}</dd><dt>Original</dt><dd>{prepared.replay.sourceSampleRate} Hz / {prepared.originalChannels} ch</dd><dt>Normalized</dt><dd>48000 Hz / mono</dd><dt>PCM chunks</dt><dd>{prepared.pcmChunkCount}</dd></dl> : null}
        <div className="mt-4 flex gap-2">
          <button className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" disabled={!prepared || active} onClick={() => void run()}>Run</button>
          <button className="rounded-lg border border-zinc-300 px-4 py-2 text-sm" disabled={active} onClick={discard}>Discard run</button>
        </div>
        <div className={`mt-4 rounded-lg p-3 text-sm font-semibold ${status === "FAILED" ? "bg-red-50 text-red-800" : status === "COMPLETE" ? "bg-emerald-50 text-emerald-800" : "bg-zinc-100"}`}>{status}{error ? <div className="mt-1 font-normal">{error}</div> : null}</div>
        {active ? <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1 text-xs"><dt>Source time</dt><dd>{formatTime(sourceTimeMs)}</dd><dt>Total time</dt><dd>{prepared ? formatTime(prepared.replay.durationMs) : "—"}</dd><dt>Visibility</dt><dd>{document.visibilityState}</dd><dt>Capture frames</dt><dd>{heartbeat.frameCount}</dd></dl> : null}
        {result ? <section className="mt-5 border-t border-zinc-200 pt-4"><video className="w-full rounded-lg border border-zinc-200" src={result.videoUrl} controls /><dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1 text-xs"><dt>Pages</dt><dd>{pageCount}</dd><dt>Settled thoughts</dt><dd>{result.report.settledThoughts.length}</dd><dt>Visuals</dt><dd>{visualFamilies.join(", ") || "none"}</dd><dt>Camera starts</dt><dd>{result.report.events.filter((event) => event.type === "camera" && event.event === "started").length}</dd><dt>Capture validation</dt><dd>PASS</dd></dl><div className="mt-3 flex flex-wrap gap-2 text-xs"><button onClick={() => void saveLocalBundle()}>Save local bundle</button><button onClick={() => downloadDemoBlob(result.video, `demo-${result.demoId}/video.${result.videoExtension}`)}>Download video</button><button onClick={() => downloadDemoBlob(result.session, `demo-${result.demoId}/session.json`)}>Session JSON</button><button onClick={() => downloadDemoBlob(result.transcript, `demo-${result.demoId}/transcript.txt`)}>Transcript</button><button onClick={() => downloadDemoBlob(result.metadata, `demo-${result.demoId}/metadata.json`)}>Metadata</button><button onClick={() => downloadDemoBlob(result.thumbnail, `demo-${result.demoId}/thumbnail.png`)}>Thumbnail</button><button onClick={() => downloadDemoBlob(result.source, `demo-${result.demoId}/source-${result.source.name}`)}>Source</button></div>{savedBundlePath ? <p className="mt-2 break-all text-xs text-emerald-700">Saved: {savedBundlePath}</p> : null}<div className="mt-4 grid grid-cols-2 gap-2 text-xs"><input className="rounded border p-2" placeholder="Best moment" value={manual.bestMoment} onChange={(event) => setManual({ ...manual, bestMoment: event.target.value })} /><input className="rounded border p-2" placeholder="Timestamp" value={manual.bestTimestamp} onChange={(event) => setManual({ ...manual, bestTimestamp: event.target.value })} />{([['postable','Postable'],['landing','Landing page'],['tryPage','Try page'],['privacy','Privacy cleared']] as const).map(([key,label]) => <label key={key}><input type="checkbox" checked={manual[key]} onChange={(event) => setManual({ ...manual, [key]: event.target.checked })} /> {label}</label>)}</div></section> : null}
      </aside>
    </main>
  );
}
