/**
 * Scribe scheduling, replayed over the three real demo scripts.
 *
 *   node --import ./scripts/ts-register.mjs scripts/latency-benchmark.mjs
 *
 * ## What this does and does not measure
 *
 * It measures the SCHEDULER: how many model calls each policy makes, and how
 * long the board stays silent after words are ready to draw. Those are pure
 * functions of the transcript and the clock, so replaying them is exact.
 *
 * It does NOT measure the network, Deepgram, Anthropic, or the browser. No
 * number this script prints is an end-to-end latency. For those, run the real
 * capture in docs/demo-capture.md and read the `latency` event out of the
 * session log.
 *
 * ## Where the timings come from
 *
 * The scripts are the exact text played into three real captures, and
 * output/demo-runs/demo-*.json records how long each capture's audio actually
 * ran. Word timings are interpolated at the measured speaking rate for that
 * capture — so the transcript and the total duration are real, and the
 * distribution of words within it is an even-rate approximation. That
 * approximation is fine for counting calls and comparing two policies against
 * the same input; it is not fine for anything else, which is why nothing else
 * is claimed.
 */

import { readFileSync } from "node:fs";
import { VISUAL_DEMOS } from "../lib/demos.ts";
import { shouldWakeScribe } from "../lib/scribeScheduler.ts";
import { requestDelayMs } from "../lib/requestScheduling.ts";
import { emptySpeculativeState, recognizeSpeculative } from "../lib/speculative.ts";

const OLD_INTERVAL_MS = 5250;
const NEW_INTERVAL_MS = 1200;

/**
 * How often Deepgram hands back a final.
 *
 * This is the variable the whole comparison turns on, so it is replayed at two
 * granularities rather than guessed at once:
 *
 * - `sentence` — finals only at full stops. Matches unhurried, well-separated
 *   speech, which is what the three demo scripts are.
 * - `clause`   — finals at commas too. `endpointing: 150` means Deepgram
 *   finalises after 150ms of silence, and an ordinary speaker pauses at commas
 *   for longer than that, so this is the realistic cadence for someone
 *   explaining something continuously.
 *
 * The old 5250ms cooldown only binds when finals arrive closer together than
 * 5.25s, so the two granularities give very different answers. Reporting only
 * the flattering one would be the easiest way to lie with this script.
 */
function segments(script, granularity) {
  const pattern = granularity === "clause" ? /(?<=[.!?,;:])\s+/ : /(?<=[.!?])\s+/;
  return script
    .split(pattern)
    .map((s) => s.trim())
    .filter(Boolean);
}

function runDurationSeconds(id) {
  try {
    const raw = readFileSync(new URL(`../output/demo-runs/${id}.json`, import.meta.url), "utf8");
    return JSON.parse(raw).audioSeconds ?? null;
  } catch {
    return null;
  }
}

/**
 * Replay one policy over one script.
 *
 * `gated` selects the new behaviour: the same cooldown arithmetic, plus the
 * content check that refuses a wake-up carrying nothing new to draw.
 */
function replay(script, { intervalMs, gated, audioSeconds, granularity }) {
  const parts = segments(script, granularity);
  const totalWords = script.split(/\s+/).filter(Boolean).length;
  const msPerWord = (audioSeconds * 1000) / totalWords;

  let clock = 0;
  let lastRunAt = -Infinity;
  let lastSent = "";
  let pending = "";
  const onPage = [];
  let calls = 0;
  let totalSilenceMs = 0;
  const waits = [];

  for (const sentence of parts) {
    // The sentence lands when its last word has been spoken.
    clock += sentence.split(/\s+/).filter(Boolean).length * msPerWord;
    pending = `${pending} ${sentence}`.trim();
    const readyAt = clock;

    if (gated) {
      const decision = shouldWakeScribe({
        fresh: pending,
        lastSent,
        onPage,
        inFlight: false,
        attentionBudgetFull: false,
      });
      if (!decision.wake) {
        pending = "";
        continue;
      }
    }

    const wait = requestDelayMs({
      nowMs: clock,
      lastRunAtMs: lastRunAt === -Infinity ? -intervalMs : lastRunAt,
      retryAtMs: 0,
      lastPointerAtMs: -Infinity,
      minIntervalMs: intervalMs,
      touchLockMs: 0,
    });

    const firedAt = clock + wait;
    calls += 1;
    lastRunAt = firedAt;
    lastSent = pending;
    // Stand in for what the Scribe letters, so the content gate has something
    // to consider already-drawn on later sentences.
    for (const word of pending.split(/\s+/).filter((w) => w.length > 5)) onPage.push(word);
    pending = "";

    const silence = firedAt - readyAt;
    totalSilenceMs += silence;
    waits.push(Math.round(silence));
  }

  return {
    calls,
    waits,
    worstWaitMs: waits.length ? Math.max(...waits) : 0,
    meanWaitMs: waits.length ? Math.round(totalSilenceMs / waits.length) : 0,
  };
}

const mean = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

console.log("Scribe scheduling replayed over the three real demo scripts.");
console.log("Call counts and queue waits only — NOT end-to-end latency.");

for (const granularity of ["sentence", "clause"]) {
  console.log(`\n${"═".repeat(64)}`);
  console.log(
    granularity === "sentence"
      ? "FINALS AT SENTENCE BOUNDARIES — unhurried, well-separated speech"
      : "FINALS AT CLAUSE BOUNDARIES — continuous speech (endpointing: 150)",
  );
  console.log("═".repeat(64));

  let oldCalls = 0;
  let newCalls = 0;
  let ungatedCalls = 0;
  const oldWaits = [];
  const newWaits = [];

  for (const demo of VISUAL_DEMOS) {
    const audioSeconds = runDurationSeconds(demo.id);
    if (audioSeconds === null) {
      console.log(`${demo.id}: no recorded run in output/demo-runs — skipped.`);
      continue;
    }
    const before = replay(demo.script, { intervalMs: OLD_INTERVAL_MS, gated: false, audioSeconds, granularity });
    // The control arm: the new, shorter cooldown WITHOUT the content gate.
    // Without this the benchmark cannot say whether the gate is doing anything
    // or whether the interval alone accounts for the whole result.
    const ungated = replay(demo.script, { intervalMs: NEW_INTERVAL_MS, gated: false, audioSeconds, granularity });
    const after = replay(demo.script, { intervalMs: NEW_INTERVAL_MS, gated: true, audioSeconds, granularity });
    oldCalls += before.calls;
    newCalls += after.calls;
    ungatedCalls += ungated.calls;
    oldWaits.push(...before.waits);
    newWaits.push(...after.waits);

    console.log(`\n${demo.id} — ${demo.title} (${audioSeconds}s of real audio)`);
    console.log(`  BEFORE      ${String(before.calls).padStart(2)} calls   mean wait ${String(before.meanWaitMs).padStart(5)} ms   worst ${String(before.worstWaitMs).padStart(5)} ms`);
    console.log(`  1200ms only ${String(ungated.calls).padStart(2)} calls   mean wait ${String(ungated.meanWaitMs).padStart(5)} ms   worst ${String(ungated.worstWaitMs).padStart(5)} ms`);
    console.log(`  AFTER       ${String(after.calls).padStart(2)} calls   mean wait ${String(after.meanWaitMs).padStart(5)} ms   worst ${String(after.worstWaitMs).padStart(5)} ms`);
  }

  console.log(`\n  TOTAL   model calls ${oldCalls} → ${newCalls}  (ungated 1200ms would be ${ungatedCalls})`);
  console.log(`          mean queue wait ${mean(oldWaits)} ms → ${mean(newWaits)} ms`);
  console.log(`          worst queue wait ${oldWaits.length ? Math.max(...oldWaits) : 0} ms → ${newWaits.length ? Math.max(...newWaits) : 0} ms`);
}

console.log("\nQueue wait is the time between words being ready to draw and the");
console.log("request going out. It is the part of Scribe latency the scheduler");
console.log("controls; model time (760-930 ms measured previously) is on top.");

/**
 * REFLEX (Tier 2) main-thread cost — Part 12 of the Reflex brief.
 *
 * This is a REAL measurement, not a replay: `recognizeSpeculative` is the
 * actual function Board.tsx calls from inside the `setTimeout(0)` in
 * `handleInterim`, run here with `performance.now()` around it, same as
 * every other real number in this repo's benchmarks. It answers exactly the
 * question Part 12 asks: is Reflex cheap? Not "how much does the whole
 * pipeline cost" (that needs a browser and Excalidraw, which this script
 * deliberately does not have — see the file header) but "does the one piece
 * that runs synchronously on the main thread, deferred behind writeLive,
 * cost anything worth worrying about."
 *
 * `features.reflex = false` is a structural comparison, not a timed one:
 * with the flag off, Board.tsx never calls this function at all (see the
 * `if (fresh && features.reflex)` guard in handleInterim), so "Reflex OFF"
 * cost is exactly 0ms by construction — there's nothing to time.
 */
console.log(`\n${"═".repeat(64)}`);
console.log("REFLEX (TIER 2) MAIN-THREAD COST — recognizeSpeculative, real timing");
console.log("═".repeat(64));

function reflexCostForScript(script) {
  const words = script.split(/\s+/).filter(Boolean);
  let state = emptySpeculativeState();
  const onBoard = [];
  let utterance = "";
  const durationsMs = [];

  // Settle 3-6 words at a time, the same granularity handleInterim uses
  // (the newly-agreed-on prefix since the last call, not the whole thing).
  let i = 0;
  while (i < words.length) {
    const chunkLen = 3 + (i % 4);
    const chunk = words.slice(i, i + chunkLen).join(" ");
    i += chunkLen;
    utterance = `${utterance} ${chunk}`.trim();

    const startedAt = performance.now();
    const result = recognizeSpeculative(state, {
      settledText: chunk,
      utteranceText: utterance,
      confidence: 0.9,
      onBoard,
    });
    durationsMs.push(performance.now() - startedAt);
    state = result.state;
    for (const event of result.events) onBoard.push(event.text);
  }
  return durationsMs;
}

const allDurations = [];
for (const demo of VISUAL_DEMOS) {
  const durations = reflexCostForScript(demo.script);
  allDurations.push(...durations);
  const mean = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const max = durations.length ? Math.max(...durations) : 0;
  console.log(
    `  ${demo.id.padEnd(10)} ${String(durations.length).padStart(3)} calls   mean ${mean.toFixed(3)} ms   max ${max.toFixed(3)} ms`,
  );
}
const sorted = [...allDurations].sort((a, b) => a - b);
const p50 = sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : 0;
const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
console.log(`\n  ACROSS ALL SCRIPTS   p50 ${p50.toFixed(3)} ms   p95 ${p95.toFixed(3)} ms   n=${allDurations.length}`);
console.log("\n  This runs deferred behind writeLive's commit (setTimeout(0) in");
console.log("  handleInterim), never in front of it — this number is what that");
console.log("  deferred call itself costs once it runs, not an end-to-end figure.");
console.log("  Reflex OFF (features.reflex=false): 0ms, by construction — Board.tsx");
console.log("  never calls recognizeSpeculative or schedules anything when it's off.");
