"use client";

import { Excalidraw } from "@excalidraw/excalidraw";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CanvasTopBar } from "@/components/CanvasShell";
import { ControlBar, ErrorBanner } from "@/components/ControlBar";
import type { SaveState } from "@/components/ProductUI";
import { TranscriptStrip } from "@/components/TranscriptStrip";
import { RecordingPanel } from "@/components/RecordingPanel";
import { AudioReplayPanel } from "@/components/AudioReplayPanel";
import { useDeepgram, type DeepgramResultTiming } from "@/hooks/useDeepgram";
import { useGeminiLive } from "@/hooks/useGeminiLive";
import { useUsageSession } from "@/hooks/useUsageSession";
import { providerRequestHeaders } from "@/lib/usage-client";
import { requestDelayMs, retryAfterMs } from "@/lib/requestScheduling";
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
  type PageTurnReason,
} from "@/lib/pagination";
import { describePlan, planActions, type PageMark, type PlanStep } from "@/lib/organizer";
import {
  detectBackReference,
  resolveReference,
  type ReferenceTarget,
} from "@/lib/reference";
import { correctTranscript, groundedInSource, keyterms } from "@/lib/vocab";
import {
  MAX_TEMPORARY_SCRIBE_MARKS,
  temporaryMarkBudgetReached,
  visibleConceptBudgetReached,
  visibleRelationshipBudgetReached,
  withinInitialCompositionWindow,
} from "@/lib/attention";
import {
  EMPTY_THOUGHT,
  STRUCTURAL_HOLD_MS,
  flushStructuralThought,
  localVoiceCommand,
  pushStructuralSegment,
  retirePending,
  type StructuralThoughtState,
} from "@/lib/liveSpeech";
import { liveLatencySample, type AudioTiming } from "@/lib/telemetry";
import {
  READABILITY_CONTRACT,
  effectiveTextSize,
  initialCompositionState,
  proposeCamera,
  recordingViewport,
  rectUnion,
  stepCameraSpring,
  type CameraView,
  type CameraVelocity,
  type CompositionRect,
  type CompositionState,
  type ReadabilityRole,
  type TextReadabilitySample,
} from "@/lib/composition";
import { detectGesture, extractConcepts } from "@/lib/sketch";
import { features } from "@/lib/features";
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
/** Stay safely below the server's rolling limit of 12 Scribe calls/minute. */
const SCRIBE_INTERVAL_MS = 5250;
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
/** Keep each sheet readable. Reaching this limit turns the page; it must never
 * stop the live hand. */
const MAX_MARKS_PER_PAGE = 22;
/**
 * Chrome that floats over the canvas: Excalidraw's toolbar along the top, the
 * control bar along the bottom. The camera has to frame the sheet in the band
 * between them rather than in the window, or the top of every page sits under
 * the toolbar.
 */
const DIM_OPACITY = 45;
const CLEAR_OPACITY = 20;
const TRANSCRIPT_WINDOW_MS = 90_000;

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
}: {
  initialMode?: InPublicMode;
  initialSessionId?: string;
  /** Skip the restore entirely — the dashboard asked for a blank canvas. */
  startFresh?: boolean;
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
  const log = useCallback(
    (event: LogEventInput) => {
      logRef.current.push({ ...event, t: now() } as LogEvent);
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

  const commit = useCallback(() => {
    suppressChangeUntilRef.current = Date.now() + 150;
    apiRef.current?.updateScene({ elements: elementsRef.current as never });
    autosaveRef.current?.schedule();
  }, []);

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
    rafId: number;
  } | null>(null);
  const liveCameraHoldRef = useRef(false);
  const liveCameraOverviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (liveCameraOverviewTimerRef.current) clearTimeout(liveCameraOverviewTimerRef.current);
    if (cameraMotionRef.current) cancelAnimationFrame(cameraMotionRef.current.rafId);
  }, []);
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
  const animateCamera = useCallback((target: CameraView, reason: string) => {
    const app = apiRef.current?.getAppState?.();
    if (!app) return;
    const from: CameraView = {
      scrollX: Number(app.scrollX ?? 0),
      scrollY: Number(app.scrollY ?? 0),
      zoom: Number(app.zoom?.value ?? app.zoom ?? 1),
    };
    const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const existing = cameraMotionRef.current;
    const isAtTarget = Math.abs(from.scrollX - target.scrollX) < 0.5
      && Math.abs(from.scrollY - target.scrollY) < 0.5
      && Math.abs(from.zoom - target.zoom) < 0.001;
    if (isAtTarget && !existing) {
      compositionRef.current = { ...compositionRef.current, camera: target, proposedTarget: undefined, movementReason: undefined };
      return;
    }
    if (reduced) {
      if (cameraMotionRef.current) cancelAnimationFrame(cameraMotionRef.current.rafId);
      cameraMotionRef.current = null;
      log({ type: "camera", event: "started", target, reason });
      apiRef.current?.updateScene({ appState: { scrollX: target.scrollX, scrollY: target.scrollY, zoom: { value: target.zoom } } });
      compositionRef.current = { ...compositionRef.current, camera: target, proposedTarget: undefined, movementReason: undefined };
      log({ type: "camera", event: "completed", target, reason });
      return;
    }

    if (existing) {
      log({ type: "camera", event: "cancelled", target: existing.target, reason: existing.reason });
      existing.target = target;
      existing.reason = reason;
      log({ type: "camera", event: "started", target, reason });
      return;
    }

    log({ type: "camera", event: "started", target, reason });
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
      log({ type: "camera", event: "completed", target: completedTarget, reason: completedReason });
    };
    const startedAt = performance.now();
    cameraMotionRef.current = {
      camera: from,
      target,
      velocity: { scrollX: 0, scrollY: 0, zoom: 0 },
      lastFrameAt: startedAt,
      reason,
      rafId: requestAnimationFrame(frame),
    };
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
  ) => {
    // Delayed Scribe/Beat commits may continue while the speaker is talking.
    // They may draw, but the live line owns the shot until its overview timer.
    if (liveCameraHoldRef.current && !liveFocalElementId && !force) return;
    if (compositionRef.current.proposedTarget && !force && !liveFocalElementId) return;
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
    const proposal = proposeCamera({
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
    });
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
      animateCamera(proposal.target, proposal.reason);
    }
  }, [animateCamera, log]);

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
      if (carry && carried) void writeLiveRef.current?.(carried, false);
    },
    [dropLiveLine, findElement, framePage, log],
  );

  /**
   * How long a soft page turn has been held back for an unfinished thought.
   * Zero when nothing is pending.
   */
  const pageTurnRequestedAtRef = useRef(0);
  /** writeLive is defined below turnPage but called by it. */
  const writeLiveRef = useRef<
    ((text: string, settled: boolean, timing?: AudioTiming) => Promise<void>) | null
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
      if (
        withinInitialCompositionWindow(now()) &&
        (trigger === "capacity" || trigger === "overflow" || trigger === "section" || trigger === "long-utterance")
      ) {
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
   */
  const writeLive = useCallback(
    async (text: string, settled: boolean, timing?: AudioTiming) => {
      const spoken = text.trim();
      if (!spoken) return;
      const seq = ++liveSeqRef.current;
      const startedAt = now();
      await fontsReadyRef.current;
      if (!liveRef.current && settledLiveRef.current) dropSettledLiveLine();

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
      // The utterance's element id, adopted from the first build and then held
      // for the rest of the sentence. Empty until that first build lands.
      let elementId = prior?.elementId ?? "";
      let base: Pen = ours ? prior!.base : { ...penRef.current };
      let probe: Pen = { ...base };
      let spot = lineStart(probe);
      let built = await buildLiveLine(spoken, spot.x, spot.y, settled, elementId);

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
          turnPage("long-utterance", "utterance outgrew the sheet", { carry: false });
          base = { ...penRef.current };
          probe = { ...base };
          spot = lineStart(probe);
          elementId = "";
          built = await buildLiveLine(spoken, spot.x, spot.y, settled);
          if (seq !== liveSeqRef.current) return;
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

      commit();
      liveCameraHoldRef.current = true;
      if (liveCameraOverviewTimerRef.current) {
        clearTimeout(liveCameraOverviewTimerRef.current);
        liveCameraOverviewTimerRef.current = null;
      }
      // While speech is arriving, the live line owns the shot. It keeps one
      // stable element id across interims, so following it does not confuse a
      // changing transcript with a changing subject.
      framePage(false, "following live narration", null, elementId);
      if (settled) {
        liveCameraOverviewTimerRef.current = setTimeout(() => {
          liveCameraOverviewTimerRef.current = null;
          liveCameraHoldRef.current = false;
          framePage(true, "overview after live narration", null, null, true);
        }, LIVE_CAMERA_OVERVIEW_MS);
      }

      // Ink is on the sheet as of here. Everything below is measurement.
      const inkedAt = now();
      const timings = liveLagRef.current;
      if (timing?.kind !== "final") timings.render.push(inkedAt - startedAt);
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
          else timings.lag.push(sample.lagMs ?? 0);
        } else {
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
    [commit, dropSettledLiveLine, framePage, log, now, requestPageTurn, turnPage],
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

  const runScribe = useCallback(async () => {
    if (modeRef.current !== "standard") return;
    if (scribeInFlightRef.current) {
      scribeQueuedRef.current = true;
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
    const fresh = scribePendingRef.current.replace(/\s+/g, " ").trim();
    if (!fresh) return;

    scribeInFlightRef.current = true;
    const startedAt = Date.now();
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
        console.warn("[artist] mermaid parse failed", err);
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
    // Remove it and everything after it that we skipped (camera-only ops).
    const index = board.history.indexOf(op);
    const trailing = board.history.slice(index);
    for (let i = trailing.length - 1; i >= 0; i--) revertOperation(trailing[i]);
    board.history = board.history.slice(0, index);

    lastDrawnAtRef.current = Date.now();
    restoreCompositionCamera(op.compositionBefore);
    log({ type: "undo", operationType: op.type, operationId: op.operationId });
  }, [log, restoreCompositionCamera, revertOperation]);

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
              apiRef.current?.scrollToContent(el as never, {
                fitToViewport: true,
                viewportZoomFactor: 0.6,
                animate: true,
                duration: 400,
              });
              sketchPannedRef.current = false; // let the next mark re-frame
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
    [doClear, doUndo, log, nodeForConcept, now, recordOperation, requestPageTurn],
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

      // One controller for the whole beat->artist chain, so "scratch that" or
      // stopping the mic cancels work that is about to be irrelevant.
      aiAbortRef.current?.abort();
      aiAbortRef.current = new AbortController();

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
          scene: semanticScene(),
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
      console.warn("[beat] failed", err);
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

  const handleFinal = useCallback(
    (raw: string, tStart: number, tEnd: number, audioEndMs: number, streamEpoch: number, timing?: DeepgramResultTiming) => {
      const command = localVoiceCommand(raw);
      if (command) {
        liveSeqRef.current += 1;
        dropLiveLine();
        clearStoryCaption();
        liveLagRef.current = { lag: [], render: [], paint: [], streamEpoch: 0, invalid: 0 };
        pendingTextRef.current = "";
        scribePendingRef.current = "";
        settledCountRef.current = 0;
        prevInterimRef.current = [];
        aiAbortRef.current?.abort();
        scribeAbortRef.current?.abort();
        setInterim("");
        commit();
        log({ type: "command", command, rawTranscript: raw });
        if (command === "undo") {
          if (modeRef.current === "story") void doStoryUndo();
          else doUndo();
        } else {
          turnPage("explicit-clear", "speaker explicitly requested a new page");
        }
        return;
      }
      const text = correct(raw);
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
      }
      settledCountRef.current = 0;
      prevInterimRef.current = [];

      log({ type: "transcript", text, rawTranscript: raw, normalizedTranscript: text, displayTranscript: text });
      setInterim("");
      // Lock the line Deepgram just committed to. Everything below this runs
      // behind the writing, not in front of it.
      void writeLive(text, true, { audioEndMs, streamEpoch, ...timing, kind: "final" });
      nudgeScribe();
      resetSilenceTimer();
    },
    [clearStoryCaption, commit, correct, doStoryUndo, doUndo, dropLiveLine, handleStoryFinal, log, nudgeScribe, resetSilenceTimer, turnPage, writeLive, writeStoryCaption],
  );

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
      const shown = correctTranscript(text, activeTermsRef.current).text || text;
      const paintStarted = performance.now();
      const timingBucket = liveLagRef.current;
      setInterim(shown);
      requestAnimationFrame(() => {
        timingBucket.paint.push(Math.round(performance.now() - paintStarted));
      });
      if (modeRef.current === "story") {
        void writeStoryCaption(shown);
        handleStoryPartial(text, confidence);
        return;
      }
      // Put each provider interim on the sheet immediately: no model, no
      // throttle, and no wait for finalization.
      void writeLive(shown, false, { audioEndMs, streamEpoch, ...timing, kind: "interim" });

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
      }

      if (silenceTimerRef.current) resetSilenceTimer();
    },
    [handleStoryPartial, resetSilenceTimer, writeLive, writeStoryCaption],
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
      ? { status: gemini.status, start: gemini.start, stop: gemini.stop }
      : { status: deepgram.status, start: deepgram.start, stop: deepgram.stop };
  const status = engine.status;
  const stopEngine = engine.stop;
  const startEngine = engine.start;
  const usage = useUsageSession({
    projectId: useCallback(() => sessionIdRef.current, []),
    mode: useCallback(() => modeRef.current, []),
    onForcedStop: useCallback(() => stopEngine(), [stopEngine]),
    onWarning: useCallback((message: string) => setErrorText(message), []),
  });
  const toggle = useCallback(async () => {
    const listening = status === "live" || status === "connecting" || status === "reconnecting";
    if (listening) {
      stopEngine();
      await usage.stop("paused");
      return;
    }
    await autosaveRef.current?.flushNow();
    if (await usage.start()) await startEngine();
  }, [startEngine, status, stopEngine, usage]);

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
    }
    wasListeningRef.current = listening;
  }, [status]);

  // ---- manual dry-run handle ----------------------------------------------
  // Lets me rehearse pacing from the console without talking:
  //   inpublic.draw("flowchart LR\n A[Mic] --> B[Beat] --> C[Artist]")
  // ---- persistence ---------------------------------------------------------
  useEffect(() => {
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
    }), 3000, setSaveStatus);
    const flush = () => void autosaveRef.current?.flushNow();
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
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
      undo: doUndo,
      clear: doClear,
      clearSketch,
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
    handleStoryFinal,
    handleStoryPartial,
    runScribe,
    writeLive,
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
    [clearStoryCaption, log, turnPage],
  );

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
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [toggle]);

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
    downloadLog(logRef.current, t0Ref.current, storyRef.current, modeRef.current);
  }, []);

  const finishSession = useCallback(() => {
    if (status === "live" || status === "reconnecting" || status === "connecting") toggle();
    void autosaveRef.current?.flushNow().then(() => router.push("/dashboard"));
  }, [router, status, toggle]);

  // ---- render --------------------------------------------------------------
  return (
    <div
      ref={setRecordingTarget}
      className={`canvas-shell relative h-screen w-screen bg-white ${recordingFocus ? "recording-focus" : ""}`}
      data-recording-focus={recordingFocus ? "true" : "false"}
      onPointerDown={markPointerInput}
      onWheel={markPointerInput}
      onKeyDownCapture={markUserInput}
    >
      <CanvasTopBar title={sessionTitle} saveState={saveStatus} remainingSeconds={usage.remainingSeconds} unlimitedMinutes={usage.entitlement?.unlimitedMinutes} onTitleChange={handleTitleChange} onExport={handleExport} onDownloadLog={handleDownloadLog} />

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

      {showTranscript ? (
        <TranscriptStrip text={interim} />
      ) : (
        <span data-recording-transcript={interim} className="hidden" />
      )}

      <ErrorBanner text={errorText} onDismiss={() => setErrorText(null)} onRetry={toggle} />

      <ControlBar
        status={status}
        busy={busy}
        mode={mode}
        onModeChange={handleModeChange}
        onToggleMic={toggle}
        onFinish={finishSession}
      />

      <RecordingPanel
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
      />

      {AUDIO_REPLAY_ENABLED && !showAudioReplay && (
        <button
          onClick={() => setShowAudioReplay(true)}
          className="fixed top-24 right-4 z-40 rounded-full border border-white/10 bg-black/70 px-3 py-2 text-xs text-white/80 hover:bg-black/90"
        >
          Audio Replay
        </button>
      )}
      {AUDIO_REPLAY_ENABLED && showAudioReplay && (
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
