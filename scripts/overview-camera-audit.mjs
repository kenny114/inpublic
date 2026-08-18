import fs from "node:fs";
import path from "node:path";
import {
  pageArrivalPairs,
  proposalStartsAnimation,
  replayCameraProposal,
} from "../lib/cameraReplay.ts";

const inputFiles = process.argv.slice(2);
if (!inputFiles.length) throw new Error("Pass one or more exported replay JSON files.");

const round = (value, places = 3) => value == null ? null : Number(value.toFixed(places));
const median = (values) => {
  const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const transformPoint = (camera) => ({ x: camera.scrollX * camera.zoom, y: camera.scrollY * camera.zoom });
const vector = (from, to) => {
  const a = transformPoint(from);
  const b = transformPoint(to);
  return { x: b.x - a.x, y: b.y - a.y };
};
const magnitude = (item) => Math.hypot(item.x, item.y);
const angle = (a, b) => {
  const denominator = magnitude(a) * magnitude(b);
  if (!denominator) return null;
  return Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / denominator))) * 180 / Math.PI;
};
const timeBucket = (ms) => {
  if (ms == null) return "none";
  if (ms < 100) return "<100 ms";
  if (ms < 250) return "100-250 ms";
  if (ms < 500) return "250-500 ms";
  if (ms < 1_000) return "500 ms-1 s";
  if (ms < 2_000) return "1-2 s";
  if (ms < 4_000) return "2-4 s";
  return "4+ s";
};
const dwellBucket = (ms) => {
  if (ms == null) return "session end";
  if (ms < 250) return "no useful dwell";
  if (ms < 750) return "very short";
  if (ms < 1_500) return "short";
  if (ms < 3_000) return "usable";
  return "stable";
};
const countBy = (items, selector) => Object.fromEntries(
  [...Map.groupBy(items, selector)].map(([key, values]) => [key, values.length]),
);

function lifecycleFor(events, proposal) {
  const start = events.find((event) => event.type === "camera" && event.event === "started" && event.proposalId === proposal.eventId);
  if (!start) return { start: null, terminal: null };
  const terminal = events.find((event) => event.type === "camera"
    && event.animationId === start.animationId
    && (event.event === "completed" || event.event === "cancelled")
    && event.t >= start.t);
  return { start, terminal: terminal ?? null };
}

function analyzeRun(run, sourceFile) {
  const events = run.events ?? [];
  const proposals = events.filter((event) => event.type === "camera-proposal");
  const overviewProposals = proposals.filter((proposal) => proposal.proposalKind === "overview");
  const coalescedPageIds = new Set(pageArrivalPairs(proposals).map(({ page }) => page.eventId));
  const lifecycle = events.filter((event) => event.type === "camera");
  const recordedCompletions = lifecycle.filter((event) => event.event === "completed").length;
  const recordedCancellations = lifecycle.filter((event) => event.event === "cancelled").length;
  const pageArrivalCancellations = lifecycle.filter((event) => event.event === "cancelled" && coalescedPageIds.has(event.proposalId)).length;
  const productionStarts = proposals.filter((proposal) => !coalescedPageIds.has(proposal.eventId) && proposalStartsAnimation(proposal));
  const cameraStarts = events.filter((event) => event.type === "camera" && event.event === "started");
  const settledThoughts = events.filter((event) => event.type === "settled-thought");
  const liveUpdates = events.filter((event) => event.type === "v2"
    && (event.event === "camera-follow-allowed" || event.event === "camera-follow-skipped"));

  const inventory = overviewProposals.map((proposal) => {
    const result = replayCameraProposal(proposal);
    const { start, terminal } = lifecycleFor(events, proposal);
    const afterT = start?.t ?? proposal.t;
    const nextLiveUpdate = liveUpdates.find((event) => event.t > afterT);
    const previousLiveUpdate = liveUpdates.findLast((event) => event.t <= proposal.t);
    const nextLiveProposal = proposals.find((item) => item.t > afterT && item.proposalKind === "live_follow");
    const nextStart = cameraStarts.find((event) => event.t > afterT && event.proposalId !== proposal.eventId);
    const nextThought = settledThoughts.find((event) => event.t > afterT);
    const previousThought = settledThoughts.findLast((event) => event.t <= proposal.t);
    const completionT = terminal?.event === "completed" ? terminal.t : null;
    const nextMovementAfterCompletion = completionT == null
      ? null
      : cameraStarts.find((event) => event.t > completionT && event.proposalId !== proposal.eventId) ?? null;
    const followingProposal = nextStart?.proposalId
      ? proposals.find((item) => item.eventId === nextStart.proposalId) ?? null
      : null;
    const followingResult = followingProposal ? replayCameraProposal(followingProposal) : null;
    const actualOverviewEndpoint = terminal?.event === "completed"
      ? result.target
      : terminal?.event === "cancelled" && followingProposal
        ? followingProposal.input.currentCamera
        : null;
    const overviewVector = actualOverviewEndpoint
      ? vector(proposal.input.currentCamera, actualOverviewEndpoint)
      : null;
    const intendedOverviewVector = vector(proposal.input.currentCamera, result.target);
    const followingVector = actualOverviewEndpoint && followingResult
      ? vector(actualOverviewEndpoint, followingResult.target)
      : null;
    const relationshipAngle = followingVector ? angle(overviewVector, followingVector) : null;
    const overviewDistance = overviewVector ? magnitude(overviewVector) : null;
    const intendedOverviewDistance = magnitude(intendedOverviewVector);
    const followingDistance = followingVector ? magnitude(followingVector) : null;
    const priorToFollowing = followingResult ? vector(proposal.input.currentCamera, followingResult.target) : null;
    const netDistance = priorToFollowing ? magnitude(priorToFollowing) : null;
    const totalDistance = followingDistance == null ? null : overviewDistance + followingDistance;
    const wastedDistance = totalDistance == null || netDistance == null ? null : Math.max(0, totalDistance - netDistance);
    const oppositeProjection = followingVector && overviewDistance
      ? Math.max(0, -(followingVector.x * overviewVector.x + followingVector.y * overviewVector.y) / overviewDistance)
      : 0;
    const returnRatio = overviewDistance ? oppositeProjection / overviewDistance : 0;
    let relationship = "none";
    if (relationshipAngle != null) {
      if (relationshipAngle < 60) relationship = "same-direction continuation";
      else if (relationshipAngle <= 120) relationship = "orthogonal reframe";
      else if (relationshipAngle >= 135 && returnRatio >= 0.5) relationship = "strong reversal";
      else relationship = "partial reversal";
    }
    const usableDwellMs = completionT == null || !nextMovementAfterCompletion
      ? null
      : nextMovementAfterCompletion.t - completionT;
    const liveWithin250 = nextLiveProposal ? nextLiveProposal.t - afterT < 250 : false;
    const liveWithin1000 = nextLiveProposal ? nextLiveProposal.t - afterT < 1_000 : false;

    return {
      id: proposal.eventId,
      timeMs: proposal.t,
      page: proposal.pageIndex,
      thought: previousThought ? { id: previousThought.thoughtId, settledAtMs: previousThought.t, text: previousThought.text } : null,
      speech: {
        previousLiveUpdateMs: previousLiveUpdate ? proposal.t - previousLiveUpdate.t : null,
        nextLiveUpdateMs: nextLiveUpdate ? nextLiveUpdate.t - afterT : null,
        nextLiveProposalMs: nextLiveProposal ? nextLiveProposal.t - afterT : null,
      },
      target: result.target,
      from: proposal.input.currentCamera,
      movementPx: round(overviewDistance),
      intendedMovementPx: round(intendedOverviewDistance),
      started: Boolean(start),
      completed: terminal?.event === "completed",
      cancelled: terminal?.event === "cancelled",
      terminalMs: terminal ? terminal.t - start.t : null,
      nextCameraStartMs: nextStart ? nextStart.t - afterT : null,
      nextSettledThoughtMs: nextThought ? nextThought.t - afterT : null,
      completionToNextMovementMs: usableDwellMs,
      dwellClass: completionT == null ? "not completed" : usableDwellMs == null ? "right-censored" : dwellBucket(usableDwellMs),
      nextCamera: followingProposal ? { id: followingProposal.eventId, kind: followingProposal.proposalKind, timeMs: nextStart.t - afterT } : null,
      geometry: {
        relationship,
        angleDeg: round(relationshipAngle),
        followingMovementPx: round(followingDistance),
        totalMotionPx: round(totalDistance),
        netChangePx: round(netDistance),
        wastedMotionPx: round(wastedDistance),
        returnRatio: round(returnRatio),
      },
      liveWithin250,
      liveWithin1000,
      focalBounds: proposal.input.focalBounds,
      textSamples: proposal.input.text?.length ?? 0,
      contentFits: result.contentFits,
      webcamCollisions: result.webcamCollisions,
      readabilityViolations: result.readabilityViolations,
    };
  });

  const overviewStarts = inventory.filter((item) => item.started);
  const completions = inventory.filter((item) => item.completed);
  const overviewDistance = overviewStarts.reduce((sum, item) => sum + item.movementPx, 0);
  const intendedOverviewDistance = overviewStarts.reduce((sum, item) => sum + item.intendedMovementPx, 0);
  const productionIntendedDistance = productionStarts.reduce((sum, proposal) => {
    const result = replayCameraProposal(proposal);
    return sum + magnitude(vector(proposal.input.currentCamera, result.target));
  }, 0);
  const lowDwellReversals = inventory.filter((item) => item.completed
    && item.completionToNextMovementMs < 750
    && (item.geometry.relationship === "strong reversal" || item.geometry.relationship === "partial reversal")
    && item.nextCamera?.kind !== "page_turn");

  return {
    sourceFile,
    session: path.basename(run.audio?.name ?? "unknown"),
    durationMs: run.audio?.durationMs ?? null,
    totals: {
      proposals: overviewProposals.length,
      starts: overviewStarts.length,
      completions: completions.length,
      cancellations: inventory.filter((item) => item.cancelled).length,
      followedByLiveWithin250: inventory.filter((item) => item.liveWithin250).length,
      followedByLiveWithin1000: inventory.filter((item) => item.liveWithin1000).length,
      strongReversals: inventory.filter((item) => item.geometry.relationship === "strong reversal" && item.nextCamera?.kind !== "page_turn").length,
      partialReversals: inventory.filter((item) => item.geometry.relationship === "partial reversal" && item.nextCamera?.kind !== "page_turn").length,
      medianCompletedDwellMs: round(median(completions.map((item) => item.completionToNextMovementMs))),
      overviewMovementPx: round(overviewDistance),
      intendedOverviewMovementPx: round(intendedOverviewDistance),
      lowDwellReversalWastedPx: round(lowDwellReversals.reduce((sum, item) => sum + item.geometry.wastedMotionPx, 0)),
    },
    timeToNextLiveUpdate: countBy(overviewStarts, (item) => timeBucket(item.speech.nextLiveUpdateMs)),
    timeToNextLiveProposal: countBy(overviewStarts, (item) => timeBucket(item.speech.nextLiveProposalMs)),
    effectiveReadingTime: countBy(completions, (item) => item.dwellClass),
    counterfactual: {
      currentProductionStarts: productionStarts.length,
      noOverviewStarts: productionStarts.length - overviewStarts.length,
      startsRemoved: overviewStarts.length,
      currentProductionCompletions: recordedCompletions,
      noOverviewCompletions: recordedCompletions - completions.length,
      currentProductionCancellations: recordedCancellations - pageArrivalCancellations,
      noOverviewCancellations: recordedCancellations - pageArrivalCancellations - inventory.filter((item) => item.cancelled).length,
      directlyRemovedOverviewDistancePx: round(overviewDistance),
      currentIntendedMovementPx: round(productionIntendedDistance),
      noOverviewIntendedMovementPx: round(productionIntendedDistance - intendedOverviewDistance),
      intendedMovementRemovedPx: round(intendedOverviewDistance),
      activeLineFitFailures: productionStarts.filter((proposal) => proposal.proposalKind === "live_follow")
        .filter((proposal) => {
          const result = replayCameraProposal(proposal);
          return !result.contentFits || result.webcamCollisions > 0 || result.readabilityViolations.length > 0;
        }).length,
      pageArrivalPairs: pageArrivalPairs(proposals).length,
    },
    inventory,
  };
}

const sessions = inputFiles.flatMap((file) => {
  const report = JSON.parse(fs.readFileSync(file, "utf8"));
  return (report.runs ?? []).map((run) => analyzeRun(run, file));
});

const all = sessions.flatMap((session) => session.inventory);
const completed = all.filter((item) => item.completed);
const totals = {
  sessions: sessions.length,
  proposals: all.length,
  starts: all.filter((item) => item.started).length,
  completions: completed.length,
  cancellations: all.filter((item) => item.cancelled).length,
  followedByLiveWithin250: all.filter((item) => item.liveWithin250).length,
  followedByLiveWithin1000: all.filter((item) => item.liveWithin1000).length,
  strongReversals: all.filter((item) => item.geometry.relationship === "strong reversal" && item.nextCamera?.kind !== "page_turn").length,
  partialReversals: all.filter((item) => item.geometry.relationship === "partial reversal" && item.nextCamera?.kind !== "page_turn").length,
  medianCompletedDwellMs: round(median(completed.map((item) => item.completionToNextMovementMs))),
  overviewMovementPx: round(all.filter((item) => item.started).reduce((sum, item) => sum + item.movementPx, 0)),
  wastedReversalMotionPx: round(all.filter((item) => item.nextCamera?.kind !== "page_turn"
    && (item.geometry.relationship === "strong reversal" || item.geometry.relationship === "partial reversal"))
    .reduce((sum, item) => sum + (item.geometry.wastedMotionPx ?? 0), 0)),
  timeToNextLiveUpdate: countBy(all.filter((item) => item.started), (item) => timeBucket(item.speech.nextLiveUpdateMs)),
  timeToNextLiveProposal: countBy(all.filter((item) => item.started), (item) => timeBucket(item.speech.nextLiveProposalMs)),
  effectiveReadingTime: countBy(completed, (item) => item.dwellClass),
};

console.log(JSON.stringify({ sessions, totals }, null, 2));
