import type { PageTurnReason } from "./pagination";
import type { SemanticScene } from "./semantic";
import type { InPublicMode, StoryAction, StoryOperation } from "./story";
import type { CameraView, CompositionRect, ReadabilityRole } from "./composition";

type StoryLoggedAction = StoryAction["type"] | "story_event";

export type BeatAction =
  | "draw"
  | "command"
  | "section"
  | "skip"
  | "undo"
  | "clear"
  /** Only ever returned when math mode is enabled server-side — see BEAT_MATH_ADDENDUM. */
  | "math_step";

export interface BeatDecision {
  action: BeatAction;
  reason: string;
  focus: string;
}

/** One frame already on the canvas, as the models see it. */
export interface SceneFrameSummary {
  frameId: string;
  label: string;
  nodes: string[];
}

export interface Final {
  text: string;
  tStart: number;
  tEnd: number;
}

export type LogEvent =
  | { t: number; type: "transcript"; text: string; rawTranscript?: string; normalizedTranscript?: string; displayTranscript?: string }
  | { t: number; type: "sketch"; labels: string[] }
  | {
      t: number;
      type: "scribe";
      /** Words handed to the Scribe on this call. */
      fresh: string;
      /** Milliseconds from request to last op. */
      ms: number;
      /** How many marks actually reached the page. */
      drew: number;
    }
  /**
   * One utterance written by the live line, logged when it settles.
   *
   * `lag` is the number that matters now: milliseconds from the end of the
   * spoken audio to ink on the sheet. Deepgram stamps each result with its
   * position on the audio timeline, and the session clock starts with the
   * socket, so the two are comparable. `render` is our share of that — build
   * plus commit — so a bad `lag` can be attributed to the network or to us
   * without guessing.
   */
  | {
      t: number;
      type: "live";
      text: string;
      /** How many interims built this line. */
      interims: number;
      lagP50: number;
      lagMax: number;
      renderP50: number;
      /** Provider finalization lag, deliberately excluded from interim lag. */
      finalLag?: number;
      /** Callback-to-next-animation-frame delay for the transcript UI. */
      paintP50?: number;
      paintP95?: number;
      streamEpoch?: number;
      invalidSamples?: number;
    }
  | {
      t: number;
      type: "speech-stream";
      streamEpoch: number;
      capture: "audio-worklet-pcm16" | "media-recorder";
      sampleRate?: number;
      audioChunks: number;
      chunkGapP50: number;
      chunkGapP95: number;
      chunkGapMax: number;
      interimResults: number;
      interimGapP50: number;
      interimGapP95: number;
      interimGapMax: number;
      interimLagP50: number;
      interimLagP95: number;
      interimLagMax: number;
      firstVisibleWordMs?: number;
      finalLagMs?: number;
    }
  /**
   * A page turn, with the reason it happened.
   *
   * The reason is not decoration. Eleven of eighteen turns in the 10:09
   * session landed mid-sentence and the log could not say which of the two
   * triggers was responsible, so there was no way to tell a page system that
   * was working hard from one that was cutting thoughts in half.
   */
  | {
      t: number;
      type: "page";
      index: number;
      reason: PageTurnReason;
      why: string;
      /** True when the turn happened despite an unfinished utterance. */
      midThought: boolean;
      /** Whether the live line was carried onto the new sheet. */
      carriedLiveLine?: boolean;
    }
  | { t: number; type: "sketch-blocked"; why: string }
  | { t: number; type: "beat"; action: BeatAction; reason: string; focus: string }
  | { t: number; type: "draw"; frameId: string; frameLabel: string; mermaid: string }
  /** One artist response, after validation. */
  | {
      t: number;
      type: "actions";
      intent: "draw" | "command";
      focus: string;
      /** Actions as returned, before matching. */
      requested: string[];
      /** What actually happened, including reuse of existing concepts. */
      applied: string[];
      ms: number;
    }
  | { t: number; type: "section"; sectionId: string; title: string }
  /**
   * One trip through beat -> organizer -> canvas, timed end to end.
   *
   * The pieces were all logged separately before, on different clocks, so
   * "how long after I finished the sentence did the arrow appear" could not be
   * answered from a session file. It can now.
   */
  | {
      t: number;
      type: "timing";
      /** Session-clock ms when the transcript that triggered this arrived. */
      transcriptAt: number;
      /** Why the beat fired now rather than earlier or later. */
      trigger: string;
      beatMs: number;
      decision: BeatAction;
      organizerMs: number;
      applyMs: number;
      /** transcript received -> last mark on the canvas. */
      totalMs: number;
      requested: number;
      applied: number;
    }
  /** What the recogniser heard, and what it was rewritten to. */
  | {
      t: number;
      type: "correction";
      from: string;
      to: string;
      confidence: number;
      why: string;
    }
  /** Keyterms handed to the recogniser when the socket opened. */
  | { t: number; type: "keyterms"; terms: string[] }
  /** A back-reference: camera left the current page and came back. */
  | {
      t: number;
      type: "reference";
      phrase: string;
      matched: string;
      confidence: number;
      fromPage: number;
      toPage: number;
      /** False when confidence was too low and we stayed put. */
      followed: boolean;
    }
  | { t: number; type: "undo"; operationType?: string; operationId?: string }
  | { t: number; type: "command"; command: "undo" | "new-page"; rawTranscript: string }
  | { t: number; type: "invalid-timing"; streamEpoch: number; activeStreamEpoch: number; audioEndMs: number; inkedAtMs: number; reason: string }
  | { t: number; type: "attention"; action: "suppression" | "adoption" | "merge" | "compression" | "de-emphasis" | "removal"; target: string; reason: string }
  | { t: number; type: "thought"; rawSegments: string[]; merged: string; heldMs: number }
  | { t: number; type: "mode"; from: InPublicMode; to: InPublicMode }
  | {
      t: number;
      type: "composition";
      event: "decision" | "suppression" | "summarization";
      focalSubject: string;
      activeCluster: string;
      safeFrame: CompositionRect;
      effectiveTextSize: number;
      cameraTarget: CameraView;
      reason: string;
      moved: boolean;
      contentFits: boolean;
      webcamCollisions: number;
      occupiedCanvasRatio: number;
      readabilityViolations: string[];
    }
  | {
      t: number;
      type: "camera";
      event: "started" | "completed" | "cancelled";
      target: CameraView;
      reason: string;
    }
  | {
      t: number;
      type: "readability";
      elementId: string;
      role: ReadabilityRole;
      sourceFontSize: number;
      effectiveFontSize: number;
      minimumFontSize: number;
    }
  | {
      t: number;
      type: "story-staging";
      entityId: string;
      zone: string;
      bounds: CompositionRect;
      reason: string;
    }
  | { t: number; type: "story-request"; transcript: string; sceneId: string }
  | { t: number; type: "story-response"; sourceText: string; normalizedText?: string; confidence: number; actions: number; fallback: boolean }
  | {
      t: number;
      type: "story-decision";
      sourceText: string;
      /** Corrected speech, when correction was confident enough to use. */
      normalizedText?: string;
      mode?: InPublicMode;
      action: string;
      accepted: boolean;
      /** Every action the interpreter asked for, in order. */
      actionsRequested?: Array<{ action: StoryLoggedAction; target: string }>;
      actionsAccepted?: Array<{ action: StoryLoggedAction; target: string; reason: string }>;
      actionsRejected?: Array<{ action: StoryLoggedAction; target: string; reason: string }>;
      /** Prepared asset, primitive recipe, or placeholder, per created entity. */
      renderWarnings?: string[];
      latencyMs?: number;
      proposedActions: number;
      acceptedActions: number;
      rejectedActionCount: number;
      rejectedActions: Array<{ action: StoryLoggedAction; target: string; reason: string }>;
      decisions: Array<{
        actionIndex: number;
        actionType: StoryLoggedAction;
        target: string;
        accepted: boolean;
        reason: string;
        entityResolutions: Array<{ reference: string; entityId?: string; status: "resolved" | "created" | "missing" | "historical" }>;
        assetResolution?: { requested: string; resolved?: string; status: "matched" | "mismatch" | "needs_asset" };
        warnings: string[];
      }>;
      entityResolutions: Array<{ reference: string; entityId?: string; status: "resolved" | "created" | "missing" | "historical" }>;
      assetResolutions: Array<{ requested: string; resolved?: string; status: "matched" | "mismatch" | "needs_asset" }>;
      validationWarnings: string[];
      warnings: string[];
    }
  | { t: number; type: "story-action-requested"; action: StoryAction["type"]; target: string }
  | { t: number; type: "story-action-applied"; result: string }
  | { t: number; type: "story-entity"; event: "created" | "reused" | "updated" | "transformed" | "hidden"; entityId: string }
  | { t: number; type: "story-scene"; event: "activated" | "continued"; sceneId: string; pageIndex: number }
  | { t: number; type: "story-undo"; action?: StoryOperation["actionType"]; operationId?: string }
  | { t: number; type: "story-timing"; interpreterMs: number; applyMs: number; totalMs: number; actions: number }
  | { t: number; type: "story-lane-timing"; lane: "provisional" | "commit" | "update"; sourceText: string; latencyMs: number; eventId: string }
  | { t: number; type: "story-ambiguity"; rawTranscript: string; ambiguity: string; resolution: "pending" | "dismissed" | "confirmed" }
  | { t: number; type: "clear" }
  | { t: number; type: "error"; where: string; text: string }
  | { t: number; type: "note"; text: string };

/** Omit that distributes across a union, so `log()` accepts any event shape. */
export type LogEventInput = LogEvent extends infer U
  ? U extends LogEvent
    ? Omit<U, "t">
    : never
  : never;

export interface BeatRequest {
  pendingText: string;
  sceneSummary: SceneFrameSummary[];
  lastDrawnAt: number;
  /** Rough boxes currently on the board for the thought in progress. */
  liveConcepts?: string[];
  /**
   * How many times in a row the beat has already skipped. Its own past
   * decisions are invisible to it otherwise, so it re-derives the same skip
   * from the same material call after call.
   */
  skipStreak?: number;
  /** The semantic board, so the beat can tell a repeat from a new relation. */
  scene?: SemanticScene;
}

export interface ArtistRequest {
  focus: string;
  transcript: string;
  sceneSummary: SceneFrameSummary[];
  /**
   * The board as meaning rather than as pixels. This is the field whose
   * absence made the artist redraw concepts that were already on the page —
   * it could only ever see frame labels before.
   */
  scene?: SemanticScene;
  /** "draw" for content, "command" when the speaker gave an instruction. */
  intent?: "draw" | "command";
}

export interface MathRequest {
  focus: string;
  transcript: string;
  scene?: SemanticScene;
  /** conceptId of the equation currently being worked on, if any. */
  activeConceptId?: string;
  /** Current expression as the board has it, so the model can't drift from what's shown. */
  currentExpression?: string;
  /** "deep" when the speaker asked "why"/"another way" about the current step. */
  depth?: "default" | "deep";
}
