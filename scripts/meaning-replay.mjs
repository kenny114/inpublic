/**
 * Offline replay: feeds a real session log's settled thoughts through the
 * Meaning Engine's actual decision logic (lib/meaning/decideCore.ts, the
 * same prompt/schema lib/meaning/decide.ts uses in production) sequentially
 * — no microphone, no browser, no HTTP round trip through the guarded
 * /api/meaning route (which needs an authenticated usage session this
 * script has no way to hold). This is a real Anthropic API call per
 * settled thought, using the same $ANTHROPIC_API_KEY the dev server uses.
 *
 * Mirrors lib/meaning/engine.ts's own logic (rolling context window,
 * state carried forward, no-op vs. change) but processes ONE settled
 * thought at a time rather than debounced/coalesced batches — a stricter
 * test than a real session gets, since coalescing multiple thoughts into
 * one call only gives the model MORE context per round, never less.
 *
 * Usage:
 *   node --import ./scripts/ts-register.mjs scripts/meaning-replay.mjs <path-to-session.json>
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

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
    if (process.env[key] !== undefined) continue; // real env always wins
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvLocal();

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set (checked process.env and .env.local) — cannot replay against the real model.");
  process.exit(1);
}

const sessionPath = process.argv[2];
if (!sessionPath) {
  console.error("Usage: node --import ./scripts/ts-register.mjs scripts/meaning-replay.mjs <path-to-session.json>");
  process.exit(1);
}

const { decideMeaningCore } = await import("../lib/meaning/decideCore.ts");
const { diffSemanticState } = await import("../lib/meaning/reconcile.ts");
const { EMPTY_SEMANTIC_STATE } = await import("../lib/meaning/types.ts");

const CONTEXT_WINDOW_SIZE = 8;

const session = JSON.parse(readFileSync(sessionPath, "utf8"));
const settledThoughts = (session.events ?? [])
  .filter((e) => e.type === "settled-thought")
  .sort((a, b) => (a.t ?? 0) - (b.t ?? 0));

if (!settledThoughts.length) {
  console.error(`No "settled-thought" events found in ${sessionPath}.`);
  process.exit(1);
}

console.log(`Replaying ${settledThoughts.length} settled thought(s) from ${path.basename(sessionPath)}\n`);

let state = EMPTY_SEMANTIC_STATE;
let recentContext = [];

for (let i = 0; i < settledThoughts.length; i += 1) {
  const thought = settledThoughts[i];
  const text = thought.text;
  console.log(`${"=".repeat(72)}`);
  console.log(`THOUGHT ${i + 1}/${settledThoughts.length} (thoughtId=${thought.thoughtId ?? "unknown"})`);
  console.log(`"${text}"`);
  console.log(`${"=".repeat(72)}`);

  const before = state;
  // eslint-disable-next-line no-await-in-loop
  const next = await decideMeaningCore(before, recentContext, text);
  const ops = diffSemanticState(before, next);
  const changed = ops.length > 0;

  console.log(`\nRECENT CONTEXT (${recentContext.length}):`);
  for (const t of recentContext) console.log(`  - ${t}`);

  console.log(`\nPREVIOUS INTERPRETATION:\n  ${before.currentInterpretation ?? "(none yet)"}`);

  console.log(`\nUPDATED TOPIC:\n  ${next.topic ?? "(none)"}`);

  console.log(`\nCONCEPTS (${next.concepts.length}):`);
  for (const c of next.concepts) {
    const flags = [c.importance, c.status && c.status !== "active" ? c.status : null, c.confidence].filter(Boolean).join(", ");
    console.log(`  - [${c.id}] ${c.label}${flags ? ` (${flags})` : ""}`);
    if (c.description) console.log(`      ${c.description}`);
  }

  console.log(`\nCLAIMS (${next.claims.length}):`);
  for (const c of next.claims) {
    console.log(`  - [${c.id}] ${c.text}${c.about?.length ? ` (about: ${c.about.join(", ")})` : ""}${c.confidence ? ` [${c.confidence}]` : ""}`);
  }

  console.log(`\nRELATIONSHIPS (${next.relationships.length}):`);
  for (const r of next.relationships) {
    console.log(`  - ${r.from} -${r.type}${r.label ? `:${r.label}` : ""}-> ${r.to}`);
  }

  console.log(`\nSEMANTIC OPERATIONS (${ops.length}):`);
  if (!ops.length) console.log("  (none — no change this round)");
  for (const op of ops) console.log(`  - ${describeOp(op)}`);

  console.log(`\nCURRENT INTERPRETATION:\n  ${next.currentInterpretation ?? "(none)"}`);
  console.log("");

  if (changed) state = next;
  recentContext = [...recentContext, text].slice(-CONTEXT_WINDOW_SIZE);
}

console.log(`${"=".repeat(72)}`);
console.log("FINAL STATE");
console.log(`${"=".repeat(72)}`);
console.log(JSON.stringify(state, null, 2));

function describeOp(op) {
  switch (op.kind) {
    case "ADD_NODE":
      return `add concept "${op.concept.label}" (${op.concept.importance})`;
    case "UPDATE_NODE":
      return `update concept ${op.concept.id}: "${op.prev.label}" -> "${op.concept.label}"`;
    case "REMOVE_NODE":
      return `remove concept ${op.conceptId}`;
    case "ADD_EDGE":
      return `add relationship ${op.relationship.from} -${op.relationship.type}-> ${op.relationship.to}`;
    case "UPDATE_EDGE":
      return `update relationship ${op.relationship.id}: ${op.prev.type} -> ${op.relationship.type}`;
    case "REMOVE_EDGE":
      return `remove relationship ${op.relationshipId}`;
    case "ADD_CLAIM":
      return `add claim: "${op.claim.text}"`;
    case "UPDATE_CLAIM":
      return `update claim ${op.claim.id}: "${op.prev.text}" -> "${op.claim.text}"`;
    case "REMOVE_CLAIM":
      return `remove claim ${op.claimId}`;
    default:
      return JSON.stringify(op);
  }
}
