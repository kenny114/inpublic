/**
 * Exact-sample Domain ASR A/B runner.
 *
 * Usage:
 *   node --env-file=.env.local --import ./scripts/ts-register.mjs \
 *     scripts/stt/domain-natural-ab.mjs path/to/clips.json [repeats]
 *
 * The manifest identifies clips by sample indexes in an exact-mic-audio.wav.
 * No resampling or re-encoding occurs: every condition receives the same PCM
 * subarray with production streaming cadence and provider configuration.
 */
import fs from "node:fs";
import path from "node:path";
import { correctTranscript, keyterms } from "../../lib/vocab.ts";
import { readWav, streamPcm, finalTranscript } from "./stream.mjs";
import { normalize, score } from "./score.mjs";

const manifestPath = path.resolve(process.argv[2] ?? "");
if (!manifestPath || !fs.existsSync(manifestPath)) {
  throw new Error("Provide an existing exact-audio clip manifest JSON path");
}
const repeats = Math.max(1, Math.min(5, Number(process.argv[3] ?? 3)));
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (!Array.isArray(manifest.clips) || manifest.clips.length === 0) throw new Error("Manifest clips[] is required");

const root = path.dirname(manifestPath);
const baselineTerms = keyterms({});
const insertCandidate = (terms) => {
  const out = [...baselineTerms];
  const at = Math.max(0, out.findIndex((term) => term === "Aline") + 1);
  out.splice(at, 0, ...terms);
  return [...new Map(out.map((term) => [term.toLowerCase(), term])).values()].slice(0, 40);
};
const defaultTreatments = (target) => target.toLowerCase() === "mlbb"
  ? [{ name: "mlbb", keyterms: ["MLBB"] }]
  : target.toLowerCase() === "roamer"
    ? [{ name: "roamer", keyterms: ["roamer"] }, { name: "mlbb-roamer-phrase", keyterms: ["MLBB roamer"] }]
    : [];
const contains = (text, expected) => {
  const haystack = ` ${normalize(text, { numbers: false })} `;
  const needle = normalize(expected, { numbers: false });
  return Boolean(needle) && haystack.includes(` ${needle} `);
};

const audioCache = new Map();
const rows = [];
for (const clip of manifest.clips) {
  if (!clip.id || !clip.file || !clip.target || !clip.expectedTerm) throw new Error("Every clip requires id, file, target, and expectedTerm");
  if (!Number.isInteger(clip.startSample) || !Number.isInteger(clip.endSample) || clip.endSample <= clip.startSample) {
    throw new Error(`${clip.id}: startSample/endSample must be increasing integers`);
  }
  const file = path.resolve(root, clip.file);
  let source = audioCache.get(file);
  if (!source) {
    source = readWav(file);
    audioCache.set(file, source);
  }
  if (source.channels !== 1) throw new Error(`${clip.id}: exact corpus audio must be mono`);
  const byteStart = clip.startSample * 2;
  const byteEnd = clip.endSample * 2;
  if (byteEnd > source.pcm.length) throw new Error(`${clip.id}: sample range exceeds ${clip.file}`);
  const pcm = source.pcm.subarray(byteStart, byteEnd);
  const treatments = Array.isArray(clip.treatments) ? clip.treatments : defaultTreatments(clip.target);
  const conditions = [{ name: "baseline", keyterms: baselineTerms }, ...treatments.map((item) => ({ name: item.name, keyterms: insertCandidate(item.keyterms) }))];
  for (const condition of conditions) {
    for (let run = 1; run <= repeats; run += 1) {
      const result = await streamPcm({ pcm, sampleRate: source.sampleRate, channels: source.channels }, { keyterm: condition.keyterms });
      const raw = finalTranscript(result.messages);
      const normalized = correctTranscript(raw, condition.keyterms).text;
      const expectedFound = contains(raw, clip.expectedTerm);
      const candidateHijack = clip.kind === "negative" && contains(raw, clip.target);
      rows.push({
        clipId: clip.id,
        target: clip.target,
        kind: clip.kind ?? "positive",
        expectedTerm: clip.expectedTerm,
        condition: condition.name,
        run,
        startSample: clip.startSample,
        endSample: clip.endSample,
        raw,
        normalized,
        display: normalized,
        expectedFound,
        candidateHijack,
        surroundingWer: clip.expectedTranscript ? score(clip.expectedTranscript, raw).wer : null,
      });
      console.log(`${clip.id} ${condition.name} #${run}: ${raw}`);
    }
  }
}

const groups = [];
for (const clip of manifest.clips) {
  for (const condition of [...new Set(rows.filter((row) => row.clipId === clip.id).map((row) => row.condition))]) {
    const set = rows.filter((row) => row.clipId === clip.id && row.condition === condition);
    groups.push({
      clipId: clip.id,
      target: clip.target,
      kind: clip.kind ?? "positive",
      expectedTerm: clip.expectedTerm,
      condition,
      correct: set.filter((row) => row.expectedFound).length,
      attempts: set.length,
      hijacks: set.filter((row) => row.candidateHijack).length,
      meanSurroundingWer: set.some((row) => row.surroundingWer !== null)
        ? set.reduce((sum, row) => sum + (row.surroundingWer ?? 0), 0) / set.length
        : null,
    });
  }
}

const output = {
  generatedAt: new Date().toISOString(),
  manifest: manifestPath,
  repeats,
  providerConfiguration: {
    model: "nova-3",
    interim_results: true,
    smart_format: true,
    endpointing: 150,
    utterance_end_ms: 1000,
    punctuate: true,
    vad_events: true,
    encoding: "linear16",
    cadenceMs: 80,
  },
  baselineKeyterms: baselineTerms,
  groups,
  rows,
};
const outputPath = path.join(root, `domain-natural-ab-${Date.now()}.json`);
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(`\nwrote ${outputPath}`);
