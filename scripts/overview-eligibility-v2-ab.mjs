// Offline / development-only. Does not change production behavior.
//
// Runs the frozen deterministic proposal streams already used for the
// Overview Usefulness + Reversal Audit V1 through three policies:
//
//   A. current      — thought settled + 1.8s quiet timer (production today)
//   B. no_overview  — generic overview proposal kind fully suppressed
//   C. strong       — overview eligible only at explicit strong completion:
//                        - PAGE completion never gets a separate overview
//                          (the page turn itself is the transition; this is
//                          enforced by definition, not by a geometry rule)
//                        - SESSION completion (an explicit mic-stop event)
//                          is the only other candidate, and no session-stop
//                          event exists in this corpus or is currently
//                          logged anywhere in the app, so it never fires
//
// Policy C does not use any retrospective/non-causal knowledge (e.g. "no
// later page event in the whole capture"). It only asks whether a real,
// already-defined lifecycle signal fired before the proposal. Today that
// signal (`type: "latency"`, described in lib/types.ts as written "when the
// mic stops") has no emission call site anywhere in lib/ or hooks/, so it
// can never be true in any corpus captured from the current app.
import fs from "node:fs";
import path from "node:path";
import { pageArrivalPairs, proposalStartsAnimation, replayCameraProposal } from "../lib/cameraReplay.ts";

const inputFiles = process.argv.slice(2);
if (!inputFiles.length) throw new Error("Pass one or more exported replay JSON files.");

const round = (value, places = 3) => (value == null ? null : Number(value.toFixed(places)));
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

function lifecycleFor(events, proposal) {
  const start = events.find((event) => event.type === "camera" && event.event === "started" && event.proposalId === proposal.eventId);
  if (!start) return { start: null, terminal: null };
  const terminal = events.find((event) => event.type === "camera"
    && event.animationId === start.animationId
    && (event.event === "completed" || event.event === "cancelled")
    && event.t >= start.t);
  return { start, terminal: terminal ?? null };
}

// The only currently-real strong-completion signal: an explicit session-stop
// event logged before this proposal. `type: "latency"` is the log event
// lib/types.ts documents as written "when the mic stops" (lib/types.ts:265).
// It is never pushed anywhere in lib/ or hooks/ today (grep-verified), so
// this is always false against real corpora until that wiring is added —
// which this audit does not do.
function hasSessionCompletionBefore(events, atMs) {
  return events.some((event) => event.type === "latency" && event.t <= atMs);
}

function analyzeRun(run, sourceFile) {
  const events = run.events ?? [];
  const proposals = events.filter((event) => event.type === "camera-proposal");
  const overviewProposals = proposals.filter((proposal) => proposal.proposalKind === "overview");
  const coalescedPageIds = new Set(pageArrivalPairs(proposals).map(({ page }) => page.eventId));
  const pageEvents = events.filter((event) => event.type === "page");
  const lifecycle = events.filter((event) => event.type === "camera");
  const recordedCompletions = lifecycle.filter((event) => event.event === "completed").length;
  const recordedCancellations = lifecycle.filter((event) => event.event === "cancelled").length;
  const pageArrivalCancellations = lifecycle.filter((event) => event.event === "cancelled" && coalescedPageIds.has(event.proposalId)).length;
  const productionStarts = proposals.filter((proposal) => !coalescedPageIds.has(proposal.eventId) && proposalStartsAnimation(proposal));

  const inventory = overviewProposals.map((proposal) => {
    const result = replayCameraProposal(proposal);
    const { start, terminal } = lifecycleFor(events, proposal);
    const target = result.target;
    const intendedVector = vector(proposal.input.currentCamera, target);
    const intendedDistance = magnitude(intendedVector);
    const zoomChange = round(target.zoom - proposal.input.currentCamera.zoom, 4);
    const laterPageTurn = pageEvents.find((event) => event.t > proposal.t) ?? null;
    const sessionCompletionEvidence = hasSessionCompletionBefore(events, proposal.t);
    // Strong-completion eligibility: session completion is the only
    // currently-real candidate signal and never fires in this corpus. Page
    // completion is not itself an overview-eligible state by definition
    // (Part 3): the page turn is the transition and consumes it.
    const strongEligible = sessionCompletionEvidence;

    return {
      id: proposal.eventId,
      timeMs: proposal.t,
      page: proposal.pageIndex,
      started: Boolean(start),
      completed: terminal?.event === "completed",
      cancelled: terminal?.event === "cancelled",
      intendedMovementPx: round(intendedDistance),
      renderedMovementPx: terminal?.event === "completed" ? round(intendedDistance) : 0,
      zoomChange,
      textSamples: proposal.input.text?.length ?? 0,
      contentFits: result.contentFits,
      webcamCollisions: result.webcamCollisions,
      readabilityViolations: result.readabilityViolations,
      laterPageTurnMsAway: laterPageTurn ? laterPageTurn.t - proposal.t : null,
      sessionCompletionEvidence,
      strongEligible,
    };
  });

  // Policy A: current production (whatever the timer produced). Movement is
  // reported as intended proposal-target displacement, matching the prior
  // audit's convention; rendered displacement is 0 for anything cancelled
  // before the frozen camera advanced.
  const policyA = {
    starts: inventory.filter((item) => item.started).length,
    completions: inventory.filter((item) => item.completed).length,
    cancellations: inventory.filter((item) => item.cancelled).length,
    intendedMovementPx: round(inventory.reduce((sum, item) => sum + item.intendedMovementPx, 0)),
    renderedMovementPx: round(inventory.reduce((sum, item) => sum + item.renderedMovementPx, 0)),
  };
  // Policy B: overview proposal kind never exists. Nothing is proposed,
  // started, completed, or cancelled for it.
  const policyB = { starts: 0, completions: 0, cancellations: 0, intendedMovementPx: 0, renderedMovementPx: 0 };
  // Policy C: only strong-completion-eligible overview proposals survive.
  // In this corpus that set is always empty (see hasSessionCompletionBefore
  // above), so Policy C is currently indistinguishable from Policy B by
  // outcome, though its eligibility rule is structurally different.
  const eligible = inventory.filter((item) => item.strongEligible);
  const policyC = {
    starts: eligible.filter((item) => item.started).length,
    completions: eligible.filter((item) => item.completed).length,
    cancellations: eligible.filter((item) => item.cancelled).length,
    intendedMovementPx: round(eligible.reduce((sum, item) => sum + item.intendedMovementPx, 0)),
    renderedMovementPx: round(eligible.reduce((sum, item) => sum + item.renderedMovementPx, 0)),
  };

  const nonOverviewStarts = productionStarts.length - policyA.starts;

  return {
    sourceFile,
    session: path.basename(run.audio?.name ?? "unknown"),
    durationMs: run.audio?.durationMs ?? null,
    pageTurns: pageEvents.map((event) => ({ t: event.t, index: event.index, reason: event.reason, midThought: event.midThought })),
    sessionCompletionEventsLogged: events.filter((event) => event.type === "latency").length,
    nonOverviewStarts,
    inventory,
    policies: {
      current: { nonOverviewStarts, ...policyA, totalStarts: nonOverviewStarts + policyA.starts },
      no_overview: { nonOverviewStarts, ...policyB, totalStarts: nonOverviewStarts + policyB.starts },
      strong_completion: { nonOverviewStarts, ...policyC, totalStarts: nonOverviewStarts + policyC.starts },
    },
    pageArrivalPairs: pageArrivalPairs(proposals).length,
  };
}

const sessions = inputFiles.flatMap((file) => {
  const report = JSON.parse(fs.readFileSync(file, "utf8"));
  return (report.runs ?? []).map((run) => analyzeRun(run, file));
});

const totals = {
  sessions: sessions.length,
  totalDurationMs: sessions.reduce((sum, session) => sum + (session.durationMs ?? 0), 0),
  sessionCompletionEventsLogged: sessions.reduce((sum, session) => sum + session.sessionCompletionEventsLogged, 0),
  policies: {
    current: sessions.reduce((acc, session) => addPolicy(acc, session.policies.current), zeroPolicy()),
    no_overview: sessions.reduce((acc, session) => addPolicy(acc, session.policies.no_overview), zeroPolicy()),
    strong_completion: sessions.reduce((acc, session) => addPolicy(acc, session.policies.strong_completion), zeroPolicy()),
  },
  pageArrivalPairs: sessions.reduce((sum, session) => sum + session.pageArrivalPairs, 0),
};

function zeroPolicy() {
  return { nonOverviewStarts: 0, starts: 0, completions: 0, cancellations: 0, intendedMovementPx: 0, renderedMovementPx: 0, totalStarts: 0 };
}
function addPolicy(acc, policy) {
  return {
    nonOverviewStarts: acc.nonOverviewStarts + policy.nonOverviewStarts,
    starts: acc.starts + policy.starts,
    completions: acc.completions + policy.completions,
    cancellations: acc.cancellations + policy.cancellations,
    intendedMovementPx: round(acc.intendedMovementPx + policy.intendedMovementPx),
    renderedMovementPx: round(acc.renderedMovementPx + policy.renderedMovementPx),
    totalStarts: acc.totalStarts + policy.totalStarts,
  };
}

console.log(JSON.stringify({ sessions, totals }, null, 2));
