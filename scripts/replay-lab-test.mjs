import assert from "node:assert/strict";
import { buildReplayComparison, correlateSamples, isReplayLabEnabled, parseReplayMode } from "../lib/replayLab.ts";
import { commitPreparedVisualReentry, prepareVisualReentry, runVisualReentry } from "../lib/visualReentry/orchestrate.ts";
import { newPagePen } from "../lib/ops.ts";
import { chooseVisualCommitMode } from "../lib/visualReentry/commitPolicy.ts";
import { mayIssueDevelopmentReplayAuthorization } from "../lib/replayAuthorizationPolicy.ts";
import { mayUseReplayScheduler, ReplayAbsoluteScheduler, REPLAY_CHUNK_CADENCE_MS, REPLAY_STALL_THRESHOLD_MS } from "../lib/replayPacing.ts";
import { buildCorpusEvidence, buildCorpusScene } from "../lib/corpus.ts";

const smallJitterScheduler = new ReplayAbsoluteScheduler(1_000);
const firstLate = smallJitterScheduler.resolve(0, 1_004);
assert.equal(firstLate.targetAtMs, 1_000);
assert.equal(smallJitterScheduler.resolve(80, 1_004).targetAtMs, 1_080, "a +4ms send must not shift the next absolute target");

const overheadScheduler = new ReplayAbsoluteScheduler(10_000);
for (let sequence = 0; sequence < 1_100; sequence += 1) {
  const sourceTimeMs = sequence * REPLAY_CHUNK_CADENCE_MS;
  const deadline = overheadScheduler.resolve(sourceTimeMs, 10_000 + sourceTimeMs + 3);
  assert.equal(deadline.sourceClockDriftMs, 3);
}
assert.equal(overheadScheduler.targetFor(1_100 * REPLAY_CHUNK_CADENCE_MS), 98_000, "repeated +3ms overhead must not accumulate into the next target");
assert.equal(overheadScheduler.rebaseHistory.length, 0, "clean playback must not continuously rebase for tiny jitter");

const stalledScheduler = new ReplayAbsoluteScheduler(0);
assert.equal(stalledScheduler.resolve(0, 0).rebase, null);
const stalled = stalledScheduler.resolve(80, 80 + REPLAY_STALL_THRESHOLD_MS + 1);
assert.equal(stalled.rebase?.reason, "genuine_stall", "large lateness triggers one stall rebase");
assert.equal(stalledScheduler.rebaseHistory.length, 1);
assert.equal(stalled.targetAtMs, 241, "the next unsent chunk resumes at now");
const afterStall = stalledScheduler.resolve(160, 241);
assert.equal(afterStall.targetAtMs, 321, "the following chunk resumes at ordinary cadence rather than bursting");
assert.equal(afterStall.delayMs, 80);
assert.equal(stalledScheduler.rebaseHistory.length, 1);

const reconnectScheduler = new ReplayAbsoluteScheduler(0);
const reconnect = reconnectScheduler.resolve(160, 1_500, "reconnect");
assert.equal(reconnect.rebase?.reason, "reconnect");
assert.equal(reconnect.targetAtMs, 1_500, "reconnect resumes from the next unsent chunk");
assert.equal(reconnectScheduler.resolve(240, 1_500).targetAtMs, 1_580, "reconnect does not catch up queued audio");

const sentSequences = [];
const identityScheduler = new ReplayAbsoluteScheduler(0);
for (let sequence = 1; sequence <= 12; sequence += 1) {
  const sourceTimeMs = (sequence - 1) * REPLAY_CHUNK_CADENCE_MS;
  identityScheduler.resolve(sourceTimeMs, sequence === 6 ? 2_000 : identityScheduler.targetFor(sourceTimeMs));
  sentSequences.push(sequence);
}
assert.deepEqual(sentSequences, Array.from({ length: 12 }, (_, index) => index + 1), "rebasing neither duplicates nor skips a source chunk");

assert.equal(mayUseReplayScheduler("audio-worklet-pcm16"), false, "production AudioWorklet capture must not use replay pacing");
assert.equal(mayUseReplayScheduler("media-recorder"), false, "production MediaRecorder capture must not use replay pacing");
assert.equal(mayUseReplayScheduler("replay-pcm16"), true);

assert.equal(isReplayLabEnabled("?replay=1", "production"), false, "production must ignore replay flag");
assert.equal(isReplayLabEnabled("?replay=1", "development"), true, "development may enable replay flag");
assert.equal(parseReplayMode("vr_shell"), "vr_shell");
assert.equal(parseReplayMode("bad"), "v2_only");
assert.equal(mayIssueDevelopmentReplayAuthorization("production", "http://localhost:3000/api/dev/replay-authorization", "http://localhost:3000"), false, "production cannot issue replay authorization");
assert.equal(mayIssueDevelopmentReplayAuthorization("development", "https://inpublic.example/api/dev/replay-authorization", "https://inpublic.example"), false, "a non-loopback development host cannot issue replay authorization");
assert.equal(mayIssueDevelopmentReplayAuthorization("development", "http://localhost:3000/api/dev/replay-authorization", "http://localhost:3000"), true, "same-origin loopback development may issue replay authorization");
assert.equal(mayIssueDevelopmentReplayAuthorization("development", "http://localhost:3000/api/dev/replay-authorization", "http://evil.example"), false, "cross-origin callers cannot issue replay authorization");

const correlated = correlateSamples([
  { key: "interim_lag", value: 500, at: 20 },
  { key: "interim_lag", value: 100, at: 40 },
  { key: "chunk_to_message", value: 200, at: 25 },
], [{ start: 10, end: 30 }]);
assert.equal(correlated.inFlight.interim_lag.p50, 500);
assert.equal(correlated.idle.interim_lag.p50, 100);

const baseRun = {
  mode: "v2_only", round: 1, audio: {}, vr: { visualDecisionCount: 0, candidateAcceptedCount: 0, durableResultCommittedCount: 0, evidenceCombinedCount: 0, quietCommittedCount: 0 }, correlation: {}, visualLifecycles: [], settledThoughts: [], visualSources: [], scene: {}, events: [], pageTurns: [], transcript: "", startedAt: "",
  latency: { interimLagP50: 100, interimLagP95: 200, finalLagP50: 150, chunkToMessageP50: 30, chunkToInkP50: 40, renderP50: 2, paintP50: 16 },
};
assert.equal(buildReplayComparison([baseRun]).v2_only.interimLagP50, 100);

const corpusEvents = [
  { t: 100, type: "settled-thought", thoughtId: "a", text: "Marketing creates traffic.", sourceSegments: ["Marketing creates traffic."], startedAtMs: 80, settledAtMs: 100, pageId: 0, sessionId: "session", sessionGeneration: 1, sourceRegion: { audioStartMs: 0, audioEndMs: 1_000 } },
  { t: 200, type: "settled-thought", thoughtId: "b", text: "That traffic creates signups.", sourceSegments: ["That traffic creates signups."], startedAtMs: 180, settledAtMs: 200, pageId: 0, sessionId: "session", sessionGeneration: 1, sourceRegion: { audioStartMs: 1_100, audioEndMs: 2_000 } },
  { t: 300, type: "settled-thought", thoughtId: "c", text: "The team understands it.", sourceSegments: ["The team understands it."], startedAtMs: 280, settledAtMs: 300, pageId: 0, sessionId: "session", sessionGeneration: 1 },
  { t: 210, type: "visual-reentry", event: "candidate-accepted", thoughtId: "evidence:a+b", sourceText: "Marketing creates traffic. That traffic creates signups.", participantThoughtIds: ["a", "b"], visualFamily: "cause_effect", reason: "completed causal chain" },
  { t: 220, type: "visual-reentry", event: "fast-path-succeeded", thoughtId: "evidence:a+b", decisionSource: "deterministic_fast_path", visualFamily: "cause_effect" },
  { t: 230, type: "visual-reentry", event: "grounding-passed", thoughtId: "evidence:a+b", decisionSource: "deterministic_fast_path", visualFamily: "cause_effect" },
  { t: 240, type: "visual-reentry", event: "durable-result-committed", thoughtId: "evidence:a+b", decisionSource: "deterministic_fast_path", visualFamily: "cause_effect" },
  { t: 241, type: "visual-reentry", event: "durable-result-quiet-committed", thoughtId: "evidence:a+b" },
  { t: 310, type: "visual-reentry", event: "candidate-rejected", thoughtId: "c", sourceText: "The team understands it.", participantThoughtIds: ["c"], reason: "no complete supported visual pattern" },
];
const corpusEvidence = buildCorpusEvidence(corpusEvents);
assert.equal(corpusEvidence.settledThoughts.length, 3, "exact V2 units are retained independently of visual candidates");
assert.equal(corpusEvidence.settledThoughts[0].outcome, "cause_effect");
assert.equal(corpusEvidence.settledThoughts[1].outcome, "cause_effect", "one combined source owns both participating thoughts");
assert.equal(corpusEvidence.settledThoughts[2].outcome, "no_candidate");
assert.deepEqual(corpusEvidence.visualSources[0].participantThoughtIds, ["a", "b"]);
assert.equal(corpusEvidence.visualSources[0].combinedLiteralSource, "Marketing creates traffic. That traffic creates signups.");
assert.equal(corpusEvidence.visualSources[0].groundingResult, "passed");
assert.equal(corpusEvidence.visualSources[0].commitResult, "quiet_committed");
const retainedScene = buildCorpusScene([{ id: "one", x: 0, y: 0, width: 10, height: 10 }], 2);
assert.equal(retainedScene.pageCount, 3);
assert.equal(retainedScene.elements.length, 1);

assert.equal(chooseVisualCommitMode({ hasMutableLiveLine: true, cameraHold: true, launchLiveSeq: 1, currentLiveSeq: 2 }), "blocked", "mutable live speech always blocks visual placement");
assert.equal(chooseVisualCommitMode({ hasMutableLiveLine: false, cameraHold: true, launchLiveSeq: 1, currentLiveSeq: 2 }), "quiet", "a previous settled thought may commit under the camera hold");
assert.equal(chooseVisualCommitMode({ hasMutableLiveLine: false, cameraHold: true, launchLiveSeq: 2, currentLiveSeq: 2 }), "blocked", "the current thought cannot immediately self-commit during its hold");
assert.equal(chooseVisualCommitMode({ hasMutableLiveLine: false, cameraHold: true, launchLiveSeq: 2, currentLiveSeq: 2, sameTurnFold: true }), "normal", "a just-settled line may fold into its visual this turn");
assert.equal(chooseVisualCommitMode({ hasMutableLiveLine: false, cameraHold: false, launchLiveSeq: 2, currentLiveSeq: 2 }), "normal", "a speech gap permits the ordinary reveal path");

// Only one visual family survives Visual Re-entry (cause_effect), and there
// is no model call anywhere left in this pipeline — cause.ts's deterministic
// parse is the whole decision process. No fetch mocking is needed any more:
// every prepared result here comes from real deterministic code.
const thought = {
  id: "t",
  text: "Marketing creates traffic, and traffic creates signups.",
  sourceSegments: ["Marketing creates traffic, and traffic creates signups."],
  page: 0,
  settledAt: 0,
};
let commits = 0;
const context = (experimentMode) => ({
  pen: newPagePen(0), signal: new AbortController().signal, isFresh: () => true,
  commitVisual: () => { commits += 1; }, revealIfNeeded: () => {}, log: () => {}, experimentMode,
});
await runVisualReentry(thought, context("vr_shell"));
assert.equal(commits, 0, "vr_shell must not commit a visual");
await runVisualReentry(thought, context("vr_decision"));
assert.equal(commits, 0, "vr_decision must never commit a visual");
const prepared = await prepareVisualReentry(thought, {
  signal: new AbortController().signal,
  log: () => {},
  experimentMode: "vr_full",
});
assert.equal(prepared?.spec.type, "cause_effect", "a grounded decision becomes a durable spec without rendering");
assert.equal(prepared?.decisionSource, "deterministic_fast_path");

const hardCauseThought = {
  ...thought,
  id: "cause-hard",
  text: "The reason people kept leaving was that the app took too long to respond.",
  sourceSegments: ["The reason people kept leaving was that the app took too long to respond."],
};
const hardCauseEvents = [];
const hardCausePrepared = await prepareVisualReentry(hardCauseThought, {
  signal: new AbortController().signal,
  log: (event) => hardCauseEvents.push(event),
  experimentMode: "vr_full",
});
assert.equal(hardCausePrepared, null, "hard causal syntax the deterministic parser rejects stays a plain thought — there is no model fallback left to try");
assert.equal(hardCauseEvents.some((event) => event.event === "fast-path-rejected"), true);

const nonCausalThought = { ...thought, id: "no-visual", text: "The team discussed the onboarding experience.", sourceSegments: ["The team discussed the onboarding experience."] };
const nonCausalPrepared = await prepareVisualReentry(nonCausalThought, {
  signal: new AbortController().signal,
  log: () => {},
  experimentMode: "vr_full",
});
assert.equal(nonCausalPrepared, null, "ordinary prose never produces a visual");

let safeToCommit = false;
let builds = 0;
const durablePen = newPagePen(0);
const durableStartY = durablePen.y;
const durableContext = {
  pen: durablePen,
  isSafe: () => safeToCommit,
  isRelevant: () => true,
  commitVisual: () => { commits += 1; },
  revealIfNeeded: () => {},
  log: () => {},
  build: async (_spec, pen) => {
    builds += 1;
    pen.y += 100;
    return { elements: [{ id: "durable" }], x: 0, y: 0, w: 100, h: 100 };
  },
};
assert.equal(await commitPreparedVisualReentry(prepared, durableContext), "held", "continued speech holds a durable result");
assert.equal(builds, 0, "held results do not build geometry early");
safeToCommit = true;
assert.equal(await commitPreparedVisualReentry(prepared, durableContext), "committed", "the same result commits in the next safe window");
assert.equal(builds, 1);
assert.equal(commits, 1);
assert.equal(durablePen.y, durableStartY + 100, "the disposable pen is applied atomically on commit");

const racedPen = newPagePen(0);
const racedStartY = racedPen.y;
let placementCurrent = true;
let racedCommits = 0;
assert.equal(await commitPreparedVisualReentry(prepared, {
  ...durableContext,
  pen: racedPen,
  isSafe: () => true,
  isPlacementCurrent: () => placementCurrent,
  commitVisual: () => { racedCommits += 1; },
  build: async (_spec, pen) => {
    pen.y += 100;
    placementCurrent = false;
    return { elements: [{ id: "raced" }], x: 0, y: 0, w: 100, h: 100 };
  },
}), "held", "a live placement change during async rendering holds the result for retry");
assert.equal(racedCommits, 0, "a raced render never commits elements");
assert.equal(racedPen.y, racedStartY, "a raced render never overwrites the live pen");

console.log("replay lab: all deterministic checks passed");
