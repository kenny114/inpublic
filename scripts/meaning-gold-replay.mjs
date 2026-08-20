/**
 * Phase 1 gold replay: run the real two-stage Meaning Engine against the
 * four gold talks and assert semantic shape (not pixels).
 *
 * Same decision path as production (`decideMeaningCore`), one settled
 * thought at a time — stricter than a live session, which coalesces.
 * Requires ANTHROPIC_API_KEY.
 *
 *   node --import ./scripts/ts-register.mjs scripts/meaning-gold-replay.mjs
 *   node --import ./scripts/ts-register.mjs scripts/meaning-gold-replay.mjs --talk=trust-problem
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { GOLD_TALKS, assertGoldTalk, longestCausalSpine, activeConcepts } from "./fixtures/meaning-gold.mjs";

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvLocal();

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set — cannot replay gold talks against the real model.");
  process.exit(1);
}

const talkFilter = process.argv.find((a) => a.startsWith("--talk="))?.slice("--talk=".length);
const talks = talkFilter ? GOLD_TALKS.filter((t) => t.id === talkFilter) : GOLD_TALKS;
if (!talks.length) {
  console.error(`No gold talk matching --talk=${talkFilter}. Known: ${GOLD_TALKS.map((t) => t.id).join(", ")}`);
  process.exit(1);
}

const { decideMeaningCore, MEANING_ENGINE_MODEL } = await import("../lib/meaning/decideCore.ts");
const { EMPTY_SEMANTIC_STATE } = await import("../lib/meaning/types.ts");
const { complete } = await import("../lib/llm.ts");

console.log(`model: ${MEANING_ENGINE_MODEL}`);
try {
  const smoke = await complete({
    model: MEANING_ENGINE_MODEL,
    system: "Reply with the single word ok.",
    user: "ping",
    maxTokens: 16,
    temperature: 0,
  });
  console.log(`smoke: ${JSON.stringify(smoke)}`);
} catch (err) {
  console.error("smoke FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
}

const CONTEXT_WINDOW_SIZE = 8;

function printState(state) {
  const concepts = activeConcepts(state);
  console.log(`  topic: ${state.topic ?? "(none)"}`);
  console.log(`  interpretation: ${state.currentInterpretation ?? "(none)"}`);
  console.log(`  concepts (${concepts.length}):`);
  for (const c of concepts) console.log(`    - [${c.id}] ${c.label} (${c.importance})`);
  console.log(`  relationships (${(state.relationships ?? []).length}):`);
  for (const r of state.relationships ?? []) console.log(`    - ${r.from} -${r.type}-> ${r.to}${r.label ? ` (${r.label})` : ""}`);
  console.log(`  claims (${(state.claims ?? []).length}):`);
  for (const c of state.claims ?? []) console.log(`    - ${c.text}${c.about?.length ? ` [about: ${c.about.join(", ")}]` : ""}`);
  const spine = longestCausalSpine(state);
  console.log(`  causal spine: ${spine.length ? spine.map((c) => c.label).join(" → ") : "(none)"}`);
}

async function replayTalk(talk) {
  let state = EMPTY_SEMANTIC_STATE;
  let recentContext = [];
  for (let i = 0; i < talk.thoughts.length; i += 1) {
    const thought = talk.thoughts[i];
    console.log(`\n  thought ${i + 1}/${talk.thoughts.length}: "${thought}"`);
    let localOk = false;
    let skip = null;
    const next = await decideMeaningCore(state, recentContext, thought, undefined, {
      onLocalMeaning: (lm, raw) => {
        localOk = Boolean(lm && (lm.concepts.length || lm.claims.length || lm.relationships.length || lm.interpretation));
        if (!lm) console.log(`    stage1 FAILED raw=${(raw || "").slice(0, 240) || "(empty)"}`);
        else if (!localOk) console.log("    stage1 empty (no meaning extracted)");
        else console.log(`    stage1 ok  concepts=${lm.concepts.length} claims=${lm.claims.length} rels=${lm.relationships.length}`);
      },
      onReconcileSkip: (reason, detail) => {
        skip = `${reason}${detail ? `: ${detail}` : ""}`;
      },
      onReconcilePreSanitize: () => {
        console.log("    stage2 raw parsed");
      },
    });
    if (skip) console.log(`    stage2 skip ${skip}`);
    if (next === state || (next.concepts.length === state.concepts.length && next.claims.length === state.claims.length && next.relationships.length === state.relationships.length)) {
      if (localOk && !skip) console.log("    stage2 produced no change");
    }
    state = next;
    recentContext = [...recentContext, thought].slice(-CONTEXT_WINDOW_SIZE);
  }
  return state;
}

let failed = 0;
const results = [];

console.log("Meaning Engine gold replay — semantic shape, not pixels\n");

for (const talk of talks) {
  console.log("=".repeat(72));
  console.log(`${talk.id} — ${talk.title}`);
  console.log("=".repeat(72));
  const state = await replayTalk(talk);
  console.log("\n  final state:");
  printState(state);
  const verdict = assertGoldTalk(talk.id, state);
  results.push({ id: talk.id, ok: verdict.ok, failures: verdict.failures, state });
  if (verdict.ok) {
    console.log("\n  PASS");
  } else {
    failed += 1;
    console.log("\n  FAIL");
    for (const f of verdict.failures) console.log(`    - ${f}`);
  }
}

console.log("\n" + "=".repeat(72));
console.log(`Gold talks: ${results.filter((r) => r.ok).length}/${results.length} passed`);
for (const r of results) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.id}`);

if (failed) process.exit(1);
