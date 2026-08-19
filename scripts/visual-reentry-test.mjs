/**
 * Visual Re-entry's deterministic path tested directly.
 *
 *   node --import ./scripts/ts-register.mjs scripts/visual-reentry-test.mjs
 *
 * Only one visual family survives Visual Re-entry: cause_effect
 * (box-and-arrow). There is no model call anywhere in this pipeline anymore
 * — cause.ts's deterministic parse is the whole decision process, so every
 * test here exercises real parse/ground/compress/render code, no fixtures
 * standing in for a network call.
 */

import { compressLabel, compressSpec } from "../lib/visualReentry/compress.ts";
import { groundDecision } from "../lib/visualReentry/ground.ts";
import { causeEffectSkeleton, measureVisual } from "../lib/visualReentry/render.ts";
import {
  CauseEffectIntentSchema,
  NoneIntentSchema,
  VisualReentryIntentSchema,
} from "../lib/visualReentry/types.ts";
import { claimThought } from "../lib/visualReentry/ownership.ts";
import { VisualReentryCandidateQueue } from "../lib/visualReentry/decisionQueue.ts";
import { evaluateVisualCandidate } from "../lib/visualReentry/candidate.ts";
import { advanceVisualEvidence, completePendingCauseEvidence, CAUSE_EVIDENCE_MAX_AGE_MS } from "../lib/visualReentry/evidence.ts";
import { tryDeterministicVisualIntent } from "../lib/visualReentry/fastPath.ts";
import { commitPreparedVisualReentry } from "../lib/visualReentry/orchestrate.ts";
import { newPagePen, place, willOverflow } from "../lib/ops.ts";

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

const thought = (text, sourceSegments = [text]) => ({
  id: "t1",
  text,
  sourceSegments,
  page: 0,
  settledAt: 0,
});

const candidateJob = (id, overrides = {}) => ({
  thought: { ...thought(`candidate ${id}`), id, page: overrides.page ?? 0 },
  experimentMode: "vr_full",
  generation: overrides.generation ?? 1,
  page: overrides.page ?? 0,
  launchLiveSeq: 1,
  candidateCompletedAt: overrides.candidateCompletedAt ?? 1_000,
  expiresAt: overrides.expiresAt ?? 31_000,
});

// --------------------------------------------------------------- candidate gate

section("local candidate gate — cause_effect is the only supported family");

check("rejects an ordinary reflective thought", !evaluateVisualCandidate("I'm still figuring out exactly how I feel about this.").candidate);
check("rejects a casual noun sequence", !evaluateVisualCandidate("I've been thinking about users, pricing and the website all day.").candidate);
check("accepts an explicit causal relationship", evaluateVisualCandidate("Marketing brings traffic and traffic creates signups.").family === "cause_effect");
check("rejects a likely hierarchy", !evaluateVisualCandidate("Our company has engineering, marketing and sales.").candidate);
check("does not promote ordinary chronological narrative", !evaluateVisualCandidate("I woke up, went outside and talked to my friend.").candidate);
check("marketing brings traffic stays causal", evaluateVisualCandidate("Marketing brings traffic and traffic creates signups.").family === "cause_effect");
check("rejects an explicit flat list — enumeration is no longer supported", !evaluateVisualCandidate("There are three things we need to improve: speed, accuracy and presentation.").candidate);
check("rejects an explicit ordered process — sequence is no longer supported", !evaluateVisualCandidate("First we collect the data, then we clean it, then we train the model.").candidate);
check("rejects a grounded from/to change — quantitative_change is no longer supported", !evaluateVisualCandidate("Revenue went from ten to forty this quarter.").candidate);
check("rejects an explicit two-sided contrast — comparison is no longer supported", !evaluateVisualCandidate("Option A is cheaper, while Option B is easier to use.").candidate);

section("Cause/Effect conservative candidate and direction matrix");

for (const [spoken, expectedSource, expectedTarget] of [
  ["Lower prices caused more people to sign up.", "Lower prices", "More people to sign up"],
  ["More people signed up because prices were lower.", "Prices were lower", "More people signed up"],
  ["Because the server was overloaded, the request failed.", "The server was overloaded", "The request failed"],
]) {
  const result = tryDeterministicVisualIntent(thought(spoken));
  const intent = result.intent?.type === "cause_effect" ? result.intent : null;
  check(`extracts directed cause/effect: ${spoken}`, intent?.nodes[intent.edges[0].from] === expectedSource && intent?.nodes[intent.edges[0].to] === expectedTarget);
  check(`grounds directed cause/effect: ${spoken}`, Boolean(intent && groundDecision(intent, thought(spoken)).result.grounded));
}

{
  const chain = thought("Marketing creates traffic, and traffic creates signups.");
  const result = tryDeterministicVisualIntent(chain);
  check("extracts a two-edge causal chain deterministically", result.intent?.type === "cause_effect" && result.intent.edges.length === 2 && result.intent.nodes.length === 3);
  check("grounds every edge of the direct causal chain", Boolean(result.intent && groundDecision(result.intent, chain).result.grounded));
}

for (const spoken of [
  "Revenue increased after we launched the campaign.",
  "Users who use feature X retain better.",
  "Pricing and conversion are connected.",
  "Traffic increased and signups increased.",
  "We changed pricing, then signups improved.",
  "In my head I was embarrassed. Like, he was so weak.",
  "Pricing might be causing churn.",
  "Maybe marketing is causing signups.",
  "This could lead to churn.",
  "Marketing did not cause the increase.",
  "Pricing isn't what caused churn.",
  "I thought pricing caused churn, but actually onboarding was the problem.",
  "The API depends on the database.",
  "The API requires the database.",
  "Plan pricing is constrained by cost and included minutes.",
  "So it's, like, for the affiliate aspect.",
  "The server was down, so the request failed.",
  "Create content.",
]) check(`fails closed: ${spoken}`, evaluateVisualCandidate(spoken).family !== "cause_effect");

section("Cause/Effect exact natural-corpus false-positive regression");

const exactNaturalCauseFalsePositives = [
  "post, create content, create content that really showcase it, but really, like, really capitalize on the visual aspect",
  "post, create content, create content that really showcase it, but really, like, really capitalize on the visual aspect because InPublic is our visual tool, our visual expressive tool.",
  "because InPublic is our visual tool, our visual expressive tool.",
  "One thing I noticed is that the camera needs to put because I I the camera is getting stuck.",
  "how far is pricing is pricing what type of pricing would be do? Because it's it is ten minutes, and what exactly how exactly are we gonna really",
  "go into pricing? Because it's minutes, and I'm considering",
  "Like, how much like, really going into that? Like, how much minutes we're gonna have working on that because minutes considering pricing is something that's really important.",
  "Because the moment we got pricing down, it's it's gonna make way so much more",
  "like, are we gonna for the affiliate aspect, are we gonna, like, implement Affiliate Capital, which is, like, another SaaS I'm working on. So it's, like, so it's, like, for the affiliate aspect.",
];

for (const spoken of exactNaturalCauseFalsePositives) {
  check(`natural corpus rejects cause/effect: ${spoken}`, evaluateVisualCandidate(spoken).family !== "cause_effect");
  check(`natural corpus deterministic path returns none: ${spoken}`, tryDeterministicVisualIntent(thought(spoken)).intent === null);
  const unsafeIntent = {
    type: "cause_effect",
    nodes: ["Source", "Target"],
    edges: [{ from: 0, to: 1, evidence: spoken }],
    evidence: [spoken],
  };
  check(`natural corpus grounding rejects an unsafe causal edge: ${spoken}`, groundDecision(unsafeIntent, thought(spoken)).decision.type === "none");
}

for (const spoken of [
  "what exactly how exactly are we gonna really",
  "so it's, like",
  "and I'm considering",
  "the idea is just",
  "I'm also thinking",
  "interestingly, I was like, let me just",
]) {
  const wrapped = `Marketing creates ${spoken}.`;
  check(`incomplete endpoint fails closed: ${spoken}`, evaluateVisualCandidate(wrapped).family !== "cause_effect");
}

{
  const first = { ...thought("Marketing creates traffic."), id: "cause-a", settledAt: 1_000 };
  const opened = advanceVisualEvidence([], first);
  check("opens bounded causal evidence for a one-edge assertion", opened.status === "pending" && opened.causeEvidence === "opened");
  const standalone = completePendingCauseEvidence(opened.next);
  check("bounded delay flushes a standalone causal assertion", standalone?.status === "candidate" && standalone.candidate?.id === "cause-a");
  const second = { ...thought("And that traffic creates more signups."), id: "cause-b", settledAt: 2_000 };
  const completed = advanceVisualEvidence(opened.next, second);
  check("combines two V2 thoughts into one causal chain", completed.status === "candidate" && completed.causeEvidence === "completed" && completed.candidate?.id === "evidence:cause-a+cause-b");
  const fast = completed.candidate ? tryDeterministicVisualIntent(completed.candidate) : { intent: null };
  check("multi-thought causal chain has exactly marketing -> traffic -> signups", fast.intent?.type === "cause_effect" && fast.intent.edges.length === 2 && fast.intent.nodes.length === 3);
  check("multi-thought causal chain grounds as a whole", Boolean(completed.candidate && fast.intent && groundDecision(fast.intent, completed.candidate).result.grounded));
}

{
  const hard = thought("The reason people kept leaving was that the app took too long to respond.");
  check("clearly causal hard syntax passes the narrow gate", evaluateVisualCandidate(hard.text).family === "cause_effect");
  check("hard syntax stays deterministic-none rather than forcing an unsafe parse", tryDeterministicVisualIntent(hard).intent === null);
}

// --------------------------------------------------------------- bounded multi-thought evidence window

section("bounded multi-thought causal evidence window");

{
  const first = { ...thought("Marketing creates traffic."), id: "cause-old", settledAt: 1_000 };
  const opened = advanceVisualEvidence([], first);
  const late = { ...thought("The team discussed the onboarding experience."), id: "cause-late", settledAt: 1_000 + CAUSE_EVIDENCE_MAX_AGE_MS + 1 };
  check("causal evidence expires at its bounded family TTL", advanceVisualEvidence(opened.next, late).status === "rejected");
  const otherPage = { ...late, id: "cause-page", page: 1, settledAt: 2_000 };
  check("causal evidence never crosses pages", advanceVisualEvidence(opened.next, otherPage).status === "rejected");
}

{
  const opener = { ...thought("Marketing creates traffic."), id: "replace-a", settledAt: 1_000 };
  const held = advanceVisualEvidence([], opener);
  const prose = { ...thought("The team discussed the onboarding experience."), id: "prose", settledAt: 2_000 };
  const rejected = advanceVisualEvidence(held.next, prose);
  check("unrelated prose clears rather than growing the evidence window", rejected.status === "rejected" && rejected.next.length === 0);
}

// --------------------------------------------------------------- schema

section("schema validation (strict — unknown types/malformed/missing data all -> parse failure)");

check(
  "accepts a none intent with a reason",
  VisualReentryIntentSchema.safeParse({ type: "none", reason: "just a plain sentence" }).success,
);
check(
  "rejects a none intent missing its required reason",
  !VisualReentryIntentSchema.safeParse({ type: "none" }).success,
);
check("accepts a strict two-node causal intent", CauseEffectIntentSchema.safeParse({ type: "cause_effect", nodes: ["Prices fell", "Signups rose"], edges: [{ from: 0, to: 1, evidence: "Prices fell caused signups to rise" }], evidence: ["Prices fell caused signups to rise"] }).success);
check("rejects a causal self-edge", !CauseEffectIntentSchema.safeParse({ type: "cause_effect", nodes: ["A", "B"], edges: [{ from: 0, to: 0, evidence: "A causes A" }], evidence: ["A causes A"] }).success);
check("rejects a cyclic causal graph", !CauseEffectIntentSchema.safeParse({ type: "cause_effect", nodes: ["A", "B"], edges: [{ from: 0, to: 1, evidence: "A causes B" }, { from: 1, to: 0, evidence: "B causes A" }], evidence: ["A causes B", "B causes A"] }).success);
check("rejects more than four causal nodes", !CauseEffectIntentSchema.safeParse({ type: "cause_effect", nodes: ["A", "B", "C", "D", "E"], edges: [{ from: 0, to: 1, evidence: "A causes B" }], evidence: ["A causes B"] }).success);
check("rejects model-owned causal geometry", !CauseEffectIntentSchema.safeParse({ type: "cause_effect", nodes: ["A", "B"], edges: [{ from: 0, to: 1, evidence: "A causes B" }], evidence: ["A causes B"], x: 10 }).success);
check(
  "rejects an unknown type outright",
  !VisualReentryIntentSchema.safeParse({ type: "bar_chart" }).success,
);
check(
  "rejects garbage input",
  !VisualReentryIntentSchema.safeParse("not even an object").success,
);
check(
  "strict parsing rejects a cause_effect carrying an unexpected field — no hybrid intent can ever parse (Part 9: 0 or 1 visual)",
  !VisualReentryIntentSchema.safeParse({
    type: "cause_effect",
    nodes: ["A", "B"],
    edges: [{ from: 0, to: 1, evidence: "A causes B" }],
    evidence: ["A causes B"],
    items: ["A", "B"],
  }).success,
);

{
  // Part 15: "No model coordinate fields exist in the accepted intent
  // schema" — introspect the schema shapes directly rather than only
  // probing individual reject cases, so this fails loudly if a future edit
  // ever adds one.
  const COORD_FIELDS = ["x", "y", "width", "height", "top", "left", "position", "coordinates", "size"];
  const shapes = {
    none: Object.keys(NoneIntentSchema.shape),
    cause_effect: Object.keys(CauseEffectIntentSchema.innerType().shape),
  };
  for (const [name, keys] of Object.entries(shapes)) {
    check(
      `${name} branch's schema declares no coordinate/geometry field`,
      !keys.some((k) => COORD_FIELDS.includes(k)),
      keys.join(", "),
    );
  }
}

{
  const t = thought("Marketing causes signups.");
  const invented = { type: "cause_effect", nodes: ["Marketing", "Traffic", "Signups"], edges: [{ from: 0, to: 1, evidence: "Marketing causes signups" }, { from: 1, to: 2, evidence: "Marketing causes signups" }], evidence: ["Marketing causes signups"] };
  check("rejects an invented intermediate causal node", groundDecision(invented, t).decision.type === "none");
  const reversed = { type: "cause_effect", nodes: ["Marketing", "Signups"], edges: [{ from: 1, to: 0, evidence: "Marketing causes signups" }], evidence: ["Marketing causes signups"] };
  check("rejects a causal edge whose claimed direction reverses its evidence", groundDecision(reversed, t).decision.type === "none");
}

// --------------------------------------------------------------- grounding

section("grounding");

{
  const t = thought("Just a plain settled thought with no structure.");
  const { decision: out } = groundDecision({ type: "none", reason: "no causal structure present" }, t);
  check("a none intent always grounds", out.type === "none");
}

{
  const t = thought("Lower prices caused more people to sign up.");
  const intent = { type: "cause_effect", nodes: ["Lower prices", "More people to sign up"], edges: [{ from: 0, to: 1, evidence: "Lower prices caused more people to sign up" }], evidence: ["Lower prices caused more people to sign up"] };
  const { decision: out, result } = groundDecision(intent, t);
  check("grounds a cause_effect whose evidence is present in the source", out.type === "cause_effect", result.reason);
}

{
  const t = thought("Lower prices caused more people to sign up.");
  const intent = { type: "cause_effect", nodes: ["Lower prices", "More people to sign up"], edges: [{ from: 0, to: 1, evidence: "profits soared to the moon" }], evidence: ["profits soared to the moon"] };
  const { decision: out } = groundDecision(intent, t);
  check("downgrades cause_effect whose evidence wasn't actually said, even if the nodes match", out.type === "none");
}

// --------------------------------------------------------------- label compression

section("label compression");

check("drops a relative clause to five content words", compressLabel("new customers who cancelled after their first month") === "New customers cancelled first month");
check("strips articles from an already-short label", compressLabel("Collect the data") === "Collect data");
check("keeps a short infinitive phrase intact", compressLabel("Easier to use") === "Easier to use");
check("fails closed when a label cannot be said in five content words", compressLabel("the complete architectural migration of the entire billing subsystem toward usage based pricing") === null);
{
  const result = compressSpec({
    type: "cause_effect",
    nodes: ["new customers who cancelled after their first month and also requested a refund on the invoice", "churn"],
    edges: [{ from: 0, to: 1, evidence: "x" }],
    evidence: ["x"],
  });
  check("rejects an uncompressible cause node", !result.ok);
}
{
  const result = compressSpec({
    type: "cause_effect",
    nodes: ["Lower prices", "More signups"],
    edges: [{ from: 0, to: 1, evidence: "Lower prices caused more signups" }],
    evidence: ["Lower prices caused more signups"],
  });
  check("compresses cause_effect nodes and keeps the spec", result.ok && JSON.stringify(result.spec.nodes) === JSON.stringify(["Lower prices", "More signups"]));
}

// Part 15: "geometry is deterministic". buildVisual() itself needs a
// browser env (see below), but the skeleton builders it calls — the actual
// geometry logic — are pure functions of (spec, x, y, w, h) and can be
// called directly: same input twice must produce byte-identical output.
section("renderer determinism (same spec + placement -> byte-identical geometry, every time)");

{
  const size = measureVisual({ type: "cause_effect", nodes: ["Lower prices", "More signups"], edges: [{ from: 0, to: 1, evidence: "Lower prices caused more signups" }], evidence: ["Lower prices caused more signups"] });
  check("cause_effect measures a compact positive footprint", size.w > 0 && size.h > 0 && size.h < 300);
}

{
  const spec = { type: "cause_effect", nodes: ["Marketing", "Traffic", "Signups"], edges: [{ from: 0, to: 1, evidence: "Marketing creates traffic" }, { from: 1, to: 2, evidence: "Traffic creates signups" }], evidence: ["x"] };
  const a = JSON.stringify(causeEffectSkeleton(spec, 10, 20, 420, 250));
  const b = JSON.stringify(causeEffectSkeleton(spec, 10, 20, 420, 250));
  check("causeEffectSkeleton is deterministic for identical inputs", a === b);
  const skeleton = causeEffectSkeleton(spec, 10, 20, 420, 250);
  check("cause renderer draws noun boxes without a CAUSE stamp", skeleton.filter((element) => element.type === "rectangle").length === 3 && !skeleton.some((element) => element.text === "CAUSE"));
  check("cause renderer does not force ALL CAPS", skeleton.some((element) => element.text === "Marketing") && !skeleton.some((element) => element.text === "MARKETING"));
}

{
  // Different placement (x/y) must move the geometry — proving the renderer,
  // not the decision, owns position (invariant #16/#17).
  const spec = { type: "cause_effect", nodes: ["A", "B"], edges: [{ from: 0, to: 1, evidence: "A causes B" }], evidence: ["x"] };
  const here = causeEffectSkeleton(spec, 10, 20, 420, 100);
  const there = causeEffectSkeleton(spec, 500, 900, 420, 100);
  check("moving the placement (x/y) moves the rendered geometry accordingly", JSON.stringify(here) !== JSON.stringify(there));
}

// --------------------------------------------------------------- ownership

section("ownership — a thought id cannot be claimed (processed) twice (Part 12/15)");

{
  const processed = new Set();
  check("first claim of an id succeeds", claimThought(processed, "thought-1") === true);
  check("a second claim of the SAME id is refused", claimThought(processed, "thought-1") === false);
  check("a different id can still be claimed", claimThought(processed, "thought-2") === true);
  check("the refused duplicate did not get re-recorded oddly", processed.size === 2);
}

// --------------------------------------------------------------- candidate decision queue

section("candidate decision queue — serialized bounded FIFO before ownership claim");

{
  const queue = new VisualReentryCandidateQueue();
  const processed = new Set();
  queue.enqueue(candidateJob("delayed-a"));
  const active = queue.dequeue({ generation: 1, page: 0, now: 1_000 }).job;
  check("the first candidate becomes the one delayed active decision", active?.thought.id === "delayed-a");
  if (active) claimThought(processed, active.thought.id);

  check("a second candidate queues while the delayed decision is active", queue.enqueue(candidateJob("delayed-b")) === "queued");
  check("a queued candidate is not claimed before the worker takes it", !processed.has("delayed-b"));
  const next = queue.dequeue({ generation: 1, page: 0, now: 1_100 }).job;
  check("the second candidate survives until the decision worker is free", next?.thought.id === "delayed-b");
  if (next) claimThought(processed, next.thought.id);
  check("the second candidate is claimed only after dequeue", processed.has("delayed-b"));
}

{
  const queue = new VisualReentryCandidateQueue();
  for (const id of ["fifo-a", "fifo-b", "fifo-c"]) queue.enqueue(candidateJob(id));
  const order = [0, 1, 2].map(() => queue.dequeue({ generation: 1, page: 0, now: 1_000 }).job?.thought.id);
  check("candidate decisions drain in FIFO order", JSON.stringify(order) === JSON.stringify(["fifo-a", "fifo-b", "fifo-c"]));
}

{
  const queue = new VisualReentryCandidateQueue();
  queue.enqueue(candidateJob("active-request"));
  const active = queue.dequeue({ generation: 1, page: 0, now: 1_000 }).job;
  check("the simulated decision owns the active slot", active?.thought.id === "active-request");
  check("a timer-completed candidate queues behind an active request", queue.enqueue(candidateJob("timer-completed")) === "queued");
  check("the timer-completed candidate is retained until the active request ends", queue.dequeue({ generation: 1, page: 0, now: 6_000 }).job?.thought.id === "timer-completed");
}

{
  const queue = new VisualReentryCandidateQueue();
  queue.enqueue(candidateJob("reset-a"));
  queue.enqueue(candidateJob("reset-b"));
  const removed = queue.clear();
  check("reset returns every queued candidate for candidate-expired telemetry", JSON.stringify(removed.map((job) => job.thought.id)) === JSON.stringify(["reset-a", "reset-b"]));
  check("reset leaves the candidate queue empty", queue.size === 0 && queue.dequeue({ generation: 2, page: 0, now: 1_000 }).job === null);
  check("IDs removed by reset may be queued in the next generation", queue.enqueue(candidateJob("reset-a", { generation: 2 })) === "queued");
}

{
  const queue = new VisualReentryCandidateQueue();
  queue.enqueue(candidateJob("old-page", { page: 0 }));
  const result = queue.dequeue({ generation: 1, page: 1, now: 1_000 });
  check("a page change expires a waiting candidate before decision", result.job === null && result.expired[0]?.reason === "page");
}

{
  const queue = new VisualReentryCandidateQueue();
  queue.enqueue(candidateJob("old-generation", { generation: 1 }));
  const generation = queue.dequeue({ generation: 2, page: 0, now: 1_000 });
  check("a session-generation change expires a waiting candidate before decision", generation.job === null && generation.expired[0]?.reason === "generation");

  queue.enqueue(candidateJob("old-ttl", { generation: 2, expiresAt: 1_500 }));
  const ttl = queue.dequeue({ generation: 2, page: 0, now: 1_501 });
  check("candidate TTL is rechecked when the worker dequeues it", ttl.job === null && ttl.expired[0]?.reason === "ttl");
}

{
  const queue = new VisualReentryCandidateQueue();
  check("the candidate queue capacity is exactly three", ["cap-a", "cap-b", "cap-c"].every((id) => queue.enqueue(candidateJob(id)) === "queued"));
  check("a fourth candidate receives an explicit queue-full result", queue.enqueue(candidateJob("cap-d")) === "full");
  check("duplicate queued IDs are refused without consuming capacity", queue.enqueue(candidateJob("cap-c")) === "duplicate" && queue.size === 3);
}

{
  const accepted = new Set(["terminal-decision", "terminal-page", "terminal-ttl", "terminal-reset", "terminal-full"]);
  const terminalCounts = new Map([...accepted].map((id) => [id, 0]));
  const terminal = (id) => terminalCounts.set(id, (terminalCounts.get(id) ?? 0) + 1);

  const activeQueue = new VisualReentryCandidateQueue();
  activeQueue.enqueue(candidateJob("terminal-decision"));
  const decided = activeQueue.dequeue({ generation: 1, page: 0, now: 1_000 }).job;
  if (decided) terminal(decided.thought.id); // decision-none/grounding/durable-ready

  const staleQueue = new VisualReentryCandidateQueue();
  staleQueue.enqueue(candidateJob("terminal-page", { page: 0 }));
  staleQueue.enqueue(candidateJob("terminal-ttl", { expiresAt: 1_500 }));
  for (const entry of staleQueue.dequeue({ generation: 1, page: 1, now: 2_000 }).expired) terminal(entry.job.thought.id);

  const resetQueue = new VisualReentryCandidateQueue();
  resetQueue.enqueue(candidateJob("terminal-reset"));
  for (const job of resetQueue.clear()) terminal(job.thought.id);

  const fullQueue = new VisualReentryCandidateQueue();
  for (const id of ["filler-a", "filler-b", "filler-c"]) fullQueue.enqueue(candidateJob(id));
  if (fullQueue.enqueue(candidateJob("terminal-full")) === "full") terminal("terminal-full");

  check(
    "every accepted candidate in the lifecycle matrix reaches exactly one terminal outcome",
    [...accepted].every((id) => terminalCounts.get(id) === 1),
    JSON.stringify(Object.fromEntries(terminalCounts)),
  );
}

// --------------------------------------------------------------- pen placement

// lib/visualReentry/orchestrate.ts's core discard-safety pattern (Part 8/10):
// build against a CLONE of the live pen, and only apply the identical
// reservation to the real pen once a build has actually been confirmed for
// commit — never as a side effect of a tentative/discarded build. buildVisual
// itself can't run here (needs a browser env), but place() — the exact
// primitive that does the mutating — can, so the pattern is exercised
// directly against it.
section("pen placement discard-safety (a discarded build must never move the live pen)");

{
  const realPen = newPagePen(0);
  const before = { ...realPen };
  const snapshot = { ...realPen };
  place(snapshot, 400, 100, true); // the "tentative build", against the clone only
  check(
    "placing against a cloned pen leaves the real pen completely untouched",
    realPen.x === before.x && realPen.y === before.y && realPen.lineH === before.lineH,
  );
  check(
    "the clone itself did advance (so the placement geometry is real, just not yet applied)",
    snapshot.x !== before.x || snapshot.y !== before.y || snapshot.lineH !== before.lineH,
  );
}

{
  const realPen = newPagePen(0);
  const snapshot = { ...realPen };
  place(snapshot, 400, 100, true);
  Object.assign(realPen, snapshot); // the "commit" step, only once confirmed fresh
  check(
    "committing applies the exact same reservation to the real pen",
    realPen.x === snapshot.x && realPen.y === snapshot.y && realPen.lineH === snapshot.lineH,
  );
}

// --------------------------------------------------------------- overflow-aware atomic commit

section("overflow-aware atomic commit");

const compactCauseSpec = {
  type: "cause_effect",
  nodes: ["Lower prices", "More signups"],
  edges: [{ from: 0, to: 1, evidence: "Lower prices caused more signups" }],
  evidence: ["Lower prices caused more signups"],
};

const preparedVisual = (spec, page = 0) => ({
  thought: { ...thought("Lower prices caused more signups"), page },
  spec,
  decidedAt: 1_000,
  decisionLatencyMs: 1,
  decisionSource: "deterministic_fast_path",
  candidateCompletedAt: 900,
});

const fakeVisualBuild = async (spec, pen) => {
  const size = measureVisual(spec);
  const spot = place(pen, size.w, size.h, true);
  return {
    elements: [
      { id: `visual-a-${spot.x}-${spot.y}` },
      { id: `visual-b-${spot.x}-${spot.y}` },
    ],
    ...size,
    x: spot.x,
    y: spot.y,
  };
};

function visualCommitHarness(startY, spec = compactCauseSpec) {
  let currentPage = 0;
  let allowedPage = 0;
  let currentPen = newPagePen(0);
  currentPen.y = startY;
  let turns = 0;
  let buildCalls = 0;
  let revealCalls = 0;
  const commitCalls = [];
  const events = [];
  const order = [];
  const context = {
    pen: currentPen,
    pageIndex: currentPage,
    isSafe: () => true,
    isRelevant: (targetPage = allowedPage) => targetPage === allowedPage && currentPage === allowedPage,
    isPlacementCurrent: (target) => target.pageIndex === currentPage && target.pen === currentPen,
    turnPageForOverflow: (target) => {
      if (target.pageIndex !== currentPage || target.pen !== currentPen) return null;
      turns += 1;
      order.push("turn");
      currentPage += 1;
      allowedPage = currentPage;
      currentPen = newPagePen(currentPage);
      return { pageIndex: currentPage, pen: currentPen };
    },
    build: async (visualSpec, pen) => {
      buildCalls += 1;
      order.push(`build:${currentPage}`);
      return fakeVisualBuild(visualSpec, pen);
    },
    commitVisual: (elements) => {
      order.push(`commit:${currentPage}`);
      commitCalls.push(elements);
    },
    revealIfNeeded: () => {
      order.push(`reveal:${currentPage}`);
      revealCalls += 1;
    },
    log: (event) => events.push(event),
    now: () => 2_000,
  };
  return {
    prepared: preparedVisual(spec),
    context,
    state: () => ({ currentPage, currentPen, turns, buildCalls, revealCalls, commitCalls, events, order }),
    unrelatedTurn: () => {
      currentPage += 1;
      currentPen = newPagePen(currentPage);
    },
  };
}

{
  const harness = visualCommitHarness(606); // 606 + 130px = writable bottom 736 exactly.
  const result = await commitPreparedVisualReentry(harness.prepared, harness.context);
  const state = harness.state();
  check("a Visual Re-entry visual that exactly fits near the writable bottom does not turn the page", result === "committed" && state.turns === 0);
  check("the near-bottom fit remains inside the writable page area", !willOverflow({ ...newPagePen(0), y: 606 }, 420, 130));
}

{
  const harness = visualCommitHarness(607);
  const result = await commitPreparedVisualReentry(harness.prepared, harness.context);
  const state = harness.state();
  check("a visual that would cross the writable bottom hard-turns before build", result === "committed" && state.turns === 1 && state.order[0] === "turn" && state.order[1] === "build:1", JSON.stringify(state.order));
  check("the complete multi-element visual is appended once and atomically on the new page", state.commitCalls.length === 1 && state.commitCalls[0].length === 2 && state.order.includes("commit:1"));
  check("the intentional overflow turn rebinds relevance instead of expiring the result", !state.events.some((event) => event.event === "durable-result-expired"));
  check("camera reveal happens only after page containment, never instead of it", state.revealCalls === 1 && state.order.indexOf("turn") < state.order.indexOf("reveal:1"));
}

{
  const harness = visualCommitHarness(100);
  harness.context.build = async (spec, pen) => {
    const built = await fakeVisualBuild(spec, pen);
    harness.unrelatedTurn();
    return built;
  };
  const result = await commitPreparedVisualReentry(harness.prepared, harness.context);
  const state = harness.state();
  check("an unrelated page turn during rendering still invalidates stale Visual Re-entry work", result === "dropped" && state.commitCalls.length === 0 && state.events.some((event) => event.event === "durable-result-expired"));
}

{
  const oversized = {
    type: "cause_effect",
    nodes: Array.from({ length: 4 }, (_, index) => `Node ${index} ${Array.from({ length: 40 }, () => "oversized line").join("\n")}`),
    edges: [{ from: 0, to: 1, evidence: "x" }, { from: 1, to: 2, evidence: "x" }, { from: 2, to: 3, evidence: "x" }],
    evidence: ["oversized line"],
  };
  const harness = visualCommitHarness(700, oversized);
  const result = await commitPreparedVisualReentry(harness.prepared, harness.context);
  const state = harness.state();
  const telemetry = state.events.find((event) => event.event === "visual-oversized");
  check("a visual oversized even on a fresh page turns only once and drops before rendering", result === "dropped" && state.turns === 1 && state.buildCalls === 0 && state.commitCalls.length === 0);
  check("oversized telemetry includes measured dimensions and the fresh page index", telemetry?.measuredWidth === 420 && telemetry?.measuredHeight > 692 && telemetry?.pageIndex === 1, JSON.stringify(telemetry));
  check("camera framing is never invoked for an oversized off-page visual", state.revealCalls === 0);
}

{
  const harness = visualCommitHarness(100);
  const hidden = [];
  const inner = harness.context.commitVisual;
  harness.context.choosePromoteTarget = () => ({
    pen: harness.context.pen,
    pageIndex: 0,
    hideIds: ["live-1"],
    mode: "replace",
  });
  harness.context.commitVisual = (elements, promote) => {
    hidden.push(...(promote?.hideIds ?? []));
    inner(elements, promote);
  };
  const result = await commitPreparedVisualReentry(harness.prepared, harness.context);
  const state = harness.state();
  check("promote commit folds the source line ids", result === "committed" && hidden.join() === "live-1");
  check("promote commit logs source-promoted", state.events.some((event) => event.event === "source-promoted"));
}

// --------------------------------------------------------------- summary

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
