"use client";

import { Excalidraw } from "@excalidraw/excalidraw";
// Was a global import in app/layout.tsx — ~145KB paid by every page (landing,
// pricing, login, /try's pre-click state) even though only this component
// renders <Excalidraw>. Board is already loaded via next/dynamic (ssr:false),
// so co-locating the CSS here means it loads exactly when this chunk does,
// not before.
import "@excalidraw/excalidraw/index.css";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { track } from "@vercel/analytics";
import { CanvasTopBar } from "@/components/CanvasShell";
import { ControlBar, ErrorBanner } from "@/components/ControlBar";
import type { SaveState } from "@/components/ProductUI";
import { TranscriptStrip } from "@/components/TranscriptStrip";
import { LatencyOverlay } from "@/components/LatencyOverlay";
import { RecordingPanel } from "@/components/RecordingPanel";
import { DevReplayLab } from "@/components/DevReplayLab";
import { useDeepgram, type DeepgramResultTiming } from "@/hooks/useDeepgram";
import { useGeminiLive } from "@/hooks/useGeminiLive";
import { useUsageSession } from "@/hooks/useUsageSession";
import { startListeningSession } from "@/lib/listeningSession";
import { latency, latencyNow, formatLatencySummary, percentile, type LatencySampleEvent } from "@/lib/latency";
import { correlateSamples, isReplayLabEnabled, type DecisionWindow, type ReplayDisconnectPlan, type ReplayExperimentMode, type ReplayPreparedSource, type ReplayRunReport, type ReplayStartOptions } from "@/lib/replayLab";
import type { DemoBoardApi } from "@/lib/demoStudio";
import { buildCorpusEvidence, buildCorpusScene } from "@/lib/corpus";
import { recordLatencySummary, storedLatencySamples } from "@/lib/latencySink";
import { providerRequestHeaders } from "@/lib/usage-client";
import { requestDelayMs, retryAfterMs } from "@/lib/requestScheduling";
import { buildBeat, truncateLabel, type SceneElement } from "@/lib/scene";
import { downloadLog } from "@/lib/sessionLog";
import {
  emptyUndo,
  newId,
  SemanticBoard,
  type Concept,
  type Operation,
  type OperationType,
  type UndoRecord,
} from "@/lib/semantic";
import { loadSession, loadSessionById, makeAutosave, type PersistedSession } from "@/lib/persist";
import { readPreferences } from "@/lib/preferences";
import {
  exportExcalidraw,
  exportPng,
  exportSceneJson,
  exportSvg,
} from "@/lib/exports";
import {
  buildLiveLine,
  buildOp,
  lineStart,
  markKey,
  measureOp,
  newPagePen,
  PAGE_H,
  PAGE_PAD,
  PAGE_W,
  pageOrigin,
  parseLine,
  place,
  parseOp,
  willOverflow,
  LIVE_CAPTION_GAP,
  LIVE_CAPTION_RAIL_W,
  LIVE_CAPTION_SIZE,
  type Mark,
  type Op,
  type Pen,
} from "@/lib/ops";
import {
  decidePageTurn,
  isThoughtComplete,
  suppressPageTurnDuringInitialComposition,
  type PageTurnReason,
} from "@/lib/pagination";
import { correctTranscript, groundedInSource, keyterms } from "@/lib/vocab";
import { sttDebug } from "@/lib/sttDebug";
import {
  MAX_TEMPORARY_SCRIBE_MARKS,
  temporaryMarkBudgetReached,
  withinInitialCompositionWindow,
} from "@/lib/attention";
import {
  EMPTY_PRESENTATION_THOUGHT,
  EMPTY_THOUGHT,
  STRUCTURAL_HOLD_MS,
  earlyVoiceCommand,
  flushPresentationThought,
  flushStructuralThought,
  localVoiceCommand,
  pushPresentationSegment,
  type LocalVoiceCommand,
  type PresentationThoughtState,
  pushStructuralSegment,
  retirePending,
  type StructuralThoughtState,
} from "@/lib/liveSpeech";
import { liveLatencySample, chunkToInkSample, MAX_VALID_LIVE_LAG_MS, type AudioTiming } from "@/lib/telemetry";
import { opacityPulse, runPulse } from "@/lib/pulse";
import {
  CAMERA_RULES,
  READABILITY_CONTRACT,
  effectiveTextSize,
  initialCompositionState,
  liveLineFitsViewport,
  proposeCamera,
  recordingViewport,
  rectUnion,
  stepCameraSpring,
  stepPositionSpring,
  type CameraView,
  type CameraVelocity,
  type CompositionRect,
  type CompositionState,
  type Point2D,
  type ReadabilityRole,
  type TextReadabilitySample,
} from "@/lib/composition";
import {
  CAMERA_PROPOSAL_SNAPSHOT_VERSION,
  type CameraProposalKind,
  type CameraSpringSnapshot,
} from "@/lib/cameraReplay";
import {
  samePageArrivalTransition,
  type PageArrivalIdentity,
  type PendingPageArrivalCamera,
} from "@/lib/pageArrivalCoalescing";
import { features, isLivePresentationV2Enabled, isExpressionEngineV1Enabled, isExpressionDebugOnlyEnabled, isLiveCaptureModeEnabled, isAgentBridgeEnabled } from "@/lib/features";
import { createExcalidrawCanvasRuntime, boundsOf, decideExpressionOverflow, type CanvasRuntime, type OverflowInfo } from "@/lib/canvas";
import { ExpressionLiveController, type ExpressionLiveUpdate } from "@/lib/expression/live";
import { createExpressionEntry, type ExpressionEntry, type ExpressRequest } from "@/lib/expression/entry";
import { createExpressTool, type ExpressTool } from "@/lib/expression/tool";
import { startAgentBridge } from "@/lib/expression/agentBridge";
import { describePatch } from "@/lib/expression/render/core";
import { REGION_BUDGET } from "@/lib/expression/grammars";
import type { ExpressionTrace } from "@/lib/expression/pipeline";
import { LiveCaptureSession, downloadCapture } from "@/lib/expression/capture";
import { resolveSketches, pendingSketchKeys } from "@/lib/expression/draw/client";
import type { Sketch } from "@/lib/expression/draw/schemas";
import { formatTrace } from "@/lib/expression/trace";
import type { SettledThought } from "@/lib/liveSpeech";
import {
  newStoryState,
  restoreStoryState,
  type InPublicMode,
  type StoryState,
} from "@/lib/story";
import type {
  BeatDecision,
  Final,
  LogEvent,
  LogEventInput,
  SceneFrameSummary,
} from "@/lib/types";

const SILENCE_MS = 600;
/**
 * The ceiling on waiting for an unfinished thought to land. People trail off
 * and never finish the sentence; the board cannot wait for a full stop that
 * isn't coming. Long enough to cover a breath mid-clause, short enough that
 * the speaker doesn't notice the board hesitating.
 */
const FRAGMENT_GRACE_MS = 1600;
const MIN_WORDS = 4;
const TOUCH_LOCK_MS = 4000;
/**
 * The live tier gets a shorter, pointer-only lock. It draws far from the
 * cursor and is cheap to undo, and a 4s block on every stray canvas event
 * silently kills the whole effect.
 */
const SKETCH_TOUCH_LOCK_MS = 1500;
/** Keep the beat's view of the transcript recent; stale rambling biases it to skip. */
const MAX_PENDING_WORDS = 120;
const STAGGER_MS = 180;
/** The polished pass replaces something already on screen, so it can move fast. */
const POLISH_STAGGER_MS = 70;
const FADE_MS = 250;
const FADE_STEPS = 5;
/**
 * Scribe cooldown.
 *
 * Was 700ms at launch, then 5250ms — chosen purely to stay under a server
 * limit of 12 calls/minute, and paid for entirely in responsiveness: up to
 * five seconds of silence from the board after a sentence landed.
 *
 * 1200ms is the compromise, and it is only safe because the scheduler is no
 * longer a bare stopwatch. lib/scribeScheduler.ts refuses wake-ups that carry
 * no new drawable content — repeated words, punctuation churn, concepts
 * already on the page — so the *achievable* rate of 50/minute is not the
 * *actual* rate. The server limit moves to 30/minute to match, which still
 * caps a runaway client at well under half of what a naive 1200ms loop could
 * demand.
 */
const SCRIBE_INTERVAL_MS = 1200;
const SCRIBE_RETRY_FALLBACK_MS = 60_000;
const SCRIBE_FAILURE_MESSAGE = "Scribe is failing — still writing, marks are local only.";
/**
 * How long the wrap-up renderer will wait for the sentence in progress to
 * settle before placing a diagram anyway. Long enough to cover an ordinary
 * clause, short enough that continuous speech doesn't block the board.
 */
const LIVE_SETTLE_WAIT_MS = 1500;
/** Hold close on the spoken line, then reveal how it joined the full page. */
const LIVE_CAMERA_OVERVIEW_MS = 1800;
/**
 * Ceiling on how long the live-narration hold can stay engaged, measured
 * from when the hold was first engaged (not re-armed by later interims).
 * Continuous speech re-arms the hold on every interim, which is correct
 * while the speaker's current line is what the camera should show — but
 * without an independent ceiling, a long uninterrupted monologue could keep
 * the hold up indefinitely and strand any diagram that landed during it.
 * Long enough to cover an ordinary sustained thought, short enough that the
 * board periodically reveals what has actually landed on it.
 */
const MAX_LIVE_CAMERA_HOLD_MS = 6000;
const VISUAL_REENTRY_RESULT_TTL_MS = 30_000;
const VISUAL_REENTRY_PENDING_MAX = 3;
/**
 * How long a deliberate user pan/zoom keeps the camera from following up
 * with a routine (non-urgent) reframe. Mirrors the touch-lock pattern
 * already used to protect drawing from a moving cursor: the user gets
 * priority briefly, then the system resumes following genuinely new
 * content. Content that doesn't fit the safe frame at all still moves the
 * camera regardless of this window (see `urgent` in proposeCamera) — this
 * only holds back cosmetic recentering.
 */
const MANUAL_CAMERA_PRIORITY_MS = 4000;
/** Keep each sheet readable. Reaching this limit turns the page; it must never
 * stop the live hand. */
const MAX_MARKS_PER_PAGE = 22;
/**
 * Chrome that floats over the canvas: Excalidraw's toolbar along the top, the
 * control bar along the bottom. The camera has to frame the sheet in the band
 * between them rather than in the window, or the top of every page sits under
 * the toolbar.
 */
/**
 * How a guess looks.
 *
 * Faded, and nothing else — no dashes, no tint, no animation. A speculative
 * mark has to read as "forming" at a glance while the speaker is still
 * talking, and every more assertive treatment tried on paper reads as the
 * interface glitching instead.
 */
const SPECULATIVE_OPACITY = 40;
/**
 * How many unconfirmed guesses may be on screen at once.
 *
 * Each one is settled by the next final, so this bounds a burst rather than a
 * session. Three keeps a wrong guess from ever looking like a mess while
 * leaving room for the common case of a concept, a trend and a count landing
 * inside one sentence.
 */
const MAX_OUTSTANDING_SPECULATIVE = 3;
const DIM_OPACITY = 45;
const CLEAR_OPACITY = 20;
const TRANSCRIPT_WINDOW_MS = 90_000;

/**
 * Director/Choreographer v0 (comparison-only) — see lib/director.ts and
 * lib/choreographerComparison.ts. Kept in one place because they only ever
 * apply together: one concept's rigid move from its original position to its
 * comparison-layout target.
 */
interface ComparisonMove {
  conceptId: string;
  /** The primary node's position before the move — what the layout target was computed relative to. */
  anchorFrom: Point2D;
  anchorTo: Point2D;
  /** Every element belonging to this concept, and where each started, so the group moves rigidly. */
  elementOrigins: Map<string, Point2D>;
}
/**
 * A relationship arrow re-routed to match the concepts' new positions.
 *
 * Patches the EXISTING arrow/label elements in place (same ids, same
 * `startBinding`/`endBinding`) rather than rebuilding them — routing is
 * recomputed against the target rects up front, but nothing is added or
 * removed, so this is exactly as undo-safe as a plain position patch and
 * never has to touch `boundElements`.
 */
interface ComparisonReroute {
  relationshipId: string;
  arrowElementId: string;
  arrowFields: Partial<SceneElement>;
  extraPatches: { id: string; fields: Partial<SceneElement> }[];
}
/** How long a comparison move takes to settle — subtle, not flashy (Part 7 of the brief). */
const COMPARISON_SPRING_FREQUENCY = 9;

/**
 * Which path the voice takes to the page.
 *
 *   deepgram : mic -> Deepgram -> settled thoughts -> Expression Engine
 *   gemini   : mic -> Gemini Live -> draw() tool calls -> ops (dormant exception)
 *
 * Both eventually apply their element scene through the Canvas boundary.
 * Only the default Deepgram path follows Meaning -> WorldState -> planning.
 */
const ENGINE = (process.env.NEXT_PUBLIC_ENGINE ?? "deepgram") as
  | "deepgram"
  | "gemini";


const isDev = process.env.NODE_ENV === "development";
/** Persists the dev latency panel's opt-in across reloads. Dev-only; see its useState below. */
const LATENCY_OVERLAY_KEY = "inpublic:latency-overlay";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Has the pen been moved by someone other than us since we last looked? */
function samePen(a: Pen, b: Pen): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.lineH === b.lineH &&
    a.originX === b.originX &&
    a.originY === b.originY
  );
}

function patch(el: SceneElement, fields: Partial<SceneElement>): SceneElement {
  return {
    ...el,
    ...fields,
    version: ((el.version as number) ?? 1) + 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
  };
}

interface FrameRecord {
  id: string;
  label: string;
  nodes: string[];
}

interface PendingRender {
  mermaid: string;
  focus: string;
}

/**
 * `initialMode` is the dashboard asking for a specific mode, and
 * `initialSessionId` is it asking to reopen one particular saved session.
 * With neither, the board behaves exactly as before: standard mode, restoring
 * whatever the last "current" autosave held.
 */
export default function Board({
  initialMode,
  initialSessionId,
  startFresh,
  guest,
  demoStudio,
}: {
  initialMode?: InPublicMode;
  initialSessionId?: string;
  /** Skip the restore entirely — the dashboard asked for a blank canvas. */
  startFresh?: boolean;
  /**
   * Anonymous /try visitor: no auth, no usage_sessions row, no /dashboard to
   * return to. Everything else about the engine (Deepgram/Gemini pipeline,
   * Excalidraw, camera and IndexedDB persistence) is identical to the
   * authenticated path. The flag also prevents protected background writes:
   * anonymous sessions have no cloud project or authenticated telemetry row,
   * so sending those requests would make a guaranteed 401 normal control
   * flow. It additionally changes usage-session accounting
   * (useUsageSession's `anonymous` mode) and where "Finish" sends the visitor.
   */
  guest?: boolean;
  /** Internal, development-only capture shell. Disables persistence and product chrome. */
  demoStudio?: boolean;
} = {}) {
  const router = useRouter();
  const [recordingTarget, setRecordingTarget] = useState<HTMLDivElement | null>(null);
  const [canvasRuntime] = useState<CanvasRuntime>(createExcalidrawCanvasRuntime);

  const [interim, setInterim] = useState("");
  // Settings offers "show transcript by default"; this is where it lands.
  const [showTranscript, setShowTranscript] = useState(() => readPreferences().showTranscriptByDefault);
  /**
   * The dev latency panel is opt-in rather than always-on.
   *
   * It was never shown to real users (the NODE_ENV gate at its render site
   * still stands), but it sat over the canvas for every development session
   * whether or not anyone was measuring anything — including while working on
   * unrelated UI. Toggle it from the console with `inpublic.latencyOverlay()`
   * / `inpublic.latencyOverlay(false)`; the choice persists across reloads,
   * which is the point when an investigation spans several of them.
   *
   * Safe to read localStorage during the initial render: Board is only ever
   * mounted through next/dynamic with ssr:false, so there is no server render
   * for this to disagree with.
   */
  const [showLatencyOverlay, setShowLatencyOverlay] = useState(() => {
    if (!isDev || typeof window === "undefined") return false;
    try { return window.localStorage.getItem(LATENCY_OVERLAY_KEY) === "1"; } catch { return false; }
  });
  const [busy, setBusy] = useState(false);
  /** True between expression/submitted and the matching updated|noop|failed. */
  const [expressionPending, setExpressionPending] = useState(false);
  const [recordingFocus, setRecordingFocus] = useState(false);
  const [sessionTitle, setSessionTitle] = useState("Untitled visual session");
  const sessionTitleRef = useRef("Untitled visual session");
  const [saveStatus, setSaveStatus] = useState<SaveState>("saved");
  const [mode, setMode] = useState<InPublicMode>(initialMode ?? "standard");
  const modeRef = useRef<InPublicMode>(initialMode ?? "standard");
  const sessionIdRef = useRef(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `session-${Date.now()}`,
  );

  // ---- session clock -------------------------------------------------------
  const t0Ref = useRef<number | null>(null);
  const now = useCallback(
    () => (t0Ref.current === null ? 0 : Date.now() - t0Ref.current),
    [],
  );

  // ---- log -----------------------------------------------------------------
  const logRef = useRef<LogEvent[]>([]);
  const replayModeRef = useRef<ReplayExperimentMode | null>(null);
  const replayDecisionWindowsRef = useRef<DecisionWindow[]>([]);
  const replayDecisionOpenRef = useRef<Map<string, DecisionWindow>>(new Map());
  const replayMaxConcurrencyRef = useRef(0);
  const log = useCallback(
    (event: LogEventInput) => {
      logRef.current.push({ ...event, t: now() } as LogEvent);
      if (replayModeRef.current && event.type === "visual-reentry") {
        const id = event.thoughtId ?? "unknown";
        if (event.event === "fast-path-attempted") {
          const window = { start: performance.now() };
          replayDecisionOpenRef.current.set(id, window);
          replayDecisionWindowsRef.current.push(window);
          replayMaxConcurrencyRef.current = Math.max(replayMaxConcurrencyRef.current, replayDecisionOpenRef.current.size);
        } else if (event.event === "decision-none" || event.event === "decision-cause-effect" || event.event === "request-aborted") {
          const window = replayDecisionOpenRef.current.get(id);
          if (window) window.end = performance.now();
          replayDecisionOpenRef.current.delete(id);
        }
      }
    },
    [now],
  );

  // ---- transcript buffers --------------------------------------------------
  const finalsRef = useRef<Final[]>([]);
  const pendingTextRef = useRef("");
  /** Gemini engine: transcript accumulating for the current utterance. */
  const liveUtteranceRef = useRef("");

  // ---- scene ---------------------------------------------------------------
  const elementsRef = useRef<SceneElement[]>([]);
  const framesRef = useRef<FrameRecord[]>([]);
  const slotRef = useRef(0);
  const lastDrawnAtRef = useRef<number>(Date.now());
  // Excalidraw fires onChange several times while it mounts and restores its
  // scene. Without this window those count as "I touched the canvas" and cost
  // the first beat a full touch-lock delay.
  const suppressChangeUntilRef = useRef(Date.now() + 2000);
  const lastUserInputRef = useRef(0);
  // Anonymous-funnel timing: set when a guest's listening session actually
  // starts (see toggle()'s usage.start() call below), read here so the very
  // first non-empty commit can report how long that took. Never touched for
  // an authenticated session.
  const visualSessionStartedAtRef = useRef<number | null>(null);
  const firstVisualFiredRef = useRef(false);

  const commit = useCallback(() => {
    suppressChangeUntilRef.current = Date.now() + 150;
    canvasRuntime.applyElements(elementsRef.current);
    autosaveRef.current?.schedule();
    if (guest && !firstVisualFiredRef.current && visualSessionStartedAtRef.current && elementsRef.current.length > 0) {
      firstVisualFiredRef.current = true;
      const ms = Date.now() - visualSessionStartedAtRef.current;
      track("first_visual_rendered", { ms });
      track("time_to_first_visual", { ms });
    }
  }, [canvasRuntime, guest]);

  // ---- the semantic board --------------------------------------------------
  /**
   * What the talk is ABOUT, as opposed to what is drawn. Concepts,
   * relationships and sections live here; `elementsRef` is only their picture.
   * Every structural change is recorded as an Operation so undo can reverse
   * exactly one of them.
   */
  const boardRef = useRef<SemanticBoard>(new SemanticBoard());
  /** conceptId of the equation/step currently being worked on in math mode, if any. */
  const activeMathConceptIdRef = useRef<string | null>(null);
  /** conceptId -> element ids of its current long_multiplication visual, so a redraw can replace rather than pile on top of the previous one. */
  const mathVisualElementIdsRef = useRef<Map<string, string[]>>(new Map());
  const storyRef = useRef<StoryState>(newStoryState());
  const compositionRef = useRef<CompositionState>(initialCompositionState());
  const compositionHistoryRef = useRef<CompositionState[]>([]);
  const cameraMotionRef = useRef<{
    camera: CameraView;
    target: CameraView;
    velocity: CameraVelocity;
    lastFrameAt: number;
    reason: string;
    animationId: string;
    proposalId?: string;
    transitionId?: string;
    rafId: number;
  } | null>(null);
  const cameraProposalSequenceRef = useRef(0);
  const cameraAnimationSequenceRef = useRef(0);
  const cameraPageGenerationRef = useRef(0);
  const cameraEventCycleSequenceRef = useRef(0);
  const pendingPageArrivalTransitionRef = useRef<PageArrivalIdentity | null>(null);
  const pendingPageArrivalCameraRef = useRef<PendingPageArrivalCamera | null>(null);
  const liveCameraHoldRef = useRef(false);
  /** When the hold was last (re)asserted — see the staleness check in framePage. */
  const liveCameraHoldSetAtRef = useRef(0);
  /** When the hold was first engaged this streak — see MAX_LIVE_CAMERA_HOLD_MS. */
  const liveCameraHoldStartedAtRef = useRef(0);
  const liveCameraOverviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The single owner of "a reframe is owed but currently can't run."
   *
   * framePage's hold/in-flight guards used to `return` and forget — the
   * request that triggered the call (a diagram landing, an Artist batch
   * committing) simply vanished if the guard was up at that instant. That is
   * the camera's actual failure mode: not wrong math, a dropped request with
   * no memory that it happened. This ref is that memory. Only ever holds one
   * entry — the newest request coalesces over any older one, matching "the
   * latest active visual context wins" for rapid generation — and is
   * replayed by releasePendingReframe() the moment the guard that blocked it
   * clears (hold released, spring settled), never left to a fixed timer.
   */
  const pendingReframeRef = useRef<{
    reason: string;
    mathFocalConceptId: string | null;
    liveFocalElementId: string | null;
    allowFullZoomChange: boolean;
  } | null>(null);
  /** framePage is defined after animateCamera; tied together the same way turnPage/writeLive is. */
  const releasePendingReframeRef = useRef<(() => void) | null>(null);
  useEffect(() => () => {
    if (liveCameraOverviewTimerRef.current) clearTimeout(liveCameraOverviewTimerRef.current);
    if (cameraMotionRef.current) cancelAnimationFrame(cameraMotionRef.current.rafId);
    if (conceptMotionRef.current) cancelAnimationFrame(conceptMotionRef.current.rafId);
  }, []);
  /**
   * The comparison/process choreography currently in flight, if any. Only
   * one at a time — starting a new one supersedes whatever was still moving,
   * regardless of which structure kind it belongs to.
   */
  const conceptMotionRef = useRef<{
    epoch: number;
    structureKind: "comparison" | "process";
    conceptIds: string[];
    runtime: { move: ComparisonMove; current: Point2D; velocity: Point2D }[];
    rerouted: ComparisonReroute[];
    lastFrameAt: number;
    rafId: number;
  } | null>(null);
  /**
   * Bumped whenever an in-flight comparison/process move must stop touching
   * elements — undo, clear, a page turn, a superseding move, a deleted
   * concept. Same idiom as `liveSeqRef`/`streamEpoch`: capture, recheck every
   * frame, treat a mismatch as stale and drop the frame rather than apply it.
   */
  const comparisonEpochRef = useRef(0);
  const autosaveRef = useRef<ReturnType<typeof makeAutosave> | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  /**
   * The correction vocabulary, cached.
   *
   * Interims arrive several times a second and correction runs on every one of
   * them, so rebuilding the term list per interim would put a map-walk of the
   * whole board on the one path that must never do work. It changes only when
   * something lands on the canvas, so it is refreshed there instead.
   */
  const activeTermsRef = useRef<string[]>([]);
  const refreshTermsRef = useRef<(() => void) | null>(null);

  /** Element ids by concept, so an arrow can find its endpoints later. */
  const conceptElementRef = useRef<Map<string, string>>(new Map());
  /**
   * Which page each concept was drawn on. Reference-and-return needs this to
   * know where "going back to Airline" is asking the camera to go.
   */
  const conceptPageRef = useRef<Map<string, number>>(new Map());

  const findElement = useCallback(
    (id: string) => elementsRef.current.find((el) => el.id === id) ?? null,
    [],
  );

  /**
   * Record one reversible change.
   *
   * The undo record captures whole elements rather than diffs — a board is
   * small, and being able to put back exactly what was there matters more than
   * bytes. `sketchRef.ids` used to serve as the undo unit, which is why undo
   * wiped the page: it is a list of everything on the sheet, not of one thought.
   */
  const recordOperation = useCallback(
    (
      type: OperationType,
      undo: UndoRecord,
      meta: { sourceText?: string; confidence?: number; conceptIds?: string[] } = {},
    ): Operation => {
      const op: Operation = {
        operationId: newId("op"),
        type,
        timestamp: now(),
        sourceText: meta.sourceText ?? "",
        confidence: meta.confidence ?? 1,
        conceptIds: meta.conceptIds ?? [],
        elementIds: undo.addedElementIds,
        undo,
        compositionBefore: {
          ...compositionRef.current,
          camera: { ...compositionRef.current.camera },
          proposedTarget: compositionRef.current.proposedTarget ? { ...compositionRef.current.proposedTarget } : undefined,
        },
      };
      boardRef.current.push(op);
      return op;
    },
    [now],
  );

  /** Reverse exactly one operation. Never touches anything else on the page. */
  const revertOperation = useCallback(
    (op: Operation) => {
      const board = boardRef.current;
      const u = op.undo;

      // Elements this operation added.
      if (u.addedElementIds.length) {
        const drop = new Set(u.addedElementIds);
        elementsRef.current = elementsRef.current.filter(
          (el) => !drop.has(el.id) && !drop.has((el.containerId as string) ?? ""),
        );
      }
      // Elements it removed.
      if (u.removedElements.length) {
        elementsRef.current = [...elementsRef.current, ...u.removedElements];
      }
      // Elements it modified.
      for (const patchRec of u.elementPatches) {
        const index = elementsRef.current.findIndex((e) => e.id === patchRec.id);
        if (index >= 0) {
          elementsRef.current = elementsRef.current.map((e, i) =>
            i === index ? patch(e, patchRec.before as Partial<SceneElement>) : e,
          );
        }
      }

      for (const id of u.addedConceptIds) {
        board.concepts.delete(id);
        conceptElementRef.current.delete(id);
      }
      for (const id of u.addedRelationshipIds) board.relationships.delete(id);
      for (const id of u.addedSectionIds) board.sections.delete(id);
      for (const key of u.addedMarkKeys ?? []) {
        marksRef.current.delete(key);
        renderedMarkKeysRef.current.delete(key);
        sketchRef.current.concepts.delete(key);
        sketchRef.current.labels = sketchRef.current.labels.filter((label) => label !== key);
      }
      for (const key of u.addedDecorationKeys ?? []) decorationsRef.current.delete(key);
      if ((u.addedMarkKeys?.length ?? 0) > 0 || op.type === "scribe_mark") {
        const removed = new Set(u.addedElementIds);
        sketchRef.current.ids = sketchRef.current.ids.filter((id) => !removed.has(id));
        sketchRef.current.count = Math.max(0, sketchRef.current.count - 1);
      }
      for (const c of u.removedConcepts) board.concepts.set(c.conceptId, c);
      for (const r of u.removedRelationships) {
        board.relationships.set(r.relationshipId, r);
      }
      if (u.previousActiveSectionId) {
        board.activeSectionId = u.previousActiveSectionId;
      }

      commit();
    },
    [commit],
  );

  /** Focus strings for draws decided but not yet rendered. */
  const queuedDrawsRef = useRef<string[]>([]);

  const sceneSummary = useCallback(
    (): SceneFrameSummary[] => [
      ...framesRef.current.map((f) => ({
        frameId: f.id,
        label: f.label,
        nodes: f.nodes,
      })),
      // A draw takes seconds to render. Without showing it here, the next beat
      // sees a board that doesn't contain it yet and orders it again.
      ...queuedDrawsRef.current.map((focus) => ({
        frameId: "queued",
        label: focus,
        nodes: [],
      })),
    ],
    [],
  );

  /** Cancels the beat->artist chain when it is about to become irrelevant. */
  const aiAbortRef = useRef<AbortController | null>(null);
  /** Cancels an in-flight Scribe call. */
  const scribeAbortRef = useRef<AbortController | null>(null);
  const thoughtInkRef = useRef(new Map<string, { ids: string[]; base: Pen; after: Pen; page: number }>());
  /** Set once applyExpressionUpdate is defined below; the controller is created once and must call whatever the latest version of that callback is. */
  const applyExpressionUpdateRef = useRef<((update: ExpressionLiveUpdate) => void) | null>(null);
  const expressionControllerRef = useRef<ExpressionLiveController | undefined>(undefined);
  /**
   * The agent entry point (lib/expression/entry.ts), over the SAME controller
   * the microphone drives — so an agent's sentence and a spoken one land in
   * one conversation against one world, in whatever order they arrive.
   */
  const expressionEntryRef = useRef<ExpressionEntry | undefined>(undefined);
  /**
   * The same entry point, published as a TOOL (lib/expression/tool.ts): a
   * name, an input schema and a JSON-in/JSON-out handler, so an external
   * agent can reach it over a wire. One tool per board, over the one entry,
   * over the one controller — every agent that connects is talking into this
   * session's world rather than forking a private one.
   */
  const expressionToolRef = useRef<ExpressTool | undefined>(undefined);
  /**
   * ?capture=1 (isLiveCaptureModeEnabled): buffers every ExpressionTrace this
   * session produces so it can be downloaded and deterministically replayed
   * offline (scripts/expression-live-replay.mjs). A developer evaluation
   * tool — see lib/expression/capture.ts. Undefined when capture mode is
   * off, so nothing is buffered and nothing changes for a normal session.
   */
  const captureSessionRef = useRef<LiveCaptureSession | undefined>(isLiveCaptureModeEnabled() ? new LiveCaptureSession() : undefined);
  /**
   * The Drawing Agent's strokes, keyed by sketchKey, for the whole session.
   * Lives here rather than inside resolveSketches so a concept drawn once is
   * never re-fetched when a later sentence brings it back on screen.
   */
  const expressionSketchCacheRef = useRef<Map<string, Sketch>>(new Map());
  /**
   * Which expression run is the current one, monotonically.
   *
   * The two-phase render (applyExpressionUpdate) commits structure first and
   * lets the Drawing Agent's strokes land in a second, detached commit. The
   * live controller does not await onUpdate, so a newer run can start and
   * finish while an older run's sketches are still in flight — this is the
   * seq that late commit compares against before touching the sheet.
   */
  const expressionRunSeqRef = useRef(0);
  /** Instrumentation for the expression engine's own automatic page turns — see applyExpressionUpdate's onOverflow. */
  const lastExpressionPageTurnAtRef = useRef<number | null>(null);
  const lastExpressionTopicRef = useRef<string | undefined>(undefined);
  const expressionPendingIdsRef = useRef(new Set<string>());
  const expressionSubmittedAtRef = useRef(new Map<string, number>());
  /** Right-rail cursor for live captions when the expression engine owns the centre. */
  const captionCursorRef = useRef<{ page: number; y: number } | null>(null);
  const expressionHasInkRef = useRef(false);
  const settleExpressionPendingRef = useRef<(consumedIds: string[]) => void>(() => {});
  const latencyFromSubmitted = (consumedIds: string[]): number | undefined => {
    let earliest = Infinity;
    for (const id of consumedIds) {
      const at = expressionSubmittedAtRef.current.get(id);
      if (at !== undefined && at < earliest) earliest = at;
    }
    if (!Number.isFinite(earliest)) return undefined;
    return Date.now() - earliest;
  };
  if (expressionControllerRef.current === undefined) {
    expressionControllerRef.current = new ExpressionLiveController({
      // Stage-1 identity (no extra model): "the rebuild" and "full rebuild"
      // stay one entity. The judge stays the abstain default so this does
      // not add a round-trip on the live path.
      enableIdentityLayer: true,
      // The anticipation pass, behind its own flag (lib/features.ts). 0 is
      // "never run", so flipping the flag off removes the extra extraction
      // calls entirely rather than merely ignoring their results.
      anticipateMs: features.expressionAnticipation ? undefined : 0,
      onUpdate: (update) => applyExpressionUpdateRef.current?.(update),
      // A run that produced no picture and a run that threw both used to end
      // in silence, indistinguishable from the engine never having started.
      // The session log now carries the outcome of every run.
      onNoChange: (trace, consumedIds) => {
        settleExpressionPendingRef.current(consumedIds);
        log({
          type: "expression",
          event: "noop",
          intent: trace.intent.primary,
          grammar: trace.plan.grammar,
          reason: trace.plan.reason,
          interpretation: trace.world.interpretation,
          settledToUpdatedMs: latencyFromSubmitted(consumedIds),
        });
      },
      onError: (error, consumedIds) => {
        settleExpressionPendingRef.current(consumedIds);
        log({
          type: "expression",
          event: "failed",
          detail: error instanceof Error ? error.message : String(error),
          thoughtId: consumedIds.join(","),
          settledToUpdatedMs: latencyFromSubmitted(consumedIds),
        });
      },
      onTrace:
        process.env.NODE_ENV !== "production"
          ? (trace) => {
              // Every stage of the run, inspectable after the fact from the
              // devtools console rather than only in scrollback — the same
              // visibility /dev/express gives, for the live path. Which layer
              // failed is the only question worth asking when a picture is
              // wrong, and the canvas alone cannot answer it.
              console.debug("[expression]", trace.intent.primary, trace.plan.grammar, trace);
              const w = window as unknown as { __expression?: ExpressionTrace; __expressionHistory?: ExpressionTrace[] };
              w.__expression = trace;
              w.__expressionHistory = [...(w.__expressionHistory ?? []), trace];
              captureSessionRef.current?.recordTurn(trace);
            }
          : undefined,
    });
    expressionEntryRef.current = createExpressionEntry(expressionControllerRef.current, {
      // The same Phase 0 event a settled thought writes, from the same place
      // in the run: an agent turn has to be findable in the session log
      // exactly where a spoken one is, or the log stops describing the
      // session. Every later event (updated / noop / failed / rendered) is
      // already written by the controller's own callbacks above, which do
      // not care who submitted.
      onSubmit: ({ id, text, structured }) =>
        log({
          type: "expression",
          event: "submitted",
          thoughtId: id,
          text: structured ? `${text} [structured meaning]` : text,
        }),
    });
    expressionToolRef.current = createExpressTool(expressionEntryRef.current);
  }

  /**
   * The board as meaning, for the models. Positions come from the concept's
   * drawn node so the artist knows roughly where things sit — it still may not
   * emit coordinates, but it can avoid asking for an arrow across the sheet.
   */
  const semanticScene = useCallback(() => {
    const positions = new Map<string, { x: number; y: number }>();
    for (const [conceptId, elementId] of conceptElementRef.current) {
      const el = elementsRef.current.find((e) => e.id === elementId);
      if (el) positions.set(conceptId, { x: el.x, y: el.y });
    }
    return boardRef.current.scene({
      currentPage: pageRef.current,
      recentTranscript: pendingTextRef.current,
      positions,
    });
  }, []);

  const recentTranscript = useCallback(() => {
    const cutoff = now() - TRANSCRIPT_WINDOW_MS;
    return finalsRef.current
      .filter((f) => f.tEnd >= cutoff)
      .map((f) => f.text)
      .join(" ")
      .trim();
  }, [now]);

  // ---- touch lock ----------------------------------------------------------
  // Two signals. Pointer input is unambiguous. Excalidraw's onChange also
  // fires for camera animations and internal churn, so it gates the heavy
  // renderer but must not gate the live tier.
  const lastPointerInputRef = useRef(0);

  const markPointerInput = useCallback(() => {
    lastPointerInputRef.current = Date.now();
    lastUserInputRef.current = Date.now();
  }, []);

  const markUserInput = useCallback(() => {
    lastUserInputRef.current = Date.now();
  }, []);

  const waitForIdleHands = useCallback(async () => {
    for (;;) {
      const idleFor = Date.now() - lastUserInputRef.current;
      if (idleFor >= TOUCH_LOCK_MS) return;
      await sleep(TOUCH_LOCK_MS - idleFor);
    }
  }, []);

  // ---- the live page -------------------------------------------------------
  // Everything the Scribe letters while you are still talking. Marks flow
  // through one pen so heterogeneous ops — a title, a note, an icon — compose
  // instead of tiling into a grid.
  const sketchRef = useRef({
    ids: [] as string[],
    concepts: new Set<string>(),
    labels: [] as string[],
    gestures: new Set<string>(),
    count: 0,
  });
  const pageRef = useRef(0);
  /** Resolves once the hand-drawn face is available for measurement. */
  const fontsReadyRef = useRef<Promise<unknown>>(Promise.resolve());
  const penRef = useRef<Pen>(newPagePen(0));
  /**
   * Where the pen was left on each page, and what was lettered there.
   *
   * A single pen was fine while pages were strictly forward-only. Going back
   * to an earlier page to add a reference needs that page's pen to resume
   * below what is already on it, not at the top — otherwise the addition lands
   * on top of the notes it is annotating.
   */
  const pagePensRef = useRef<Map<number, Pen>>(new Map());
  const pageMarksRef = useRef<Map<number, Map<string, Mark>>>(new Map());
  const marksRef = useRef<Map<string, Mark>>(new Map());
  const renderedMarkKeysRef = useRef<Set<string>>(new Set());
  /** Decorations do not create marks, so they need their own hard dedupe. */
  const decorationsRef = useRef<Set<string>>(new Set());
  const sketchBusyRef = useRef(false);
  const sketchPannedRef = useRef(false);

  /**
   * The utterance being spoken right now, already on the sheet. `ids` is what
   * the last interim rendered, so the next one can swap it out instead of
   * stacking a copy per partial.
   */
  const liveRef = useRef<{
    /**
     * Stable for the whole utterance. Excalidraw honours a supplied id, so the
     * sentence keeps its identity across every interim instead of being
     * replaced ~5x/second — which used to destroy any selection or edit the
     * moment the next partial arrived.
     */
    elementId: string;
    ids: string[];
    /** Pen as it stood before this sentence reserved its row. */
    base: Pen;
    /**
     * Pen as we left it after reserving. If it no longer matches, something
     * else drew while you were still talking — the Scribe finishing a call, or
     * a wrap-up diagram landing — and the row we were growing into is no
     * longer ours to rewind into.
     */
    after: Pen;
  } | null>(null);
  /**
   * Every element the live line has ever settled into.
   *
   * Used only for routing: these rows span the sheet and have to be treated as
   * soft obstacles, or no arrow can ever get past them.
   */
  const liveLineIdsRef = useRef<Set<string>>(new Set());
  /** Interims arrive faster than a build completes; only the newest may land. */
  const liveSeqRef = useRef(0);
  /**
   * Per-interim timings for the sentence in progress, summarised into one
   * `live` event when it settles. Logging every partial would bury a 30-minute
   * session under ten thousand entries and tell you nothing a median wouldn't.
   */
  const liveLagRef = useRef<{ lag: number[]; render: number[]; paint: number[]; finalLag?: number; streamEpoch: number; invalid: number }>({
    lag: [],
    render: [],
    paint: [],
    streamEpoch: 0,
    invalid: 0,
  });
  const settledLiveRef = useRef<{ ids: string[]; base: Pen; after: Pen } | null>(null);
  /**
   * Live Speech Presentation V2 (features.livePresentationV2). Resolved once
   * per mount — the dev-only `?v2=1` override is a URL, not live state, so
   * there is nothing to react to after the page has loaded.
   */
  const v2Enabled = useMemo(() => isLivePresentationV2Enabled(), []);
  /**
   * Visual Re-entry V1 (features.visualReentryV1) — downstream of V2's
   * settled-thought output only; see docs/VISUAL-REENTRY-V1.md. Resolved
   * once per mount, same reasoning as v2Enabled above.
   */
  /** Expression Engine V1 (features.expressionEngineV1). Mutually exclusive with meEnabled — the flag resolver enforces it, so both can be read here without a guard. */
  const xeEnabled = useMemo(() => isExpressionEngineV1Enabled(), []);
  const xeDebugOnly = useMemo(() => isExpressionDebugOnlyEnabled(), []);
  const xeCaptureEnabled = useMemo(() => isLiveCaptureModeEnabled(), []);
  /** `?agent=1` (dev only): connect this session's express_meaning tool to the local agent bridge. See the effect below. */
  const xeAgentBridgeEnabled = useMemo(() => isAgentBridgeEnabled(), []);
  const replayLabEnabled = useMemo(() => isDev && (demoStudio || isReplayLabEnabled(window.location.search)), [demoStudio]);
  /**
   * The thought currently being held open across Deepgram finals, under V2
   * only. `pushStructuralSegment`/`flushStructuralThought` (lib/liveSpeech.ts)
   * are the exact same deterministic, model-free merge Story Mode already
   * uses to decide "is this one thought or two" — reused here, unchanged, to
   * decide whether the next final continues the current visual block or
   * starts a new one. Empty text means no thought is currently held open.
   */
  const v2ThoughtRef = useRef<PresentationThoughtState>(EMPTY_PRESENTATION_THOUGHT);
  const v2ThoughtStreamEpochRef = useRef(0);
  const v2ThoughtSourceRegionRef = useRef<{ audioStartMs: number; audioEndMs: number } | null>(null);
  /**
   * Where the most recent transcript ended on Deepgram's audio timeline.
   *
   * Every tier's "speech → visual" number is measured against this, so the
   * live line, the speculative mark, the Scribe mark and the structural
   * diagram are all quoted on one clock and can be compared to each other
   * without adjustment. Zero until the first transcript arrives, which is why
   * every reader below guards on it.
   */
  const lastAudioEndMsRef = useRef(0);

  /** speech → visual for a tier, or nothing if there is no anchor yet. */
  const noteTierLatency = useCallback(
    (key: "speech_to_speculative" | "speech_to_scribe" | "speech_to_structure") => {
      const anchor = lastAudioEndMsRef.current;
      if (!anchor) return;
      const elapsed = now() - anchor;
      // Guard against an anchor from a previous socket epoch, which would
      // report a wildly inflated number for the same reason the live-line
      // meter used to (see useDeepgram's audioEpochRef).
      if (elapsed < 0 || elapsed > MAX_VALID_LIVE_LAG_MS) return;
      latency.observe(key, Math.round(elapsed));
    },
    [now],
  );

  /** Drop the half-written sentence. Returns the ids it removed. */
  const dropLiveLine = useCallback(() => {
    if (!liveRef.current) return;
    const current = liveRef.current;
    const drop = new Set(current.ids);
    elementsRef.current = elementsRef.current.filter((el) => !drop.has(el.id));
    if (samePen(penRef.current, current.after)) penRef.current = { ...current.base };
    liveRef.current = null;
  }, []);

  const clearSketch = useCallback(() => {
    penRef.current = newPagePen(pageRef.current);
    marksRef.current = new Map();
    renderedMarkKeysRef.current.clear();
    decorationsRef.current.clear();
    dropLiveLine();

    if (sketchRef.current.ids.length === 0) {
      sketchRef.current.concepts.clear();
      sketchRef.current.gestures.clear();
      sketchRef.current.labels = [];
      sketchRef.current.count = 0;
      sketchPannedRef.current = false;
      return;
    }
    const drop = new Set(sketchRef.current.ids);
    elementsRef.current = elementsRef.current.filter(
      (el) => !drop.has(el.id) && !drop.has((el.containerId as string) ?? ""),
    );
    sketchRef.current = {
      ids: [],
      concepts: new Set(),
      labels: [],
      gestures: new Set(),
      count: 0,
    };
    sketchPannedRef.current = false;
    commit();
  }, [commit, dropLiveLine]);

  /**
   * Frame the whole sheet, once per page. The page is sized so the pen never
   * leaves the shot — which means the camera holds perfectly still while you
   * talk, and only moves when the page actually turns.
   */
  const animateCamera = useCallback((
    target: CameraView,
    reason: string,
    metadata: { animationId?: string; proposalId?: string; transitionId?: string } = {},
  ) => {
    const app = canvasRuntime.readViewport();
    if (!app) return;
    const from: CameraView = {
      scrollX: Number(app.scrollX ?? 0),
      scrollY: Number(app.scrollY ?? 0),
      zoom: app.zoom,
    };
    const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const existing = cameraMotionRef.current;
    const animationId = metadata.animationId ?? `camera-animation-${++cameraAnimationSequenceRef.current}`;
    const isAtTarget = Math.abs(from.scrollX - target.scrollX) < 0.5
      && Math.abs(from.scrollY - target.scrollY) < 0.5
      && Math.abs(from.zoom - target.zoom) < 0.001;
    if (isAtTarget && !existing) {
      compositionRef.current = { ...compositionRef.current, camera: target, proposedTarget: undefined, movementReason: undefined };
      releasePendingReframeRef.current?.();
      return;
    }
    if (reduced) {
      if (cameraMotionRef.current) cancelAnimationFrame(cameraMotionRef.current.rafId);
      cameraMotionRef.current = null;
      log({ type: "camera", event: "started", target, reason, animationId, proposalId: metadata.proposalId, transitionId: metadata.transitionId });
      canvasRuntime.applyViewport(target);
      compositionRef.current = { ...compositionRef.current, camera: target, proposedTarget: undefined, movementReason: undefined };
      log({ type: "camera", event: "completed", target, reason, animationId, proposalId: metadata.proposalId, transitionId: metadata.transitionId });
      releasePendingReframeRef.current?.();
      return;
    }

    if (existing) {
      log({
        type: "camera",
        event: "cancelled",
        target: existing.target,
        reason: existing.reason,
        animationId: existing.animationId,
        proposalId: existing.proposalId,
        transitionId: existing.transitionId,
        replacementAnimationId: animationId,
      });
      existing.target = target;
      existing.reason = reason;
      existing.animationId = animationId;
      existing.proposalId = metadata.proposalId;
      existing.transitionId = metadata.transitionId;
      log({ type: "camera", event: "started", target, reason, animationId, proposalId: metadata.proposalId, transitionId: metadata.transitionId });
      return;
    }

    log({ type: "camera", event: "started", target, reason, animationId, proposalId: metadata.proposalId, transitionId: metadata.transitionId });
    const frame = (time: number) => {
      const motion = cameraMotionRef.current;
      if (!motion) return;
      const next = stepCameraSpring(motion.camera, motion.target, motion.velocity, time - motion.lastFrameAt);
      motion.camera = next.camera;
      motion.velocity = next.velocity;
      motion.lastFrameAt = time;
      canvasRuntime.applyViewport(next.camera);
      const settled = Math.abs(next.camera.scrollX - motion.target.scrollX) < 0.35
        && Math.abs(next.camera.scrollY - motion.target.scrollY) < 0.35
        && Math.abs(next.camera.zoom - motion.target.zoom) < 0.0007
        && Math.abs(next.velocity.scrollX) < 2
        && Math.abs(next.velocity.scrollY) < 2
        && Math.abs(next.velocity.zoom) < 0.004;
      if (!settled) {
        motion.rafId = requestAnimationFrame(frame);
        return;
      }
      const completedTarget = motion.target;
      const completedReason = motion.reason;
      canvasRuntime.applyViewport(completedTarget);
      cameraMotionRef.current = null;
      compositionRef.current = { ...compositionRef.current, camera: completedTarget, proposedTarget: undefined, movementReason: undefined };
      log({
        type: "camera",
        event: "completed",
        target: completedTarget,
        reason: completedReason,
        animationId: motion.animationId,
        proposalId: motion.proposalId,
        transitionId: motion.transitionId,
      });
      // Now that this move has actually finished (not merely superseded —
      // see the `existing` retarget branch above, which never reaches here),
      // replay whatever reframe request the in-flight-move guard deferred
      // rather than dropped while this spring was running.
      releasePendingReframeRef.current?.();
    };
    const startedAt = performance.now();
    cameraMotionRef.current = {
      camera: from,
      target,
      velocity: { scrollX: 0, scrollY: 0, zoom: 0 },
      lastFrameAt: startedAt,
      reason,
      animationId,
      proposalId: metadata.proposalId,
      transitionId: metadata.transitionId,
      rafId: requestAnimationFrame(frame),
    };
  }, [canvasRuntime, log]);

  const flushPendingPageArrivalCamera = useCallback((identity?: PageArrivalIdentity) => {
    const candidate = pendingPageArrivalCameraRef.current;
    if (!candidate || (identity && !samePageArrivalTransition(candidate, identity))) return;
    pendingPageArrivalCameraRef.current = null;
    log({ type: "camera-metric", event: "executed", reason: candidate.reason, target: candidate.target });
    animateCamera(candidate.target, candidate.reason, {
      animationId: `camera-animation-${++cameraAnimationSequenceRef.current}`,
      proposalId: candidate.proposalId,
      transitionId: candidate.transitionId,
    });
  }, [animateCamera, log]);

  /** Stop whatever comparison/process move is in flight, if any (Part 17: races/cancellation). */
  const cancelConceptMotion = useCallback((reason: string) => {
    const motion = conceptMotionRef.current;
    if (!motion) return;
    cancelAnimationFrame(motion.rafId);
    conceptMotionRef.current = null;
    comparisonEpochRef.current += 1;
    if (motion.structureKind === "comparison") {
      log({
        type: "comparison",
        event: "movement_cancelled",
        leftConceptId: motion.conceptIds[0],
        rightConceptId: motion.conceptIds[1],
        reason,
      });
    } else {
      log({ type: "process", event: "movement_cancelled", conceptIds: motion.conceptIds, reason });
    }
  }, [log]);

  /**
   * Frame meaningful content inside the exported rectangle, never the
   * infinite sheet.
   *
   * `mathFocalConceptId`, when set, scopes the PRIMARY focal bounds to just
   * that concept's own elements (the MathStep group that was just
   * committed) instead of the union of everything ever drawn on the page,
   * with the whole-page union demoted to optional `contextBounds` that
   * proposeCamera only includes if it still fits at a readable zoom.
   * Previously every commit — math included — framed the full-page union,
   * so a long-running derivation's accumulated boxes eventually needed a
   * zoom below the readable floor to all fit, and since proposeCamera never
   * zooms below that floor, the camera reported contentFits:false forever
   * with a frozen target rather than losing track of just the OLD steps.
   * Reproduced on real replay output: contentFits:false on 9 consecutive
   * commits once accumulated math content exceeded readable-zoom capacity.
   */
  const framePage = useCallback((
    force = false,
    reason = force ? "explicit page navigation" : "content entered safe frame",
    mathFocalConceptId: string | null = null,
    liveFocalElementId: string | null = null,
    allowFullZoomChange = false,
    livePageArrivalIdentity: PageArrivalIdentity | null = null,
  ) => {
    // Delayed Scribe/Beat commits may continue while the speaker is talking.
    // They may draw, but the live line owns the shot until its overview timer.
    //
    // Both guards below have a staleness escape hatch. Each is normally
    // cleared by a specific later event (the overview timer firing, the
    // camera spring settling) — but if that event is ever missed (a
    // background-tab-throttled timer, a spring that stalls just short of its
    // settle threshold, a callback that throws before clearing state), the
    // flag would otherwise stay set forever and every future non-live
    // reframe request would silently no-op: the camera visibly "stuck",
    // indistinguishable from a real spring bug. A stale flag is treated as
    // cleared rather than trusted indefinitely.
    //
    // A *held* flag is not the same failure as a *stuck* one, though: while
    // speech is genuinely continuous, `liveCameraHoldSetAtRef` keeps getting
    // refreshed by every interim, so the re-arm-based staleness check above
    // never fires even though nothing is actually stuck — the hold is doing
    // its job. That was the actual bug: any reframe blocked by a legitimately
    // active hold (or a legitimately in-flight move) was simply discarded,
    // with nothing to revisit it once the hold or the move eventually
    // cleared. `holdExceedsCeiling` bounds how long a single held streak can
    // run regardless of how often it's refreshed, and every request the two
    // guards below block is now remembered in `pendingReframeRef` and
    // replayed the moment the block lifts, rather than lost.
    const holdExceedsCeiling =
      liveCameraHoldRef.current && Date.now() - liveCameraHoldStartedAtRef.current > MAX_LIVE_CAMERA_HOLD_MS;
    const holdIsStale =
      liveCameraHoldRef.current && Date.now() - liveCameraHoldSetAtRef.current > LIVE_CAMERA_OVERVIEW_MS * 2;
    if (holdIsStale || holdExceedsCeiling) {
      // The overview timer that was supposed to release this never fired —
      // release it here instead of leaving every future call to rediscover
      // the same staleness.
      liveCameraHoldRef.current = false;
      if (liveCameraOverviewTimerRef.current) {
        clearTimeout(liveCameraOverviewTimerRef.current);
        liveCameraOverviewTimerRef.current = null;
      }
      // A ceiling breach can be discovered by a live-narration call, which
      // never drains pendingReframeRef itself (see below) — without this, a
      // diagram queued during a monologue that never pauses long enough to
      // settle would stay queued past every ceiling breach, re-armed by the
      // next interim before anything ever surfaced it.
      if (pendingReframeRef.current) releasePendingReframeRef.current?.();
    }
    if (liveCameraHoldRef.current && !liveFocalElementId && !force) {
      pendingReframeRef.current = { reason, mathFocalConceptId, liveFocalElementId: null, allowFullZoomChange };
      log({ type: "camera-metric", event: "suppressed", suppressReason: "live-camera-hold", reason });
      return;
    }
    const proposedIsStale =
      Boolean(compositionRef.current.proposedTarget) &&
      Date.now() - compositionRef.current.lastMovementAt > CAMERA_RULES.stuckMoveMs;
    if (compositionRef.current.proposedTarget && !proposedIsStale && !force && !liveFocalElementId) {
      pendingReframeRef.current = { reason, mathFocalConceptId, liveFocalElementId: null, allowFullZoomChange };
      log({ type: "camera-metric", event: "suppressed", suppressReason: "move-in-flight", reason });
      return;
    }
    // This call is about to run for real. Only clear a deferred request if
    // this call is itself the kind of system/structural reframe a deferred
    // request represents — a live-narration interim bypasses the hold guard
    // on every call by design (liveFocalElementId always set) and must not
    // silently swallow a diagram's pending reframe just by passing through;
    // that pending request stays queued for its own release point instead.
    if (!liveFocalElementId) pendingReframeRef.current = null;
    const app = canvasRuntime.readViewport();
    if (!app?.width || !app?.height) return;
    const origin = pageOrigin(pageRef.current);
    const pageBounds = { x: origin.x, y: origin.y, width: PAGE_W, height: PAGE_H };
    const onPage = elementsRef.current.filter((element) => {
      const owner = String((element.customData as { inpublicStoryOwner?: string } | undefined)?.inpublicStoryOwner ?? "");
      const isStory = owner.startsWith("story");
      if (isStory) return false;
      return element.opacity !== 0 && element.x < pageBounds.x + pageBounds.width && element.x + Math.max(1, element.width) > pageBounds.x &&
        element.y < pageBounds.y + pageBounds.height && element.y + Math.max(1, element.height) > pageBounds.y;
    });
    if (!force && onPage.length === 0) return;
    const elementBounds = rectUnion(onPage.map((element) => ({
      x: element.x,
      y: element.y,
      width: Math.max(1, element.width),
      height: Math.max(1, element.height),
    })));
    const defaultFocalBounds = elementBounds ?? { x: origin.x + PAGE_PAD, y: origin.y + PAGE_PAD, width: PAGE_W - PAGE_PAD * 2, height: 500 };

    let focalBounds = defaultFocalBounds;
    let contextBounds: CompositionRect | undefined;
    const liveFocalElement = liveFocalElementId
      ? onPage.find((element) => element.id === liveFocalElementId)
      : undefined;
    if (liveFocalElement) {
      const focusWidth = Math.min(Math.max(1, liveFocalElement.width), 620);
      const focusHeight = Math.min(Math.max(1, liveFocalElement.height), 180);
      focalBounds = {
        // Follow the newest words at the trailing edge rather than repeatedly
        // recentering the complete, ever-growing transcript element.
        x: liveFocalElement.x + Math.max(0, liveFocalElement.width - focusWidth),
        y: liveFocalElement.y + Math.max(0, liveFocalElement.height - focusHeight),
        width: focusWidth,
        height: focusHeight,
      };
      // During speech, context is deliberately excluded. The current words
      // are the shot; the delayed overview reveals the full composition.
      contextBounds = undefined;
    } else if (mathFocalConceptId) {
      const activeConcept = boardRef.current.concepts.get(mathFocalConceptId);
      const activeIds = new Set(activeConcept?.elementIds ?? []);
      const activeBounds = activeIds.size
        ? rectUnion(onPage.filter((el) => activeIds.has(el.id)).map((el) => ({
            x: el.x,
            y: el.y,
            width: Math.max(1, el.width),
            height: Math.max(1, el.height),
          })))
        : null;
      if (activeBounds) {
        focalBounds = activeBounds;
        contextBounds = elementBounds ?? undefined;
      }
    }
    const readabilityElements = liveFocalElement ? [liveFocalElement] : onPage;
    const text = readabilityElements.flatMap<TextReadabilitySample>((element) => {
      const fontSize = Number(element.fontSize ?? 0);
      if (element.type !== "text" || !fontSize) return [];
      const role: ReadabilityRole = fontSize >= 26 ? "primary" : fontSize >= 18 ? "supporting" : "annotation";
      return [{ id: element.id, fontSize, role }];
    });
    const currentCamera: CameraView = {
      scrollX: Number(app.scrollX ?? 0),
      scrollY: Number(app.scrollY ?? 0),
      zoom: app.zoom,
    };
    const focalSubject = liveFocalElement
      ? "live narration"
      : sketchRef.current.labels.at(-1) ?? boardRef.current.activeSectionId ?? "current explanation";
    const activeCluster = liveFocalElement
      ? `live:${pageRef.current}:${liveFocalElement.id}`
      : `page:${pageRef.current}`;
    // A deliberate user pan/zoom gets a brief priority window before routine
    // (non-urgent) reframes resume — mirrors the touch-lock already used to
    // protect drawing from a moving cursor. Content that genuinely doesn't
    // fit the safe frame still moves the camera regardless (see `urgent` in
    // proposeCamera): this only holds back cosmetic recentering, so the
    // system can't get permanently stuck deferring to an old user pan.
    const manualPriorityActive =
      !force && Date.now() - lastPointerInputRef.current < MANUAL_CAMERA_PRIORITY_MS;
    if (!liveFocalElementId) {
      log({ type: "camera-metric", event: "requested", reason, force, manualPriorityActive });
    }
    const proposalInput = {
      state: compositionRef.current,
      viewport: recordingViewport(Number(app.width), Number(app.height)),
      currentCamera,
      focalBounds,
      contextBounds,
      focalSubject,
      activeCluster,
      reason,
      now: Date.now(),
      text,
      primarySubjectChanged: force && compositionRef.current.activeCluster !== activeCluster,
      explicitNavigation: force,
      followMovingSubject: Boolean(liveFocalElement),
      maximumZoomChange: allowFullZoomChange ? 1 : undefined,
      manualPriorityActive,
    };
    const proposalKind: CameraProposalKind = reason.startsWith("page turn:")
      ? "page_turn"
      : liveFocalElement
        ? "live_follow"
        : reason === "overview after live narration"
          ? "overview"
          : "structural";
    const pageArrivalIdentity = proposalKind === "page_turn"
      ? pendingPageArrivalTransitionRef.current
      : proposalKind === "live_follow"
        ? livePageArrivalIdentity
        : null;
    const transitionId = pageArrivalIdentity?.transitionId;
    const eventCycleId = pageArrivalIdentity?.eventCycleId;
    const firstLiveAfterPageTurn = proposalKind === "live_follow" && Boolean(transitionId);
    const proposalId = `camera-proposal-${++cameraProposalSequenceRef.current}`;
    const spring = cameraMotionRef.current;
    const springSnapshot: CameraSpringSnapshot | null = spring ? {
      camera: { ...spring.camera },
      velocity: { ...spring.velocity },
      target: { ...spring.target },
      lastFrameAt: spring.lastFrameAt,
      animationId: spring.animationId,
      reason: spring.reason,
    } : null;
    const proposal = proposeCamera(proposalInput);
    if (isDev || replayModeRef.current !== null) {
      log({
        type: "camera-proposal",
        version: CAMERA_PROPOSAL_SNAPSHOT_VERSION,
        eventId: proposalId,
        capturedAtPerf: performance.now(),
        proposalKind,
        pageIndex: pageRef.current,
        pageGeneration: cameraPageGenerationRef.current,
        pageBounds,
        transitionId,
        eventCycleId,
        firstLiveAfterPageTurn,
        input: proposalInput,
        spring: springSnapshot,
        recorded: proposal,
      });
    }
    compositionRef.current = proposal.state;
    sketchPannedRef.current = true;
    log({
      type: "composition",
      event: proposal.contentFits ? "decision" : "suppression",
      focalSubject,
      activeCluster,
      safeFrame: proposal.safeFrame,
      effectiveTextSize: proposal.effectiveTextSize,
      cameraTarget: proposal.target,
      reason: proposal.reason,
      moved: proposal.move,
      contentFits: proposal.contentFits,
      webcamCollisions: proposal.webcamCollisions,
      occupiedCanvasRatio: proposal.occupiedCanvasRatio,
      readabilityViolations: proposal.readabilityViolations,
    });
    for (const sample of text) {
      const effective = effectiveTextSize(sample.fontSize, proposal.target.zoom);
      if (effective < READABILITY_CONTRACT[sample.role]) {
        log({ type: "readability", elementId: sample.id, role: sample.role, sourceFontSize: sample.fontSize, effectiveFontSize: effective, minimumFontSize: READABILITY_CONTRACT[sample.role] });
      }
    }
    if (proposal.move) {
      compositionHistoryRef.current.push({ ...compositionRef.current, camera: currentCamera, proposedTarget: undefined });
      if (compositionHistoryRef.current.length > 200) compositionHistoryRef.current.shift();
      const pendingPageCamera = pendingPageArrivalCameraRef.current;
      const coalescesPendingPage = firstLiveAfterPageTurn
        && samePageArrivalTransition(pendingPageCamera, pageArrivalIdentity);

      if (pendingPageCamera && !coalescesPendingPage) {
        flushPendingPageArrivalCamera();
      }

      if (proposalKind === "page_turn" && pageArrivalIdentity) {
        const candidate: PendingPageArrivalCamera = {
          ...pageArrivalIdentity,
          proposalId,
          target: proposal.target,
          reason: proposal.reason,
        };
        pendingPageArrivalCameraRef.current = candidate;
        if (!pageArrivalIdentity.expectsLiveFollow) {
          queueMicrotask(() => flushPendingPageArrivalCamera(pageArrivalIdentity));
        }
      } else {
        if (coalescesPendingPage && pendingPageCamera && pageArrivalIdentity) {
          pendingPageArrivalCameraRef.current = null;
          pendingPageArrivalTransitionRef.current = null;
          log({
            type: "camera-page-arrival-coalesced",
            pageGeneration: pageArrivalIdentity.pageGeneration,
            pageIndex: pageArrivalIdentity.pageIndex,
            eventCycleId: pageArrivalIdentity.eventCycleId,
            transitionId: pageArrivalIdentity.transitionId,
            pageProposalId: pendingPageCamera.proposalId,
            liveProposalId: proposalId,
            originalPageTarget: pendingPageCamera.target,
            retainedLiveTarget: proposal.target,
          });
        }
        if (!liveFocalElementId) log({ type: "camera-metric", event: "executed", reason: proposal.reason, target: proposal.target });
        animateCamera(proposal.target, proposal.reason, {
          animationId: `camera-animation-${++cameraAnimationSequenceRef.current}`,
          proposalId,
          transitionId,
        });
      }
    } else {
      const pendingPageCamera = pendingPageArrivalCameraRef.current;
      if (firstLiveAfterPageTurn && samePageArrivalTransition(pendingPageCamera, pageArrivalIdentity)) {
        pendingPageArrivalTransitionRef.current = null;
        flushPendingPageArrivalCamera(pageArrivalIdentity ?? undefined);
      }
      if (!liveFocalElementId && !proposal.contentFits) {
        // The camera decided not to move, but its own math says the content
        // still doesn't fit the safe frame afterward — a real visibility
        // failure, not a suppressed cosmetic tweak. Verified from proposeCamera's
        // own post-decision fit check, not inferred separately.
        log({ type: "camera-metric", event: "failed_visibility_check", reason: proposal.reason, occupiedCanvasRatio: proposal.occupiedCanvasRatio });
      }
    }
  }, [animateCamera, canvasRuntime, flushPendingPageArrivalCamera, log]);

  /**
   * Replay whatever reframe request the hold/in-flight guards in framePage
   * deferred, the moment the guard that blocked it clears. Called from
   * animateCamera's three completion paths via releasePendingReframeRef
   * (assigned below `framePage` is created, same tie-the-knot pattern as
   * writeLiveRef) and from the live-hold release points in writeLive.
   */
  const releasePendingReframe = useCallback(() => {
    const pending = pendingReframeRef.current;
    if (!pending) return;
    pendingReframeRef.current = null;
    framePage(false, pending.reason, pending.mathFocalConceptId, pending.liveFocalElementId, pending.allowFullZoomChange);
  }, [framePage]);
  releasePendingReframeRef.current = releasePendingReframe;

  const restoreCompositionCamera = useCallback((snapshot?: CompositionState) => {
    const previous = snapshot ?? compositionHistoryRef.current.pop();
    if (!previous) return;
    compositionRef.current = { ...previous, proposedTarget: undefined, movementReason: undefined };
    animateCamera(previous.camera, "undo restored composition state");
  }, [animateCamera]);

  /** Move the camera and the pen to an existing page without turning. */
  const gotoPage = useCallback(
    (index: number) => {
      if (index === pageRef.current) return;
      // Park the current page's state so we can come back to it unchanged.
      pagePensRef.current.set(pageRef.current, { ...penRef.current });
      pageMarksRef.current.set(pageRef.current, marksRef.current);

      pageRef.current = index;
      penRef.current = pagePensRef.current.get(index) ?? newPagePen(index);
      marksRef.current = pageMarksRef.current.get(index) ?? new Map();
      framePage(true, "explicit navigation to referenced page");
    },
    [framePage],
  );

  /**
   * Turn to a fresh sheet. Nothing already drawn is touched or moved.
   *
   * `reason` is required: a page turn is the most visible thing this system
   * does that the speaker did not ask for, and a log that cannot say why one
   * happened cannot be used to tell a working page system from a broken one.
   */
  const turnPage = useCallback(
    (
      reason: PageTurnReason,
      why: string,
      /**
       * False when the caller is `writeLive` itself, which re-renders the
       * sentence on the new sheet as part of its own overflow path. Carrying
       * it here as well would letter it twice.
       */
      opts: { carry?: boolean } = {},
    ) => {
      const carry = opts.carry !== false;
      // The sentence in flight moves to the new sheet WHOLE rather than being
      // dropped. Before, `dropLiveLine` deleted it and nothing put it back —
      // if the speaker was mid-utterance when the page turned, those words
      // were simply gone until the next interim rebuilt them from scratch.
      const carried = liveRef.current
        ? (findElement(liveRef.current.elementId)?.text as string) ?? ""
        : "";
      const midThought = carried !== "" && !isThoughtComplete(carried);
      dropLiveLine();

      pagePensRef.current.set(pageRef.current, { ...penRef.current });
      pageMarksRef.current.set(pageRef.current, marksRef.current);

      pageRef.current += 1;
      cameraPageGenerationRef.current += 1;
      const pageArrivalTransitionId = `page-arrival-${cameraPageGenerationRef.current}-page-${pageRef.current}`;
      const pageArrivalIdentity: PageArrivalIdentity = {
        transitionId: pageArrivalTransitionId,
        pageGeneration: cameraPageGenerationRef.current,
        pageIndex: pageRef.current,
        eventCycleId: ++cameraEventCycleSequenceRef.current,
        expectsLiveFollow: !carry || Boolean(carried),
      };
      pendingPageArrivalTransitionRef.current = pageArrivalIdentity;
      // This is an exact logical continuation token, not a time window. The
      // global fallback expires this cycle; an explicitly carried writeLive
      // keeps the same token across its local font/measurement awaits.
      queueMicrotask(() => {
        if (samePageArrivalTransition(pendingPageArrivalTransitionRef.current, pageArrivalIdentity)) {
          pendingPageArrivalTransitionRef.current = null;
        }
      });
      penRef.current = newPagePen(pageRef.current);
      captionCursorRef.current = null;
      marksRef.current = new Map();
      sketchRef.current.labels = [];
      sketchRef.current.gestures = new Set();
      sketchRef.current.count = 0;
      pageTurnRequestedAtRef.current = 0;

      log({
        type: "page",
        index: pageRef.current,
        reason,
        why,
        midThought,
        carriedLiveLine: carry && carried !== "",
      });
      framePage(true, `page turn: ${reason}`);

      // Re-letter the carried sentence on the new sheet. Deliberately after
      // the log and the camera move, so the line lands on the page the viewer
      // is already looking at.
      if (carry && carried) {
        void writeLiveRef.current?.(carried, false, undefined, pageArrivalIdentity)
          .finally(() => flushPendingPageArrivalCamera(pageArrivalIdentity));
      }
      return pageArrivalIdentity;
    },
    [dropLiveLine, findElement, flushPendingPageArrivalCamera, framePage, log],
  );

  /**
   * How long a soft page turn has been held back for an unfinished thought.
   * Zero when nothing is pending.
   */
  const pageTurnRequestedAtRef = useRef(0);
  /** writeLive is defined below turnPage but called by it. */
  const writeLiveRef = useRef<
    ((text: string, settled: boolean, timing?: AudioTiming, pageArrivalIdentity?: PageArrivalIdentity) => Promise<void>) | null
  >(null);

  /**
   * Ask for a page turn. Soft triggers may be held back.
   *
   * This is the fix for the defect that showed up in every session: the mark
   * cap is reached by the Scribe, which fires on fragments, so the sheet
   * flipped in the middle of a sentence and the rest of the thought landed on
   * a different page. Hard overflow still turns immediately — there is nowhere
   * else for the ink to go.
   */
  const requestPageTurn = useCallback(
    (
      trigger: "overflow" | "capacity" | "section" | "clear" | "long-utterance",
    ): boolean => {
      if (suppressPageTurnDuringInitialComposition(trigger, withinInitialCompositionWindow(now()))) {
        log({
          type: "attention",
          action: "suppression",
          target: `page-turn:${trigger}`,
          reason: "initial 60-second composition window",
        });
        return false;
      }
      const liveText = liveRef.current
        ? ((findElement(liveRef.current.elementId)?.text as string) ?? "")
        : "";
      const requestedAt = pageTurnRequestedAtRef.current;
      const decision = decidePageTurn({
        trigger,
        marks: sketchRef.current.count,
        maxMarks: MAX_MARKS_PER_PAGE,
        liveText,
        deferredForMs: requestedAt ? Date.now() - requestedAt : 0,
      });

      if (!decision.turn) {
        if (!requestedAt) pageTurnRequestedAtRef.current = Date.now();
        return false;
      }
      turnPage(decision.reason, decision.why);
      return true;
    },
    [findElement, log, now, turnPage],
  );
  const cloudUpdatedAtRef = useRef<string | undefined>(undefined);


  /**
   * Set by the speculative layer, which is defined below applyOp because it
   * depends on `commit`. applyOp has to reach it to retire a guess before
   * placing the real mark that replaces it, so the ref ties the knot.
   */
  const reconcileSpeculativeRef = useRef<((realText: string) => void) | null>(null);

  const applyOp = useCallback(
    async (op: Op, sourceText = ""): Promise<boolean> => {
      // Excalidraw measures text with whatever font is resolved at creation
      // time. If Excalifont hasn't loaded yet it measures a narrower fallback,
      // then renders the wider hand face into that box and the tail is clipped.
      await fontsReadyRef.current;
      // Hard dedupe. renderedMarkKeys is session-wide while the live sketch
      // exists, unlike marksRef (which is page-local), so repeats cannot
      // return after a page turn.
      if ("text" in op) {
        const key = markKey(op.text);
        if (op.op !== "underline" && renderedMarkKeysRef.current.has(key)) {
          return false;
        }
        // Retire the guess this mark supersedes BEFORE placing, so the two are
        // never on the canvas together. Done here rather than in a later pass
        // precisely because a later pass would be visible as a duplicate.
        reconcileSpeculativeRef.current?.(op.text);
      }

      const decorationKey =
        op.op === "wave"
          ? "wave"
          : op.op === "underline"
            ? `underline:${markKey(op.text)}`
            : op.op === "link"
              ? `link:${markKey(op.from)}->${markKey(op.to)}:${markKey(op.label ?? "")}`
              : null;
      if (decorationKey && decorationsRef.current.has(decorationKey)) return false;

      const claimed = new Set(conceptElementRef.current.values());
      const temporaryMarks = [...marksRef.current.values()].filter(
        (mark) => !mark.elementId || !claimed.has(mark.elementId),
      ).length;
      if (
        withinInitialCompositionWindow(now()) &&
        op.op !== "link" &&
        op.op !== "underline" &&
        temporaryMarkBudgetReached(temporaryMarks)
      ) {
        log({
          type: "attention",
          action: "suppression",
          target: "text" in op ? op.text : op.op,
          reason: `temporary Scribe budget ${MAX_TEMPORARY_SCRIBE_MARKS} reached`,
        });
        return false;
      }

      // Twenty-two was formerly a terminal cap, then an unconditional page
      // turn. It is now a REQUEST: the sheet is at its readable capacity, but
      // the block in hand still fits, so if the speaker is mid-thought this
      // waits for them to finish. That deferral is what stops the page
      // flipping in the middle of a sentence.
      if (
        op.op !== "link" &&
        op.op !== "underline" &&
        sketchRef.current.count >= MAX_MARKS_PER_PAGE
      ) {
        requestPageTurn("capacity");
      }

      const size = measureOp(op, marksRef.current);
      if (!size) return false;

      // The page is a sheet, not a bucket. When the pen runs off the bottom,
      // turn to a fresh one — never stop drawing. This one cannot be deferred:
      // there is nowhere else for the ink to go.
      if (!size.noPlace && willOverflow(penRef.current, size.w, size.h)) {
        requestPageTurn("overflow");
      }

      let built;
      try {
        built = await buildOp(op, penRef.current, marksRef.current);
      } catch (err) {
        log({ type: "note", text: `op failed (${op.op}): ${String(err)}` });
        return false;
      }
      if (!built) return false;
      if (op.op === "wave") sketchRef.current.gestures.add("wave");
      if (decorationKey) decorationsRef.current.add(decorationKey);

      for (const el of built.elements) sketchRef.current.ids.push(el.id);
      elementsRef.current = [...elementsRef.current, ...built.elements];
      if (built.mark) {
        marksRef.current.set(built.mark.key, built.mark);
        renderedMarkKeysRef.current.add(built.mark.key);
        sketchRef.current.labels.push(built.mark.key);
        sketchRef.current.concepts.add(built.mark.key);
        // A new mark is a new keyterm, and the ones on the page are the most
        // valuable ones there are.
        refreshTermsRef.current?.();
      }
      sketchRef.current.count += 1;
      const undo = emptyUndo();
      undo.addedElementIds = built.elements.map((el) => el.id);
      undo.addedMarkKeys = built.mark ? [built.mark.key] : [];
      undo.addedDecorationKeys = decorationKey ? [decorationKey] : [];
      recordOperation("scribe_mark", undo, { sourceText });
      commit();
      framePage();
      return true;
    },
    [commit, framePage, log, now, recordOperation, requestPageTurn],
  );

  /**
   * Write what is being said, as it is being said.
   *
   * This is the fast path and it must stay free of anything that can block:
   * no model, no network, no throttle. Deepgram's interim stream is the first
   * source of recognized words; all this does is put each received update on
   * the sheet. The Scribe and wrap-up run behind it.
   *
   * `settled` marks the difference between a phrase still being revised and
   * one Deepgram has committed to. A settled line also reserves its space, so
   * everything drawn afterwards lands underneath it rather than on top.
   *
   * INVARIANT: this is Tier 1, the highest-priority visual operation in the
   * app. Speculative/semantic/expressive work (Reflex, lib/speculative.ts)
   * must be scheduled strictly AFTER this has dispatched ink for the current
   * tick — never awaited by it, never in front of it. If you are tempted to
   * add a model call, a semantic lookup, or layout planning here: don't.
   */
  const writeLive = useCallback(
    async (text: string, settled: boolean, timing?: AudioTiming, inheritedPageArrivalIdentity?: PageArrivalIdentity) => {
      const spoken = text.trim();
      if (!spoken) return;
      const seq = ++liveSeqRef.current;
      const startedAt = now();
      await fontsReadyRef.current;
      // A settled line is left on the page instead of being deleted the
      // instant the next utterance starts — with the Scribe gone, this is
      // the only thing that makes settled speech a permanent page record.

      // The line grows word by word, so its row has to be re-reserved on every
      // interim, which means rewinding the pen to where the sentence started —
      // otherwise each partial ratchets the page downward.
      //
      // But the rewind is only safe if the row is still ours. The Scribe takes
      // up to two seconds and the wrap-up renderer takes longer; both finish
      // while you have already started the next sentence, and both place marks
      // when they do. Rewinding over their reservation is what was drawing
      // diagrams on top of words.
      //
      // So: rewind when the pen is where we left it, re-anchor when it isn't.
      // Re-anchoring makes the half-written line jump down once to clear
      // whatever landed — which is the right trade against overlapping it.
      const prior = liveRef.current;
      const captionRail = xeEnabled;
      const ours = captionRail
        ? prior !== null
        : prior !== null && samePen(penRef.current, prior.after);
      // An active thought should not repeatedly re-anchor — diagnostic only;
      // if it did anyway, that's worth knowing about rather than silently
      // re-anchoring.
      if (prior !== null && !ours) {
        log({ type: "v2", event: "anchor-reset", detail: settled ? "final" : "interim" });
      }
      // The utterance's element id, adopted from the first build and then held
      // for the rest of the sentence. Empty until that first build lands.
      let elementId = prior?.elementId ?? "";
      let base: Pen = ours ? prior!.base : { ...penRef.current };
      let probe: Pen = { ...base };
      const pageSpot = pageOrigin(pageRef.current);
      if (captionRail) {
        const cursor = captionCursorRef.current?.page === pageRef.current
          ? captionCursorRef.current
          : { page: pageRef.current, y: pageSpot.y + PAGE_PAD };
        captionCursorRef.current = cursor;
        probe = { originX: pageSpot.x + PAGE_W - PAGE_PAD - LIVE_CAPTION_RAIL_W, originY: pageSpot.y + PAGE_PAD, x: pageSpot.x + PAGE_W - PAGE_PAD - LIVE_CAPTION_RAIL_W, y: cursor.y, lineH: 0 };
        base = { ...probe };
      }
      let spot = captionRail
        ? { x: pageSpot.x + PAGE_W - PAGE_PAD - LIVE_CAPTION_RAIL_W, y: (captionCursorRef.current?.y ?? pageSpot.y + PAGE_PAD) }
        : lineStart(probe);
      const captionOpacity = captionRail
        ? (expressionHasInkRef.current ? 22 : settled ? 48 : 72)
        : undefined;
      const buildStartedAt = now();
      let built = await buildLiveLine(spoken, spot.x, spot.y, settled, elementId, captionRail
        ? { fontSize: LIVE_CAPTION_SIZE, maxW: LIVE_CAPTION_RAIL_W, opacity: captionOpacity }
        : undefined);
      latency.observe("build_live_line", now() - buildStartedAt);

      // A newer interim landed while we were building. Drop this one rather
      // than rewinding the line to older words.
      if (seq !== liveSeqRef.current) return;

      // A long sentence can outgrow the sheet mid-word. Turn early and keep
      // writing — never stop to make room. Expression-engine captions live in
      // the side rail and wrap instead; turning the page for a caption would
      // steal the diagram's sheet.
      if (!captionRail && willOverflow(probe, built.w, built.h)) {
        if (withinInitialCompositionWindow(now())) {
          log({
            type: "attention",
            action: "compression",
            target: "live narration",
            reason: "kept the current thought on the first-minute composition",
          });
        } else {
          inheritedPageArrivalIdentity = turnPage("long-utterance", "utterance outgrew the sheet", { carry: false });
          base = { ...penRef.current };
          probe = { ...base };
          spot = lineStart(probe);
          elementId = "";
          const retryStartedAt = now();
          try {
            built = await buildLiveLine(spoken, spot.x, spot.y, settled);
          } catch (error) {
            flushPendingPageArrivalCamera(inheritedPageArrivalIdentity);
            throw error;
          }
          latency.observe("build_live_line", now() - retryStartedAt);
          if (seq !== liveSeqRef.current) {
            flushPendingPageArrivalCamera(inheritedPageArrivalIdentity);
            return;
          }
        }
      }

      // Keep the sentence's identity across interims.
      //
      // Excalidraw does NOT honour a supplied id here — `convertToExcalidrawElements`
      // reissues one for text as it does for labelled containers — so we can't
      // just pass an id in and assume it sticks. Instead: build a throwaway to
      // get correct font metrics, then PATCH those metrics onto the element
      // that is already on the canvas. Identity survives, measurement stays
      // exact, and the render cost is unchanged.
      const stale = new Set(liveRef.current?.ids ?? []);
      const existingIndex = elementId
        ? elementsRef.current.findIndex((el) => el.id === elementId)
        : -1;

      if (existingIndex >= 0 && built.elements.length === 1) {
        const fresh = built.elements[0] as unknown as Record<string, unknown>;
        elementsRef.current = elementsRef.current.map((el, i) =>
          i === existingIndex
            ? patch(el, {
                text: fresh.text as string,
                originalText: (fresh.originalText ?? fresh.text) as string,
                width: fresh.width as number,
                height: fresh.height as number,
                x: fresh.x as number,
                y: fresh.y as number,
                strokeColor: fresh.strokeColor as string,
                lineHeight: fresh.lineHeight as number,
                ...(captionOpacity !== undefined ? { opacity: captionOpacity } : {}),
                ...(captionRail
                  ? {
                      fontSize: LIVE_CAPTION_SIZE,
                      customData: {
                        ...((el.customData as Record<string, unknown> | undefined) ?? {}),
                        inpublicCaption: true,
                      },
                    }
                  : {}),
              } as Partial<SceneElement>)
            : el,
        );
      } else {
        const incoming = captionRail
          ? built.elements.map((el) =>
              patch(el, {
                ...(captionOpacity !== undefined ? { opacity: captionOpacity } : {}),
                customData: {
                  ...((el.customData as Record<string, unknown> | undefined) ?? {}),
                  inpublicCaption: true,
                },
              } as Partial<SceneElement>),
            )
          : built.elements;
        elementsRef.current = [
          ...elementsRef.current.filter((el) => !stale.has(el.id)),
          ...incoming,
        ];
        // Adopt the id Excalidraw actually issued — that is the stable one.
        elementId = incoming[0]?.id ?? elementId;
      }

      // Reserve the row now, not at the end of the sentence, so anything drawn
      // afterwards lands under the line instead of through it.
      // Expression captions occupy the side rail, not the main pen — the
      // diagram keeps the centre of the sheet.
      if (!captionRail) {
        penRef.current = probe;
        place(penRef.current, built.w, built.h, true);
      } else if (settled) {
        const nextY = spot.y + built.h + LIVE_CAPTION_GAP;
        captionCursorRef.current = { page: pageRef.current, y: nextY };
      }

      if (settled) {
        const settledIds = existingIndex >= 0 ? [elementId] : built.elements.map((el) => el.id);
        for (const id of settledIds) liveLineIdsRef.current.add(id);
        // Caption-rail writes must not claim the main pen — dropLiveLine
        // rewinds the pen when `after` still matches it.
        const penAfter = captionRail ? { ...probe } : { ...penRef.current };
        settledLiveRef.current = { ids: settledIds, base, after: penAfter };
        liveRef.current = null;
      } else {
        liveRef.current = {
          elementId,
          // When patching in place the element is already in the scene, so the
          // stale set must keep naming it rather than the throwaway build.
          ids: existingIndex >= 0 ? [elementId] : built.elements.map((el) => el.id),
          base,
          after: captionRail ? { ...probe } : { ...penRef.current },
        };
      }

      const commitStartedAt = now();
      commit();
      latency.observe("commit", now() - commitStartedAt);
      // Only stamp the streak's start on the false->true edge — every
      // interim after that re-arms liveCameraHoldSetAtRef (so the hold keeps
      // covering genuinely continuous speech) but must not push out
      // liveCameraHoldStartedAtRef, or MAX_LIVE_CAMERA_HOLD_MS could never
      // fire during a long uninterrupted monologue.
      if (!liveCameraHoldRef.current) liveCameraHoldStartedAtRef.current = Date.now();
      liveCameraHoldRef.current = true;
      liveCameraHoldSetAtRef.current = Date.now();
      if (liveCameraOverviewTimerRef.current) {
        clearTimeout(liveCameraOverviewTimerRef.current);
        liveCameraOverviewTimerRef.current = null;
      }
      // While speech is arriving, the live line owns the shot. It keeps one
      // stable element id across interims, so following it does not confuse a
      // changing transcript with a changing subject.
      //
      // V2 INVARIANT (docs/LIVE-SPEECH-PRESENTATION-V2.md, "Camera
      // Contract"): do not chase every interim. Ask the camera to follow the
      // live line only when it is genuinely about to leave the visible
      // viewport — never as a matter of routine. proposeCamera still owns
      // the actual move decision/hysteresis (cooldown, displacement, zoom
      // clamp); liveLineFitsViewport only decides whether to ask it at all.
      // Do not make this call unconditional again — that reintroduces the
      // "camera follows every word" distraction V2 exists to remove.
      {
        const app = canvasRuntime.readViewport();
        const fits = liveLineFitsViewport(
          { x: spot.x, y: spot.y, width: built.w, height: built.h },
          {
            scrollX: Number(app?.scrollX ?? 0),
            scrollY: Number(app?.scrollY ?? 0),
            zoom: app?.zoom ?? 1,
            width: Number(app?.width ?? 0),
            height: Number(app?.height ?? 0),
          },
        );
        if (fits) {
          log({ type: "v2", event: "camera-follow-skipped", detail: settled ? "final" : "interim" });
          if (inheritedPageArrivalIdentity) flushPendingPageArrivalCamera(inheritedPageArrivalIdentity);
        } else {
          log({ type: "v2", event: "camera-follow-allowed", detail: settled ? "final" : "interim" });
          framePage(false, "following live narration", null, elementId, false, inheritedPageArrivalIdentity ?? null);
        }
      }
      if (settled) {
        liveCameraOverviewTimerRef.current = setTimeout(() => {
          liveCameraOverviewTimerRef.current = null;
          liveCameraHoldRef.current = false;
          // Generic Overview Removal V1 (docs/GENERIC-OVERVIEW-REMOVAL-V1-PRODUCTION-VALIDATION.md):
          // this timer still exists purely to release the live-camera hold —
          // a pending structural reframe still deserves to run the moment
          // speech goes quiet. What it no longer does is fall back to a
          // generic full-page overview when none is waiting; "nothing
          // happened for 1.8 seconds" is not by itself a camera command.
          if (pendingReframeRef.current) releasePendingReframeRef.current?.();
        }, LIVE_CAMERA_OVERVIEW_MS);
      }

      // Ink is on the sheet as of here. Everything below is measurement.
      const inkedAt = now();
      latency.mark("first_ink", latencyNow());
      const timings = liveLagRef.current;
      if (timing?.kind !== "final") {
        timings.render.push(inkedAt - startedAt);
        latency.observe("render", inkedAt - startedAt);
      }
      if (timing) {
        if (!timings.streamEpoch) timings.streamEpoch = timing.streamEpoch;
        if (timings.streamEpoch !== timing.streamEpoch) {
          log({
            type: "invalid-timing",
            streamEpoch: timing.streamEpoch,
            activeStreamEpoch: timings.streamEpoch,
            audioEndMs: timing.audioEndMs,
            inkedAtMs: inkedAt,
            reason: "stream epoch changed; prior samples discarded",
          });
          timings.lag = [];
          timings.streamEpoch = timing.streamEpoch;
          timings.invalid += 1;
        }
        const sample = liveLatencySample(inkedAt, timing, timings.streamEpoch);
        if (sample.valid) {
          if (timing.kind === "final") timings.finalLag = sample.lagMs ?? 0;
          else {
            timings.lag.push(sample.lagMs ?? 0);
            // Speech-to-ink, on the same audio timeline as every other tier's
            // measurement, so the tiers are directly comparable. NOTE: this is
            // an audio-timeline diagnostic, not a wall-clock latency figure —
            // see the "lag" SampleKey doc in lib/latency.ts.
            latency.observe("lag", sample.lagMs ?? 0);
          }
        }
        // True wall-clock speech-to-ink, independent of the sample above and
        // never derived from Deepgram start/duration. Observed unconditionally
        // of the audio-timeline sample's validity — a stream-epoch mismatch
        // invalidates both the same way, but this one doesn't share the other
        // failure modes (future-audio/stale-audio) since it isn't anchored to
        // Deepgram's clock at all.
        const chunkSample = chunkToInkSample(inkedAt, timing, timings.streamEpoch);
        if (chunkSample.valid && timing.kind !== "final") {
          latency.observe("chunk_to_ink", chunkSample.lagMs ?? 0);
        }
        if (!sample.valid) {
          timings.invalid += 1;
          log({
            type: "invalid-timing",
            streamEpoch: timing.streamEpoch,
            activeStreamEpoch: timings.streamEpoch,
            audioEndMs: timing.audioEndMs,
            inkedAtMs: inkedAt,
            reason: sample.reason ?? "invalid",
          });
        }
      }

      if (settled) {
        const median = (xs: number[]) => {
          if (xs.length === 0) return 0;
          const s = [...xs].sort((a, b) => a - b);
          return Math.round(s[Math.floor(s.length / 2)]);
        };
        log({
          type: "live",
          text: spoken,
          interims: timings.render.length,
          lagP50: median(timings.lag),
          lagMax: timings.lag.length ? Math.max(...timings.lag) : 0,
          renderP50: median(timings.render),
          finalLag: timings.finalLag,
          paintP50: median(timings.paint),
          paintP95: timings.paint.length
            ? [...timings.paint].sort((a, b) => a - b)[Math.min(timings.paint.length - 1, Math.floor(timings.paint.length * 0.95))]
            : 0,
          streamEpoch: timings.streamEpoch || undefined,
          invalidSamples: timings.invalid,
        });
        liveLagRef.current = { lag: [], render: [], paint: [], streamEpoch: 0, invalid: 0 };
      }

      // A settled line ends the thought a deferred page turn was waiting on.
      if (settled && pageTurnRequestedAtRef.current) requestPageTurn("capacity");
    },
    [canvasRuntime, commit, flushPendingPageArrivalCamera, framePage, log, now, requestPageTurn, turnPage, xeEnabled],
  );

  // turnPage carries the sentence in flight onto the new sheet by calling back
  // into writeLive, which is defined after it. The ref is the knot-tie.
  writeLiveRef.current = writeLive;

  /**
   * Verify the live line isn't sitting on top of anything.
   *
   * The row reservation is supposed to make this impossible, and mostly does —
   * but "supposed to" was the entire status of this claim until now, and the
   * overlap it protects against is the single most visible failure the board
   * can produce on camera. Cheap to check, so check it.
   */
  const checkLiveOverlap = useCallback(() => {
    const live = liveRef.current;
    if (!live) return;
    const el = findElement(live.elementId);
    if (!el) return;
    const hit = elementsRef.current.find((other) => {
      if (other.id === el.id || other.containerId === el.id) return false;
      if (other.type === "frame" || other.type === "arrow") return false;
      if (!(other.width > 0 && other.height > 0)) return false;
      return (
        el.x < other.x + other.width &&
        el.x + el.width > other.x &&
        el.y < other.y + other.height &&
        el.y + el.height > other.y
      );
    });
    if (hit) {
      log({
        type: "note",
        text: `live line overlaps ${hit.type} ${hit.id} at (${Math.round(hit.x)},${Math.round(hit.y)})`,
      });
    }
  }, [findElement, log]);

  /** Finalised speech waiting to be handled. Vestigial now that the Scribe
   * that drained it is gone, but Gemini's transcript handler and undo/clear
   * still touch it defensively — see Strip-Down Phase 2. */
  const scribePendingRef = useRef("");
  /** Interim-stability tracking for the reflex/anticipate prefix computation below. */
  const prevInterimRef = useRef<string[]>([]);
  const settledCountRef = useRef(0);

  // ---- rendering -----------------------------------------------------------
  const renderQueueRef = useRef<PendingRender[]>([]);
  const renderingRef = useRef(false);

  const fadeIn = useCallback(
    async (elementId: string) => {
      for (let step = 1; step <= FADE_STEPS; step++) {
        await sleep(FADE_MS / FADE_STEPS);
        const index = elementsRef.current.findIndex((e) => e.id === elementId);
        if (index === -1) return;
        elementsRef.current = elementsRef.current.map((e, i) =>
          i === index
            ? patch(e, { opacity: Math.round((100 * step) / FADE_STEPS) })
            : e,
        );
        commit();
      }
    },
    [commit],
  );

  const renderBeat = useCallback(
    async ({ mermaid, focus }: PendingRender) => {
      let built;
      try {
        built = await buildBeat(mermaid, focus || "untitled", 0);
      } catch (err) {
        if (isDev) console.warn("[artist] mermaid parse failed", err);
        log({ type: "note", text: `mermaid parse failed: ${String(err)}` });
        return;
      }

      // Never fight the user's cursor.
      await waitForIdleHands();

      // And never land in a row the live line is still growing into. The
      // re-anchor in writeLive would recover from it, but only by yanking the
      // half-written sentence down the page mid-word. The wrap-up fires at a
      // silence, so the sentence has almost always settled already; the bound
      // is there so someone talking without pause can't starve it forever.
      const settleBy = Date.now() + LIVE_SETTLE_WAIT_MS;
      while (liveRef.current && Date.now() < settleBy) await sleep(60);

      const { frame, children, nodes } = built;

      // Nothing already drawn ever moves. The tidy diagram is placed BELOW the
      // notes it summarises, on the same page — the way a sketchnoter draws
      // the structure after lettering the words, rather than erasing them.
      const fw = (frame.width as number) || 600;
      const fh = (frame.height as number) || 400;
      if (willOverflow(penRef.current, fw, fh)) {
        turnPage("overflow", "diagram does not fit below the notes");
      }
      const spot = place(penRef.current, fw, fh, true);
      const dx = spot.x - frame.x;
      const dy = spot.y - frame.y;
      for (const el of [frame, ...children]) {
        el.x += dx;
        el.y += dy;
      }

      const hadSketch = sketchRef.current.count > 0;
      for (const el of [frame, ...children]) sketchRef.current.ids.push(el.id);

      elementsRef.current = [...elementsRef.current, patch(frame, {})];
      commit();

      // The content is already familiar from the live pass, so the tidy-up
      // should feel like a snap rather than a second slow draw.
      const stagger = hadSketch ? POLISH_STAGGER_MS : STAGGER_MS;
      for (const child of children) {
        elementsRef.current = [
          ...elementsRef.current,
          patch(child, { opacity: 0 }),
        ];
        commit();
        void fadeIn(child.id);
        await sleep(stagger);
      }
      await sleep(FADE_MS);

      framesRef.current.push({
        id: frame.id,
        label: truncateLabel(focus),
        nodes,
      });
      lastDrawnAtRef.current = Date.now();
      queuedDrawsRef.current = queuedDrawsRef.current.filter(
        (f) => f !== focus,
      );

      log({
        type: "draw",
        frameId: frame.id,
        frameLabel: truncateLabel(focus),
        mermaid,
      });

      // The diagram landed on the page we're already looking at, so re-frame
      // the sheet rather than flying off to the frame — no camera jump.
      framePage(false, "structured diagram joined the active visual cluster");
    },
    [commit, fadeIn, framePage, log, turnPage, waitForIdleHands],
  );

  const drainRenderQueue = useCallback(async () => {
    if (renderingRef.current) return;
    renderingRef.current = true;
    try {
      for (;;) {
        const next = renderQueueRef.current.shift();
        if (!next) break;
        await renderBeat(next);
      }
    } finally {
      renderingRef.current = false;
    }
  }, [renderBeat]);

  // ---- undo / clear (client-side, no artist call) --------------------------
  /**
   * "Scratch that" — reverse the last meaningful operation, and only that one.
   *
   * This used to call `clearSketch()`, which removed every id in
   * `sketchRef.ids` — that is every element on the sheet, so a single "scratch
   * that" erased the whole page. Undo is now a pop off the operation history.
   */
  const doUndo = useCallback(() => {
    const board = boardRef.current;
    const op = board.lastMeaningful();
    if (!op) {
      log({ type: "undo" });
      return;
    }
    // A comparison/process move mid-flight must stop touching elements before
    // the revert below patches them back to their pre-move state — undoing
    // out from under a running rAF loop would otherwise let a stale frame
    // resurrect the very positions this undo is trying to remove (Part 17).
    if (conceptMotionRef.current) cancelConceptMotion("undo");
    // Remove it and everything after it that we skipped (camera-only ops).
    const index = board.history.indexOf(op);
    const trailing = board.history.slice(index);
    for (let i = trailing.length - 1; i >= 0; i--) revertOperation(trailing[i]);
    board.history = board.history.slice(0, index);

    lastDrawnAtRef.current = Date.now();
    restoreCompositionCamera(op.compositionBefore);
    log({ type: "undo", operationType: op.type, operationId: op.operationId });
  }, [cancelConceptMotion, log, restoreCompositionCamera, revertOperation]);

  /** "Moving on to the next part" — turn to a clean sheet. */
  const doClear = useCallback(() => {
    // Never delete. The finished page stays where it is, dimmed, so I can pan
    // back to it during the video.
    elementsRef.current = elementsRef.current.map((el) =>
      patch(el, {
        opacity: Math.min((el.opacity as number) ?? 100, CLEAR_OPACITY),
      }),
    );
    commit();
    turnPage("explicit-clear", "speaker asked to clear the board");
    lastDrawnAtRef.current = Date.now();
    log({ type: "clear" });
  }, [commit, log, turnPage]);

  // ---- mic -----------------------------------------------------------------

  /**
   * The terms the recogniser should expect to hear.
   *
   * Ordered by how much they are worth: section titles and concepts the
   * speaker is actively working with, then everything lettered on the page,
   * then the seed vocabulary. Read fresh each time the socket opens.
   */
  const activeTerms = useCallback((): string[] => {
    const board = boardRef.current;
    return keyterms({
      sections: [...board.sections.values()].map((s) => s.title),
      concepts: [...board.concepts.values()]
        .sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt)
        .map((c) => c.label),
      marks: [...marksRef.current.values()]
        .map((m) => m.text ?? m.key)
        .filter(Boolean),
    });
  }, []);

  const refreshTerms = useCallback(() => {
    activeTermsRef.current = activeTerms();
  }, [activeTerms]);
  refreshTermsRef.current = refreshTerms;

  /**
   * Fix what the recogniser misheard, conservatively.
   *
   * Only pulls speech toward terms that are already visible on the board —
   * see lib/vocab.ts for why that restriction is the load-bearing one. Every
   * rewrite is logged, so a session file shows exactly what was changed.
   */
  const correct = useCallback(
    (text: string): string => {
      const { text: fixed, corrections } = correctTranscript(
        text,
        activeTerms(),
      );
      for (const c of corrections) {
        log({
          type: "correction",
          from: c.from,
          to: c.to,
          confidence: Math.round(c.confidence * 100) / 100,
          why: c.why,
        });
      }
      return fixed;
    },
    [activeTerms, log],
  );

  /**
   * A command, whether it arrived on a final or on stable settled interims.
   *
   * One implementation for both entry points on purpose: the early path must
   * do exactly what the late path does, or "scratch that" would mean two
   * different things depending on how fast Deepgram happened to finalise.
   */
  const runVoiceCommand = useCallback(
    (command: LocalVoiceCommand, raw: string, when: "final" | "early") => {
      liveSeqRef.current += 1;
      dropLiveLine();
      liveLagRef.current = { lag: [], render: [], paint: [], streamEpoch: 0, invalid: 0 };
      pendingTextRef.current = "";
      scribePendingRef.current = "";
      settledCountRef.current = 0;
      prevInterimRef.current = [];
      aiAbortRef.current?.abort();
      scribeAbortRef.current?.abort();
      setInterim("");
      commit();
      log({ type: "command", command, rawTranscript: raw, when });
      if (command === "undo") {
        doUndo();
      } else {
        turnPage("explicit-clear", "speaker explicitly requested a new page");
      }
    },
    [commit, doUndo, dropLiveLine, log, turnPage],
  );

  const stampThoughtInk = useCallback((thoughtId: string) => {
    const settled = settledLiveRef.current;
    if (!settled?.ids.length) return;
    thoughtInkRef.current.set(thoughtId, {
      ids: [...settled.ids],
      base: { ...settled.base },
      after: { ...settled.after },
      page: pageRef.current,
    });
    const idSet = new Set(settled.ids);
    elementsRef.current = elementsRef.current.map((el) => {
      if (!idSet.has(el.id)) return el;
      const customData = {
        ...((el.customData as Record<string, unknown> | undefined) ?? {}),
        inpublicThoughtId: thoughtId,
      };
      return patch(el, { customData } as Partial<SceneElement>);
    });
  }, []);

  const inkForThought = useCallback((thought: SettledThought) => {
    const ids = thought.participantThoughtIds?.length ? thought.participantThoughtIds : [thought.id];
    return ids.flatMap((id) => {
      const ink = thoughtInkRef.current.get(id);
      return ink ? [ink] : [];
    });
  }, []);

  const revealVisualReentry = useCallback((bounds: { x: number; y: number; w: number; h: number }, thoughtId: string) => {
    const app = canvasRuntime.readViewport();
    const fits = liveLineFitsViewport(
      { x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h },
      {
        scrollX: Number(app?.scrollX ?? 0),
        scrollY: Number(app?.scrollY ?? 0),
        zoom: app?.zoom ?? 1,
        width: Number(app?.width ?? 0),
        height: Number(app?.height ?? 0),
      },
    );
    if (fits) {
      log({ type: "visual-reentry", event: "camera-suppressed", thoughtId, reason: "already visible" });
    } else {
      log({ type: "visual-reentry", event: "camera-requested", thoughtId });
      framePage(false, "visual re-entry reveal");
    }
  }, [canvasRuntime, framePage, log]);

  /**
   * Meaning Engine V1 (features.meaningEngineV1): applies the canvas
   * operations lib/meaning/reconcile.ts computed for one meaning-engine
   * decision — reconciling against the existing canvas via
   * meaningIdentityRef rather than drawing fresh content every time,
   * same commit()/recordOperation() path every other direct-commit
   * primitive in this file uses.
   */
  /** Fades (never deletes) transcript ink for thoughts the Meaning Engine successfully represented — transcript is working memory, the diagram is the durable expression. Not undo-tracked, same precedent as the settle-flash opacity pulse below: a style change, not a content change. */
  const fadeConsumedTranscript = useCallback((thoughtIds: string[]) => {
    if (!thoughtIds.length) return;
    const idsToFade = new Set<string>();
    for (const thoughtId of thoughtIds) {
      const ink = thoughtInkRef.current.get(thoughtId);
      if (ink) for (const id of ink.ids) idsToFade.add(id);
    }
    if (!idsToFade.size) return;
    elementsRef.current = elementsRef.current.map((el) => (idsToFade.has(el.id) ? patch(el, { opacity: 22 }) : el));
    commit();
  }, [commit]);

  /** When expression ink owns the centre, settled captions drop to a side-rail whisper. */
  const demoteLiveCaptions = useCallback(() => {
    const ids = new Set<string>();
    for (const id of liveLineIdsRef.current) ids.add(id);
    for (const ink of thoughtInkRef.current.values()) {
      if (ink.page !== pageRef.current) continue;
      for (const id of ink.ids) ids.add(id);
    }
    if (!ids.size) return;
    let changed = false;
    elementsRef.current = elementsRef.current.map((el) => {
      if (!ids.has(el.id)) return el;
      const custom = (el.customData as Record<string, unknown> | undefined) ?? {};
      if (custom.inpublicCaption !== true && Number(el.opacity ?? 100) <= 22) return el;
      changed = true;
      return patch(el, {
        opacity: 22,
        customData: { ...custom, inpublicCaption: true },
      } as Partial<SceneElement>);
    });
    if (changed) commit();
  }, [commit]);

  /**
   * Expression Engine V1 (features.expressionEngineV1): puts one finished
   * ScenePlan onto the sheet.
   *
   * Deliberately thin, and that is the point of the whole pipeline sitting
   * upstream. Every visual decision — what exists, what connects, what
   * dominates, where it goes, what shape it takes — was already made by
   * lib/expression/*, deterministically, before this callback runs. What is
   * left here is the board's own business: reconcile against the sheet,
   * record an undo entry, commit, move the camera, fade consumed transcript.
   * Compare applyMeaningUpdate above, which still has to hand a layout, a
   * plan and a wordless flag to its sync function.
   */
  const applyExpressionUpdate = useCallback(async (update: ExpressionLiveUpdate) => {
    const { trace } = update;
    // Monotonic, bumped on entry. The sketch phase below runs detached, so a
    // newer run can overtake it; this is how that late commit knows the scene
    // it was drawing strokes for is no longer the scene on the sheet.
    const runSeq = ++expressionRunSeqRef.current;
    const earliestSettledAt = (() => {
      let earliest = Infinity;
      for (const id of update.consumedIds) {
        const at = expressionSubmittedAtRef.current.get(id);
        if (at !== undefined && at < earliest) earliest = at;
      }
      return Number.isFinite(earliest) ? earliest : null;
    })();
    const settledToUpdatedMs = earliestSettledAt !== null ? Date.now() - earliestSettledAt : undefined;
    if (trace.timings.extractMs !== undefined) latency.observe("expression_extract", trace.timings.extractMs);
    latency.observe("expression_deterministic", trace.timings.deterministicMs);
    log({
      type: "expression",
      event: "updated",
      // Which of the three paths drew this: `reflex-*` (no model),
      // `anticipate-*` (partial speech, entities only) or a settled
      // thought's own id. Without it the log shows three kinds of growth as
      // one, and the whole point of the middle path is that the gap between
      // the other two is visible.
      thoughtId: trace.input.id,
      intent: trace.intent.primary,
      grammar: trace.plan.grammar,
      mode: trace.mode,
      reason: trace.plan.reason,
      preservation: trace.evaluation.semanticPreservation,
      problems: trace.evaluation.problems.map((p) => p.type),
      interpretation: trace.world.interpretation,
      settledToUpdatedMs,
      extractMs: trace.timings.extractMs,
      cacheCreationTokens: trace.extractUsage?.cacheCreationInputTokens,
      cacheReadTokens: trace.extractUsage?.cacheReadInputTokens,
      deterministicMs: trace.timings.deterministicMs,
    });

    // The evaluator's verdict is worth logging loudly on the live path: a
    // scene that invented a relation is saying something the speaker did not,
    // and that is the one failure worth interrupting a session log for.
    if (trace.evaluation.inventedRelations.length) {
      log({ type: "expression", event: "invented-relation", detail: trace.evaluation.inventedRelations.join("; ") });
    }

    // ?debug=1: prove the pipeline in isolation. onTrace has already recorded
    // the full run by now — stop before any Excalidraw write or camera move.
    if (xeDebugOnly) {
      settleExpressionPendingRef.current(update.consumedIds);
      return;
    }

    try {
    // Diagnostics for automatic page-turn churn (docs/EXPRESSION-ENGINE-LIVE-EVAL-1-REPORT.md,
    // finding #6) — computed here, where the world/plan/scene are all in
    // scope, and merged with the geometry facts the Canvas boundary itself
    // knows (only it sees the pen and the region it needs) when onOverflow
    // actually fires below. Every field the brief asked to instrument comes
    // from data already computed by this point; nothing new is inferred.
    const activeTopic = trace.plan.focusEntityId ?? trace.intent.focusEntityId;
    const topicChanged = lastExpressionTopicRef.current !== undefined && activeTopic !== lastExpressionTopicRef.current;
    const renderOperationCount =
      trace.patch.added.length +
      trace.patch.moved.length +
      trace.patch.updated.length +
      trace.patch.removed.length +
      trace.patch.connectorsAdded.length +
      trace.patch.connectorsRemoved.length +
      trace.patch.connectorsRerouted.length;
    // pipeline.ts's exact fallback message when ExpressionPlanSchema.safeParse
    // rejects the plan (plan.ts) — the one other signal, besides the patch
    // being empty, that this round's plan was not what it should have been.
    const planValidationFailed = trace.plan.reason.startsWith("grammar ") && trace.plan.reason.includes("produced an invalid plan");

    const msSincePreviousTurn =
      lastExpressionPageTurnAtRef.current !== null ? Date.now() - lastExpressionPageTurnAtRef.current : null;
    const overflowPolicy = {
      topicChanged,
      msSincePreviousTurn,
      insetRight: LIVE_CAPTION_RAIL_W,
    };
    const onOverflow = (info: OverflowInfo) => {
      const decision = decideExpressionOverflow({
        neededW: info.neededW,
        neededH: info.neededH,
        alreadyOnThisPage: info.alreadyOnThisPage,
        topicChanged,
        msSincePreviousTurn,
        fitsBlankPage: true,
      });
      log({
        type: "expression",
        event: "page-turn",
        trigger: "overflow",
        msSincePreviousTurn,
        activeTopic: activeTopic ?? null,
        topicChanged,
        pageOccupancy: trace.scene.objects.length,
        pageCapacity: REGION_BUDGET,
        newSemanticEntities: trace.ops.filter((op) => op.kind === "ADD_ENTITY").length,
        newVisibleEntities: trace.patch.added.length,
        removedVisibleEntities: trace.patch.removed.length,
        planValidationFailed,
        scenePlanDiff: describePatch(trace.patch),
        renderOperationCount,
        overflow: { neededW: info.neededW, neededH: info.neededH, pen: info.pen, pageIndex: info.pageIndex },
        suppressed: !decision.turn,
        suppressReason: decision.turn ? undefined : decision.reason,
      });
      if (!decision.turn) return;
      lastExpressionPageTurnAtRef.current = Date.now();
      turnPage("overflow", "expression scene does not fit on the current sheet");
    };
    lastExpressionTopicRef.current = activeTopic;

    // PHASE 1 — STRUCTURE. The diagram goes down now, drawn with whatever
    // sketches are already in hand and none of the ones that are not.
    //
    // This used to await resolveSketches first, on the reasoning that a
    // sketch arriving after the elements were written would not be drawn
    // until some later sentence happened to dirty the same node. That
    // reasoning was sound and the ordering was not: a real 137-second
    // session measured 17-30s between the trace being ready and any ink
    // appearing, ~77% of the wall clock, because the fastest part of the
    // system was waiting on the slowest (docs/EXPRESSION-ENGINE-RESEARCH-BRIEF.md).
    // The fix is not to wait — it is to make the sketch's ARRIVAL dirty the
    // node, which is what phase 2 below does.
    //
    // Cached sketches are not "later": they cost nothing, so they belong in
    // the first frame. Only keys the client has never seen defer.
    const pendingKeys = pendingSketchKeys(trace.scene.objects, expressionSketchCacheRef.current);
    const structurePage = pageRef.current;
    const syncStartedAt = Date.now();

    const { elements: nextElements, addedIds, removedIds, updatedIds, skipped } = await canvasRuntime.applyExpression({
      scene: trace.scene,
      patch: trace.patch,
      elements: elementsRef.current,
      pen: penRef.current,
      pageIndex: structurePage,
      onOverflow,
      sketches: expressionSketchCacheRef.current,
      overflowPolicy,
    });

    // A scene the renderer refused to draw is a failure, not a quiet round —
    // it must read as one in the log (Break B).
    if (skipped) log({ type: "expression", event: "failed", detail: `render skipped: ${skipped}` });

    let structureWritten = false;
    if (addedIds.length || removedIds.length || updatedIds.length) {
      const goneIds = new Set([...removedIds, ...updatedIds]);
      const removedElements = elementsRef.current.filter((el) => goneIds.has(el.id));
      elementsRef.current = nextElements;
      const undo = emptyUndo();
      undo.addedElementIds = [...addedIds, ...updatedIds];
      undo.removedElements = removedElements;
      recordOperation("expression_engine", undo, { sourceText: trace.world.interpretation ?? "" });
      commit();
      structureWritten = true;

      const syncMs = Date.now() - syncStartedAt;
      const settledToStructureMs = earliestSettledAt !== null ? Date.now() - earliestSettledAt : undefined;
      latency.observe("expression_sync", syncMs);
      if (settledToStructureMs !== undefined) latency.observe("expression_structure", settledToStructureMs);
      log({
        type: "expression",
        event: "rendered",
        phase: "structure",
        patch: describePatch(trace.patch),
        syncMs,
        settledToStructureMs,
      });

      // Only newly ADDED ink pulls the camera. Re-framing on a reposition
      // would drag the view every time the layout breathed, which is exactly
      // the jitter that makes a live board unwatchable.
      const bounds = boundsOf(nextElements, addedIds);
      if (bounds) revealVisualReentry(bounds, "expression-engine");
    }

    if (trace.scene.objects.length) {
      expressionHasInkRef.current = true;
      demoteLiveCaptions();
    }

    fadeConsumedTranscript(update.consumedIds);

    // PHASE 2 — DETAIL. Detached on purpose: nothing above waits for it, and
    // the pending affordance clears in the `finally` below, so the board
    // reads as done the moment the structure is on the sheet.
    //
    // Skipped entirely when phase 1 wrote nothing — without a first frame
    // there is no identity for these ids, so a sketch commit would arrive as
    // a batch of ADDED elements (camera-worthy ink) rather than as an upgrade
    // to nodes already being watched.
    if (structureWritten && pendingKeys.length) {
      void (async () => {
        const sketchStartedAt = Date.now();
        try {
          await resolveSketches(trace.scene.objects, expressionSketchCacheRef.current, (event) =>
            log({
              type: "expression",
              event: "sketch",
              sketchKey: event.key,
              outcome: event.outcome,
              ms: event.ms,
              strokes: event.strokes,
              rejectedReason: event.rejectedReason,
            }),
          );
        } catch (error) {
          log({ type: "expression", event: "failed", detail: `sketch resolution: ${error instanceof Error ? error.message : String(error)}` });
          return;
        }
        const sketchMs = Date.now() - sketchStartedAt;
        latency.observe("expression_sketch", sketchMs);

        // Two ways this commit can be stale, both of which make it wrong
        // rather than merely late. A newer run has already composed a
        // different scene onto these ids; or the page turned underneath us,
        // in which case Canvas reconciliation would reserve a fresh origin and
        // silently redraw the whole diagram somewhere else.
        if (expressionRunSeqRef.current !== runSeq || pageRef.current !== structurePage) {
          log({ type: "expression", event: "sketch", outcome: "fetched", ms: sketchMs, superseded: true });
          return;
        }

        const upgraded = await canvasRuntime.applyExpression({
          scene: trace.scene,
          patch: trace.patch,
          elements: elementsRef.current,
          pen: penRef.current,
          pageIndex: structurePage,
          // Decoration must never turn a page. The region was reserved in
          // phase 1 and the scene's footprint has not changed, so this is
          // unreachable — it is here so that if it ever does fire it is
          // recorded as suppressed rather than silently relocating the
          // diagram.
          onOverflow: () => log({ type: "expression", event: "page-turn", trigger: "overflow", suppressed: true, suppressReason: "sketch upgrade must not turn the page" }),
          sketches: expressionSketchCacheRef.current,
          overflowPolicy,
        });

        if (!upgraded.addedIds.length && !upgraded.removedIds.length && !upgraded.updatedIds.length) return;
        const goneIds = new Set([...upgraded.removedIds, ...upgraded.updatedIds]);
        const removedElements = elementsRef.current.filter((el) => goneIds.has(el.id));
        elementsRef.current = upgraded.elements;
        const undo = emptyUndo();
        undo.addedElementIds = [...upgraded.addedIds, ...upgraded.updatedIds];
        undo.removedElements = removedElements;
        recordOperation("expression_engine", undo, { sourceText: trace.world.interpretation ?? "" });
        commit();

        // No revealVisualReentry. A sketch commit DOES produce added ids —
        // every stroke is its own element — so the camera would have real
        // bounds to fly to. It must not: the viewer is already looking at
        // this node, and yanking the view because an icon finished drawing
        // is the jitter the whole two-phase split exists to avoid.
        log({ type: "expression", event: "rendered", phase: "sketch", patch: describePatch(trace.patch), ms: sketchMs });
      })();
    }
    } finally {
      settleExpressionPendingRef.current(update.consumedIds);
    }
  }, [canvasRuntime, commit, demoteLiveCaptions, fadeConsumedTranscript, log, recordOperation, revealVisualReentry, turnPage, xeDebugOnly]);

  useEffect(() => {
    applyExpressionUpdateRef.current = applyExpressionUpdate;
  }, [applyExpressionUpdate]);

  const settleExpressionPending = useCallback((consumedIds: string[]) => {
    const elapsed = (() => {
      let earliest = Infinity;
      for (const id of consumedIds) {
        const at = expressionSubmittedAtRef.current.get(id);
        if (at !== undefined && at < earliest) earliest = at;
      }
      return Number.isFinite(earliest) ? Date.now() - earliest : undefined;
    })();
    if (elapsed !== undefined) latency.observe("settled_to_expression", elapsed);
    for (const id of consumedIds) {
      expressionPendingIdsRef.current.delete(id);
      expressionSubmittedAtRef.current.delete(id);
    }
    const still = expressionPendingIdsRef.current.size > 0 || Boolean(expressionControllerRef.current?.hasPending());
    setExpressionPending(still);
  }, []);
  settleExpressionPendingRef.current = settleExpressionPending;

  /** Buffers this settled thought into the Expression Engine's debounced cadence — see lib/expression/live.ts. */
  const handleSettledExpression = useCallback((thought: SettledThought) => {
    expressionPendingIdsRef.current.add(thought.id);
    expressionSubmittedAtRef.current.set(thought.id, Date.now());
    setExpressionPending(true);
    log({ type: "expression", event: "submitted", thoughtId: thought.id, text: thought.text });
    expressionControllerRef.current?.submit({ id: thought.id, text: thought.text });
  }, [log]);


  /**
   * Guards against a command running twice.
   *
   * An early command is followed a few hundred milliseconds later by the final
   * carrying the same words. Without this, "scratch that" would undo two
   * operations — the second of which the speaker never asked to lose.
   */
  const firedCommandRef = useRef("");

  const handleFinal = useCallback(
    (raw: string, tStart: number, tEnd: number, audioEndMs: number, streamEpoch: number, timing?: DeepgramResultTiming) => {
      const command = localVoiceCommand(raw);
      if (command) {
        const already = firedCommandRef.current;
        firedCommandRef.current = "";
        // Already handled from settled interims. Swallow the final so the
        // command does not run a second time.
        if (already && already === raw.trim().toLowerCase()) return;
        runVoiceCommand(command, raw, "final");
        return;
      }
      firedCommandRef.current = "";
      lastAudioEndMsRef.current = audioEndMs;
      const text = correct(raw);
      // Layer C of the speech audit: what InPublic committed, next to what
      // Deepgram actually said. Dev-only, constant-false in production.
      if (sttDebug.enabled) sttDebug.recordLayer("C", text, raw === text ? "verbatim" : `corrected from: ${raw}`);
      finalsRef.current.push({ text, tStart, tEnd });
      // Trim: when the beat keeps skipping, unbounded pendingText makes an
      // ordinary monologue look like endless restarting, which biases it to
      // skip even harder.
      pendingTextRef.current = `${pendingTextRef.current} ${text}`
        .trim()
        .split(/\s+/)
        .slice(-MAX_PENDING_WORDS)
        .join(" ");
      // Hand over only what the interims hadn't already settled, so the same
      // words aren't scribed twice.
      const words = text.trim().split(/\s+/).filter(Boolean);
      const unsent = words.slice(settledCountRef.current).join(" ");
      if (unsent) {
        scribePendingRef.current = `${scribePendingRef.current} ${unsent}`.trim();
        // Layer D: the text actually handed to the reasoning/visual layer.
        if (sttDebug.enabled) sttDebug.recordLayer("D", unsent, "to scribe");
      }
      settledCountRef.current = 0;
      prevInterimRef.current = [];
      // The utterance is over, so the reflex's "I already drew this" memory
      // is about a sentence that no longer exists. The world keeps what it
      // learned; only the dedupe resets.
      expressionControllerRef.current?.endReflexUtterance();

      log({ type: "transcript", text, rawTranscript: raw, normalizedTranscript: text, displayTranscript: text });
      setInterim("");

      // V2/V3 INVARIANT (docs/LIVE-SPEECH-PRESENTATION-V2.md, "Active Thought" /
      // "Settled Thought"): fold consecutive finals belonging to one
      // unfinished thought into a bounded growing block instead of one row
      // per final. Presentation uses its own conservative deterministic
      // boundary policy; Story Mode's structural policy remains untouched.
      //
      // `settledForLive` tracks thought completion, not "this is a final": a
      // final that doesn't complete the thought is passed to writeLive as
      // NOT settled, so it keeps the interim (soft) colour, its own anchor
      // stays live, and the camera hold stays up. Settled here means only
      // "structurally complete enough to stop mutating this block" — not a
      // semantic judgement. liveRef.current is never cleared mid-thought, so
      // every continuing final/interim patches the same anchored element via
      // writeLive's own `ours` check; no extra anchoring code needed here.
      const v3SettledThoughts: SettledThought[] = [];
      let v3PendingText = "";
      if (v2Enabled) {
        const priorThought = v2ThoughtRef.current;
        const receivedAt = now();
        const pushed = pushPresentationSegment(priorThought, text, receivedAt);
        v2ThoughtStreamEpochRef.current = streamEpoch;
        const segmentRegion = {
          audioStartMs: Math.max(0, audioEndMs - Math.max(0, tEnd - tStart)),
          audioEndMs,
        };
        const priorRegion = v2ThoughtSourceRegionRef.current;
        const sourceRegion = priorRegion ? {
          audioStartMs: Math.min(priorRegion.audioStartMs, segmentRegion.audioStartMs),
          audioEndMs: Math.max(priorRegion.audioEndMs, segmentRegion.audioEndMs),
        } : segmentRegion;
        v2ThoughtRef.current = pushed.state;
        v3PendingText = pushed.state.text;
        v2ThoughtSourceRegionRef.current = pushed.state.text ? sourceRegion : null;
        for (const boundary of pushed.decisions) {
          log({ type: "thought-boundary", ...boundary });
        }
        for (const emission of pushed.thoughts) {
          const thoughtId =
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `thought-${receivedAt}-${v3SettledThoughts.length}`;
          const settledThought: SettledThought = {
            id: thoughtId,
            text: emission.text,
            sourceSegments: emission.rawSegments.length ? emission.rawSegments : [emission.text],
            page: pageRef.current,
            startedAt: emission.heldSince || receivedAt,
            settledAt: receivedAt,
            sessionGeneration: streamEpoch,
            sourceRegion,
          };
          v3SettledThoughts.push(settledThought);
          log({
            type: "thought",
            rawSegments: settledThought.sourceSegments,
            merged: emission.text,
            heldMs: emission.heldSince ? Math.max(0, now() - emission.heldSince) : 0,
          });
          log({
            type: "settled-thought",
            thoughtId,
            text: emission.text,
            sourceSegments: settledThought.sourceSegments,
            startedAtMs: settledThought.startedAt ?? receivedAt,
            settledAtMs: receivedAt,
            pageId: pageRef.current,
            sessionId: sessionIdRef.current,
            sessionGeneration: streamEpoch,
            sourceRegion,
          });
        }
      }

      // Lock the line Deepgram just committed to. Everything below this runs
      // behind the writing, not in front of it — writeLive's own promise
      // resolves only after `commit()` has already dispatched the ink, so the
      // pulse below strictly follows it, never fronts it.
      const epochAtSettle = liveSeqRef.current;
      const finalTiming = { audioEndMs, streamEpoch, ...timing, kind: "final" as const };
      let writeLiveDone: Promise<void>;
      if (v2Enabled) {
        // V3 changes only permanence. Every interim still reaches writeLive
        // immediately above; a final may now lock one or more completed
        // prefixes and leave an unresolved tail on a fresh live anchor.
        writeLiveDone = (async () => {
          if (v3SettledThoughts.length === 0) {
            await writeLive(v3PendingText || text, false, finalTiming);
            return;
          }
          for (let i = 0; i < v3SettledThoughts.length; i += 1) {
            const thought = v3SettledThoughts[i];
            const isLastVisibleWrite = i === v3SettledThoughts.length - 1 && !v3PendingText;
            await writeLive(thought.text, true, isLastVisibleWrite ? finalTiming : undefined);
            stampThoughtInk(thought.id);
            log({ type: "v2", event: "pop-suppressed" });
            if (xeEnabled) handleSettledExpression(thought);
          }
          if (v3PendingText) await writeLive(v3PendingText, false, finalTiming);
        })();
      } else {
        writeLiveDone = writeLive(text, true, finalTiming).then(() => undefined);
        void writeLiveDone.then(() => {
          if (liveSeqRef.current !== epochAtSettle) return;
          const ids = settledLiveRef.current?.ids;
          if (!ids?.length) return;
          // A brief, subtle settle flash on the line that just locked in —
          // Part 5's "give existing truthful information temporal life", not a
          // new mark and not new content. Never fires ahead of the ink itself:
          // it only starts once writeLive's own commit() already ran.
          const idSet = new Set(ids);
          const steps = [
            ...opacityPulse(100, 65, 1, 90),
            ...opacityPulse(65, 100, 1, 90).map((s) => ({ ...s, delayMs: s.delayMs + 90 })),
          ];
          runPulse(
            steps,
            (opacity) => {
              elementsRef.current = elementsRef.current.map((el) =>
                idSet.has(el.id) ? patch(el, { opacity }) : el,
              );
              commit();
            },
            () => liveSeqRef.current !== epochAtSettle,
          );
        });
      }
    },
    [correct, log, now, runVoiceCommand, stampThoughtInk, v2Enabled, writeLive],
  );

  const flushPresentationBoundary = useCallback(async () => {
    if (!v2ThoughtRef.current.text.trim()) return;
    const receivedAt = now();
    const flushed = flushPresentationThought(v2ThoughtRef.current, receivedAt);
    const sourceRegion = v2ThoughtSourceRegionRef.current ?? undefined;
    const sessionGeneration = v2ThoughtStreamEpochRef.current;
    v2ThoughtRef.current = flushed.state;
    v2ThoughtSourceRegionRef.current = null;
    for (const boundary of flushed.decisions) log({ type: "thought-boundary", ...boundary });
    for (let index = 0; index < flushed.thoughts.length; index += 1) {
      const emission = flushed.thoughts[index];
      const thoughtId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `thought-flush-${receivedAt}-${index}`;
      const thought: SettledThought = {
        id: thoughtId,
        text: emission.text,
        sourceSegments: emission.rawSegments.length ? emission.rawSegments : [emission.text],
        page: pageRef.current,
        startedAt: emission.heldSince || receivedAt,
        settledAt: receivedAt,
        sessionGeneration,
        sourceRegion,
      };
      log({
        type: "thought",
        rawSegments: thought.sourceSegments,
        merged: thought.text,
        heldMs: emission.heldSince ? Math.max(0, receivedAt - emission.heldSince) : 0,
      });
      log({
        type: "settled-thought",
        thoughtId,
        text: thought.text,
        sourceSegments: thought.sourceSegments,
        startedAtMs: thought.startedAt ?? receivedAt,
        settledAtMs: receivedAt,
        pageId: pageRef.current,
        sessionId: sessionIdRef.current,
        sessionGeneration,
        sourceRegion,
      });
      await writeLive(thought.text, true);
      stampThoughtInk(thought.id);
      log({ type: "v2", event: "pop-suppressed" });
      if (xeEnabled) handleSettledExpression(thought);
    }
  }, [handleSettledExpression, log, now, stampThoughtInk, writeLive, xeEnabled]);

  const handleInterim = useCallback(
    (text: string, audioEndMs: number, streamEpoch: number, confidence = 0, timing?: DeepgramResultTiming) => {
      if (!text.trim()) {
        setInterim("");
        return;
      }
      // Correct what is DRAWN, not what is tracked. The settled-word logic
      // below compares consecutive interims word by word, and a correction
      // that changes a word count between two interims would desynchronise
      // it — so the raw stream stays the source of truth for bookkeeping and
      // the corrected text is only what reaches the sheet.
      //
      // No log here: interims are revised several times a second and every
      // one of them would emit a correction event for the same rewrite. The
      // final is where a correction gets recorded.
      lastAudioEndMsRef.current = audioEndMs;
      const shown = correctTranscript(text, activeTermsRef.current).text || text;
      const paintStarted = performance.now();
      const timingBucket = liveLagRef.current;
      setInterim(shown);
      // Double rAF: the browser guarantees the *first* callback runs before
      // the next paint, which only proves a frame was scheduled. The frame
      // actually reaches the screen sometime between that callback returning
      // and the *second* callback running, so the second timestamp is the
      // closest thing the DOM API gives us to "the user could have seen it".
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const paint = Math.round(performance.now() - paintStarted);
          timingBucket.paint.push(paint);
          latency.observe("paint", paint);
        });
      });
      // Put each provider interim on the sheet immediately: no model, no
      // throttle, and no wait for finalization.
      //
      // V2 only: if a thought is currently held open across finals (see
      // handleFinal), preview this interim as a continuation of it — same
      // prefix. The anchor itself needs no extra code here: a final that
      // doesn't complete the thought is passed to writeLive as NOT settled
      // (handleFinal), so liveRef.current is never cleared mid-thought and
      // this interim patches the same element through writeLive's own
      // existing `ours` check, same as any other interim.
      const shownForLive = v2ThoughtRef.current.text
        ? `${v2ThoughtRef.current.text} ${shown}`.trim()
        : shown;
      void writeLive(shownForLive, false, { audioEndMs, streamEpoch, ...timing, kind: "interim" });

      // Latency vs. accuracy. Waiting for a final costs 1-3s; lettering the
      // raw interim draws Deepgram's guesses, which it then revises. The
      // middle path: a word is "settled" once two consecutive interims agree
      // on it. That usually takes one update (~100-300ms) and is stable.
      const words = text.trim().split(/\s+/).filter(Boolean);
      const prev = prevInterimRef.current;
      let common = 0;
      while (common < words.length && common < prev.length && words[common] === prev[common]) {
        common++;
      }
      prevInterimRef.current = words;

      // A closed-set command, fired without waiting for the final.
      //
      // The bar is deliberately high: the whole utterance must be settled
      // (every word agreed by two consecutive interims, and no new words since)
      // AND must match a command phrase exactly. "scratch that idea" fails
      // because it is not equal to any command; "scratch" fails for the same
      // reason. See lib/liveSpeech.ts earlyVoiceCommand for the argument.
      const fullySettled = common === words.length && common === prev.length && common > 0;
      if (fullySettled) {
        const early = earlyVoiceCommand(text);
        const key = text.trim().toLowerCase();
        if (early && firedCommandRef.current !== key) {
          firedCommandRef.current = key;
          runVoiceCommand(early, text, "early");
          return;
        }
      }

      // Hand settled words to the Scribe, but do NOT wake it here. It used to
      // fire mid-utterance because it was the only thing writing; now the live
      // line is, and a mark placed while the line is still growing lands
      // straight through it. The Scribe runs on finals — behind the writing.
      if (common > settledCountRef.current) {
        const fresh = words.slice(settledCountRef.current, common).join(" ");
        settledCountRef.current = common;
        // THE FAST PATH (lib/expression/fast/reflex.ts).
        //
        // Everything else below waits for a settled THOUGHT; this waits only
        // for a settled WORD — two consecutive interims agreeing, which the
        // block above has already established and which costs ~100-300ms
        // rather than the clause boundary plus debounce plus model call that
        // handleSettledExpression pays. Nothing is drawn unless the reflex
        // is certain, and the settled thought still follows behind it and
        // still owns the structure. This is what makes "as soon as I start
        // speaking" and "when I say 'I'" literally true instead of
        // approximately true.
        if (xeEnabled) {
          const settledSoFar = words.slice(0, common).join(" ");
          expressionControllerRef.current?.reflex(settledSoFar);
          // THE MIDDLE PATH (lib/expression/live.ts's `anticipate`).
          //
          // The reflex answers the first word and then has nothing more to
          // say; the settled thought answers everything, three to four
          // seconds later. In between, the board used to hold completely
          // still. This reads the same growing prefix with the real
          // extractor and folds its NOUNS ONLY — rationed to one call every
          // 1.4s, abandoned as soon as the settled thought is buffered, and
          // never allowed to draw a relation, which stays the settled run's
          // to own. Nearly every call here is refused by that ration; the
          // controller decides, so this stays one line.
          expressionControllerRef.current?.anticipate(settledSoFar);
        }
        if (fresh) {
          scribePendingRef.current = `${scribePendingRef.current} ${fresh}`.trim();
        }
      }
    },
    [runVoiceCommand, writeLive],
  );

  /** Gemini engine: marks the model asked for, straight off the socket. */
  const handleLiveOps = useCallback(
    async (ops: Op[]) => {
      const drawn: string[] = [];
      for (const op of ops) {
        if (!(await applyOp(op))) continue;
        drawn.push(
          op.op === "icon"
            ? `icon ${op.name}`
            : "text" in op
              ? `${op.op} "${op.text}"`
              : op.op,
        );
      }
      if (drawn.length) log({ type: "sketch", labels: drawn });
    },
    [applyOp, log],
  );

  /**
   * Gemini engine: what it heard. Feeds the strip, the log and the wrap-up —
   * never the drawing, which the model is already doing itself.
   */
  const handleLiveTranscript = useCallback(
    (text: string, isFinal: boolean) => {
      if (!isFinal) {
        liveUtteranceRef.current += text;
        setInterim(liveUtteranceRef.current.trim().slice(-160));
        // Same live line as the Deepgram path. Gemini's own drawing still
        // arrives only at end-of-turn, but the words no longer wait for it.
        void writeLive(liveUtteranceRef.current, false);
        return;
      }
      const utterance = liveUtteranceRef.current.trim();
      liveUtteranceRef.current = "";
      setInterim("");
      if (!utterance) return;
      const command = localVoiceCommand(utterance);
      if (command) {
        liveSeqRef.current += 1;
        dropLiveLine();
        pendingTextRef.current = "";
        scribePendingRef.current = "";
        commit();
        log({ type: "command", command, rawTranscript: utterance });
        if (command === "undo") {
          doUndo();
        } else {
          turnPage("explicit-clear", "speaker explicitly requested a new page");
        }
        return;
      }
      void writeLive(utterance, true);

      const t = now();
      finalsRef.current.push({ text: utterance, tStart: t, tEnd: t });
      pendingTextRef.current = `${pendingTextRef.current} ${utterance}`
        .trim()
        .split(/\s+/)
        .slice(-MAX_PENDING_WORDS)
        .join(" ");
      log({ type: "transcript", text: utterance });
    },
    [commit, doUndo, dropLiveLine, log, now, turnPage, writeLive],
  );

  const handleSessionStart = useCallback(() => {
    if (t0Ref.current === null) {
      t0Ref.current = Date.now();
      lastDrawnAtRef.current = Date.now();
    }
  }, []);

  const deepgram = useDeepgram({
    onFinal: handleFinal,
    onInterim: handleInterim,
    onSessionStart: handleSessionStart,
    now,
    sessionId: () => sessionIdRef.current,
    keyterms: activeTerms,
    onKeyterms: (terms) => log({ type: "keyterms", terms }),
    onStreamMetrics: (metrics) => log({ type: "speech-stream", ...metrics }),
    onNote: (text) => log({ type: "note", text }),
    onError: (message) => {
      setErrorText(message);
      if (message) log({ type: "error", where: "deepgram", text: message });
    },
    enabled: ENGINE === "deepgram",
  });

  const gemini = useGeminiLive({
    onOps: handleLiveOps,
    onTranscript: handleLiveTranscript,
    onSessionStart: handleSessionStart,
    onNote: (text) => log({ type: "note", text }),
    enabled: ENGINE === "gemini",
  });

  const engine =
    ENGINE === "gemini"
      ? { status: gemini.status, start: gemini.start, stop: gemini.stop, prewarm: undefined }
      : { status: deepgram.status, start: deepgram.start, stop: deepgram.stop, prewarm: deepgram.prewarm };
  const status = engine.status;
  const stopEngine = engine.stop;
  const startEngine = engine.start;
  const prewarmEngine = engine.prewarm;
  const usage = useUsageSession({
    projectId: useCallback(() => sessionIdRef.current, []),
    mode: useCallback(() => modeRef.current, []),
    onForcedStop: useCallback(() => stopEngine(), [stopEngine]),
    onWarning: useCallback((message: string) => setErrorText(message), []),
    anonymous: guest,
  });
  const toggle = useCallback(async () => {
    const listening = status === "live" || status === "connecting" || status === "reconnecting";
    if (listening) {
      stopEngine();
      await flushPresentationBoundary();
      // usage.stop() clears the active-session id as its first action, so it
      // hands the id back here rather than leaving it to be re-read from the
      // (by-then-null) global — see hooks/useUsageSession.ts.
      const stoppedUsageSessionId = await usage.stop("paused");
      // One summary per listening session, written after the socket is gone
      // so it can never contend with the live path.
      const summary = latency.summary();
      summary.mode = modeRef.current;
      summary.sessionId = sessionIdRef.current;
      log({ type: "latency", ...summary });
      // Root-cause traces: only useDeepgram (not the dormant Gemini engine)
      // collects these — see hooks/useDeepgram.ts's getDiagnosticTraces.
      const traces = deepgram.getDiagnosticTraces?.() ?? null;
      recordLatencySummary(summary, stoppedUsageSessionId, traces, !guest);
      latency.reset();
      return;
    }
    latency.reset();
    latency.mark("start_pressed", latencyNow());
    // Not awaited: the autosave flush is a write of work already on the
    // canvas and has nothing to do with opening a microphone. Awaiting it put
    // a persistence round trip in front of every press.
    void autosaveRef.current?.flushNow();
    await startListeningSession(
      async () => {
        const ok = await usage.start();
        if (ok) {
          latency.mark("lease_ready", latencyNow());
          if (guest) { visualSessionStartedAtRef.current = Date.now(); firstVisualFiredRef.current = false; }
        }
        return ok;
      },
      startEngine,
      usage.stop,
      prewarmEngine,
      usage.renew,
    );
  }, [deepgram, flushPresentationBoundary, guest, log, prewarmEngine, startEngine, status, stopEngine, usage]);

  const runReplayExperiment = useCallback(async (
    experimentMode: ReplayExperimentMode,
    file: File | ReplayPreparedSource,
    round: number,
    disconnectPlan: ReplayDisconnectPlan = { atAudioMs: [] },
    replayOptions: ReplayStartOptions = {},
  ): Promise<ReplayRunReport> => {
    if (!replayLabEnabled || ENGINE !== "deepgram") throw new Error("The replay lab requires the development Deepgram engine.");
    if (status !== "idle") throw new Error("Stop the active microphone session before replaying audio.");

    // Clean, equivalent state for every run. This intentionally resets only
    // session-owned state; feature configuration and production behavior are
    // not mutated by the lab.
    aiAbortRef.current?.abort();
    scribeAbortRef.current?.abort();
    if (cameraMotionRef.current) cancelAnimationFrame(cameraMotionRef.current.rafId);
    cameraMotionRef.current = null;
    cameraProposalSequenceRef.current = 0;
    cameraAnimationSequenceRef.current = 0;
    cameraPageGenerationRef.current = 0;
    cameraEventCycleSequenceRef.current = 0;
    pendingPageArrivalTransitionRef.current = null;
    pendingPageArrivalCameraRef.current = null;
    compositionRef.current = initialCompositionState();
    canvasRuntime.applyViewport({ scrollX: 0, scrollY: 0, zoom: 1 });
    elementsRef.current = [];
    canvasRuntime.resetExpressionIdentity();
    expressionHasInkRef.current = false;
    captionCursorRef.current = null;
    expressionPendingIdsRef.current.clear();
    expressionSubmittedAtRef.current.clear();
    setExpressionPending(false);
    expressionControllerRef.current?.reset();
    boardRef.current = new SemanticBoard();
    pageRef.current = 0;
    pagePensRef.current = new Map();
    penRef.current = newPagePen(0);
    marksRef.current = new Map();
    renderedMarkKeysRef.current = new Set();
    decorationsRef.current = new Set();
    conceptElementRef.current = new Map();
    conceptPageRef.current = new Map();
    framesRef.current = [];
    finalsRef.current = [];
    pendingTextRef.current = "";
    liveUtteranceRef.current = "";
    liveRef.current = null;
    settledLiveRef.current = null;
    thoughtInkRef.current.clear();
    liveLineIdsRef.current = new Set();
    liveSeqRef.current += 1;
    v2ThoughtRef.current = EMPTY_PRESENTATION_THOUGHT;
    v2ThoughtStreamEpochRef.current = 0;
    v2ThoughtSourceRegionRef.current = null;
    prevInterimRef.current = [];
    settledCountRef.current = 0;
    replayDecisionWindowsRef.current = [];
    replayDecisionOpenRef.current = new Map();
    replayMaxConcurrencyRef.current = 0;
    setInterim("");
    commit();

    const logStart = logRef.current.length;
    const samples: LatencySampleEvent[] = [];
    const unsubscribe = latency.subscribe((sample) => samples.push(sample));
    latency.reset();
    t0Ref.current = Date.now();
    latency.mark("start_pressed", latencyNow());
    replayModeRef.current = experimentMode;
    const startedAt = new Date().toISOString();
    try {
      // Replay obtains a short-lived server-validated development capability
      // inside useDeepgram. It deliberately does not start/renew/end a product
      // usage session, so regression rounds cannot consume user or trial time.
      latency.mark("lease_ready", latencyNow());
      const audio = await deepgram.startReplay(file, disconnectPlan, replayOptions);
      await flushPresentationBoundary();
      // Each benchmark run needs a fresh capability/credential. Reusing a
      // partially aged token can close an 87.96-second second run even though
      // a freshly issued 180-second replay token is long enough.
      deepgram.stop(false);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

      const summary = latency.summary();
      summary.mode = experimentMode;
      summary.sessionId = sessionIdRef.current;
      const runEvents = logRef.current.slice(logStart);
      const corpusEvidence = buildCorpusEvidence(runEvents);
      const events = runEvents.filter((event): event is Extract<LogEvent, { type: "visual-reentry" }> => event.type === "visual-reentry");
      const decisionLatencies = events.flatMap((event) => event.event === "decision-cause-effect" && event.decisionLatencyMs !== undefined ? [event.decisionLatencyMs] : []);
      const sourceLatency = (field: "candidateCompleteToDurableReadyMs" | "candidateCompleteToCommitMs") => ({
        deterministic_fast_path: (() => {
          const values = events.flatMap((event) => event.decisionSource === "deterministic_fast_path" && event[field] !== undefined ? [event[field]] : []);
          return { count: values.length, p50: percentile(values, .5), p95: percentile(values, .95) };
        })(),
      });
      const settledThoughtCount = corpusEvidence.settledThoughts.length;
      const candidateAcceptedCount = events.filter((event) => event.event === "candidate-accepted").length;
      const visualDecisionCount = events.filter((event) => event.event === "fast-path-attempted").length;
      const vr = {
        settledThoughtCount,
        candidateAcceptedCount,
        candidateRejectedCount: events.filter((event) => event.event === "candidate-rejected").length,
        evidenceHeldCount: events.filter((event) => event.event === "evidence-held").length,
        evidenceCombinedCount: events.filter((event) => event.event === "evidence-combined").length,
        visualDecisionCount,
        decisionLatencyP50: percentile(decisionLatencies, .5),
        decisionLatencyP95: percentile(decisionLatencies, .95),
        staleResultDroppedCount: events.filter((event) => event.event === "stale-result-dropped").length,
        abortedRequestCount: events.filter((event) => event.event === "request-aborted").length,
        noneCount: events.filter((event) => event.event === "decision-none").length,
        groundingCount: events.filter((event) => event.event === "grounding-passed" || event.event === "grounding-failed").length,
        renderedVisualCount: events.filter((event) => event.event === "render-completed").length,
        durableResultReadyCount: events.filter((event) => event.event === "durable-result-ready").length,
        durableResultHeldCount: events.filter((event) => event.event === "durable-result-held").length,
        durableResultCommittedCount: events.filter((event) => event.event === "durable-result-committed").length,
        quietCommittedCount: events.filter((event) => event.event === "durable-result-quiet-committed").length,
        maxRequestConcurrency: replayMaxConcurrencyRef.current,
        fastPathAttemptCount: events.filter((event) => event.event === "fast-path-attempted").length,
        fastPathSuccessCount: events.filter((event) => event.event === "fast-path-succeeded").length,
        fastPathRejectedCount: events.filter((event) => event.event === "fast-path-rejected").length,
        fastPathGroundingPassCount: events.filter((event) => event.event === "grounding-passed" && event.decisionSource === "deterministic_fast_path").length,
        fastPathGroundingFailCount: events.filter((event) => event.event === "grounding-failed" && event.decisionSource === "deterministic_fast_path").length,
        fastPathCommittedCount: events.filter((event) => event.event === "durable-result-committed" && event.decisionSource === "deterministic_fast_path").length,
        modelCallsAvoidedByCandidateGate: Math.max(0, settledThoughtCount - candidateAcceptedCount),
        modelCallsAvoidedByFastPath: events.filter((event) => event.event === "fast-path-succeeded").length,
        overallModelCallRate: settledThoughtCount > 0 ? visualDecisionCount / settledThoughtCount : 0,
        causeEvidenceOpened: events.filter((event) => event.event === "cause-evidence-opened").length,
        causeEvidenceExtended: events.filter((event) => event.event === "cause-evidence-extended").length,
        causeEvidenceCompleted: events.filter((event) => event.event === "cause-evidence-completed").length,
        causeCandidateCount: events.filter((event) => event.event === "candidate-accepted" && event.visualFamily === "cause_effect").length,
        causeFastPathCount: events.filter((event) => event.event === "fast-path-succeeded" && event.visualFamily === "cause_effect").length,
        causeGroundingPassCount: events.filter((event) => event.event === "grounding-passed" && event.visualFamily === "cause_effect").length,
        causeGroundingFailCount: events.filter((event) => event.event === "grounding-failed" && event.visualFamily === "cause_effect").length,
        causeCommittedCount: events.filter((event) => event.event === "durable-result-committed" && event.visualFamily === "cause_effect").length,
        causeRejectedUncertain: events.filter((event) => event.event === "candidate-rejected" && event.reason?.includes("uncertain causal modality")).length,
        causeRejectedNegated: events.filter((event) => event.event === "candidate-rejected" && event.reason?.includes("negation near causal")).length,
        causeRejectedTemporal: events.filter((event) => event.event === "candidate-rejected" && event.reason?.includes("temporal order is not causality")).length,
        causeRejectedCorrelation: events.filter((event) => event.event === "candidate-rejected" && event.reason?.includes("correlation/association is not causality")).length,
        pageTurnInvalidationCount: events.filter((event) => event.event === "evidence-invalidated-page-turn" || (event.event === "durable-result-expired" && event.reason?.includes("page/session"))).length,
        candidateToDurableReady: sourceLatency("candidateCompleteToDurableReadyMs"),
        candidateToCommit: sourceLatency("candidateCompleteToCommitMs"),
      };
      const visualLifecycles = events
        .filter((event) => event.event === "candidate-accepted")
        .map((candidate) => {
          const sameThought = events.filter((event) => event.thoughtId === candidate.thoughtId);
          const at = (name: Extract<LogEvent, { type: "visual-reentry" }>["event"]) =>
            sameThought.find((event) => event.event === name)?.t ?? null;
          const fast = sameThought.find((event) => event.event === "fast-path-succeeded");
          const committed = sameThought.find((event) => event.event === "durable-result-committed");
          return {
            thoughtId: candidate.thoughtId ?? "unknown",
            sourceExcerpt: candidate.sourceExcerpt ?? "",
            candidateCompletedAtMs: candidate.candidateCompletedAtMs ?? candidate.t,
            durableReadyAtMs: at("durable-result-ready"),
            commitAtMs: at("durable-result-committed"),
            quietCommitAtMs: at("durable-result-quiet-committed"),
            groundingPassedAtMs: at("grounding-passed"),
            decisionSource: fast?.decisionSource ?? committed?.decisionSource ?? null,
            cameraRequested: sameThought.some((event) => event.event === "camera-requested"),
            cameraSuppressed: sameThought.some((event) => event.event === "camera-suppressed"),
          };
        });
      return {
        mode: experimentMode,
        round,
        audio,
        latency: summary,
        vr,
        correlation: correlateSamples(samples, replayDecisionWindowsRef.current),
        decisionWindows: replayDecisionWindowsRef.current.map((window) => ({ ...window })),
        visualLifecycles,
        settledThoughts: corpusEvidence.settledThoughts,
        visualSources: corpusEvidence.visualSources,
        scene: buildCorpusScene(elementsRef.current, pageRef.current),
        events: runEvents,
        pageTurns: runEvents
          .filter((event): event is Extract<LogEvent, { type: "page" }> => event.type === "page")
          .map((event) => ({ atMs: event.t, page: event.index, trigger: event.reason, reason: event.why })),
        transcript: finalsRef.current.map((item) => item.text).join(" ").trim(),
        startedAt,
        longTasks: runEvents
          .filter((event): event is Extract<LogEvent, { type: "long-task" }> => event.type === "long-task")
          .map((event) => ({ atMs: event.perfNow, durationMs: event.durationMs })),
      };
    } finally {
      unsubscribe();
      replayModeRef.current = null;
      deepgram.stop(false);
    }
  }, [commit, deepgram, replayLabEnabled, status]);

  const demoRunRef = useRef(runReplayExperiment);
  demoRunRef.current = runReplayExperiment;
  const demoStopRef = useRef(deepgram.stop);
  demoStopRef.current = deepgram.stop;

  useEffect(() => {
    if (!demoStudio) return;
    const api: DemoBoardApi = {
      run: (source, options) => demoRunRef.current("vr_full", source, 1, { atAudioMs: [] }, options),
      stop: () => demoStopRef.current(false),
    };
    window.__inpublicDemoStudioBoard = api;
    window.dispatchEvent(new Event("inpublic-demo-board-ready"));
    return () => {
      if (window.__inpublicDemoStudioBoard === api) delete window.__inpublicDemoStudioBoard;
      demoStopRef.current(false);
    };
  }, [demoStudio]);

  const wasListeningRef = useRef(false);
  useEffect(() => {
    const listening = status === "live" || status === "connecting" || status === "reconnecting";
    if (wasListeningRef.current && status === "idle") {
      aiAbortRef.current?.abort();
      scribeAbortRef.current?.abort();
    }
    wasListeningRef.current = listening;
  }, [status]);

  // ---- manual dry-run handle ----------------------------------------------
  // Lets me rehearse pacing from the console without talking:
  //   inpublic.draw("flowchart LR\n A[Mic] --> B[Beat] --> C[Artist]")
  // ---- persistence ---------------------------------------------------------
  useEffect(() => {
    if (demoStudio) return;
    autosaveRef.current = makeAutosave(() => ({
      id: sessionIdRef.current,
      cloudUpdatedAt: cloudUpdatedAtRef.current,
      title: sessionTitleRef.current,
      savedAt: Date.now(),
      startedAt: t0Ref.current,
      page: pageRef.current,
      elements: elementsRef.current,
      semantic: boardRef.current.snapshot(),
      story: storyRef.current,
      composition: compositionRef.current,
      mode: modeRef.current,
      log: logRef.current,
    }), 3000, setSaveStatus, { syncCloud: !guest });
    const flush = () => void autosaveRef.current?.flushNow();
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [demoStudio, guest]);

  useEffect(() => () => {
  }, []);

  /** Put a saved session back on the canvas. */
  const restoreSession = useCallback(
    (session: PersistedSession) => {
      sessionIdRef.current = session.id ?? sessionIdRef.current;
      cloudUpdatedAtRef.current = session.cloudUpdatedAt;
      const restoredTitle = session.title?.trim() || "Untitled visual session";
      sessionTitleRef.current = restoredTitle;
      setSessionTitle(restoredTitle);
      elementsRef.current = session.elements ?? [];
      boardRef.current = SemanticBoard.restore(session.semantic);
      // Story Mode was removed in Strip-Down Phase 2 — an old session saved
      // with mode: "story" now simply resumes as standard. storyRef stays
      // populated only so exportJson/persistence keep their existing shape.
      storyRef.current = restoreStoryState(session.story);
      compositionRef.current = session.composition ?? initialCompositionState();
      modeRef.current = "standard";
      setMode(modeRef.current);
      logRef.current = session.log ?? [];
      pageRef.current = session.page ?? 0;
      t0Ref.current = session.startedAt;

      // Rebuild the concept -> node index; it is derived, so it isn't stored.
      conceptElementRef.current = new Map();
      for (const concept of boardRef.current.concepts.values()) {
        const node = concept.elementIds.find((id) =>
          elementsRef.current.some((el) => el.id === id && el.type === "rectangle"),
        );
        if (node) conceptElementRef.current.set(concept.conceptId, node);
      }

      // The pen has to resume below whatever was restored, or the next
      // sentence lands on top of the old board.
      const origin = pageOrigin(pageRef.current);
      const pen = newPagePen(pageRef.current);
      const onPage = elementsRef.current.filter(
        (el) => el.x >= origin.x && el.x < origin.x + PAGE_W,
      );
      if (onPage.length) {
        pen.y = Math.max(...onPage.map((el) => el.y + (el.height ?? 0))) + 46;
      }
      penRef.current = pen;
      sketchRef.current.ids = elementsRef.current.map((el) => el.id);
      sketchPannedRef.current = false;

      commit();
      framePage(true);
      log({ type: "note", text: `restored ${elementsRef.current.length} elements` });
    },
    [commit, framePage, initialMode, initialSessionId, log],
  );

  useEffect(() => {
    if (startFresh) return;
    void (async () => {
      const session = initialSessionId
        ? await loadSessionById(initialSessionId)
        : await loadSession();
      if (!session || !session.elements?.length) return;
      // Only offer a restore if the canvas is still untouched this session.
      if (elementsRef.current.length > 0) return;
      restoreSession(session);
    })();
    // Restore runs once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const recompose = () => framePage(false, "recording viewport changed");
    window.addEventListener("resize", recompose);
    return () => window.removeEventListener("resize", recompose);
  }, [framePage]);

  /**
   * `?agent=1` (dev only): let an external agent submit meaning into THIS
   * session. The bridge polls a loopback port for queued `express_meaning`
   * calls and answers them with this board's tool — see
   * lib/expression/agentBridge.ts and scripts/express-mcp-server.mjs.
   *
   * One board, one world: an agent that connects joins the conversation
   * already on the sheet rather than starting a private one, which is what
   * makes an agent turn and a spoken turn interleavable.
   */
  useEffect(() => {
    if (!xeEnabled || !xeAgentBridgeEnabled) return;
    const tool = expressionToolRef.current;
    if (!tool) return;
    console.info("[expression] agent bridge listening — express_meaning is connected to this board");
    return startAgentBridge(tool, {
      // An agent's turn is logged where every other agent turn is: the entry
      // point's own onSubmit writes the Phase 0 `submitted` event, so this
      // only records that the call arrived over the wire and how it ended.
      onCall: ({ callId, result }) =>
        log({
          type: "expression",
          event: "agent-tool",
          thoughtId: result.id || callId,
          detail: `${result.status}${result.error ? `: ${result.error}` : ""}`,
        }),
    });
  }, [xeEnabled, xeAgentBridgeEnabled, log]);

  /** For correlating a felt stall against the recorded trace. Dev-only. */
  const markPerceivedStall = useCallback(() => {
    log({ type: "perceived-stall", perfNow: Math.round(performance.now()) });
  }, [log]);

  useEffect(() => {
    // Prime the correction vocabulary. Without this the seed terms — the
    // speaker's product and company names, the ones a general recogniser has
    // no reason to know — aren't available until the first mark lands, which
    // is exactly the stretch of a take where they get said.
    refreshTermsRef.current?.();

    // Warm the converter so the very first rough box isn't waiting on a chunk.
    void canvasRuntime.preload();

    // And warm the font, at the sizes we actually letter in, so the very first
    // marks aren't measured against a fallback face and clipped.
    fontsReadyRef.current = (async () => {
      try {
        const faces = document.fonts;
        await Promise.all(
          [21, 26, 34, 52].map((px) => faces.load(`${px}px Excalifont`)),
        );
        await faces.ready;
      } catch {
        /* no font loading API, or the face is unavailable — draw anyway */
      }
    })();

    // Console debug API — draw/say/live/undo/latency/reflex/etc. Development
    // only: unlike every other debug surface in this file, this used to be
    // assigned unconditionally, which meant it was reachable from any signed
    // in user's browser console in production.
    if (!isDev) return;
    (window as unknown as Record<string, unknown>).inpublic = {
      draw: (mermaid: string, focus = "manual test") => {
        renderQueueRef.current.push({ mermaid, focus });
        void drainRenderQueue();
      },
      /**
       * Write to the live line as if Deepgram had heard it. `settled: false`
       * is a partial (grey, replaced by the next call); `true` locks it.
       *   inpublic.live("today we are talking about airline")
       */
      live: (text: string, settled = false) => writeLive(text, settled),
      /** Render one operation by hand, e.g. inpublic.op('icon phone'). */
      op: async (line: string) => {
        const parsed = parseOp(line);
        return parsed ? applyOp(parsed) : false;
      },
      /**
       * Feed settled thoughts to the Expression Engine as if they had been
       * spoken, without a microphone. Needs `?v2=1&xe=1` (add `&debug=1` to
       * run the pipeline without drawing).
       *
       *   inpublic.speak("My name is Kenny Farmer.")
       *   inpublic.speak(["I'm from Trinidad and Tobago.", "I have a family of five."])
       *
       * Goes through the real settled-thought path — same controller, same
       * debounce, same canvas sync — so what it exercises is what live speech
       * exercises. Returns the trace of the run it triggers.
       */
      speak: async (input: string | string[]) => {
        if (!xeEnabled) {
          console.warn("[expression] not enabled — reload with ?v2=1&xe=1");
          return null;
        }
        const lines = Array.isArray(input) ? input : [input];
        lines.forEach((text, i) =>
          handleSettledExpression({ id: `spoken-${Date.now()}-${i}`, text } as SettledThought),
        );
        // Long enough for the controller's debounce plus one model round-trip.
        await new Promise((resolve) => setTimeout(resolve, 6000));
        return (window as unknown as { __expression?: ExpressionTrace }).__expression ?? null;
      },
      /**
       * The AGENT entry point (lib/expression/entry.ts), reachable without a
       * microphone and without pretending to be one.
       *
       *   inpublic.express({ text: "AI is making it easier to build apps." })
       *   inpublic.express({ delta: { entities: [...], relations: [...], claims: [], interpretation: "..." } })
       *
       * `speak` above simulates a settled SPEECH thought; this is what a
       * Claude/Codex/MCP caller would actually call, and the difference is
       * only `source: "ai_agent"` on the segment plus the ability to hand
       * over structured meaning and skip extraction. Same controller, same
       * world, same debounce, same canvas sync — an agent turn and a spoken
       * turn interleave in one conversation.
       *
       * Resolves with the run's outcome (status / mode / grammar / counts),
       * rather than making the caller poll a global the way `speak` does.
       */
      express: async (request: ExpressRequest) => {
        if (!xeEnabled) {
          console.warn("[expression] not enabled — reload with ?v2=1&xe=1");
          return null;
        }
        return expressionEntryRef.current?.express(request) ?? null;
      },
      /**
       * The same entry point as an external agent sees it
       * (lib/expression/tool.ts): untrusted JSON in, a flat JSON answer out.
       *
       *   inpublic.tool({ text: "Rising costs push teams to consolidate tools." })
       *   inpublic.toolSchema()   → the name / description / input schema an agent is given
       *
       * `express` above is the in-process call; this is what an MCP client's
       * `express_meaning` invocation actually runs, validation and all — so a
       * schema question can be answered here without starting a bridge.
       */
      tool: async (input: unknown) => {
        if (!xeEnabled) {
          console.warn("[expression] not enabled — reload with ?v2=1&xe=1");
          return null;
        }
        return expressionToolRef.current?.call(input) ?? null;
      },
      toolSchema: () => expressionToolRef.current?.definition ?? null,
      /**
       * The pipeline trace for the most recent expression run, printed stage
       * by stage: input, meaning, world before and after, intent, plan,
       * scene, canvas diff, evaluation and repair.
       *
       *   inpublic.trace()     → the latest run
       *   inpublic.trace(-2)   → the run before it
       *   inpublic.traces()    → every run this session, as objects
       *
       * This is the answer to "which layer broke it" — the canvas alone
       * cannot say, and every stage is preserved precisely so it can.
       */
      trace: (offset = -1) => {
        const history = (window as unknown as { __expressionHistory?: ExpressionTrace[] }).__expressionHistory ?? [];
        const item = history.at(offset);
        if (!item) {
          console.warn("[expression] no runs yet — needs ?v2=1&xe=1 and some speech");
          return null;
        }
        console.log(formatTrace(item));
        return item;
      },
      traces: () => (window as unknown as { __expressionHistory?: ExpressionTrace[] }).__expressionHistory ?? [],
      /**
       * Live-session capture (?capture=1, lib/expression/capture.ts). Buffers
       * every turn as it happens; nothing is written to disk until you ask.
       *   inpublic.captureStatus()    → { enabled, turnCount, sessionId }
       *   inpublic.captureDownload()  → saves the session as JSON, replay it
       *                                 with scripts/expression-live-replay.mjs
       *   inpublic.captureReset()     → discards buffered turns, keeps recording
       */
      captureStatus: () => ({
        enabled: xeCaptureEnabled,
        turnCount: captureSessionRef.current?.turnCount ?? 0,
        sessionId: captureSessionRef.current?.sessionId ?? null,
      }),
      captureDownload: () => {
        if (!captureSessionRef.current) {
          console.warn("[expression] capture mode is off — reload with ?v2=1&xe=1&capture=1");
          return false;
        }
        if (!captureSessionRef.current.turnCount) {
          console.warn("[expression] nothing captured yet");
          return false;
        }
        downloadCapture(captureSessionRef.current);
        return true;
      },
      captureReset: () => {
        captureSessionRef.current?.reset();
      },
      undo: doUndo,
      clear: doClear,
      clearSketch,
      /**
       * The developer-readable latency summary for the session in progress.
       *   inpublic.latency()          → printable summary of this session
       *   inpublic.latencyHistory()   → every stored session, newest last
       * Rows that were never measured are absent rather than zero.
       */
      latency: () => {
        const summary = latency.summary();
        summary.mode = modeRef.current;
        console.log(formatLatencySummary(summary));
        return summary;
      },
      latencyHistory: () => storedLatencySamples(),
      /**
       * Show/hide the on-canvas latency panel, persisted across reloads.
       *   inpublic.latencyOverlay()       → show
       *   inpublic.latencyOverlay(false)  → hide
       * Off by default; the numbers are also available via inpublic.latency()
       * without putting anything over the canvas.
       */
      latencyOverlay: (on = true) => {
        setShowLatencyOverlay(on);
        try { window.localStorage.setItem(LATENCY_OVERLAY_KEY, on ? "1" : "0"); } catch { /* private mode — this session only */ }
        return on;
      },
      /** Mark "that one felt slow" right now, for correlation against the log. */
      markStall: markPerceivedStall,
      /**
       * Reflex (tier 2) debug view — development only, per Part 13 of the
       * Reflex brief. Every `{type:"speculative"}` event this session:
       * drawn, blocked (pointer-lock/busy/cap, retried later), dropped
       * (permanent — a real mark already claimed it, or it failed to build),
       * retired, promoted, superseded, or stale (epoch changed before a
       * scheduled recognition/render ran). Not exposed in any production UI.
       *   inpublic.reflex()             → most recent 50, printed as a table
       *   inpublic.reflex({ full: true }) → every one recorded this session
       */
      reflex: (opts: { full?: boolean } = {}) => {
        const events = logRef.current.filter(
          (e): e is Extract<LogEvent, { type: "speculative" }> => e.type === "speculative",
        );
        const shown = opts.full ? events : events.slice(-50);
        console.table(
          shown.map((e) => ({ t: e.t, event: e.event, kind: e.kind ?? "", text: e.text ?? "", why: e.why })),
        );
        return shown;
      },
      log: () => logRef.current,
      elements: () => elementsRef.current,
      /** Development-only structural snapshot of live canvas reality. */
      observe: () => canvasRuntime.observe(),
      sketchCount: () => sketchRef.current.count,
      storyState: () => storyRef.current,
      composition: () => compositionRef.current,
      /** The semantic board, for inspection. */
      board: () => boardRef.current,
      scene: () => semanticScene(),
      history: () => boardRef.current.history.map((o) => `${o.type}:${o.operationId}`),
      exportJson: () =>
        exportSceneJson(
          elementsRef.current,
          boardRef.current.snapshot(),
          logRef.current,
          t0Ref.current,
          storyRef.current,
          modeRef.current,
          compositionRef.current,
        ),
    };
  }, [
    semanticScene,
    applyOp,
    canvasRuntime,
    clearSketch,
    doClear,
    doUndo,
    drainRenderQueue,
    handleSettledExpression,
    markPerceivedStall,
    writeLive,
    xeEnabled,
  ]);

  // ---- main-thread contention -----------------------------------------------
  // A "longtask" entry means the main thread was unavailable for >= 50ms —
  // the clearest possible evidence that something other than the ink path
  // (a render, a GC pause, another feature's work) blocked an interim from
  // reaching the screen on time. `attribution` names the culprit frame/script
  // when the browser can identify it; it usually can't for same-frame work,
  // which is most of ours.
  useEffect(() => {
    if (typeof PerformanceObserver === "undefined") return;
    if (!PerformanceObserver.supportedEntryTypes?.includes("longtask")) return;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        latency.observe("long_task", entry.duration);
        const attribution = (
          entry as PerformanceEntry & {
            attribution?: Array<{ name?: string; containerType?: string }>;
          }
        ).attribution?.[0];
        log({
          type: "long-task",
          durationMs: Math.round(entry.duration),
          perfNow: Math.round(entry.startTime),
          perfEnd: Math.round(entry.startTime + entry.duration),
          attribution: attribution?.name || attribution?.containerType,
        });
      }
    });
    try {
      observer.observe({ type: "longtask", buffered: true });
    } catch {
      return;
    }
    return () => observer.disconnect();
  }, [log]);

  // ---- keyboard ------------------------------------------------------------
  useEffect(() => {
    const isTextTarget = (el: EventTarget | null) => {
      const node = el as HTMLElement | null;
      if (!node) return false;
      const tag = node.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        node.isContentEditable === true
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return; // Cmd/Ctrl+Z stays Excalidraw's
      if (isTextTarget(e.target)) return;

      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      } else if (e.key === "t" || e.key === "T") {
        setShowTranscript((v) => !v);
      } else if (e.key === "`" && isDev) {
        markPerceivedStall();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [toggle, markPerceivedStall]);

  const handleTitleChange = useCallback((title: string) => {
    sessionTitleRef.current = title;
    setSessionTitle(title);
    setSaveStatus("saving");
    autosaveRef.current?.schedule();
  }, []);

  const handleExport = useCallback((kind: "png" | "svg" | "excalidraw" | "json") => {
    const els = elementsRef.current;
    if (kind === "png") void exportPng(els);
    else if (kind === "svg") void exportSvg(els);
    else if (kind === "excalidraw") exportExcalidraw(els);
    else exportSceneJson(els, boardRef.current.snapshot(), logRef.current, t0Ref.current, storyRef.current, modeRef.current, compositionRef.current);
  }, []);

  const handleDownloadLog = useCallback(() => {
    downloadLog(logRef.current, t0Ref.current, storyRef.current, modeRef.current, sessionIdRef.current);
  }, []);

  const finishSession = useCallback(() => {
    if (status === "live" || status === "reconnecting" || status === "connecting") toggle();
    // A guest has no /dashboard to return to (it's an authenticated route) —
    // send them to the claim screen instead, carrying the just-saved local
    // session id so /try can offer "keep this session" against the right
    // IndexedDB record.
    const destination = guest ? `/try?done=1&session=${encodeURIComponent(sessionIdRef.current)}` : "/dashboard";
    void autosaveRef.current?.flushNow().then(() => router.push(destination));
  }, [guest, router, status, toggle]);

  // ---- render --------------------------------------------------------------
  return (
    <div
      ref={setRecordingTarget}
      className={`canvas-shell relative h-dvh w-dvw bg-white ${recordingFocus ? "recording-focus" : ""}`}
      data-demo-board-host={demoStudio ? "true" : undefined}
      data-recording-focus={recordingFocus ? "true" : "false"}
      onPointerDown={markPointerInput}
      onWheel={markPointerInput}
      onKeyDownCapture={markUserInput}
    >
      {!demoStudio && <CanvasTopBar title={sessionTitle} saveState={saveStatus} remainingSeconds={usage.remainingSeconds} unlimitedMinutes={usage.entitlement?.unlimitedMinutes} onTitleChange={handleTitleChange} onExport={handleExport} onDownloadLog={handleDownloadLog} guest={guest} />}

      <Excalidraw
        excalidrawAPI={(instance: unknown) => canvasRuntime.attach(instance)}
        viewModeEnabled={false}
        initialData={{
          appState: {
            viewBackgroundColor: "#ffffff",
            theme: "light",
            zenModeEnabled: true,
          },
        }}
        UIOptions={{
          canvasActions: {
            toggleTheme: false,
            export: false,
            saveToActiveFile: false,
            loadScene: false,
            clearCanvas: false,
          },
        }}
        renderTopRightUI={() => null}
        // Deliberately NOT wired to markUserInput. onChange also fires for our
        // own writes and for camera moves, and once the Scribe is drawing every
        // ~1.5s that kept the touch lock permanently hot — which silently
        // starved the wrap-up renderer. Pointer and key events are the honest
        // signal that a human touched the canvas.
        onChange={() => {}}
      >
        {/* Any child suppresses the default main menu and welcome screen. */}
        <></>
      </Excalidraw>

      {process.env.NEXT_PUBLIC_COMPOSITION_DEBUG === "true" && (
        <div className="pointer-events-none fixed inset-0 z-[80]" aria-hidden="true">
          <div className="absolute border border-dashed border-indigo-400/80" style={{ left: 36, top: 36, bottom: 36, right: "calc(20vw + 52px)" }} />
          <div className="absolute border border-dashed border-rose-400/80 bg-rose-100/10" style={{ right: 28, top: 28, width: "20vw", aspectRatio: "16 / 9" }} />
        </div>
      )}

      {!demoStudio && showTranscript ? (
        <TranscriptStrip text={interim} />
      ) : (
        <span data-recording-transcript={interim} className="hidden" />
      )}

      {!demoStudio && isDev && showLatencyOverlay && (
        <LatencyOverlay onMarkStall={markPerceivedStall} />
      )}

      {!demoStudio && replayLabEnabled && <DevReplayLab run={runReplayExperiment} />}

      {!demoStudio && <ErrorBanner text={errorText} onDismiss={() => setErrorText(null)} onRetry={toggle} />}

      {!demoStudio && xeEnabled && expressionPending ? (
        <div className="canvas-expressing" role="status" aria-live="polite"><i />Expressing</div>
      ) : null}

      {!demoStudio && <ControlBar
        status={status}
        busy={busy}
        expressing={xeEnabled && expressionPending}
        onToggleMic={toggle}
        onFinish={finishSession}
      />}

      {!demoStudio && <RecordingPanel
        target={recordingTarget}
        mode={mode}
        onTranscriptVisibilityChange={setShowTranscript}
        onRecordingFocusChange={setRecordingFocus}
        onListeningPause={() => { if (status === "live" || status === "connecting" || status === "reconnecting") void toggle(); }}
        getSnapshot={() => {
          const transcript = finalsRef.current.map((item) => item.text).join(" ").trim();
          return {
            sessionId: sessionIdRef.current,
            title: sessionTitleRef.current.trim() || transcript.split(/\s+/).slice(0, 7).join(" ") || "Untitled visual session",
            mode: modeRef.current,
            transcript,
            story: storyRef.current,
            semantic: boardRef.current.snapshot(),
            page: pageRef.current,
            log: logRef.current,
            composition: compositionRef.current,
          };
        }}
      />}
    </div>
  );
}
