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
import { decidePageTurn, isThoughtComplete, MAX_DEFER_MS, suppressPageTurnDuringInitialComposition } from "../lib/pagination.ts";
import { emptyUndo, SemanticBoard } from "../lib/semantic.ts";
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
import { LatencyRecorder, formatLatencySummary } from "../lib/latency.ts";
import { chunkToInkSample, liveLatencySample } from "../lib/telemetry.ts";
import { opacityPulse } from "../lib/pulse.ts";
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

check(
  "initial composition never suppresses a hard overflow turn",
  !suppressPageTurnDuringInitialComposition("overflow", true),
);
check(
  "initial composition still suppresses non-overflow composition turns",
  ["capacity", "section", "long-utterance"].every((trigger) => suppressPageTurnDuringInitialComposition(trigger, true)),
);

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

// --------------------------------------- guest/authenticated persistence split

section("guest persistence — local first, remote only when authenticated");

{
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const originalFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const localRows = new Map();
  const remoteCalls = [];

  const database = {
    objectStoreNames: { contains: () => true },
    transaction() {
      const transaction = {
        oncomplete: null,
        onerror: null,
        error: null,
        objectStore() {
          return { put(value, key) { localRows.set(key, value); } };
        },
      };
      queueMicrotask(() => transaction.oncomplete?.());
      return transaction;
    },
    close() {},
  };

  Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
  Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open() {
        const request = { result: database, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    },
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (url, init) => {
      remoteCalls.push({ url, init });
      return {
        ok: true,
        status: 201,
        json: async () => ({ project: { cloudUpdatedAt: "2026-08-17T00:00:00.000Z" } }),
      };
    },
  });

  const { saveSession } = await import("../lib/persist.ts");
  const session = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    savedAt: Date.now(),
    startedAt: null,
    page: 0,
    elements: [],
    semantic: { concepts: [], relationships: [], sections: [], operations: [] },
    log: [],
  };

  await saveSession(session, { syncCloud: false });
  check(
    "guest save writes current and session IndexedDB records without /api/projects",
    remoteCalls.length === 0 && localRows.has("current") && localRows.has(`session:${session.id}`),
    JSON.stringify({ calls: remoteCalls.length, keys: [...localRows.keys()] }),
  );

  await saveSession(session);
  check(
    "authenticated save keeps the existing /api/projects POST",
    remoteCalls.length === 1 && remoteCalls[0].url === "/api/projects" && remoteCalls[0].init.method === "POST",
    JSON.stringify(remoteCalls),
  );

  const restore = (name, descriptor) => descriptor
    ? Object.defineProperty(globalThis, name, descriptor)
    : Reflect.deleteProperty(globalThis, name);
  restore("window", originalWindow);
  restore("navigator", originalNavigator);
  restore("indexedDB", originalIndexedDb);
  restore("fetch", originalFetch);
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

  const { recordLatencySummary, flushLatency, storedLatencySamples } = await import("../lib/latencySink.ts");
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
  const locallyStoredBeforeGuest = storedLatencySamples().length;
  recordLatencySummary(summary, "anonymous-lease-id", null, false);
  flushLatency();
  check(
    "an anonymous summary remains local but never calls authenticated telemetry",
    calls.length === 0 && storedLatencySamples().length === locallyStoredBeforeGuest + 1,
    JSON.stringify({ calls, stored: storedLatencySamples().length }),
  );

  recordLatencySummary(summary, null);
  flushLatency();
  check(
    "a summary with no session id at all (never stopped from a real session) is dropped, not sent",
    calls.length === 0,
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
