/**
 * Interim-vs-final detail: what Deepgram said first, what it settled on, and
 * how often that changed. Phase 4 of the audit — the question is whether
 * InPublic is acting on hypotheses Deepgram later retracts.
 *
 *   node scripts/stt/interims.mjs A
 */
import fs from "node:fs";
import path from "node:path";
import { align, normalize } from "./score.mjs";

const name = process.argv[2] ?? "A";
const run = JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts", "stt", "results", `${name}.json`), "utf8"));

const text = (m) => m?.data?.channel?.alternatives?.[0]?.transcript ?? "";
const words = (s) => normalize(s).split(" ").filter(Boolean);

let itemsWithChange = 0;
let totalRevisions = 0;
let latencyToFirstInterim = [];
let latencyToFinal = [];

console.log(`=== INTERIM → FINAL, config ${name} (${run.label}) ===\n`);

for (const item of run.items) {
  const ts = (item.messages ?? []).filter((m) => m.type === "transcript" && text(m).trim());
  if (!ts.length) continue;
  const interims = ts.filter((m) => !m.data.is_final);
  const finals = ts.filter((m) => m.data.is_final);
  if (interims[0]) latencyToFirstInterim.push(interims[0].at);
  if (finals[0]) latencyToFinal.push(finals[0].at);

  // Compare the last interim before each final against that final.
  const changes = [];
  for (const fin of finals) {
    const before = interims.filter((m) => m.at < fin.at);
    const last = before[before.length - 1];
    if (!last) continue;
    const a = align(words(text(last)), words(text(fin)));
    for (const op of a.ops) {
      if (op.op === "sub") changes.push(`"${op.ref}" → "${op.hyp}"`);
      else if (op.op === "del") changes.push(`"${op.ref}" removed`);
      // insertions are just the utterance continuing; not a retraction
    }
  }
  if (changes.length) {
    itemsWithChange += 1;
    totalRevisions += changes.length;
    console.log(`${item.id} [${item.cat}]`);
    console.log(`   first interim: ${text(interims[0])}`);
    console.log(`   final        : ${item.hypothesis}`);
    console.log(`   revised      : ${changes.join(", ")}`);
  }
}

const p = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(s.length * q))]) : NaN; };
console.log(`\nitems where the final retracted an interim word: ${itemsWithChange}/${run.items.length}`);
console.log(`total retracted/substituted words: ${totalRevisions}`);
console.log(`time from stream start to first interim: p50 ${p(latencyToFirstInterim, 0.5)}ms  p95 ${p(latencyToFirstInterim, 0.95)}ms`);
console.log(`time from stream start to first final : p50 ${p(latencyToFinal, 0.5)}ms  p95 ${p(latencyToFinal, 0.95)}ms`);
