/**
 * The decision layers, tested directly.
 *
 *   node --import ./scripts/ts-register.mjs scripts/unit-test.mjs
 *
 * No network, no canvas, no API keys. Everything here is a pure function that
 * a session either depends on or is ruined by.
 */

import {
  correctTranscript,
  groundedInSource,
  keyterms,
  soundsLike,
} from "../lib/vocab.ts";
import { decidePageTurn, isThoughtComplete, MAX_DEFER_MS } from "../lib/pagination.ts";
import { detectBackReference, resolveReference } from "../lib/reference.ts";
import { pathBlocked, routeArrow } from "../lib/routing.ts";
import { matchMark, planActions } from "../lib/organizer.ts";
import { emptyUndo, SemanticBoard } from "../lib/semantic.ts";
import { isFragment, parseLine } from "../lib/ops.ts";
import {
  EMPTY_THOUGHT,
  flushStructuralThought,
  localVoiceCommand,
  pushStructuralSegment,
  retirePending,
} from "../lib/liveSpeech.ts";
import { liveLatencySample } from "../lib/telemetry.ts";
import { parseDecision } from "../lib/beat.ts";
import { composeAttentionBudget, withinInitialCompositionWindow } from "../lib/attention.ts";
import { requestDelayMs, retryAfterMs } from "../lib/requestScheduling.ts";
import {
  destructiveCorrections,
  firstTwoMinutePages,
  fragmentedMovement,
  resetTimelineTiming,
  scratchSelfUndoHistory,
  validLiveTiming,
} from "./fixtures/latest-session-regressions.mjs";

let pass = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    pass += 1;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n── ${title}`);
}

// ---------------------------------------------------------- request pacing

section("request pacing");

check(
  "a first request can run immediately",
  requestDelayMs({ nowMs: 100_000, lastRunAtMs: 0, retryAtMs: 0, lastPointerAtMs: 0, minIntervalMs: 5250, touchLockMs: 1500 }) === 0,
);
check(
  "queued work cannot bypass the minimum interval",
  requestDelayMs({ nowMs: 12_000, lastRunAtMs: 10_000, retryAtMs: 0, lastPointerAtMs: 0, minIntervalMs: 5250, touchLockMs: 1500 }) === 3250,
);
check(
  "the server cooldown wins when it is longer",
  requestDelayMs({ nowMs: 12_000, lastRunAtMs: 10_000, retryAtMs: 20_000, lastPointerAtMs: 0, minIntervalMs: 5250, touchLockMs: 1500 }) === 8000,
);
check("Retry-After seconds are respected", retryAfterMs("17", 60_000, 1000) === 17_000);
check("Retry-After dates are respected", retryAfterMs("Thu, 01 Jan 1970 00:00:20 GMT", 60_000, 1000) === 19_000);
check("invalid Retry-After uses a safe fallback", retryAfterMs("later", 60_000, 1000) === 60_000);

// ---------------------------------------------------------------- vocabulary

section("recognition repair");

{
  const { text, corrections } = correctTranscript(
    "the impact of air agents on people",
    [],
  );
  check(
    "known error: air agents -> AI agents",
    text.includes("AI agents"),
    text,
  );
  check("known error is logged", corrections.length === 1, JSON.stringify(corrections));
}

{
  // The guard rail: ordinary English must survive contact with the board.
  const { text } = correctTranscript(
    "people want to be in control of their data",
    ["People Ops", "Airline", "AI agents"],
  );
  check(
    "ordinary words are not overwritten",
    text === "people want to be in control of their data",
    text,
  );
}

{
  const { text } = correctTranscript("I want to talk about your line", [
    "Airline",
  ]);
  check("a canvas term wins over a mishearing", text.includes("Airline"), text);
}

{
  const { text } = correctTranscript("as for affiliate capitol, the model is", [
    "Affiliate Capital",
  ]);
  check(
    "multi-word canvas term corrected",
    text.includes("Affiliate Capital"),
    text,
  );
}

{
  const { text } = correctTranscript("nothing on the board yet at all", []);
  check("no active terms means no rewriting", text === "nothing on the board yet at all", text);
}

check("phonetics: exact", soundsLike("Airline", "airline") === 1);
check("phonetics: near", soundsLike("air agents", "AI agents") > 0.5);
check("phonetics: unrelated", soundsLike("people", "Airline") < 0.5);

{
  const terms = keyterms({
    sections: ["Affiliate Capital", "Untitled"],
    concepts: ["AI agents"],
    marks: ["customer service"],
  });
  check("keyterms lead with the section", terms[0] === "Affiliate Capital", terms[0]);
  check("keyterms include concepts", terms.includes("AI agents"));
  check("keyterms drop the Untitled placeholder", !terms.includes("Untitled"));
  check("keyterms fall back to the seed list", terms.includes("Airline"));
  check("keyterms are capped", terms.length <= 40, String(terms.length));
}

check(
  "grounded: a real phrase passes",
  groundedInSource("AI agents", "the impact of air agents on people"),
);
check(
  "grounded: junk is rejected",
  !groundedInSource("puts AI", "businesses want effectiveness from their tools"),
);

{
  const cases = [
    ["The cat ran away", "The cat ran away"],
    ["The cat ran from the rain", "The cat ran from the rain"],
    ["It began to rain", "It began to rain"],
    ["Kenny Farmer spoke", "Kenny Farmer spoke"],
  ];
  for (const [raw, expected] of cases) {
    const result = correctTranscript(raw, ["rain", "Kenny Fama", "Airline", "ClickLabs"]);
    check(`ordinary language preserved: ${raw}`, result.text === expected, result.text);
  }
  check("real fixture contains the ran/rain defect", destructiveCorrections.length === 2);
  check("InPublic named vocabulary wins", correctTranscript("in public app", ["InPublic"]).text === "InPublic app");
  check("ClickLabs named vocabulary is available", keyterms({}).includes("ClickLabs"));
  check("Airline named vocabulary remains available", keyterms({}).includes("Airline"));
}

// ----------------------------------------------------------- live speech lane

section("live speech regressions");

for (const command of ["Scratch that.", "Remove that.", "Undo."]) {
  check(`local command: ${command}`, localVoiceCommand(command) === "undo");
}
check("ordinary narration is not a command", localVoiceCommand("Undo is useful.") === null);
check("historical scratch fixture would self-undo", scratchSelfUndoHistory.at(-1) === "live_line");

for (let attempt = 1; attempt <= 5; attempt += 1) {
  const board = new SemanticBoard();
  board.push({
    operationId: `keep-${attempt}`,
    type: "create_concept",
    timestamp: 1,
    sourceText: "unrelated",
    confidence: 1,
    conceptIds: ["unrelated"],
    elementIds: ["unrelated"],
    undo: emptyUndo(),
  });
  board.push({
    operationId: `draw-${attempt}`,
    type: "scribe_mark",
    timestamp: 2,
    sourceText: "draw this",
    confidence: 1,
    conceptIds: [],
    elementIds: [`draw-${attempt}`],
    undo: emptyUndo(),
  });
  board.push({
    operationId: `command-line-${attempt}`,
    type: "live_line",
    timestamp: 3,
    sourceText: "scratch that",
    confidence: 1,
    conceptIds: [],
    elementIds: [`command-line-${attempt}`],
    undo: emptyUndo(),
  });
  const target = board.lastMeaningful();
  check(`scratch attempt ${attempt} targets the drawing`, target?.operationId === `draw-${attempt}`);
  check(`scratch attempt ${attempt} leaves unrelated content`, board.history[0].operationId === `keep-${attempt}`);
}

{
  let result = pushStructuralSegment(EMPTY_THOUGHT, fragmentedMovement[0], 100);
  check("towards fragment is held", result.held && result.thought === null);
  result = pushStructuralSegment(result.state, fragmentedMovement[1], 300);
  check("towards + target becomes one thought", result.thought === "The cat rain towards the car.", result.thought ?? "");
}

{
  let result = pushStructuralSegment(EMPTY_THOUGHT, "Businesses need", 100);
  result = pushStructuralSegment(result.state, "trusted infrastructure", 400);
  check("business fragment is coalesced", result.thought === "Businesses need trusted infrastructure", result.thought ?? "");
  const complete = pushStructuralSegment(EMPTY_THOUGHT, "Trust matters.", 500);
  check("complete short thought emits immediately", complete.thought === "Trust matters.");
  check("held thought can be bounded-flushed", flushStructuralThought(pushStructuralSegment(EMPTY_THOUGHT, "because", 0).state).thought === "because");
}

// --------------------------------------------------------------- telemetry

section("stream timing epochs");

check("real fixture has valid sub-2s samples", validLiveTiming.every((item) => item.lagMax < 2000));
check("real fixture captures the 202-second reset", resetTimelineTiming.every((item) => item.lagP50 > 200000));
check("initial stream sample accepted", liveLatencySample(1388, { audioEndMs: 1000, streamEpoch: 1 }, 1).lagMs === 388);
check("reconnect epoch mismatch rejected", liveLatencySample(203000, { audioEndMs: 500, streamEpoch: 2 }, 1).reason === "stream-epoch-mismatch");
check("pause/resume stale offset rejected", liveLatencySample(203000, { audioEndMs: 500, streamEpoch: 3 }, 3).reason === "stale-audio");
check("visibility resume on a rebased epoch is valid", liveLatencySample(250400, { audioEndMs: 250100, streamEpoch: 4 }, 4).lagMs === 300);

// ---------------------------------------------------------- attention budget

section("one evolving composition");

{
  const composition = composeAttentionBudget(
    ["Airline", "AI Agents", "Businesses", "Security", "Trust", "Dedicated infrastructure", "Airline"],
    [
      { from: "Airline", to: "AI Agents" },
      { from: "Businesses", to: "AI Agents" },
      { from: "Airline", to: "Security" },
      { from: "Airline", to: "Trust" },
    ],
  );
  check("Airline remains primary", composition.primary === "Airline");
  check("at most five supporting concepts", composition.supporting.length <= 5);
  check("at most three visible relationships", composition.relationships.length <= 3);
  check("no duplicate concepts", new Set([composition.primary, ...composition.supporting].map((x) => x.toLowerCase())).size === 6);
  check("initial 60 seconds stays in composition window", firstTwoMinutePages.filter((page) => page.t < 60000).every((page) => withinInitialCompositionWindow(page.t)));
  check("audit fixture proves old page churn", firstTwoMinutePages.length === 7);
}

// ------------------------------------------------------------------- pages

section("page turns");

check("thought complete: full stop", isThoughtComplete("Airline is infrastructure."));
check("thought complete: trailing preposition is not", !isThoughtComplete("businesses want to use their agents for the"));
check("thought complete: trailing comma is not", !isThoughtComplete("have both a bad and a good aspect,"));
check("thought complete: nothing in flight", isThoughtComplete(""));

{
  const d = decidePageTurn({
    trigger: "overflow",
    marks: 3,
    maxMarks: 22,
    liveText: "and what they do to",
    deferredForMs: 0,
  });
  check("overflow turns even mid-thought", d.turn && d.reason === "overflow", JSON.stringify(d));
}

{
  const d = decidePageTurn({
    trigger: "capacity",
    marks: 22,
    maxMarks: 22,
    liveText: "AI agents, when they",
    deferredForMs: 0,
  });
  check("capacity waits for an unfinished thought", !d.turn && d.deferred, JSON.stringify(d));
}

{
  const d = decidePageTurn({
    trigger: "capacity",
    marks: 22,
    maxMarks: 22,
    liveText: "AI agents have both good and bad aspects.",
    deferredForMs: 0,
  });
  check("capacity turns once the thought lands", d.turn && d.reason === "sheet-full", JSON.stringify(d));
}

{
  const d = decidePageTurn({
    trigger: "capacity",
    marks: 22,
    maxMarks: 22,
    liveText: "and they never stop talking so",
    deferredForMs: MAX_DEFER_MS + 1,
  });
  check("a deferral expires rather than hanging", d.turn, JSON.stringify(d));
}

{
  const d = decidePageTurn({
    trigger: "section",
    marks: 2,
    maxMarks: 22,
    liveText: "now let's move on to",
    deferredForMs: 0,
  });
  check("a topic change turns immediately", d.turn && d.reason === "topic-change", JSON.stringify(d));
}

// --------------------------------------------------------------- references

section("reference and return");

{
  const cases = [
    ["Going back to Airline, the main problem is trust.", "Airline"],
    ["Back to the AI agents point, they need oversight.", "AI agents"],
    ["Also, about the businesses, they want scale.", "businesses"],
    ["Remember when I mentioned Affiliate Capital?", "Affiliate Capital"],
    ["As for Affiliate Capital, the model is different.", "Affiliate Capital"],
  ];
  for (const [text, expected] of cases) {
    const ref = detectBackReference(text);
    check(
      `cue detected: "${text.slice(0, 28)}…"`,
      ref !== null && ref.phrase.toLowerCase() === expected.toLowerCase(),
      ref ? ref.phrase : "no match",
    );
  }
  check(
    "a normal sentence is not a reference",
    detectBackReference("Airline is infrastructure for AI agents.") === null,
  );
  check(
    "a pronoun target is not resolvable",
    detectBackReference("going back to it, we should ship") === null,
  );
}

{
  const world = {
    sections: [{ sectionId: "s1", title: "Airline", pageIndex: 0 }],
    concepts: [
      { conceptId: "ai-agents", label: "AI agents", pageIndex: 1 },
      { conceptId: "businesses", label: "businesses", pageIndex: 2 },
    ],
    currentPage: 3,
  };
  const hit = resolveReference(
    detectBackReference("Going back to Airline, the main problem is trust."),
    world,
  );
  check("resolves to the right page", hit?.pageIndex === 0, JSON.stringify(hit));
  check("resolution is confident", (hit?.confidence ?? 0) >= 0.7, String(hit?.confidence));

  const miss = resolveReference(
    { cue: "going back to", phrase: "quantum tunnelling", rest: "" },
    world,
  );
  check("an unknown target does not move the camera", miss === null, JSON.stringify(miss));
}

// ------------------------------------------------------------------ routing

section("arrow routing");

{
  const a = { x: 0, y: 0, width: 100, height: 60 };
  const b = { x: 400, y: 0, width: 100, height: 60 };
  const clear = routeArrow(a, b, []);
  check("neighbours get a straight arrow", !clear.routed && clear.points.length === 2);

  const blocker = { x: 200, y: 10, width: 80, height: 40 };
  const routed = routeArrow(a, b, [blocker]);
  check("an obstacle forces a detour", routed.routed, JSON.stringify(routed.points));
  const abs = routed.points.map(([x, y]) => ({
    x: routed.start.x + x,
    y: routed.start.y + y,
  }));
  check(
    "the detour actually clears the obstacle",
    !pathBlocked(abs, [{ x: 186, y: -4, width: 108, height: 68 }]),
    JSON.stringify(abs),
  );
}

// ---------------------------------------------------------------- organizer

section("organizer");

{
  const board = new SemanticBoard();
  board.addConcept({ conceptId: "ai-agents", label: "AI agents" });

  const marks = [
    { key: "businesses", text: "Businesses", elementId: "el_1" },
    { key: "customer service", text: "Customer Service", elementId: "el_2" },
  ];

  const plan = planActions(
    [
      { type: "create_concept", conceptId: "ai-agents", label: "AI agents", kind: "process" },
      { type: "create_concept", conceptId: "businesses", label: "Businesses", kind: "person" },
      { type: "create_concept", conceptId: "sales", label: "Sales", kind: "output" },
      {
        type: "create_relationship",
        fromConceptId: "businesses",
        toConceptId: "ai-agents",
        relationshipType: "use",
      },
    ],
    board,
    marks,
  );

  const kinds = plan.steps.map((s) => s.kind);
  check("an existing concept is reused", kinds[0] === "reuse", kinds.join(","));
  check("a lettered mark is adopted, not duplicated", kinds[1] === "adopt", kinds.join(","));
  check("a genuinely new concept is created", kinds[2] === "create", kinds.join(","));
  check("the relationship survives planning", kinds[3] === "link", kinds.join(","));
  check("spoken order is preserved", kinds.length === 4);

  const link = plan.steps[3];
  check(
    "the link points at the reused id",
    link.toConceptId === "ai-agents",
    JSON.stringify(link),
  );
}

{
  const board = new SemanticBoard();
  board.addConcept({ conceptId: "a", label: "Alpha" });
  board.addConcept({ conceptId: "b", label: "Beta" });
  board.addRelationship({ fromConceptId: "a", toConceptId: "b" });
  const plan = planActions(
    [{ type: "create_relationship", fromConceptId: "a", toConceptId: "b", relationshipType: "x" }],
    board,
    [],
  );
  check("an existing relationship is not drawn twice", plan.steps[0].kind === "drop", JSON.stringify(plan.steps[0]));
}

{
  const plan = planActions(
    [
      {
        type: "create_relationship",
        fromConceptId: "ghost",
        toConceptId: "phantom",
        relationshipType: "x",
      },
    ],
    new SemanticBoard(),
    [],
  );
  check("a link to nothing is dropped, not drawn", plan.steps[0].kind === "drop");
}

check(
  "mark matching tolerates a mishearing",
  matchMark("AI agents", [{ key: "ai agents", text: "AI Agents", elementId: "e" }]) !== null,
);
check(
  "mark matching refuses an unrelated word",
  matchMark("Affiliate Capital", [{ key: "people", text: "People", elementId: "e" }]) === null,
);

// -------------------------------------------------------------------- marks

section("mark quality");

check("fragment: trailing preposition", isFragment("businesses want to use their agents for the"));
check("fragment: bare pronoun", isFragment("they are"));
check("not a fragment: a real phrase", !isFragment("lack of security"));
check("parseLine drops a fragment", parseLine('word "build a"').length === 0);
check("parseLine keeps a real mark", parseLine('word "mass calling"').length === 1);

// ------------------------------------------------------- retiring pending text

section("retiring pending text after a beat");

// The regression this exists for: the beat is asked about sentence two, and
// sentence three lands in the buffer while the Artist is still working. The
// old code cleared the whole buffer, so the queued re-run found nothing and
// the closing thought of an explanation never became structure.
{
  const sent = "Most of that churn came from new customers who cancelled after their first month.";
  const arrivedMeanwhile = "So our next priority is improving onboarding and retention.";
  const buffer = `${sent} ${arrivedMeanwhile}`;
  check(
    "the thought that arrived mid-flight survives",
    retirePending(buffer, sent) === arrivedMeanwhile,
  );
}

check("nothing new means an empty buffer", retirePending("a b c", "a b c") === "");
check("a consumed prefix is retired exactly", retirePending("one two three", "one two") === "three");
check("surrounding whitespace never leaks", retirePending("  one two   three  ", "one two") === "three");
// If the word cap dropped the front of the buffer there is no safe leftover,
// so it retires whole rather than re-drawing something already on the board.
check("a buffer that no longer matches retires whole", retirePending("different words", "one two") === "");
check("consuming nothing keeps the buffer", retirePending("one two", "") === "one two");

// ------------------------------------------------------------- beat responses

section("reading the beat's answer");

// A malformed response is not a decision. It used to become `skip`, which is
// indistinguishable from a deliberate one, so the thought was thrown away with
// nothing to retry it. The real case, from a demo run: a fenced object,
// truncated mid-key.
const truncated = '```json\n{"action": "skip", "reason": "topic announced, no new content", "focus":';
check("a truncated fenced object is a failure, not a skip", parseDecision(truncated).ok === false);
check("the failure keeps the raw response for the retry", parseDecision(truncated).raw === truncated);

const fenced = '```json\n{"action":"draw","reason":"two outcomes","focus":"revenue and churn both rose"}\n```';
check("a well-formed fenced object still parses", parseDecision(fenced).ok === true);
check("...and keeps its action", parseDecision(fenced).decision?.action === "draw");

const withProse = 'Here you go:\n{"action":"section","reason":"topic change","focus":"Affiliate Capital"}';
check("an object buried in prose is salvaged", parseDecision(withProse).ok === true);

// Readable JSON with a bogus action is a genuine skip: a retry cannot help.
const badAction = '{"action":"interpretive-dance","reason":"","focus":""}';
check("readable JSON with an unknown action is a skip, not a retry", parseDecision(badAction).ok === true);
check("...and that skip is inert", parseDecision(badAction).decision?.action === "skip");

check("plain prose is a failure", parseDecision("I think we should draw something.").ok === false);
check("an empty response is a failure", parseDecision("").ok === false);

// ------------------------------------------------------------------ results

console.log(`\n${"─".repeat(60)}`);
if (failures.length === 0) {
  console.log(`✓ ${pass} checks passed`);
} else {
  console.log(`${pass} passed, ${failures.length} FAILED:\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exitCode = 1;
}
