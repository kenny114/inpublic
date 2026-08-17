import {
  proposeCamera,
  rectsOverlap,
  stepCameraSpring,
  worldToScreen,
  type CameraProposal,
  type CameraProposalInput,
  type CameraVelocity,
  type CameraView,
  type CompositionRect,
} from "./composition";
import { samePageArrivalTransition, type PageArrivalIdentity } from "./pageArrivalCoalescing";

export const CAMERA_PROPOSAL_SNAPSHOT_VERSION = 1 as const;

export type CameraProposalKind = "page_turn" | "live_follow" | "overview" | "structural";

export interface CameraSpringSnapshot {
  camera: CameraView;
  velocity: CameraVelocity;
  target: CameraView;
  lastFrameAt: number;
  animationId: string;
  reason: string;
}

/**
 * The exact pure-policy boundary plus the small amount of browser animation
 * state needed to explain a proposal made while another move is in flight.
 * Development telemetry only; production camera decisions do not consume it.
 */
export interface CameraProposalSnapshot {
  version: typeof CAMERA_PROPOSAL_SNAPSHOT_VERSION;
  eventId: string;
  t: number;
  /** Monotonic browser clock at the pure-policy boundary. */
  capturedAtPerf: number;
  proposalKind: CameraProposalKind;
  pageIndex: number;
  pageGeneration: number;
  pageBounds: CompositionRect;
  transitionId?: string;
  eventCycleId?: number;
  firstLiveAfterPageTurn: boolean;
  input: CameraProposalInput;
  spring: CameraSpringSnapshot | null;
  recorded: CameraProposal;
}

export interface CameraDecisionMatch {
  decision: boolean;
  target: boolean;
  reason: boolean;
  contentFit: boolean;
  exact: boolean;
}

export interface PageArrivalPair {
  transitionId: string;
  page: CameraProposalSnapshot;
  live: CameraProposalSnapshot;
}

const clone = <T>(value: T): T => structuredClone(value);
const close = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;

export function replayCameraProposal(snapshot: CameraProposalSnapshot): CameraProposal {
  return proposeCamera(clone(snapshot.input));
}

/** Mirror animateCamera's final movement threshold after the pure proposal. */
export function proposalStartsAnimation(snapshot: CameraProposalSnapshot): boolean {
  const proposal = replayCameraProposal(snapshot);
  if (!proposal.move) return false;
  if (snapshot.spring) return true;
  const from = snapshot.input.currentCamera;
  return Math.abs(from.scrollX - proposal.target.scrollX) >= 0.5
    || Math.abs(from.scrollY - proposal.target.scrollY) >= 0.5
    || Math.abs(from.zoom - proposal.target.zoom) >= 0.001;
}

export function compareCameraDecision(
  snapshot: CameraProposalSnapshot,
  replayed = replayCameraProposal(snapshot),
  tolerance = 1e-9,
): CameraDecisionMatch {
  const expected = snapshot.recorded;
  const target = close(expected.target.scrollX, replayed.target.scrollX, tolerance)
    && close(expected.target.scrollY, replayed.target.scrollY, tolerance)
    && close(expected.target.zoom, replayed.target.zoom, tolerance);
  const decision = expected.move === replayed.move;
  const reason = expected.reason === replayed.reason;
  const contentFit = expected.contentFits === replayed.contentFits
    && expected.webcamCollisions === replayed.webcamCollisions
    && expected.readabilityViolations.join("\u0000") === replayed.readabilityViolations.join("\u0000");
  return { decision, target, reason, contentFit, exact: decision && target && reason && contentFit };
}

/** Reconstruct a recorded spring at any later frozen-clock timestamp. */
export function replayCameraSpring(snapshot: CameraSpringSnapshot, at: number) {
  return stepCameraSpring(
    clone(snapshot.camera),
    clone(snapshot.target),
    clone(snapshot.velocity),
    Math.max(0, at - snapshot.lastFrameAt),
  );
}

/**
 * The narrow identity used by Page Arrival Coalescing V1: the page proposal
 * and exactly the first live proposal stamped by the same page generation.
 */
export function pageArrivalPairs(sequence: readonly CameraProposalSnapshot[]): PageArrivalPair[] {
  const pages = new Map<string, CameraProposalSnapshot>();
  const pairs: PageArrivalPair[] = [];
  for (const snapshot of sequence) {
    if (!snapshot.transitionId) continue;
    if (snapshot.proposalKind === "page_turn") {
      pages.set(snapshot.transitionId, snapshot);
      continue;
    }
    if (snapshot.proposalKind !== "live_follow" || !snapshot.firstLiveAfterPageTurn) continue;
    const page = pages.get(snapshot.transitionId);
    if (!page?.transitionId) continue;
    const pageIdentity: PageArrivalIdentity = {
      transitionId: page.transitionId,
      pageGeneration: page.pageGeneration,
      pageIndex: page.pageIndex,
      eventCycleId: page.eventCycleId ?? -1,
    };
    const liveIdentity: PageArrivalIdentity = {
      transitionId: snapshot.transitionId,
      pageGeneration: snapshot.pageGeneration,
      pageIndex: snapshot.pageIndex,
      eventCycleId: snapshot.eventCycleId ?? -1,
    };
    if (!samePageArrivalTransition(pageIdentity, liveIdentity)) continue;
    pairs.push({ transitionId: snapshot.transitionId, page, live: snapshot });
    pages.delete(snapshot.transitionId);
  }
  return pairs;
}

export interface CameraPolicyReplaySummary {
  proposals: number;
  starts: number;
  sameTransitionCancellations: number;
  pageArrivals: number;
  activeLineFailures: number;
  pageFitFailures: number;
  finalTargets: Array<{ transitionId: string; target: CameraView }>;
}

export interface FrozenCameraLifecycleEvent {
  t: number;
  event: "started" | "completed" | "cancelled";
  target: CameraView;
  animationId?: string;
  proposalId?: string;
  replacementAnimationId?: string;
}

export interface CameraLifecycleReplayMatch {
  expectedStarts: number;
  starts: number;
  completions: number;
  cancellations: number;
  matched: number;
  total: number;
  exact: boolean;
}

/**
 * Assert the retained lifecycle stream against decisions recomputed from the
 * frozen proposal stream. Lifecycle timestamps are inputs, never wall time.
 */
export function compareCameraLifecycle(
  sequence: readonly CameraProposalSnapshot[],
  lifecycle: readonly FrozenCameraLifecycleEvent[],
  tolerance = 1e-9,
): CameraLifecycleReplayMatch {
  const decisions = new Map(sequence.map((snapshot) => [snapshot.eventId, replayCameraProposal(snapshot)]));
  const expectedStartIds = new Set(sequence.filter(proposalStartsAnimation).map((snapshot) => snapshot.eventId));
  const recordedStartIds = new Set(lifecycle.flatMap((event) => event.event === "started" && event.proposalId ? [event.proposalId] : []));
  let active: { animationId: string; proposalId: string; target: CameraView } | null = null;
  let matched = 0;
  let starts = 0;
  let completions = 0;
  let cancellations = 0;
  const targetMatches = (a: CameraView, b: CameraView) => close(a.scrollX, b.scrollX, tolerance)
    && close(a.scrollY, b.scrollY, tolerance)
    && close(a.zoom, b.zoom, tolerance);

  for (const event of lifecycle) {
    let eventMatches = false;
    if (event.event === "started") {
      starts += 1;
      const decision = event.proposalId ? decisions.get(event.proposalId) : undefined;
      eventMatches = Boolean(event.animationId && event.proposalId && decision?.move && targetMatches(decision.target, event.target));
      if (event.animationId && event.proposalId) {
        active = { animationId: event.animationId, proposalId: event.proposalId, target: event.target };
      }
    } else if (event.event === "cancelled") {
      cancellations += 1;
      eventMatches = Boolean(active && event.animationId === active.animationId && targetMatches(active.target, event.target));
      active = null;
    } else {
      completions += 1;
      eventMatches = Boolean(active && event.animationId === active.animationId && targetMatches(active.target, event.target));
      active = null;
    }
    if (eventMatches) matched += 1;
  }
  const startsExact = expectedStartIds.size === recordedStartIds.size
    && [...expectedStartIds].every((proposalId) => recordedStartIds.has(proposalId));
  return {
    expectedStarts: expectedStartIds.size,
    starts,
    completions,
    cancellations,
    matched,
    total: lifecycle.length,
    exact: matched === lifecycle.length && startsExact,
  };
}

/**
 * Offline policy A/B. Coalescing removes only page target A; target B remains
 * the destination because it already passed the production live containment,
 * readability, webcam, and page-local focal-bound checks.
 */
export function replayCameraPolicy(
  sequence: readonly CameraProposalSnapshot[],
  policy: "current" | "page_arrival_coalescing_v1" | "production_page_arrival_v1",
): CameraPolicyReplaySummary {
  const pairs = pageArrivalPairs(sequence);
  const coalescedPageIds = policy !== "current"
    ? new Set(pairs.map((pair) => pair.page.eventId))
    : new Set<string>();
  let starts = 0;
  for (const snapshot of sequence) {
    if (coalescedPageIds.has(snapshot.eventId)) continue;
    if (proposalStartsAnimation(snapshot)) starts += 1;
  }
  const activeLineFailures = pairs.filter(({ live }) => {
    const result = replayCameraProposal(live);
    return !result.contentFits || result.webcamCollisions > 0 || result.readabilityViolations.length > 0;
  }).length;
  const pageFitFailures = pairs.filter(({ live }) => {
    const focal = live.input.focalBounds;
    const page = live.pageBounds;
    const target = replayCameraProposal(live).target;
    const focalBelongsToPage = !(focal.x < page.x || focal.y < page.y
      || focal.x + focal.width > page.x + page.width
      || focal.y + focal.height > page.y + page.height);
    return !focalBelongsToPage || !rectsOverlap(worldToScreen(page, target), live.input.viewport.safeBounds);
  }).length;
  return {
    proposals: sequence.length,
    starts,
    sameTransitionCancellations: policy === "current" ? pairs.filter(({ page, live }) => proposalStartsAnimation(page) && proposalStartsAnimation(live)).length : 0,
    pageArrivals: pairs.length,
    activeLineFailures,
    pageFitFailures,
    finalTargets: pairs.map(({ transitionId, live }) => ({ transitionId, target: replayCameraProposal(live).target })),
  };
}
