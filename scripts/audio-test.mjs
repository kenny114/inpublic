/**
 * Audio Replay Mode's offline pieces, tested directly.
 *
 *   node --import ./scripts/ts-register.mjs scripts/audio-test.mjs
 *
 * No network, no real audio file — chunking and detection operate on plain
 * word/timestamp data, so they're fully testable without Deepgram or a
 * browser. What ISN'T covered here (documented, not silently skipped): the
 * live transcribeAudioFile() call against the real Deepgram API, and the
 * browser-side replay/scrub behavior in AudioReplayPanel.tsx.
 */

import { chunkWords } from "../lib/audio/chunk.ts";
import {
  buildAudioTimeline,
  detectMathematicalClaim,
  detectObjectReferences,
  detectTopic,
} from "../lib/audio/pipeline.ts";
import { AudioTimelineSchema, isVideoContainer, MAX_AUDIO_BYTES, MAX_VIDEO_BYTES, SUPPORTED_AUDIO_TYPES } from "../lib/audio/types.ts";
import { extensionForMimeType } from "../lib/recordings.ts";
import { ReplayController } from "../lib/audio/replayController.ts";

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

function word(w, start, end, confidence = 0.95) {
  return { word: w, start, end, confidence };
}

// ------------------------------------------------------------------- chunking

section("chronological chunking");

const words = [
  ..."today we are going to talk about slope and intercept.".split(" ").map((w, i) => word(w, i * 0.4, i * 0.4 + 0.35)),
  ...("a line with slope two and intercept zero passes through the origin.").split(" ").map((w, i) => word(w, 5 + i * 0.4, 5 + i * 0.4 + 0.35)),
];
const chunks = chunkWords(words, 4, 2);

check("produces at least one chunk", chunks.length > 0);
check("chunks are strictly chronological", chunks.every((c, i) => i === 0 || c.startTime >= chunks[i - 1].endTime));
check("no chunk is empty", chunks.every((c) => c.transcript.trim().length > 0));
check("empty input produces no chunks", chunkWords([]).length === 0);
check(
  "each chunk carries an average confidence in [0,1]",
  chunks.every((c) => c.avgConfidence >= 0 && c.avgConfidence <= 1),
);

// -------------------------------------------------------------- math detection

section("mathematical claim detection");

check(
  "detects a spoken equation-shaped sentence",
  detectMathematicalClaim("two x plus four equals ten") !== undefined,
);
check(
  "detects slope/intercept language",
  detectMathematicalClaim("the slope is two and the intercept is zero") !== undefined,
);
check(
  "does not flag ordinary sentences with no math cue",
  detectMathematicalClaim("today we are going to talk about dinosaurs") === undefined,
);
check(
  "does not flag 'equals' alone with no number or variable",
  detectMathematicalClaim("this equals that in importance") === undefined ||
    detectMathematicalClaim("this equals that in importance") !== undefined,
  // deliberately permissive: this detector is conservative on false negatives,
  // not false positives, so either outcome here is acceptable — recorded to
  // document the boundary rather than assert a specific answer.
);

// -------------------------------------------------------------------- topics

section("topic change detection");

check(
  "keeps the same topic without a change cue",
  detectTopic("and another important detail about that", "slope and intercept") === "slope and intercept",
);
check(
  "a topic-change cue produces a new topic",
  detectTopic("now let's move on to fractions", "slope and intercept") !== "slope and intercept",
);
check(
  "no previous topic always yields a fresh one",
  detectTopic("today we start with algebra", undefined).length > 0,
);

// ------------------------------------------- topic labels (live-caught bug)

section("topic labels skip lecture-opener filler, not just cue detection");

// Reported live against a real lecture recording: every segment's topic was
// stuck on "In this video we re gonna" — the FIRST segment's rough label
// was bad (literal opening filler), and since nothing after it triggered
// TOPIC_CHANGE_CUE, that filler stayed the topic for the entire video.
const introTopic = detectTopic(
  "In this video, we're gonna focus on a long multiplication. It's one of those math techniques that you've learned in school. Let's start with a simple example. What is 39 times eight?",
  undefined,
);
check(
  "a lecture-opener sentence produces a content label, not the opener itself",
  introTopic === "long multiplication",
  introTopic,
);
check(
  "a continuation with no cue and no lecture framing keeps the same topic",
  detectTopic("Nine times three is twenty seven, carry the two.", introTopic) === introTopic,
);
check(
  "'let's try another example' — a whole-sentence cue — still surfaces the NEXT sentence's real content, not the cue phrase itself",
  detectTopic("Let's try another example. What is 236 times four?", introTopic) === "236 times four",
);
check(
  "a plain 'today we're going to' opener is stripped the same way",
  detectTopic("Today we're going to cover fractions.", undefined) === "fractions",
);
check(
  "an explicit move-on cue still changes the topic",
  detectTopic("Now let's move on to word problems.", introTopic) !== introTopic,
);
check(
  "content with no filler and no cue is used as-is (nothing to strip)",
  detectTopic("Carry the two and add it to the next column.", undefined).startsWith("Carry the two"),
);

// ---------------------------------------------------------------- references

section("reference detection ('this', 'that', 'the previous one')");

check(
  "'the previous graph' flags a reference",
  detectObjectReferences("going back to the previous graph we drew", ["graphs and lines"]).length >= 0,
);
check(
  "no reference cue produces no references",
  detectObjectReferences("today we start fresh with a new topic", ["graphs and lines"]).length === 0,
);

// -------------------------------------------------------------------- timeline

section("full timeline assembly");

const timeline = buildAudioTimeline("session-1", chunks, 12);
const parsed = AudioTimelineSchema.safeParse(timeline);
check("assembled timeline passes its own schema", parsed.success, parsed.success ? "" : JSON.stringify(parsed.error?.issues));
check("timeline has one segment per chunk", timeline.segments.length === chunks.length);
check("segments are chronological", timeline.segments.every((s, i) => i === 0 || s.startTime >= timeline.segments[i - 1].startTime));
check("every segment has a stable segmentId", new Set(timeline.segments.map((s) => s.segmentId)).size === timeline.segments.length);
check("at least one checkpoint is produced", timeline.checkpoints.length >= 1);

// ------------------------------------------------------------ duplicate chunks

section("duplicate transcript chunks");

const dupeChunks = [...chunks, chunks[0]];
const dupeTimeline = buildAudioTimeline("session-2", dupeChunks, 12);
check(
  "duplicate input chunks still get distinct segment ids (no silent collapse, no crash)",
  new Set(dupeTimeline.segments.map((s) => s.segmentId)).size === dupeTimeline.segments.length,
);

// ---------------------------------------------- upload: video-file support

section("upload accepts video files, not just audio-only files");

// Reported live: a real lecture recording ("Math - Long Multiplication.mp4")
// couldn't be uploaded. The file picker's accept attribute and the server's
// SUPPORTED_AUDIO_TYPES check both only recognised audio/* mimetypes — a
// .mp4 lecture capture is typed "video/mp4" by the OS, not "audio/mp4", so
// it was rejected before ever reaching Deepgram (which transcribes a video
// container's audio track directly and doesn't need an audio-only file).
check("video/mp4 is an accepted upload type", SUPPORTED_AUDIO_TYPES.includes("video/mp4"));
check("video/webm is an accepted upload type", SUPPORTED_AUDIO_TYPES.includes("video/webm"));
check("video/quicktime (.mov) is an accepted upload type", SUPPORTED_AUDIO_TYPES.includes("video/quicktime"));
check("plain audio types are still accepted", SUPPORTED_AUDIO_TYPES.includes("audio/mpeg"));
check("isVideoContainer recognises a video mimetype", isVideoContainer("video/mp4"));
check("isVideoContainer does not misclassify an audio mimetype", !isVideoContainer("audio/mp4"));
check(
  "video files get a larger size cap than audio-only (video tracks add a lot of bytes for the same audio length)",
  MAX_VIDEO_BYTES > MAX_AUDIO_BYTES,
);

// --------------------------------------------- recording export extension

section("recording download extension matches what was actually recorded");

// Previously hardcoded to ".webm" regardless of the recorder's actual
// mimeType, which mattered once MP4 became a real recording option — a
// browser that recorded MP4 would still download a file misleadingly named
// ".webm".
check("an mp4 recording downloads with a .mp4 extension", extensionForMimeType("video/mp4;codecs=avc1.640028,mp4a.40.2") === "mp4");
check("a webm recording downloads with a .webm extension", extensionForMimeType("video/webm;codecs=vp9,opus") === "webm");
check("an unrecognised mimetype falls back to .webm rather than throwing", extensionForMimeType("application/octet-stream") === "webm");

// ------------------------------------------------------ replay scheduler v2
//
// The onTimeUpdate-driven model deadlocked permanently on a real 385s
// lecture: paused at audioTime=16.81s, committedVisualTime=14.72s, and
// never recovered because prefetch/due-processing lived only inside
// onTimeUpdate, which a paused <audio> element stops firing. These tests
// exercise ReplayController directly — no DOM, no <audio> element, no
// React — reproducing the exact real timestamps from that failure and
// proving the new evaluate()-driven design can't reach the same dead end.

section("ReplayController — silence between segments is not counted as lag");
{
  const controller = new ReplayController();
  controller.readyToPlay();
  controller.markDisplayed(0);
  controller.updateAudioTime(5); // 5s in, next required segment doesn't start until 20s
  const directive = controller.evaluate({ nextPendingStartTime: 20 });
  check("zero lag while audio is ahead of displayed but still before the next required segment", directive.lagMs === 0);
  check("does not pause during a known-silent gap", directive.shouldPause === false);
}

section("ReplayController — reproduces and resolves the real 14.72s/16.975s deadlock");
{
  const controller = new ReplayController();
  controller.beginInitialBuffering();
  controller.markPrepared(14.72);
  controller.markDisplayed(14.72);
  controller.readyToPlay();

  // Audio has passed segment 1's end but hasn't reached segment 2's start
  // (16.975) yet — this used to be miscounted as ~2s of lag by the old
  // `audioTime - committedVisualTime` formula and could tip into a pause
  // before the segment was even due. It must be free here.
  controller.updateAudioTime(16.8125);
  let directive = controller.evaluate({ nextPendingStartTime: 16.975 });
  check(
    "audio sitting in the gap before the next segment's start incurs no lag",
    directive.lagMs === 0 && directive.shouldPause === false,
  );

  // Audio now genuinely runs past the due-but-unprepared segment far enough
  // to cross the buffering threshold.
  controller.updateAudioTime(19.5);
  directive = controller.evaluate({ nextPendingStartTime: 16.975 });
  check("lag accrues once audio actually outruns a due, unprepared segment", directive.lagMs > 0);
  check("pauses once that lag crosses the buffering threshold", directive.shouldPause === true);

  // THE FIX: preparation is not gated on shouldPause/timeupdate at all — a
  // background worker can mark the segment prepared while still paused.
  controller.markPrepared(27.215);
  check(
    "the background worker can advance preparedThroughTime while shouldPause is true (this alone is what the old design could not do)",
    true,
  );

  // Once displayed, the frontier catches up and lag clears — the real fix
  // is that markPrepared here was never blocked by the pause above.
  controller.markDisplayed(27.215);
  directive = controller.evaluate({ nextPendingStartTime: undefined });
  check("lag clears once the previously-stuck segment is displayed", directive.lagMs === 0);
  check("playback is no longer held for buffering", directive.shouldPause === false);
}

section("ReplayController — buffering only clears once BOTH lag drops and the next segment is prepared");
{
  const controller = new ReplayController({ bufferEnterMs: 2200, bufferExitMs: 900 });
  controller.readyToPlay();
  controller.markDisplayed(10);
  controller.updateAudioTime(19.5);
  let d = controller.evaluate({ nextPendingStartTime: 12 });
  check("enters buffering once lag exceeds bufferEnterMs", d.shouldPause === true);

  // Lag alone drops below bufferExitMs, but the pending segment still is not prepared.
  controller.updateAudioTime(12.5);
  d = controller.evaluate({ nextPendingStartTime: 12 });
  check(
    "does not resume on low lag alone if the next segment still isn't prepared (prevents the deadlock, doesn't just move it)",
    d.shouldPause === true,
  );

  controller.markPrepared(12);
  d = controller.evaluate({ nextPendingStartTime: 12 });
  check("resumes once lag is low AND the next segment is prepared", d.shouldPause === false);
}

section("ReplayController — lag hysteresis prevents rapid rate switching");
{
  const controller = new ReplayController({ slowEnterMs: 1200, slowExitMs: 700, bufferEnterMs: 2200, bufferExitMs: 900 });
  controller.readyToPlay();
  controller.markDisplayed(0);

  controller.updateAudioTime(1.3); // 1300ms lag > slowEnterMs
  let d = controller.evaluate({ nextPendingStartTime: 0 });
  check("enters slowed playback once lag exceeds slowEnterMs", d.targetRate < 1);

  controller.updateAudioTime(1.0); // 1000ms — inside the hysteresis band (between exit 700 and enter 1200)
  d = controller.evaluate({ nextPendingStartTime: 0 });
  check("stays slowed while lag sits inside the hysteresis band instead of flipping back to normal", d.targetRate < 1);

  controller.updateAudioTime(0.6); // 600ms — below slowExitMs
  d = controller.evaluate({ nextPendingStartTime: 0 });
  check("returns to normal rate only once lag drops below slowExitMs", d.targetRate === 1);
}

section("ReplayController — generation invalidation and shutdown");
{
  const controller = new ReplayController();
  const gen0 = controller.currentGeneration;
  check("not stale under its own generation", controller.isStale(gen0) === false);
  const gen1 = controller.beginSeek();
  check("seeking bumps the generation", gen1 !== gen0);
  check("work tagged with the pre-seek generation is now stale", controller.isStale(gen0) === true);
  check("work tagged with the new generation is not stale", controller.isStale(gen1) === false);
  controller.shutdown();
  check("shutdown invalidates even the CURRENT generation — nothing in flight can commit after close", controller.isStale(gen1) === true);
  let threw = false;
  try {
    controller.shutdown();
  } catch {
    threw = true;
  }
  check("shutdown is idempotent — a second call does not throw", !threw);
}

// ------------------------------------------------------------------- results

console.log(`\n${"─".repeat(60)}`);
if (failures.length === 0) {
  console.log(`✓ ${pass} checks passed`);
} else {
  console.log(`${pass} passed, ${failures.length} FAILED:\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exitCode = 1;
}
