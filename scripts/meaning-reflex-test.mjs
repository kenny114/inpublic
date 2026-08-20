/**
 * The reflex layer — visuals that react during speech (lib/meaning/reflex.ts,
 * lib/meaning/lexicon.ts scanUtterance).
 *
 * The behaviour this file exists to pin down is *sharpening*: a clause that
 * gains words must redraw the same sign in place, never remove it and add a
 * second one. That is the difference between a canvas that follows a speaker
 * and one that stutters.
 *
 *   node --import ./scripts/ts-register.mjs scripts/meaning-reflex-test.mjs
 */

import { scanUtterance } from "../lib/meaning/lexicon.ts";
import {
  emptyProvisionalState,
  scanProvisional,
  clearProvisional,
} from "../lib/meaning/reflex.ts";
import { MAX_PROVISIONAL } from "../lib/meaning/provisional.ts";

let pass = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) pass += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

const glyphs = (text) => scanUtterance(text).map((s) => s.sign.glyph);

// --- scanning -------------------------------------------------------------

check("silence for an empty utterance", scanUtterance("").length === 0);
check("silence for pure filler", scanUtterance("um so yeah you know like").length === 0, glyphs("um so yeah you know like").join(","));
check(
  "silence for words the vocabulary cannot picture",
  scanUtterance("the quarterly planning ritual").length === 0,
  glyphs("the quarterly planning ritual").join(","),
);

const sentence = "the reason our users are leaving is because onboarding is too complicated";
const scanned = scanUtterance(sentence);
const found = scanned.map((s) => s.sign.glyph);
check("the worked example yields signs", scanned.length >= 2, `got ${found.join(",")}`);
check("it finds the departure", found.includes("exit"), found.join(","));
check("it finds the process", found.includes("funnel"), found.join(","));
check("every scanned sign is tentative", scanned.every((s) => s.sign.tentative === true));
check(
  "the complicated clause carries the clutter",
  scanned.some((s) => s.sign.glyph === "funnel" && s.sign.texture === "cluttered"),
  scanned.map((s) => `${s.sign.glyph}/${s.sign.texture}`).join(","),
);
check(
  "the departure carries the problem charge",
  scanned.some((s) => s.sign.glyph === "exit" && s.sign.charge === "problem"),
);
check("clause indexes are ascending", scanned.every((s, i) => i === 0 || s.index > scanned[i - 1].index));
check("scanning is pure", JSON.stringify(scanUtterance(sentence)) === JSON.stringify(scanned));

// A causal cue splits rather than draws: the two sides are read independently,
// and the causal link itself is left to the settled layer's arrow. Drawing a
// connector glyph here would preempt the better rendering by a moment.
const causal = glyphs("onboarding is complicated because users are confused");
check("a causal cue splits the clauses", causal.length === 2, causal.join(","));
check("both sides are read independently", causal.includes("funnel") && causal.includes("fog"), causal.join(","));
check("the cue itself draws nothing", !causal.includes("source"), causal.join(","));

// But a NAMED cause is a concept, and does draw.
check("a named cause draws the source glyph", glyphs("the root cause was obvious").includes("source"));

// --- the sharpening path --------------------------------------------------

let state = emptyProvisionalState();

const tick1 = scanProvisional(state, "our onboarding", "utt-1");
state = tick1.state;
check("first tick adds a sign", tick1.added.length === 1, JSON.stringify(tick1.added.map((a) => a.sign.glyph)));
check("first tick draws a funnel", tick1.added[0]?.sign.glyph === "funnel");
check("first tick is calm", tick1.added[0]?.sign.texture === "normal");
check("first tick removes nothing", tick1.removed.length === 0);

const tick2 = scanProvisional(state, "our onboarding is too complicated", "utt-1");
state = tick2.state;
check("the sharpened clause is an update, not a new sign", tick2.updated.length === 1 && tick2.added.length === 0,
  `added=${tick2.added.length} updated=${tick2.updated.length}`);
check("the sign is never removed while sharpening", tick2.removed.length === 0);
check("it keeps its identity", tick2.updated[0]?.key === tick1.added[0]?.key);
check("it keeps its glyph", tick2.updated[0]?.sign.glyph === "funnel");
check("it gains the clutter", tick2.updated[0]?.sign.texture === "cluttered");
check("it gains the problem charge", tick2.updated[0]?.sign.charge === "problem");

const tick3 = scanProvisional(state, "our onboarding is too complicated so users are leaving", "utt-1");
state = tick3.state;
check("a new clause adds a new sign", tick3.added.length === 1, JSON.stringify(tick3.added.map((a) => a.sign.glyph)));
check("the new sign is the departure", tick3.added[0]?.sign.glyph === "exit");
check("the existing sign is left alone", tick3.updated.length === 0 && tick3.removed.length === 0);

// Re-scanning identical text must be a no-op, or the canvas would rewrite
// itself several times a second while the speaker pauses.
const idle = scanProvisional(state, "our onboarding is too complicated so users are leaving", "utt-1");
state = idle.state;
check("an unchanged utterance redraws nothing",
  idle.added.length === 0 && idle.updated.length === 0 && idle.removed.length === 0);

// --- retraction -----------------------------------------------------------

const walkedBack = scanProvisional(state, "our onboarding is too complicated", "utt-1");
check("a clause Deepgram revised away is removed", walkedBack.removed.length === 1, JSON.stringify(walkedBack.removed));
check("the surviving clause is untouched", walkedBack.added.length === 0 && walkedBack.updated.length === 0);
state = walkedBack.state;

// --- utterance and lifecycle boundaries -----------------------------------

const newUtterance = scanProvisional(state, "revenue is growing", "utt-2");
check("a new utterance retires the old signs", newUtterance.removed.length >= 1);
check("a new utterance draws its own", newUtterance.added.length === 1 && newUtterance.added[0].sign.glyph === "rise");
check("keys are scoped to the utterance", newUtterance.added[0].key.startsWith("utt-2:"));
state = newUtterance.state;

const cleared = clearProvisional(state);
check("settling retires every provisional sign", cleared.removed.length === 1);
check("settling leaves no state behind", cleared.state.byKey.size === 0);
check("clearing an empty state is a no-op", clearProvisional(cleared.state).removed.length === 0);

// --- the band's cap -------------------------------------------------------

const long = "onboarding is complicated, users are leaving, revenue is falling, we fixed it, growth returned, and the value is clear";
let capState = emptyProvisionalState();
const capped = scanProvisional(capState, long, "utt-3");
check("a long sentence scans to many clauses", capped.state.byKey.size > MAX_PROVISIONAL,
  `${capped.state.byKey.size} clauses`);
check("the cap is small enough to read", MAX_PROVISIONAL <= 6);

// --- report ---------------------------------------------------------------

if (failures.length) {
  console.error(`meaning-reflex-test: ${pass} passed, ${failures.length} FAILED`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`meaning-reflex-test: ${pass} passed`);
