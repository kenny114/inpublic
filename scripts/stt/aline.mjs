/**
 * The Aline experiment, isolated.
 *
 * Same audio bytes, N repetitions, four keyterm conditions. Everything else is
 * production configuration. This is the only way to answer "does a keyterm fix
 * it" without confounding it with the rest of the corpus.
 *
 *   node --env-file=.env.local scripts/stt/aline.mjs [repeats]
 */
import fs from "node:fs";
import path from "node:path";
import { streamFile, finalTranscript, finalWords } from "./stream.mjs";

const REPEATS = Number(process.argv[2] ?? 3);
const AUDIO = path.join(process.cwd(), "scripts", "stt", "audio");
const ITEMS = ["p1", "p7", "p8", "c1", "c6"];

const CONDITIONS = {
  none: {},
  aline: { keyterm: ["Aline"] },
  // Frozen pre-Domain-Vocabulary-V1 production baseline. "Airline" was in
  // SEED_TERMS and "Aline" was absent.
  seed: {
    keyterm: ["Airline", "AI agents", "Affiliate Capital", "InPublic", "ClickLabs", "Excalidraw",
      "Deepgram", "Anthropic", "Claude", "Trinidad and Tobago", "Kenny Farmer", "sketchnote",
      "keyterm", "agentic", "LLM"],
  },
  // Both spellings present — does "Airline" poison "Aline"?
  both: { keyterm: ["Aline", "Airline"] },
};

const rows = [];
for (const id of ITEMS) {
  const file = path.join(AUDIO, `${id}.wav`);
  if (!fs.existsSync(file)) continue;
  for (const [cond, opts] of Object.entries(CONDITIONS)) {
    for (let r = 0; r < REPEATS; r += 1) {
      const { messages } = await streamFile(file, opts);
      const hyp = finalTranscript(messages);
      const words = finalWords(messages);
      const target = words.find((w) => /^(aline|align|airline|a|eileen|elaine)$/i.test(w.word));
      rows.push({ id, cond, run: r, hyp, targetWord: target?.word, targetConf: target?.confidence });
      console.log(`${id} ${cond.padEnd(6)} #${r}  ${hyp}`);
    }
  }
}

const out = path.join(process.cwd(), "scripts", "stt", "results", "aline.json");
fs.writeFileSync(out, JSON.stringify(rows, null, 2));

console.log("\n=== ALINE RECOVERY RATE ===");
for (const cond of Object.keys(CONDITIONS)) {
  const set = rows.filter((r) => r.cond === cond);
  const hit = set.filter((r) => /\baline\b/i.test(r.hyp)).length;
  const airline = set.filter((r) => /\bairline\b/i.test(r.hyp)).length;
  console.log(`${cond.padEnd(6)} "Aline" correct ${hit}/${set.length}   contains "airline": ${airline}/${set.length}`);
}
console.log(`\nwrote ${out}`);
