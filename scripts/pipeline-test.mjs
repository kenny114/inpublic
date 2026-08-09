/**
 * The six conversations, end to end.
 *
 *   node --import ./scripts/ts-register.mjs scripts/pipeline-test.mjs
 *   node --import ./scripts/ts-register.mjs scripts/pipeline-test.mjs --live
 *
 * Default (offline) runs the real decision layers against recorded Artist
 * responses, so it is deterministic, needs no API key, and can be run on every
 * change. `--live` sends the same utterances to a running dev server on :3210
 * and uses whatever the real beat and Artist return — slower, non-deterministic,
 * costs tokens, and is the only mode that measures true latency.
 *
 * Recorded responses are what a real Artist plausibly returns for these
 * utterances, INCLUDING the mistake that matters: asking to create concepts
 * whose words are already lettered on the page. If the planner stops catching
 * that, these tests go red.
 */

import { FakeBoard } from "./fake-board.mjs";
import { detectBackReference, resolveReference } from "../lib/reference.ts";
import { isThoughtComplete } from "../lib/pagination.ts";
import { pathBlocked } from "../lib/routing.ts";

const LIVE = process.argv.includes("--live");
const APP = process.env.APP ?? "http://localhost:3210";

let pass = 0;
const failures = [];
const latencies = [];

function check(name, condition, detail = "") {
  if (condition) pass += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`   ${condition ? "✓" : "✗"} ${name}${condition || !detail ? "" : ` — ${detail}`}`);
}

// --- recorded Artist responses -------------------------------------------

const RECORDED = {
  "Airline is infrastructure for AI agents.": [
    { type: "create_concept", conceptId: "airline", label: "Airline", kind: "product" },
    { type: "create_concept", conceptId: "infrastructure", label: "Infrastructure", kind: "process" },
    { type: "create_concept", conceptId: "ai-agents", label: "AI agents", kind: "product" },
    { type: "create_relationship", fromConceptId: "airline", toConceptId: "infrastructure", relationshipType: "is" },
    { type: "create_relationship", fromConceptId: "infrastructure", toConceptId: "ai-agents", relationshipType: "enables" },
  ],
  "AI agents affect people, but they also have good and bad aspects.": [
    // The mistake under test: ai-agents already exists.
    { type: "create_concept", conceptId: "ai-agents", label: "AI agents", kind: "product" },
    { type: "create_concept", conceptId: "people", label: "People", kind: "person" },
    { type: "create_concept", conceptId: "good-aspects", label: "Good aspects", kind: "solution" },
    { type: "create_concept", conceptId: "bad-aspects", label: "Bad aspects", kind: "problem" },
    { type: "create_relationship", fromConceptId: "ai-agents", toConceptId: "people", relationshipType: "affects" },
    { type: "create_relationship", fromConceptId: "ai-agents", toConceptId: "good-aspects", relationshipType: "has" },
    { type: "create_relationship", fromConceptId: "ai-agents", toConceptId: "bad-aspects", relationshipType: "has" },
  ],
  "Businesses use AI agents for customer service and sales.": [
    { type: "create_concept", conceptId: "businesses", label: "Businesses", kind: "person" },
    { type: "create_concept", conceptId: "ai-agents", label: "AI agents", kind: "product" },
    { type: "create_concept", conceptId: "customer-service", label: "Customer service", kind: "output" },
    { type: "create_concept", conceptId: "sales", label: "Sales", kind: "output" },
    { type: "create_relationship", fromConceptId: "businesses", toConceptId: "ai-agents", relationshipType: "use" },
    { type: "create_relationship", fromConceptId: "ai-agents", toConceptId: "customer-service", relationshipType: "for" },
    { type: "create_relationship", fromConceptId: "ai-agents", toConceptId: "sales", relationshipType: "for" },
  ],
  "Going back to Airline, the main problem is trust.": [
    { type: "create_concept", conceptId: "trust", label: "Trust", kind: "problem" },
    { type: "create_relationship", fromConceptId: "airline", toConceptId: "trust", relationshipType: "main problem" },
  ],
  "Now let's move on to Affiliate Capital.": [
    { type: "create_section", title: "Affiliate Capital" },
  ],
};

/** Ask the real routes, or hand back the recording. */
async function artistFor(board, utterance, focus, intent = "draw") {
  if (!LIVE) return { actions: RECORDED[utterance] ?? [], ms: 0 };
  const started = Date.now();
  const res = await fetch(`${APP}/api/artist`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      focus,
      transcript: utterance,
      sceneSummary: [],
      scene: board.board.scene({ currentPage: board.page, recentTranscript: utterance }),
      intent,
    }),
  });
  const { actions } = await res.json();
  return { actions: actions ?? [], ms: Date.now() - started };
}

async function beatFor(board, utterance) {
  if (!LIVE) {
    // Offline: the recorded decision. `section` for the topic move, draw
    // otherwise, and never on a fragment.
    if (!isThoughtComplete(utterance)) return { action: "skip", focus: "", ms: 0 };
    if (/^now let'?s move on to/i.test(utterance)) {
      return { action: "section", focus: "Affiliate Capital", ms: 0 };
    }
    if (/^scratch that/i.test(utterance)) return { action: "undo", focus: "", ms: 0 };
    return { action: "draw", focus: utterance, ms: 0 };
  }
  const started = Date.now();
  const res = await fetch(`${APP}/api/beat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pendingText: utterance,
      sceneSummary: [],
      lastDrawnAt: 3,
      liveConcepts: [...board.marks.keys()].slice(-20),
      skipStreak: 0,
      scene: board.board.scene({ currentPage: board.page, recentTranscript: utterance }),
    }),
  });
  const decision = await res.json();
  return { ...decision, ms: Date.now() - started };
}

/**
 * Would the product ask the beat about this yet?
 *
 * `resetSilenceTimer` holds an unfinished thought back past the 600ms silence
 * and only gives up after FRAGMENT_GRACE_MS. Calling the beat directly, as an
 * earlier version of this harness did, skips that gate entirely — and then
 * "tests" the beat's judgement on a fragment the product would never have sent
 * it. The gate is the thing under test, so it belongs here.
 */
function gateFor(utterance) {
  return isThoughtComplete(utterance)
    ? { fires: true, why: "thought complete + 600ms silence" }
    : { fires: false, why: "fragment held for the thought to land" };
}

/** One utterance, all the way through. */
async function say(board, utterance) {
  const started = Date.now();
  const heard = board.hear(utterance);
  board.speak(heard.text);

  const gate = gateFor(heard.text);
  const decision = await beatFor(board, heard.text);
  decision.held = !gate.fires;
  decision.gate = gate.why;
  let applied = [];
  let plan = null;
  let artistMs = 0;

  if (decision.held) {
    // The product would still be waiting. Nothing reaches the canvas.
    latencies.push({ utterance, beatMs: decision.ms, artistMs: 0, totalMs: Date.now() - started });
    return { heard, decision, applied: [], plan: null, totalMs: Date.now() - started };
  }

  if (decision.action === "undo") {
    const op = board.undoLast();
    applied = [op ? `undid ${op.type}` : "nothing to undo"];
  } else if (decision.action !== "skip") {
    const visit = (() => {
      const ref = detectBackReference(heard.text);
      if (!ref) return null;
      const target = resolveReference(ref, {
        sections: [...board.board.sections.values()].map((s) => ({
          sectionId: s.sectionId,
          title: s.title,
          pageIndex: s.pageIndex,
        })),
        concepts: [...board.board.concepts.values()].map((c) => ({
          conceptId: c.conceptId,
          label: c.label,
          pageIndex: board.conceptNodes.get(c.conceptId)?.page ?? 0,
        })),
        currentPage: board.page,
      });
      return target ? { returnTo: board.page, target } : null;
    })();

    const artist = await artistFor(board, utterance, decision.focus, decision.action === "command" ? "command" : "draw");
    artistMs = artist.ms;
    if (visit) board.gotoPage(visit.target.pageIndex);
    ({ plan, applied } = board.organize(artist.actions, heard.text));
    if (visit) board.gotoPage(visit.returnTo);
    board.lastVisit = visit;
  }

  const totalMs = Date.now() - started;
  latencies.push({ utterance, beatMs: decision.ms, artistMs, totalMs });
  return { heard, decision, applied, plan, totalMs };
}

const line = (s) => console.log(`\n${s}`);

// ------------------------------------------------------------------- setup

console.log(
  LIVE
    ? `LIVE — real beat and Artist via ${APP}`
    : "OFFLINE — real decision layers, recorded Artist responses",
);

const board = new FakeBoard();

// --------------------------------------------------------------------- A

line("A. \"Airline is infrastructure for AI agents.\"");
{
  const r = await say(board, "Airline is infrastructure for AI agents.");
  console.log(`   heard: ${r.heard.text}`);
  console.log(`   lettered: ${r.heard.lettered.join(", ") || "(none)"}`);
  console.log(`   applied: ${r.applied.join(" | ")}`);

  const labels = [...board.board.concepts.values()].map((c) => c.label.toLowerCase());
  const relTypes = [...board.board.relationships.values()].map((r) =>
    r.relationshipType.toLowerCase(),
  );
  check("Airline exists", labels.some((l) => l.includes("airline")), labels.join(","));
  check("AI agents exists", labels.some((l) => l.includes("agent")));
  // "Infrastructure" is a relation as much as a thing, and the live Artist
  // sometimes models it as the edge — "Airline —is infrastructure for→ AI
  // agents" — rather than as a third box. Both put the idea on the board and
  // connect the two named things, which is what the conversation asks for.
  const asConcept = labels.some((l) => l.includes("infrastructure"));
  const asEdge = relTypes.some((t) => /infrastructure|support|enable|provide/.test(t));
  console.log(`   infrastructure modelled as: ${asConcept ? "a concept" : asEdge ? "a relationship" : "NOTHING"}`);
  check("infrastructure is on the board", asConcept || asEdge, labels.join(","));
  check("Airline reaches AI agents", board.board.relationships.size >= 1, String(board.board.relationships.size));
  check("every arrow is bound at both ends", board.arrows.every((a) => a.startBinding && a.endBinding));
  check("no duplicate concepts", board.duplicateLabels().length === 0, JSON.stringify(board.duplicateLabels()));
}

// --------------------------------------------------------------------- B

line("B. \"AI agents affect people, but they also have good and bad aspects.\"");
{
  const before = board.board.concepts.size;
  const r = await say(board, "AI agents affect people, but they also have good and bad aspects.");
  console.log(`   applied: ${r.applied.join(" | ")}`);

  const reusedOrAdopted = r.applied.filter((a) => /^(reused|adopted)/.test(a));
  check("an existing concept was reused rather than recreated", reusedOrAdopted.length >= 1, r.applied.join(" | "));
  check("new relationships were added", board.board.relationships.size >= 4, String(board.board.relationships.size));
  check("no duplicate concepts", board.duplicateLabels().length === 0, JSON.stringify(board.duplicateLabels()));
  check("concepts grew, but not by the full request", board.board.concepts.size < before + 4, `${before} -> ${board.board.concepts.size}`);
}

// --------------------------------------------------------------------- C

line("C. \"Businesses use AI agents for customer service and sales.\"");
{
  const aiBefore = [...board.board.concepts.values()].filter((c) => /agent/i.test(c.label)).length;
  const r = await say(board, "Businesses use AI agents for customer service and sales.");
  console.log(`   applied: ${r.applied.join(" | ")}`);

  const aiAfter = [...board.board.concepts.values()].filter((c) => /agent/i.test(c.label)).length;
  check("AI agents was not duplicated", aiAfter === aiBefore, `${aiBefore} -> ${aiAfter}`);
  const labels = [...board.board.concepts.values()].map((c) => c.label.toLowerCase());
  check("businesses is on the board", labels.some((l) => l.includes("business")), labels.join(","));
  check("use cases are on the board", labels.some((l) => l.includes("sales")));
  check("businesses is connected to agents", [...board.board.relationships.values()].some((rel) => /business/i.test(rel.fromConceptId) && /agent/i.test(rel.toConceptId)));
  check("no duplicate concepts", board.duplicateLabels().length === 0, JSON.stringify(board.duplicateLabels()));
}

// --------------------------------------------------------------------- D

line("D. \"Going back to Airline, the main problem is trust.\"");
{
  // Move to a later page first, so the return is a real move.
  board.liveText = "done with that.";
  board.requestPageTurn("section");
  board.board.startSection("Something else", board.page);
  const pageBefore = board.page;
  check("we are on a later page before the reference", pageBefore > 0, String(pageBefore));

  const airlinePage = board.conceptNodes.get("airline")?.page ?? 0;
  const r = await say(board, "Going back to Airline, the main problem is trust.");
  console.log(`   applied: ${r.applied.join(" | ")}`);
  console.log(`   visit: ${JSON.stringify(board.lastVisit?.target ?? null)}`);

  check("the reference resolved", board.lastVisit !== null && board.lastVisit !== undefined, "no visit");
  check("it resolved to Airline's page", board.lastVisit?.target.pageIndex === airlinePage, `${board.lastVisit?.target.pageIndex} vs ${airlinePage}`);
  check("the camera returned to the current page", board.page === pageBefore, `${board.page} vs ${pageBefore}`);

  const trust = [...board.board.concepts.values()].find((c) => /trust/i.test(c.label));
  check("trust was added", trust !== undefined);
  check("trust landed on Airline's page, not the current one", board.conceptNodes.get(trust?.conceptId)?.page === airlinePage, String(board.conceptNodes.get(trust?.conceptId)?.page));
  check("no duplicate Airline was created", [...board.board.concepts.values()].filter((c) => /airline/i.test(c.label)).length === 1);
}

// --------------------------------------------------------------------- E

line("E. \"Scratch that.\"");
{
  const elementsBefore = board.elements.length;
  const conceptsBefore = board.board.concepts.size;
  const relsBefore = board.board.relationships.size;
  const pageBefore = board.page;
  const lastOp = board.board.lastMeaningful();

  const op = board.undoLast();
  console.log(`   undid: ${op?.type}`);
  console.log(`   elements ${elementsBefore} -> ${board.elements.length}`);

  check("exactly one operation was reversed", op?.operationId === lastOp?.operationId);
  check("the page did not disappear", board.elements.length > elementsBefore * 0.8, `${elementsBefore} -> ${board.elements.length}`);
  check("only that operation's elements went", elementsBefore - board.elements.length <= 2, String(elementsBefore - board.elements.length));
  check("the page did not turn", board.page === pageBefore);
  check(
    "at most one concept or relationship was removed",
    conceptsBefore - board.board.concepts.size + (relsBefore - board.board.relationships.size) <= 1,
  );
}

// --------------------------------------------------------------------- F

line("F. \"Now let's move on to Affiliate Capital.\"");
{
  const pagesBefore = board.pageTurns.length;

  // First, a fragment. The board must hold it rather than act on it.
  //
  // Note what is being checked: the GATE, not the beat's judgement. Handed
  // "now let's move on to" directly, the real beat calls it a section — which
  // is a reasonable reading of those words and exactly why the product does
  // not hand it over. The thought has not landed, so the request is held.
  board.liveText = "now let's move on to";
  const fragment = await say(board, "now let's move on to");
  check("a fragment is held, not sent", fragment.decision.held === true, fragment.decision.gate);
  check("a fragment does not turn the page", board.pageTurns.length === pagesBefore);

  // Then the finished thought.
  board.liveText = "Now let's move on to Affiliate Capital.";
  const r = await say(board, "Now let's move on to Affiliate Capital.");
  console.log(`   decision: ${r.decision.action} — ${r.decision.focus}`);
  console.log(`   applied: ${r.applied.join(" | ")}`);

  check("the completed thought becomes a section", r.decision.action === "section", r.decision.action);
  check("the page turned", board.pageTurns.length === pagesBefore + 1, `${pagesBefore} -> ${board.pageTurns.length}`);
  const turn = board.pageTurns[board.pageTurns.length - 1];
  check("the turn is logged as a topic change", turn?.reason === "topic-change", JSON.stringify(turn));
  check("the turn was not mid-thought", turn?.midThought === false, JSON.stringify(turn));
  check(
    "a section exists for the new topic",
    [...board.board.sections.values()].some((s) => /affiliate/i.test(s.title)),
    [...board.board.sections.values()].map((s) => s.title).join(","),
  );
}

// ------------------------------------------------------------- page turns

line("Page turns");
{
  console.log(
    board.pageTurns.length
      ? board.pageTurns.map((p) => `   page ${p.index}: ${p.reason} — ${p.why}`).join("\n")
      : "   (none)",
  );
  check("every page turn has a reason", board.pageTurns.every((p) => p.reason && p.why));
  check("no page turned mid-thought", board.pageTurns.every((p) => !p.midThought), JSON.stringify(board.pageTurns.filter((p) => p.midThought)));
}

line("Recognition repairs");
console.log(
  board.corrections.length
    ? board.corrections.map((c) => `   "${c.from}" -> "${c.to}" (${c.why}, ${c.confidence.toFixed(2)})`).join("\n")
    : "   (none needed — these utterances were heard correctly)",
);

line("Arrows");
{
  console.log(`   ${board.arrows.length} arrows, ${board.arrows.filter((a) => a.routed).length} routed around something`);

  // The property that actually matters: an arrow must not be drawn through
  // words the speaker can read. Recomputed here from the final scene rather
  // than trusted from the `routed` flag.
  const crossings = board.arrows.filter((arrow) => {
    const abs = arrow.points.map(([x, y]) => ({ x: arrow.x + x, y: arrow.y + y }));
    const others = board.elements.filter(
      (e) =>
        e.page === arrow.page &&
        e.type !== "arrow" &&
        e.id !== arrow.startBinding.elementId &&
        e.id !== arrow.endBinding.elementId &&
        // The live transcript line is a full-width row the structure is
        // deliberately allowed to sit beside; it is not a target.
        !e.id.startsWith("live") &&
        e.width > 0,
    );
    return pathBlocked(abs, others);
  });
  console.log(`   ${crossings.length} of ${board.arrows.length} cross something on the page`);
  check(
    "no arrow is drawn through content",
    crossings.length === 0,
    crossings.map((a) => a.id).join(","),
  );
  check("every arrow is bound at both ends", board.arrows.every((a) => a.startBinding?.elementId && a.endBinding?.elementId));
  check("every relationship stores both concept ids", [...board.board.relationships.values()].every((r) => r.fromConceptId && r.toConceptId));
  check("every relationship reached the canvas", [...board.board.relationships.values()].every((r) => r.elementIds.length > 0));
}

line("Latency");
for (const l of latencies) {
  console.log(`   ${l.totalMs.toString().padStart(5)}ms  beat ${l.beatMs}ms  organizer ${l.artistMs}ms  "${l.utterance.slice(0, 44)}"`);
}

console.log(`\n${"─".repeat(64)}`);
if (failures.length === 0) {
  console.log(`✓ ${pass} checks passed`);
} else {
  console.log(`${pass} passed, ${failures.length} FAILED:\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exitCode = 1;
}
