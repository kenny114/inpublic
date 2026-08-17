/**
 * The decision layers, tested directly.
 *
 *   node --import ./scripts/ts-register.mjs scripts/unit-test.mjs
 *
 * No network, no canvas, no API keys. Everything here is a pure function that
 * a session either depends on or is ruined by.
 */

import {
  correctTranscript,
  groundedInSource,
  keyterms,
  soundsLike,
} from "../lib/vocab.ts";
import { ExactMicAudioRetention } from "../lib/corpusAudio.ts";
import { decidePageTurn, isThoughtComplete, MAX_DEFER_MS } from "../lib/pagination.ts";
import { detectBackReference, resolveReference } from "../lib/reference.ts";
import { pathBlocked, routeArrow } from "../lib/routing.ts";
import { matchMark, planActions } from "../lib/organizer.ts";
import { emptyUndo, SemanticBoard } from "../lib/semantic.ts";
import { comparisonPairKey, detectComparison, detectProcessSignal, MIN_COMPARISON_CONFIDENCE } from "../lib/director.ts";
import { computeComparisonLayout } from "../lib/choreographerComparison.ts";
import { computeProcessLayout } from "../lib/choreographerProcess.ts";
import { advanceDirector, createDirectorState, markProcessCommitted, unmarkProcessCommitted } from "../lib/directorState.ts";
import { isFragment, parseLine } from "../lib/ops.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  EMPTY_THOUGHT,
  earlyVoiceCommand,
  flushStructuralThought,
  localVoiceCommand,
  pushStructuralSegment,
  retirePending,
} from "../lib/liveSpeech.ts";
import { shouldWakeScribe } from "../lib/scribeScheduler.ts";
import { localBeatDecision, scoreBeatAgreement } from "../lib/beatPrefilter.ts";
import {
  applySpeculativeOutcome,
  confirmedByFinal,
  emptySpeculativeState,
  MAX_DEFERRED_ATTEMPTS,
  recognizeSpeculative,
  supersedes,
} from "../lib/speculative.ts";
import { LatencyRecorder, formatLatencySummary } from "../lib/latency.ts";
import { chunkToInkSample, liveLatencySample } from "../lib/telemetry.ts";
import { opacityPulse } from "../lib/pulse.ts";
import { parseDecision } from "../lib/beat.ts";
import { composeAttentionBudget, withinInitialCompositionWindow } from "../lib/attention.ts";
import { requestDelayMs, retryAfterMs } from "../lib/requestScheduling.ts";
import { startListeningSession } from "../lib/listeningSession.ts";
import { audioReservationSeconds } from "../lib/providerCost.ts";
import {
  destructiveCorrections,
  firstTwoMinutePages,
  fragmentedMovement,
  resetTimelineTiming,
  scratchSelfUndoHistory,
  validLiveTiming,
} from "./fixtures/latest-session-regressions.mjs";

let pass = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    pass += 1;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n── ${title}`);
}

// ------------------------------------------------ listening session lifecycle

section("listening session lifecycle");

{
  const stopped = [];
  const started = await startListeningSession(
    async () => true,
    async () => false,
    async (reason) => { stopped.push(reason); },
  );
  check("a failed provider start is reported", started === false);
  check("a failed provider start releases its usage lease", stopped[0] === "provider_aborted");
}

{
  const stopped = [];
  const started = await startListeningSession(
    async () => true,
    async () => true,
    async (reason) => { stopped.push(reason); },
  );
  check("a successful provider start is reported", started === true);
  check("a live provider keeps its usage lease", stopped.length === 0);
}

{
  let engineCalled = false;
  const started = await startListeningSession(
    async () => false,
    async () => { engineCalled = true; return true; },
    async () => undefined,
  );
  check("a rejected usage session is reported", started === false);
  check("the provider is not started without a usage lease", engineCalled === false);
}

// -------------------------------------------- parallel startup (phase 2)
//
// The billing guarantee is the whole point of these: prewarm may open the
// microphone concurrently with the lease request, but nothing may reach a
// provider unless the lease was actually granted.

{
  const order = [];
  await startListeningSession(
    async () => { order.push("lease"); return true; },
    async () => { order.push("engine"); return true; },
    async () => undefined,
    async () => { order.push("prewarm"); },
  );
  check("prewarm starts before the lease resolves", order[0] === "prewarm");
  check("the engine still starts only after the lease", order.indexOf("engine") > order.indexOf("lease"));
}

{
  let engineCalled = false;
  let prewarmCalled = false;
  const started = await startListeningSession(
    async () => false,
    async () => { engineCalled = true; return true; },
    async () => undefined,
    async () => { prewarmCalled = true; },
  );
  check("a refused lease still reports failure with prewarm in play", started === false);
  check("prewarm alone never starts the provider", engineCalled === false);
  check("prewarm did run concurrently", prewarmCalled === true);
}

{
  const stopped = [];
  let engineCalled = false;
  const started = await startListeningSession(
    async () => true,
    async () => { engineCalled = true; return true; },
    async (reason) => { stopped.push(reason); },
    async () => { throw new Error("microphone denied"); },
  );
  check("a failed prewarm is reported as a failed start", started === false);
  check("a failed prewarm never starts the provider", engineCalled === false);
  check("a failed prewarm releases the lease it already took", stopped[0] === "provider_aborted");
}

{
  // A prewarm that rejects while the lease is still in flight must not
  // surface as an unhandled rejection — the handler is attached on the same
  // tick the promise is created.
  let unhandled = false;
  const onUnhandled = () => { unhandled = true; };
  process.on("unhandledRejection", onUnhandled);
  await startListeningSession(
    async () => new Promise((resolve) => setTimeout(() => resolve(true), 10)),
    async () => true,
    async () => undefined,
    async () => { throw new Error("denied immediately"); },
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  process.off("unhandledRejection", onUnhandled);
  check("an early prewarm rejection is handled, not unhandled", unhandled === false);
}

check(
  "an unlimited entitlement reserves only the requested provider window",
  audioReservationSeconds(45, 2_147_483_617, 30, 2_147_483_647, 0) === 45,
);
check(
  "an audio reservation cannot exceed the remaining session allowance",
  audioReservationSeconds(45, 12, 0, 3600, 3590) === 10,
);
check(
  "a non-audio request makes no audio reservation",
  audioReservationSeconds(0, 3600, 30, 3600, 0) === 0,
);

// ---------------------------------------------------------- request pacing

section("request pacing");

check(
  "a first request can run immediately",
  requestDelayMs({ nowMs: 100_000, lastRunAtMs: 0, retryAtMs: 0, lastPointerAtMs: 0, minIntervalMs: 5250, touchLockMs: 1500 }) === 0,
);
check(
  "queued work cannot bypass the minimum interval",
  requestDelayMs({ nowMs: 12_000, lastRunAtMs: 10_000, retryAtMs: 0, lastPointerAtMs: 0, minIntervalMs: 5250, touchLockMs: 1500 }) === 3250,
);
check(
  "the server cooldown wins when it is longer",
  requestDelayMs({ nowMs: 12_000, lastRunAtMs: 10_000, retryAtMs: 20_000, lastPointerAtMs: 0, minIntervalMs: 5250, touchLockMs: 1500 }) === 8000,
);
check("Retry-After seconds are respected", retryAfterMs("17", 60_000, 1000) === 17_000);
check("Retry-After dates are respected", retryAfterMs("Thu, 01 Jan 1970 00:00:20 GMT", 60_000, 1000) === 19_000);
check("invalid Retry-After uses a safe fallback", retryAfterMs("later", 60_000, 1000) === 60_000);

// ---------------------------------------------------------------- vocabulary

section("exact microphone PCM retention");

{
  const hook = readFileSync(fileURLToPath(new URL("../hooks/useDeepgram.ts", import.meta.url)), "utf8");
  const sendAt = hook.indexOf("connection.send(event.data)");
  const retainAt = hook.indexOf("exactMicAudio.recordChunk(event.data");
  check("Deepgram send remains ahead of passive corpus retention", sendAt >= 0 && retainAt > sendAt);
  const sessionExport = readFileSync(fileURLToPath(new URL("../lib/sessionLog.ts", import.meta.url)), "utf8");
  check("development session export includes exact PCM WAV and metadata", sessionExport.includes('"exact-mic-audio.wav"') && sessionExport.includes('"exact-mic-audio.json"'));
}

{
  const retained = new ExactMicAudioRetention(() => true);
  retained.beginSession("session-a");
  const first = new Int16Array([-32768, -1, 0, 32767]);
  const gap = new Int16Array([111, 222]);
  const resumed = new Int16Array([333, 444, 555]);
  retained.recordChunk(first.buffer, 48_000, { sent: true, streamEpoch: 1, bufferedAmount: 0 });
  retained.recordChunk(gap.buffer, 48_000, { sent: false, streamEpoch: null });
  retained.recordChunk(resumed.buffer, 48_000, { sent: true, streamEpoch: 2, bufferedAmount: 12 });
  retained.finishSession();

  const snapshot = retained.snapshot();
  const metadata = snapshot?.metadata;
  check("retention preserves every PCM sample across reconnect gaps", metadata?.sampleCount === 9);
  check("retention preserves chunk order and counts", metadata?.chunkCount === 3 && metadata.sentChunkCount === 2 && metadata.unsentChunkCount === 1);
  check("retention records transport epochs separately", metadata?.transportEpochs.length === 3 && metadata.transportEpochs[0].streamEpoch === 1 && metadata.transportEpochs[1].streamEpoch === null && metadata.transportEpochs[2].streamEpoch === 2);
  check("retention reports the worklet PCM format", metadata?.capture === "audio-worklet-pcm16" && metadata.sampleRate === 48_000 && metadata.channels === 1 && metadata.bitsPerSample === 16);

  const wav = new DataView(await snapshot.wav.arrayBuffer());
  const decoded = new Int16Array(wav.buffer, 44);
  check("WAV export is PCM16 with an exact sample payload", wav.getUint16(20, true) === 1 && wav.getUint32(24, true) === 48_000 && JSON.stringify([...decoded]) === JSON.stringify([...first, ...gap, ...resumed]));

  retained.beginSession("session-b");
  retained.recordChunk(new Int16Array([7, 8]).buffer, 48_000, { sent: true, streamEpoch: 1 });
  check("a new speech session resets the retained PCM", retained.metadata()?.sessionId === "session-b" && retained.metadata()?.sampleCount === 2 && retained.metadata()?.chunkCount === 1);
}

{
  const disabled = new ExactMicAudioRetention(() => false);
  disabled.beginSession("off");
  disabled.recordChunk(new Int16Array([1, 2]).buffer, 48_000, { sent: true, streamEpoch: 1 });
  check("retention off allocates no corpus snapshot", disabled.snapshot() === null);
}

section("recognition repair");

{
  const { text, corrections } = correctTranscript(
    "the impact of air agents on people",
    [],
  );
  check(
    "known error: air agents -> AI agents",
    text.includes("AI agents"),
    text,
  );
  check("known error is logged", corrections.length === 1, JSON.stringify(corrections));
}

{
  // The guard rail: ordinary English must survive contact with the board.
  const { text } = correctTranscript(
    "people want to be in control of their data",
    ["People Ops", "Airline", "AI agents"],
  );
  check(
    "ordinary words are not overwritten",
    text === "people want to be in control of their data",
    text,
  );
}

{
  const { text } = correctTranscript("I want to talk about your line", [
    "Airline",
  ]);
  check("a canvas term wins over a mishearing", text.includes("Airline"), text);
}

{
  const { text } = correctTranscript("as for affiliate capitol, the model is", [
    "Affiliate Capital",
  ]);
  check(
    "multi-word canvas term corrected",
    text.includes("Affiliate Capital"),
    text,
  );
}

{
  const { text } = correctTranscript("nothing on the board yet at all", []);
  check("no active terms means no rewriting", text === "nothing on the board yet at all", text);
}

check("phonetics: exact", soundsLike("Airline", "airline") === 1);
check("phonetics: near", soundsLike("air agents", "AI agents") > 0.5);
check("phonetics: unrelated", soundsLike("people", "Airline") < 0.5);

{
  const terms = keyterms({
    sections: ["Affiliate Capital", "Untitled"],
    concepts: ["AI agents"],
    marks: ["customer service"],
  });
  check("keyterms lead with the section", terms[0] === "Affiliate Capital", terms[0]);
  check("keyterms include concepts", terms.includes("AI agents"));
  check("keyterms drop the Untitled placeholder", !terms.includes("Untitled"));
  check("keyterms fall back to the seed list", terms.includes("Airline"));
  check("keyterms include the measured Aline provider hint", terms.includes("Aline"));
  check("keyterms are capped", terms.length <= 40, String(terms.length));
}

check(
  "grounded: a real phrase passes",
  groundedInSource("AI agents", "the impact of air agents on people"),
);
check(
  "grounded: junk is rejected",
  !groundedInSource("puts AI", "businesses want effectiveness from their tools"),
);

{
  const cases = [
    ["The cat ran away", "The cat ran away"],
    ["The cat ran from the rain", "The cat ran from the rain"],
    ["It began to rain", "It began to rain"],
    ["Kenny Farmer spoke", "Kenny Farmer spoke"],
  ];
  for (const [raw, expected] of cases) {
    const result = correctTranscript(raw, ["rain", "Kenny Fama", "Airline", "ClickLabs"]);
    check(`ordinary language preserved: ${raw}`, result.text === expected, result.text);
  }
  check("real fixture contains the ran/rain defect", destructiveCorrections.length === 2);
  check("InPublic named vocabulary wins", correctTranscript("in public app", ["InPublic"]).text === "InPublic app");
  check("ClickLabs named vocabulary is available", keyterms({}).includes("ClickLabs"));
  check("Airline named vocabulary remains available", keyterms({}).includes("Airline"));
  check("Aline named vocabulary is available", keyterms({}).includes("Aline"));
  check("Aline provider hint does not rewrite the ordinary phrase a line", correctTranscript("Please draw a line here", keyterms({})).text === "Please draw a line here");
  check("Aline provider hint does not rewrite the distinct name Elaine", correctTranscript("Elaine is on the call", keyterms({})).text === "Elaine is on the call");
  check("Aline provider hint does not rewrite the valid Airline product", correctTranscript("Airline is on the board", keyterms({})).text === "Airline is on the board");
}

// ----------------------------------------------------------- live speech lane

section("live speech regressions");

for (const command of ["Scratch that.", "Remove that.", "Undo."]) {
  check(`local command: ${command}`, localVoiceCommand(command) === "undo");
}
check("ordinary narration is not a command", localVoiceCommand("Undo is useful.") === null);
check("historical scratch fixture would self-undo", scratchSelfUndoHistory.at(-1) === "live_line");

for (let attempt = 1; attempt <= 5; attempt += 1) {
  const board = new SemanticBoard();
  board.push({
    operationId: `keep-${attempt}`,
    type: "create_concept",
    timestamp: 1,
    sourceText: "unrelated",
    confidence: 1,
    conceptIds: ["unrelated"],
    elementIds: ["unrelated"],
    undo: emptyUndo(),
  });
  board.push({
    operationId: `draw-${attempt}`,
    type: "scribe_mark",
    timestamp: 2,
    sourceText: "draw this",
    confidence: 1,
    conceptIds: [],
    elementIds: [`draw-${attempt}`],
    undo: emptyUndo(),
  });
  board.push({
    operationId: `command-line-${attempt}`,
    type: "live_line",
    timestamp: 3,
    sourceText: "scratch that",
    confidence: 1,
    conceptIds: [],
    elementIds: [`command-line-${attempt}`],
    undo: emptyUndo(),
  });
  const target = board.lastMeaningful();
  check(`scratch attempt ${attempt} targets the drawing`, target?.operationId === `draw-${attempt}`);
  check(`scratch attempt ${attempt} leaves unrelated content`, board.history[0].operationId === `keep-${attempt}`);
}

{
  let result = pushStructuralSegment(EMPTY_THOUGHT, fragmentedMovement[0], 100);
  check("towards fragment is held", result.held && result.thought === null);
  result = pushStructuralSegment(result.state, fragmentedMovement[1], 300);
  check("towards + target becomes one thought", result.thought === "The cat rain towards the car.", result.thought ?? "");
}

{
  let result = pushStructuralSegment(EMPTY_THOUGHT, "Businesses need", 100);
  result = pushStructuralSegment(result.state, "trusted infrastructure", 400);
  check("business fragment is coalesced", result.thought === "Businesses need trusted infrastructure", result.thought ?? "");
  const complete = pushStructuralSegment(EMPTY_THOUGHT, "Trust matters.", 500);
  check("complete short thought emits immediately", complete.thought === "Trust matters.");
  check("held thought can be bounded-flushed", flushStructuralThought(pushStructuralSegment(EMPTY_THOUGHT, "because", 0).state).thought === "because");
}

// --------------------------------------------------------------- telemetry

section("stream timing epochs");

check("real fixture has valid sub-2s samples", validLiveTiming.every((item) => item.lagMax < 2000));
check("real fixture captures the 202-second reset", resetTimelineTiming.every((item) => item.lagP50 > 200000));
check("initial stream sample accepted", liveLatencySample(1388, { audioEndMs: 1000, streamEpoch: 1 }, 1).lagMs === 388);
check("reconnect epoch mismatch rejected", liveLatencySample(203000, { audioEndMs: 500, streamEpoch: 2 }, 1).reason === "stream-epoch-mismatch");
check("pause/resume stale offset rejected", liveLatencySample(203000, { audioEndMs: 500, streamEpoch: 3 }, 3).reason === "stale-audio");
check("visibility resume on a rebased epoch is valid", liveLatencySample(250400, { audioEndMs: 250100, streamEpoch: 4 }, 4).lagMs === 300);

// chunkToInkSample must never touch audioEndMs/start/duration — only
// sinceChunkSentMs (wall-clock chunk sent -> message received) and the two
// wall-clock timestamps (inkedAtMs, receivedAtMs). This is asserted by
// construction: audioEndMs is intentionally wrong/absent in these fixtures
// and the result is unaffected.
check(
  "chunk_to_ink is wall-clock: chunk sent -> message (40ms) + message -> ink (10ms)",
  chunkToInkSample(
    1050,
    { audioEndMs: 999_999, streamEpoch: 1, receivedAtMs: 1040, sinceChunkSentMs: 40 },
    1,
  ).lagMs === 50,
);
check(
  "chunk_to_ink ignores a wildly wrong audioEndMs entirely",
  chunkToInkSample(
    1050,
    { audioEndMs: 0, streamEpoch: 1, receivedAtMs: 1040, sinceChunkSentMs: 40 },
    1,
  ).lagMs ===
    chunkToInkSample(
      1050,
      { audioEndMs: 5_000_000, streamEpoch: 1, receivedAtMs: 1040, sinceChunkSentMs: 40 },
      1,
    ).lagMs,
);
check(
  "chunk_to_ink is invalid without sinceChunkSentMs",
  chunkToInkSample(1050, { audioEndMs: 1000, streamEpoch: 1, receivedAtMs: 1040 }, 1).valid === false,
);
check(
  "chunk_to_ink respects the stream-epoch guard like liveLatencySample",
  chunkToInkSample(
    1050,
    { audioEndMs: 1000, streamEpoch: 2, receivedAtMs: 1040, sinceChunkSentMs: 40 },
    1,
  ).reason === "stream-epoch-mismatch",
);

// ---------------------------------------------------------- attention budget

section("one evolving composition");

{
  const composition = composeAttentionBudget(
    ["Airline", "AI Agents", "Businesses", "Security", "Trust", "Dedicated infrastructure", "Airline"],
    [
      { from: "Airline", to: "AI Agents" },
      { from: "Businesses", to: "AI Agents" },
      { from: "Airline", to: "Security" },
      { from: "Airline", to: "Trust" },
    ],
  );
  check("Airline remains primary", composition.primary === "Airline");
  check("at most five supporting concepts", composition.supporting.length <= 5);
  check("at most three visible relationships", composition.relationships.length <= 3);
  check("no duplicate concepts", new Set([composition.primary, ...composition.supporting].map((x) => x.toLowerCase())).size === 6);
  check("initial 60 seconds stays in composition window", firstTwoMinutePages.filter((page) => page.t < 60000).every((page) => withinInitialCompositionWindow(page.t)));
  check("audit fixture proves old page churn", firstTwoMinutePages.length === 7);
}

// ------------------------------------------------------------------- pages

section("page turns");

check("thought complete: full stop", isThoughtComplete("Airline is infrastructure."));
check("thought complete: trailing preposition is not", !isThoughtComplete("businesses want to use their agents for the"));
check("thought complete: trailing comma is not", !isThoughtComplete("have both a bad and a good aspect,"));
check("thought complete: nothing in flight", isThoughtComplete(""));

{
  const d = decidePageTurn({
    trigger: "overflow",
    marks: 3,
    maxMarks: 22,
    liveText: "and what they do to",
    deferredForMs: 0,
  });
  check("overflow turns even mid-thought", d.turn && d.reason === "overflow", JSON.stringify(d));
}

{
  const d = decidePageTurn({
    trigger: "capacity",
    marks: 22,
    maxMarks: 22,
    liveText: "AI agents, when they",
    deferredForMs: 0,
  });
  check("capacity waits for an unfinished thought", !d.turn && d.deferred, JSON.stringify(d));
}

{
  const d = decidePageTurn({
    trigger: "capacity",
    marks: 22,
    maxMarks: 22,
    liveText: "AI agents have both good and bad aspects.",
    deferredForMs: 0,
  });
  check("capacity turns once the thought lands", d.turn && d.reason === "sheet-full", JSON.stringify(d));
}

{
  const d = decidePageTurn({
    trigger: "capacity",
    marks: 22,
    maxMarks: 22,
    liveText: "and they never stop talking so",
    deferredForMs: MAX_DEFER_MS + 1,
  });
  check("a deferral expires rather than hanging", d.turn, JSON.stringify(d));
}

{
  const d = decidePageTurn({
    trigger: "section",
    marks: 2,
    maxMarks: 22,
    liveText: "now let's move on to",
    deferredForMs: 0,
  });
  check("a topic change turns immediately", d.turn && d.reason === "topic-change", JSON.stringify(d));
}

// --------------------------------------------------------------- references

section("reference and return");

{
  const cases = [
    ["Going back to Airline, the main problem is trust.", "Airline"],
    ["Back to the AI agents point, they need oversight.", "AI agents"],
    ["Also, about the businesses, they want scale.", "businesses"],
    ["Remember when I mentioned Affiliate Capital?", "Affiliate Capital"],
    ["As for Affiliate Capital, the model is different.", "Affiliate Capital"],
  ];
  for (const [text, expected] of cases) {
    const ref = detectBackReference(text);
    check(
      `cue detected: "${text.slice(0, 28)}…"`,
      ref !== null && ref.phrase.toLowerCase() === expected.toLowerCase(),
      ref ? ref.phrase : "no match",
    );
  }
  check(
    "a normal sentence is not a reference",
    detectBackReference("Airline is infrastructure for AI agents.") === null,
  );
  check(
    "a pronoun target is not resolvable",
    detectBackReference("going back to it, we should ship") === null,
  );
}

{
  const world = {
    sections: [{ sectionId: "s1", title: "Airline", pageIndex: 0 }],
    concepts: [
      { conceptId: "ai-agents", label: "AI agents", pageIndex: 1 },
      { conceptId: "businesses", label: "businesses", pageIndex: 2 },
    ],
    currentPage: 3,
  };
  const hit = resolveReference(
    detectBackReference("Going back to Airline, the main problem is trust."),
    world,
  );
  check("resolves to the right page", hit?.pageIndex === 0, JSON.stringify(hit));
  check("resolution is confident", (hit?.confidence ?? 0) >= 0.7, String(hit?.confidence));

  const miss = resolveReference(
    { cue: "going back to", phrase: "quantum tunnelling", rest: "" },
    world,
  );
  check("an unknown target does not move the camera", miss === null, JSON.stringify(miss));
}

// ------------------------------------------------------------------ routing

section("arrow routing");

{
  const a = { x: 0, y: 0, width: 100, height: 60 };
  const b = { x: 400, y: 0, width: 100, height: 60 };
  const clear = routeArrow(a, b, []);
  check("neighbours get a straight arrow", !clear.routed && clear.points.length === 2);

  const blocker = { x: 200, y: 10, width: 80, height: 40 };
  const routed = routeArrow(a, b, [blocker]);
  check("an obstacle forces a detour", routed.routed, JSON.stringify(routed.points));
  const abs = routed.points.map(([x, y]) => ({
    x: routed.start.x + x,
    y: routed.start.y + y,
  }));
  check(
    "the detour actually clears the obstacle",
    !pathBlocked(abs, [{ x: 186, y: -4, width: 108, height: 68 }]),
    JSON.stringify(abs),
  );
}

// ---------------------------------------------------------------- organizer

section("organizer");

{
  const board = new SemanticBoard();
  board.addConcept({ conceptId: "ai-agents", label: "AI agents" });

  const marks = [
    { key: "businesses", text: "Businesses", elementId: "el_1" },
    { key: "customer service", text: "Customer Service", elementId: "el_2" },
  ];

  const plan = planActions(
    [
      { type: "create_concept", conceptId: "ai-agents", label: "AI agents", kind: "process" },
      { type: "create_concept", conceptId: "businesses", label: "Businesses", kind: "person" },
      { type: "create_concept", conceptId: "sales", label: "Sales", kind: "output" },
      {
        type: "create_relationship",
        fromConceptId: "businesses",
        toConceptId: "ai-agents",
        relationshipType: "use",
      },
    ],
    board,
    marks,
  );

  const kinds = plan.steps.map((s) => s.kind);
  check("an existing concept is reused", kinds[0] === "reuse", kinds.join(","));
  check("a lettered mark is adopted, not duplicated", kinds[1] === "adopt", kinds.join(","));
  check("a genuinely new concept is created", kinds[2] === "create", kinds.join(","));
  check("the relationship survives planning", kinds[3] === "link", kinds.join(","));
  check("spoken order is preserved", kinds.length === 4);

  const link = plan.steps[3];
  check(
    "the link points at the reused id",
    link.toConceptId === "ai-agents",
    JSON.stringify(link),
  );
}

{
  const board = new SemanticBoard();
  board.addConcept({ conceptId: "a", label: "Alpha" });
  board.addConcept({ conceptId: "b", label: "Beta" });
  board.addRelationship({ fromConceptId: "a", toConceptId: "b" });
  const plan = planActions(
    [{ type: "create_relationship", fromConceptId: "a", toConceptId: "b", relationshipType: "x" }],
    board,
    [],
  );
  check("an existing relationship is not drawn twice", plan.steps[0].kind === "drop", JSON.stringify(plan.steps[0]));
}

{
  const plan = planActions(
    [
      {
        type: "create_relationship",
        fromConceptId: "ghost",
        toConceptId: "phantom",
        relationshipType: "x",
      },
    ],
    new SemanticBoard(),
    [],
  );
  check("a link to nothing is dropped, not drawn", plan.steps[0].kind === "drop");
}

check(
  "mark matching tolerates a mishearing",
  matchMark("AI agents", [{ key: "ai agents", text: "AI Agents", elementId: "e" }]) !== null,
);
check(
  "mark matching refuses an unrelated word",
  matchMark("Affiliate Capital", [{ key: "people", text: "People", elementId: "e" }]) === null,
);

// -------------------------------------------------------------------- marks

section("mark quality");

check("fragment: trailing preposition", isFragment("businesses want to use their agents for the"));
check("fragment: bare pronoun", isFragment("they are"));
check("not a fragment: a real phrase", !isFragment("lack of security"));
check("parseLine drops a fragment", parseLine('word "build a"').length === 0);
check("parseLine keeps a real mark", parseLine('word "mass calling"').length === 1);

// ------------------------------------------------------- retiring pending text

section("retiring pending text after a beat");

// The regression this exists for: the beat is asked about sentence two, and
// sentence three lands in the buffer while the Artist is still working. The
// old code cleared the whole buffer, so the queued re-run found nothing and
// the closing thought of an explanation never became structure.
{
  const sent = "Most of that churn came from new customers who cancelled after their first month.";
  const arrivedMeanwhile = "So our next priority is improving onboarding and retention.";
  const buffer = `${sent} ${arrivedMeanwhile}`;
  check(
    "the thought that arrived mid-flight survives",
    retirePending(buffer, sent) === arrivedMeanwhile,
  );
}

check("nothing new means an empty buffer", retirePending("a b c", "a b c") === "");
check("a consumed prefix is retired exactly", retirePending("one two three", "one two") === "three");
check("surrounding whitespace never leaks", retirePending("  one two   three  ", "one two") === "three");
// If the word cap dropped the front of the buffer there is no safe leftover,
// so it retires whole rather than re-drawing something already on the board.
check("a buffer that no longer matches retires whole", retirePending("different words", "one two") === "");
check("consuming nothing keeps the buffer", retirePending("one two", "") === "one two");

// ------------------------------------------------------------- beat responses

section("reading the beat's answer");

// A malformed response is not a decision. It used to become `skip`, which is
// indistinguishable from a deliberate one, so the thought was thrown away with
// nothing to retry it. The real case, from a demo run: a fenced object,
// truncated mid-key.
const truncated = '```json\n{"action": "skip", "reason": "topic announced, no new content", "focus":';
check("a truncated fenced object is a failure, not a skip", parseDecision(truncated).ok === false);
check("the failure keeps the raw response for the retry", parseDecision(truncated).raw === truncated);

const fenced = '```json\n{"action":"draw","reason":"two outcomes","focus":"revenue and churn both rose"}\n```';
check("a well-formed fenced object still parses", parseDecision(fenced).ok === true);
check("...and keeps its action", parseDecision(fenced).decision?.action === "draw");

const withProse = 'Here you go:\n{"action":"section","reason":"topic change","focus":"Affiliate Capital"}';
check("an object buried in prose is salvaged", parseDecision(withProse).ok === true);

// Readable JSON with a bogus action is a genuine skip: a retry cannot help.
const badAction = '{"action":"interpretive-dance","reason":"","focus":""}';
check("readable JSON with an unknown action is a skip, not a retry", parseDecision(badAction).ok === true);
check("...and that skip is inert", parseDecision(badAction).decision?.action === "skip");

check("plain prose is a failure", parseDecision("I think we should draw something.").ok === false);
check("an empty response is a failure", parseDecision("").ok === false);

// -------------------------------------------------- scribe scheduler (phase 3)

section("scribe scheduler");

const wake = (over = {}) => shouldWakeScribe({
  fresh: "", lastSent: "", onPage: [], inFlight: false, attentionBudgetFull: false, ...over,
});

check("new content wakes the scribe", wake({ fresh: "distribution is the problem" }).wake === true);
check("...and carries the words as payload", wake({ fresh: "distribution is the problem" }).payload === "distribution is the problem");
check("empty text never wakes it", wake({ fresh: "   " }).wake === false);
check("an in-flight request never wakes it", wake({ fresh: "brand new words", inFlight: true }).wake === false);

// The punctuation case is the one that made a shorter cooldown affordable:
// smart_format revises punctuation constantly and every revision used to look
// like fresh material worth a model call.
check(
  "punctuation-only churn does not wake it",
  wake({ fresh: "The problem is trust.", lastSent: "the problem is trust" }).wake === false,
);
check(
  "...and says so",
  wake({ fresh: "The problem is trust.", lastSent: "the problem is trust" }).reason === "punctuation-only",
);
check(
  "capitalisation-only churn does not wake it",
  wake({ fresh: "Distribution", lastSent: "distribution" }).wake === false,
);

check(
  "filler-only speech does not wake it",
  wake({ fresh: "um uh so yeah okay right" }).wake === false,
);
check(
  "concepts already on the page do not wake it",
  wake({ fresh: "distribution", onPage: ["Distribution"] }).wake === false,
);
check(
  "partial overlap with the page still wakes it",
  wake({ fresh: "distribution and retention", onPage: ["Distribution"] }).wake === true,
);
check(
  "a full attention budget does not wake it",
  wake({ fresh: "genuinely new material here", attentionBudgetFull: true }).wake === false,
);
check(
  "...but only after the cheaper refusals",
  wake({ fresh: "um uh", attentionBudgetFull: true }).reason === "no-new-words",
);

// ---------------------------------------------------- beat prefilter (phase 4)

section("beat prefilter (shadow mode)");

const beat = (over = {}) => localBeatDecision({
  pendingText: "", existingConcepts: [], looseWords: [], skipStreak: 0, ...over,
});

check(
  "too few content words is a confident skip",
  beat({ pendingText: "so anyway the thing" }).verdict === "skip",
);
check(
  "an incomplete thought is never a skip",
  beat({ pendingText: "businesses want to use their agents for the" }).verdict === "uncertain",
);
check(
  "a pure restatement is a confident skip",
  beat({
    pendingText: "so distribution and retention matter here",
    existingConcepts: ["distribution", "retention", "matter", "here"],
  }).verdict === "skip",
);
check(
  "a complete novel thought stating a relation is a draw",
  beat({
    pendingText: "The new plan launch caused revenue growth because onboarding improved.",
  }).verdict === "draw",
);
check(
  "novel content with no stated relation defers to the model",
  beat({ pendingText: "Our customers are mostly small agencies." }).verdict === "uncertain",
);
check(
  "a long skip streak defers rather than compounding",
  beat({
    pendingText: "The new plan launch caused revenue growth because onboarding improved.",
    skipStreak: 4,
  }).verdict === "uncertain",
);

// Shadow-mode scoring. `uncertain` is a deferral and must never be counted as
// a disagreement, or the agreement rate becomes meaningless.
check(
  "a local skip matching a model skip agrees",
  scoreBeatAgreement({ verdict: "skip", reason: "" }, "skip").agreement === true,
);
check(
  "a local skip against a model draw is a FALSE SKIP",
  scoreBeatAgreement({ verdict: "skip", reason: "" }, "draw").falseSkip === true,
);
check(
  "...and is counted as disagreement",
  scoreBeatAgreement({ verdict: "skip", reason: "" }, "draw").agreement === false,
);
check(
  "a local draw against a model skip is a false draw, not a false skip",
  scoreBeatAgreement({ verdict: "draw", reason: "" }, "skip").falseDraw === true &&
    scoreBeatAgreement({ verdict: "draw", reason: "" }, "skip").falseSkip === false,
);
check(
  "uncertain is never scored as a disagreement",
  scoreBeatAgreement({ verdict: "uncertain", reason: "" }, "draw").agreement === true,
);
check(
  "uncertain is never a false skip",
  scoreBeatAgreement({ verdict: "uncertain", reason: "" }, "draw").falseSkip === false,
);

// ------------------------------------------------ speculative visuals (phase 5)

section("speculative visuals");

const spec = (over = {}) => recognizeSpeculative(over.state ?? emptySpeculativeState(), {
  settledText: "", utteranceText: "", confidence: 0.95, onBoard: [], ...over,
});

const CLOSED = "distribution channels and";

{
  const result = spec({ settledText: CLOSED, utteranceText: CLOSED });
  check("a settled, closed concept produces a provisional event", result.events.length > 0);
  check("...tagged as a concept", result.events[0].kind === "concept");
  check("...carrying its source speech for later reconciliation", result.events[0].source === CLOSED);
}

// The anti-flicker property, asserted directly. A trailing run is still being
// spoken — "distribution chan…" could become "distribution channel strategy"
// — so it is held back until a stopword closes it. This is what stops a
// speaker mid-phrase from stacking a lone "Distribution" that then blocks the
// real phrase as a duplicate.
check(
  "an unterminated trailing phrase is held back",
  spec({ settledText: "distribution channels", utteranceText: "distribution channels" })
    .events.filter((e) => e.kind === "concept").length === 0,
);

{
  // Proposing a concept twice in a row (before it's ever drawn) is a RETRY,
  // by design — see the "lost speculative event" tests below. It only stops
  // being re-proposed once the caller reports it was actually rendered.
  const first = spec({ settledText: CLOSED, utteranceText: CLOSED });
  const rendered = new Map(first.events.map((e) => [e.key, "rendered"]));
  const confirmedState = applySpeculativeOutcome(first.state, rendered);
  const second = recognizeSpeculative(confirmedState, {
    settledText: CLOSED,
    utteranceText: CLOSED,
    confidence: 0.95,
    onBoard: [],
  });
  check(
    "the same concept never produces a second event once rendered",
    second.events.length === 0,
  );
}

// ---- Hazard A: a temporarily-blocked guess must not be lost forever -------

{
  const first = spec({ settledText: CLOSED, utteranceText: CLOSED });
  check("first proposal produces the concept", first.events.some((e) => e.kind === "concept"));

  // The caller tried to draw it and couldn't (pointer lock / busy sketch /
  // cap-of-3) — this must NOT permanently retire the key.
  const blocked = new Map(first.events.map((e) => [e.key, "blocked"]));
  const afterBlock = applySpeculativeOutcome(first.state, blocked);

  const retry = recognizeSpeculative(afterBlock, {
    settledText: "",
    utteranceText: CLOSED,
    confidence: 0.95,
    onBoard: [],
  });
  check(
    "a blocked guess is retried on the next tick, even with no new settled text",
    retry.events.some((e) => e.kind === "concept"),
  );

  // Confirm it eventually gives up rather than retrying forever.
  let state = afterBlock;
  for (let i = 1; i < MAX_DEFERRED_ATTEMPTS; i++) {
    const attempt = recognizeSpeculative(state, {
      settledText: "",
      utteranceText: CLOSED,
      confidence: 0.95,
      onBoard: [],
    });
    const stillBlocked = new Map(attempt.events.map((e) => [e.key, "blocked"]));
    state = applySpeculativeOutcome(state, stillBlocked);
  }
  const gaveUp = recognizeSpeculative(state, {
    settledText: "",
    utteranceText: CLOSED,
    confidence: 0.95,
    onBoard: [],
  });
  check(
    "a guess blocked past MAX_DEFERRED_ATTEMPTS stops retrying",
    gaveUp.events.length === 0,
  );
}

{
  // A permanent failure (e.g. a real mark already claimed the key) must not
  // be retried — retrying it would just fail again.
  const first = spec({ settledText: CLOSED, utteranceText: CLOSED });
  const dropped = new Map(first.events.map((e) => [e.key, "dropped"]));
  const afterDrop = applySpeculativeOutcome(first.state, dropped);
  const retry = recognizeSpeculative(afterDrop, {
    settledText: "",
    utteranceText: CLOSED,
    confidence: 0.95,
    onBoard: [],
  });
  check("a permanently dropped guess is never retried", retry.events.length === 0);
}

check(
  "concepts already on the board are not re-proposed",
  spec({ settledText: CLOSED, utteranceText: CLOSED, onBoard: ["Distribution Channels"] })
    .events.filter((e) => e.kind === "concept").length === 0,
);
check(
  "low confidence produces nothing",
  spec({ settledText: CLOSED, utteranceText: CLOSED, confidence: 0.2 }).events.length === 0,
);
check(
  "empty settled speech produces nothing",
  spec({ settledText: "  ", utteranceText: "" }).events.length === 0,
);

{
  const result = spec({
    settledText: "there are three reasons",
    utteranceText: "there are three reasons",
  });
  const count = result.events.find((e) => e.kind === "count");
  check("a stated count is recognised", Boolean(count));
  check("...and rendered as a heading", count?.text === "3 REASONS");
}

{
  const result = spec({ settledText: "revenue increased", utteranceText: "revenue increased" });
  const trend = result.events.find((e) => e.kind === "trend");
  check("a stated upward trend is recognised", Boolean(trend));
  check("...with an up arrow", trend?.text.includes("↑") === true);
}

{
  const result = spec({ settledText: "churn went down", utteranceText: "churn went down" });
  const trend = result.events.find((e) => e.kind === "trend");
  check("a downward trend gets a down arrow", trend?.text.includes("↓") === true);
}

// ---- Part 7: emphasis / contrast / cause -----------------------------------

{
  const speech = "the most important thing is distribution";
  const result = spec({ settledText: speech, utteranceText: speech });
  const emphasized = result.events.find((e) => e.kind === "concept" && e.emphasis);
  check("a stressed phrase is recognised as an emphasized concept", Boolean(emphasized));
  check("...naming the stressed subject", emphasized?.text === "Distribution");
}
check(
  "unstressed speech never sets the emphasis flag",
  spec({ settledText: CLOSED, utteranceText: CLOSED }).events.every((e) => !e.emphasis),
);

{
  const result = spec({ settledText: "but that assumes", utteranceText: "but that assumes" });
  const contrast = result.events.find((e) => e.kind === "contrast");
  check("a clause-initial 'but' is recognised as a contrast", Boolean(contrast));
}
check(
  "'but' mid-sentence (not clause-initial in the settled chunk) is not a contrast",
  spec({ settledText: "not now but later", utteranceText: "not now but later" })
    .events.filter((e) => e.kind === "contrast").length === 0,
);

{
  const speech = "low retention causes distribution problems";
  const onBoard = ["Retention", "Distribution Problems"];
  const result = spec({ settledText: speech, utteranceText: speech, onBoard });
  const cause = result.events.find((e) => e.kind === "cause");
  check("an explicit cause between two known concepts is recognised", Boolean(cause));
  check("...pointing from cause to effect", cause?.text === "Low Retention → Distribution Problems");
}
check(
  "cause is not proposed when the concepts aren't already on the board",
  spec({
    settledText: "low retention causes distribution problems",
    utteranceText: "low retention causes distribution problems",
    onBoard: [],
  }).events.filter((e) => e.kind === "cause").length === 0,
);
{
  const speech = "distribution problems happen because of low retention";
  const onBoard = ["Retention", "Distribution Problems"];
  const result = spec({ settledText: speech, utteranceText: speech, onBoard });
  const cause = result.events.find((e) => e.kind === "cause");
  check("the reversed 'X because of Y' phrasing still points cause -> effect", Boolean(cause));
  check("...same direction regardless of which clause came first", cause?.text === "Low Retention → Distribution Problems");
}

// ---------------------------------------------------------------- visual pulse

section("visual pulse");

{
  const steps = opacityPulse(40, 100, 4, 200);
  check("opacityPulse produces the requested number of steps", steps.length === 4);
  check("...ending exactly at the target opacity", steps[steps.length - 1].opacity === 100);
  check("...ending exactly at the target delay", steps[steps.length - 1].delayMs === 200);
  check("...monotonically increasing when ramping up", steps.every((s, i) => i === 0 || s.opacity >= steps[i - 1].opacity));
  check("...monotonically increasing delays", steps.every((s, i) => i === 0 || s.delayMs > steps[i - 1].delayMs));
}
{
  const steps = opacityPulse(100, 0, 3, 180);
  check("a fade-out ramps down to exactly zero", steps[steps.length - 1].opacity === 0);
  check("...monotonically decreasing when fading out", steps.every((s, i) => i === 0 || s.opacity <= steps[i - 1].opacity));
}
check("a single-step pulse still lands on the target", opacityPulse(40, 100, 1, 90)[0].opacity === 100);

// Reconciliation. These two functions are the entire duplicate story.
check("an exact match supersedes", supersedes("Distribution", "distribution") === true);
check("a richer real mark supersedes a thinner guess", supersedes("AI Agents", "agents") === true);
check("a thinner real mark supersedes a richer guess", supersedes("agents", "AI Agents") === true);
check("an unrelated mark does not supersede", supersedes("Retention", "distribution") === false);

check(
  "a guess whose words survive the final is confirmed",
  confirmedByFinal("distribution channels", "The problem is distribution channels, mostly.") === true,
);
check(
  "a guess the final revised away is not confirmed",
  confirmedByFinal("distribution channels", "The problem is discipline, mostly.") === false,
);
check(
  "an empty guess is never confirmed",
  confirmedByFinal("", "anything at all") === false,
);

// ------------------------------------------------- early voice commands (phase 8)
//
// The asymmetry: firing 300ms early is a small win, firing a command that was
// never spoken destroys work invisibly. Every one of these is a false-positive
// guard.

section("early voice commands");

check("an exact stable command fires early", earlyVoiceCommand("scratch that") === "undo");
check("undo fires early", earlyVoiceCommand("undo") === "undo");
check("new page fires early", earlyVoiceCommand("new page") === "new-page");
check("trailing punctuation is tolerated", earlyVoiceCommand("scratch that.") === "undo");
check("casing is tolerated", earlyVoiceCommand("Scratch That") === "undo");

check("a bare prefix does NOT fire", earlyVoiceCommand("scratch") === null);
check("a command inside a sentence does NOT fire", earlyVoiceCommand("scratch that idea") === null);
check("a longer sentence does NOT fire", earlyVoiceCommand("let me scratch that for a second") === null);
check("'understand' does NOT fire undo", earlyVoiceCommand("understand") === null);
check("'under' does NOT fire undo", earlyVoiceCommand("under") === null);
check("'new' alone does NOT fire a page turn", earlyVoiceCommand("new") === null);
check("'new pages' does NOT fire a page turn", earlyVoiceCommand("new pages") === null);
check("'a new page for this' does NOT fire", earlyVoiceCommand("a new page for this") === null);
check("a trailing comma means the speaker is still going", earlyVoiceCommand("undo,") === null);
check("empty text does not fire", earlyVoiceCommand("   ") === null);

// The early and late matchers must agree exactly, or a command would mean
// different things depending on how fast Deepgram finalised.
for (const phrase of ["scratch that", "remove that", "undo", "new page", "new scene"]) {
  check(`early and final agree on "${phrase}"`, earlyVoiceCommand(phrase) === localVoiceCommand(phrase));
}

// ------------------------------------------------------ latency recorder (phase 1)

section("latency recorder");

{
  const rec = new LatencyRecorder();
  check("an unmeasured span is null, not zero", rec.span("start_pressed", "socket_open") === null);
  rec.mark("start_pressed", 1000);
  check("a half-measured span is still null", rec.span("start_pressed", "socket_open") === null);
  rec.mark("socket_open", 1700);
  check("a measured span is reported", rec.span("start_pressed", "socket_open") === 700);
  rec.mark("start_pressed", 5000);
  check("a milestone is first-write-wins", rec.span("start_pressed", "socket_open") === 700);
}

{
  const rec = new LatencyRecorder();
  check("an unmeasured percentile is null", rec.quantile("lag", 0.5) === null);
  for (const value of [100, 200, 300, 400, 500]) rec.observe("lag", value);
  check("a measured p50 is reported", rec.quantile("lag", 0.5) === 300);
  check("a measured max is reported", rec.max("lag") === 500);
  rec.observe("lag", Number.NaN);
  rec.observe("lag", Number.POSITIVE_INFINITY);
  check("non-finite samples are refused", rec.sampleCount("lag") === 5);
}

{
  const rec = new LatencyRecorder();
  rec.mark("socket_open", 2000);
  rec.mark("start_pressed", 3000);
  check("an out-of-order span reports nothing rather than a negative", rec.span("start_pressed", "socket_open") === null);
}

{
  const summary = new LatencyRecorder().summary();
  const text = formatLatencySummary(summary);
  check("an empty summary invents no numbers", /\d+ ms/.test(text) === false);
  check("...and says so plainly", text.includes("nothing measured yet"));
}

{
  const rec = new LatencyRecorder();
  rec.mark("start_pressed", 0);
  rec.mark("socket_open", 640);
  rec.observe("lag", 240);
  const text = formatLatencySummary(rec.summary());
  check("a measured row is printed", text.includes("640 ms"));
  check("...and unmeasured rows are omitted entirely", text.includes("Speech → Speculative mark") === false);
}

// ---------------------------------------------- latency sink — session id

section("latency sink — session id capture");

{
  // The bug: usage.stop() cleared the module-level active-session id as its
  // first action, then the caller recorded the closing latency summary
  // *after* that stop resolved — so by the time anything read the global, it
  // was already null, and the summary was silently dropped on every single
  // stop. The fix is that the summary's session id is captured explicitly at
  // record time (from what stop() itself returns) rather than re-read from
  // the mutable global at flush time. This reproduces exactly that timing:
  // the global is null throughout, standing in for "stop() already cleared
  // it," and only the explicit id passed to recordLatencySummary should
  // determine whether the row reaches the server.
  const calls = [];
  globalThis.window = {
    localStorage: {
      _store: new Map(),
      getItem(key) { return this._store.has(key) ? this._store.get(key) : null; },
      setItem(key, value) { this._store.set(key, value); },
      removeItem(key) { this._store.delete(key); },
    },
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => "" };
  };

  const { recordLatencySummary, flushLatency } = await import("../lib/latencySink.ts");
  const { LatencyRecorder } = await import("../lib/latency.ts");
  const summary = new LatencyRecorder().summary();

  recordLatencySummary(summary, "explicit-session-abc");
  flushLatency();
  check(
    "a summary with an explicit session id reaches the server even though the global is null",
    calls.length === 1 && calls[0].init.headers["x-inpublic-session-id"] === "explicit-session-abc",
    JSON.stringify(calls),
  );

  calls.length = 0;
  recordLatencySummary(summary, null);
  flushLatency();
  check(
    "a summary with no session id at all (never stopped from a real session) is dropped, not sent",
    calls.length === 0,
  );
}

// ------------------------------------------------------- comparison director

section("comparison director");

function boardWith(concepts) {
  const board = new SemanticBoard();
  for (const label of concepts) {
    board.addConcept({ conceptId: label.toLowerCase().replace(/\s+/g, "-"), label, sourceText: label, confidence: 0.9 });
  }
  return board;
}

{
  const board = boardWith(["Product", "Distribution"]);
  const before = board.concepts.size;
  const evidence = detectComparison(
    "You can have an incredible product, but without distribution it can still fail.",
    board,
    new Set(),
  );
  check("a real comparison between two known concepts is recognized", evidence !== null);
  check(
    "it resolves to the two existing concepts, not new ones",
    evidence?.leftConceptId === "product" && evidence?.rightConceptId === "distribution",
  );
  check("recognizing a comparison creates no new concepts", board.concepts.size === before);
}

{
  const board = boardWith(["Product", "Distribution"]);
  const evidence = detectComparison("Unlike distribution, product is something we control directly.", board, new Set());
  check("'unlike' is recognized as a comparison marker", evidence !== null);
}

{
  const board = boardWith(["Product", "Distribution"]);
  const evidence = detectComparison(
    "I'm not free now but I could talk later.",
    board,
    new Set(),
  );
  check(
    "a marker with no resolvable concepts on either side is rejected (precision over coverage)",
    evidence === null,
  );
}

{
  // Only one side resolves — must not fire.
  const board = boardWith(["Product"]);
  const evidence = detectComparison("Product is great but the weather today is nice.", board, new Set());
  check("a marker with only one resolvable concept is rejected", evidence === null);
}

{
  const board = boardWith(["Product", "Distribution"]);
  const key = comparisonPairKey("product", "distribution");
  const evidence = detectComparison(
    "Product is strong but distribution needs work.",
    board,
    new Set([key]),
  );
  check("a pair already formed this session does not re-trigger (Part 12: structure settles)", evidence === null);
}

{
  const board = boardWith(["Product", "Distribution"]);
  const evidence = detectComparison("Product is strong but Product is also strong.", board, new Set());
  check("both sides resolving to the same concept is rejected", evidence === null);
}

check(
  "the confidence threshold constant is a real, sane fraction",
  MIN_COMPARISON_CONFIDENCE > 0 && MIN_COMPARISON_CONFIDENCE < 1,
);

// ---------------------------------------------------- comparison choreographer

section("comparison choreographer layout");

{
  const left = { x: 100, y: 200, width: 180, height: 70 };
  const right = { x: 900, y: 500, width: 220, height: 70 };
  const layout = computeComparisonLayout(left, right, 0);
  const withinPage = (box, pos) =>
    pos.x >= 44 && pos.y >= 44 && pos.x + box.width <= 1040 - 44 && pos.y + box.height <= 780 - 44;
  check("the left target stays within page bounds", withinPage(left, layout.left));
  check("the right target stays within page bounds", withinPage(right, layout.right));
  check(
    "the two boxes don't overlap horizontally",
    layout.left.x + left.width <= layout.right.x || layout.right.x + right.width <= layout.left.x,
  );
  check("left lands left of right", layout.left.x < layout.right.x);
}

{
  const box = { x: 0, y: 0, width: 180, height: 70 };
  const a = computeComparisonLayout(box, box, 0);
  const b = computeComparisonLayout(box, box, 0);
  check(
    "layout is deterministic for identical inputs",
    a.left.x === b.left.x && a.left.y === b.left.y && a.right.x === b.right.x && a.right.y === b.right.y,
  );
}

{
  // A page turn shifts the whole layout by one page width — same relative geometry, different origin.
  const box = { x: 0, y: 0, width: 180, height: 70 };
  const page0 = computeComparisonLayout(box, box, 0);
  const page1 = computeComparisonLayout(box, box, 1);
  check(
    "a later page offsets the layout by the page stride, not a fixed absolute position",
    page1.left.x > page0.left.x,
  );
}

{
  // avoidBelowY pulls the layout above an active live-writing line.
  const box = { x: 0, y: 0, width: 180, height: 70 };
  const unconstrained = computeComparisonLayout(box, box, 0);
  const constrained = computeComparisonLayout(box, box, 0, 120);
  check(
    "a live-writing line above the default band pulls the layout up",
    constrained.left.y <= unconstrained.left.y,
  );
}

// ----------------------------------------------------------- director state

section("director state");

{
  // 10 disjoint pairs (20 concepts) so each beat creates its own hypothesis
  // instead of extending a shared chain — the only way to actually exercise
  // the eviction cap rather than trivially staying under it.
  const labels = Array.from({ length: 20 }, (_, i) => `Node${i}`);
  const board = boardWith(labels);
  let state = createDirectorState();
  let t = 1000;
  for (let i = 0; i < 10; i++) {
    const from = `Node${i * 2}`;
    const to = `Node${i * 2 + 1}`;
    const r = advanceDirector(state, board, `${from} then ${to}.`, t, new Set(), { comparisonEnabled: false });
    state = r.state;
    t += 100;
  }
  check(
    "active (non-committed) hypotheses never exceed the bounded cap of 8",
    state.processHypotheses.size <= 8,
    state.processHypotheses.size,
  );
  check("recentBeats never exceeds its bounded window of 8", state.recentBeats.length <= 8, state.recentBeats.length);
}

// ------------------------------------------------- process evidence gathering

section("process evidence accumulation");

{
  const board = boardWith(["Input", "Representation", "Layers"]);
  let state = createDirectorState();

  const r1 = advanceDirector(
    state,
    board,
    "We start with the input, then it becomes a representation.",
    1000,
    new Set(),
    { comparisonEnabled: false },
  );
  state = r1.state;
  check("a single directed edge alone waits — not enough evidence to commit", r1.intent.kind === "wait");

  const r2 = advanceDirector(
    state,
    board,
    "The representation then passes through layers.",
    4000,
    new Set(),
    { comparisonEnabled: false },
  );
  state = r2.state;
  check(
    "a second edge that extends the chain to 3 stages reaches the commit threshold",
    r2.intent.kind === "commit_process",
  );
  check(
    "committed stages are in the order they were observed",
    r2.intent.kind === "commit_process" &&
      JSON.stringify(r2.intent.stages) === JSON.stringify(["input", "representation", "layers"]),
  );
}

section("process WAIT under insufficient evidence");

{
  const board = boardWith(["Input", "Representation"]);
  const state = createDirectorState();
  const r = advanceDirector(state, board, "The input then becomes a representation.", 1000, new Set(), {
    comparisonEnabled: false,
  });
  check("one signal for a brand-new hypothesis is never enough to commit", r.intent.kind === "wait");
}

section("process hypothesis strengthening / weakening / abandonment");

{
  const board = boardWith(["Alpha", "Beta"]);
  let state = createDirectorState();

  const r1 = advanceDirector(state, board, "Alpha then beta.", 1000, new Set(), { comparisonEnabled: false });
  state = r1.state;
  check(
    "a brand-new hypothesis emits a 'created' telemetry event",
    r1.events.some((e) => e.type === "hypothesis" && e.event === "created"),
  );

  const r2 = advanceDirector(state, board, "Beta then alpha.", 4000, new Set(), { comparisonEnabled: false });
  state = r2.state;
  check(
    "a signal contradicting the established order weakens the hypothesis instead of abandoning it outright",
    r2.events.some((e) => e.type === "hypothesis" && e.event === "weakened"),
  );
  check("a single conflicting signal keeps the hypothesis alive", state.processHypotheses.size === 1);

  const r3 = advanceDirector(state, board, "Beta then alpha.", 7000, new Set(), { comparisonEnabled: false });
  state = r3.state;
  check(
    "enough consecutive conflicting signals in a row abandons the hypothesis",
    r3.events.some((e) => e.type === "hypothesis" && e.event === "abandoned"),
  );
  check("an abandoned hypothesis is removed from the active set", state.processHypotheses.size === 0);
}

section("process false-positive rejection");

{
  const board = boardWith(["Input"]);
  check(
    "a marker with no resolvable left clause is rejected (precision over coverage)",
    detectProcessSignal("Then we grabbed coffee.", board) === null,
  );
  check(
    "a marker with only one resolvable side is rejected",
    detectProcessSignal("The input then we relaxed for a while.", board) === null,
  );
}

{
  const board = boardWith(["Input"]);
  check(
    "both sides resolving to the same concept is rejected",
    detectProcessSignal("The input then the input.", board) === null,
  );
}

section("process ordering");

{
  // Deliberately alphabetically-unsorted labels: order must follow speech,
  // not the concepts' own ids.
  const board = boardWith(["Zebra", "Apple", "Mango"]);
  let state = createDirectorState();
  state = advanceDirector(state, board, "Zebra then apple.", 1000, new Set(), { comparisonEnabled: false }).state;
  const r = advanceDirector(state, board, "Apple then mango.", 4000, new Set(), { comparisonEnabled: false });
  check(
    "stage order follows the order concepts were spoken in, not alphabetical/id order",
    r.intent.kind === "commit_process" && JSON.stringify(r.intent.stages) === JSON.stringify(["zebra", "apple", "mango"]),
  );
}

section("process 3-stage / 4-6 stage commit");

{
  // Multi-character labels: lib/semantic.ts's tokens() filters out
  // length-1 words entirely, so single letters like "A"/"B" never match.
  const board = boardWith(["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf"]);
  let state = createDirectorState();
  const edges = [
    ["Alpha", "Bravo"],
    ["Bravo", "Charlie"],
    ["Charlie", "Delta"],
    ["Delta", "Echo"],
    ["Echo", "Foxtrot"],
    ["Foxtrot", "Golf"],
  ];
  let t = 1000;
  const intents = [];
  for (const [from, to] of edges) {
    const r = advanceDirector(state, board, `${from} then ${to}.`, t, new Set(), { comparisonEnabled: false });
    state = r.state;
    intents.push(r.intent);
    t += 3000; // comfortably clears the process cooldown between beats
  }
  check("exactly 3 stages reaches the commit threshold", intents[1].kind === "commit_process" && intents[1].stages.length === 3);
  check("growing to 6 stages keeps committing", intents[4].kind === "commit_process" && intents[4].stages.length === 6);
  check("a 7th stage exceeds the V1 cap and is never committed", intents[5].kind !== "commit_process", intents[5].kind);
}

section("comparison/process arbitration");

{
  // Build a sufficient process hypothesis across two beats, then a third
  // beat both reinforces that process AND contains a comparison marker
  // whose concepts overlap the process — process must win, comparison must
  // not fire this beat.
  const board = boardWith(["Build", "Design", "Distribute"]);
  let state = createDirectorState();
  state = advanceDirector(state, board, "Build then design.", 1000, new Set(), { comparisonEnabled: true }).state;
  state = advanceDirector(state, board, "Design then distribute.", 7000, new Set(), { comparisonEnabled: true }).state;

  const r = advanceDirector(
    state,
    board,
    "Design then distribute, but build is unlike distribute.",
    13000,
    new Set(),
    { comparisonEnabled: true },
  );
  check(
    "when process and comparison both have a claim on overlapping concepts, process wins",
    r.intent.kind === "commit_process" || r.intent.kind === "extend_process",
    r.intent.kind,
  );
  check(
    "arbitration is logged so the decision is observable",
    r.events.some((e) => e.type === "arbitration" && e.chose === "process"),
  );
}

{
  // A process hypothesis that never reaches "sufficient" must not block
  // comparison — zero regression from Director V1 being on.
  const board = boardWith(["Product", "Distribution"]);
  const state = createDirectorState();
  const r = advanceDirector(
    state,
    board,
    "You can have an incredible product, but without distribution it can still fail.",
    1000,
    new Set(),
    { comparisonEnabled: true },
  );
  check(
    "comparison fires normally when there is no competing sufficient process hypothesis",
    r.intent.kind === "commit_comparison",
  );
}

section("structural commitment / no repeated relayout");

{
  const board = boardWith(["Build", "Design", "Distribute"]);
  let state = createDirectorState();
  state = advanceDirector(state, board, "Build then design.", 1000, new Set(), { comparisonEnabled: false }).state;
  const committed = advanceDirector(state, board, "Design then distribute.", 4000, new Set(), {
    comparisonEnabled: false,
  });
  state = committed.state;
  check("three concepts observed across two beats commits a process", committed.intent.kind === "commit_process");

  // Mirrors what performProcess does on real success (components/Board.tsx).
  state = markProcessCommitted(state, committed.intent.kind === "commit_process" ? committed.intent.stages : []);

  const again = advanceDirector(state, board, "Design then distribute.", 8000, new Set(), {
    comparisonEnabled: false,
  });
  check(
    "repeating the same evidence after commit does not relayout the same structure again",
    again.intent.kind !== "commit_process",
    again.intent.kind,
  );
}

section("process choreographer layout");

{
  const boxes = [
    { x: 0, y: 0, width: 150, height: 60 },
    { x: 0, y: 0, width: 150, height: 60 },
    { x: 0, y: 0, width: 150, height: 60 },
  ];
  const layout = computeProcessLayout(boxes, 0);
  const withinPage = (box, pos) =>
    pos.x >= 44 && pos.y >= 44 && pos.x + box.width <= 1040 - 44 && pos.y + box.height <= 780 - 44;
  check("3 stages that comfortably fit choose horizontal orientation", layout.orientation === "horizontal");
  check("every stage stays within page bounds (3 stages)", boxes.every((b, i) => withinPage(b, layout.positions[i])));
  check(
    "stages don't overlap horizontally",
    layout.positions.every((p, i) => i === 0 || layout.positions[i - 1].x + boxes[i - 1].width <= p.x),
  );
}

{
  const boxes = Array.from({ length: 6 }, () => ({ x: 0, y: 0, width: 100, height: 60 }));
  const layout = computeProcessLayout(boxes, 0);
  const withinPage = (box, pos) =>
    pos.x >= 44 && pos.y >= 44 && pos.x + box.width <= 1040 - 44 && pos.y + box.height <= 780 - 44;
  check("every stage stays within page bounds (6 stages)", boxes.every((b, i) => withinPage(b, layout.positions[i])));
}

{
  // Too wide to fit side by side, but a stack of 4 does fit.
  const boxes = Array.from({ length: 4 }, () => ({ x: 0, y: 0, width: 400, height: 60 }));
  const layout = computeProcessLayout(boxes, 0);
  const withinPage = (box, pos) =>
    pos.x >= 44 && pos.y >= 44 && pos.x + box.width <= 1040 - 44 && pos.y + box.height <= 780 - 44;
  check("stages too wide to fit horizontally fall back to vertical stacking", layout.orientation === "vertical");
  check("stacked stages stay within page bounds", boxes.every((b, i) => withinPage(b, layout.positions[i])));
}

{
  const box = { x: 0, y: 0, width: 150, height: 60 };
  const boxes = [box, box, box];
  const a = computeProcessLayout(boxes, 0);
  const b = computeProcessLayout(boxes, 0);
  check("layout is deterministic for identical inputs", JSON.stringify(a) === JSON.stringify(b));
}

{
  const box = { x: 0, y: 0, width: 150, height: 60 };
  const boxes = [box, box, box];
  const page0 = computeProcessLayout(boxes, 0);
  const page1 = computeProcessLayout(boxes, 1);
  check(
    "a later page offsets the layout by the page stride, not a fixed absolute position",
    page1.positions[0].x > page0.positions[0].x,
  );
}

section("reflex independence");

{
  const speculativePath = fileURLToPath(new URL("../lib/speculative.ts", import.meta.url));
  const source = readFileSync(speculativePath, "utf8");
  check(
    "lib/speculative.ts (Reflex) has zero references to Director — the two tiers stay independent",
    !/director/i.test(source),
  );
}

// ------------------------------------------------------------------ results

console.log(`\n${"─".repeat(60)}`);
if (failures.length === 0) {
  console.log(`✓ ${pass} checks passed`);
} else {
  console.log(`${pass} passed, ${failures.length} FAILED:\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exitCode = 1;
}
