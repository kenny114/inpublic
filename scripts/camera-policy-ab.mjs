import fs from "node:fs";
import path from "node:path";
import {
  compareCameraDecision,
  compareCameraLifecycle,
  pageArrivalPairs,
  proposalStartsAnimation,
  replayCameraPolicy,
  replayCameraProposal,
} from "../lib/cameraReplay.ts";

const reports = process.argv.slice(2).map((file) => JSON.parse(fs.readFileSync(file, "utf8")));
const runs = reports.flatMap((report) => report.runs ?? []);
if (!runs.length) throw new Error("Pass one or more exported replay JSON files.");

const round = (value, places = 3) => Number(value.toFixed(places));
const pct = (part, whole) => whole ? round(part / whole * 100, 6) : 100;
const cameraDistance = (from, to) => Math.hypot(
  (from.scrollX - to.scrollX) * to.zoom,
  (from.scrollY - to.scrollY) * to.zoom,
);
const sameTarget = (a, b, tolerance = 1e-9) => Math.abs(a.scrollX - b.scrollX) <= tolerance
  && Math.abs(a.scrollY - b.scrollY) <= tolerance
  && Math.abs(a.zoom - b.zoom) <= tolerance;

const sessions = runs.map((run) => {
  const events = run.events ?? [];
  const proposals = events.filter((event) => event.type === "camera-proposal");
  const lifecycle = events.filter((event) => event.type === "camera");
  const decisions = proposals.map((snapshot) => compareCameraDecision(snapshot));
  const lifecycleMatch = compareCameraLifecycle(proposals, lifecycle);
  const pairs = pageArrivalPairs(proposals);
  const current = replayCameraPolicy(proposals, "current");
  const coalesced = replayCameraPolicy(proposals, "page_arrival_coalescing_v1");
  const production = replayCameraPolicy(proposals, "production_page_arrival_v1");
  const durationMs = run.audio?.durationMs ?? 0;
  const minutes = durationMs / 60_000;
  const currentCancels = lifecycle.filter((event) => event.event === "cancelled").length;
  const currentCompletions = lifecycle.filter((event) => event.event === "completed").length;
  const sameTransitionCancels = pairs.filter(({ page, live }) => proposalStartsAnimation(page) && proposalStartsAnimation(live)).length;
  const transitions = pairs.map(({ transitionId, page, live }) => {
    const pageTarget = replayCameraProposal(page).target;
    const liveResult = replayCameraProposal(live);
    const cancellation = lifecycle.find((event) => event.event === "cancelled" && event.proposalId === page.eventId);
    const finalDistance = cameraDistance(page.input.currentCamera, liveResult.target);
    return {
      transitionId,
      pageIndex: page.pageIndex,
      deltaMs: live.t - page.t,
      pageTarget,
      liveTarget: liveResult.target,
      firstAnimationMs: cancellation ? cancellation.t - page.t : null,
      currentFinal: liveResult.target,
      coalescedFinal: liveResult.target,
      finalTargetExact: sameTarget(liveResult.target, live.recorded.target),
      currentEffectiveDistancePx: round(finalDistance),
      coalescedDistancePx: round(finalDistance),
      activeLineFits: liveResult.contentFits && liveResult.webcamCollisions === 0 && liveResult.readabilityViolations.length === 0,
      pageFits: replayCameraPolicy([page, live], "page_arrival_coalescing_v1").pageFitFailures === 0,
      zoom: liveResult.target.zoom,
      webcamCollisions: liveResult.webcamCollisions,
      occupiedCanvasRatio: liveResult.occupiedCanvasRatio,
    };
  });
  const nonPage = proposals.filter((snapshot) => !pairs.some((pair) => pair.page.eventId === snapshot.eventId));
  const nonPageExact = nonPage.every((snapshot) => compareCameraDecision(snapshot).exact);
  return {
    session: path.basename(run.audio?.name ?? "unknown"),
    durationMs,
    viewportHeights: [...new Set(proposals.map((snapshot) => snapshot.input.viewport.height))],
    proposals: proposals.length,
    exactDecisions: decisions.filter((match) => match.exact).length,
    targetMatches: decisions.filter((match) => match.target).length,
    lifecycle: lifecycleMatch,
    pageTurns: proposals.filter((snapshot) => snapshot.proposalKind === "page_turn").length,
    liveFollows: proposals.filter((snapshot) => snapshot.proposalKind === "live_follow").length,
    currentStarts: current.starts,
    newStarts: coalesced.starts,
    currentCompletions,
    newCompletions: currentCompletions,
    currentCancels,
    newCancels: currentCancels - sameTransitionCancels,
    currentMovesPerMin: round(current.starts / minutes),
    newMovesPerMin: round(coalesced.starts / minutes),
    currentCancelsPerMin: round(currentCancels / minutes),
    newCancelsPerMin: round((currentCancels - sameTransitionCancels) / minutes),
    sameTransitionCancels,
    activeLineFailures: coalesced.activeLineFailures,
    pageFitFailures: coalesced.pageFitFailures,
    nonPageExact,
    productionEquivalent: JSON.stringify(production) === JSON.stringify(coalesced),
    transitions,
  };
});

const totals = sessions.reduce((total, session) => {
  for (const key of ["durationMs", "proposals", "exactDecisions", "targetMatches", "pageTurns", "liveFollows", "currentStarts", "newStarts", "currentCompletions", "newCompletions", "currentCancels", "newCancels", "sameTransitionCancels", "activeLineFailures", "pageFitFailures"]) {
    total[key] = (total[key] ?? 0) + session[key];
  }
  total.lifecycleTotal = (total.lifecycleTotal ?? 0) + session.lifecycle.total;
  total.lifecycleMatched = (total.lifecycleMatched ?? 0) + session.lifecycle.matched;
  return total;
}, {});
totals.exactDecisionMatchPct = pct(totals.exactDecisions, totals.proposals);
totals.targetMatchPct = pct(totals.targetMatches, totals.proposals);
totals.lifecycleMatchPct = pct(totals.lifecycleMatched, totals.lifecycleTotal);
totals.cancellationMatchPct = pct(
  sessions.reduce((sum, session) => sum + (session.lifecycle.exact ? session.lifecycle.cancellations : 0), 0),
  totals.currentCancels,
);
totals.completionMatchPct = pct(
  sessions.reduce((sum, session) => sum + (session.lifecycle.exact ? session.lifecycle.completions : 0), 0),
  totals.currentCompletions,
);
totals.currentMovesPerMin = round(totals.currentStarts / (totals.durationMs / 60_000));
totals.newMovesPerMin = round(totals.newStarts / (totals.durationMs / 60_000));
totals.currentCancelsPerMin = round(totals.currentCancels / (totals.durationMs / 60_000));
totals.newCancelsPerMin = round(totals.newCancels / (totals.durationMs / 60_000));

console.log(JSON.stringify({ sessions, totals }, null, 2));
