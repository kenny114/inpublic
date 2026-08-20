/**
 * Voice-note validation: real settled thoughts (captured via the real
 * Deepgram + V2 thought-segmentation pipeline, through the browser replay
 * lab against the actual .ogg files) run through the real two-stage Meaning
 * Engine (lib/meaning/decideCore.ts's extractLocalMeaning +
 * reconcileLocalMeaning — the exact same logic ?debug=1 exercises)
 * directly, bypassing the HTTP/guard layer that requires a live product
 * usage session (which the replay lab intentionally never opens, so it
 * can't be satisfied for prerecorded-file testing without spending real
 * trial/user minutes).
 *
 * Runs both stages explicitly (rather than the decideMeaningCore
 * convenience wrapper) so every round prints the full Phase-7 instrumented
 * trace: new thought -> recent raw context -> local meaning -> current
 * global state -> pre/post-sanitize reconciliation result -> final
 * operations, with a best-effort classification of why a 0-operation round
 * happened. See the semantic-accumulation audit, 2026-08-19, for why this
 * replaced the single-call V1 architecture.
 *
 * Usage:
 *   node --import ./scripts/ts-register.mjs scripts/meaning-voice-note-replay.mjs
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
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}
loadEnvLocal();

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set — cannot replay against the real model.");
  process.exit(1);
}

const { extractLocalMeaning, reconcileLocalMeaning } = await import("../lib/meaning/decideCore.ts");
const { diffSemanticState } = await import("../lib/meaning/reconcile.ts");
const { EMPTY_SEMANTIC_STATE } = await import("../lib/meaning/types.ts");

const CONTEXT_WINDOW_SIZE = 8;

// Real settled-thought text captured via the actual V2 segmentation pipeline
// (Deepgram nova-3, live streaming) against the three supplied .ogg files,
// through components/Board.tsx's DevReplayLab (v2_only mode) in a real
// browser session. Not manually cleaned or rewritten — this is exactly what
// InPublic's real transcription path produced, ASR errors included.
const NOTES = {
  "Voice Note 1 (3.52.16 PM, 46.6s)": [
    "Speaker. This is InPublic.",
    "I'm speaking normally. Deepgram is listening to what I'm saying, and from that speech, InPublic starts deciding what actually deserves being shown visually.",
    "Then it sends ideas into Excalidraw. Text boxes, relationships, arrows, structures, while I'm still talking, the interesting part isn't the transcript.",
    "I don't want just subtitles on the speech.",
    "I want the canvas to actually express what I mean.",
    "So if I explain an idea, the structure of the idea starts the structure of the idea should start appearing",
    "besides me and Rita. There's still a lot I want to include, especially how expressive the videos can be. This is where InPublic is right now.",
  ],
  "Voice Note 2 (3.53.31 PM, 44.4s)": [
    "The basic idea is simple.",
    "I thought the computer systems understand, and the Canvas has joined what I mean.",
    "But building that has been much more interesting than I expected.",
    "Deepgram handles the live speech really well. Then I have a layer that tries to understand what matters.",
    "Concepts, emphasis, relationships, changes in thought, And Excalidraw begins because of visual surface where everything appears. The hardest part isn't getting words on screen.",
    "That's the easy part. Problem is deciding what visuals is being shown, how the visuals has been shown, what happens from there.",
    "That's the hardest part after that. This is something that is really really interesting.",
  ],
  "Voice Note 3 (3.54.53 PM, 52.5s)": [
    "When someone when someone talks, there's much more happening than we would. Their ideas, connection, contrast, important moment.",
    "Things building on previous ones, But, normally, videos would use all that to capture at the bottom of the screen.",
    "So I started building Instead of only writing down what I see, it tries to visualize the structure behind what I'm saying.",
    "As I speak, the Canvas goes, ideas appear, connections for the explanation becomes something you can actually look up.",
    "And, eventually, I want this to feel as, like, automated diagrams and more like somebody's watching talks.",
    "Visually on food. On food. Guys understand the idea with it publicly speak, and it visualize what you what you are speaking into.",
    "It visually tries to it tries to visually express what you are saying, basically.",
  ],
};

function describeOp(op) {
  switch (op.kind) {
    case "ADD_NODE": return `ADD concept "${op.concept.label}" (${op.concept.importance})`;
    case "UPDATE_NODE": return `UPDATE concept ${op.concept.id}: "${op.prev.label}" -> "${op.concept.label}"`;
    case "REMOVE_NODE": return `REMOVE concept ${op.conceptId}`;
    case "ADD_EDGE": return `ADD relationship ${op.relationship.from} -${op.relationship.type}-> ${op.relationship.to}`;
    case "UPDATE_EDGE": return `UPDATE relationship ${op.relationship.id}: ${op.prev.type} -> ${op.relationship.type}`;
    case "REMOVE_EDGE": return `REMOVE relationship ${op.relationshipId}`;
    case "ADD_CLAIM": return `ADD claim: "${op.claim.text}"`;
    case "UPDATE_CLAIM": return `UPDATE claim ${op.claim.id}: "${op.prev.text}" -> "${op.claim.text}"`;
    case "REMOVE_CLAIM": return `REMOVE claim ${op.claimId}`;
    default: return JSON.stringify(op);
  }
}

const SEP = "=".repeat(48);

/**
 * Runs both stages for one round with full Phase-7 instrumentation:
 * NEW THOUGHT -> RECENT RAW CONTEXT -> LOCAL MEANING -> CURRENT GLOBAL
 * STATE -> PRE/POST-SANITIZE RECONCILIATION RESULT -> FINAL OPERATIONS,
 * plus a best-effort classification of "why" for a round that produced no
 * change — so there is no longer a mysterious "0 operations" round.
 */
async function runInstrumentedRound(label, thoughtIndex, thought, before, recentContext) {
  console.log(`\n--- ${label} :: thought ${thoughtIndex + 1} ---`);

  console.log(`\n${SEP}\nNEW THOUGHT\n${SEP}\n"${thought}"`);

  console.log(`\n${SEP}\nRECENT RAW CONTEXT (${recentContext.length})\n${SEP}`);
  if (!recentContext.length) console.log("  (none yet)");
  for (const t of recentContext) console.log(`  - ${t}`);

  let localMeaning = null;
  let localRaw = "";
  await extractLocalMeaning(recentContext, thought, before.topic, before.currentInterpretation, undefined, {
    onLocalMeaning: (lm, raw) => { localMeaning = lm; localRaw = raw; },
  });

  console.log(`\n${SEP}\nLOCAL MEANING\n${SEP}`);
  if (!localMeaning) {
    console.log(`  (stage 1 failed to produce a valid LocalMeaning — raw response follows)\n  ${localRaw || "(empty)"}`);
  } else {
    console.log(`Concepts (${localMeaning.concepts.length}):`);
    for (const c of localMeaning.concepts) console.log(`  - [${c.id}] ${c.label}${c.description ? ` — ${c.description}` : ""}`);
    console.log(`Claims (${localMeaning.claims.length}):`);
    for (const c of localMeaning.claims) console.log(`  - ${c.text}${c.about?.length ? ` (about: ${c.about.join(", ")})` : ""}`);
    console.log(`Relationships (${localMeaning.relationships.length}):`);
    for (const r of localMeaning.relationships) console.log(`  - ${r.from} -${r.type}${r.label ? `:${r.label}` : ""}-> ${r.to}`);
    console.log(`Interpretation:\n  ${localMeaning.interpretation || "(none)"}`);
  }

  console.log(`\n${SEP}\nCURRENT GLOBAL STATE (before this round)\n${SEP}`);
  console.log(`Topic: ${before.topic ?? "(none)"}`);
  console.log(`Interpretation: ${before.currentInterpretation ?? "(none yet)"}`);
  console.log(`Concepts (${before.concepts.length}):`);
  for (const c of before.concepts) console.log(`  - [${c.id}] ${c.label} (${c.importance})`);
  console.log(`Claims (${before.claims.length}):`);
  for (const c of before.claims) console.log(`  - [${c.id}] ${c.text}`);

  let preSanitize = null;
  let postSanitize = null;
  let skipReason = null;
  let skipDetail = null;
  const next = await reconcileLocalMeaning(before, localMeaning ?? { concepts: [], claims: [], relationships: [], interpretation: "" }, undefined, {
    onReconcilePreSanitize: (json) => { preSanitize = json; },
    onReconcilePostSanitize: (json) => { postSanitize = json; },
    onReconcileSkip: (reason, detail) => { skipReason = reason; skipDetail = detail; },
  });

  console.log(`\n${SEP}\nPRE-SANITIZE RESULT\n${SEP}`);
  console.log(preSanitize ? JSON.stringify(preSanitize) : `  (no reconciliation result — skip reason: ${skipReason ?? "unknown"}${skipDetail ? ` | ${skipDetail}` : ""})`);

  console.log(`\n${SEP}\nPOST-SANITIZE RESULT\n${SEP}`);
  console.log(postSanitize ? JSON.stringify(postSanitize) : `  (no reconciliation result — skip reason: ${skipReason ?? "unknown"}${skipDetail ? ` | ${skipDetail}` : ""})`);

  const ops = diffSemanticState(before, next);
  console.log(`\n${SEP}\nFINAL OPERATIONS (${ops.length})\n${SEP}`);
  if (!ops.length) console.log("  (none — no change this round)");
  for (const op of ops) console.log(`  - ${describeOp(op)}`);
  console.log(`Updated interpretation:\n  ${next.currentInterpretation ?? "(none)"}`);

  const hasLocalContent = Boolean(localMeaning && (localMeaning.concepts.length || localMeaning.claims.length || localMeaning.relationships.length || localMeaning.interpretation));
  let classification;
  if (!ops.length) {
    if (!localMeaning) classification = "LOCAL_EXTRACTION_FAILURE (stage 1 call/parse failed outright)";
    else if (!hasLocalContent) classification = "VALID_IGNORE (stage 1 correctly found nothing new — verify against the raw thought)";
    else if (skipReason === "call-error" || skipReason === "empty-response" || skipReason === "unparseable-json" || skipReason === "schema-invalid") classification = `RECONCILE_CALL_FAILURE (${skipReason}: ${skipDetail ?? ""})`;
    else if (preSanitize && JSON.stringify(preSanitize) !== JSON.stringify(postSanitize)) classification = "SCHEMA_TRUNCATION or SEMANTIC_CAP_PRUNING (sanitize changed the payload — inspect pre vs. post above)";
    else classification = "RECONCILIATION_FAILURE (stage 1 found real content, model responded, but produced zero ops — inspect PRE-SANITIZE RESULT above)";
  } else {
    classification = "accumulated (produced at least one operation)";
  }
  console.log(`\nCLASSIFICATION: ${classification}`);

  return { next, ops };
}

async function replaySequence(label, thoughts, initialState, initialContext) {
  let state = initialState;
  let recentContext = initialContext;
  for (let i = 0; i < thoughts.length; i += 1) {
    const thought = thoughts[i];
    const before = state;
    // eslint-disable-next-line no-await-in-loop
    const { next, ops } = await runInstrumentedRound(label, i, thought, before, recentContext);
    if (ops.length) state = next;
    recentContext = [...recentContext, thought].slice(-CONTEXT_WINDOW_SIZE);
  }
  return { state, recentContext };
}

console.log("=".repeat(78));
console.log("PART A — INDIVIDUAL NOTES (state reset between each)");
console.log("=".repeat(78));

const individualResults = {};
for (const [label, thoughts] of Object.entries(NOTES)) {
  console.log(`\n${"#".repeat(78)}\n${label}\n${"#".repeat(78)}`);
  console.log(`RAW TRANSCRIPT:\n  "${thoughts.join(" ")}"`);
  console.log(`SETTLED THOUGHTS (${thoughts.length}):`);
  thoughts.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
  // eslint-disable-next-line no-await-in-loop
  const result = await replaySequence(label, thoughts, EMPTY_SEMANTIC_STATE, []);
  individualResults[label] = result.state;
  console.log(`\n=== ${label} — FINAL INDIVIDUAL STATE ===`);
  console.log(JSON.stringify(result.state, null, 2));
}

console.log(`\n\n${"=".repeat(78)}`);
console.log("PART B — CHRONOLOGICAL COMBINED (no reset between notes)");
console.log("=".repeat(78));

let combinedState = EMPTY_SEMANTIC_STATE;
let combinedContext = [];
for (const [label, thoughts] of Object.entries(NOTES)) {
  console.log(`\n${"#".repeat(78)}\nENTERING ${label}\n${"#".repeat(78)}`);
  // eslint-disable-next-line no-await-in-loop
  const result = await replaySequence(label, thoughts, combinedState, combinedContext);
  combinedState = result.state;
  combinedContext = result.recentContext;
}

console.log(`\n\n${"=".repeat(78)}`);
console.log("FINAL COMBINED SEMANTIC STATE (all three notes, chronological)");
console.log("=".repeat(78));
console.log(JSON.stringify(combinedState, null, 2));
