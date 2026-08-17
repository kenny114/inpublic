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
assert.equal(chooseVisualCommitMode({ hasMutableLiveLine: false, cameraHold: false, launchLiveSeq: 2, currentLiveSeq: 2 }), "normal", "a speech gap permits the ordinary reveal path");

const thought = { id: "t", text: "There are two things: alpha and beta", sourceSegments: ["There are two things: alpha and beta"], page: 0, settledAt: 0 };
let fetches = 0;
let commits = 0;
const priorFetch = globalThis.fetch;
globalThis.fetch = async (_url, init) => {
  fetches += 1;
  const requestText = JSON.parse(init?.body ?? "{}").text ?? "";
  if (requestText.includes("reason people kept leaving")) {
    return new Response(JSON.stringify({
      type: "cause_effect",
      nodes: ["the app took too long to respond", "people kept leaving"],
      edges: [{ from: 0, to: 1, evidence: requestText }],
      evidence: [requestText],
    }), { status: 200 });
  }
  if (requestText.includes("solve the problem differently")) {
    return new Response(JSON.stringify({
      type: "comparison",
      leftLabel: "Claude",
      rightLabel: "Gemini",
      rows: [{ left: "More polished language", right: "More room to feed it context", evidence: [requestText] }],
      evidence: [requestText],
    }), { status: 200 });
  }
  if (requestText.includes("way I usually do it")) {
    return new Response(JSON.stringify({
      type: "sequence",
      steps: ["gather everything I need", "sort it out", "start building"],
      evidence: ["gather everything I need", "sort it out", "start building"],
    }), { status: 200 });
  }
  if (requestText.includes("compared 10 users")) {
    return new Response(JSON.stringify({ type: "quantitative_change", from: 10, to: 20, unit: "users", evidence: [requestText] }), { status: 200 });
  }
  return new Response(JSON.stringify({ type: "enumeration", items: ["alpha", "beta"], evidence: ["alpha and beta"] }), { status: 200 });
};
const context = (experimentMode) => ({
  pen: newPagePen(0), signal: new AbortController().signal, isFresh: () => true,
  commitVisual: () => { commits += 1; }, revealIfNeeded: () => {}, log: () => {}, experimentMode,
});
await runVisualReentry(thought, context("vr_shell"));
assert.equal(fetches, 0, "vr_shell must not request visual intent");
await runVisualReentry(thought, context("vr_decision"));
assert.equal(fetches, 0, "a successful fast-path decision must not request visual intent");
assert.equal(commits, 0, "vr_decision must never commit a visual");
const prepared = await prepareVisualReentry(thought, {
  signal: new AbortController().signal,
  log: () => {},
  experimentMode: "vr_full",
});
assert.equal(fetches, 0, "a gated full fast-path candidate makes no model request");
assert.equal(prepared?.spec.type, "enumeration", "a grounded decision becomes a durable spec without rendering");
assert.equal(prepared?.decisionSource, "deterministic_fast_path");

const approximateThought = { ...thought, id: "approximate", text: "We grew from 60 followers to about 400 followers.", sourceSegments: ["We grew from 60 followers to about 400 followers."] };
const approximateEvents = [];
const approximatePrepared = await prepareVisualReentry(approximateThought, {
  signal: new AbortController().signal,
  log: (event) => approximateEvents.push(event),
  experimentMode: "vr_full",
});
const approximateSuccess = approximateEvents.find((event) => event.event === "fast-path-succeeded");
assert.equal(fetches, 0, "an approximate fast-path success must not request visual intent");
assert.equal(approximatePrepared?.decisionSource, "deterministic_fast_path");
assert.equal(approximateSuccess?.fromModality, "exact");
assert.equal(approximateSuccess?.toModality, "approximate");

const explicitSequenceThought = {
  ...thought,
  id: "sequence-fast",
  text: "First we collect the data, then we clean it, then we train the model.",
  sourceSegments: ["First we collect the data, then we clean it, then we train the model."],
};
const sequenceFetchesBefore = fetches;
const explicitSequencePrepared = await prepareVisualReentry(explicitSequenceThought, {
  signal: new AbortController().signal,
  log: () => {},
  experimentMode: "vr_full",
});
assert.equal(fetches, sequenceFetchesBefore, "explicit sequence fast path requires zero Haiku calls");
assert.equal(explicitSequencePrepared?.spec.type, "sequence");
assert.deepEqual(explicitSequencePrepared?.spec.type === "sequence" ? explicitSequencePrepared.spec.steps : [], ["Collect the data", "Clean it", "Train the model"]);

const ambiguousSequenceThought = {
  ...thought,
  id: "sequence-fallback",
  text: "The way I usually do it is gather everything I need. Once that's done I sort it out, and only after that do I start building.",
  sourceSegments: ["The way I usually do it is gather everything I need. Once that's done I sort it out, and only after that do I start building."],
};
const ambiguousFetchesBefore = fetches;
const ambiguousSequencePrepared = await prepareVisualReentry(ambiguousSequenceThought, {
  signal: new AbortController().signal,
  log: () => {},
  experimentMode: "vr_full",
});
assert.equal(fetches, ambiguousFetchesBefore + 1, "real but non-ceremonial process structure may use one Haiku fallback");
assert.equal(ambiguousSequencePrepared?.spec.type, "sequence", "grounded model sequence becomes durable data");

const hardCauseThought = {
  ...thought,
  id: "cause-fallback",
  text: "The reason people kept leaving was that the app took too long to respond.",
  sourceSegments: ["The reason people kept leaving was that the app took too long to respond."],
};
const hardCauseFetchesBefore = fetches;
const hardCausePrepared = await prepareVisualReentry(hardCauseThought, {
  signal: new AbortController().signal,
  log: () => {},
  experimentMode: "vr_full",
});
assert.equal(fetches, hardCauseFetchesBefore + 1, "hard but explicit causal syntax uses exactly one Haiku fallback");
assert.equal(hardCausePrepared?.spec.type, "cause_effect", "grounded fallback preserves the causal direction");

const explicitComparisonThought = {
  ...thought,
  id: "comparison-fast",
  text: "Option A is cheaper, while Option B is easier to use.",
  sourceSegments: ["Option A is cheaper, while Option B is easier to use."],
};
const comparisonFetchesBefore = fetches;
const explicitComparisonPrepared = await prepareVisualReentry(explicitComparisonThought, {
  signal: new AbortController().signal,
  log: () => {},
  experimentMode: "vr_full",
});
assert.equal(fetches, comparisonFetchesBefore, "explicit comparison fast path requires zero Haiku calls");
assert.equal(explicitComparisonPrepared?.spec.type, "comparison");

const hardComparisonThought = {
  ...thought,
  id: "comparison-fallback",
  text: "They solve the problem differently. Claude tends to give me more polished language. With Gemini I usually have more room to feed it context.",
  sourceSegments: ["They solve the problem differently. Claude tends to give me more polished language. With Gemini I usually have more room to feed it context."],
};
const hardComparisonFetchesBefore = fetches;
const hardComparisonPrepared = await prepareVisualReentry(hardComparisonThought, {
  signal: new AbortController().signal,
  log: () => {},
  experimentMode: "vr_full",
});
assert.equal(fetches, hardComparisonFetchesBefore + 1, "diffuse but explicit comparison uses exactly one Haiku fallback");
assert.equal(hardComparisonPrepared?.spec.type, "comparison", "grounded comparison fallback preserves only spoken claims");

const fallbackThought = { ...thought, id: "fallback", text: "We compared 10 users versus 20 users.", sourceSegments: ["We compared 10 users versus 20 users."] };
const fallbackEvents = [];
const fallbackFetchesBefore = fetches;
const fallbackPrepared = await prepareVisualReentry(fallbackThought, {
  signal: new AbortController().signal,
  log: (event) => fallbackEvents.push(event),
  experimentMode: "vr_full",
});
assert.equal(fetches, fallbackFetchesBefore + 1, "a rejected deterministic extraction falls back to exactly one model request");
assert.equal(fallbackPrepared?.decisionSource, "model_fallback");
assert.equal(fallbackEvents.filter((event) => event.event === "fast-path-rejected").length, 1);

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
globalThis.fetch = priorFetch;

console.log("replay lab: all deterministic checks passed");
