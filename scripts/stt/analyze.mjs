/**
 * Turns raw run files into the numbers the audit asks for.
 *
 *   node scripts/stt/analyze.mjs A B C D E
 *
 * Reports per-config and per-category WER, the error kinds, keyterm recall,
 * word confidence split by whether the word was actually right, and the
 * interim-vs-final revision rate.
 */
import fs from "node:fs";
import path from "node:path";
import { align, normalize, keytermRecall, mean } from "./score.mjs";

const RESULTS = path.join(process.cwd(), "scripts", "stt", "results");
const names = process.argv.slice(2);
if (!names.length) {
  console.error("usage: analyze.mjs <config...>");
  process.exit(1);
}

const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "n/a");
const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : "n/a");

/** Words of a message's first alternative. */
const altWords = (m) => m?.data?.channel?.alternatives?.[0]?.words ?? [];
const altText = (m) => m?.data?.channel?.alternatives?.[0]?.transcript ?? "";

function analyzeItem(item) {
  const refWords = normalize(item.reference).split(" ").filter(Boolean);
  const hypWords = normalize(item.hypothesis ?? "").split(" ").filter(Boolean);
  const a = align(refWords, hypWords);

  // Attach confidence to each hypothesis word by position.
  const conf = [];
  for (const m of item.messages ?? []) {
    if (m.type !== "transcript" || !m.data?.is_final) continue;
    for (const w of altWords(m)) {
      // A word may normalise to several tokens ("39" -> "thirty nine"); give
      // each resulting token the parent word's confidence.
      const tokens = normalize(w.punctuated_word ?? w.word).split(" ").filter(Boolean);
      for (const t of tokens) conf.push({ token: t, confidence: w.confidence });
    }
  }

  let hi = 0;
  const rightConf = [];
  const wrongConf = [];
  const errors = [];
  for (const op of a.ops) {
    if (op.op === "ok") { if (conf[hi]) rightConf.push(conf[hi].confidence); hi += 1; }
    else if (op.op === "sub") {
      if (conf[hi]) wrongConf.push(conf[hi].confidence);
      errors.push({ kind: "sub", ref: op.ref, hyp: op.hyp, confidence: conf[hi]?.confidence });
      hi += 1;
    } else if (op.op === "ins") {
      if (conf[hi]) wrongConf.push(conf[hi].confidence);
      errors.push({ kind: "ins", hyp: op.hyp, confidence: conf[hi]?.confidence });
      hi += 1;
    } else {
      errors.push({ kind: "del", ref: op.ref });
    }
  }

  // Interim behaviour.
  const transcripts = (item.messages ?? []).filter((m) => m.type === "transcript" && altText(m).trim());
  const interims = transcripts.filter((m) => !m.data?.is_final);
  const finals = transcripts.filter((m) => m.data?.is_final);
  const firstInterim = interims[0] ? altText(interims[0]) : "";
  const lastInterim = interims.length ? altText(interims[interims.length - 1]) : "";

  // How much did the final change the last interim covering the same audio?
  // Compare the tail of the concatenated finals against the last interim.
  const lastFinal = finals.length ? altText(finals[finals.length - 1]) : "";
  const revision = lastInterim && lastFinal
    ? align(normalize(lastInterim).split(" ").filter(Boolean), normalize(lastFinal).split(" ").filter(Boolean))
    : null;

  // Word-level instability across the whole interim stream: a word position
  // that took more than one value before settling.
  const seen = new Map();
  let flips = 0;
  for (const m of interims) {
    const ws = normalize(altText(m)).split(" ").filter(Boolean);
    ws.forEach((w, i) => {
      if (seen.has(i) && seen.get(i) !== w) flips += 1;
      seen.set(i, w);
    });
  }

  const kt = keytermRecall(item.keyterms, item.hypothesis ?? "");
  const speechFinals = finals.filter((m) => m.data?.speech_final).length;

  return {
    ...a,
    errors,
    rightConf,
    wrongConf,
    keyterms: kt,
    firstInterim,
    lastInterim,
    finalText: item.hypothesis ?? "",
    interimCount: interims.length,
    finalCount: finals.length,
    speechFinals,
    revisionEdits: revision ? revision.sub + revision.del + revision.ins : 0,
    revisionOps: revision ? revision.ops.filter((o) => o.op !== "ok") : [],
    flips,
  };
}

const report = {};
for (const name of names) {
  const file = path.join(RESULTS, `${name}.json`);
  if (!fs.existsSync(file)) { console.error(`missing ${file}`); continue; }
  const run = JSON.parse(fs.readFileSync(file, "utf8"));
  const items = run.items.filter((i) => !i.error).map((i) => ({ item: i, a: analyzeItem(i) }));
  report[name] = { run, items };
}

// ---- overall ---------------------------------------------------------------
console.log("\n=== OVERALL ===");
console.log("config  label                                   WER     sub  del  ins  refWords");
for (const [name, { run, items }] of Object.entries(report)) {
  const sub = items.reduce((s, x) => s + x.a.sub, 0);
  const del = items.reduce((s, x) => s + x.a.del, 0);
  const ins = items.reduce((s, x) => s + x.a.ins, 0);
  const ref = items.reduce((s, x) => s + x.a.refLen, 0);
  console.log(`${name.padEnd(7)} ${run.label.padEnd(38)} ${pct((sub + del + ins) / ref).padStart(6)}  ${String(sub).padStart(3)}  ${String(del).padStart(3)}  ${String(ins).padStart(3)}  ${ref}`);
}

// ---- per category ----------------------------------------------------------
const cats = [...new Set(Object.values(report)[0].items.map((x) => x.item.cat))];
console.log("\n=== WER BY CATEGORY ===");
console.log(`category      ${names.map((n) => n.padStart(8)).join("")}`);
for (const cat of cats) {
  const row = names.map((n) => {
    const items = report[n].items.filter((x) => x.item.cat === cat);
    const ref = items.reduce((s, x) => s + x.a.refLen, 0);
    const err = items.reduce((s, x) => s + x.a.sub + x.a.del + x.a.ins, 0);
    return pct(ref ? err / ref : NaN).padStart(8);
  });
  console.log(`${cat.padEnd(13)} ${row.join("")}`);
}

// ---- keyterm recall --------------------------------------------------------
console.log("\n=== KEYTERM RECALL (proper nouns) ===");
for (const name of names) {
  const all = report[name].items.flatMap((x) => x.a.keyterms);
  const byTerm = new Map();
  for (const k of all) {
    const cur = byTerm.get(k.term) ?? { hit: 0, n: 0 };
    cur.n += 1;
    if (k.found) cur.hit += 1;
    byTerm.set(k.term, cur);
  }
  const hit = all.filter((k) => k.found).length;
  console.log(`${name}: ${hit}/${all.length} (${pct(all.length ? hit / all.length : NaN)})  ` +
    [...byTerm.entries()].map(([t, v]) => `${t} ${v.hit}/${v.n}`).join("  "));
}

// ---- confidence ------------------------------------------------------------
console.log("\n=== WORD CONFIDENCE ===");
console.log("config  correct-words  incorrect-words  gap");
for (const name of names) {
  const right = report[name].items.flatMap((x) => x.a.rightConf);
  const wrong = report[name].items.flatMap((x) => x.a.wrongConf);
  console.log(`${name.padEnd(7)} ${f3(mean(right)).padStart(13)}  ${f3(mean(wrong)).padStart(15)}  ${f3(mean(right) - mean(wrong)).padStart(5)}   (n=${right.length}/${wrong.length})`);
}
console.log("\nconfidence distribution of INCORRECT words (config " + names[0] + "):");
{
  const wrong = report[names[0]].items.flatMap((x) => x.a.wrongConf).sort((a, b) => a - b);
  const buckets = [0, 0.5, 0.7, 0.8, 0.9, 0.95, 1.01];
  for (let i = 0; i < buckets.length - 1; i += 1) {
    const n = wrong.filter((c) => c >= buckets[i] && c < buckets[i + 1]).length;
    console.log(`  ${buckets[i].toFixed(2)}–${buckets[i + 1] > 1 ? "1.00" : buckets[i + 1].toFixed(2)}  ${"#".repeat(n)} ${n}`);
  }
  const right = report[names[0]].items.flatMap((x) => x.a.rightConf).sort((a, b) => a - b);
  const below = (t) => ({ w: wrong.filter((c) => c < t).length, r: right.filter((c) => c < t).length });
  for (const t of [0.7, 0.8, 0.9]) {
    const b = below(t);
    console.log(`  words below ${t}: ${b.w}/${wrong.length} incorrect caught, ${b.r}/${right.length} correct falsely flagged`);
  }
}

// ---- interim vs final ------------------------------------------------------
console.log("\n=== INTERIM vs FINAL ===");
console.log("config  items  interims/item  finals  speech_finals  items-where-final-changed-last-interim  total-edits  interim-word-flips");
for (const name of names) {
  const items = report[name].items;
  const changed = items.filter((x) => x.a.revisionEdits > 0).length;
  console.log(`${name.padEnd(7)} ${String(items.length).padStart(5)}  ${(mean(items.map((x) => x.a.interimCount))).toFixed(1).padStart(13)}  ${String(items.reduce((s, x) => s + x.a.finalCount, 0)).padStart(6)}  ${String(items.reduce((s, x) => s + x.a.speechFinals, 0)).padStart(13)}  ${String(`${changed}/${items.length}`).padStart(38)}  ${String(items.reduce((s, x) => s + x.a.revisionEdits, 0)).padStart(11)}  ${String(items.reduce((s, x) => s + x.a.flips, 0)).padStart(18)}`);
}

// ---- error detail ----------------------------------------------------------
console.log(`\n=== ALL ERRORS (config ${names[0]}) ===`);
for (const { item, a } of report[names[0]].items) {
  if (!a.errors.length) continue;
  console.log(`${item.id} [${item.cat}] ${pct(a.wer)}`);
  console.log(`   ref: ${item.reference}`);
  console.log(`   hyp: ${a.finalText}`);
  for (const e of a.errors) {
    console.log(`   ${e.kind}: ${e.kind === "del" ? `"${e.ref}" dropped` : e.kind === "ins" ? `"${e.hyp}" invented` : `"${e.ref}" -> "${e.hyp}"`}${e.confidence !== undefined ? ` (conf ${f3(e.confidence)})` : ""}`);
  }
}

// ---- per-item comparison across configs ------------------------------------
console.log("\n=== PER-ITEM WER ACROSS CONFIGS ===");
console.log(`id     cat            ${names.map((n) => n.padStart(8)).join("")}`);
for (const { item } of report[names[0]].items) {
  const row = names.map((n) => {
    const x = report[n].items.find((y) => y.item.id === item.id);
    return (x ? pct(x.a.wer) : "-").padStart(8);
  });
  console.log(`${item.id.padEnd(6)} ${item.cat.padEnd(14)} ${row.join("")}`);
}
