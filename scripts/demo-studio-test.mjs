import assert from "node:assert/strict";
import {
  DEMO_MAX_DURATION_MS,
  DemoRunGate,
  assertVisible,
  captureMayComplete,
  containerFailures,
  frameDifference,
  frozenSuffixDuration,
  supportedDemoFormat,
  validateDecodedAudio,
  validateEventPixels,
} from "../lib/demoStudio.ts";

assert.equal(supportedDemoFormat("note.wav", ""), "WAV");
assert.equal(supportedDemoFormat("note.mp3", "application/octet-stream"), "MP3");
assert.equal(supportedDemoFormat("WhatsApp Audio.opus", "audio/ogg; codecs=opus"), "OGG/OPUS");
assert.equal(supportedDemoFormat("note.m4a", "audio/mp4"), null);

validateDecodedAudio(DEMO_MAX_DURATION_MS, 1, new Float32Array([0, .1]));
assert.throws(() => validateDecodedAudio(DEMO_MAX_DURATION_MS + 1, 1, new Float32Array([0])), /90 SECOND/);
assert.throws(() => validateDecodedAudio(0, 1, new Float32Array([0])), /DURATION/);
assert.throws(() => validateDecodedAudio(1_000, 0, new Float32Array([0])), /NO CHANNEL/);
assert.throws(() => validateDecodedAudio(1_000, 1, new Float32Array([Number.NaN])), /PCM/);
assert.doesNotThrow(() => assertVisible("visible"));
assert.throws(() => assertVisible("hidden"), /NOT VISIBLE/);

const gate = new DemoRunGate();
const first = gate.begin();
assert.throws(() => gate.begin(), /ALREADY ACTIVE/);
assert.equal(gate.isCurrent(first), true);
gate.end(first);
const second = gate.begin();
assert.notEqual(first, second);
gate.end(second);

const white = new Uint8Array(16).fill(255);
const black = new Uint8Array(16).fill(0);
assert.equal(frameDifference(white, white), 0);
assert.equal(frameDifference(white, black), 1);
assert.equal(frozenSuffixDuration([{ atMs: 0, hash: black }, { atMs: 250, hash: white }, { atMs: 500, hash: white }]), 250);

const pageEvent = { t: 500, type: "page", index: 1, reason: "overflow", why: "test", midThought: false };
const moving = [
  { atMs: 0, hash: black },
  { atMs: 500, hash: black },
  { atMs: 750, hash: white },
];
assert.equal(validateEventPixels([pageEvent], moving, 0)[0].passed, true);
assert.equal(validateEventPixels([pageEvent], moving.map((sample) => ({ ...sample, hash: white })), 0)[0].passed, false);

assert.deepEqual(containerFailures({ decoded: false, widthMatches: true, fps: 30, audioTrackPresent: true, audioPeak: .1, durationDeltaMs: 0 }), ["VIDEO FAILED DECODE"]);
assert.deepEqual(containerFailures({ decoded: true, widthMatches: true, fps: 30, audioTrackPresent: false, audioPeak: 0, durationDeltaMs: 0 }), ["AUDIO TRACK MISSING"]);
assert.equal(captureMayComplete("VALIDATING", []), true);
assert.equal(captureMayComplete("FAILED", []), false);
assert.equal(captureMayComplete("VALIDATING", ["VIDEO FAILED DECODE"]), false);

console.log("demo studio tests: passed");
