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
import { AudioReplayPanel } from "@/components/AudioReplayPanel";
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
import { normalizeScribeText, shouldWakeScribe } from "@/lib/scribeScheduler";
import { localBeatDecision, scoreBeatAgreement } from "@/lib/beatPrefilter";
import {
  applySpeculativeOutcome,
  confirmedByFinal,
  emptySpeculativeState,
  recognizeSpeculative,
  supersedes,
  type SpeculativeEvent,
  type SpeculativeOutcome,
  type SpeculativeState,
} from "@/lib/speculative";
import { buildBeat, truncateLabel, type SceneElement } from "@/lib/scene";
import { downloadLog } from "@/lib/sessionLog";
import { parseActions, type CanvasAction } from "@/lib/actions";
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
  buildBoundArrow,
  buildConceptNode,
  buildLiveLine,
  buildOp,
  buildReferenceBox,
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
  type Mark,
  type Op,
  type Pen,
} from "@/lib/ops";
import { buildMathStepBox, buildMathVisual, measureMathStepBox, measureMathVisual } from "@/lib/math/visuals";
import { isMathActionType } from "@/lib/math/actions";
import { verifyTransformStep } from "@/lib/math/verify";
import { groundEquationInSource } from "@/lib/math/ground";
import {
  decidePageTurn,
  isThoughtComplete,
  suppressPageTurnDuringInitialComposition,
  type PageTurnReason,
} from "@/lib/pagination";
import { describePlan, planActions, type PageMark, type PlanStep } from "@/lib/organizer";
import {
  detectBackReference,
  resolveReference,
  type ReferenceTarget,
} from "@/lib/reference";
import { correctTranscript, groundedInSource, keyterms } from "@/lib/vocab";
import { sttDebug } from "@/lib/sttDebug";
import {
  MAX_TEMPORARY_SCRIBE_MARKS,
  temporaryMarkBudgetReached,
  visibleConceptBudgetReached,
  visibleRelationshipBudgetReached,
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
import { detectGesture, extractConcepts } from "@/lib/sketch";
import { comparisonPairKey, detectComparison } from "@/lib/director";
import { computeComparisonLayout, type ComparisonBox } from "@/lib/choreographerComparison";
import { computeProcessLayout, type ProcessBox } from "@/lib/choreographerProcess";
import {
  advanceDirector,
  createDirectorState,
  markProcessCommitted,
  unmarkProcessCommitted,
  type DirectorState,
} from "@/lib/directorState";
import { features, isLivePresentationV2Enabled, isVisualReentryV1Enabled, isMeaningEngineV1Enabled, isMeaningDebugOnlyEnabled, isWordlessVisualsEnabled, isExpressionEngineV1Enabled, isExpressionDebugOnlyEnabled } from "@/lib/features";
import { ExpressionLiveController, type ExpressionLiveUpdate } from "@/lib/expression/live";
import { syncExpressionCanvas, createExpressionIdentity, boundsOf } from "@/lib/expression/render/excalidrawSync";
import { describePatch } from "@/lib/expression/render/core";
import type { ExpressionTrace } from "@/lib/expression/pipeline";
import { formatTrace } from "@/lib/expression/trace";
import { MeaningEngineController, type MeaningDebugSnapshot, type MeaningUpdate } from "@/lib/meaning/engine";
import { syncMeaningCanvas, createMeaningIdentity } from "@/lib/meaning/apply";
import { emptyProvisionalState, scanProvisional, clearProvisional, type ProvisionalState } from "@/lib/meaning/reflex";
import { syncProvisionalCanvas, createProvisionalIdentity } from "@/lib/meaning/provisional";
import { commitPreparedVisualReentry, prepareVisualReentry, type PreparedVisualReentry } from "@/lib/visualReentry/orchestrate";
import { evaluateVisualCandidate } from "@/lib/visualReentry/candidate";
import { advanceVisualEvidence, completePendingCauseEvidence, type VisualEvidenceEntry } from "@/lib/visualReentry/evidence";
import { chooseVisualCommitMode } from "@/lib/visualReentry/commitPolicy";
import {
  VisualReentryCandidateQueue,
  type VisualReentryCandidateJob,
} from "@/lib/visualReentry/decisionQueue";
import { claimThought } from "@/lib/visualReentry/ownership";
import type { SettledThought } from "@/lib/visualReentry/types";
import { parseExplicitCauseEffect } from "@/lib/visualReentry/cause";
import { compressLabel } from "@/lib/visualReentry/compress";
import {
  appendCauseEffectNode,
  convertCauseEffectAppend,
  measureCauseEffectProgress,
  nextCauseEffectNodeY,
} from "@/lib/visualReentry/render";
import {
  activeStoryScene,
  applyStoryActions,
  auditStoryRenderConsistency,
  continueStoryScene,
  newStoryState,
  parseStoryActions,
  restoreStoryState,
  setStoryRendering,
  storyInterpreterContext,
  undoStoryAction,
  type InPublicMode,
  type StoryAction,
  type StoryState,
} from "@/lib/story";
import {
  buildStoryEntityElements,
  buildStoryEnvironmentElements,
  buildStoryRelationElements,
  STORY_BOUNDS,
  storyStagingDecision,
  storyEntityPositions,
  storySceneFits,
} from "@/lib/storyAssets";
import {
  applyStoryEvent,
  compileStoryEvent,
  emptyStoryPartialState,
  recognizeStoryPartial,
  STORY_MODE_KEYTERMS,
  storyEventIsSupported,
  type StoryEvent,
  type StoryPartialState,
} from "@/lib/storyV2";
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
 *   deepgram : mic -> Deepgram -> /api/scribe (Haiku) -> ops
 *   gemini   : mic -> Gemini Live -> draw() tool calls -> ops
 *
 * Both feed the same applyOp renderer, so the page, pen, dedupe and fragment
 * filter are shared and the two engines cannot drift apart.
 */
const ENGINE = (process.env.NEXT_PUBLIC_ENGINE ?? "deepgram") as
  | "deepgram"
  | "gemini";

/** Parked — see lib/features.ts. Standard mode and the live pipeline are unaffected either way. */
const AUDIO_REPLAY_ENABLED: boolean = features.audioReplay;

/**
 * The Scribe is now a second pass, not the thing you wait for — the live line
 * has already written your words by the time it answers. Set
 * NEXT_PUBLIC_SCRIBE=off to see the raw writing with nothing drawn over it.
 */
const SCRIBE_ENABLED = process.env.NEXT_PUBLIC_SCRIBE !== "off";

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
  const [api, setApi] = useState<any>(null);
  const apiRef = useRef<any>(null);
  apiRef.current = api;

  const [interim, setInterim] = useState("");
  // Settings offers "show transcript by default"; this is where it lands.
  const [showTranscript, setShowTranscript] = useState(() => readPreferences().showTranscriptByDefault);
  const [showAudioReplay, setShowAudioReplay] = useState(false);
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
    apiRef.current?.updateScene({ elements: elementsRef.current as never });
    autosaveRef.current?.schedule();
    if (guest && !firstVisualFiredRef.current && visualSessionStartedAtRef.current && elementsRef.current.length > 0) {
      firstVisualFiredRef.current = true;
      const ms = Date.now() - visualSessionStartedAtRef.current;
      track("first_visual_rendered", { ms });
      track("time_to_first_visual", { ms });
    }
  }, [guest]);

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
  /** Concept-id pairs already turned into a comparison this session, so the same pair never re-triggers (Part 12: structure settles). */
  const comparedPairsRef = useRef<Set<string>>(new Set());
  /** Director V1's persistent, patient evidence-accumulation state. See lib/directorState.ts. */
  const directorStateRef = useRef<DirectorState>(createDirectorState());
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

  /** The node element that arrows should bind to for this concept. */
  const nodeForConcept = useCallback(
    (conceptId: string): SceneElement | null => {
      const elementId = conceptElementRef.current.get(conceptId);
      return elementId ? findElement(elementId) : null;
    },
    [findElement],
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
  /** Cancels an in-flight Visual Re-entry decision call — one controller for the whole chain, same idiom as aiAbortRef/scribeAbortRef/storyAbortRef. */
  const visualReentryAbortRef = useRef<AbortController | null>(null);
  const visualReentryInFlightRef = useRef(false);
  const visualReentryGenerationRef = useRef(0);
  const visualReentryCandidateQueueRef = useRef(new VisualReentryCandidateQueue());
  const drainVisualReentryDecisionQueueRef = useRef<(() => void) | null>(null);
  const visualReentryPendingRef = useRef<Array<{ prepared: PreparedVisualReentry; generation: number; launchLiveSeq: number }>>([]);
  const visualReentryEvidenceRef = useRef<VisualEvidenceEntry[]>([]);
  /**
   * The cause_effect diagram-in-progress: which nodes are already committed
   * ink, and the pen region reserved for the rest of the chain. Lets
   * handleSettledVisualReentry draw one node/edge at a time as evidence
   * accumulates instead of waiting for the whole chain to be judged
   * complete. Reset on page turn and on rejected evidence — see the
   * `causeEffectProgressRef.current = null` sites next to the matching
   * `visualReentryEvidenceRef.current = []` resets.
   */
  const causeEffectProgressRef = useRef<{
    page: number;
    regionX: number;
    regionW: number;
    regionTop: number;
    nextY: number;
    anchor?: { bottom: number; centerX: number };
    nodeLabels: string[];
  } | null>(null);
  const causeEvidenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visualReentryCommitBusyRef = useRef(false);
  const visualReentryFlushRequestedRef = useRef(false);
  const flushVisualReentryRef = useRef<(() => Promise<boolean>) | null>(null);
  const visualReentryDrainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Part 12's ownership guard: no settled-thought id is ever processed twice. Reset (not trimmed) once it grows large — a long session shouldn't accumulate this forever, and a duplicate id from far in the past is not a realistic case to guard against. */
  const visualReentryProcessedIdsRef = useRef<Set<string>>(new Set());
  const thoughtInkRef = useRef(new Map<string, { ids: string[]; base: Pen; after: Pen; page: number }>());
  /** Meaning Engine V1 (features.meaningEngineV1): the concept/relationship id <-> Excalidraw element id mapping applyMeaningOps reads and writes. */
  const meaningIdentityRef = useRef(createMeaningIdentity());
  /** Set once applyMeaningUpdate is defined below; the controller itself is created once and must call whatever the latest version of that callback is. */
  const applyMeaningUpdateRef = useRef<((update: MeaningUpdate) => void) | null>(null);
  const meaningControllerRef = useRef<MeaningEngineController | undefined>(undefined);
  if (meaningControllerRef.current === undefined) {
    meaningControllerRef.current = new MeaningEngineController({
      onUpdate: (update) => applyMeaningUpdateRef.current?.(update),
      onDebug:
        process.env.NODE_ENV !== "production"
          ? (snapshot) => {
              // Part 10/15 debug view: readable in the console without
              // looking at the canvas, and inspectable after the fact via
              // window.__meaningDebug (devtools console), not just
              // scrollback — see the Meaning Canvas rebuild's audit finding
              // that this visibility never existed before.
              console.debug("[meaning-engine]", snapshot.event, snapshot);
              if (typeof window !== "undefined") {
                const w = window as unknown as { __meaningDebug?: MeaningDebugSnapshot; __meaningDebugHistory?: MeaningDebugSnapshot[] };
                w.__meaningDebug = snapshot;
                w.__meaningDebugHistory = [...(w.__meaningDebugHistory ?? []), snapshot];
              }
            }
          : undefined,
    });
  }

  /** Expression Engine V1 (features.expressionEngineV1): the SceneObject id <-> Excalidraw element id mapping syncExpressionCanvas reads and writes. */
  const expressionIdentityRef = useRef(createExpressionIdentity());
  /** Set once applyExpressionUpdate is defined below; the controller is created once and must call whatever the latest version of that callback is. */
  const applyExpressionUpdateRef = useRef<((update: ExpressionLiveUpdate) => void) | null>(null);
  const expressionControllerRef = useRef<ExpressionLiveController | undefined>(undefined);
  if (expressionControllerRef.current === undefined) {
    expressionControllerRef.current = new ExpressionLiveController({
      onUpdate: (update) => applyExpressionUpdateRef.current?.(update),
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
            }
          : undefined,
    });
  }

  const clearVisualReentryCandidateQueue = useCallback((reason: string) => {
    const removed = visualReentryCandidateQueueRef.current.clear();
    for (const job of removed) {
      log({ type: "visual-reentry", event: "candidate-expired", thoughtId: job.thought.id, reason, queueDepth: 0 });
    }
  }, [log]);

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
  const vrEnabled = useMemo(() => isVisualReentryV1Enabled(), []);
  const meEnabled = useMemo(() => isMeaningEngineV1Enabled(), []);
  const meDebugOnly = useMemo(() => isMeaningDebugOnlyEnabled(), []);
  /** Expression Engine V1 (features.expressionEngineV1). Mutually exclusive with meEnabled — the flag resolver enforces it, so both can be read here without a guard. */
  const xeEnabled = useMemo(() => isExpressionEngineV1Enabled(), []);
  const xeDebugOnly = useMemo(() => isExpressionDebugOnlyEnabled(), []);
  const wordlessEnabled = useMemo(() => isWordlessVisualsEnabled(), []);
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

  const dropSettledLiveLine = useCallback(() => {
    const settled = settledLiveRef.current;
    if (!settled) return;
    const drop = new Set(settled.ids);
    elementsRef.current = elementsRef.current.filter((el) => !drop.has(el.id));
    for (const id of settled.ids) liveLineIdsRef.current.delete(id);
    if (samePen(penRef.current, settled.after)) penRef.current = { ...settled.base };
    settledLiveRef.current = null;
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
    const app = apiRef.current?.getAppState?.();
    if (!app) return;
    const from: CameraView = {
      scrollX: Number(app.scrollX ?? 0),
      scrollY: Number(app.scrollY ?? 0),
      zoom: Number(app.zoom?.value ?? app.zoom ?? 1),
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
      apiRef.current?.updateScene({ appState: { scrollX: target.scrollX, scrollY: target.scrollY, zoom: { value: target.zoom } } });
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
      apiRef.current?.updateScene({ appState: { scrollX: next.camera.scrollX, scrollY: next.camera.scrollY, zoom: { value: next.camera.zoom } } });
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
      apiRef.current?.updateScene({ appState: { scrollX: completedTarget.scrollX, scrollY: completedTarget.scrollY, zoom: { value: completedTarget.zoom } } });
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
  }, [log]);

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
   * Patch a re-routed arrow's geometry into place once a comparison move has
   * settled. Same ids throughout, so this is a plain in-place patch, applied
   * once (not every frame — Part 9 of the brief).
   */
  const applyComparisonReroutes = useCallback((rerouted: ComparisonReroute[]) => {
    if (!rerouted.length) return;
    elementsRef.current = elementsRef.current.map((el) => {
      for (const r of rerouted) {
        if (el.id === r.arrowElementId) return patch(el, r.arrowFields);
        const extra = r.extraPatches.find((e) => e.id === el.id);
        if (extra) return patch(el, extra.fields);
      }
      return el;
    });
  }, []);

  /**
   * Move a set of already-drawn concepts into a comparison or process
   * layout. Generic over structure kind so Comparison and Process share one
   * animation architecture rather than each inventing their own (Part 7/8/17
   * of the Director V1 brief) — comparison passes exactly 2 ids, process 3-6.
   *
   * Mirrors `animateCamera`'s rAF/spring structure (same settle-threshold
   * pattern, same `prefers-reduced-motion` escape hatch, same
   * cancel-and-retarget shape) but drives element positions instead of the
   * camera.
   */
  const animateConceptMotion = useCallback(
    (
      structureKind: "comparison" | "process",
      conceptIds: string[],
      moves: ComparisonMove[],
      rerouted: ComparisonReroute[],
    ) => {
      if (conceptMotionRef.current) cancelConceptMotion(`superseded by new ${structureKind}`);

      const epoch = ++comparisonEpochRef.current;
      const reduced =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      const finalPositions = new Map<string, Point2D>();
      for (const move of moves) {
        const dx = move.anchorTo.x - move.anchorFrom.x;
        const dy = move.anchorTo.y - move.anchorFrom.y;
        for (const [id, origin] of move.elementOrigins) {
          finalPositions.set(id, { x: origin.x + dx, y: origin.y + dy });
        }
      }
      const applyPositions = (positions: Map<string, Point2D>) => {
        elementsRef.current = elementsRef.current.map((el) => {
          const target = positions.get(el.id);
          return target ? patch(el, { x: target.x, y: target.y }) : el;
        });
      };

      const logMovement = (event: "movement_started" | "movement_completed") => {
        if (structureKind === "comparison") {
          log({ type: "comparison", event, leftConceptId: conceptIds[0], rightConceptId: conceptIds[1] });
        } else {
          log({ type: "process", event, conceptIds });
        }
      };

      const finish = () => {
        applyPositions(finalPositions);
        applyComparisonReroutes(rerouted);
        commit();
        conceptMotionRef.current = null;
        logMovement("movement_completed");
      };

      if (reduced) {
        finish();
        return;
      }

      logMovement("movement_started");
      const runtime = moves.map((move) => ({
        move,
        current: { ...move.anchorFrom },
        velocity: { x: 0, y: 0 },
      }));

      const frame = (time: number) => {
        // Stale-epoch or deleted-concept guard: stop touching elements the
        // instant this is no longer the live move (Part 17).
        if (comparisonEpochRef.current !== epoch) return;
        const motion = conceptMotionRef.current;
        if (!motion) return;
        const board = boardRef.current;
        if (conceptIds.some((id) => !board.concepts.has(id))) {
          conceptMotionRef.current = null;
          return;
        }
        const dt = time - motion.lastFrameAt;
        motion.lastFrameAt = time;
        const positions = new Map<string, Point2D>();
        let settled = true;
        for (const entry of motion.runtime) {
          const next = stepPositionSpring(
            entry.current,
            entry.move.anchorTo,
            entry.velocity,
            dt,
            COMPARISON_SPRING_FREQUENCY,
          );
          entry.current = next.position;
          entry.velocity = next.velocity;
          const dx = entry.current.x - entry.move.anchorFrom.x;
          const dy = entry.current.y - entry.move.anchorFrom.y;
          for (const [id, origin] of entry.move.elementOrigins) {
            positions.set(id, { x: origin.x + dx, y: origin.y + dy });
          }
          const posSettled =
            Math.abs(entry.current.x - entry.move.anchorTo.x) < 0.4 &&
            Math.abs(entry.current.y - entry.move.anchorTo.y) < 0.4 &&
            Math.abs(entry.velocity.x) < 2 &&
            Math.abs(entry.velocity.y) < 2;
          if (!posSettled) settled = false;
        }
        applyPositions(positions);
        commit();
        if (!settled) {
          motion.rafId = requestAnimationFrame(frame);
          return;
        }
        finish();
      };

      conceptMotionRef.current = {
        epoch,
        structureKind,
        conceptIds,
        runtime,
        rerouted,
        lastFrameAt: performance.now(),
        rafId: requestAnimationFrame(frame),
      };
    },
    [applyComparisonReroutes, cancelConceptMotion, commit, log],
  );

  /**
   * Build one concept's rigid move: every element belonging to it (plus
   * bound text), and where each started, so the whole group can move
   * together. Shared between `performComparison` and `performProcess` — no
   * logic here is comparison-specific.
   */
  const buildConceptMove = useCallback(
    (
      concept: Concept,
      anchorNode: SceneElement,
      dx: number,
      dy: number,
      patches: { id: string; before: Record<string, unknown> }[],
    ): ComparisonMove => {
      const elementOrigins = new Map<string, Point2D>();
      const ids = new Set(concept.elementIds);
      for (const el of elementsRef.current) {
        if (!ids.has(el.id) && !ids.has((el.containerId as string) ?? "")) continue;
        elementOrigins.set(el.id, { x: el.x, y: el.y });
        patches.push({ id: el.id, before: { x: el.x, y: el.y } });
      }
      return {
        conceptId: concept.conceptId,
        anchorFrom: { x: anchorNode.x, y: anchorNode.y },
        anchorTo: { x: anchorNode.x + dx, y: anchorNode.y + dy },
        elementOrigins,
      };
    },
    [],
  );

  /**
   * Resolve a Director comparison decision against the board, compute where
   * the two concepts should end up, and record it as one undoable operation
   * before handing the actual movement to `animateConceptMotion`.
   *
   * Reuse, never duplicate (Part 5): both concepts must already exist on the
   * board, or nothing happens — this never creates a concept.
   */
  const performComparison = useCallback(
    async (
      action: Extract<CanvasAction, { type: "form_comparison" }>,
      sourceText: string,
    ): Promise<string> => {
      const board = boardRef.current;
      const left = board.match(action.leftConceptId);
      const right = board.match(action.rightConceptId);
      if (!left || !right || left.conceptId === right.conceptId) {
        return `comparison skipped: unresolved concepts`;
      }
      if (comparedPairsRef.current.has(comparisonPairKey(left.conceptId, right.conceptId))) {
        return `comparison skipped: ${left.conceptId} <-> ${right.conceptId} already formed`;
      }
      // Never fight the user (Part 13): dropped rather than deferred forever —
      // the pair is still unpaired, so a later beat gets another chance.
      if (Date.now() - lastPointerInputRef.current < SKETCH_TOUCH_LOCK_MS || sketchBusyRef.current) {
        return `comparison deferred: user interacting`;
      }

      const leftNode = nodeForConcept(left.conceptId);
      const rightNode = nodeForConcept(right.conceptId);
      if (!leftNode || !rightNode) return `comparison skipped: no drawn node`;

      const leftBox: ComparisonBox = { x: leftNode.x, y: leftNode.y, width: leftNode.width, height: leftNode.height };
      const rightBox: ComparisonBox = { x: rightNode.x, y: rightNode.y, width: rightNode.width, height: rightNode.height };
      const targets = computeComparisonLayout(leftBox, rightBox, pageRef.current, penRef.current.y);

      const dxLeft = targets.left.x - leftBox.x;
      const dyLeft = targets.left.y - leftBox.y;
      const dxRight = targets.right.x - rightBox.x;
      const dyRight = targets.right.y - rightBox.y;

      if (Math.hypot(dxLeft, dyLeft) < 1 && Math.hypot(dxRight, dyRight) < 1) {
        comparedPairsRef.current.add(comparisonPairKey(left.conceptId, right.conceptId));
        return `comparison already settled ${left.conceptId} <-> ${right.conceptId}`;
      }

      const patches: { id: string; before: Record<string, unknown> }[] = [];
      const leftMove = buildConceptMove(left, leftNode, dxLeft, dyLeft, patches);
      const rightMove = buildConceptMove(right, rightNode, dxRight, dyRight, patches);

      // Relationships touching either concept get their arrow re-routed to
      // match the new positions (Part 9) — patched in place, same ids, so
      // this needs no boundElements changes.
      const seenRelIds = new Set<string>();
      const relationships = [
        ...board.relationshipsFor(left.conceptId),
        ...board.relationshipsFor(right.conceptId),
      ].filter((r) => {
        if (seenRelIds.has(r.relationshipId)) return false;
        seenRelIds.add(r.relationshipId);
        return true;
      });

      const origin = pageOrigin(pageRef.current);
      const obstacles = elementsRef.current
        .filter((el) => el.x >= origin.x - 40 && el.x < origin.x + PAGE_W + 40 && !el.containerId)
        .map((el) => (liveLineIdsRef.current.has(el.id) ? ({ ...el, softObstacle: true } as SceneElement) : el));

      const shiftFor = (conceptId: string) =>
        conceptId === left.conceptId
          ? { dx: dxLeft, dy: dyLeft }
          : conceptId === right.conceptId
            ? { dx: dxRight, dy: dyRight }
            : { dx: 0, dy: 0 };

      const rerouted: ComparisonReroute[] = [];
      for (const rel of relationships) {
        if (rel.elementIds.length === 0) continue;
        const fromEl = nodeForConcept(rel.fromConceptId);
        const toEl = nodeForConcept(rel.toConceptId);
        const oldArrowEl = elementsRef.current.find((e) => e.id === rel.elementIds[0]);
        if (!fromEl || !toEl || !oldArrowEl || oldArrowEl.type !== "arrow") continue;
        const fromShift = shiftFor(rel.fromConceptId);
        const toShift = shiftFor(rel.toConceptId);
        const fromTarget = { ...fromEl, x: fromEl.x + fromShift.dx, y: fromEl.y + fromShift.dy } as SceneElement;
        const toTarget = { ...toEl, x: toEl.x + toShift.dx, y: toEl.y + toShift.dy } as SceneElement;
        const built = await buildBoundArrow(`${rel.relationshipId}_reroute`, fromTarget, toTarget, rel.label, obstacles);
        if (!built) continue;

        patches.push({
          id: oldArrowEl.id,
          before: {
            x: oldArrowEl.x,
            y: oldArrowEl.y,
            points: oldArrowEl.points,
            width: oldArrowEl.width,
            height: oldArrowEl.height,
          },
        });
        const extraPatches: { id: string; fields: Partial<SceneElement> }[] = [];
        rel.elementIds.slice(1).forEach((id, i) => {
          const extra = built.extras[i];
          const oldEl = elementsRef.current.find((e) => e.id === id);
          if (!extra || !oldEl) return;
          patches.push({ id, before: { x: oldEl.x, y: oldEl.y } });
          extraPatches.push({ id, fields: { x: extra.x, y: extra.y } });
        });
        rerouted.push({
          relationshipId: rel.relationshipId,
          arrowElementId: oldArrowEl.id,
          arrowFields: {
            x: built.arrow.x,
            y: built.arrow.y,
            points: built.arrow.points,
            width: built.arrow.width,
            height: built.arrow.height,
          },
          extraPatches,
        });
      }

      const undo = emptyUndo();
      undo.elementPatches = patches;
      recordOperation("form_comparison", undo, {
        sourceText,
        confidence: action.confidence,
        conceptIds: [left.conceptId, right.conceptId],
      });
      comparedPairsRef.current.add(comparisonPairKey(left.conceptId, right.conceptId));
      log({
        type: "comparison",
        event: "detected",
        leftConceptId: left.conceptId,
        rightConceptId: right.conceptId,
        confidence: action.confidence,
        reason: action.evidence,
      });

      animateConceptMotion("comparison", [left.conceptId, right.conceptId], [leftMove, rightMove], rerouted);

      return `comparison ${left.conceptId} <-> ${right.conceptId} (${action.relationshipLabel})`;
    },
    [animateConceptMotion, buildConceptMove, log, nodeForConcept, recordOperation],
  );

  /**
   * Resolve a Director process decision against the board, compute where
   * every stage should end up, and record it as one undoable operation
   * before handing the actual movement to `animateConceptMotion`.
   *
   * Same reuse-never-duplicate contract as `performComparison`: every stage
   * must already exist and already be drawn, or nothing happens. Whether
   * this is a brand-new process or an extension of an already-committed one,
   * the full current stage list is always relaid out — there is no separate
   * "extend" code path here; lib/directorState.ts is what decides whether
   * firing again is even warranted (the "already formed" check below is what
   * keeps an already-settled process from being relaid out every beat).
   */
  const performProcess = useCallback(
    async (
      action: Extract<CanvasAction, { type: "form_process" }>,
      sourceText: string,
    ): Promise<string> => {
      const board = boardRef.current;
      const resolved = action.stages.map((id) => board.match(id));
      if (resolved.some((c) => !c)) return "process skipped: unresolved concepts";
      const concepts = resolved as Concept[];
      const ids = concepts.map((c) => c.conceptId);
      if (new Set(ids).size !== ids.length) return "process skipped: duplicate concept in stages";
      if (ids.length < 3 || ids.length > 6) return "process skipped: stage count out of range";
      if (directorStateRef.current.committedProcessConceptIds.some((chain) => ids.every((id) => chain.includes(id)))) {
        return `process skipped: ${ids.join(" -> ")} already formed`;
      }
      // Never fight the user (Part 13): dropped rather than deferred forever —
      // the stages stay uncommitted, so a later beat gets another chance.
      if (Date.now() - lastPointerInputRef.current < SKETCH_TOUCH_LOCK_MS || sketchBusyRef.current) {
        return "process deferred: user interacting";
      }

      const nodes = ids.map((id) => nodeForConcept(id));
      if (nodes.some((n) => !n)) return "process skipped: no drawn node";
      const drawnNodes = nodes as SceneElement[];

      const boxes: ProcessBox[] = drawnNodes.map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height }));
      const { positions, orientation } = computeProcessLayout(boxes, pageRef.current, penRef.current.y);
      const shifts = boxes.map((box, i) => ({ dx: positions[i].x - box.x, dy: positions[i].y - box.y }));

      if (shifts.every((s) => Math.hypot(s.dx, s.dy) < 1)) {
        directorStateRef.current = markProcessCommitted(directorStateRef.current, ids);
        return `process already settled ${ids.join(" -> ")}`;
      }

      const patches: { id: string; before: Record<string, unknown> }[] = [];
      const moves = concepts.map((concept, i) =>
        buildConceptMove(concept, drawnNodes[i], shifts[i].dx, shifts[i].dy, patches),
      );

      const shiftFor = (conceptId: string) => {
        const i = ids.indexOf(conceptId);
        return i === -1 ? { dx: 0, dy: 0 } : shifts[i];
      };

      const seenRelIds = new Set<string>();
      const relationships = ids
        .flatMap((id) => board.relationshipsFor(id))
        .filter((r) => {
          if (seenRelIds.has(r.relationshipId)) return false;
          seenRelIds.add(r.relationshipId);
          return true;
        });

      const origin = pageOrigin(pageRef.current);
      const obstacles = elementsRef.current
        .filter((el) => el.x >= origin.x - 40 && el.x < origin.x + PAGE_W + 40 && !el.containerId)
        .map((el) => (liveLineIdsRef.current.has(el.id) ? ({ ...el, softObstacle: true } as SceneElement) : el));

      const rerouted: ComparisonReroute[] = [];
      for (const rel of relationships) {
        if (rel.elementIds.length === 0) continue;
        const fromEl = nodeForConcept(rel.fromConceptId);
        const toEl = nodeForConcept(rel.toConceptId);
        const oldArrowEl = elementsRef.current.find((e) => e.id === rel.elementIds[0]);
        if (!fromEl || !toEl || !oldArrowEl || oldArrowEl.type !== "arrow") continue;
        const fromShift = shiftFor(rel.fromConceptId);
        const toShift = shiftFor(rel.toConceptId);
        const fromTarget = { ...fromEl, x: fromEl.x + fromShift.dx, y: fromEl.y + fromShift.dy } as SceneElement;
        const toTarget = { ...toEl, x: toEl.x + toShift.dx, y: toEl.y + toShift.dy } as SceneElement;
        const built = await buildBoundArrow(`${rel.relationshipId}_reroute`, fromTarget, toTarget, rel.label, obstacles);
        if (!built) continue;

        patches.push({
          id: oldArrowEl.id,
          before: {
            x: oldArrowEl.x,
            y: oldArrowEl.y,
            points: oldArrowEl.points,
            width: oldArrowEl.width,
            height: oldArrowEl.height,
          },
        });
        const extraPatches: { id: string; fields: Partial<SceneElement> }[] = [];
        rel.elementIds.slice(1).forEach((id, i) => {
          const extra = built.extras[i];
          const oldEl = elementsRef.current.find((e) => e.id === id);
          if (!extra || !oldEl) return;
          patches.push({ id, before: { x: oldEl.x, y: oldEl.y } });
          extraPatches.push({ id, fields: { x: extra.x, y: extra.y } });
        });
        rerouted.push({
          relationshipId: rel.relationshipId,
          arrowElementId: oldArrowEl.id,
          arrowFields: {
            x: built.arrow.x,
            y: built.arrow.y,
            points: built.arrow.points,
            width: built.arrow.width,
            height: built.arrow.height,
          },
          extraPatches,
        });
      }

      const undo = emptyUndo();
      undo.elementPatches = patches;
      recordOperation("form_process", undo, {
        sourceText,
        confidence: action.confidence,
        conceptIds: ids,
      });
      directorStateRef.current = markProcessCommitted(directorStateRef.current, ids);
      log({
        type: "process",
        event: "detected",
        conceptIds: ids,
        confidence: action.confidence,
        reason: action.evidence,
        orientation,
      });

      animateConceptMotion("process", ids, moves, rerouted);

      return `process ${ids.join(" -> ")} (${orientation})`;
    },
    [animateConceptMotion, buildConceptMove, log, nodeForConcept, recordOperation],
  );

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
    const app = apiRef.current?.getAppState?.();
    if (!app?.width || !app?.height) return;
    const origin = pageOrigin(pageRef.current);
    const pageBounds = { x: origin.x, y: origin.y, width: PAGE_W, height: PAGE_H };
    const onPage = elementsRef.current.filter((element) => {
      const owner = String((element.customData as { inpublicStoryOwner?: string } | undefined)?.inpublicStoryOwner ?? "");
      const isStory = owner.startsWith("story");
      if (modeRef.current === "story" ? !isStory : isStory) return false;
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
    const defaultFocalBounds = modeRef.current === "story"
      ? { x: origin.x + STORY_BOUNDS.x, y: origin.y + STORY_BOUNDS.y, width: STORY_BOUNDS.width, height: STORY_BOUNDS.height }
      : elementBounds ?? { x: origin.x + PAGE_PAD, y: origin.y + PAGE_PAD, width: PAGE_W - PAGE_PAD * 2, height: 500 };

    let focalBounds = defaultFocalBounds;
    let contextBounds: CompositionRect | undefined;
    const liveFocalElement = liveFocalElementId
      ? onPage.find((element) => element.id === liveFocalElementId)
      : undefined;
    if (liveFocalElement && modeRef.current !== "story") {
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
    } else if (mathFocalConceptId && modeRef.current !== "story") {
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
      zoom: Number(app.zoom?.value ?? app.zoom ?? 1),
    };
    const scene = activeStoryScene(storyRef.current);
    const focalSubject = modeRef.current === "story"
      ? storyRef.current.recentEntityIds[0] ?? "story-stage"
      : liveFocalElement
        ? "live narration"
        : sketchRef.current.labels.at(-1) ?? boardRef.current.activeSectionId ?? "current explanation";
    const activeCluster = modeRef.current === "story"
      ? scene?.sceneId ?? "story-scene"
      : liveFocalElement
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
  }, [animateCamera, flushPendingPageArrivalCamera, log]);

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
      // The diagram-in-progress belongs to the page it was drawn on — a page
      // turn (even with no pending evidence window, e.g. right after a
      // chain just completed but before flushVisualReentry finalized the
      // ref) always invalidates it for further growth. Already-drawn ink
      // stays on its own page; only the tracking ref is cleared.
      causeEffectProgressRef.current = null;
      if (visualReentryEvidenceRef.current.length > 0) {
        log({ type: "visual-reentry", event: "evidence-invalidated-page-turn", reason: "page locality changed before evidence completed" });
        visualReentryEvidenceRef.current = [];
        if (causeEvidenceTimerRef.current) clearTimeout(causeEvidenceTimerRef.current);
        causeEvidenceTimerRef.current = null;
      }

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

  /** Render one operation. This is the only path marks reach the canvas by —
   *  the Scribe and the local fallback both go through here. */
  // ---- Story Mode ----------------------------------------------------------
  const storyElementIdsRef = useRef<Set<string>>(new Set());
  const storyCaptionIdsRef = useRef<Set<string>>(new Set());
  const storyCaptionSeqRef = useRef(0);
  const storyAnimationSeqRef = useRef(0);
  const storyPartialRef = useRef<StoryPartialState>(emptyStoryPartialState());

  const clearStoryCaption = useCallback(() => {
    if (!storyCaptionIdsRef.current.size) return;
    const drop = storyCaptionIdsRef.current;
    elementsRef.current = elementsRef.current.filter((el) => !drop.has(el.id));
    storyCaptionIdsRef.current = new Set();
    commit();
  }, [commit]);

  const writeStoryCaption = useCallback(
    async (text: string) => {
      const spoken = text.trim();
      if (!spoken) return;
      const seq = ++storyCaptionSeqRef.current;
      await fontsReadyRef.current;
      const origin = pageOrigin(pageRef.current);
      const built = await buildLiveLine(spoken, origin.x + PAGE_PAD, origin.y + 48, false);
      if (seq !== storyCaptionSeqRef.current) return;
      const drop = storyCaptionIdsRef.current;
      elementsRef.current = [
        ...elementsRef.current.filter((el) => !drop.has(el.id)),
        ...built.elements,
      ];
      storyCaptionIdsRef.current = new Set(built.elements.map((el) => el.id));
      commit();
    },
    [commit],
  );

  const animateStoryElements = useCallback(async (
    base: SceneElement[],
    previous: SceneElement[],
    target: SceneElement[],
    durationMs: number,
  ) => {
    const sequence = ++storyAnimationSeqRef.current;
    const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || durationMs <= 0 || !apiRef.current) return;
    const prior = new Map(previous.map((element) => [element.id, element]));
    const targetIds = new Set(target.map((element) => element.id));
    const disappearing = previous.filter((element) => !targetIds.has(element.id));
    const started = performance.now();
    await new Promise<void>((resolve) => {
      const frame = (time: number) => {
        if (sequence !== storyAnimationSeqRef.current) return resolve();
        const progress = Math.min(1, Math.max(0, (time - started) / durationMs));
        const eased = 1 - Math.pow(1 - progress, 3);
        const interpolated = target.map((element) => {
          const from = prior.get(element.id);
          const fromOpacity = Number(from?.opacity ?? 0);
          const toOpacity = Number(element.opacity ?? 100);
          return {
            ...element,
            x: from ? Number(from.x) + (Number(element.x) - Number(from.x)) * eased : element.x,
            y: from ? Number(from.y) + (Number(element.y) - Number(from.y)) * eased : element.y,
            width: from ? Number(from.width) + (Number(element.width) - Number(from.width)) * eased : element.width,
            height: from ? Number(from.height) + (Number(element.height) - Number(from.height)) * eased : element.height,
            opacity: Math.round(fromOpacity + (toOpacity - fromOpacity) * eased),
            version: Math.max(Number(from?.version ?? 0), Number(element.version ?? 0)) + 1,
          } as SceneElement;
        });
        const fading = disappearing.map((element) => ({
          ...element,
          opacity: Math.round(Number(element.opacity ?? 100) * (1 - eased)),
          version: Number(element.version ?? 0) + 1,
        })) as SceneElement[];
        apiRef.current?.updateScene({ elements: [...base, ...fading, ...interpolated] as never });
        if (progress >= 1) resolve();
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }, []);

  const renderStoryState = useCallback(async (
    renderState: StoryState = storyRef.current,
    options: {
      provisionalEntityIds?: Set<string>;
      provisionalEnvironment?: Set<string>;
      animateMs?: number;
    } = {},
  ): Promise<string[]> => {
    const previous = storyElementIdsRef.current;
    const previousElements = elementsRef.current.filter((element) => previous.has(element.id));
    const baseElements = elementsRef.current.filter((element) => !previous.has(element.id));
    elementsRef.current = baseElements;
    const nextIds = new Set<string>();
    const additions: SceneElement[] = [];
    for (const scene of Object.values(renderState.scenes)) {
      const positions = storyEntityPositions(scene);
      const environmentPage = scene.pageIndices.at(-1) ?? pageRef.current;
      const environment = await buildStoryEnvironmentElements(scene, environmentPage);
      for (const element of environment) {
        additions.push(options.provisionalEnvironment?.has(String((element as any).customData?.inpublicStoryOwner).replace("story-env:", ""))
          ? { ...element, opacity: Math.min(Number(element.opacity ?? 100), 35) } as SceneElement
          : element);
        nextIds.add(element.id);
      }
      const entityBuilds = await Promise.all(
        Object.values(scene.entities).map(async (entity) => {
          const rendering = entity.renderings.at(-1);
          const position = positions.get(entity.entityId);
          if (!rendering || !position || entity.state.visible === false) {
            for (const item of entity.renderings) item.elementIds = [];
            if (entity.state.visible === false) entity.lifecycle = "historical";
            return { entity, rendering: undefined, built: [] as SceneElement[] };
          }
          const staging = storyStagingDecision(entity);
          log({
            type: "story-staging",
            entityId: entity.entityId,
            zone: staging.zone,
            bounds: position,
            reason: entity.placement.relation
              ? `${staging.reason}; placed ${entity.placement.relation} ${entity.placement.relativeTo ?? "target"}`
              : staging.reason,
          });
          const built = await buildStoryEntityElements(entity, position, rendering.pageIndex);
          return { entity, rendering, built };
        }),
      );
      for (const { entity, rendering, built } of entityBuilds) {
        if (rendering) {
          setStoryRendering(renderState, scene.sceneId, entity.entityId, rendering.pageIndex, built);
        }
        for (const element of built) {
          additions.push(options.provisionalEntityIds?.has(entity.entityId)
            ? { ...element, opacity: Math.min(Number(element.opacity ?? 100), 35) } as SceneElement
            : element);
          nextIds.add(element.id);
        }
      }
      const relationBuilds = await Promise.all(
        Object.values(scene.relations).map(async (relation) => {
          const from = scene.entities[relation.fromEntityId];
          const to = scene.entities[relation.toEntityId];
          const pageIndex = from?.renderings.at(-1)?.pageIndex ?? scene.pageIndices.at(-1) ?? 0;
          if (to?.renderings.at(-1)?.pageIndex !== pageIndex) {
            return { relation, built: [] as SceneElement[] };
          }
          return { relation, built: await buildStoryRelationElements(relation, positions, pageIndex) };
        }),
      );
      for (const { relation, built } of relationBuilds) {
        relation.elementIds = built.map((element) => element.id);
        additions.push(...built);
        for (const element of built) nextIds.add(element.id);
      }
    }
    const previousById = new Map(previousElements.map((element) => [element.id, element]));
    const versioned = additions.map((element) => {
      const prior = previousById.get(element.id);
      return prior
        ? { ...element, version: Number(prior.version ?? 0) + 1, versionNonce: Number(prior.versionNonce ?? 0) + 1 } as SceneElement
        : element;
    });
    storyElementIdsRef.current = nextIds;
    if (options.animateMs) {
      await animateStoryElements(baseElements, previousElements, versioned, options.animateMs);
    }
    elementsRef.current = [...baseElements, ...versioned];
    const warnings = auditStoryRenderConsistency(renderState, elementsRef.current);
    commit();
    if (compositionRef.current.activeCluster !== activeStoryScene(renderState)?.sceneId) {
      framePage(false, "initial Story stage entered the recording frame");
    }
    return warnings;
  }, [animateStoryElements, commit, framePage, log]);

  const ensureStoryPage = useCallback(
    (actions: StoryAction[]) => {
      const origin = pageOrigin(pageRef.current);
      const scene = activeStoryScene(storyRef.current);
      const creatingScene = actions.some((action) => action.type === "create_scene") && !scene;
      const standardObstacle = creatingScene && elementsRef.current.some((element) =>
        !storyElementIdsRef.current.has(element.id) &&
        !storyCaptionIdsRef.current.has(element.id) &&
        element.x >= origin.x && element.x < origin.x + PAGE_W &&
        element.y >= origin.y + 112,
      );
      const creating = actions.filter((action) => action.type === "create_entity").length;
      const entitiesOnPage = scene
        ? Object.values(scene.entities).filter(
            (entity) => entity.renderings.at(-1)?.pageIndex === pageRef.current,
          ).length
        : 0;
      // Story V2 owns one persistent page. Capacity changes layout, never scene continuity.
      if (scene || (!standardObstacle && storySceneFits(entitiesOnPage + creating))) return;
      turnPage(
        "overflow",
        standardObstacle
          ? "story scene does not fit around Standard marks"
          : "story scene needs a continuation sheet",
      );
      storyRef.current = continueStoryScene(storyRef.current, pageRef.current);
      const active = activeStoryScene(storyRef.current);
      if (active) {
        log({ type: "story-scene", event: "continued", sceneId: active.sceneId, pageIndex: pageRef.current });
      }
    },
    [log, turnPage],
  );

  const applyStoryBatch = useCallback(
    async (
      actions: StoryAction[],
      sourceText: string,
      interpreterWarnings: string[] = [],
      interpretation: { normalizedText?: string; confidence?: number } = {},
    ): Promise<string[]> => {
      const started = now();
      const compositionBefore = { ...compositionRef.current, camera: { ...compositionRef.current.camera }, proposedTarget: compositionRef.current.proposedTarget ? { ...compositionRef.current.proposedTarget } : undefined };
      const actionTarget = (action: StoryAction) =>
        "entityId" in action
          ? action.entityId
          : "sceneId" in action
            ? action.sceneId
            : action.relationId;
      const actionsRequested = actions.map((action) => ({ action: action.type, target: actionTarget(action) }));
      for (const requested of actionsRequested) {
        log({ type: "story-action-requested", action: requested.action, target: requested.target });
      }
      const originalPage = pageRef.current;
      let result = applyStoryActions(storyRef.current, actions, sourceText, originalPage, interpretation);
      ensureStoryPage(result.acceptedActions);
      if (pageRef.current !== originalPage) {
        result = applyStoryActions(storyRef.current, actions, sourceText, pageRef.current, interpretation);
      }
      storyRef.current = result.state;
      const operation = storyRef.current.operations.at(-1);
      if (operation && !operation.compositionBefore) operation.compositionBefore = compositionBefore;
      for (const applied of result.applied) {
        log({ type: "story-action-applied", result: applied });
        const entityId = applied.split(" ").at(-1) ?? "";
        if (applied.startsWith("created ") && !applied.startsWith("created scene")) {
          log({ type: "story-entity", event: "created", entityId });
        } else if (applied.startsWith("reused ")) {
          log({ type: "story-entity", event: "reused", entityId });
        } else if (applied.startsWith("transform ")) {
          log({ type: "story-entity", event: "transformed", entityId });
        } else if (applied.startsWith("visibility ")) {
          log({ type: "story-entity", event: "hidden", entityId });
        } else if (/^(?:update|move) /.test(applied)) {
          log({ type: "story-entity", event: "updated", entityId });
        }
      }
      const renderWarnings = await renderStoryState();
      const rejectedDecisions = result.decisions.filter((decision) => !decision.accepted);
      log({
        type: "story-decision",
        sourceText,
        normalizedText: interpretation.normalizedText,
        mode: "story",
        action: result.acceptedActions.map((action) => action.type).join(",") || "none",
        accepted: rejectedDecisions.length === 0,
        actionsRequested,
        actionsAccepted: result.decisions
          .filter((decision) => decision.accepted)
          .map((decision) => ({ action: decision.actionType, target: decision.target, reason: decision.reason })),
        actionsRejected: rejectedDecisions.map((decision) => ({ action: decision.actionType, target: decision.target, reason: decision.reason })),
        renderWarnings,
        latencyMs: Math.round(now() - started),
        proposedActions: actions.length,
        acceptedActions: result.acceptedActions.length,
        rejectedActionCount: rejectedDecisions.length,
        rejectedActions: rejectedDecisions.map((decision) => ({ action: decision.actionType, target: decision.target, reason: decision.reason })),
        decisions: result.decisions,
        entityResolutions: result.decisions.flatMap((decision) => decision.entityResolutions),
        assetResolutions: result.decisions.flatMap((decision) => decision.assetResolution ? [decision.assetResolution] : []),
        validationWarnings: [...interpreterWarnings, ...renderWarnings],
        warnings: [...interpreterWarnings, ...renderWarnings],
      });
      if (result.activatedSceneId) {
        const scene = storyRef.current.scenes[result.activatedSceneId];
        const targetPage = scene?.pageIndices.at(-1);
        if (targetPage !== undefined) gotoPage(targetPage);
        log({
          type: "story-scene",
          event: "activated",
          sceneId: result.activatedSceneId,
          pageIndex: targetPage ?? pageRef.current,
        });
      }
      return result.applied;
    },
    [ensureStoryPage, gotoPage, log, now, renderStoryState],
  );

  const applyStoryEventBatch = useCallback(async (event: StoryEvent): Promise<boolean> => {
    const started = performance.now();
    const beforeScene = activeStoryScene(storyRef.current);
    const beforeIds = new Set(Object.keys(beforeScene?.entities ?? {}));
    const compositionBefore = { ...compositionRef.current, camera: { ...compositionRef.current.camera }, proposedTarget: compositionRef.current.proposedTarget ? { ...compositionRef.current.proposedTarget } : undefined };
    const result = applyStoryEvent(storyRef.current, event, pageRef.current);
    const proposedActions = result.decisions.length;
    if (!result.accepted) {
      log({
        type: "story-decision",
        sourceText: event.sourceText,
        normalizedText: event.normalizedText,
        mode: "story",
        action: "story_event",
        accepted: false,
        actionsRequested: [{ action: "story_event", target: event.eventId }],
        actionsAccepted: [],
        actionsRejected: result.decisions.map((decision) => ({ action: "story_event", target: decision.target, reason: decision.reason })),
        renderWarnings: [],
        latencyMs: Math.round(performance.now() - started),
        proposedActions,
        acceptedActions: 0,
        rejectedActionCount: result.decisions.length,
        rejectedActions: result.decisions.map((decision) => ({ action: "story_event", target: decision.target, reason: decision.reason })),
        decisions: result.decisions.map((decision, actionIndex) => ({
          actionIndex,
          actionType: "story_event",
          target: decision.target,
          accepted: decision.accepted,
          reason: decision.reason,
          entityResolutions: [],
          warnings: [],
        })),
        entityResolutions: [],
        assetResolutions: [],
        validationWarnings: [],
        warnings: [],
      });
      return false;
    }
    // A compound utterance such as "stood up and ran" has meaningful visual
    // choreography. Render the validated intermediate pose from a disposable
    // preview state, then commit only the complete event below.
    if (event.actions.length > 1) {
      const intermediateEvent: StoryEvent = {
        ...event,
        provisional: true,
        actions: event.actions.slice(0, -1),
        relations: [],
      };
      const intermediate = applyStoryEvent(storyRef.current, intermediateEvent, pageRef.current);
      if (intermediate.accepted) {
        await renderStoryState(intermediate.state, { animateMs: 260 });
      }
    }
    storyRef.current = result.state;
    if (result.operation) result.operation.compositionBefore = compositionBefore;
    const animateMs = event.relations.some((relation) => relation.relation === "toward" || relation.relation === "away-from")
      ? 680
      : event.environment.length
        ? 460
        : event.actions.length
          ? 300
          : 240;
    const renderWarnings = await renderStoryState(storyRef.current, { animateMs });
    const afterScene = activeStoryScene(storyRef.current);
    for (const entityId of result.changedEntityIds) {
      log({ type: "story-entity", event: beforeIds.has(entityId) ? "updated" : "created", entityId });
    }
    const latencyMs = Math.round(performance.now() - started);
    log({
      type: "story-decision",
      sourceText: event.sourceText,
      normalizedText: event.normalizedText,
      mode: "story",
      action: "story_event",
      accepted: true,
      actionsRequested: [{ action: "story_event", target: event.eventId }],
      actionsAccepted: result.decisions.map((decision) => ({ action: "story_event", target: decision.target, reason: decision.reason })),
      actionsRejected: [],
      renderWarnings,
      latencyMs,
      proposedActions,
      acceptedActions: result.decisions.length,
      rejectedActionCount: 0,
      rejectedActions: [],
      decisions: result.decisions.map((decision, actionIndex) => ({
        actionIndex,
        actionType: "story_event",
        target: decision.target,
        accepted: true,
        reason: decision.reason,
        entityResolutions: decision.unit === "entity"
          ? [{ reference: decision.target, entityId: decision.target, status: beforeIds.has(decision.target) ? "resolved" as const : "created" as const }]
          : [],
        warnings: [],
      })),
      entityResolutions: result.changedEntityIds.map((entityId) => ({
        reference: afterScene?.entities[entityId]?.label ?? entityId,
        entityId,
        status: beforeIds.has(entityId) ? "resolved" as const : "created" as const,
      })),
      assetResolutions: result.changedEntityIds.map((entityId) => {
        const entity = afterScene?.entities[entityId];
        return entity?.assetKey
          ? { requested: entity.label, resolved: entity.assetKey, status: "matched" as const }
          : { requested: entity?.label ?? entityId, resolved: entity?.recipe, status: "needs_asset" as const };
      }),
      validationWarnings: renderWarnings,
      warnings: renderWarnings,
    });
    log({ type: "story-lane-timing", lane: event.actions.length || event.relations.length ? "update" : "commit", sourceText: event.sourceText, latencyMs, eventId: event.eventId });
    return true;
  }, [log, renderStoryState]);

  const renderStoryProvisional = useCallback(async (event?: StoryEvent) => {
    if (!event) {
      await renderStoryState(storyRef.current, { animateMs: 180 });
      return;
    }
    const started = performance.now();
    const preview = applyStoryEvent(storyRef.current, event, pageRef.current);
    if (!preview.accepted) return;
    await renderStoryState(preview.state, {
      provisionalEntityIds: new Set(preview.changedEntityIds),
      provisionalEnvironment: new Set(preview.changedEnvironment),
      animateMs: 220,
    });
    log({
      type: "story-lane-timing",
      lane: "provisional",
      sourceText: event.sourceText,
      latencyMs: Math.round(performance.now() - started),
      eventId: event.eventId,
    });
  }, [log, renderStoryState]);

  const doStoryUndo = useCallback(async () => {
    const undone = undoStoryAction(storyRef.current);
    storyRef.current = undone.state;
    await renderStoryState();
    restoreCompositionCamera(undone.operation?.compositionBefore);
    log({
      type: "story-undo",
      action: undone.operation?.actionType,
      operationId: undone.operation?.operationId,
    });
  }, [log, renderStoryState, restoreCompositionCamera]);

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
      // V2 INVARIANT (docs/LIVE-SPEECH-PRESENTATION-V2.md, "Settled
      // Thought"): a settled line is left on the page instead of being
      // deleted the instant the next utterance starts. Load-bearing, not
      // cosmetic — with the Scribe suppressed, this is the ONLY thing that
      // makes settled speech a permanent page record under V2.
      if (!v2Enabled && !liveRef.current && settledLiveRef.current) dropSettledLiveLine();

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
      const ours = prior !== null && samePen(penRef.current, prior.after);
      // V2 INVARIANT: an active thought should not repeatedly re-anchor
      // (docs/LIVE-SPEECH-PRESENTATION-V2.md, "Protected Invariants" #4).
      // With secondary producers suppressed, the pen should never move out
      // from under it — diagnostic only; if it did anyway, that's worth
      // knowing about rather than silently re-anchoring.
      if (v2Enabled && prior !== null && !ours) {
        log({ type: "v2", event: "anchor-reset", detail: settled ? "final" : "interim" });
      }
      // The utterance's element id, adopted from the first build and then held
      // for the rest of the sentence. Empty until that first build lands.
      let elementId = prior?.elementId ?? "";
      let base: Pen = ours ? prior!.base : { ...penRef.current };
      let probe: Pen = { ...base };
      let spot = lineStart(probe);
      const buildStartedAt = now();
      let built = await buildLiveLine(spoken, spot.x, spot.y, settled, elementId);
      latency.observe("build_live_line", now() - buildStartedAt);

      // A newer interim landed while we were building. Drop this one rather
      // than rewinding the line to older words.
      if (seq !== liveSeqRef.current) return;

      // A long sentence can outgrow the sheet mid-word. Turn early and keep
      // writing — never stop to make room.
      if (willOverflow(probe, built.w, built.h)) {
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
              } as Partial<SceneElement>)
            : el,
        );
      } else {
        elementsRef.current = [
          ...elementsRef.current.filter((el) => !stale.has(el.id)),
          ...built.elements,
        ];
        // Adopt the id Excalidraw actually issued — that is the stable one.
        elementId = built.elements[0]?.id ?? elementId;
      }

      // Reserve the row now, not at the end of the sentence, so anything drawn
      // afterwards lands under the line instead of through it.
      penRef.current = probe;
      place(penRef.current, built.w, built.h, true);

      if (settled) {
        const settledIds = existingIndex >= 0 ? [elementId] : built.elements.map((el) => el.id);
        for (const id of settledIds) liveLineIdsRef.current.add(id);
        settledLiveRef.current = { ids: settledIds, base, after: { ...penRef.current } };
        liveRef.current = null;
      } else {
        liveRef.current = {
          elementId,
          // When patching in place the element is already in the scene, so the
          // stale set must keep naming it rather than the throwaway build.
          ids: existingIndex >= 0 ? [elementId] : built.elements.map((el) => el.id),
          base,
          after: { ...penRef.current },
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
      if (!v2Enabled) {
        framePage(false, "following live narration", null, elementId, false, inheritedPageArrivalIdentity ?? null);
      } else {
        const app = apiRef.current?.getAppState?.();
        const fits = liveLineFitsViewport(
          { x: spot.x, y: spot.y, width: built.w, height: built.h },
          {
            scrollX: Number(app?.scrollX ?? 0),
            scrollY: Number(app?.scrollY ?? 0),
            zoom: Number(app?.zoom?.value ?? app?.zoom ?? 1) || 1,
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
          // a queued Visual Re-entry commit or a pending structural reframe
          // still deserves to run the moment speech goes quiet. What it no
          // longer does is fall back to a generic full-page overview when
          // neither of those is waiting; "nothing happened for 1.8 seconds"
          // is not by itself a camera command.
          void flushVisualReentryRef.current?.().then((committed) => {
            if (committed) return;
            if (pendingReframeRef.current) releasePendingReframeRef.current?.();
          });
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
    [commit, dropSettledLiveLine, flushPendingPageArrivalCamera, framePage, log, now, requestPageTurn, turnPage, v2Enabled],
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

  /**
   * Local fallback. No model, no network. Runs only when the Scribe is
   * unhealthy, so the board never goes dead mid-sentence.
   */
  const growSketch = useCallback(
    async (text: string, isInterim: boolean) => {
      if (Date.now() - lastPointerInputRef.current < SKETCH_TOUCH_LOCK_MS) {
        log({ type: "sketch-blocked", why: "recent pointer input" });
        return;
      }
      if (sketchBusyRef.current) return;
      const gesture = detectGesture(text, sketchRef.current.gestures);
      const concepts = extractConcepts(
        text,
        sketchRef.current.concepts,
        isInterim,
      );
      if (!gesture && concepts.length === 0) return;

      sketchBusyRef.current = true;
      const added: string[] = [];
      try {
        if (gesture?.kind === "title-pending") {
          sketchRef.current.gestures.add("title-pending");
        } else if (gesture?.kind === "greeting") {
          sketchRef.current.gestures.add("greeting");
          if (await applyOp({ op: "wave" })) added.push("wave");
        } else if (gesture?.kind === "title") {
          sketchRef.current.gestures.add("title");
          if (await applyOp({ op: "title", text: gesture.text })) {
            added.push(`title: ${gesture.text}`);
          }
        }

        for (const label of concepts) {
          const promoteToTitle =
            sketchRef.current.gestures.has("title-pending") &&
            !sketchRef.current.gestures.has("title");
          if (promoteToTitle) sketchRef.current.gestures.add("title");
          const op: Op = promoteToTitle
            ? { op: "title", text: label }
            : { op: "box", text: label };
          if (await applyOp(op)) added.push(promoteToTitle ? `title: ${label}` : label);
        }
      } finally {
        sketchBusyRef.current = false;
        if (added.length > 0) log({ type: "sketch", labels: added });
      }
    },
    [applyOp, log],
  );

  // ---- tier 2: speculative visuals ----------------------------------------
  /**
   * The board's guesses, drawn from settled interim speech.
   *
   * These are deliberately placed through the SAME pen as the Scribe's marks
   * rather than into a separate gutter. Two reasons, and the second is the
   * important one:
   *
   * - A guess and the real mark that replaces it must occupy the same
   *   coordinate space, or reconciliation turns into a layout problem instead
   *   of an identity one.
   * - It means a speculative mark behaves exactly like a Scribe mark that
   *   arrived early — including the live line's existing re-anchor, which is
   *   already the tested answer to "something landed while I was writing".
   *   No new interaction between tiers is invented.
   *
   * The cost of that choice is that placing one nudges an in-progress
   * sentence down once, the same way a Scribe mark does today. The frequency
   * gate in handleInterim is what keeps that from becoming jitter: at most one
   * batch per settled chunk, and only for content the deterministic
   * recognisers are confident about.
   */
  const speculativeStateRef = useRef<SpeculativeState>(emptySpeculativeState());
  const speculativeMarksRef = useRef<
    Map<string, { elementIds: string[]; text: string; source: string; kind: string }>
  >(new Map());
  /** Settled text for the utterance in flight, for phrase-level recognisers. */
  const speculativeUtteranceRef = useRef("");

  /**
   * Drop provisional elements by key. Free, by construction — nothing else
   * references them and they hold no semantic-board state.
   *
   * `animate` defaults to true: a guess the speaker's words didn't confirm
   * should read as the board resolving a thought, not as a mistake being
   * erased (Part 8 of the brief). It's forced off for a hard reset (undo,
   * explicit clear, stale epoch) where a fade would just be a stale visual
   * lingering on a board that has already moved on.
   */
  const retireSpeculative = useCallback(
    (keys: string[], why: string, animate = true) => {
      if (!keys.length) return;
      const doomed = new Set<string>();
      for (const key of keys) {
        const entry = speculativeMarksRef.current.get(key);
        if (!entry) continue;
        for (const id of entry.elementIds) doomed.add(id);
        speculativeMarksRef.current.delete(key);
        log({ type: "speculative", event: "retired", kind: entry.kind, text: entry.text, why });
      }
      if (!doomed.size) return;
      if (!animate) {
        elementsRef.current = elementsRef.current.filter((el) => !doomed.has(el.id));
        commit();
        return;
      }
      const epoch = liveSeqRef.current;
      const steps = opacityPulse(SPECULATIVE_OPACITY, 0, 3, 180);
      runPulse(
        steps,
        (opacity) => {
          elementsRef.current = elementsRef.current.map((el) =>
            doomed.has(el.id) ? patch(el, { opacity }) : el,
          );
          commit();
        },
        () => liveSeqRef.current !== epoch,
      );
      // Remove for good once the fade finishes. Unconditional on the epoch —
      // if the board moved on, filtering these ids out is a harmless no-op
      // either way (they're either already gone or belong to a page nobody
      // is looking at anymore).
      setTimeout(() => {
        elementsRef.current = elementsRef.current.filter((el) => !doomed.has(el.id));
        commit();
      }, steps[steps.length - 1]?.delayMs ?? 0);
    },
    [commit, log],
  );

  /**
   * Retire any guess a real mark supersedes.
   *
   * Called from applyOp (Scribe) and applyActions (Artist) BEFORE the real
   * element is placed, so the two never coexist. This is the whole duplicate
   * story: there is no reconciliation pass that runs later and tidies up,
   * because a pass that runs later is a pass that is visible.
   */
  const reconcileSpeculative = useCallback(
    (realText: string) => {
      if (!realText || !speculativeMarksRef.current.size) return;
      const superseded: string[] = [];
      for (const [key, entry] of speculativeMarksRef.current) {
        if (supersedes(realText, entry.text)) superseded.push(key);
      }
      retireSpeculative(superseded, "superseded by a real mark");
    },
    [retireSpeculative],
  );
  reconcileSpeculativeRef.current = reconcileSpeculative;

  /**
   * Draw one batch of guesses.
   *
   * Provisional styling is opacity alone — no animation, no colour change, no
   * dashed borders. The brief is "something is forming", and anything more
   * assertive than a faded mark reads as the interface flickering.
   */
  const renderSpeculative = useCallback(
    async (
      events: SpeculativeEvent[],
      isStale?: () => boolean,
    ): Promise<Map<string, SpeculativeOutcome>> => {
      const outcomes = new Map<string, SpeculativeOutcome>();
      if (!events.length) return outcomes;
      // Never fight the cursor, and never draw a guess over a diagram that is
      // mid-render. Both are cheap to skip: the words are still being lettered
      // by tier 1 regardless. These are TEMPORARY blocks — the caller keeps
      // the events deferred and retries them, rather than losing them, which
      // is why every event gets "blocked" rather than being dropped silently.
      if (Date.now() - lastPointerInputRef.current < SKETCH_TOUCH_LOCK_MS) {
        for (const event of events) outcomes.set(event.key, "blocked");
        log({ type: "speculative", event: "blocked", why: "recent pointer input", text: `${events.length} guess(es) deferred` });
        return outcomes;
      }
      if (sketchBusyRef.current) {
        for (const event of events) outcomes.set(event.key, "blocked");
        log({ type: "speculative", event: "blocked", why: "sketch busy", text: `${events.length} guess(es) deferred` });
        return outcomes;
      }
      // The cap that matters for tier 2 is how many UNCONFIRMED guesses are on
      // screen at once, not how many marks the page has accumulated overall.
      // Counting the latter would stop the board guessing forever once eight
      // real marks existed, which is the opposite of the intent.
      if (speculativeMarksRef.current.size >= MAX_OUTSTANDING_SPECULATIVE) {
        for (const event of events) outcomes.set(event.key, "blocked");
        log({ type: "speculative", event: "blocked", why: "outstanding-guess cap reached", text: `${events.length} guess(es) deferred` });
        return outcomes;
      }

      let staleMidBatch = false;
      for (const event of events) {
        // A clear/undo/new-page/reconnect landed while a previous event in
        // this same batch was awaiting buildOp — stop drawing immediately.
        // Whatever hasn't been drawn yet is "blocked" (retryable against the
        // board as it now is), not "dropped".
        if (isStale?.()) {
          staleMidBatch = true;
          outcomes.set(event.key, "blocked");
          continue;
        }
        const op: Op =
          event.kind === "title"
            ? { op: "title", text: event.text }
            : event.kind === "concept"
              ? { op: "box", text: event.text }
              : { op: "heading", text: event.text };

        // The Scribe's own dedupe registry is authoritative for real marks;
        // a guess must never claim a key out from under it. This is a
        // permanent condition (a real mark already exists), not a temporary
        // one, so it is "dropped" rather than retried.
        if (renderedMarkKeysRef.current.has(markKey(event.text))) {
          outcomes.set(event.key, "dropped");
          log({ type: "speculative", event: "dropped", kind: event.kind, text: event.text, why: "a real mark already claimed this text" });
          continue;
        }

        let built;
        try {
          built = await buildOp(op, penRef.current, marksRef.current);
        } catch {
          // A guess that will not build is simply not drawn. There is no
          // fallback and no error surface — tier 1 is unaffected. Retrying a
          // build failure would just fail again, so this is permanent too.
          outcomes.set(event.key, "dropped");
          log({ type: "speculative", event: "dropped", kind: event.kind, text: event.text, why: "buildOp threw" });
          continue;
        }
        if (!built) {
          outcomes.set(event.key, "dropped");
          log({ type: "speculative", event: "dropped", kind: event.kind, text: event.text, why: "buildOp returned nothing" });
          continue;
        }

        // An emphasis-flagged concept is still a guess, not a certainty, but
        // the speaker just stressed it — a shade less faint communicates
        // "more likely to matter" without pretending it's confirmed.
        const opacity = event.emphasis
          ? Math.min(70, SPECULATIVE_OPACITY + 20)
          : SPECULATIVE_OPACITY;
        const faded = built.elements.map((el) => patch(el, { opacity }));
        elementsRef.current = [...elementsRef.current, ...faded];
        speculativeMarksRef.current.set(event.key, {
          elementIds: faded.map((el) => el.id),
          text: event.text,
          source: event.source,
          kind: event.kind,
        });
        outcomes.set(event.key, "rendered");
        log({ type: "speculative", event: "drawn", kind: event.kind, text: event.text, why: "settled interim speech" });
      }

      commit();
      latency.mark("first_speculative", latencyNow());
      noteTierLatency("speech_to_speculative");
      return outcomes;
    },
    [commit, log, noteTierLatency],
  );

  /**
   * Settle the guesses for an utterance against what was actually said.
   *
   * A guess whose words survived into the final transcript is promoted to full
   * opacity and left for the Scribe or Artist to supersede later. One whose
   * words were revised away was a mishearing, and disappears. This is the
   * moment the "cheap to be wrong" promise is actually kept.
   */
  const settleSpeculative = useCallback(
    (finalText: string) => {
      speculativeUtteranceRef.current = "";
      if (!speculativeMarksRef.current.size) return;
      const wrong: string[] = [];
      const promoted: string[] = [];
      for (const [key, entry] of speculativeMarksRef.current) {
        if (confirmedByFinal(entry.source, finalText)) promoted.push(...entry.elementIds);
        else wrong.push(key);
      }
      retireSpeculative(wrong, "not present in the final transcript");
      if (promoted.length) {
        // Faint -> solid over a beat, not an instant jump: this is the
        // "resolving a thought" feel from Part 8, not "a value flipped".
        const ids = new Set(promoted);
        const epoch = liveSeqRef.current;
        const steps = opacityPulse(SPECULATIVE_OPACITY, 100, 4, 220);
        runPulse(
          steps,
          (opacity) => {
            elementsRef.current = elementsRef.current.map((el) =>
              ids.has(el.id) ? patch(el, { opacity }) : el,
            );
            commit();
          },
          () => liveSeqRef.current !== epoch,
        );
        log({ type: "speculative", event: "promoted", why: "confirmed by the final transcript" });
      }
    },
    [commit, log, retireSpeculative],
  );

  // ---- the reflex layer: signs during speech ------------------------------
  //
  // THE INVERSION. Until now interims reached only writeLive (the caption
  // line) and every visual system waited for a settled thought — words live,
  // pictures late. Under wordless mode that is backwards, so the same settled
  // interim words also drive tentative signs here.
  //
  // This deliberately runs even when V2 is active, which the older Tier 2
  // reflex does not (`features.reflex && !v2Enabled` in handleInterim). V2's
  // protected invariant 6 exists to stop secondary systems fighting the live
  // *text* line for the screen; these signs are drawn in their own reserved
  // band (lib/meaning/provisional.ts) and never touch the thought lifecycle,
  // and under wordless the text line is no longer the primary output for them
  // to collide with. Invariant 1 — no model in the Tier 1 live path — is
  // untouched: the scan is pure regex and table lookup, no network.
  const provisionalStateRef = useRef<ProvisionalState>(emptyProvisionalState());
  const provisionalIdentityRef = useRef(createProvisionalIdentity());
  /** Everything settled in the current utterance, rescanned whole each tick. */
  const provisionalUtteranceRef = useRef("");
  /** Bumped at every settlement, so a new utterance can never adopt old keys. */
  const provisionalUtteranceIdRef = useRef(0);

  /**
   * Apply one reflex diff to the canvas.
   *
   * No `recordOperation`: provisional ink is scaffolding with a lifetime
   * shorter than a sentence, and every mark it makes is removed again at
   * settlement (or at a page turn, or a reset). Putting each guess in the undo
   * stack would bury the user's real history under the machine's thinking.
   */
  const applyProvisional = useCallback(
    async (next: ProvisionalState) => {
      const epoch = liveSeqRef.current;
      const { elements, addedIds, removedIds } = await syncProvisionalCanvas(
        next,
        elementsRef.current,
        pageRef.current,
        provisionalIdentityRef.current,
      );
      // A clear/undo/page change between the scan and the draw invalidates the
      // whole result — same stale-epoch guard writeLive and Tier 2 both use.
      if (liveSeqRef.current !== epoch) return;
      if (!addedIds.length && !removedIds.length) return;
      elementsRef.current = elements;
      commit();
    },
    [commit],
  );

  /** Settled interim words -> tentative signs. Synchronous scan, async draw. */
  const reflexOnInterim = useCallback(
    (freshWords: string) => {
      provisionalUtteranceRef.current = `${provisionalUtteranceRef.current} ${freshWords}`.trim();
      const diff = scanProvisional(
        provisionalStateRef.current,
        provisionalUtteranceRef.current,
        String(provisionalUtteranceIdRef.current),
      );
      provisionalStateRef.current = diff.state;
      if (!diff.added.length && !diff.updated.length && !diff.removed.length) return;
      log({
        type: "reflex",
        event: "provisional",
        added: diff.added.map((a) => a.sign.glyph),
        updated: diff.updated.map((u) => u.sign.glyph),
        removed: diff.removed.length,
      });
      void applyProvisional(diff.state);
    },
    [applyProvisional, log],
  );

  /**
   * The thought settled. Retire every guess *before* the Meaning Engine draws
   * its confident version, so a viewer never sees both readings at once.
   */
  const settleProvisional = useCallback(() => {
    provisionalUtteranceRef.current = "";
    provisionalUtteranceIdRef.current += 1;
    const diff = clearProvisional(provisionalStateRef.current);
    provisionalStateRef.current = diff.state;
    if (diff.removed.length) void applyProvisional(diff.state);
  }, [applyProvisional]);

  /** Everything provisional, gone. Used by undo and by explicit clears. */
  const dropAllSpeculative = useCallback(() => {
    // Instant, not faded: a hard reset should not leave a fading ghost behind.
    retireSpeculative([...speculativeMarksRef.current.keys()], "session reset", false);
    speculativeStateRef.current = emptySpeculativeState();
    speculativeUtteranceRef.current = "";
    provisionalStateRef.current = emptyProvisionalState();
    provisionalIdentityRef.current = createProvisionalIdentity();
    provisionalUtteranceRef.current = "";
  }, [retireSpeculative]);

  // ---- the Scribe ----------------------------------------------------------
  // A tight loop of short streaming calls. Each renders operations line by
  // line, so marks appear in rhythm with speech rather than in a batch.
  /** Finalised speech waiting to be handled. This is separate from the beat
   * buffer, which is allowed to clear when a polished draw starts. */
  const scribePendingRef = useRef("");
  const scribeContextRef = useRef("");
  /** Interim-stability tracking, so the hand can run ahead of the final. */
  const prevInterimRef = useRef<string[]>([]);
  const settledCountRef = useRef(0);
  const scribeInFlightRef = useRef(false);
  const scribeQueuedRef = useRef(false);
  const scribeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scribeLastRunRef = useRef(0);
  const scribeRetryAtRef = useRef(0);
  const scribeFailuresRef = useRef(0);
  /** Exactly what was last handed to the model, to detect a no-op re-send. */
  const scribeLastSentRef = useRef("");
  /** When words first became eligible, so queue wait can be told from model time. */
  const scribeQueuedAtRef = useRef(0);

  const runScribe = useCallback(async () => {
    if (modeRef.current !== "standard") return;
    if (scribeInFlightRef.current) {
      scribeQueuedRef.current = true;
      return;
    }

    // Is there anything worth spending a call on? Asked BEFORE the cooldown,
    // so a wake-up carrying nothing new does not schedule a timer that will
    // wake us again to discover the same nothing.
    const decision = shouldWakeScribe({
      fresh: scribePendingRef.current,
      lastSent: scribeLastSentRef.current,
      onPage: sketchRef.current.labels.slice(-24),
      inFlight: scribeInFlightRef.current,
      // Matched to applyOp's rule deliberately. That suppression only applies
      // within the opening composition window; applying it for the whole
      // session here would silence the Scribe permanently after eight marks,
      // which is a behaviour change nobody asked for and the kind of thing
      // that reads as the product breaking.
      attentionBudgetFull:
        withinInitialCompositionWindow(now()) &&
        temporaryMarkBudgetReached(sketchRef.current.count),
    });
    if (!decision.wake) {
      if (decision.reason !== "no-fresh-text" && decision.reason !== "in-flight") {
        log({ type: "scribe-skipped", reason: decision.reason, fresh: normalizeScribeText(scribePendingRef.current).slice(0, 90) });
        // Retire text that will never be drawn, so it cannot keep re-triggering
        // this same refusal on every subsequent final. A full attention budget
        // is the exception: it frees up on the next page turn, so those words
        // are still worth keeping.
        if (decision.reason !== "attention-budget-full") scribePendingRef.current = "";
      }
      return;
    }

    const waitMs = requestDelayMs({
      nowMs: Date.now(),
      lastRunAtMs: scribeLastRunRef.current,
      retryAtMs: scribeRetryAtRef.current,
      lastPointerAtMs: lastPointerInputRef.current,
      minIntervalMs: SCRIBE_INTERVAL_MS,
      touchLockMs: SKETCH_TOUCH_LOCK_MS,
    });
    if (waitMs > 0) {
      if (!scribeTimerRef.current) {
        scribeTimerRef.current = setTimeout(() => {
          scribeTimerRef.current = null;
          void runScribe();
        }, waitMs);
      }
      return;
    }

    // Deepgram finalises short chunks quickly. Drawing only stable words avoids
    // permanently lettering guesses from a changing interim transcript.
    const fresh = decision.payload;
    if (!fresh) return;
    scribeLastSentRef.current = fresh;
    latency.observe("scribe_request_wait", Date.now() - scribeQueuedAtRef.current);

    scribeInFlightRef.current = true;
    const startedAt = Date.now();
    scribeQueuedAtRef.current = 0;
    scribeLastRunRef.current = startedAt;
    scribePendingRef.current = "";
    const context = scribeContextRef.current;
    scribeContextRef.current = `${context} ${fresh}`
      .trim()
      .split(/\s+/)
      .slice(-40)
      .join(" ");
    const drawn: string[] = [];

    try {
      scribeAbortRef.current?.abort();
      scribeAbortRef.current = new AbortController();
      const res = await fetch("/api/scribe", {
        method: "POST",
        headers: providerRequestHeaders({ "content-type": "application/json" }),
        signal: scribeAbortRef.current.signal,
        body: JSON.stringify({
          fresh,
          context,
          onPage: sketchRef.current.labels.slice(-24),
        }),
      });
      if (res.status === 429) {
        const payload = await res.json().catch(() => null) as {
          error?: { code?: string; message?: string; retryAfterSeconds?: number };
        } | null;
        if (payload?.error?.code !== "rate_limited") {
          throw new Error(payload?.error?.message || `scribe ${res.status}`);
        }
        const cooldownMs = retryAfterMs(
          res.headers.get("retry-after") ??
            (payload.error.retryAfterSeconds !== undefined
              ? String(payload.error.retryAfterSeconds)
              : null),
          SCRIBE_RETRY_FALLBACK_MS,
        );
        // Add a small boundary buffer so the next request cannot land in the
        // same rolling window because of clock or network jitter.
        scribeRetryAtRef.current = Date.now() + cooldownMs + 250;
        scribeFailuresRef.current = 0;
        log({
          type: "note",
          text: `scribe rate limited; cooling down for ${Math.ceil(cooldownMs / 1000)}s`,
        });
        await growSketch(fresh, false);
        setErrorText((current) => current === SCRIBE_FAILURE_MESSAGE ? null : current);
        return;
      }
      if (!res.ok || !res.body) throw new Error(`scribe ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const source = `${context} ${fresh}`;
      const handle = async (line: string) => {
        for (const op of parseLine(line)) {
          // Every mark has to be traceable to something that was actually
          // said. The Scribe occasionally assembles a phrase out of nothing —
          // "puts AI" is the one from the 10:09 session — and a board that
          // letters words the speaker did not say is worse on camera than a
          // board that letters fewer of them. Phonetic slack is allowed, so a
          // mark cleaned up from "air agents" to "AI agents" still passes.
          if ("text" in op && !groundedInSource(op.text, source)) {
            log({
              type: "sketch-blocked",
              why: `"${op.text}" is not in what was said`,
            });
            continue;
          }
          if (!(await applyOp(op, source))) continue;
          if (!drawn.length) {
            latency.mark("first_scribe_mark", latencyNow());
            latency.observe("scribe_first_op", Date.now() - startedAt);
            noteTierLatency("speech_to_scribe");
          }
          drawn.push(
            op.op === "link"
              ? `link "${op.from}" -> "${op.to}"`
              : op.op === "icon"
                ? `icon ${op.name}`
                : "text" in op
                  ? `${op.op} "${op.text}"`
                  : op.op,
          );
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        // Render each op the moment its line is complete — this is what makes
        // marks land progressively instead of all at once.
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          await handle(line);
        }
      }
      if (buffer.trim()) await handle(buffer);

      scribeFailuresRef.current = 0;
      scribeRetryAtRef.current = 0;
      setErrorText((current) => current === SCRIBE_FAILURE_MESSAGE ? null : current);
      if (drawn.length > 0) log({ type: "sketch", labels: drawn });
      // Log every call, drawn or not. The previous session showed marks 5.5s
      // apart and the log could not say whether the Scribe was slow, throttled,
      // or simply choosing to stay silent.
      log({
        type: "scribe",
        fresh: fresh.slice(0, 90),
        ms: Date.now() - startedAt,
        drew: drawn.length,
      });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        scribeInFlightRef.current = false;
        return;
      }
      scribeFailuresRef.current += 1;
      log({
        type: "note",
        text: `scribe failed (${scribeFailuresRef.current}): ${String(err)}`,
      });
      // Keep the board alive with the dumb-but-reliable path. A model failure
      // must never stop the live canvas.
      await growSketch(fresh, false);
      if (scribeFailuresRef.current >= 3) {
        setErrorText(SCRIBE_FAILURE_MESSAGE);
      }
    } finally {
      scribeInFlightRef.current = false;
      if (scribePendingRef.current.trim()) scribeQueuedRef.current = true;
      if (scribeQueuedRef.current) {
        scribeQueuedRef.current = false;
        queueMicrotask(() => void runScribe());
      }
    }
  }, [applyOp, growSketch, log]);

  /** Called on every transcript update; runScribe owns all scheduling. */
  const nudgeScribe = useCallback(() => {
    if (!SCRIBE_ENABLED) return;
    if (!scribeQueuedAtRef.current) scribeQueuedAtRef.current = Date.now();
    void runScribe();
  }, [runScribe]);

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
    if (op.type === "form_comparison" && op.conceptIds.length === 2) {
      comparedPairsRef.current.delete(comparisonPairKey(op.conceptIds[0], op.conceptIds[1]));
      log({
        type: "comparison",
        event: "undo",
        leftConceptId: op.conceptIds[0],
        rightConceptId: op.conceptIds[1],
      });
    }
    if (op.type === "form_process" && op.conceptIds.length >= 3) {
      directorStateRef.current = unmarkProcessCommitted(directorStateRef.current, op.conceptIds);
      log({ type: "process", event: "undo", conceptIds: op.conceptIds });
    }
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

  // ---- applying semantic actions -------------------------------------------

  /**
   * Execute one artist action against the semantic board and the canvas.
   *
   * Returns a human-readable description of what actually happened, which is
   * often different from what was asked — the whole point of `board.match` is
   * that "create ClickLabs" becomes "reused clicklabs" when it already exists.
   */
  const applyAction = useCallback(
    async (action: CanvasAction, sourceText: string): Promise<string> => {
      const board = boardRef.current;

      /** Resolve an id the model supplied to a concept that actually exists. */
      const resolve = (id: string): Concept | null => board.match(id);

      switch (action.type) {
        case "create_concept": {
          // Reuse before create. This is the duplicate gate.
          const existing = board.match(action.conceptId) ?? board.match(action.label);
          if (existing) {
            existing.lastUpdatedAt = Date.now();
            return `reused ${existing.conceptId}`;
          }
          // The Artist's version of this concept replaces any guess of it —
          // same rule as the Scribe path in applyOp, applied before the real
          // node is built so the two never overlap.
          reconcileSpeculativeRef.current?.(action.label);
          const concept = board.addConcept({
            conceptId: action.conceptId,
            label: action.label,
            kind: action.kind,
            sourceText,
            confidence: action.confidence,
          });
          const visibleConcepts = [...conceptPageRef.current.values()].filter(
            (page) => page === pageRef.current,
          ).length;
          if (
            withinInitialCompositionWindow(now()) &&
            visibleConceptBudgetReached(visibleConcepts)
          ) {
            const undo = emptyUndo();
            undo.addedConceptIds = [concept.conceptId];
            recordOperation("create_concept", undo, {
              sourceText,
              confidence: action.confidence,
              conceptIds: [concept.conceptId],
            });
            log({
              type: "attention",
              action: "suppression",
              target: concept.label,
              reason: "five supporting concepts already visible; meaning retained semantically",
            });
            return `suppressed ${concept.conceptId} (semantic only)`;
          }
          const built = await buildConceptNode(
            `el_${concept.conceptId}`,
            concept.label,
            concept.kind,
            penRef.current,
          );
          if (!built) {
            board.concepts.delete(concept.conceptId);
            return `failed ${action.conceptId}`;
          }
          concept.elementIds = built.elements.map((el) => el.id);
          conceptElementRef.current.set(concept.conceptId, built.nodeId);
          conceptPageRef.current.set(concept.conceptId, pageRef.current);
          marksRef.current.set(built.mark.key, built.mark);
          elementsRef.current = [...elementsRef.current, ...built.elements];
          for (const el of built.elements) sketchRef.current.ids.push(el.id);
          sketchRef.current.count += 1;

          const undo = emptyUndo();
          undo.addedElementIds = concept.elementIds;
          undo.addedConceptIds = [concept.conceptId];
          recordOperation("create_concept", undo, {
            sourceText,
            confidence: action.confidence,
            conceptIds: [concept.conceptId],
          });
          return `created ${concept.conceptId}`;
        }

        case "update_concept": {
          const concept = resolve(action.conceptId);
          if (!concept) return `missing ${action.conceptId}`;
          const before = { label: concept.label, kind: concept.kind };
          if (action.label) concept.label = action.label;
          if (action.kind) concept.kind = action.kind;
          concept.lastUpdatedAt = Date.now();
          const undo = emptyUndo();
          undo.elementPatches = [];
          // The semantic revert is handled by restoring the concept wholesale.
          undo.removedConcepts = [{ ...concept, ...before }];
          undo.addedConceptIds = [];
          recordOperation("update_concept", undo, {
            sourceText,
            conceptIds: [concept.conceptId],
          });
          return `updated ${concept.conceptId}`;
        }

        case "create_relationship": {
          const from = resolve(action.fromConceptId);
          const to = resolve(action.toConceptId);
          if (!from || !to) {
            return `missing endpoint ${action.fromConceptId}->${action.toConceptId}`;
          }
          const fromEl = nodeForConcept(from.conceptId);
          const toEl = nodeForConcept(to.conceptId);
          if (!fromEl || !toEl) {
            return `no node for ${from.conceptId}->${to.conceptId}`;
          }
          const rel = board.addRelationship({
            fromConceptId: from.conceptId,
            toConceptId: to.conceptId,
            relationshipType: action.relationshipType,
            label: action.label,
            confidence: action.confidence,
          });
          if (!rel) return `duplicate ${from.conceptId}->${to.conceptId}`;
          const visibleRelationships = [...board.relationships.values()].filter(
            (relationship) => relationship.elementIds.length > 0,
          ).length;
          if (
            withinInitialCompositionWindow(now()) &&
            visibleRelationshipBudgetReached(visibleRelationships)
          ) {
            const undo = emptyUndo();
            undo.addedRelationshipIds = [rel.relationshipId];
            recordOperation("create_relationship", undo, {
              sourceText,
              confidence: action.confidence,
              conceptIds: [from.conceptId, to.conceptId],
            });
            log({
              type: "attention",
              action: "de-emphasis",
              target: `${from.label} -> ${to.label}`,
              reason: "three primary relationships already visible; meaning retained semantically",
            });
            return `de-emphasized ${from.conceptId}->${to.conceptId} (semantic only)`;
          }

          // Everything on this page is an obstacle. Without them the arrow
          // draws a straight line through whatever the speaker had already
          // written between the two things it connects — which on a sketchnote
          // page is usually several words and an icon.
          const origin = pageOrigin(pageRef.current);
          const obstacles = elementsRef.current
            .filter(
              (el) =>
                el.x >= origin.x - 40 &&
                el.x < origin.x + PAGE_W + 40 &&
                // A label bound inside a container is already represented by
                // that container; counting it twice inflates nothing but costs
                // a little routing time.
                !el.containerId,
            )
            // Transcript rows run the width of the sheet. If they are hard
            // obstacles the router finds no lane at all and falls back to a
            // straight line — which then crosses the lettered words too. Soft
            // means "cross this only if there is no other way".
            .map((el) =>
              liveLineIdsRef.current.has(el.id)
                ? ({ ...el, softObstacle: true } as SceneElement)
                : el,
            );
          const built = await buildBoundArrow(
            `el_${rel.relationshipId}`,
            fromEl,
            toEl,
            action.label ?? "",
            obstacles,
          );
          if (!built) {
            board.relationships.delete(rel.relationshipId);
            return `arrow failed ${from.conceptId}->${to.conceptId}`;
          }

          // Register the arrow on both endpoints. This is what makes
          // Excalidraw re-route it when either node is dragged.
          const patches: { id: string; before: Record<string, unknown> }[] = [];
          for (const bind of built.bindPatches) {
            const index = elementsRef.current.findIndex((e) => e.id === bind.id);
            if (index < 0) continue;
            patches.push({
              id: bind.id,
              before: {
                boundElements: elementsRef.current[index].boundElements ?? null,
              },
            });
            elementsRef.current = elementsRef.current.map((e, i) =>
              i === index ? patch(e, { boundElements: bind.boundElements }) : e,
            );
          }

          const added = [built.arrow, ...built.extras];
          rel.elementIds = added.map((el) => el.id);
          elementsRef.current = [...elementsRef.current, ...added];
          for (const el of added) sketchRef.current.ids.push(el.id);

          const undo = emptyUndo();
          undo.addedElementIds = rel.elementIds;
          undo.addedRelationshipIds = [rel.relationshipId];
          undo.elementPatches = patches;
          recordOperation("create_relationship", undo, {
            sourceText,
            confidence: action.confidence,
            conceptIds: [from.conceptId, to.conceptId],
          });
          return `linked ${from.conceptId} -> ${to.conceptId} (${rel.relationshipType})`;
        }

        case "delete_concept": {
          const concept = resolve(action.conceptId);
          if (!concept) return `missing ${action.conceptId}`;
          const rels = board.relationshipsFor(concept.conceptId);
          const dropIds = new Set([
            ...concept.elementIds,
            ...rels.flatMap((r) => r.elementIds),
          ]);
          const undo = emptyUndo();
          undo.removedElements = elementsRef.current.filter((el) =>
            dropIds.has(el.id),
          );
          undo.removedConcepts = [concept];
          undo.removedRelationships = rels;
          elementsRef.current = elementsRef.current.filter(
            (el) => !dropIds.has(el.id) && !dropIds.has((el.containerId as string) ?? ""),
          );
          board.concepts.delete(concept.conceptId);
          for (const r of rels) board.relationships.delete(r.relationshipId);
          conceptElementRef.current.delete(concept.conceptId);
          recordOperation("delete_concept", undo, {
            sourceText,
            conceptIds: [concept.conceptId],
          });
          return `deleted ${concept.conceptId}`;
        }

        case "move_concept":
        case "resize_concept": {
          const concept = resolve(action.conceptId);
          if (!concept) return `missing ${action.conceptId}`;
          const STEP = 220;
          const patches: { id: string; before: Record<string, unknown> }[] = [];
          const ids = new Set(concept.elementIds);
          elementsRef.current = elementsRef.current.map((el) => {
            if (!ids.has(el.id) && !ids.has((el.containerId as string) ?? "")) {
              return el;
            }
            if (action.type === "move_concept") {
              const dx =
                action.direction === "left" ? -STEP : action.direction === "right" ? STEP : 0;
              const dy =
                action.direction === "up" ? -STEP : action.direction === "down" ? STEP : 0;
              patches.push({ id: el.id, before: { x: el.x, y: el.y } });
              return patch(el, { x: el.x + dx, y: el.y + dy });
            }
            patches.push({
              id: el.id,
              before: { width: el.width, height: el.height },
            });
            return patch(el, {
              width: el.width * action.scale,
              height: el.height * action.scale,
            });
          });
          const undo = emptyUndo();
          undo.elementPatches = patches;
          recordOperation(action.type, undo, {
            sourceText,
            conceptIds: [concept.conceptId],
          });
          return `${action.type === "move_concept" ? "moved" : "resized"} ${concept.conceptId}`;
        }

        case "highlight_concept": {
          const concept = resolve(action.conceptId);
          if (!concept) return `missing ${action.conceptId}`;
          const ids = new Set(concept.elementIds);
          const patches: { id: string; before: Record<string, unknown> }[] = [];
          elementsRef.current = elementsRef.current.map((el) => {
            if (!ids.has(el.id)) return el;
            patches.push({ id: el.id, before: { strokeColor: el.strokeColor } });
            return patch(el, { strokeColor: "#e8590c", strokeWidth: 2 });
          });
          const undo = emptyUndo();
          undo.elementPatches = patches;
          recordOperation("highlight_concept", undo, {
            sourceText,
            conceptIds: [concept.conceptId],
          });
          return `highlighted ${concept.conceptId}`;
        }

        case "zoom_to_concept": {
          const concept = resolve(action.conceptId);
          if (!concept) return `missing ${action.conceptId}`;
          const el = nodeForConcept(concept.conceptId);
          if (el) {
            try {
              // A second, independent camera writer alongside animateCamera's
              // spring — Excalidraw's own scrollToContent gives the tightest
              // single-concept fit-to-content math, which is worth keeping
              // rather than reimplementing. Coordinated with the controller
              // instead of left to fight it: cancel any move already in
              // flight first (so its rAF loop doesn't immediately overwrite
              // this), drop any deferred reframe this explicit zoom
              // supersedes, and resync compositionRef's bookkeeping once the
              // animation finishes so the next framePage call — and any undo
              // snapshot taken before it — sees where the camera actually is
              // rather than the stale pre-zoom value.
              if (cameraMotionRef.current) {
                cancelAnimationFrame(cameraMotionRef.current.rafId);
                cameraMotionRef.current = null;
              }
              pendingReframeRef.current = null;
              apiRef.current?.scrollToContent(el as never, {
                fitToViewport: true,
                viewportZoomFactor: 0.6,
                animate: true,
                duration: 400,
              });
              setTimeout(() => {
                const app = apiRef.current?.getAppState?.();
                if (!app) return;
                const camera: CameraView = {
                  scrollX: Number(app.scrollX ?? 0),
                  scrollY: Number(app.scrollY ?? 0),
                  zoom: Number(app.zoom?.value ?? app.zoom ?? 1),
                };
                compositionRef.current = { ...compositionRef.current, camera, proposedTarget: undefined, movementReason: undefined };
              }, 420);
            } catch {
              /* cosmetic */
            }
          }
          recordOperation("zoom_to_concept", emptyUndo(), {
            sourceText,
            conceptIds: [concept.conceptId],
          });
          return `zoomed ${concept.conceptId}`;
        }

        case "group_concepts": {
          const members = action.conceptIds
            .map(resolve)
            .filter((c): c is Concept => c !== null);
          if (members.length < 1) return "group needs a known concept";
          const els = members
            .map((c) => nodeForConcept(c.conceptId))
            .filter((e): e is SceneElement => e !== null);
          if (els.length < 1) return "group needs a drawn concept";
          const pad = 22;
          const minX = Math.min(...els.map((e) => e.x)) - pad;
          const minY = Math.min(...els.map((e) => e.y)) - pad;
          const maxX = Math.max(...els.map((e) => e.x + e.width)) + pad;
          const maxY = Math.max(...els.map((e) => e.y + e.height)) + pad;
          const { convertToExcalidrawElements } = await import(
            "@excalidraw/excalidraw"
          );
          const box = convertToExcalidrawElements([
            {
              type: "rectangle",
              x: minX,
              y: minY,
              width: maxX - minX,
              height: maxY - minY,
              strokeColor: "#e8590c",
              backgroundColor: "transparent",
              roughness: 2,
              strokeWidth: 1,
            },
          ] as never) as unknown as SceneElement[];
          // Behind the things it contains.
          elementsRef.current = [...box, ...elementsRef.current];
          for (const el of box) sketchRef.current.ids.push(el.id);
          const undo = emptyUndo();
          undo.addedElementIds = box.map((el) => el.id);
          recordOperation("group_concepts", undo, {
            sourceText,
            conceptIds: members.map((c) => c.conceptId),
          });
          return `grouped ${members.map((c) => c.conceptId).join("+")}`;
        }

        case "create_section": {
          const previous = board.activeSectionId;
          requestPageTurn("section");
          const section = board.startSection(action.title, pageRef.current);
          const undo = emptyUndo();
          undo.addedSectionIds = [section.sectionId];
          undo.previousActiveSectionId = previous;
          recordOperation("create_section", undo, { sourceText });
          log({ type: "section", sectionId: section.sectionId, title: action.title });
          return `section "${action.title}"`;
        }

        case "clear_section": {
          doClear();
          return "cleared section";
        }

        case "undo_last": {
          doUndo();
          return "undid last operation";
        }

        case "form_comparison":
          return await performComparison(action, sourceText);

        case "form_process":
          return await performProcess(action, sourceText);

        // --- math domain --------------------------------------------------
        // Each step becomes its own concept (kind "equation"/"math_step"),
        // linked to what it followed from by an ordinary relationship arrow.
        // That reuses the existing undo/history/reuse machinery for free
        // instead of inventing a parallel one for math.

        case "create_equation": {
          const existing = board.match(action.conceptId);
          if (existing) {
            existing.lastUpdatedAt = Date.now();
            return `reused ${existing.conceptId}`;
          }

          // create_equation is the axiom, not a derived claim — there is no
          // prior board state for lib/math/verify.ts's step checks to run
          // against. Grounding it in the transcript is the equivalent guard,
          // the same role groundedInSource plays for Scribe marks. Caught
          // live: a spoken "three x plus five equals twenty" came back as
          // the expression "5 = 20" — the "3x +" term silently vanished.
          const grounding = groundEquationInSource(action.expression, sourceText);
          // Regular Scribe marks and structured diagrams check willOverflow()
          // before placing; math steps used to skip this and just kept
          // accumulating on one page, which is what eventually forced the
          // camera's union bounds below the readability floor with nowhere
          // to go (contentFits:false forever). Same fix, same pattern.
          const newEquationSize = measureMathStepBox(action.expression);
          if (willOverflow(penRef.current, newEquationSize.w, newEquationSize.h)) {
            requestPageTurn("overflow");
          }
          const concept = board.addConcept({
            conceptId: action.conceptId,
            label: action.expression,
            kind: action.domain === "coordinate_graph" ? "graph" : "equation",
            sourceText,
            mathMeaning: {
              stepId: newId("step"),
              operation: "state",
              from: "",
              reason: action.goal ?? "starting expression",
              before: action.expression,
              result: action.expression,
              verified: grounding.grounded,
              verificationDetail: grounding.message,
            },
          });
          const built = await buildMathStepBox(`el_${concept.conceptId}`, concept.label, grounding.grounded, penRef.current);
          if (!built) {
            board.concepts.delete(concept.conceptId);
            return `failed ${action.conceptId}`;
          }
          concept.elementIds = built.elements.map((el) => el.id);
          conceptElementRef.current.set(concept.conceptId, built.nodeId);
          conceptPageRef.current.set(concept.conceptId, pageRef.current);
          marksRef.current.set(built.mark.key, built.mark);
          elementsRef.current = [...elementsRef.current, ...built.elements];
          for (const el of built.elements) sketchRef.current.ids.push(el.id);
          sketchRef.current.count += 1;

          const undo = emptyUndo();
          undo.addedElementIds = concept.elementIds;
          undo.addedConceptIds = [concept.conceptId];
          recordOperation("create_concept", undo, { sourceText, conceptIds: [concept.conceptId] });
          activeMathConceptIdRef.current = concept.conceptId;
          return grounding.grounded
            ? `created ${concept.conceptId}`
            : `created ${concept.conceptId} (ungrounded: ${grounding.message ?? ""})`;
        }

        case "transform_equation": {
          const from = resolve(action.conceptId);
          if (!from) return `missing ${action.conceptId}`;

          // Checks continuity (does "before" match what's actually on the
          // board?) before arithmetic — a model can apply a correct operation
          // to a STALE "before" and the arithmetic alone would check out. See
          // lib/math/verify.ts's verifyTransformStep for the live-caught bug
          // this guards against.
          const verification = verifyTransformStep(
            from.label,
            action.step.operation,
            action.step.value,
            action.step.before,
            action.step.result,
          );

          // Never split a single step's box across pages — check whether the
          // WHOLE step (this box, as one unit) fits before placing any of
          // it, and turn the page first if not, same as create_equation.
          const stepSize = measureMathStepBox(action.step.result);
          if (willOverflow(penRef.current, stepSize.w, stepSize.h)) {
            requestPageTurn("overflow");
          }

          const stepId = newId("step");
          const nextConcept = board.addConcept({
            conceptId: `${from.conceptId}-${stepId}`,
            label: action.step.result,
            kind: "math_step",
            sourceText,
            mathMeaning: {
              stepId,
              operation: action.step.operation,
              value: action.step.value,
              from: action.step.from,
              reason: action.step.reason,
              before: action.step.before,
              result: action.step.result,
              verified: verification.verified,
              verificationDetail: verification.message,
              commonMistake: action.step.commonMistake,
              connection: action.step.connection,
            },
          });
          const built = await buildMathStepBox(
            `el_${nextConcept.conceptId}`,
            nextConcept.label,
            verification.verified,
            penRef.current,
          );
          if (!built) {
            board.concepts.delete(nextConcept.conceptId);
            return `failed ${nextConcept.conceptId}`;
          }
          nextConcept.elementIds = built.elements.map((el) => el.id);
          conceptElementRef.current.set(nextConcept.conceptId, built.nodeId);
          conceptPageRef.current.set(nextConcept.conceptId, pageRef.current);
          marksRef.current.set(built.mark.key, built.mark);
          elementsRef.current = [...elementsRef.current, ...built.elements];
          for (const el of built.elements) sketchRef.current.ids.push(el.id);
          sketchRef.current.count += 1;

          const undo = emptyUndo();
          undo.addedElementIds = nextConcept.elementIds;
          undo.addedConceptIds = [nextConcept.conceptId];
          recordOperation("create_concept", undo, { sourceText, conceptIds: [nextConcept.conceptId] });

          const fromEl = nodeForConcept(from.conceptId);
          const toEl = nodeForConcept(nextConcept.conceptId);
          if (fromEl && toEl) {
            const rel = board.addRelationship({
              fromConceptId: from.conceptId,
              toConceptId: nextConcept.conceptId,
              relationshipType: action.step.operation,
              label: action.step.reason,
            });
            if (rel) {
              const arrow = await buildBoundArrow(
                `el_${rel.relationshipId}`,
                fromEl,
                toEl,
                action.step.reason,
                elementsRef.current,
              );
              if (arrow) {
                const added = [arrow.arrow, ...arrow.extras];
                rel.elementIds = added.map((el) => el.id);
                elementsRef.current = [...elementsRef.current, ...added];
                for (const el of added) sketchRef.current.ids.push(el.id);
                const undo2 = emptyUndo();
                undo2.addedElementIds = rel.elementIds;
                undo2.addedRelationshipIds = [rel.relationshipId];
                recordOperation("create_relationship", undo2, {
                  sourceText,
                  conceptIds: [from.conceptId, nextConcept.conceptId],
                });
              }
            }
          }

          activeMathConceptIdRef.current = nextConcept.conceptId;
          return verification.verified
            ? `verified step ${nextConcept.conceptId}`
            : `unverified step ${nextConcept.conceptId}: ${verification.message ?? ""}`;
        }

        case "add_math_explanation": {
          const concept = resolve(action.conceptId);
          if (!concept) return `missing ${action.conceptId}`;
          const text = `${action.meaning} — ${action.invariant}`;
          const explanationOp: Op = { op: "note", text: text.length > 90 ? `${text.slice(0, 89)}…` : text };
          const explanationSize = measureOp(explanationOp, marksRef.current);
          if (explanationSize && !explanationSize.noPlace && willOverflow(penRef.current, explanationSize.w, explanationSize.h)) {
            requestPageTurn("overflow");
          }
          const built = await buildOp(
            explanationOp,
            penRef.current,
            marksRef.current,
          );
          if (!built) return `failed explanation for ${action.conceptId}`;
          elementsRef.current = [...elementsRef.current, ...built.elements];
          for (const el of built.elements) sketchRef.current.ids.push(el.id);
          if (built.mark) marksRef.current.set(built.mark.key, built.mark);
          concept.elementIds = [...concept.elementIds, ...built.elements.map((el) => el.id)];
          const undo = emptyUndo();
          undo.addedElementIds = built.elements.map((el) => el.id);
          recordOperation("update_concept", undo, { sourceText, conceptIds: [concept.conceptId] });
          activeMathConceptIdRef.current = concept.conceptId;
          return `explained ${concept.conceptId}`;
        }

        case "create_math_visual": {
          const concept = resolve(action.conceptId);
          if (!concept) return `missing ${action.conceptId}`;

          // The model sometimes redraws the same long_multiplication visual
          // repeatedly as its narration of one problem evolves — observed
          // live during the audio-replay audit: 11 redraws of one 369×43
          // walkthrough, each with slightly different (occasionally
          // internally inconsistent) carry data. Each individual redraw is
          // geometrically fine on its own, but appending every one left a
          // trail of near-duplicate diagrams across many pages. A same-type
          // redraw for the same concept REPLACES its previous visual rather
          // than adding another; other visual types keep the original
          // additive behaviour since this is the concretely observed
          // pattern, not a general one.
          if (action.visual.type === "long_multiplication") {
            const priorIds = mathVisualElementIdsRef.current.get(action.conceptId);
            if (priorIds?.length) {
              const dropIds = new Set(priorIds);
              elementsRef.current = elementsRef.current.filter((el) => !dropIds.has(el.id));
              concept.elementIds = concept.elementIds.filter((id) => !dropIds.has(id));
              sketchRef.current.ids = sketchRef.current.ids.filter((id) => !dropIds.has(id));
            }
          }

          const visualSize = measureMathVisual(action.visual);
          if (willOverflow(penRef.current, visualSize.w, visualSize.h)) {
            requestPageTurn("overflow");
          }
          const built = await buildMathVisual(action.visual, penRef.current);
          if (!built) return `failed visual for ${action.conceptId}`;
          concept.elementIds = [...concept.elementIds, ...built.elements.map((el) => el.id)];
          elementsRef.current = [...elementsRef.current, ...built.elements];
          for (const el of built.elements) sketchRef.current.ids.push(el.id);
          if (action.visual.type === "long_multiplication") {
            mathVisualElementIdsRef.current.set(action.conceptId, built.elements.map((el) => el.id));
          }
          const undo = emptyUndo();
          undo.addedElementIds = built.elements.map((el) => el.id);
          recordOperation("update_concept", undo, { sourceText, conceptIds: [concept.conceptId] });
          activeMathConceptIdRef.current = concept.conceptId;
          return `drew visual for ${concept.conceptId}`;
        }

        case "verify_step": {
          const concept = resolve(action.conceptId);
          if (!concept || !concept.mathMeaning) return `missing ${action.conceptId}`;
          const before = { ...concept };
          concept.mathMeaning = { ...concept.mathMeaning, verified: action.verified, verificationDetail: action.detail };
          concept.lastUpdatedAt = Date.now();
          const undo = emptyUndo();
          undo.removedConcepts = [before];
          recordOperation("update_concept", undo, { sourceText, conceptIds: [concept.conceptId] });
          return `${action.verified ? "verified" : "flagged"} ${concept.conceptId}`;
        }

        case "correct_math_step": {
          const concept = resolve(action.conceptId);
          if (!concept) return `missing ${action.conceptId}`;
          const before = { ...concept };
          concept.label = action.correctedResult;
          if (concept.mathMeaning) {
            concept.mathMeaning = {
              ...concept.mathMeaning,
              result: action.correctedResult,
              verified: true,
              verificationDetail: action.reason,
            };
          }
          concept.lastUpdatedAt = Date.now();
          const undo = emptyUndo();
          undo.removedConcepts = [before];
          recordOperation("update_concept", undo, { sourceText, conceptIds: [concept.conceptId] });
          return `corrected ${concept.conceptId}`;
        }
      }
    },
    [doClear, doUndo, log, nodeForConcept, now, performComparison, performProcess, recordOperation, requestPageTurn],
  );

  /**
   * Marks lettered on the current page that no concept has claimed yet.
   *
   * This list is the raw material the Organizer works around. Marks already
   * bound to a concept are excluded so a second mention doesn't ring the same
   * words twice.
   */
  const unclaimedMarks = useCallback((): PageMark[] => {
    const claimed = new Set(conceptElementRef.current.values());
    const out: PageMark[] = [];
    for (const mark of marksRef.current.values()) {
      if (!mark.elementId || claimed.has(mark.elementId)) continue;
      out.push({
        key: mark.key,
        text: mark.text ?? mark.key,
        elementId: mark.elementId,
      });
    }
    return out;
  }, []);

  /**
   * Adopt a mark the Scribe already lettered as a concept.
   *
   * This is the step that makes the Organizer annotate the page instead of
   * drawing a second copy of it. Nothing already on the sheet moves; a light
   * ring goes around the existing words and becomes the binding target for
   * every arrow that touches this concept from now on.
   */
  const adoptMark = useCallback(
    async (
      step: Extract<PlanStep, { kind: "adopt" }>,
      sourceText: string,
    ): Promise<string> => {
      const board = boardRef.current;
      const mark = marksRef.current.get(step.markKey);
      if (!mark) return `adopt failed: mark "${step.markKey}" is gone`;

      const concept = board.addConcept({
        conceptId: step.conceptId,
        label: step.label,
        sourceText,
        confidence: 0.9,
      });
      const built = await buildReferenceBox(`ref_${concept.conceptId}`, mark);
      if (!built) {
        board.concepts.delete(concept.conceptId);
        return `adopt failed: could not ring "${step.label}"`;
      }

      // The ring is the concept's element; the lettered mark underneath is
      // untouched and stays exactly where the speaker watched it appear.
      concept.elementIds = built.elements.map((el) => el.id);
      conceptElementRef.current.set(concept.conceptId, built.nodeId);
      conceptPageRef.current.set(concept.conceptId, pageRef.current);
      // The ring goes BEHIND the words it rings.
      elementsRef.current = [...built.elements, ...elementsRef.current];
      for (const el of built.elements) sketchRef.current.ids.push(el.id);

      const undo = emptyUndo();
      undo.addedElementIds = concept.elementIds;
      undo.addedConceptIds = [concept.conceptId];
      recordOperation("create_concept", undo, {
        sourceText,
        confidence: 0.9,
        conceptIds: [concept.conceptId],
      });
      return `adopted ${concept.conceptId} <- "${step.label}"`;
    },
    [recordOperation],
  );

  /**
   * Apply what the Artist asked for, resolved against what is already there.
   *
   * Actions no longer go straight to the canvas. They are planned first — see
   * lib/organizer.ts — so that "create AI agents" becomes "ring the words AI
   * agents that are already on the sheet" rather than a second boxed copy of
   * them a few inches away.
   */
  const applyActions = useCallback(
    async (actions: CanvasAction[], sourceText: string): Promise<string[]> => {
      const plan = planActions(actions, boardRef.current, unclaimedMarks());
      log({ type: "note", text: `organizer plan: ${describePlan(plan).join("; ")}` });

      const applied: string[] = [];
      for (const step of plan.steps) {
        try {
          switch (step.kind) {
            case "reuse": {
              const concept = boardRef.current.concepts.get(step.conceptId);
              if (concept) concept.lastUpdatedAt = Date.now();
              applied.push(`reused ${step.conceptId}`);
              break;
            }
            case "adopt":
              applied.push(await adoptMark(step, sourceText));
              break;
            case "create":
              applied.push(
                await applyAction(
                  {
                    type: "create_concept",
                    conceptId: step.conceptId,
                    label: step.label,
                    kind: step.conceptKind as never,
                    confidence: step.confidence,
                  },
                  sourceText,
                ),
              );
              break;
            case "link":
              applied.push(
                await applyAction(
                  {
                    type: "create_relationship",
                    fromConceptId: step.fromConceptId,
                    toConceptId: step.toConceptId,
                    relationshipType: step.relationshipType,
                    label: step.label,
                    confidence: step.confidence,
                  },
                  sourceText,
                ),
              );
              break;
            case "passthrough":
              applied.push(await applyAction(step.action, sourceText));
              break;
            case "drop":
              applied.push(`dropped ${step.action.type}: ${step.why}`);
              break;
          }
        } catch (err) {
          applied.push(`error ${step.kind}: ${String(err)}`);
        }
      }
      if (applied.length) {
        commit();
        // A batch made up ENTIRELY of math actions frames just the active
        // MathStep group (falling back to the whole page as optional
        // context) instead of the whole-page union every other batch uses —
        // see framePage's mathFocalConceptId param. Mixed or non-math
        // batches keep the original whole-page framing unchanged.
        const isMathOnlyBatch = actions.length > 0 && actions.every((a) => isMathActionType(a.type));
        framePage(false, undefined, isMathOnlyBatch ? activeMathConceptIdRef.current : null);
        checkLiveOverlap();
      }
      return applied;
    },
    [adoptMark, applyAction, checkLiveOverlap, commit, framePage, log, unclaimedMarks],
  );

  // ---- beat detection ------------------------------------------------------
  const beatInFlightRef = useRef(false);
  const beatQueuedRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Consecutive skips. The beat has no memory between calls, so without this
   * it re-derives the same "restating existing content" from the same material
   * every few seconds and the board never gets structure. Handing it the
   * streak lets it notice it is stuck.
   */
  const beatSkipStreakRef = useRef(0);
  /** Session-clock time of the transcript that triggered the beat in flight. */
  const beatTriggerAtRef = useRef(0);
  const beatTriggerWhyRef = useRef("");

  /**
   * Go to the page a back-reference names, apply there, and come back.
   *
   * Returns the page we came from, or null if we didn't move. The camera
   * moves only when the match is confident; the instruction is explicit that
   * an uncertain match must leave the speaker where they are, and that is also
   * the right call — a jump to the wrong page mid-sentence costs the viewer
   * the thread of the talk.
   */
  const enterReference = useCallback(
    (text: string): { returnTo: number; target: ReferenceTarget } | null => {
      const ref = detectBackReference(text);
      if (!ref) return null;

      const board = boardRef.current;
      const target = resolveReference(ref, {
        sections: [...board.sections.values()].map((s) => ({
          sectionId: s.sectionId,
          title: s.title,
          pageIndex: s.pageIndex,
        })),
        concepts: [...board.concepts.values()].map((c) => ({
          conceptId: c.conceptId,
          label: c.label,
          pageIndex: conceptPageRef.current.get(c.conceptId) ?? 0,
        })),
        currentPage: pageRef.current,
      });

      if (!target) {
        log({
          type: "reference",
          phrase: ref.phrase,
          matched: "",
          confidence: 0,
          fromPage: pageRef.current,
          toPage: pageRef.current,
          followed: false,
        });
        return null;
      }

      const from = pageRef.current;
      if (target.pageIndex !== from) gotoPage(target.pageIndex);
      log({
        type: "reference",
        phrase: ref.phrase,
        matched: target.matched,
        confidence: Math.round(target.confidence * 100) / 100,
        fromPage: from,
        toPage: target.pageIndex,
        followed: true,
      });
      return { returnTo: from, target };
    },
    [gotoPage, log],
  );

  const runBeat = useCallback(async () => {
    if (modeRef.current !== "standard") return;
    if (beatInFlightRef.current) {
      beatQueuedRef.current = true; // queue at most one
      return;
    }
    // A drawing is already on its way to the board. Asking for another one now
    // is how you end up with four diagrams of the same sentence.
    if (renderQueueRef.current.length > 0 || renderingRef.current) return;
    beatInFlightRef.current = true;
    setBusy(true);

    const startedAt = now();
    const transcriptAt = beatTriggerAtRef.current || startedAt;
    const trigger = beatTriggerWhyRef.current || "silence";
    let beatMs = 0;
    let organizerMs = 0;
    let applyMs = 0;
    let requested = 0;
    let appliedCount = 0;
    let decisionAction: BeatDecision["action"] = "skip";

    try {
      const pendingText = pendingTextRef.current.trim();
      if (!pendingText) return;

      // SHADOW MODE. The local verdict is computed and logged, and then the
      // model is called anyway — always, regardless of what the local
      // classifier said. Nothing below branches on `local`. It exists only to
      // accumulate the agreement evidence that would justify letting obvious
      // skips bypass the model later. See lib/beatPrefilter.ts.
      const scene = semanticScene();
      const local = localBeatDecision({
        pendingText,
        existingConcepts: scene.concepts.map((c) => c.label),
        looseWords: sketchRef.current.labels.slice(-20),
        skipStreak: beatSkipStreakRef.current,
      });

      // One controller for the whole beat->artist chain, so "scratch that" or
      // stopping the mic cancels work that is about to be irrelevant.
      aiAbortRef.current?.abort();
      aiAbortRef.current = new AbortController();

      latency.mark("first_beat_request", latencyNow());
      const beatRes = await fetch("/api/beat", {
        method: "POST",
        headers: providerRequestHeaders({ "content-type": "application/json" }),
        signal: aiAbortRef.current.signal,
        body: JSON.stringify({
          pendingText,
          sceneSummary: sceneSummary(),
          lastDrawnAt: (Date.now() - lastDrawnAtRef.current) / 1000,
          // Capped: a long list makes every new sentence look like a repeat of
          // something already lettered, which is what drove the over-skipping.
          liveConcepts: sketchRef.current.labels.slice(-20),
          skipStreak: beatSkipStreakRef.current,
          scene,
        }),
      });
      const decision = (await beatRes.json()) as BeatDecision;
      beatMs = now() - startedAt;
      decisionAction = decision.action;

      log({
        type: "beat",
        action: decision.action,
        reason: decision.reason,
        focus: decision.focus,
      });
      log({ type: "beat-shadow", ...scoreBeatAgreement(local, decision.action), beatMs: Math.round(beatMs) });

      if (decision.action === "skip") {
        beatSkipStreakRef.current += 1;
        return;
      }
      beatSkipStreakRef.current = 0;

      if (decision.action === "undo") {
        pendingTextRef.current = "";
        scribePendingRef.current = "";
        doUndo();
        return;
      }

      if (decision.action === "clear") {
        pendingTextRef.current = "";
        scribePendingRef.current = "";
        doClear();
        return;
      }

      // Math mode: an equation or a step on one, verified deterministically
      // client-side rather than trusted from the model. Only ever reachable
      // when the flag is on — the beat route only ever returns this action
      // when NEXT_PUBLIC_ENABLE_MATH_MODE is set server-side too.
      if (decision.action === "math_step") {
        pendingTextRef.current = "";
        scribePendingRef.current = "";
        const activeConceptId = activeMathConceptIdRef.current ?? undefined;
        const activeConcept = activeConceptId ? boardRef.current.concepts.get(activeConceptId) : undefined;
        const depth = /\b(why|what does .* mean|another way|show .* differently|show it differently)\b/i.test(
          pendingText,
        )
          ? "deep"
          : "default";
        try {
          const mathRes = await fetch("/api/math", {
            method: "POST",
            headers: providerRequestHeaders({ "content-type": "application/json" }),
            signal: aiAbortRef.current?.signal,
            body: JSON.stringify({
              focus: decision.focus,
              transcript: recentTranscript(),
              scene: semanticScene(),
              activeConceptId,
              currentExpression: activeConcept?.label,
              depth,
            }),
          });
          const { action: mathAction } = (await mathRes.json()) as { action?: CanvasAction | null };
          if (mathAction) {
            const applied = await applyActions([mathAction], pendingText);
            log({ type: "note", text: `math step: ${applied.join("; ")}` });
          } else {
            log({ type: "note", text: "math route returned no action" });
          }
        } catch (err) {
          if ((err as Error)?.name === "AbortError") throw err;
          log({ type: "note", text: `math pipeline error: ${String(err)}` });
        }
        return;
      }

      // A topic change makes a section. It used to be a skip, which is why
      // "now let's move on to X" did nothing at all.
      if (decision.action === "section") {
        pendingTextRef.current = "";
        scribePendingRef.current = "";
        boardRef.current.noteCommand(pendingText);
        await applyActions(
          [{ type: "create_section", title: decision.focus || "Next" }],
          pendingText,
        );
        return;
      }

      // draw and command both go to the artist; only the framing differs.
      const intent = decision.action === "command" ? "command" : "draw";
      if (intent === "command") boardRef.current.noteCommand(pendingText);

      // "Going back to Airline…" — if this is a reference to something on an
      // earlier page, go there first so the addition lands where it belongs,
      // then come back. A miss leaves us exactly where we are.
      const visit = enterReference(pendingText);

      const artistStarted = now();
      latency.mark("first_artist_request", latencyNow());
      let parsed: CanvasAction[] = [];
      try {
        const artistRes = await fetch("/api/artist", {
          method: "POST",
          headers: providerRequestHeaders({ "content-type": "application/json" }),
          signal: aiAbortRef.current?.signal,
          body: JSON.stringify({
            focus: decision.focus,
            transcript: recentTranscript(),
            sceneSummary: sceneSummary(),
            scene: semanticScene(),
            intent,
          }),
        });
        const { actions } = (await artistRes.json()) as { actions?: unknown[] };
        parsed = parseActions(JSON.stringify({ actions: actions ?? [] }));
      } catch (err) {
        if ((err as Error)?.name === "AbortError") throw err;
        // The Organizer failing must cost the Organizer's work and nothing
        // else. The transcript stays, the Scribe's marks stay, and the pending
        // text is NOT retired — the next beat gets another go at it.
        log({ type: "note", text: `organizer failed, board intact: ${String(err)}` });
        return;
      } finally {
        organizerMs = now() - artistStarted;
        if (visit) gotoPage(visit.returnTo);
      }

      requested = parsed.length;
      if (parsed.length === 0) {
        log({
          type: "note",
          text: `artist returned no actions (${intent}, focus="${decision.focus}")`,
        });
        return;
      }

      // Retire this text now, not when the render finishes — but retire only
      // the words THIS beat consumed.
      //
      // Clearing the whole buffer also discarded anything said while the beat
      // and the Artist were running, and that is precisely the window the next
      // sentence lands in: a beat takes ~4s and the Artist another ~4s, which
      // is longer than the gap between two spoken sentences. The queued re-run
      // then found an empty buffer and returned. That is why the closing
      // thought of an explanation — "so our next priority is improving
      // onboarding and retention", "it uses that energy to create glucose and
      // releases oxygen" — kept reaching the canvas as raw handwriting and
      // never became structure.
      pendingTextRef.current = retirePending(pendingTextRef.current, pendingText);
      scribePendingRef.current = "";

      // Apply on the referenced page, then return the camera. Doing the return
      // in `finally` above would race the drawing, so the visit is re-entered
      // around the apply instead.
      if (visit) gotoPage(visit.target.pageIndex);
      const applyStarted = now();
      const applied = await applyActions(parsed, pendingText);
      applyMs = now() - applyStarted;
      latency.mark("first_artist_action", latencyNow());
      noteTierLatency("speech_to_structure");

      // Director: recognize structure in what this beat just consumed.
      // Deterministic, no extra model call — reuses the Artist output this
      // beat already produced, so every candidate concept (if any) already
      // exists on the board by the time this runs. See lib/director.ts.
      if (features.directorV1) {
        // Director V1: persistent, patient evidence accumulation across
        // beats, with Comparison and Process arbitrated in one place. See
        // lib/directorState.ts.
        const { state, intent, events } = advanceDirector(
          directorStateRef.current,
          boardRef.current,
          pendingText,
          now(),
          comparedPairsRef.current,
          { comparisonEnabled: features.choreographerComparison },
        );
        directorStateRef.current = state;
        for (const ev of events) log(ev);

        switch (intent.kind) {
          case "wait":
            log({ type: "directorWait", reason: intent.reason });
            break;
          case "commit_comparison":
            void performComparison(
              {
                type: "form_comparison",
                leftConceptId: intent.evidence.leftConceptId,
                rightConceptId: intent.evidence.rightConceptId,
                relationshipLabel: intent.evidence.relationshipLabel,
                evidence: intent.evidence.evidence,
                confidence: intent.evidence.confidence,
              },
              pendingText,
            ).then((result) => log({ type: "note", text: `director: ${result}` }));
            break;
          case "commit_process":
          case "extend_process":
            void performProcess(
              {
                type: "form_process",
                stages: intent.stages,
                evidence: intent.evidence,
                confidence: intent.confidence,
              },
              pendingText,
            ).then((result) => log({ type: "note", text: `director: ${result}` }));
            break;
        }
      } else if (features.choreographerComparison) {
        // Comparison-only, unchanged from before Director V1 existed —
        // exactly what runs when directorV1 is off. Zero behavior change.
        const evidence = detectComparison(pendingText, boardRef.current, comparedPairsRef.current);
        if (evidence) {
          void performComparison(
            {
              type: "form_comparison",
              leftConceptId: evidence.leftConceptId,
              rightConceptId: evidence.rightConceptId,
              relationshipLabel: evidence.relationshipLabel,
              evidence: evidence.evidence,
              confidence: evidence.confidence,
            },
            pendingText,
          ).then((result) => log({ type: "note", text: `director: ${result}` }));
        }
      }

      if (visit) gotoPage(visit.returnTo);

      appliedCount = applied.filter(
        (a) => !/^(dropped|error|missing|no node|duplicate|failed|arrow failed|adopt failed)/.test(a),
      ).length;

      log({
        type: "actions",
        intent,
        focus: decision.focus,
        requested: parsed.map((a) =>
          a.type === "create_relationship"
            ? `${a.type} ${a.fromConceptId}->${a.toConceptId}`
            : "conceptId" in a
              ? `${a.type} ${a.conceptId}`
              : a.type,
        ),
        applied,
        ms: organizerMs + applyMs,
      });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      if (isDev) console.warn("[beat] failed", err);
      log({ type: "note", text: `beat pipeline error: ${String(err)}` });
      // A failed model request must never stop the live canvas. The banner
      // says so; the live line keeps writing regardless.
      setErrorText("An AI request failed. Writing continues.");
    } finally {
      // One row per trip through the pipeline, on one clock. The pieces were
      // logged separately before, which made "how long after I finished
      // speaking did the arrow appear" unanswerable from a session file.
      log({
        type: "timing",
        transcriptAt,
        trigger,
        beatMs: Math.round(beatMs),
        decision: decisionAction,
        organizerMs: Math.round(organizerMs),
        applyMs: Math.round(applyMs),
        totalMs: Math.round(now() - transcriptAt),
        requested,
        applied: appliedCount,
      });
      beatInFlightRef.current = false;
      setBusy(false);
      if (beatQueuedRef.current) {
        beatQueuedRef.current = false;
        void runBeat();
      }
    }
  }, [
    applyActions,
    doClear,
    doUndo,
    enterReference,
    gotoPage,
    log,
    now,
    performComparison,
    performProcess,
    recentTranscript,
    sceneSummary,
    semanticScene,
  ]);

  /**
   * When to ask the beat what to do.
   *
   * The old rule was a flat 600ms of silence and more than four words, which
   * fires on fragments: "businesses want to use their agents for the" is four
   * words past the bar and half a thought, and the Organizer drew from it.
   * Nine of fifty-eight beats in the 10:09 session were spent on material that
   * hadn't finished arriving.
   *
   * The rule now has two speeds. A thought that reads as finished goes at the
   * old 600ms — no slower than before, which matters, because waiting after a
   * complete sentence is the other way to get this wrong. Anything unfinished
   * waits, but only up to a bound: people trail off without ever landing a
   * full stop, and the board cannot wait forever for one.
   */
  const resetSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    const fire = (why: string) => {
      silenceTimerRef.current = null;
      const pending = pendingTextRef.current.trim();
      const words = pending.split(/\s+/).filter(Boolean);
      if (words.length <= MIN_WORDS) return;
      beatTriggerAtRef.current = now();
      beatTriggerWhyRef.current = why;
      void runBeat();
    };

    silenceTimerRef.current = setTimeout(() => {
      const pending = pendingTextRef.current.trim();
      if (isThoughtComplete(pending)) {
        fire("thought complete + 600ms silence");
        return;
      }
      // Unfinished. Give it a little longer, then go anyway.
      silenceTimerRef.current = setTimeout(
        () => fire("fragment held to the ceiling, going anyway"),
        FRAGMENT_GRACE_MS - SILENCE_MS,
      );
    }, SILENCE_MS);
  }, [now, runBeat]);

  const storyQueueRef = useRef<string[]>([]);
  const storyInFlightRef = useRef(false);
  const storyRunnerRef = useRef<(() => Promise<void>) | null>(null);
  const storyAbortRef = useRef<AbortController | null>(null);

  const runStoryQueue = useCallback(async () => {
    if (storyInFlightRef.current) return;
    const transcript = storyQueueRef.current.shift();
    if (!transcript) return;
    storyInFlightRef.current = true;
    setBusy(true);
    const started = now();
    const reconciliationSequence = storyRef.current.lastEventSequence ?? 0;
    let interpreterMs = 0;
    let applyMs = 0;
    let actionCount = 0;
    try {
      if (/^\s*(?:scratch that|no wait|forget that|that's wrong)\b/i.test(transcript)) {
        await doStoryUndo();
        log({
          type: "story-decision",
          sourceText: transcript,
          action: "undo",
          accepted: true,
          proposedActions: 0,
          acceptedActions: 0,
          rejectedActionCount: 0,
          rejectedActions: [],
          decisions: [],
          entityResolutions: [],
          assetResolutions: [],
          validationWarnings: ["handled as an explicit local undo command"],
          warnings: ["handled as an explicit local undo command"],
        });
        clearStoryCaption();
        return;
      }
      const context = storyInterpreterContext(storyRef.current, transcript, pageRef.current);
      log({ type: "story-request", transcript, sceneId: context.activeScene });
      storyAbortRef.current?.abort();
      storyAbortRef.current = new AbortController();
      const response = await fetch("/api/story", {
        method: "POST",
        headers: providerRequestHeaders({ "content-type": "application/json" }),
        body: JSON.stringify(context),
        signal: storyAbortRef.current.signal,
      });
      const payload = (await response.json()) as {
        actions?: unknown[];
        fallback?: boolean;
        sourceText?: string;
        normalizedText?: string;
        confidence?: number;
        warnings?: string[];
      };
      interpreterMs = now() - started;
      const actions = parseStoryActions({ actions: payload.actions ?? [] });
      actionCount = actions.length;
      log({
        type: "story-response",
        sourceText: transcript,
        normalizedText: payload.normalizedText,
        confidence: typeof payload.confidence === "number" ? payload.confidence : 0,
        actions: actions.length,
        fallback: payload.fallback === true,
      });
      if ((storyRef.current.lastEventSequence ?? 0) !== reconciliationSequence) {
        log({
          type: "story-decision",
          sourceText: transcript,
          normalizedText: payload.normalizedText,
          mode: "story",
          action: "none",
          accepted: false,
          actionsRequested: [],
          actionsAccepted: [],
          actionsRejected: [],
          renderWarnings: [],
          latencyMs: Math.round(now() - started),
          proposedActions: actions.length,
          acceptedActions: 0,
          rejectedActionCount: actions.length,
          rejectedActions: actions.map((action) => ({
            action: action.type,
            target: "entityId" in action ? action.entityId : "sceneId" in action ? action.sceneId : action.relationId,
            reason: `stale reconciliation for scene version ${reconciliationSequence}`,
          })),
          decisions: [],
          entityResolutions: [],
          assetResolutions: [],
          validationWarnings: [`discarded late reconciliation because newer speech advanced the scene to version ${storyRef.current.lastEventSequence ?? 0}`],
          warnings: [`discarded late reconciliation because newer speech advanced the scene to version ${storyRef.current.lastEventSequence ?? 0}`],
        });
        return;
      }
      const applyStarted = now();
      if (actions.length) {
        await applyStoryBatch(actions, transcript, payload.warnings ?? [], {
          normalizedText: payload.normalizedText,
          confidence: payload.confidence,
        });
      } else {
        log({
          type: "story-decision",
          sourceText: transcript,
          normalizedText: payload.normalizedText,
          mode: "story",
          action: "none",
          accepted: true,
          actionsRequested: [],
          actionsAccepted: [],
          actionsRejected: [],
          renderWarnings: [],
          latencyMs: Math.round(now() - started),
          proposedActions: 0,
          acceptedActions: 0,
          rejectedActionCount: 0,
          rejectedActions: [],
          decisions: [],
          entityResolutions: [],
          assetResolutions: [],
          validationWarnings: payload.warnings ?? [],
          warnings: payload.warnings ?? [],
        });
      }
      applyMs = now() - applyStarted;
      clearStoryCaption();
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return;
      log({ type: "note", text: `story interpreter failed: ${String(error)}` });
      log({
        type: "story-decision",
        sourceText: transcript,
        mode: "story",
        action: "none",
        accepted: false,
        actionsRequested: [],
        actionsAccepted: [],
        actionsRejected: [],
        renderWarnings: [],
        latencyMs: Math.round(now() - started),
        proposedActions: 0,
        acceptedActions: 0,
        rejectedActionCount: 0,
        rejectedActions: [],
        decisions: [],
        entityResolutions: [],
        assetResolutions: [],
        validationWarnings: [`interpreter failed: ${String(error)}`],
        warnings: [`interpreter failed: ${String(error)}`],
      });
      setErrorText("A Story Mode request failed. The transcript is still available.");
    } finally {
      log({
        type: "story-timing",
        interpreterMs: Math.round(interpreterMs),
        applyMs: Math.round(applyMs),
        totalMs: Math.round(now() - started),
        actions: actionCount,
      });
      storyInFlightRef.current = false;
      storyAbortRef.current = null;
      setBusy(false);
      if (storyQueueRef.current.length) queueMicrotask(() => void storyRunnerRef.current?.());
    }
  }, [applyStoryBatch, clearStoryCaption, doStoryUndo, log, now]);
  storyRunnerRef.current = runStoryQueue;

  const enqueueStory = useCallback(
    (transcript: string) => {
      storyQueueRef.current.push(transcript);
      void runStoryQueue();
    },
    [runStoryQueue],
  );

  const storyThoughtRef = useRef<StructuralThoughtState>(EMPTY_THOUGHT);
  const storyThoughtTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enqueueStorySegment = useCallback(
    (rawSegment: string) => {
      if (storyThoughtTimerRef.current) clearTimeout(storyThoughtTimerRef.current);
      const receivedAt = now();
      const prior = storyThoughtRef.current;
      const result = pushStructuralSegment(prior, rawSegment, receivedAt);
      storyThoughtRef.current = result.state;
      if (result.thought) {
        log({
          type: "thought",
          rawSegments: [...prior.rawSegments, rawSegment],
          merged: result.thought,
          heldMs: prior.heldSince ? Math.max(0, receivedAt - prior.heldSince) : 0,
        });
        enqueueStory(result.thought);
        return;
      }
      storyThoughtTimerRef.current = setTimeout(() => {
        const held = storyThoughtRef.current;
        const flushed = flushStructuralThought(held);
        storyThoughtRef.current = flushed.state;
        storyThoughtTimerRef.current = null;
        if (!flushed.thought) return;
        log({
          type: "thought",
          rawSegments: held.rawSegments,
          merged: flushed.thought,
          heldMs: Math.max(0, now() - held.heldSince),
        });
        enqueueStory(flushed.thought);
      }, STRUCTURAL_HOLD_MS);
    },
    [enqueueStory, log, now],
  );

  const handleStoryPartial = useCallback((text: string, confidence = 0) => {
    const result = recognizeStoryPartial(
      storyPartialRef.current,
      text,
      { state: storyRef.current, sequence: (storyRef.current.lastEventSequence ?? 0) + 1 },
      confidence,
    );
    storyPartialRef.current = result.state;
    if (result.ambiguity) {
      log({ type: "story-ambiguity", rawTranscript: text, ambiguity: result.ambiguity, resolution: "pending" });
    }
    if (result.removeProvisional) void renderStoryProvisional();
    if (result.event) void renderStoryProvisional(result.event);
  }, [log, renderStoryProvisional]);

  const handleStoryFinal = useCallback(async (text: string) => {
    const provisional = storyPartialRef.current.provisionalEvent;
    const event = compileStoryEvent(text, {
      state: storyRef.current,
      sequence: (storyRef.current.lastEventSequence ?? 0) + 1,
      ...(provisional ? { eventId: provisional.eventId.replace("story-provisional", "story-event") } : {}),
    });
    storyPartialRef.current = emptyStoryPartialState();
    if (storyEventIsSupported(event)) {
      if (provisional) {
        log({ type: "story-ambiguity", rawTranscript: text, ambiguity: "provisional", resolution: "confirmed" });
      }
      await applyStoryEventBatch(event);
      clearStoryCaption();
      return;
    }
    if (provisional) {
      log({ type: "story-ambiguity", rawTranscript: text, ambiguity: "provisional", resolution: "dismissed" });
      await renderStoryProvisional();
    }
    // Unsupported or genuinely ambiguous language keeps the existing async reconciler.
    enqueueStorySegment(text);
  }, [applyStoryEventBatch, clearStoryCaption, enqueueStorySegment, log, renderStoryProvisional]);

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
    const story = activeStoryScene(storyRef.current);
    return keyterms({
      sections: [
        ...(modeRef.current === "story" ? STORY_MODE_KEYTERMS : []),
        ...[...board.sections.values()].map((s) => s.title),
      ],
      concepts: [...board.concepts.values()]
        .sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt)
        .map((c) => c.label)
        .concat(story ? Object.values(story.entities).map((entity) => entity.label) : []),
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
      dropAllSpeculative();
      clearStoryCaption();
      liveLagRef.current = { lag: [], render: [], paint: [], streamEpoch: 0, invalid: 0 };
      pendingTextRef.current = "";
      scribePendingRef.current = "";
      settledCountRef.current = 0;
      prevInterimRef.current = [];
      aiAbortRef.current?.abort();
      scribeAbortRef.current?.abort();
      visualReentryAbortRef.current?.abort();
      visualReentryAbortRef.current = null;
      visualReentryInFlightRef.current = false;
      visualReentryGenerationRef.current += 1;
      clearVisualReentryCandidateQueue("visual re-entry generation reset by voice command");
      visualReentryPendingRef.current = [];
      visualReentryEvidenceRef.current = [];
      causeEffectProgressRef.current = null;
      if (causeEvidenceTimerRef.current) clearTimeout(causeEvidenceTimerRef.current);
      causeEvidenceTimerRef.current = null;
      if (visualReentryDrainTimerRef.current) clearTimeout(visualReentryDrainTimerRef.current);
      visualReentryDrainTimerRef.current = null;
      setInterim("");
      commit();
      log({ type: "command", command, rawTranscript: raw, when });
      if (command === "undo") {
        if (modeRef.current === "story") void doStoryUndo();
        else doUndo();
      } else {
        turnPage("explicit-clear", "speaker explicitly requested a new page");
      }
    },
    [clearStoryCaption, clearVisualReentryCandidateQueue, commit, doStoryUndo, doUndo, dropAllSpeculative, dropLiveLine, log, turnPage],
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
    const app = apiRef.current?.getAppState?.();
    const fits = liveLineFitsViewport(
      { x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h },
      {
        scrollX: Number(app?.scrollX ?? 0),
        scrollY: Number(app?.scrollY ?? 0),
        zoom: Number(app?.zoom?.value ?? app?.zoom ?? 1) || 1,
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
  }, [framePage, log]);

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

  const applyMeaningUpdate = useCallback(async (update: MeaningUpdate) => {
    log({
      type: "meaning",
      event: "updated",
      family: update.plan.family,
      focusConceptIds: update.plan.focusConceptIds,
      topic: update.state.topic,
      currentInterpretation: update.state.currentInterpretation,
      reason: update.plan.reason,
    });
    // MEANING_DEBUG_ONLY (?debug=1): prove the semantic brain in isolation.
    // The onDebug callback above already logged this round's full snapshot
    // by the time onUpdate fires — stop here, before any layout, arrow, or
    // camera decision runs, let alone an Excalidraw write.
    if (meDebugOnly) return;
    const { elements: nextElements, addedIds, removedIds } = await syncMeaningCanvas(
      update.state,
      elementsRef.current,
      penRef.current,
      pageRef.current,
      meaningIdentityRef.current,
      () => turnPage("overflow", "meaning diagram does not fit on the current sheet"),
      update.plan,
      { wordless: wordlessEnabled },
    );
    if (addedIds.length || removedIds.length) {
      const removedSet = new Set(removedIds);
      const removedElements = elementsRef.current.filter((el) => removedSet.has(el.id));
      elementsRef.current = nextElements;
      const undo = emptyUndo();
      undo.addedElementIds = addedIds;
      undo.removedElements = removedElements;
      recordOperation("meaning_engine", undo, { sourceText: update.state.topic ?? "" });
      commit();
      const addedSet = new Set(addedIds);
      const added = nextElements.filter((el) => addedSet.has(el.id));
      if (added.length) {
        const xs = added.map((el) => el.x);
        const ys = added.map((el) => el.y);
        const xe = added.map((el) => el.x + (el.width ?? 0));
        const ye = added.map((el) => el.y + (el.height ?? 0));
        revealVisualReentry(
          { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xe) - Math.min(...xs), h: Math.max(...ye) - Math.min(...ys) },
          "meaning-engine",
        );
      }
    }
    fadeConsumedTranscript(update.consumedIds);
  }, [commit, fadeConsumedTranscript, log, meDebugOnly, recordOperation, revealVisualReentry, turnPage, wordlessEnabled]);

  useEffect(() => {
    applyMeaningUpdateRef.current = applyMeaningUpdate;
  }, [applyMeaningUpdate]);

  /** Buffers this settled thought's text into the Meaning Engine's debounced cadence — see lib/meaning/engine.ts. */
  const handleSettledMeaning = useCallback((thought: SettledThought) => {
    meaningControllerRef.current?.submit({ source: "human_speech", content: thought.text, id: thought.id });
  }, []);

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
    log({
      type: "expression",
      event: "updated",
      intent: trace.intent.primary,
      grammar: trace.plan.grammar,
      reason: trace.plan.reason,
      preservation: trace.evaluation.semanticPreservation,
      problems: trace.evaluation.problems.map((p) => p.type),
      interpretation: trace.world.interpretation,
    });

    // The evaluator's verdict is worth logging loudly on the live path: a
    // scene that invented a relation is saying something the speaker did not,
    // and that is the one failure worth interrupting a session log for.
    if (trace.evaluation.inventedRelations.length) {
      log({ type: "expression", event: "invented-relation", detail: trace.evaluation.inventedRelations.join("; ") });
    }

    // ?debug=1: prove the pipeline in isolation. onTrace has already recorded
    // the full run by now — stop before any Excalidraw write or camera move.
    if (xeDebugOnly) return;

    const { elements: nextElements, addedIds, removedIds, updatedIds } = await syncExpressionCanvas(
      trace.scene,
      trace.patch,
      elementsRef.current,
      penRef.current,
      pageRef.current,
      expressionIdentityRef.current,
      () => turnPage("overflow", "expression scene does not fit on the current sheet"),
    );

    if (addedIds.length || removedIds.length || updatedIds.length) {
      const goneIds = new Set([...removedIds, ...updatedIds]);
      const removedElements = elementsRef.current.filter((el) => goneIds.has(el.id));
      elementsRef.current = nextElements;
      const undo = emptyUndo();
      undo.addedElementIds = [...addedIds, ...updatedIds];
      undo.removedElements = removedElements;
      recordOperation("expression_engine", undo, { sourceText: trace.world.interpretation ?? "" });
      commit();

      log({ type: "expression", event: "rendered", patch: describePatch(trace.patch) });

      // Only newly ADDED ink pulls the camera. Re-framing on a reposition
      // would drag the view every time the layout breathed, which is exactly
      // the jitter that makes a live board unwatchable.
      const bounds = boundsOf(nextElements, addedIds);
      if (bounds) revealVisualReentry(bounds, "expression-engine");
    }

    fadeConsumedTranscript(update.consumedIds);
  }, [commit, fadeConsumedTranscript, log, recordOperation, revealVisualReentry, turnPage, xeDebugOnly]);

  useEffect(() => {
    applyExpressionUpdateRef.current = applyExpressionUpdate;
  }, [applyExpressionUpdate]);

  /** Buffers this settled thought into the Expression Engine's debounced cadence — see lib/expression/live.ts. */
  const handleSettledExpression = useCallback((thought: SettledThought) => {
    expressionControllerRef.current?.submit({ id: thought.id, text: thought.text });
  }, []);

  /**
   * Draws whichever cause_effect nodes in `nodes` haven't been committed yet
   * for the diagram-in-progress tracked by causeEffectProgressRef — one box
   * (and the arrow into it) per new node, real committed ink via
   * elementsRef/commit(), same as every other direct-commit path in this
   * file. Deterministic only: `nodes` must already come from
   * parseExplicitCauseEffect, no LLM call happens here. Fails closed (skips
   * the draw, leaves whatever is already on the canvas untouched) whenever
   * the safety/consistency checks below can't be satisfied — never guesses,
   * never erases already-spoken ink.
   */
  const commitCauseEffectStep = useCallback(async (
    thoughtId: string,
    sourceText: string,
    nodes: string[],
    stage: "opened" | "completed",
  ) => {
    if (liveRef.current !== null) {
      log({ type: "visual-reentry", event: "cause-incremental-blocked", thoughtId, visualFamily: "cause_effect", reason: "a live line is still mutable" });
      return;
    }
    const compressed: string[] = [];
    for (const node of nodes) {
      const label = compressLabel(node);
      if (!label) {
        log({ type: "visual-reentry", event: "cause-incremental-skipped", thoughtId, visualFamily: "cause_effect", reason: "a node label could not be compressed to five content words" });
        return;
      }
      compressed.push(label);
    }

    let progress = causeEffectProgressRef.current;
    if (progress && progress.page !== pageRef.current) progress = null;
    const already = progress?.nodeLabels ?? [];
    if (already.length >= compressed.length) return;
    for (let i = 0; i < already.length; i += 1) {
      if (already[i] !== compressed[i]) {
        log({ type: "visual-reentry", event: "cause-incremental-mismatch", thoughtId, visualFamily: "cause_effect", reason: "re-parsed chain no longer matches the nodes already drawn" });
        return;
      }
    }

    let region = progress;
    if (!region) {
      const measured = measureCauseEffectProgress(compressed, Math.max(0, 4 - compressed.length));
      if (willOverflow(penRef.current, measured.w, measured.h)) {
        turnPage("overflow", "cause/effect diagram does not fit on the current sheet");
      }
      const spot = place(penRef.current, measured.w, measured.h, true);
      region = { page: pageRef.current, regionX: spot.x, regionW: measured.w, regionTop: spot.y, nextY: spot.y, anchor: undefined, nodeLabels: [] };
    }

    const newElements: SceneElement[] = [];
    for (let i = already.length; i < compressed.length; i += 1) {
      const result = appendCauseEffectNode(compressed[i], region.regionX, region.nextY, region.regionW, region.anchor);
      const converted = await convertCauseEffectAppend(result.elements);
      newElements.push(...converted);
      region.anchor = result.anchor;
      region.nextY = nextCauseEffectNodeY(result.anchor.bottom);
      region.nodeLabels.push(compressed[i]);
    }
    if (!newElements.length) return;

    elementsRef.current = [...elementsRef.current, ...newElements];
    const undo = emptyUndo();
    undo.addedElementIds = newElements.map((el) => el.id);
    recordOperation("visual_reentry", undo, { sourceText });
    commit();
    causeEffectProgressRef.current = region;
    log({
      type: "visual-reentry",
      event: `cause-incremental-${stage}`,
      thoughtId,
      visualFamily: "cause_effect",
      reason: `drew ${compressed.length - already.length} new cause/effect node(s) incrementally`,
    });
    revealVisualReentry({ x: region.regionX, y: region.regionTop, w: region.regionW, h: region.nextY - region.regionTop }, thoughtId);
  }, [commit, log, recordOperation, revealVisualReentry, turnPage]);

  const flushVisualReentry = useCallback(async (): Promise<boolean> => {
    if (visualReentryCommitBusyRef.current) {
      visualReentryFlushRequestedRef.current = true;
      return false;
    }
    // Never race geometry against a mutable interim line. A settled line has
    // already reserved its row, though, so the camera hold alone is not a
    // placement hazard.
    if (liveRef.current !== null) return false;
    visualReentryCommitBusyRef.current = true;
    try {
      while (visualReentryPendingRef.current.length) {
        const entry = visualReentryPendingRef.current[0];
        // A cause_effect chain that was already drawn node-by-node as it was
        // spoken (see commitCauseEffectStep / causeEffectProgressRef) has
        // nothing left to commit here — the one-shot pipeline still ran (to
        // keep its dedup/staleness/queue guarantees), but drawing its result
        // now would duplicate ink already on the page. Only short-circuit
        // when every node this prepared spec asked for is already drawn; a
        // mismatch (e.g. the model-fallback path paraphrased differently)
        // falls through to the normal one-shot commit as a safety net.
        if (entry.prepared.spec.type === "cause_effect") {
          const progress = causeEffectProgressRef.current;
          const specNodes = entry.prepared.spec.nodes;
          const alreadyDrawn = progress !== null &&
            progress.page === pageRef.current &&
            progress.nodeLabels.length === specNodes.length &&
            progress.nodeLabels.every((label, index) => label === specNodes[index]);
          if (alreadyDrawn) {
            visualReentryPendingRef.current.shift();
            causeEffectProgressRef.current = null;
            log({ type: "visual-reentry", event: "cause-incremental-finalized", thoughtId: entry.prepared.thought.id, visualFamily: "cause_effect", reason: "chain already drawn incrementally, one-shot commit skipped" });
            continue;
          }
        }
        const sourceInk = inkForThought(entry.prepared.thought);
        const lastInk = sourceInk[sourceInk.length - 1];
        const firstInk = sourceInk[0];
        const canReplace =
          Boolean(firstInk && lastInk) &&
          lastInk.page === pageRef.current &&
          samePen(penRef.current, lastInk.after) &&
          liveRef.current === null;
        const commitMode = chooseVisualCommitMode({
          hasMutableLiveLine: liveRef.current !== null,
          cameraHold: liveCameraHoldRef.current,
          launchLiveSeq: entry.launchLiveSeq,
          currentLiveSeq: liveSeqRef.current,
          sameTurnFold: canReplace,
        });
        // During speech, only a result whose source thought predates the
        // latest live update may enter quietly. A just-settled result waits
        // for either continued speech or the ordinary safe reveal window.
        if (commitMode === "blocked") return false;
        const quietCommit = commitMode === "quiet";
        let placementPage = entry.prepared.thought.page;
        const placementPen = penRef.current;
        const placementSeq = liveSeqRef.current;
        const isRelevant = (targetPage = placementPage) =>
          entry.generation === visualReentryGenerationRef.current &&
          targetPage === placementPage &&
          pageRef.current === placementPage &&
          now() - entry.prepared.decidedAt <= VISUAL_REENTRY_RESULT_TTL_MS;
        const result = await commitPreparedVisualReentry(entry.prepared, {
          pen: placementPen,
          pageIndex: placementPage,
          isSafe: () => chooseVisualCommitMode({
            hasMutableLiveLine: liveRef.current !== null,
            cameraHold: liveCameraHoldRef.current,
            launchLiveSeq: entry.launchLiveSeq,
            currentLiveSeq: liveSeqRef.current,
            sameTurnFold: canReplace,
          }) !== "blocked",
          isRelevant,
          isPlacementCurrent: (target) =>
            penRef.current === target.pen &&
            pageRef.current === target.pageIndex &&
            liveSeqRef.current === placementSeq,
          turnPageForOverflow: (target) => {
            if (penRef.current !== target.pen || pageRef.current !== target.pageIndex) return null;
            turnPage("overflow", "visual re-entry does not fit on the current sheet");
            placementPage = pageRef.current;
            return { pen: penRef.current, pageIndex: placementPage };
          },
          choosePromoteTarget: () => {
            const hideIds = sourceInk.flatMap((ink) => ink.ids);
            if (!hideIds.length) return null;
            if (canReplace && firstInk) {
              Object.assign(penRef.current, firstInk.base);
              return { pen: penRef.current, pageIndex: pageRef.current, hideIds, mode: "replace" as const };
            }
            return { pen: penRef.current, pageIndex: pageRef.current, hideIds, mode: "hide" as const };
          },
          commitVisual: (elements, promote) => {
            const hideIds = new Set(promote?.hideIds ?? []);
            const removed = hideIds.size
              ? elementsRef.current.filter((el) => hideIds.has(el.id))
              : [];
            elementsRef.current = [
              ...elementsRef.current.filter((el) => !hideIds.has(el.id)),
              ...(elements as SceneElement[]),
            ];
            const undo = emptyUndo();
            undo.addedElementIds = (elements as SceneElement[]).map((el) => el.id);
            undo.removedElements = removed;
            recordOperation("visual_reentry", undo, { sourceText: entry.prepared.thought.text });
            commit();
          },
          revealIfNeeded: (bounds) => {
            if (quietCommit) {
              log({ type: "visual-reentry", event: "camera-suppressed", thoughtId: entry.prepared.thought.id, reason: "quiet commit while speech owns attention" });
            } else {
              revealVisualReentry(bounds, entry.prepared.thought.id);
            }
          },
          log,
          now,
        });
        if (result === "held") return false;
        visualReentryPendingRef.current.shift();
        if (result === "committed") {
          if (quietCommit) {
            log({ type: "visual-reentry", event: "durable-result-quiet-committed", thoughtId: entry.prepared.thought.id });
          }
          if (visualReentryPendingRef.current.length) {
            if (visualReentryDrainTimerRef.current) clearTimeout(visualReentryDrainTimerRef.current);
            visualReentryDrainTimerRef.current = setTimeout(() => {
              visualReentryDrainTimerRef.current = null;
              void flushVisualReentryRef.current?.();
            }, LIVE_CAMERA_OVERVIEW_MS);
          }
          return true;
        }
      }
      return false;
    } finally {
      visualReentryCommitBusyRef.current = false;
      if (visualReentryFlushRequestedRef.current) {
        visualReentryFlushRequestedRef.current = false;
        queueMicrotask(() => void flushVisualReentryRef.current?.());
      }
    }
  }, [commit, inkForThought, log, now, recordOperation, revealVisualReentry, turnPage]);
  flushVisualReentryRef.current = flushVisualReentry;

  const drainVisualReentryDecisionQueue = useCallback(() => {
    if (visualReentryInFlightRef.current) return;

    const queue = visualReentryCandidateQueueRef.current;
    const { job, expired } = queue.dequeue({
      generation: visualReentryGenerationRef.current,
      page: pageRef.current,
      now: now(),
    });
    for (const entry of expired) {
      log({ type: "visual-reentry", event: "candidate-dequeued", thoughtId: entry.job.thought.id, queueDepth: queue.size });
      log({ type: "visual-reentry", event: "candidate-expired", thoughtId: entry.job.thought.id, reason: entry.reason, queueDepth: queue.size });
    }
    if (!job) return;

    log({ type: "visual-reentry", event: "candidate-dequeued", thoughtId: job.thought.id, queueDepth: queue.size });
    if (visualReentryProcessedIdsRef.current.size > 200) visualReentryProcessedIdsRef.current.clear();
    if (!claimThought(visualReentryProcessedIdsRef.current, job.thought.id)) {
      log({ type: "visual-reentry", event: "duplicate-thought-skipped", thoughtId: job.thought.id });
      queueMicrotask(() => drainVisualReentryDecisionQueueRef.current?.());
      return;
    }

    const controller = new AbortController();
    visualReentryAbortRef.current = controller;
    visualReentryInFlightRef.current = true;
    void prepareVisualReentry(job.thought, {
      signal: controller.signal,
      log,
      now,
      experimentMode: job.experimentMode,
      candidateCompletedAt: job.candidateCompletedAt,
    }).then((prepared) => {
      if (!prepared) return;
      if (job.generation !== visualReentryGenerationRef.current || prepared.thought.page !== pageRef.current) {
        log({ type: "visual-reentry", event: "durable-result-expired", thoughtId: job.thought.id, reason: "page/session changed before result became ready" });
        return;
      }
      if (visualReentryPendingRef.current.length >= VISUAL_REENTRY_PENDING_MAX) {
        const dropped = visualReentryPendingRef.current.shift();
        if (dropped) log({ type: "visual-reentry", event: "durable-result-expired", thoughtId: dropped.prepared.thought.id, reason: "durable queue capacity reached" });
      }
      visualReentryPendingRef.current.push({ prepared, generation: job.generation, launchLiveSeq: job.launchLiveSeq });
      if (liveCameraHoldRef.current || liveRef.current !== null) {
        log({ type: "visual-reentry", event: "durable-result-held", thoughtId: job.thought.id, reason: "speech is active" });
      }
      void flushVisualReentryRef.current?.();
    }).finally(() => {
      if (visualReentryAbortRef.current === controller) {
        visualReentryAbortRef.current = null;
        visualReentryInFlightRef.current = false;
      }
      queueMicrotask(() => drainVisualReentryDecisionQueueRef.current?.());
    });
  }, [log, now]);
  drainVisualReentryDecisionQueueRef.current = drainVisualReentryDecisionQueue;

  const launchVisualReentryCandidate = useCallback((candidateThought: SettledThought, reason: string, causeCompleted = false) => {
    const experimentMode = replayModeRef.current;
    const candidateCompletedAt = now();
    const participantThoughtIds = candidateThought.participantThoughtIds ?? [candidateThought.id];
    if (candidateThought.id.startsWith("evidence:")) log({
      type: "visual-reentry",
      event: "evidence-combined",
      thoughtId: candidateThought.id,
      reason,
      sourceText: candidateThought.text,
      participantThoughtIds,
    });
    if (causeCompleted) log({ type: "visual-reentry", event: "cause-evidence-completed", thoughtId: candidateThought.id, reason, visualFamily: "cause_effect" });
    const candidate = evaluateVisualCandidate(candidateThought.text);
    log({
      type: "visual-reentry",
      event: candidate.candidate ? "candidate-accepted" : "candidate-rejected",
      thoughtId: candidateThought.id,
      reason: candidate.reason,
      sourceExcerpt: candidateThought.text.slice(0, 80),
      sourceText: candidateThought.text,
      participantThoughtIds,
      candidateCompletedAtMs: candidateCompletedAt,
      visualFamily: candidate.family,
    });
    if (!candidate.candidate || experimentMode === "vr_shell") return;

    if (visualReentryProcessedIdsRef.current.has(candidateThought.id)) {
      log({ type: "visual-reentry", event: "duplicate-thought-skipped", thoughtId: candidateThought.id });
      return;
    }
    const job: VisualReentryCandidateJob = {
      thought: candidateThought,
      experimentMode: experimentMode === "vr_decision" ? "vr_decision" : "vr_full",
      generation: visualReentryGenerationRef.current,
      page: candidateThought.page,
      launchLiveSeq: liveSeqRef.current,
      candidateCompletedAt,
      expiresAt: candidateCompletedAt + VISUAL_REENTRY_RESULT_TTL_MS,
    };
    const queued = visualReentryCandidateQueueRef.current.enqueue(job);
    if (queued === "duplicate") {
      log({ type: "visual-reentry", event: "duplicate-thought-skipped", thoughtId: candidateThought.id });
      return;
    }
    if (queued === "full") {
      log({ type: "visual-reentry", event: "candidate-queue-full", thoughtId: candidateThought.id, reason: "candidate decision queue capacity reached", queueDepth: visualReentryCandidateQueueRef.current.size });
      return;
    }
    log({ type: "visual-reentry", event: "candidate-queued", thoughtId: candidateThought.id, queueDepth: visualReentryCandidateQueueRef.current.size });
    drainVisualReentryDecisionQueueRef.current?.();
  }, [log, now]);

  const handleSettledVisualReentry = useCallback((thought: SettledThought) => {
    log({
      type: "visual-reentry",
      event: "thought-received",
      thoughtId: thought.id,
      sourceExcerpt: thought.text.slice(0, 80),
      sourceText: thought.text,
      participantThoughtIds: [thought.id],
    });
    void flushVisualReentryRef.current?.();
    if (causeEvidenceTimerRef.current) {
      clearTimeout(causeEvidenceTimerRef.current);
      causeEvidenceTimerRef.current = null;
    }

    const priorWindow = visualReentryEvidenceRef.current;
    let evidence = advanceVisualEvidence(priorWindow, thought);
    if (evidence.status === "rejected" && priorWindow.some((entry) => entry.family === "cause_effect")) {
      const prior = completePendingCauseEvidence(priorWindow);
      if (prior?.candidate) {
        // Draws any delta before finalizing so a chain abandoned by an
        // unrelated next thought is still fully on the canvas — the
        // flush-loop shortcut (see flushVisualReentry) clears
        // causeEffectProgressRef once this candidate is dequeued and found
        // to match, so no manual reset is needed on this branch.
        const priorNodes = parseExplicitCauseEffect(prior.candidate.text).intent?.nodes;
        if (priorNodes) void commitCauseEffectStep(prior.candidate.id, prior.candidate.text, priorNodes, "completed");
        launchVisualReentryCandidate(prior.candidate, prior.reason, true);
      } else {
        causeEffectProgressRef.current = null;
      }
      evidence = advanceVisualEvidence([], thought);
    }
    visualReentryEvidenceRef.current = evidence.next;
    if (evidence.status === "pending") {
      log({ type: "visual-reentry", event: "evidence-held", thoughtId: thought.id, reason: evidence.reason, sourceText: thought.text, participantThoughtIds: [thought.id] });
      if (evidence.causeEvidence) {
        log({ type: "visual-reentry", event: `cause-evidence-${evidence.causeEvidence}`, thoughtId: thought.id, reason: evidence.reason, visualFamily: "cause_effect" });
        if (evidence.causeEvidence === "opened") {
          // The opening clause already contains one full edge (evidence.ts
          // only reports "opened" once parseExplicitCauseEffect finds
          // exactly one edge) — draw both its nodes and the connecting
          // arrow right away instead of waiting for the chain to complete.
          const openedNodes = parseExplicitCauseEffect(thought.text).intent?.nodes;
          if (openedNodes) void commitCauseEffectStep(thought.id, thought.text, openedNodes, "opened");
        }
        causeEvidenceTimerRef.current = setTimeout(() => {
          causeEvidenceTimerRef.current = null;
          const completed = completePendingCauseEvidence(visualReentryEvidenceRef.current);
          if (!completed?.candidate) return;
          visualReentryEvidenceRef.current = [];
          const completedNodes = parseExplicitCauseEffect(completed.candidate.text).intent?.nodes;
          if (completedNodes) void commitCauseEffectStep(completed.candidate.id, completed.candidate.text, completedNodes, "completed");
          launchVisualReentryCandidate(completed.candidate, completed.reason, true);
        }, 6_000);
      }
      return;
    }
    if (!evidence.candidate) {
      log({
        type: "visual-reentry",
        event: "candidate-rejected",
        thoughtId: thought.id,
        reason: evidence.reason,
        sourceExcerpt: thought.text.slice(0, 80),
        sourceText: thought.text,
        participantThoughtIds: [thought.id],
      });
      // A causal chain that just got rejected (unrelated/unsafe next
      // thought) draws nothing further — whatever was already drawn
      // incrementally stays on the canvas, per the never-erase-spoken-ink
      // posture; only the tracking ref is finalized. The thought itself
      // stays as ordinary handwriting — there is no local fallback shape.
      if (evidence.family === "cause_effect") causeEffectProgressRef.current = null;
      return;
    }
    if (evidence.causeEvidence === "completed") {
      const completedNodes = parseExplicitCauseEffect(evidence.candidate.text).intent?.nodes;
      if (completedNodes) void commitCauseEffectStep(evidence.candidate.id, evidence.candidate.text, completedNodes, "completed");
    }
    launchVisualReentryCandidate(evidence.candidate, evidence.reason, evidence.causeEvidence === "completed");
  }, [commitCauseEffectStep, launchVisualReentryCandidate, log]);

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
      if (modeRef.current === "story") {
        settledCountRef.current = 0;
        prevInterimRef.current = [];
        log({ type: "transcript", text, rawTranscript: raw, normalizedTranscript: text, displayTranscript: text });
        setInterim("");
        void writeStoryCaption(text);
        void handleStoryFinal(text);
        return;
      }
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
            if (vrEnabled || (replayModeRef.current !== null && replayModeRef.current !== "v2_only")) {
              handleSettledVisualReentry(thought);
            }
            if (meEnabled) handleSettledMeaning(thought);
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
      if (!v2Enabled) {
        // Settle tier 2 against what was actually said: guesses the final
        // confirms are promoted, guesses it contradicts disappear.
        settleSpeculative(text);
        if (wordlessEnabled) settleProvisional();
        nudgeScribe();
        resetSilenceTimer();
      }
      // V2 INVARIANT: Scribe (Tier 3a) and Beat->Artist->Organizer->Director
      // (Tier 3b/3c) stay off the whole time — resetSilenceTimer is the only
      // path into runBeat, so gating it above suppresses that entire chain,
      // Math included. Do not call nudgeScribe/resetSilenceTimer
      // unconditionally here; downstream visual intelligence must consume
      // settled thought state, not compete with the active one.
    },
    [correct, handleSettledMeaning, handleSettledVisualReentry, handleStoryFinal, log, meEnabled, now, nudgeScribe, resetSilenceTimer, runVoiceCommand, settleProvisional, settleSpeculative, stampThoughtInk, v2Enabled, vrEnabled, wordlessEnabled, writeLive, writeStoryCaption],
  );

  const flushPresentationBoundary = useCallback(async () => {
    if (!v2Enabled || !v2ThoughtRef.current.text.trim()) return;
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
      if (vrEnabled || (replayModeRef.current !== null && replayModeRef.current !== "v2_only")) {
        handleSettledVisualReentry(thought);
      }
      if (meEnabled) handleSettledMeaning(thought);
      if (xeEnabled) handleSettledExpression(thought);
    }
  }, [handleSettledExpression, handleSettledMeaning, handleSettledVisualReentry, log, meEnabled, now, stampThoughtInk, v2Enabled, vrEnabled, writeLive, xeEnabled]);

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
      if (modeRef.current === "story") {
        void writeStoryCaption(shown);
        handleStoryPartial(text, confidence);
        return;
      }
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
      const shownForLive = v2Enabled && v2ThoughtRef.current.text
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
        if (fresh) {
          scribePendingRef.current = `${scribePendingRef.current} ${fresh}`.trim();
        }
        // Reflex (Tier 2) entirely, behind a flag — see lib/features.ts.
        // When off, nothing is scheduled at all: no setTimeout, no
        // recognition, no render. This is what makes a clean Reflex-off vs
        // Reflex-on comparison possible (Part 12).
        //
        // V2 INVARIANT: also suppressed under V2 regardless of the reflex
        // flag. Live speech owns the screen until the thought settles —
        // secondary visual systems must not write into the active thought
        // lifecycle. See docs/LIVE-SPEECH-PRESENTATION-V2.md.
        // The inversion (see the reflex layer above): under wordless mode the
        // canvas reacts to these same settled words *now*, not at settlement.
        // Not gated on `!v2Enabled` — that gate protects the live text line,
        // which is not what this draws into.
        if (fresh && wordlessEnabled) reflexOnInterim(fresh);
        if (fresh && features.reflex && !v2Enabled) {
          speculativeUtteranceRef.current =
            `${speculativeUtteranceRef.current} ${fresh}`.trim();

          // TIER 2, deferred to a macrotask on purpose.
          //
          // writeLive was dispatched above and is suspended on its first
          // await, so its remaining work sits in the microtask queue.
          // Recognition is cheap but it is not free — regexes, phrase
          // extraction, and a walk of the concept map — and running it
          // synchronously here would insert all of that BETWEEN the ink being
          // requested and the ink being committed. setTimeout puts it behind
          // the entire microtask chain, so tier 1 finishes first, always.
          //
          // The snapshot is taken now rather than inside the callback so the
          // guess is made from the words as they were when they settled.
          //
          // `epochAtSchedule` guards against the stale-callback hazard: a
          // clear/undo/new-page/reconnect between scheduling and firing bumps
          // liveSeqRef (see runVoiceCommand and the stream-restart sites), and
          // a callback that fires after that must not render a guess about a
          // board state that no longer exists. Same pattern writeLive itself
          // uses (the `seq !== liveSeqRef.current` checks above).
          const utterance = speculativeUtteranceRef.current;
          const epochAtSchedule = liveSeqRef.current;
          setTimeout(() => {
            if (liveSeqRef.current !== epochAtSchedule) {
              log({ type: "speculative", event: "stale", why: "board changed before recognition ran" });
              return;
            }
            const recognized = recognizeSpeculative(speculativeStateRef.current, {
              settledText: fresh,
              utteranceText: utterance,
              confidence,
              onBoard: [
                ...sketchRef.current.labels,
                ...[...boardRef.current.concepts.values()].map((c) => c.label),
              ],
            });
            speculativeStateRef.current = recognized.state;
            if (!recognized.events.length) return;
            const isStale = () => liveSeqRef.current !== epochAtSchedule;
            void renderSpeculative(recognized.events, isStale).then((outcomes) => {
              if (liveSeqRef.current !== epochAtSchedule) {
                log({ type: "speculative", event: "stale", why: "board changed before render resolved" });
                return;
              }
              speculativeStateRef.current = applySpeculativeOutcome(speculativeStateRef.current, outcomes);
            });
          }, 0);
        }
      }

      if (silenceTimerRef.current) resetSilenceTimer();
    },
    [handleStoryPartial, reflexOnInterim, renderSpeculative, resetSilenceTimer, runVoiceCommand, v2Enabled, wordlessEnabled, writeLive, writeStoryCaption],
  );

  /** Gemini engine: marks the model asked for, straight off the socket. */
  const handleLiveOps = useCallback(
    async (ops: Op[]) => {
      if (modeRef.current === "story") return;
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
        if (modeRef.current === "story") {
          void writeStoryCaption(liveUtteranceRef.current);
          handleStoryPartial(liveUtteranceRef.current);
          return;
        }
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
        clearStoryCaption();
        pendingTextRef.current = "";
        scribePendingRef.current = "";
        commit();
        log({ type: "command", command, rawTranscript: utterance });
        if (command === "undo") {
          if (modeRef.current === "story") void doStoryUndo();
          else doUndo();
        } else {
          turnPage("explicit-clear", "speaker explicitly requested a new page");
        }
        return;
      }
      if (modeRef.current === "story") {
        void writeStoryCaption(utterance);
        const t = now();
        finalsRef.current.push({ text: utterance, tStart: t, tEnd: t });
        log({ type: "transcript", text: utterance });
        void handleStoryFinal(utterance);
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
      resetSilenceTimer();
    },
    [clearStoryCaption, commit, doStoryUndo, doUndo, dropLiveLine, handleStoryFinal, handleStoryPartial, log, now, resetSilenceTimer, turnPage, writeLive, writeStoryCaption],
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
    storyAbortRef.current?.abort();
    visualReentryAbortRef.current?.abort();
    visualReentryAbortRef.current = null;
    visualReentryInFlightRef.current = false;
    visualReentryGenerationRef.current += 1;
    clearVisualReentryCandidateQueue("visual re-entry generation reset before replay");
    visualReentryPendingRef.current = [];
    visualReentryEvidenceRef.current = [];
    causeEffectProgressRef.current = null;
    if (cameraMotionRef.current) cancelAnimationFrame(cameraMotionRef.current.rafId);
    cameraMotionRef.current = null;
    cameraProposalSequenceRef.current = 0;
    cameraAnimationSequenceRef.current = 0;
    cameraPageGenerationRef.current = 0;
    cameraEventCycleSequenceRef.current = 0;
    pendingPageArrivalTransitionRef.current = null;
    pendingPageArrivalCameraRef.current = null;
    compositionRef.current = initialCompositionState();
    apiRef.current?.updateScene({ appState: { scrollX: 0, scrollY: 0, zoom: { value: 1 } } });
    if (causeEvidenceTimerRef.current) clearTimeout(causeEvidenceTimerRef.current);
    causeEvidenceTimerRef.current = null;
    if (visualReentryDrainTimerRef.current) clearTimeout(visualReentryDrainTimerRef.current);
    visualReentryDrainTimerRef.current = null;
    if (scribeTimerRef.current) clearTimeout(scribeTimerRef.current);
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    elementsRef.current = [];
    meaningIdentityRef.current = createMeaningIdentity();
    meaningControllerRef.current?.reset();
    expressionIdentityRef.current = createExpressionIdentity();
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
    visualReentryProcessedIdsRef.current = new Set();
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
  }, [clearVisualReentryCandidateQueue, commit, deepgram, replayLabEnabled, status]);

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
      if (scribeTimerRef.current) clearTimeout(scribeTimerRef.current);
      scribeTimerRef.current = null;
      scribeQueuedRef.current = false;
      scribeRetryAtRef.current = 0;
      scribeFailuresRef.current = 0;
      storyAbortRef.current?.abort();
      storyQueueRef.current = [];
      visualReentryAbortRef.current?.abort();
      visualReentryAbortRef.current = null;
      visualReentryInFlightRef.current = false;
      visualReentryGenerationRef.current += 1;
      clearVisualReentryCandidateQueue("visual re-entry generation reset after listening stopped");
      visualReentryPendingRef.current = [];
      visualReentryEvidenceRef.current = [];
      causeEffectProgressRef.current = null;
      if (causeEvidenceTimerRef.current) clearTimeout(causeEvidenceTimerRef.current);
      causeEvidenceTimerRef.current = null;
      if (visualReentryDrainTimerRef.current) clearTimeout(visualReentryDrainTimerRef.current);
      visualReentryDrainTimerRef.current = null;
    }
    wasListeningRef.current = listening;
  }, [clearVisualReentryCandidateQueue, status]);

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
    visualReentryAbortRef.current?.abort();
    clearVisualReentryCandidateQueue("visual re-entry component unmounted");
    visualReentryPendingRef.current = [];
    visualReentryEvidenceRef.current = [];
    causeEffectProgressRef.current = null;
    if (causeEvidenceTimerRef.current) clearTimeout(causeEvidenceTimerRef.current);
    causeEvidenceTimerRef.current = null;
    if (visualReentryDrainTimerRef.current) clearTimeout(visualReentryDrainTimerRef.current);
    visualReentryDrainTimerRef.current = null;
  }, [clearVisualReentryCandidateQueue]);

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
      storyRef.current = restoreStoryState(session.story);
      compositionRef.current = session.composition ?? initialCompositionState();
      // An explicit `?mode=` from the dashboard outranks the saved mode. The
      // restore itself is unchanged — only which mode the session resumes in.
      const requestedMode = initialMode ?? session.mode ?? "standard";
      // Story Mode is parked (lib/features.ts): a saved session opened
      // EXPLICITLY by id (initialSessionId set — the user clicked a
      // specific old session) still resumes in whatever mode it was
      // actually saved in, so existing story content stays viewable. The
      // implicit "continue where I left off" restore (no explicit session
      // id — just the last local autosave) does not get to silently land
      // the user back in story mode; it falls back to standard instead.
      modeRef.current = requestedMode === "story" && !features.storyMode && !initialSessionId
        ? "standard"
        : requestedMode;
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
      storyElementIdsRef.current = new Set([
        ...Object.values(storyRef.current.scenes).flatMap((scene) =>
          Object.values(scene.entities).flatMap((entity) =>
            entity.renderings.flatMap((rendering) => rendering.elementIds),
          ),
        ),
        ...Object.values(storyRef.current.scenes).flatMap((scene) =>
          Object.values(scene.relations).flatMap((relation) => relation.elementIds),
        ),
      ]);
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
    void import("@excalidraw/excalidraw");

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
      /** Local fallback only — bypasses the Scribe. */
      say: (text: string, interim = true) => growSketch(text, interim),
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
      /** Push text through the real Scribe, as if you had spoken it. */
      scribe: async (text: string) => {
        scribePendingRef.current = `${scribePendingRef.current} ${text}`.trim();
        scribeLastRunRef.current = 0;
        await runScribe();
        return logRef.current.filter((e) => e.type === "sketch").slice(-3);
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
      sketchCount: () => sketchRef.current.count,
      /** Apply artist actions directly, bypassing the beat. */
      act: (actions: CanvasAction[], sourceText = "manual") =>
        applyActions(actions, sourceText),
      /**
       * Apply Story actions directly, bypassing the interpreter but not the
       * wire parser — so hand-written actions are normalised exactly as a
       * model response would be.
       */
      storyAct: (actions: unknown[], sourceText = "manual story") =>
        applyStoryBatch(parseStoryActions({ actions }), sourceText),
      /** Drive the same local StoryEvent lane used by finalized speech. */
      storySay: (text: string) => handleStoryFinal(text),
      /** Simulate a streaming provider partial for provisional visual checks. */
      storyPartial: (text: string, confidence = 0) => handleStoryPartial(text, confidence),
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
    applyActions,
    applyStoryBatch,
    semanticScene,
    applyOp,
    clearSketch,
    doClear,
    doUndo,
    drainRenderQueue,
    growSketch,
    handleSettledExpression,
    handleStoryFinal,
    handleStoryPartial,
    markPerceivedStall,
    runScribe,
    writeLive,
    xeEnabled,
  ]);

  const handleModeChange = useCallback(
    (next: InPublicMode) => {
      const previous = modeRef.current;
      if (previous === next) return;
      modeRef.current = next;
      setMode(next);
      pendingTextRef.current = "";
      scribePendingRef.current = "";
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      storyPartialRef.current = emptyStoryPartialState();
      if (next === "story") {
        aiAbortRef.current?.abort();
        scribeAbortRef.current?.abort();
        storyAbortRef.current?.abort();
        visualReentryAbortRef.current?.abort();
        visualReentryAbortRef.current = null;
        visualReentryInFlightRef.current = false;
        visualReentryGenerationRef.current += 1;
        clearVisualReentryCandidateQueue("visual re-entry generation reset by mode change");
        visualReentryPendingRef.current = [];
        visualReentryEvidenceRef.current = [];
        causeEffectProgressRef.current = null;
        if (causeEvidenceTimerRef.current) clearTimeout(causeEvidenceTimerRef.current);
        causeEvidenceTimerRef.current = null;
        if (visualReentryDrainTimerRef.current) clearTimeout(visualReentryDrainTimerRef.current);
        visualReentryDrainTimerRef.current = null;
        storyQueueRef.current = [];
        const origin = pageOrigin(pageRef.current);
        const pageHasStandardContent = !activeStoryScene(storyRef.current) && elementsRef.current.some((element) =>
          !storyElementIdsRef.current.has(element.id) &&
          !storyCaptionIdsRef.current.has(element.id) &&
          element.x >= origin.x && element.x < origin.x + PAGE_W &&
          element.y >= origin.y && element.y < origin.y + PAGE_H,
        );
        if (pageHasStandardContent) {
          turnPage("story-mode", "Story Mode opened one clean persistent scene page");
        }
      } else {
        storyAbortRef.current?.abort();
        storyQueueRef.current = [];
        clearStoryCaption();
        // Reserve the Story scene as one full-width obstacle. The switch
        // itself stays on this page; the next Standard mark uses the existing
        // overflow path if there is no readable room below the scene.
        const origin = pageOrigin(pageRef.current);
        const storyOnPage = elementsRef.current.some((element) =>
          storyElementIdsRef.current.has(element.id) &&
          element.x >= origin.x && element.x < origin.x + PAGE_W,
        );
        if (storyOnPage) {
          turnPage("standard-mode", "Standard Mode resumed on a deliberate explanation sheet after the persistent Story stage");
        }
      }
      log({ type: "mode", from: previous, to: next });
      autosaveRef.current?.schedule();
    },
    [clearStoryCaption, clearVisualReentryCandidateQueue, log, turnPage],
  );

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
        excalidrawAPI={(instance: unknown) => setApi(instance)}
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

      {!demoStudio && <ControlBar
        status={status}
        busy={busy}
        mode={mode}
        onModeChange={handleModeChange}
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

      {!demoStudio && AUDIO_REPLAY_ENABLED && !showAudioReplay && (
        <button
          onClick={() => setShowAudioReplay(true)}
          className="fixed top-24 right-4 z-40 rounded-full border border-white/10 bg-black/70 px-3 py-2 text-xs text-white/80 hover:bg-black/90"
        >
          Audio Replay
        </button>
      )}
      {!demoStudio && AUDIO_REPLAY_ENABLED && showAudioReplay && (
        <AudioReplayPanel
          applyActions={applyActions}
          semanticScene={semanticScene}
          log={log}
          onClose={() => setShowAudioReplay(false)}
        />
      )}
    </div>
  );
}
