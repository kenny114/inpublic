"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FREE_RECORDING_LIMIT_MS } from "@/lib/product";
import {
  downloadBlob,
  extensionForMimeType,
  saveRecording,
  type RecordingMetadata,
} from "@/lib/recordings";

export type RecordingStatus = "idle" | "recording" | "paused" | "ready" | "error";

export interface RecordingOptions {
  canvas: boolean;
  microphone: boolean;
  webcam: boolean;
  transcript: boolean;
  interface: boolean;
  quality: "720p" | "1080p";
}

export interface RecordingSnapshot extends Omit<RecordingMetadata,
  | "durationMs"
  | "mimeType"
  | "fileSize"
  | "includesCanvas"
  | "includesMicrophone"
  | "includesWebcam"
  | "transcriptVisible"
  | "interfaceVisible"
  | "timestamp"
> {}

const initialOptions: RecordingOptions = {
  canvas: true,
  microphone: true,
  webcam: false,
  transcript: false,
  interface: false,
  quality: "1080p",
};

/**
 * MP4/H.264 first, where the browser actually supports recording it —
 * WebM plays natively in a browser tab but isn't accepted by many places
 * people actually want to put a recording (most video editors, some social
 * upload flows, older Windows/macOS media players without a codec pack).
 * Falls back to WebM, which every Chromium-based browser can record.
 */
function preferredMimeType(hasVideo: boolean) {
  const candidates = hasVideo
    ? [
        "video/mp4;codecs=avc1.640028,mp4a.40.2",
        "video/mp4;codecs=h264,aac",
        "video/mp4",
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ]
    : ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (context.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(-2);
}

export function useCanvasRecorder(
  target: HTMLElement | null,
  getSnapshot: () => RecordingSnapshot,
) {
  const [status, setStatus] = useState<RecordingStatus>("idle");
  const statusRef = useRef<RecordingStatus>("idle");
  statusRef.current = status;
  const [options, setOptions] = useState<RecordingOptions>(initialOptions);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [durationMs, setDurationMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [lastRecording, setLastRecording] = useState<{ blob: Blob; metadata: RecordingMetadata } | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const microphoneRef = useRef<MediaStream | null>(null);
  const cameraRef = useRef<MediaStream | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const outputRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedRef = useRef(0);
  const pausedAtRef = useRef(0);
  const pausedTotalRef = useRef(0);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const discardRef = useRef(false);
  const latestSnapshotRef = useRef(getSnapshot);
  latestSnapshotRef.current = getSnapshot;

  const cleanupMedia = useCallback(() => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    microphoneRef.current?.getTracks().forEach((track) => track.stop());
    cameraRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    microphoneRef.current = null;
    cameraRef.current = null;
    setCameraStream(null);
    recordingStreamRef.current = null;
    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null;
    cameraVideoRef.current = null;
    outputRef.current = null;
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    stopTimerRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    if (cameraRef.current) return cameraRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: "user" },
      audio: false,
    });
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    cameraRef.current = stream;
    cameraVideoRef.current = video;
    setCameraStream(stream);
    return stream;
  }, []);

  const stopCamera = useCallback(() => {
    cameraRef.current?.getTracks().forEach((track) => track.stop());
    cameraRef.current = null;
    setCameraStream(null);
    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null;
    cameraVideoRef.current = null;
  }, []);

  const drawFrame = useCallback(() => {
    const output = outputRef.current;
    if (!output || !target) return;
    const context = output.getContext("2d");
    if (!context) return;
    const targetRect = target.getBoundingClientRect();
    const scaleX = output.width / Math.max(1, targetRect.width);
    const scaleY = output.height / Math.max(1, targetRect.height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, output.width, output.height);

    if (optionsRef.current.canvas) {
      for (const canvas of target.querySelectorAll("canvas")) {
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        try {
          context.drawImage(
            canvas,
            (rect.left - targetRect.left) * scaleX,
            (rect.top - targetRect.top) * scaleY,
            rect.width * scaleX,
            rect.height * scaleY,
          );
        } catch {
          // A canvas may be replaced by Excalidraw between discovery and paint.
        }
      }
    }

    const camera = cameraVideoRef.current;
    if (optionsRef.current.webcam && camera?.readyState && camera.videoWidth) {
      const width = output.width * 0.2;
      const height = width * 0.5625;
      const x = output.width - width - 28 * scaleX;
      const y = 28 * scaleY;
      context.save();
      context.beginPath();
      context.roundRect(x, y, width, height, 14 * scaleX);
      context.clip();
      context.translate(x + width, y);
      context.scale(-1, 1);
      context.drawImage(camera, 0, 0, width, height);
      context.restore();
      context.strokeStyle = "rgba(17,24,39,.18)";
      context.lineWidth = 2;
      context.strokeRect(x, y, width, height);
    }

    if (optionsRef.current.transcript) {
      const transcript = target.querySelector<HTMLElement>("[data-recording-transcript]")?.dataset.recordingTranscript || "";
      if (transcript) {
        context.font = `${Math.max(18, Math.round(output.width / 60))}px ui-sans-serif, system-ui`;
        const lines = wrapText(context, transcript, output.width * 0.72);
        const lineHeight = Math.max(26, output.width / 42);
        const boxHeight = lines.length * lineHeight + 28;
        context.fillStyle = "rgba(255,255,255,.9)";
        context.fillRect(output.width * 0.12, output.height - boxHeight - 24, output.width * 0.76, boxHeight);
        context.fillStyle = "#27272a";
        context.textAlign = "center";
        lines.forEach((line, index) => {
          context.fillText(line, output.width / 2, output.height - boxHeight + 12 + index * lineHeight, output.width * 0.7);
        });
      }
    }

    if (optionsRef.current.interface) {
      context.fillStyle = "rgba(255,255,255,.92)";
      context.fillRect(20, 20, 260, 38);
      context.strokeStyle = "#e4e4e7";
      context.strokeRect(20, 20, 260, 38);
      context.fillStyle = "#27272a";
      context.font = "16px ui-sans-serif, system-ui";
      context.textAlign = "left";
      context.fillText("●  InPublic recording", 36, 44);
    }
    animationRef.current = requestAnimationFrame(drawFrame);
  }, [target]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    if (recorder.state === "paused") {
      pausedTotalRef.current += Date.now() - pausedAtRef.current;
      pausedAtRef.current = 0;
      recorder.resume();
    }
    recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (!target || statusRef.current === "recording" || statusRef.current === "paused") return;
    setError(null);
    setLastRecording(null);
    discardRef.current = false;
    chunksRef.current = [];
    try {
      if (!window.MediaRecorder) throw new Error("This browser does not support MediaRecorder.");
      if (!optionsRef.current.canvas && !optionsRef.current.microphone && !optionsRef.current.webcam) {
        throw new Error("Turn on the canvas, microphone, or webcam before recording.");
      }
      if (optionsRef.current.microphone) {
        microphoneRef.current = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: false,
        });
      }
      if (optionsRef.current.webcam) await startCamera();

      const hasVideo = optionsRef.current.canvas || optionsRef.current.webcam;
      const stream = new MediaStream();
      if (hasVideo) {
        const rect = target.getBoundingClientRect();
        const maxHeight = optionsRef.current.quality === "1080p" ? 1080 : 720;
        const ratio = Math.min(1, maxHeight / Math.max(1, rect.height));
        const output = document.createElement("canvas");
        output.width = Math.max(2, Math.round(rect.width * ratio / 2) * 2);
        output.height = Math.max(2, Math.round(rect.height * ratio / 2) * 2);
        outputRef.current = output;
        drawFrame();
        output.captureStream(30).getVideoTracks().forEach((track) => stream.addTrack(track));
      }
      microphoneRef.current?.getAudioTracks().forEach((track) => stream.addTrack(track));
      recordingStreamRef.current = stream;
      const mimeType = preferredMimeType(hasVideo);
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setError("The browser recorder failed. Your canvas session is still saved.");
        setStatus("error");
        cleanupMedia();
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "video/webm" });
        const elapsed = Math.max(0, Date.now() - startedRef.current - pausedTotalRef.current);
        const base = latestSnapshotRef.current();
        const metadata: RecordingMetadata = {
          ...base,
          timestamp: new Date().toISOString(),
          durationMs: elapsed,
          mimeType: blob.type,
          fileSize: blob.size,
          includesCanvas: optionsRef.current.canvas,
          includesMicrophone: optionsRef.current.microphone,
          includesWebcam: optionsRef.current.webcam,
          transcriptVisible: optionsRef.current.transcript,
          interfaceVisible: optionsRef.current.interface,
        };
        cleanupMedia();
        recorderRef.current = null;
        localStorage.removeItem("inpublic-recording-active");
        if (discardRef.current || !blob.size) {
          statusRef.current = "idle";
          setStatus("idle");
          return;
        }
        setLastRecording({ blob, metadata });
        setDurationMs(elapsed);
        setStatus("ready");
        const recordingId = `${base.sessionId}-${Date.now()}`;
        void saveRecording({ id: recordingId, metadata, blob }).catch(() => {
          setError("The WebM is ready, but this browser could not save a local copy.");
        });
      };
      startedRef.current = Date.now();
      pausedTotalRef.current = 0;
      pausedAtRef.current = 0;
      localStorage.setItem("inpublic-recording-active", new Date().toISOString());
      recorder.start(1_000);
      setDurationMs(0);
      setStatus("recording");
      stopTimerRef.current = setTimeout(stop, FREE_RECORDING_LIMIT_MS);
    } catch (reason) {
      cleanupMedia();
      setStatus("error");
      const name = (reason as Error)?.name;
      setError(
        name === "NotAllowedError"
          ? "Microphone or camera permission was denied. Change recording settings and try again."
          : String((reason as Error)?.message || reason),
      );
    }
  }, [cleanupMedia, drawFrame, startCamera, stop, target]);

  const pause = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder?.state !== "recording") return;
    recorder.pause();
    pausedAtRef.current = Date.now();
    setStatus("paused");
  }, []);

  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder?.state !== "paused") return;
    pausedTotalRef.current += Date.now() - pausedAtRef.current;
    pausedAtRef.current = 0;
    recorder.resume();
    setStatus("recording");
  }, []);

  const restart = useCallback(() => {
    discardRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.addEventListener("stop", () => void start(), { once: true });
      stop();
    } else {
      void start();
    }
  }, [start, stop]);

  const toggleMute = useCallback(() => {
    const tracks = microphoneRef.current?.getAudioTracks() || [];
    tracks.forEach((track) => { track.enabled = !track.enabled; });
    return tracks[0] ? !tracks[0].enabled : false;
  }, []);

  const toggleWebcam = useCallback(async () => {
    const next = !optionsRef.current.webcam;
    setOptions((current) => ({ ...current, webcam: next }));
    try {
      if (next) await startCamera();
      else stopCamera();
    } catch {
      setOptions((current) => ({ ...current, webcam: false }));
      setError("Camera permission was denied or the camera is unavailable.");
    }
  }, [startCamera, stopCamera]);

  const exportLast = useCallback(() => {
    if (!lastRecording) return;
    const ext = extensionForMimeType(lastRecording.metadata.mimeType || lastRecording.blob.type);
    downloadBlob(lastRecording.blob, `inpublic-${lastRecording.metadata.sessionId}.${ext}`);
  }, [lastRecording]);

  useEffect(() => {
    if (status !== "recording") return;
    const timer = setInterval(() => {
      setDurationMs(Date.now() - startedRef.current - pausedTotalRef.current);
    }, 250);
    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => {
    if (localStorage.getItem("inpublic-recording-active")) {
      localStorage.removeItem("inpublic-recording-active");
      setError("A previous recording was interrupted. Its canvas session was preserved, but its unfinished video could not be recovered.");
    }
    const onUnload = () => cleanupMedia();
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      cleanupMedia();
    };
  }, [cleanupMedia]);

  return {
    status, options, setOptions, durationMs, error, setError, lastRecording, cameraStream,
    start, pause, resume, stop, restart, toggleMute, toggleWebcam, exportLast,
  };
}
