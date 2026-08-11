"use client";

/**
 * Audio Replay Mode: upload a lesson/lecture, get a synchronized visual
 * replay. Reuses the SAME /api/artist and /api/math routes Standard Mode
 * calls live — this panel only decides WHEN to call them and WHAT
 * transcript to send (one AudioSegment at a time, from the timeline
 * /api/audio/upload returns), not how to draw. Canvas edits during replay
 * go through the exact same `applyActions` as live mode, so the board stays
 * editable throughout.
 *
 * v2 — producer/consumer scheduler. The previous version drove EVERYTHING
 * (prefetch, due-segment processing, and the pause/resume check) from the
 * <audio> element's `timeupdate` event, which the browser stops firing the
 * instant the element is paused. Since pausing was also the response to lag
 * being too high, that meant: pause for lag -> timeupdate stops -> nothing
 * prepares the next segment or rechecks lag -> permanent deadlock. Reproduced
 * on a real 385s lecture: paused at audioTime=16.81s and never moved again.
 *
 * Now: a fixed-interval scheduler tick (schedulerTick, started on mount, torn
 * down on unmount) drives preparation and display, independent of whether
 * the element is playing, paused, or between timeupdate events. Preparation
 * (fetching a segment's draw response and caching it) is decoupled from
 * display (actually calling applyActions for a segment whose startTime has
 * been reached) — see lib/audio/replayController.ts's header for the full
 * design rationale.
 *
 * Known limitation, documented rather than faked: scrubbing BACKWARD moves
 * the audio position but does not retroactively erase content already
 * drawn for segments after that point — a full timestamp -> operation-log
 * revert was out of scope for this pass. Scrubbing forward marks the
 * skipped segments as already-displayed (so they never draw) instead of
 * bursting through all of them at once.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, Rewind, RotateCcw, Upload, X } from "lucide-react";
import { parseActions, type CanvasAction } from "@/lib/actions";
import type { SemanticScene } from "@/lib/semantic";
import type { AudioSegment, AudioTimeline } from "@/lib/audio/types";
import { ReplayController, type ReplayControllerSnapshot } from "@/lib/audio/replayController";
import { providerRequestHeaders } from "@/lib/usage-client";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

/**
 * Vercel Functions cap a request body at 4.5MB — well under a real lecture
 * recording. The file now goes straight from the browser to Supabase
 * Storage (under the uploading user's own RLS-scoped folder), and the
 * server route is handed a storage path instead of the raw bytes. See
 * supabase/migrations/202608100001_lecture_upload_storage.sql.
 */
const LECTURE_UPLOADS_BUCKET = "lecture-uploads";

const MATH_ENABLED = process.env.NEXT_PUBLIC_ENABLE_MATH_MODE === "true";

/** How often the scheduler tick runs. Independent of timeupdate, so it keeps working while paused. */
const SCHEDULER_TICK_MS = 250;

export interface AudioReplayPanelProps {
  applyActions: (actions: CanvasAction[], sourceText: string) => Promise<string[]>;
  semanticScene: () => SemanticScene;
  log: (event: { type: "note"; text: string }) => void;
  onClose: () => void;
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

type DrawResult =
  | { kind: "math"; action: CanvasAction | null }
  | { kind: "artist"; actions: CanvasAction[] };

export function AudioReplayPanel({ applyActions, semanticScene, log, onClose }: AudioReplayPanelProps) {
  const [status, setStatus] = useState<"idle" | "uploading" | "preparing" | "ready" | "error">("idle");
  const [errorText, setErrorText] = useState("");
  const [timeline, setTimeline] = useState<AudioTimeline | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [snapshot, setSnapshot] = useState<ReplayControllerSnapshot>(() => new ReplayController().snapshot());

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const controllerRef = useRef<ReplayController>(new ReplayController({ onSnapshot: setSnapshot }));
  /** Segments whose draw actions have actually been applied to the board (or permanently given up on). */
  const displayedRef = useRef<Set<string>>(new Set());
  /** One display application at a time, serialized — mirrors the old applyingRef. */
  const displayingRef = useRef(false);
  const pausedForLagRef = useRef(false);
  /** Distinguishes "we paused this for lag" from "the user hit pause" — only the former auto-resumes. */
  const userPausedRef = useRef(false);
  const activeExpressionRef = useRef<string | undefined>(undefined);
  const activeConceptIdRef = useRef<string | undefined>(undefined);
  /** Prepared (fetched, cached, NOT yet displayed) draw responses, keyed by segmentId. */
  const preparedCacheRef = useRef<Map<string, DrawResult>>(new Map());
  /** In-flight promise registry — prepare and display both dedup through this, so the same segment is never fetched twice concurrently. */
  const inFlightRef = useRef<Map<string, Promise<DrawResult>>>(new Map());
  const inFlightAbortRef = useRef<Set<AbortController>>(new Set());
  const timelineRef = useRef<AudioTimeline | null>(null);
  const schedulerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shutdownRef = useRef(false);
  /** Bumped on every file load — a stray callback from a previous file can never touch state tagged with an older id. */
  const replaySessionIdRef = useRef<string>("");

  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);
  useEffect(() => { timelineRef.current = timeline; }, [timeline]);

  /** Aborts every fetch dispatched under the previous generation — used on seek/rewind/shutdown so cancelled work stops costing money, not just stops mattering. */
  const cancelInFlight = useCallback(() => {
    for (const controller of inFlightAbortRef.current) controller.abort();
    inFlightAbortRef.current.clear();
    inFlightRef.current.clear();
  }, []);

  /**
   * Full, idempotent teardown. Called both from the unmount cleanup effect
   * AND synchronously from the close button, so closing the panel stops
   * work immediately rather than waiting for React to actually unmount —
   * closing used to leave in-flight fetches free to keep drawing on the
   * board after the panel was gone.
   */
  const shutdown = useCallback(() => {
    if (shutdownRef.current) return;
    shutdownRef.current = true;
    if (schedulerIntervalRef.current) {
      clearInterval(schedulerIntervalRef.current);
      schedulerIntervalRef.current = null;
    }
    cancelInFlight();
    controllerRef.current.shutdown();
    preparedCacheRef.current.clear();
    const audio = audioRef.current;
    if (audio) audio.pause();
  }, [cancelInFlight]);

  useEffect(() => () => shutdown(), [shutdown]);

  const handleClose = useCallback(() => {
    shutdown();
    onClose();
  }, [shutdown, onClose]);

  const onFile = useCallback(async (file: File) => {
    shutdownRef.current = false;
    setStatus("uploading");
    setErrorText("");
    cancelInFlight();
    displayedRef.current = new Set();
    preparedCacheRef.current = new Map();
    activeExpressionRef.current = undefined;
    activeConceptIdRef.current = undefined;
    replaySessionIdRef.current = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `replay_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const url = URL.createObjectURL(file);
    setObjectUrl(url);

    let storagePath: string | null = null;
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) throw new Error("Sign in to upload a recording.");

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "recording";
      storagePath = `${userData.user.id}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from(LECTURE_UPLOADS_BUCKET)
        .upload(storagePath, file, { contentType: file.type || "application/octet-stream", upsert: false });
      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
      if (shutdownRef.current) return;

      const res = await fetch("/api/audio/upload", {
        method: "POST",
        headers: providerRequestHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ storagePath, mimetype: file.type || "application/octet-stream", sizeBytes: file.size }),
      });
      const data = (await res.json()) as { timeline?: AudioTimeline; error?: { message: string } };
      if (!res.ok || !data.timeline) {
        throw new Error(data.error?.message ?? `upload failed (${res.status})`);
      }
      if (shutdownRef.current) return;
      setTimeline(data.timeline);
      controllerRef.current.markProcessed(data.timeline.durationSeconds);
      log({ type: "note", text: `audio replay: ${data.timeline.segments.length} segments, ${data.timeline.durationSeconds.toFixed(0)}s` });
      await prepareInitialBuffer(data.timeline);
    } catch (err) {
      if (shutdownRef.current) return;
      setStatus("error");
      setErrorText(String((err as Error)?.message ?? err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log, cancelInFlight]);

  /** Runs a draw call for one segment and returns its result WITHOUT applying it — used for both preparation and display. */
  const drawSegment = useCallback(async (segment: AudioSegment, signal: AbortSignal): Promise<DrawResult> => {
    if (MATH_ENABLED && segment.mathematicalClaim) {
      const res = await fetch("/api/math", {
        method: "POST",
        headers: providerRequestHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          focus: segment.mathematicalClaim,
          transcript: segment.transcript,
          scene: semanticScene(),
          activeConceptId: activeConceptIdRef.current,
          currentExpression: activeExpressionRef.current,
          depth: "default",
        }),
        signal,
      });
      const { action } = (await res.json()) as { action?: CanvasAction | null };
      return { kind: "math", action: action ?? null };
    }

    const res = await fetch("/api/artist", {
      method: "POST",
      headers: providerRequestHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        focus: segment.topic ?? "",
        transcript: segment.transcript,
        sceneSummary: [],
        scene: semanticScene(),
        intent: "draw",
      }),
      signal,
    });
    const { actions } = (await res.json()) as { actions?: unknown[] };
    return { kind: "artist", actions: parseActions(JSON.stringify({ actions: actions ?? [] })) };
  }, [semanticScene]);

  /**
   * Ensures a fetch is in flight for this segment, deduped through the
   * shared promise registry — the prepare-worker and the "overdue but not
   * yet prepared" display-step path both call this same function, so the
   * same segment is never dispatched twice concurrently (the race the old
   * prefetch-cache-only guard allowed).
   */
  const ensurePrepared = useCallback((segment: AudioSegment, generation: number): Promise<DrawResult> => {
    const existing = inFlightRef.current.get(segment.segmentId);
    if (existing) return existing;
    const abortController = new AbortController();
    inFlightAbortRef.current.add(abortController);
    const promise = drawSegment(segment, abortController.signal)
      .then((result) => {
        if (!controllerRef.current.isStale(generation)) {
          preparedCacheRef.current.set(segment.segmentId, result);
          controllerRef.current.markPrepared(segment.endTime);
        }
        return result;
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name !== "AbortError" && !controllerRef.current.isStale(generation)) {
          log({ type: "note", text: `audio replay: segment failed to prepare: ${String(err)}` });
        }
        throw err;
      })
      .finally(() => {
        inFlightRef.current.delete(segment.segmentId);
        inFlightAbortRef.current.delete(abortController);
      });
    inFlightRef.current.set(segment.segmentId, promise);
    return promise;
  }, [drawSegment, log]);

  /** Applies one already-prepared segment through the real drawing pipeline. Failure permanently marks the segment displayed (never blocks the rest of the replay on one bad segment) rather than retrying forever. */
  const displaySegment = useCallback(async (segment: AudioSegment, result: DrawResult, generation: number) => {
    try {
      // Checked before parsing/committing: a seek/close that happened while
      // this was in flight invalidates it — committing a stale response
      // would paint over wherever the user jumped to, or re-narrate a
      // segment that's no longer current.
      if (controllerRef.current.isStale(generation)) return;

      if (result.kind === "math") {
        if (result.action) {
          if (controllerRef.current.isStale(generation)) return;
          await applyActions([result.action], segment.transcript);
          if (controllerRef.current.isStale(generation)) return;
          if (result.action.type === "create_equation") {
            activeConceptIdRef.current = result.action.conceptId;
            activeExpressionRef.current = result.action.expression;
          } else if (result.action.type === "transform_equation") {
            activeExpressionRef.current = result.action.step.result;
          }
        }
      } else if (result.actions.length) {
        if (controllerRef.current.isStale(generation)) return;
        await applyActions(result.actions, segment.transcript);
      }
      if (controllerRef.current.isStale(generation)) return;
      controllerRef.current.markDisplayed(segment.endTime);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      if (!controllerRef.current.isStale(generation)) {
        log({ type: "note", text: `audio replay segment failed: ${String(err)}` });
        controllerRef.current.markDisplayed(segment.endTime);
      }
    } finally {
      preparedCacheRef.current.delete(segment.segmentId);
    }
  }, [applyActions, log]);

  /** Prepares the first `initialBufferSeconds` of the timeline before playback is allowed to start, so the audio never opens with a lead over unrendered visuals. */
  const prepareInitialBuffer = useCallback(async (loadedTimeline: AudioTimeline) => {
    setStatus("preparing");
    const generation = controllerRef.current.currentGeneration;
    controllerRef.current.beginInitialBuffering();
    const bufferEnd = controllerRef.current.initialBufferSeconds;
    const initial = loadedTimeline.segments
      .filter((s) => s.startTime < bufferEnd && s.transcript.trim())
      .sort((a, b) => a.startTime - b.startTime);
    for (const segment of initial) {
      if (controllerRef.current.isStale(generation)) return;
      displayedRef.current.add(segment.segmentId);
      const result = await ensurePrepared(segment, generation).catch(() => null);
      if (controllerRef.current.isStale(generation)) return;
      if (result) await displaySegment(segment, result, generation);
    }
    if (controllerRef.current.isStale(generation)) return;
    controllerRef.current.readyToPlay();
    setStatus("ready");
  }, [ensurePrepared, displaySegment]);

  /**
   * The scheduler tick — the whole fix. Runs on a fixed interval regardless
   * of whether <audio> is playing, paused, or between timeupdate events, so
   * preparation (and the lag re-check that depends on it) never stalls just
   * because playback did.
   */
  const schedulerTick = useCallback(() => {
    const audio = audioRef.current;
    const tl = timelineRef.current;
    if (!audio || !tl || shutdownRef.current) return;
    const t = audio.currentTime;
    setCurrentTime(t);
    controllerRef.current.updateAudioTime(t);
    // useUsageSession's live-microphone idle watchdog force-stops listening
    // after 90s without an "inpublic-final-transcript" event — it has no
    // notion of Audio Replay, which never produces one (there's no live mic
    // input to finalize). Without this, a still-active live-listening
    // session gets killed out from under the user 90s into a replay that is
    // working perfectly fine, with a scary "needs your attention" banner.
    // Reusing the exact same signal the watchdog already listens for is the
    // minimal fix — it correctly reads replay activity as "not idle"
    // without either system needing to know about the other's internals.
    window.dispatchEvent(new Event("inpublic-final-transcript"));
    const generation = controllerRef.current.currentGeneration;

    // Producer: keep preparedThroughTime running ahead of audioTime by
    // `lookaheadSeconds`, independent of play/pause state.
    const lookahead = controllerRef.current.lookaheadSeconds;
    for (const segment of tl.segments) {
      if (segment.startTime > t + lookahead) break;
      if (displayedRef.current.has(segment.segmentId)) continue;
      if (!segment.transcript.trim()) continue;
      if (preparedCacheRef.current.has(segment.segmentId)) continue;
      if (inFlightRef.current.has(segment.segmentId)) continue;
      void ensurePrepared(segment, generation);
    }

    const nextPending = tl.segments.find((s) => !displayedRef.current.has(s.segmentId) && s.transcript.trim());
    const directive = controllerRef.current.evaluate({ nextPendingStartTime: nextPending?.startTime });

    if (directive.shouldPause) {
      if (!audio.paused) {
        audio.pause();
        pausedForLagRef.current = true;
      }
    } else if (pausedForLagRef.current) {
      pausedForLagRef.current = false;
      if (audio.paused && !userPausedRef.current) void audio.play();
    }
    if (Math.abs(audio.playbackRate - directive.targetRate) > 0.01) {
      audio.playbackRate = directive.targetRate;
    }

    // Consumer: display the earliest due segment once it's prepared. If it's
    // due but not yet prepared, ensurePrepared() above (or this call, same
    // dedup) is already working on it — the pause above is what gives it
    // time, and this tick (or the next) will pick it up the moment it
    // resolves, without needing timeupdate to fire again.
    if (!displayingRef.current && nextPending && nextPending.startTime <= t) {
      const cached = preparedCacheRef.current.get(nextPending.segmentId);
      if (cached) {
        displayingRef.current = true;
        displayedRef.current.add(nextPending.segmentId);
        void displaySegment(nextPending, cached, generation).finally(() => {
          displayingRef.current = false;
        });
      } else {
        void ensurePrepared(nextPending, generation);
      }
    }
  }, [ensurePrepared, displaySegment]);

  useEffect(() => {
    if (status !== "ready") return;
    schedulerIntervalRef.current = setInterval(schedulerTick, SCHEDULER_TICK_MS);
    return () => {
      if (schedulerIntervalRef.current) clearInterval(schedulerIntervalRef.current);
      schedulerIntervalRef.current = null;
    };
  }, [status, schedulerTick]);

  /** Cosmetic only now — currentTime is kept in sync by the scheduler tick too, this just makes the scrubber feel responsive during smooth playback. */
  const onTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime);
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      userPausedRef.current = false;
      void audio.play();
    } else {
      userPausedRef.current = true;
      audio.pause();
    }
  }, []);

  const rewind = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    cancelInFlight();
    controllerRef.current.beginSeek();
    const newTime = Math.max(0, audio.currentTime - 10);
    const displayed = controllerRef.current.snapshot().displayedThroughTime;
    controllerRef.current.completeSeek(newTime, displayed);
    audio.currentTime = newTime;
    setCurrentTime(newTime);
  }, [cancelInFlight]);

  const seek = useCallback((fraction: number) => {
    const audio = audioRef.current;
    const tl = timelineRef.current;
    if (!audio || !tl) return;
    const target = fraction * tl.durationSeconds;
    cancelInFlight();
    controllerRef.current.beginSeek();
    preparedCacheRef.current.clear();
    if (target > audio.currentTime) {
      // Forward seek: mark the skipped segments as already-displayed so the
      // scheduler doesn't burst-draw all of them at once — the same
      // "process serially while audio continues freely" failure mode the
      // brief calls out, just triggered by a jump instead of ordinary drift.
      for (const s of tl.segments) {
        if (s.startTime <= target) displayedRef.current.add(s.segmentId);
      }
      controllerRef.current.completeSeek(target, target);
    } else {
      // Backward seek: content already drawn for segments after `target`
      // stays on the canvas (documented limitation — no un-draw), so the
      // displayed-through clock doesn't rewind either, just the audio clock.
      const displayed = controllerRef.current.snapshot().displayedThroughTime;
      controllerRef.current.completeSeek(target, displayed);
    }
    audio.currentTime = target;
    setCurrentTime(target);
    log({ type: "note", text: `audio replay: seeked to ${formatTime(target)}` });
  }, [cancelInFlight, log]);

  const replaySegmentAt = useCallback((segmentId: string) => {
    const tl = timelineRef.current;
    const audio = audioRef.current;
    if (!tl || !audio) return;
    const segment = tl.segments.find((s) => s.segmentId === segmentId);
    if (!segment) return;
    displayedRef.current.delete(segmentId);
    preparedCacheRef.current.delete(segmentId);
    cancelInFlight();
    controllerRef.current.beginSeek();
    controllerRef.current.completeSeek(segment.startTime, segment.startTime);
    audio.currentTime = segment.startTime;
    setCurrentTime(segment.startTime);
  }, [cancelInFlight]);

  /** Replays whichever segment the playhead is currently inside (or the last one it passed), re-running its draw call. */
  const replayCurrentSegment = useCallback(() => {
    const tl = timelineRef.current;
    const audio = audioRef.current;
    if (!tl || !audio) return;
    const current = [...tl.segments]
      .filter((s) => s.startTime <= audio.currentTime)
      .sort((a, b) => b.startTime - a.startTime)[0];
    if (current) replaySegmentAt(current.segmentId);
  }, [replaySegmentAt]);

  const bufferingLabel = snapshot.replayState === "buffering"
    ? "Catching up…"
    : snapshot.replayState === "slowing"
      ? "Slowing to stay in sync…"
      : null;

  return (
    <div className="fixed top-24 right-4 z-40 w-80 rounded-xl border border-white/10 bg-black/85 p-3 text-white/90 shadow-xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-white/60">Audio Replay</span>
        <button onClick={handleClose} className="rounded p-1 hover:bg-white/10" aria-label="Close audio replay">
          <X size={14} />
        </button>
      </div>

      {status === "idle" && (
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-white/20 py-6 text-sm text-white/70 hover:border-white/40">
          <Upload size={16} />
          Upload a lesson recording
          <input
            type="file"
            // Lecture/tutorial recordings are very often video files (a
            // screen recording, a Zoom capture) — the OS file picker must
            // not filter those out just because this looks like an
            // audio-only uploader. lib/audio/types.ts's SUPPORTED_AUDIO_TYPES
            // is the actual source of truth on what's accepted server-side.
            accept="audio/*,video/mp4,video/webm,video/quicktime,video/x-matroska"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
          />
        </label>
      )}

      {status === "uploading" && <p className="py-4 text-center text-sm text-white/60">Transcribing…</p>}
      {status === "preparing" && <p className="py-4 text-center text-sm text-white/60">Preparing visuals…</p>}

      {status === "error" && (
        <div className="space-y-2">
          <p className="text-sm text-red-300">{errorText}</p>
          <button onClick={() => setStatus("idle")} className="text-xs underline text-white/60">Try another file</button>
        </div>
      )}

      {status === "ready" && objectUrl && timeline && (
        <div className="space-y-2">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio
            ref={audioRef}
            src={objectUrl}
            onTimeUpdate={onTimeUpdate}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => controllerRef.current.end()}
            className="hidden"
          />
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={timeline.durationSeconds ? currentTime / timeline.durationSeconds : 0}
            onChange={(e) => seek(Number(e.target.value))}
            className="w-full"
          />
          <div className="flex items-center justify-between text-xs text-white/60">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(timeline.durationSeconds)}</span>
          </div>
          <div className="flex items-center justify-center gap-3">
            <button onClick={rewind} className="rounded-full p-2 hover:bg-white/10" aria-label="Rewind 10 seconds">
              <Rewind size={16} />
            </button>
            <button onClick={togglePlay} className="rounded-full bg-white/10 p-3 hover:bg-white/20" aria-label={playing ? "Pause" : "Play"}>
              {playing ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button onClick={replayCurrentSegment} className="rounded-full p-2 hover:bg-white/10" aria-label="Replay current segment">
              <RotateCcw size={16} />
            </button>
          </div>
          {/* Minimal, non-alarming — a small status word, not a modal or spinner overlay, so a couple seconds of catch-up doesn't read as broken. */}
          <p className="text-center text-[11px] text-white/40" aria-live="polite">
            {bufferingLabel ?? `${timeline.segments.length} segments · canvas stays editable`}
          </p>
        </div>
      )}
    </div>
  );
}
