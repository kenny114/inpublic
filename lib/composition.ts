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
  transitionMs: 420,
} as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

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
  zoom = clamp(
    zoom,
    Math.max(0.1, input.currentCamera.zoom - CAMERA_RULES.maximumZoomChange),
    Math.min(CAMERA_RULES.maximumZoom, input.currentCamera.zoom + CAMERA_RULES.maximumZoomChange),
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
  const move = urgent || (meaningful && !coolingDown);
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
