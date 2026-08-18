/** Offline replay of the six 2026-08-16 natural-session provider-final streams. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  EMPTY_PRESENTATION_THOUGHT,
  flushPresentationThought,
  hasOpenPresentationTail,
  pushPresentationSegment,
} from "../lib/liveSpeech.ts";

const FILES = [
  "session-2026-08-16T20-48-55-463Z.json",
  "session-2026-08-16T20-45-30-328Z.json",
  "session-2026-08-16T20-41-27-694Z.json",
  "session-2026-08-16T20-38-24-560Z.json",
  "session-2026-08-16T20-35-38-792Z.json",
  "session-2026-08-16T20-32-20-828Z.json",
];
const OLD_PREMATURE = [6, 5, 4, 8, 7, 9];
const OLD_OVER_COMBINED = [3, 2, 3, 0, 1, 1];
const OVER_CASES = [[6, 8, 10], [4, 8], [3, 5, 13], [], [11], [5]];
const root = process.argv[2] ?? path.join(os.homedir(), "Downloads");

const words = (text) => text.trim().split(/\s+/).filter(Boolean);
const percentile = (xs, p) => {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
};
const stats = (thoughts) => {
  const wc = thoughts.map((thought) => words(thought.text).length);
  const duration = thoughts.map((thought) => thought.durationMs / 1000);
  return {
    averageWords: wc.reduce((a, b) => a + b, 0) / Math.max(1, wc.length),
    medianWords: percentile(wc, 0.5),
    p95Words: percentile(wc, 0.95),
    maxWords: Math.max(0, ...wc),
    medianDuration: percentile(duration, 0.5),
    p95Duration: percentile(duration, 0.95),
    maxDuration: Math.max(0, ...duration),
    under3: wc.filter((n) => n < 3).length / Math.max(1, wc.length),
    under5: wc.filter((n) => n < 5).length / Math.max(1, wc.length),
    under6: wc.filter((n) => n < 6).length / Math.max(1, wc.length),
  };
};

const reports = [];
const overSplits = [];
const aggregateOld = [];
const aggregateNext = [];
const policyTimings = [];
for (let sessionIndex = 0; sessionIndex < FILES.length; sessionIndex += 1) {
  const json = JSON.parse(fs.readFileSync(path.join(root, FILES[sessionIndex]), "utf8"));
  const oldThoughts = json.events.filter((event) => event.type === "settled-thought");
  const finals = json.events.filter((event) => event.type === "transcript");

  // Assign every spoken word a share of its original V2 source-region duration.
  // This preserves each exact old duration while allowing resegmented V3 units
  // to receive a deterministic duration estimate.
  const wordDurations = [];
  const oldRanges = [];
  let globalWord = 0;
  for (const thought of oldThoughts) {
    const count = words(thought.text).length;
    const durationMs = Math.max(0, thought.sourceRegion.audioEndMs - thought.sourceRegion.audioStartMs);
    const each = count ? durationMs / count : 0;
    const start = globalWord;
    for (let i = 0; i < count; i += 1) wordDurations.push(each);
    globalWord += count;
    oldRanges.push({ start, end: globalWord, text: thought.text });
  }

  let state = EMPTY_PRESENTATION_THOUGHT;
  const emissions = [];
  for (const event of finals) {
    const policyStarted = performance.now();
    const result = pushPresentationSegment(state, event.normalizedTranscript ?? event.text, event.t);
    policyTimings.push(performance.now() - policyStarted);
    state = result.state;
    emissions.push(...result.thoughts);
  }
  const flushStarted = performance.now();
  const flushed = flushPresentationThought(state, json.events.at(-1)?.t ?? 0);
  policyTimings.push(performance.now() - flushStarted);
  emissions.push(...flushed.thoughts);

  let consumed = 0;
  const newThoughts = emissions.map((emission) => {
    const count = words(emission.text).length;
    const start = consumed;
    const end = consumed + count;
    consumed = end;
    return {
      ...emission,
      start,
      end,
      durationMs: wordDurations.slice(start, end).reduce((a, b) => a + b, 0),
    };
  });
  const input = finals.map((event) => event.normalizedTranscript ?? event.text).join(" ").replace(/\s+/g, " ").trim();
  const output = newThoughts.map((thought) => thought.text).join(" ").replace(/\s+/g, " ").trim();
  const preservation = input === output;
  const lacksStrongTerminal = (thought) => !/[.!?]["')\]]?$/.test(thought.text.trim());
  const openSafetySplits = newThoughts.filter((thought) =>
    lacksStrongTerminal(thought) && hasOpenPresentationTail(thought.text) && (thought.reason === "safety_bound" || thought.reason === "safe_forced_split")
  ).length;
  const newPremature = newThoughts.filter((thought) =>
    lacksStrongTerminal(thought) && hasOpenPresentationTail(thought.text) && thought.reason !== "safety_bound" && thought.reason !== "safe_forced_split"
  ).length;
  const newOver = newThoughts.filter((thought) => words(thought.text).length > 32).length;
  aggregateOld.push(...oldThoughts.map((thought) => ({
    text: thought.text,
    durationMs: thought.sourceRegion.audioEndMs - thought.sourceRegion.audioStartMs,
  })));
  aggregateNext.push(...newThoughts);

  for (const oldNumber of OVER_CASES[sessionIndex]) {
    const old = oldRanges[oldNumber - 1];
    const overlaps = newThoughts.filter((thought) => thought.start < old.end && thought.end > old.start);
    overSplits.push({
      id: `P${sessionIndex + 1}T${oldNumber}`,
      before: old.text,
      after: overlaps.map((thought) => ({ text: thought.text, reason: thought.reason })),
    });
  }

  reports.push({
    session: `P${sessionIndex + 1}`,
    oldThoughts: oldThoughts.length,
    newThoughts: newThoughts.length,
    oldPremature: OLD_PREMATURE[sessionIndex],
    newPremature,
    oldOverCombined: OLD_OVER_COMBINED[sessionIndex],
    newOverCombined: newOver,
    openSafetySplits,
    old: stats(oldThoughts.map((thought) => ({
      text: thought.text,
      durationMs: thought.sourceRegion.audioEndMs - thought.sourceRegion.audioStartMs,
    }))),
    next: stats(newThoughts),
    preservation,
    thoughts: newThoughts.map(({ text, reason, providerFinalCount, durationMs }) => ({
      text,
      reason,
      providerFinalCount,
      durationMs,
      openTail: !/[.!?]["')\]]?$/.test(text.trim()) && hasOpenPresentationTail(text),
    })),
  });
}

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  reports,
  totals: {
    oldThoughts: reports.reduce((n, report) => n + report.oldThoughts, 0),
    newThoughts: reports.reduce((n, report) => n + report.newThoughts, 0),
    oldPremature: reports.reduce((n, report) => n + report.oldPremature, 0),
    newPremature: reports.reduce((n, report) => n + report.newPremature, 0),
    oldOverCombined: reports.reduce((n, report) => n + report.oldOverCombined, 0),
    newOverCombined: reports.reduce((n, report) => n + report.newOverCombined, 0),
    wordsPreserved: reports.every((report) => report.preservation),
    old: stats(aggregateOld),
    next: stats(aggregateNext),
    policyMs: {
      total: policyTimings.reduce((sum, value) => sum + value, 0),
      p50: percentile(policyTimings, 0.5),
      p95: percentile(policyTimings, 0.95),
      max: Math.max(0, ...policyTimings),
    },
  },
  overSplits,
}, null, 2));
