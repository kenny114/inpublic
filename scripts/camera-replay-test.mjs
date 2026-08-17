import assert from "node:assert/strict";
import {
  compareCameraDecision,
  pageArrivalPairs,
  replayCameraPolicy,
  replayCameraProposal,
  replayCameraSpring,
} from "../lib/cameraReplay.ts";
import { initialCompositionState, proposeCamera, recordingViewport } from "../lib/composition.ts";
import { samePageArrivalTransition } from "../lib/pageArrivalCoalescing.ts";

const viewport = recordingViewport(1200, 700);
const baseCamera = { scrollX: 0, scrollY: 0, zoom: 1 };

function snapshot(overrides = {}) {
  const input = {
    state: initialCompositionState(),
    viewport,
    currentCamera: baseCamera,
    focalBounds: { x: 100, y: 100, width: 300, height: 80 },
    focalSubject: "live narration",
    activeCluster: "live:0:line",
    reason: "following live narration",
    now: 10_000,
    text: [{ id: "line", fontSize: 26, role: "primary" }],
    followMovingSubject: true,
    ...overrides.input,
  };
  return {
    version: 1,
    eventId: overrides.eventId ?? "p1",
    t: overrides.t ?? 100,
    capturedAtPerf: overrides.capturedAtPerf ?? 100,
    proposalKind: overrides.proposalKind ?? "live_follow",
    pageIndex: overrides.pageIndex ?? 0,
    pageGeneration: overrides.pageGeneration ?? 0,
    pageBounds: overrides.pageBounds ?? { x: 0, y: 0, width: 1160, height: 760 },
    transitionId: overrides.transitionId,
    eventCycleId: overrides.eventCycleId,
    firstLiveAfterPageTurn: overrides.firstLiveAfterPageTurn ?? false,
    input,
    spring: overrides.spring ?? null,
    recorded: proposeCamera(structuredClone(input)),
  };
}

// 1. Identical snapshots produce identical decisions.
{
  const item = snapshot();
  assert.deepEqual(replayCameraProposal(item), replayCameraProposal(item));
}

// 2. Current-policy replay reproduces the captured decision and target.
{
  const match = compareCameraDecision(snapshot());
  assert.deepEqual(match, { decision: true, target: true, reason: true, contentFit: true, exact: true });
}

// 3. Cooldown uses only the frozen input clock.
{
  const state = { ...initialCompositionState(), lastMovementAt: 9_500 };
  const held = snapshot({ input: { state, now: 10_000, primarySubjectChanged: true, followMovingSubject: false } });
  const released = snapshot({ input: { state, now: 10_500, primarySubjectChanged: true, followMovingSubject: false } });
  assert.equal(replayCameraProposal(held).move, false);
  assert.equal(replayCameraProposal(released).move, true);
}

// 4. In-flight spring state is reconstructable at a frozen timestamp.
{
  const spring = {
    camera: { scrollX: 10, scrollY: -20, zoom: 1 },
    velocity: { scrollX: 15, scrollY: -5, zoom: 0.01 },
    target: { scrollX: 300, scrollY: 180, zoom: 1.08 },
    lastFrameAt: 1_000,
    animationId: "a1",
    reason: "following live narration",
  };
  assert.deepEqual(replayCameraSpring(spring, 1_016), replayCameraSpring(spring, 1_016));
  assert.notDeepEqual(replayCameraSpring(spring, 1_016).camera, spring.camera);
}

const transition = "page-arrival-1-page-1";
const eventCycleId = 7;
const secondPageBounds = { x: 1260, y: 0, width: 1160, height: 760 };
const page = snapshot({
  eventId: "page",
  t: 1_000,
  proposalKind: "page_turn",
  pageIndex: 1,
  pageGeneration: 1,
  pageBounds: secondPageBounds,
  transitionId: transition,
  eventCycleId,
  input: {
    focalBounds: { x: 1260, y: 0, width: 1160, height: 760 },
    activeCluster: "page:1",
    focalSubject: "page",
    reason: "page turn: long-utterance",
    explicitNavigation: true,
    primarySubjectChanged: true,
    followMovingSubject: false,
  },
});
const live = snapshot({
  eventId: "live",
  t: 1_000,
  proposalKind: "live_follow",
  pageIndex: 1,
  pageGeneration: 1,
  pageBounds: secondPageBounds,
  transitionId: transition,
  eventCycleId,
  firstLiveAfterPageTurn: true,
  input: {
    focalBounds: { x: 1400, y: 120, width: 500, height: 120 },
    activeCluster: "live:1:line",
  },
});

// 5-12. Production Page Arrival Coalescing V1 acceptance matrix.
{
  const identity = { transitionId: transition, pageGeneration: 1, pageIndex: 1, eventCycleId };
  assert.equal(samePageArrivalTransition(identity, { ...identity }), true, "same identity/cycle coalesces");
  assert.equal(pageArrivalPairs([page, live]).length, 1, "same page generation/id/cycle pairs");

  const differentGeneration = { ...live, eventId: "different-generation", pageGeneration: 2 };
  assert.equal(pageArrivalPairs([page, differentGeneration]).length, 0, "different page generation does not coalesce");

  const differentTransition = { ...live, eventId: "different-transition", transitionId: "page-arrival-other" };
  assert.equal(pageArrivalPairs([page, differentTransition]).length, 0, "different transition id does not coalesce");

  const later = { ...live, eventId: "later", t: 5_000, eventCycleId: eventCycleId + 1 };
  assert.equal(pageArrivalPairs([page, later]).length, 0, "later event cycle does not coalesce");

  assert.equal(replayCameraPolicy([page], "page_arrival_coalescing_v1").starts, 1, "page target without live executes");
  assert.equal(replayCameraPolicy([live], "page_arrival_coalescing_v1").starts, 1, "live target without page executes");

  const current = replayCameraPolicy([page, live], "current");
  const coalesced = replayCameraPolicy([page, live], "page_arrival_coalescing_v1");
  const production = replayCameraPolicy([page, live], "production_page_arrival_v1");
  assert.equal(current.starts, 2);
  assert.equal(coalesced.starts, 1, "one lifecycle start is emitted");
  assert.equal(current.sameTransitionCancellations, 1);
  assert.equal(coalesced.sameTransitionCancellations, 0);
  assert.equal(coalesced.activeLineFailures, 0, "safe-frame/readability behavior is unchanged");
  assert.equal(coalesced.pageFitFailures, 0, "new page remains visible");
  assert.deepEqual(coalesced.finalTargets, current.finalTargets, "retained target equals live target");
  assert.deepEqual(production, coalesced, "production policy equals the offline regression oracle");
  assert.equal(coalesced.finalTargets[0].target.zoom, live.recorded.target.zoom, "zoom is unchanged");
  assert.equal(replayCameraProposal(live).webcamCollisions, live.recorded.webcamCollisions, "webcam handling is unchanged");

  const structural = snapshot({ eventId: "structural", proposalKind: "structural", transitionId: undefined, eventCycleId: undefined });
  assert.deepEqual(replayCameraProposal(structural), structural.recorded, "non-page proposal is unchanged");
}

// 8. Replay never mutates proposal inputs.
{
  const item = snapshot();
  const before = structuredClone(item);
  replayCameraProposal(item);
  replayCameraPolicy([item], "page_arrival_coalescing_v1");
  assert.deepEqual(item, before);
}

console.log("camera replay: 12 deterministic Page Arrival Coalescing checks passed");
