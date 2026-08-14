/**
 * Recording-first visual composition.
 *
 * The canvas remains infinite and editable. This module defines the finite
 * rectangle the audience sees and makes deterministic camera decisions in
 * that space. It contains no React or Excalidraw code, so the rules can be
 * regression-tested without a browser.
 */

export interface CompositionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CameraView {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export interface CameraVelocity {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export interface CameraSpringStep {
  camera: CameraView;
  velocity: CameraVelocity;
}

export interface SafeAreaMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type WebcamPosition = "top-right" | "top-left" | "bottom-right" | "bottom-left";

export interface RecordingViewportConfig {
  margins: SafeAreaMargins;
  webcam: {
    reserved: boolean;
    position: WebcamPosition;
    widthRatio: number;
    aspectRatio: number;
    inset: number;
    gap: number;
  };
}

export interface RecordingViewport {
  width: number;
  height: number;
  safeBounds: CompositionRect;
  webcamBounds?: CompositionRect;
  config: RecordingViewportConfig;
}

export type ReadabilityRole = "primary" | "supporting" | "annotation";

export const READABILITY_CONTRACT: Record<ReadabilityRole, number> = {
  primary: 22,
  supporting: 18,
  annotation: 15,
};

export const DEFAULT_RECORDING_VIEWPORT: RecordingViewportConfig = {
  margins: { top: 36, right: 36, bottom: 36, left: 36 },
  webcam: {
    reserved: true,
    position: "top-right",
    widthRatio: 0.2,
    aspectRatio: 16 / 9,
    inset: 28,
    gap: 24,
  },
};

export interface CompositionState {
  focalSubject: string;
  activeCluster: string;
  camera: CameraView;
  proposedTarget?: CameraView;
  movementReason?: string;
  lastMovementAt: number;
  movementCount: number;
  cancelledMovementCount: number;
}

export interface TextReadabilitySample {
  id: string;
  fontSize: number;
  role: ReadabilityRole;
}

export interface CameraProposalInput {
  state: CompositionState;
  viewport: RecordingViewport;
  currentCamera: CameraView;
  focalBounds: CompositionRect;
  contextBounds?: CompositionRect;
  focalSubject: string;
  activeCluster: string;
  reason: string;
  now: number;
  text?: TextReadabilitySample[];
  primarySubjectChanged?: boolean;
  explicitNavigation?: boolean;
  followMovingSubject?: boolean;
  /** Override the per-move zoom limit for an intentional overview reveal. */
  maximumZoomChange?: number;
  /**
   * A deliberate user pan/zoom happened recently. Suppresses routine
   * (non-urgent) recentering so the camera doesn't immediately fight a
   * manual move, without blocking a correction the frame actually needs —
   * `urgent` (content that doesn't fit, a readability/webcam violation, or
   * explicit navigation) is never suppressed by this.
   */
  manualPriorityActive?: boolean;
}

export interface CameraProposal {
  move: boolean;
  target: CameraView;
  reason: string;
  state: CompositionState;
  safeFrame: CompositionRect;
  effectiveTextSize: number;
  readabilityViolations: string[];
  contentFits: boolean;
  webcamCollisions: number;
  occupiedCanvasRatio: number;
}

export const CAMERA_RULES = {
  cooldownMs: 900,
  zoomHysteresis: 0.07,
  minimumDisplacementPx: 32,
  maximumZoomChange: 0.16,
  maximumZoom: 1.08,
  /** Natural frequency of the critically damped follow camera. */
  springFrequency: 10,
  /**
   * How long a `proposedTarget` is honoured as "a move is genuinely in
   * flight" before it's treated as stale and stops blocking new proposals.
   *
   * Board.tsx's framePage skips calling proposeCamera at all while a move
   * looks pending (so a non-urgent reframe never fights an in-flight one),
   * but that check happens before proposeCamera runs, so nothing re-derives
   * `proposedTarget` in the meantime — only the spring's own completion
   * callback clears it. A spring that never reports settled (numerical
   * stall, a target that keeps moving just enough to reset velocity without
   * ever crossing the settle threshold, or a callback that throws before
   * clearing state) would otherwise leave every future non-live-narration
   * reframe silently skipped forever — the camera "stuck", visually
   * indistinguishable from a real bug in the spring itself. A few seconds is
   * generously above the spring's own settle time at the configured
   * frequency and cooldown, so this never cuts short a real in-flight move.
   */
  stuckMoveMs: 2500,
} as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * One critically damped axis, advanced by `seconds`. Frame-rate independent
 * (closed form, not Euler integration) and safe to retarget mid-flight
 * without resetting velocity — shared by every spring in this module so a
 * camera move and a concept move settle with the same feel.
 */
function springAxis(value: number, destination: number, speed: number, seconds: number, frequency: number) {
  const error = value - destination;
  const coefficient = speed + frequency * error;
  const decay = Math.exp(-frequency * seconds);
  return {
    value: destination + (error + coefficient * seconds) * decay,
    speed: (speed - frequency * coefficient * seconds) * decay,
  };
}

/**
 * Advance a critically damped camera spring without resetting its velocity.
 * This closed-form step is frame-rate independent and can be smoothly
 * retargeted whenever a new live transcript revision arrives.
 */
export function stepCameraSpring(
  camera: CameraView,
  target: CameraView,
  velocity: CameraVelocity,
  deltaMs: number,
  frequency: number = CAMERA_RULES.springFrequency,
): CameraSpringStep {
  const seconds = Math.max(0, Math.min(deltaMs, 64)) / 1000;
  const x = springAxis(camera.scrollX, target.scrollX, velocity.scrollX, seconds, frequency);
  const y = springAxis(camera.scrollY, target.scrollY, velocity.scrollY, seconds, frequency);
  const zoom = springAxis(camera.zoom, target.zoom, velocity.zoom, seconds, frequency);
  return {
    camera: { scrollX: x.value, scrollY: y.value, zoom: zoom.value },
    velocity: { scrollX: x.speed, scrollY: y.speed, zoom: zoom.speed },
  };
}

export interface Point2D {
  x: number;
  y: number;
}

export interface Point2DVelocity {
  x: number;
  y: number;
}

export interface PositionSpringStep {
  position: Point2D;
  velocity: Point2DVelocity;
}

/**
 * The same critically damped spring as `stepCameraSpring`, generalized to a
 * plain 2D point. Used to move existing concept nodes into a new layout
 * (see components/Board.tsx's `animateConceptsToComparison`) with the same
 * architectural pattern `animateCamera` already established, rather than a
 * second unrelated animation system.
 */
export function stepPositionSpring(
  position: Point2D,
  target: Point2D,
  velocity: Point2DVelocity,
  deltaMs: number,
  frequency: number = CAMERA_RULES.springFrequency,
): PositionSpringStep {
  const seconds = Math.max(0, Math.min(deltaMs, 64)) / 1000;
  const x = springAxis(position.x, target.x, velocity.x, seconds, frequency);
  const y = springAxis(position.y, target.y, velocity.y, seconds, frequency);
  return {
    position: { x: x.value, y: y.value },
    velocity: { x: x.speed, y: y.speed },
  };
}

export function recordingViewport(
  width: number,
  height: number,
  override: Partial<RecordingViewportConfig> = {},
): RecordingViewport {
  const config: RecordingViewportConfig = {
    ...DEFAULT_RECORDING_VIEWPORT,
    ...override,
    margins: { ...DEFAULT_RECORDING_VIEWPORT.margins, ...(override.margins ?? {}) },
    webcam: { ...DEFAULT_RECORDING_VIEWPORT.webcam, ...(override.webcam ?? {}) },
  };
  const { margins, webcam } = config;
  let webcamBounds: CompositionRect | undefined;
  if (webcam.reserved) {
    const webcamWidth = Math.round(width * webcam.widthRatio);
    const webcamHeight = Math.round(webcamWidth / webcam.aspectRatio);
    const left = webcam.position.endsWith("right")
      ? width - webcam.inset - webcamWidth
      : webcam.inset;
    const top = webcam.position.startsWith("top")
      ? webcam.inset
      : height - webcam.inset - webcamHeight;
    webcamBounds = { x: left, y: top, width: webcamWidth, height: webcamHeight };
  }

  // Keep the stable centre of gravity in the largest full-height rectangle
  // beside the PiP. This costs less attention than changing the usable shape
  // above and below the webcam as objects move vertically.
  let safeBounds: CompositionRect = {
    x: margins.left,
    y: margins.top,
    width: Math.max(1, width - margins.left - margins.right),
    height: Math.max(1, height - margins.top - margins.bottom),
  };
  if (webcamBounds) {
    if (webcam.position.endsWith("right")) {
      safeBounds.width = Math.max(1, webcamBounds.x - webcam.gap - safeBounds.x);
    } else {
      const right = safeBounds.x + safeBounds.width;
      safeBounds.x = webcamBounds.x + webcamBounds.width + webcam.gap;
      safeBounds.width = Math.max(1, right - safeBounds.x);
    }
  }
  return { width, height, safeBounds, webcamBounds, config };
}

export function initialCompositionState(): CompositionState {
  return {
    focalSubject: "",
    activeCluster: "page:0",
    camera: { scrollX: 0, scrollY: 0, zoom: 1 },
    lastMovementAt: -Infinity,
    movementCount: 0,
    cancelledMovementCount: 0,
  };
}

export function rectUnion(rectangles: CompositionRect[]): CompositionRect | null {
  if (!rectangles.length) return null;
  const left = Math.min(...rectangles.map((rect) => rect.x));
  const top = Math.min(...rectangles.map((rect) => rect.y));
  const right = Math.max(...rectangles.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rectangles.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function rectsOverlap(a: CompositionRect, b: CompositionRect, padding = 0): boolean {
  return a.x < b.x + b.width + padding && a.x + a.width + padding > b.x &&
    a.y < b.y + b.height + padding && a.y + a.height + padding > b.y;
}

export function worldToScreen(rect: CompositionRect, camera: CameraView): CompositionRect {
  return {
    x: (rect.x + camera.scrollX) * camera.zoom,
    y: (rect.y + camera.scrollY) * camera.zoom,
    width: rect.width * camera.zoom,
    height: rect.height * camera.zoom,
  };
}

export function rectInside(inner: CompositionRect, outer: CompositionRect, tolerance = 1): boolean {
  return inner.x >= outer.x - tolerance && inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance;
}

/** Raw Excalidraw app-state scroll/zoom, in the shape `getAppState()` returns. */
export interface LiveFollowViewport {
  scrollX: number;
  scrollY: number;
  zoom: number;
  width: number;
  height: number;
}

/**
 * Live Speech Presentation V2's camera contract (see
 * docs/LIVE-SPEECH-PRESENTATION-V2.md): while a thought is actively growing,
 * the camera may only be asked to follow it once it is genuinely about to
 * leave the visible viewport — not on every interim. This is the pure
 * containment check components/Board.tsx's writeLive calls to decide that;
 * extracted here (rather than left inline) purely so the invariant is
 * unit-testable without mounting Board. proposeCamera still owns the actual
 * move decision/hysteresis — this only decides whether to ask it at all.
 */
export function liveLineFitsViewport(
  line: CompositionRect,
  viewport: LiveFollowViewport,
  margin = 48,
): boolean {
  const zoom = viewport.zoom || 1;
  const viewW = viewport.width / zoom;
  const viewH = viewport.height / zoom;
  if (viewW <= 0 || viewH <= 0) return false;
  const visible: CompositionRect = {
    x: -viewport.scrollX + margin,
    y: -viewport.scrollY + margin,
    width: viewW - margin * 2,
    height: viewH - margin * 2,
  };
  return rectInside(line, visible, 0);
}

export function effectiveTextSize(fontSize: number, zoom: number, outputScale = 1): number {
  return Math.round(fontSize * zoom * outputScale * 10) / 10;
}

export function readabilityViolations(text: TextReadabilitySample[], zoom: number): string[] {
  return text
    .filter((sample) => effectiveTextSize(sample.fontSize, zoom) < READABILITY_CONTRACT[sample.role])
    .map((sample) => sample.id);
}

export function minimumReadableZoom(text: TextReadabilitySample[]): number {
  return text.reduce((minimum, sample) =>
    Math.max(minimum, READABILITY_CONTRACT[sample.role] / Math.max(1, sample.fontSize)), 0);
}

function cameraFor(bounds: CompositionRect, safe: CompositionRect, zoom: number): CameraView {
  const worldCenterX = bounds.x + bounds.width / 2;
  const worldCenterY = bounds.y + bounds.height / 2;
  const screenCenterX = safe.x + safe.width / 2;
  const screenCenterY = safe.y + safe.height / 2;
  return {
    zoom,
    scrollX: screenCenterX / zoom - worldCenterX,
    scrollY: screenCenterY / zoom - worldCenterY,
  };
}

function distancePx(a: CameraView, b: CameraView): number {
  return Math.hypot((a.scrollX - b.scrollX) * b.zoom, (a.scrollY - b.scrollY) * b.zoom);
}

export function occupiedCanvasRatio(bounds: CompositionRect, safe: CompositionRect, zoom: number): number {
  const occupied = Math.min(bounds.width * zoom, safe.width) * Math.min(bounds.height * zoom, safe.height);
  return Math.round(clamp(occupied / Math.max(1, safe.width * safe.height), 0, 1) * 1000) / 1000;
}

const CAMERA_FIT_PADDING = 28;

/** The zoom that would let `bounds` fit inside `safe`, before any readability floor is applied. */
function fitZoomFor(bounds: CompositionRect, safe: CompositionRect): number {
  return Math.min(
    CAMERA_RULES.maximumZoom,
    safe.width / Math.max(1, bounds.width + CAMERA_FIT_PADDING * 2),
    safe.height / Math.max(1, bounds.height + CAMERA_FIT_PADDING * 2),
  );
}

export function proposeCamera(input: CameraProposalInput): CameraProposal {
  const combinedBounds = input.contextBounds
    ? rectUnion([input.focalBounds, input.contextBounds]) ?? input.focalBounds
    : input.focalBounds;
  const readableZoom = minimumReadableZoom(input.text ?? []);
  // contextBounds is optional nearby context, included only if the union
  // still fits at a readable zoom. If honouring it would force zoom below
  // the readability floor, drop it and frame just the active content —
  // completed history sitting outside the frame is not a failure the way
  // the ACTIVE content becoming unreadable is. Without this, a caller that
  // keeps passing "everything on the page" as contextBounds (as Board.tsx's
  // math commits used to pass it as the sole focalBounds) permanently
  // outgrows the readable floor as content accumulates, and since zoom
  // never goes below that floor, contentFits stays false forever with a
  // frozen target — reproduced on real replay output (9 consecutive
  // commits, occupiedCanvasRatio climbing 0.10 -> 0.84, target frozen).
  const bounds = input.contextBounds && fitZoomFor(combinedBounds, input.viewport.safeBounds) < readableZoom
    ? input.focalBounds
    : combinedBounds;
  const currentScreenBounds = worldToScreen(bounds, input.currentCamera);
  const fitsNow = rectInside(currentScreenBounds, input.viewport.safeBounds);
  const webcamCollisions = input.viewport.webcamBounds &&
    rectsOverlap(currentScreenBounds, input.viewport.webcamBounds) ? 1 : 0;
  const currentViolations = readabilityViolations(input.text ?? [], input.currentCamera.zoom);
  const navigationRequired = input.primarySubjectChanged || input.explicitNavigation || input.followMovingSubject;

  if (fitsNow && webcamCollisions === 0 && currentViolations.length === 0 && !navigationRequired) {
    const minText = (input.text ?? []).length
      ? Math.min(...(input.text ?? []).map((sample) => effectiveTextSize(sample.fontSize, input.currentCamera.zoom)))
      : Infinity;
    return {
      move: false,
      target: input.currentCamera,
      reason: "routine addition already fits the recording-safe frame",
      state: {
        ...input.state,
        focalSubject: input.focalSubject || input.state.focalSubject,
        activeCluster: input.activeCluster,
        camera: input.currentCamera,
        proposedTarget: undefined,
        movementReason: undefined,
      },
      safeFrame: input.viewport.safeBounds,
      effectiveTextSize: minText,
      readabilityViolations: currentViolations,
      contentFits: true,
      webcamCollisions: 0,
      occupiedCanvasRatio: occupiedCanvasRatio(bounds, input.viewport.safeBounds, input.currentCamera.zoom),
    };
  }

  const fitZoom = fitZoomFor(bounds, input.viewport.safeBounds);
  // readableZoom was already computed above, against the (possibly
  // context-dropped) `bounds` decision — reused here rather than recomputed.
  // Zoom actually needs to change to fix one of these — explicit navigation
  // alone (recentering on already-fitting content) is not this: that case
  // should keep the hysteresis snap, per "small zoom difference is held by
  // hysteresis" below.
  const zoomCorrectionRequired = !fitsNow || webcamCollisions > 0 || currentViolations.length > 0;
  const urgent = zoomCorrectionRequired || Boolean(input.explicitNavigation);
  // Readability wins over showing more things. If both cannot be achieved,
  // callers receive contentFits=false and can suppress/summarize/delay.
  let zoom = Math.max(fitZoom, readableZoom);
  // Hysteresis exists to stop cosmetic micro-adjustments, not to veto a
  // correction that's actually needed. Snapping back to the current zoom
  // when content doesn't fit reproduces the exact bug this guards against:
  // the target zoom differs from current by less than zoomHysteresis, so it
  // gets discarded, the camera never corrects, and every subsequent frame
  // proposes the identical (still-too-small) delta forever — "Camera zoom
  // failure prevents visibility" logged on repeat at a fixed zoom/scroll.
  if (!zoomCorrectionRequired && Math.abs(zoom - input.currentCamera.zoom) < CAMERA_RULES.zoomHysteresis) {
    zoom = input.currentCamera.zoom;
  }
  const maximumZoomChange = input.maximumZoomChange ?? CAMERA_RULES.maximumZoomChange;
  zoom = clamp(
    zoom,
    Math.max(0.1, input.currentCamera.zoom - maximumZoomChange),
    Math.min(CAMERA_RULES.maximumZoom, input.currentCamera.zoom + maximumZoomChange),
  );
  const target = cameraFor(bounds, input.viewport.safeBounds, zoom);
  const displacement = distancePx(input.currentCamera, target);
  const zoomDelta = Math.abs(input.currentCamera.zoom - target.zoom);
  const meaningful = displacement >= CAMERA_RULES.minimumDisplacementPx || zoomDelta >= CAMERA_RULES.zoomHysteresis;
  const coolingDown = input.now - input.state.lastMovementAt < CAMERA_RULES.cooldownMs;
  // An urgent correction (content doesn't fit, readability violated, webcam
  // collision, explicit navigation) must not be gated by the
  // meaningful-displacement threshold — that threshold exists to suppress
  // cosmetic jitter, not to block a fix the frame actually needs. Previously
  // `meaningful && (!coolingDown || urgent)` still required `meaningful` even
  // when urgent, so a small-but-necessary correction (e.g. a few percent of
  // zoom) was silently dropped every frame and contentFits stayed false
  // indefinitely.
  const move = urgent || (meaningful && !coolingDown && !input.manualPriorityActive);
  const finalTarget = move ? target : input.currentCamera;
  const finalScreen = worldToScreen(bounds, finalTarget);
  const violations = readabilityViolations(input.text ?? [], finalTarget.zoom);
  const contentFits = rectInside(finalScreen, input.viewport.safeBounds) &&
    !(input.viewport.webcamBounds && rectsOverlap(finalScreen, input.viewport.webcamBounds));
  const minText = (input.text ?? []).length
    ? Math.min(...(input.text ?? []).map((sample) => effectiveTextSize(sample.fontSize, finalTarget.zoom)))
    : Infinity;

  return {
    move,
    target: finalTarget,
    reason: move
      ? input.reason
      : coolingDown
        ? "camera movement held by cooldown"
        : input.manualPriorityActive
          ? "recent manual pan/zoom holds routine recentering"
          : "proposed movement was below the meaningful-displacement threshold",
    state: {
      ...input.state,
      focalSubject: input.focalSubject || input.state.focalSubject,
      activeCluster: input.activeCluster,
      camera: finalTarget,
      proposedTarget: move ? target : undefined,
      movementReason: move ? input.reason : undefined,
      lastMovementAt: move ? input.now : input.state.lastMovementAt,
      movementCount: input.state.movementCount + (move ? 1 : 0),
    },
    safeFrame: input.viewport.safeBounds,
    effectiveTextSize: minText,
    readabilityViolations: violations,
    contentFits,
    webcamCollisions: input.viewport.webcamBounds && rectsOverlap(finalScreen, input.viewport.webcamBounds) ? 1 : 0,
    occupiedCanvasRatio: occupiedCanvasRatio(bounds, input.viewport.safeBounds, finalTarget.zoom),
  };
}
