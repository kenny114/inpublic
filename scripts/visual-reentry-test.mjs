/**
 * Visual Re-entry's deterministic path, including Sequence V2, tested directly.
 *
 *   node --import ./scripts/ts-register.mjs scripts/visual-reentry-test.mjs
 *
 * decideVisual() (the one LLM call) is exercised via fixed fixture inputs
 * against groundDecision/buildVisual only — no network, no canvas, no API
 * keys for the parts of the pipeline that must be deterministic.
 */

import { groundDecision } from "../lib/visualReentry/ground.ts";
import { causeEffectSkeleton, comparisonSkeleton, enumerationSkeleton, measureVisual, quantitativeChangeSkeleton, sequenceSkeleton } from "../lib/visualReentry/render.ts";
import {
  CauseEffectIntentSchema,
  ComparisonIntentSchema,
  EnumerationIntentSchema,
  NoneIntentSchema,
  QuantitativeChangeIntentSchema,
  SequenceIntentSchema,
  VisualReentryIntentSchema,
} from "../lib/visualReentry/types.ts";
import { claimThought } from "../lib/visualReentry/ownership.ts";
import { VisualReentryCandidateQueue } from "../lib/visualReentry/decisionQueue.ts";
import { evaluateVisualCandidate } from "../lib/visualReentry/candidate.ts";
import { advanceVisualEvidence, completePendingCauseEvidence, SEQUENCE_EVIDENCE_MAX_AGE_MS, VISUAL_EVIDENCE_MAX_AGE_MS } from "../lib/visualReentry/evidence.ts";
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

// --------------------------------------------------------------- V1.1 candidate gate

section("V1.1 local candidate gate");

check("rejects an ordinary reflective thought", !evaluateVisualCandidate("I'm still figuring out exactly how I feel about this.").candidate);
check("accepts an explicitly presented list", evaluateVisualCandidate("There are three things we need to improve: speed, accuracy and presentation.").family === "enumeration");
check("rejects a casual noun sequence", !evaluateVisualCandidate("I've been thinking about users, pricing and the website all day.").candidate);
check("accepts a grounded from/to change", evaluateVisualCandidate("Revenue went from ten to forty this quarter.").family === "quantitative_change");
check("rejects an unquantified increase", !evaluateVisualCandidate("Users increased dramatically this week.").candidate);
check("accepts an explicit causal relationship", evaluateVisualCandidate("Marketing brings traffic and traffic creates signups.").family === "cause_effect");
check("rejects a likely hierarchy", !evaluateVisualCandidate("Our company has engineering, marketing and sales.").candidate);
check("accepts an explicit ordered process as sequence", evaluateVisualCandidate("First we collect the data, then we clean it, then we train the model.").family === "sequence");
check("keeps a flat counted list as enumeration", evaluateVisualCandidate("There are three things we need: speed, accuracy and presentation.").family === "enumeration");
check("owns explicit causality as cause_effect, never sequence", evaluateVisualCandidate("Marketing creates traffic, which creates signups.").family === "cause_effect");
check("keeps temporal numeric change quantitative", evaluateVisualCandidate("We had 10 users last week and 20 this week.").family === "quantitative_change");
check("does not promote ordinary chronological narrative", !evaluateVisualCandidate("I woke up, went outside and talked to my friend.").candidate);
check("rejects a declared eight-step process before model fallback", !evaluateVisualCandidate("Here are eight steps for launching the product.").candidate);
check("does not misclassify an incomplete three-step opener as enumeration", evaluateVisualCandidate("There are three steps to the process.").family !== "enumeration");

section("Comparison V1 explicit two-sided contrast matrix");

{
  const t = thought("Option A is cheaper, while Option B is easier to use.");
  const result = tryDeterministicVisualIntent(t);
  check("explicit while contrast is a deterministic comparison", result.intent?.type === "comparison");
  check("extracts exactly two stable comparison subjects", result.intent?.type === "comparison" && result.intent.leftLabel === "Option A" && result.intent.rightLabel === "Option B");
  check("retains only the two spoken claims", result.intent?.type === "comparison" && result.intent.rows[0].left === "Cheaper" && result.intent.rows[0].right === "Easier to use");
  check("explicit comparison grounds", Boolean(result.intent && groundDecision(result.intent, t).result.grounded));
}

{
  const t = thought("Option A is cheaper and faster to set up. Option B costs more, but it gives you more control.");
  const result = tryDeterministicVisualIntent(t);
  check("multi-claim entity contrast produces one comparison", result.intent?.type === "comparison" && result.intent.rows.length === 2);
  const claims = result.intent?.type === "comparison" ? result.intent.rows.flatMap((row) => [row.left, row.right].filter(Boolean)) : [];
  check("multi-claim comparison contains only spoken claims", JSON.stringify(claims) === JSON.stringify(["Cheaper", "Costs more", "Faster to set up", "Gives you more control"]));
  check("multi-claim comparison grounds as a whole", Boolean(result.intent && groundDecision(result.intent, t).result.grounded));
}

{
  const first = { ...thought("Claude is strong at writing."), id: "comparison-a", settledAt: 1_000 };
  const opened = advanceVisualEvidence([], first);
  check("opens comparison-only evidence for a stable subject claim", opened.status === "pending" && opened.comparisonEvidence === "opened");
  const second = { ...thought("Gemini, on the other hand, has a larger context window."), id: "comparison-b", settledAt: 2_000 };
  const completed = advanceVisualEvidence(opened.next, second);
  check("combines two V2 thoughts into one comparison", completed.status === "candidate" && completed.comparisonEvidence === "completed" && completed.candidate?.id === "evidence:comparison-a+comparison-b");
  const result = completed.candidate ? tryDeterministicVisualIntent(completed.candidate) : { intent: null };
  check("multi-thought comparison remains deterministic", result.intent?.type === "comparison");
  check("multi-thought comparison grounds both subjects and claims", Boolean(completed.candidate && result.intent && groundDecision(result.intent, completed.candidate).result.grounded));
}

{
  const t = thought("Plan A costs 10 dollars and Plan B costs 20 dollars.");
  const result = tryDeterministicVisualIntent(t);
  check("numeric entity pair belongs to comparison", evaluateVisualCandidate(t.text).family === "comparison" && result.intent?.type === "comparison");
  check("numeric entity pair retains both literal subject/value associations", result.intent?.type === "comparison" && result.intent.rows[0].left === "Costs 10 dollars" && result.intent.rows[0].right === "Costs 20 dollars");
}

check("temporal 10 to 20 remains quantitative_change", evaluateVisualCandidate("Price went from 10 dollars to 20 dollars.").family === "quantitative_change");
check("enumeration does not become comparison", evaluateVisualCandidate("There are three things we care about: price, speed and quality.").family === "enumeration");
check("sequence does not become comparison", evaluateVisualCandidate("First choose a plan, then create an account.").family === "sequence");
check("cause/effect does not become comparison", evaluateVisualCandidate("Lower prices create more signups.").family === "cause_effect");

for (const spoken of [
  "I've been testing Claude and Gemini.",
  "We use Stripe and PayPal.",
  "Speed and accuracy matter.",
  "I think Claude might be faster than Gemini.",
  "Maybe Option B is easier.",
  "Apparently Option A performs better.",
  "Claude isn't cheaper than Gemini.",
  "I thought A was cheaper, but actually B is cheaper.",
]) check(`comparison fails closed: ${spoken}`, evaluateVisualCandidate(spoken).family !== "comparison");

{
  const t = thought("A is faster than B.");
  const result = tryDeterministicVisualIntent(t);
  check("one-sided comparative relation may qualify", result.intent?.type === "comparison" && result.intent.rows[0].left === "Faster than B");
  check("one-sided comparative relation does not invent B = slower", result.intent?.type === "comparison" && result.intent.rows[0].right === undefined && !JSON.stringify(result.intent).toLowerCase().includes("slower"));
}

{
  const hard = thought("They solve the problem differently. Claude tends to give me more polished language. With Gemini I usually have more room to feed it context.");
  check("diffuse explicit contrast passes the narrow comparison gate", evaluateVisualCandidate(hard.text).family === "comparison");
  check("diffuse explicit contrast retains Haiku fallback", tryDeterministicVisualIntent(hard).intent === null);
}

section("Cause/Effect V2 conservative candidate and direction matrix");

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

section("Cause/Effect V2 exact natural-corpus false-positive regression");

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
  const unsafeModelIntent = {
    type: "cause_effect",
    nodes: ["Source", "Target"],
    edges: [{ from: 0, to: 1, evidence: spoken }],
    evidence: [spoken],
  };
  check(`natural corpus grounding rejects a model causal edge: ${spoken}`, groundDecision(unsafeModelIntent, thought(spoken)).decision.type === "none");
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
  check("hard syntax retains Haiku fallback instead of forcing the fast path", tryDeterministicVisualIntent(hard).intent === null);
}

// --------------------------------------------------------------- V1.2 evidence window

section("V1.2 bounded multi-thought evidence window");

{
  const first = { ...thought("There are three things we need to improve."), id: "enum-a", settledAt: 1_000 };
  const held = advanceVisualEvidence([], first);
  check("holds an enumeration opener instead of calling the model prematurely", held.status === "pending" && held.next.length === 1);
  const second = { ...thought("Speed, accuracy, and presentation."), id: "enum-b", settledAt: 2_000 };
  const completed = advanceVisualEvidence(held.next, second);
  check("combines the following item thought into one enumeration candidate", completed.status === "candidate" && completed.candidate?.id === "evidence:enum-a+enum-b");
  check("combined enumeration preserves both source segments", completed.candidate?.sourceSegments.length === 2);
}

{
  const first = { ...thought("First we collect the data."), id: "seq-a", settledAt: 1_000 };
  const opened = advanceVisualEvidence([], first);
  check("opens family-specific sequence evidence", opened.status === "pending" && opened.sequenceEvidence === "opened" && opened.next.length === 1);
  const second = { ...thought("Then we clean the data."), id: "seq-b", settledAt: 2_000 };
  const extended = advanceVisualEvidence(opened.next, second);
  check("extends sequence without emitting an early two-step visual", extended.status === "pending" && extended.sequenceEvidence === "extended" && extended.next.length === 2);
  const third = { ...thought("Finally we train the model."), id: "seq-c", settledAt: 3_000 };
  const completed = advanceVisualEvidence(extended.next, third);
  check("completes one sequence across three settled thoughts", completed.status === "candidate" && completed.sequenceEvidence === "completed" && completed.candidate?.id === "evidence:seq-a+seq-b+seq-c");
  const fast = completed.candidate ? tryDeterministicVisualIntent(completed.candidate) : { intent: null };
  check("multi-thought sequence extracts exactly three deterministic steps", JSON.stringify(fast.intent?.type === "sequence" ? fast.intent.steps : []) === JSON.stringify(["Collect the data", "Clean the data", "Train the model"]));
  check("multi-thought sequence grounds against all source segments", Boolean(completed.candidate && fast.intent && groundDecision(fast.intent, completed.candidate).result.grounded));
}

{
  const opener = { ...thought("There are three steps to the process."), id: "declared-a", settledAt: 1_000 };
  const opened = advanceVisualEvidence([], opener);
  check("holds a declared step count as sequence evidence", opened.status === "pending" && opened.family === "sequence");
}

{
  const first = { ...thought("First we collect the data."), id: "seq-old", settledAt: 1_000 };
  const opened = advanceVisualEvidence([], first);
  const late = { ...thought("Finally we train the model."), id: "seq-late", settledAt: 1_000 + SEQUENCE_EVIDENCE_MAX_AGE_MS + 1 };
  check("sequence evidence expires at its bounded family TTL", advanceVisualEvidence(opened.next, late).status === "rejected");
  const otherPage = { ...late, id: "seq-page", page: 1, settledAt: 2_000 };
  check("sequence evidence never crosses pages", advanceVisualEvidence(opened.next, otherPage).status === "rejected");
}

{
  const first = { ...thought("We had 10 users last week."), id: "quant-a", settledAt: 1_000 };
  const held = advanceVisualEvidence([], first);
  check("holds one-number period evidence locally", held.status === "pending");
  const second = { ...thought("And 20 users this week."), id: "quant-b", settledAt: 2_000 };
  const completed = advanceVisualEvidence(held.next, second);
  check("combines two period thoughts into a quantitative candidate", completed.status === "candidate" && evaluateVisualCandidate(completed.candidate.text).family === "quantitative_change");
}

{
  const opener = { ...thought("There are three things we need to improve."), id: "old", settledAt: 1_000 };
  const held = advanceVisualEvidence([], opener);
  const late = { ...thought("Speed, accuracy, and presentation."), id: "late", settledAt: 1_000 + VISUAL_EVIDENCE_MAX_AGE_MS + 1 };
  check("does not combine evidence after the short TTL", advanceVisualEvidence(held.next, late).status === "rejected");
  const otherPage = { ...late, id: "other-page", page: 1, settledAt: 2_000 };
  check("does not combine evidence across pages", advanceVisualEvidence(held.next, otherPage).status === "rejected");
}

{
  const opener = { ...thought("We had 10 users last week."), id: "replace-a", settledAt: 1_000 };
  const held = advanceVisualEvidence([], opener);
  const prose = { ...thought("The team discussed the onboarding experience."), id: "prose", settledAt: 2_000 };
  const rejected = advanceVisualEvidence(held.next, prose);
  check("unrelated prose clears rather than growing the evidence window", rejected.status === "rejected" && rejected.next.length === 0);
}

// --------------------------------------------------------------- schema

section("V1.3 deterministic high-confidence fast path");

{
  const split = thought(
    "There are three things we need to improve. Speed, accuracy and presentation.",
    ["There are three things we need to improve.", "Speed, accuracy and presentation."],
  );
  const result = tryDeterministicVisualIntent(split);
  check("extracts the demonstrated split enumeration without a model", result.intent?.type === "enumeration");
  check("extracts exactly the three literal enumeration items", JSON.stringify(result.intent?.type === "enumeration" ? result.intent.items : []) === JSON.stringify(["Speed", "accuracy", "presentation"]));
  check("the deterministic split enumeration passes normal grounding", result.intent !== null && groundDecision(result.intent, split).result.grounded);
}

{
  const split = thought(
    "We had 10 users last week. And 20 users this week.",
    ["We had 10 users last week.", "And 20 users this week."],
  );
  const result = tryDeterministicVisualIntent(split);
  check("extracts the demonstrated split quantitative change without a model", result.intent?.type === "quantitative_change" && result.intent.from === 10 && result.intent.to === 20);
  check("the deterministic split quantitative change passes normal grounding", result.intent !== null && groundDecision(result.intent, split).result.grounded);
}

{
  const direct = thought("Revenue went from 10000 dollars to 20000 dollars.");
  const result = tryDeterministicVisualIntent(direct);
  check("extracts a direct literal from/to quantity with compatible units", result.intent?.type === "quantitative_change" && result.intent.unit === "dollars");
}

check("does not combine unrelated employee and cost values", tryDeterministicVisualIntent(thought("We have 10 employees and the plan costs 20 dollars.")).intent === null);
check("does not promote a casual noun list", tryDeterministicVisualIntent(thought("I've been thinking about users, pricing and the website.")).intent === null);
check("does not promote a plausible company hierarchy", tryDeterministicVisualIntent(thought("Our company has engineering, marketing and sales.")).intent === null);
check("does not strengthen uncertain numerical language", tryDeterministicVisualIntent(thought("Maybe we went from around 10 users to something like 20.")).intent === null);
{
  const result = tryDeterministicVisualIntent(thought("We grew from 60 followers to about 400 followers."));
  check("extracts the natural benchmark approximation without a model", result.intent?.type === "quantitative_change");
  check("preserves an exact from anchor", result.intent?.type === "quantitative_change" && result.intent.from === 60 && result.intent.fromQualifier === undefined);
  check("preserves the literal about qualifier on the to anchor", result.intent?.type === "quantitative_change" && result.intent.to === 400 && result.intent.toQualifier === "about");
}

{
  const result = tryDeterministicVisualIntent(thought("It was the first time I really grew from 60 followers to about 400 and something."));
  check("preserves the natural replay's redundant vague suffix as about 400", result.intent?.type === "quantitative_change" && result.intent.toQualifier === "about" && result.intent.unit === "followers");
}

{
  const result = tryDeterministicVisualIntent(thought("We started at roughly 100 users and reached 200."));
  check("extracts an approximate started/reached pair", result.intent?.type === "quantitative_change");
  check("preserves roughly on the from anchor only", result.intent?.type === "quantitative_change" && result.intent.fromQualifier === "roughly" && result.intent.toQualifier === undefined);
}

{
  const result = tryDeterministicVisualIntent(thought("We went from about 100 users to around 200."));
  check("extracts two unambiguously qualified anchors", result.intent?.type === "quantitative_change" && result.intent.fromQualifier === "about" && result.intent.toQualifier === "around");
}

check("does not flatten more-than into approximation", tryDeterministicVisualIntent(thought("We went from 100 followers to more than 400 followers.")).intent === null);
check("does not flatten nearly into approximation", tryDeterministicVisualIntent(thought("We went from 100 followers to nearly 400 followers.")).intent === null);
check("does not combine unrelated approximate employee and cost values", tryDeterministicVisualIntent(thought("We have about 10 employees and the plan costs around 20 dollars.")).intent === null);

{
  const explicit = thought("First we collect the data, then we clean it, then we train the model.");
  const result = tryDeterministicVisualIntent(explicit);
  check("single-thought process takes deterministic sequence fast path", result.intent?.type === "sequence");
  check("single-thought process has three literal grounded steps", JSON.stringify(result.intent?.type === "sequence" ? result.intent.steps : []) === JSON.stringify(["Collect the data", "Clean it", "Train the model"]));
  check("single-thought deterministic sequence grounds", Boolean(result.intent && groundDecision(result.intent, explicit).result.grounded));
}
check("uncertain process cannot be strengthened deterministically", tryDeterministicVisualIntent(thought("Maybe first we change pricing, then maybe we change the site.")).intent === null);

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
check(
  "accepts a valid enumeration with evidence",
  VisualReentryIntentSchema.safeParse({
    type: "enumeration",
    items: ["A", "B", "C"],
    evidence: ["we shipped A, B, and C"],
  }).success,
);
check("accepts a strict two-step sequence", SequenceIntentSchema.safeParse({ type: "sequence", steps: ["Sign up", "Create a project"], evidence: ["first sign up, then create a project"] }).success);
check("rejects a one-step sequence", !SequenceIntentSchema.safeParse({ type: "sequence", steps: ["Sign up"], evidence: ["sign up"] }).success);
check("rejects a six-step sequence rather than truncating", !SequenceIntentSchema.safeParse({ type: "sequence", steps: ["A", "B", "C", "D", "E", "F"], evidence: ["A through F"] }).success);
check("rejects model-owned sequence coordinates", !SequenceIntentSchema.safeParse({ type: "sequence", steps: ["A", "B"], evidence: ["A then B"], x: 10 }).success);
check("accepts a strict two-node causal intent", CauseEffectIntentSchema.safeParse({ type: "cause_effect", nodes: ["Prices fell", "Signups rose"], edges: [{ from: 0, to: 1, evidence: "Prices fell caused signups to rise" }], evidence: ["Prices fell caused signups to rise"] }).success);
check("rejects a causal self-edge", !CauseEffectIntentSchema.safeParse({ type: "cause_effect", nodes: ["A", "B"], edges: [{ from: 0, to: 0, evidence: "A causes A" }], evidence: ["A causes A"] }).success);
check("rejects a cyclic causal graph", !CauseEffectIntentSchema.safeParse({ type: "cause_effect", nodes: ["A", "B"], edges: [{ from: 0, to: 1, evidence: "A causes B" }, { from: 1, to: 0, evidence: "B causes A" }], evidence: ["A causes B", "B causes A"] }).success);
check("rejects more than four causal nodes", !CauseEffectIntentSchema.safeParse({ type: "cause_effect", nodes: ["A", "B", "C", "D", "E"], edges: [{ from: 0, to: 1, evidence: "A causes B" }], evidence: ["A causes B"] }).success);
check("rejects model-owned causal geometry", !CauseEffectIntentSchema.safeParse({ type: "cause_effect", nodes: ["A", "B"], edges: [{ from: 0, to: 1, evidence: "A causes B" }], evidence: ["A causes B"], x: 10 }).success);
check("accepts a strict two-sided comparison", ComparisonIntentSchema.safeParse({ type: "comparison", leftLabel: "A", rightLabel: "B", rows: [{ left: "Faster", right: "Cheaper", evidence: ["A is faster while B is cheaper"] }], evidence: ["A is faster while B is cheaper"] }).success);
check("accepts an intentionally uneven comparison row", ComparisonIntentSchema.safeParse({ type: "comparison", leftLabel: "A", rightLabel: "B", rows: [{ left: "Faster than B", evidence: ["A is faster than B"] }], evidence: ["A is faster than B"] }).success);
check("rejects an empty comparison row", !ComparisonIntentSchema.safeParse({ type: "comparison", leftLabel: "A", rightLabel: "B", rows: [{ evidence: ["A and B"] }], evidence: ["A and B"] }).success);
check("rejects more than four comparison rows", !ComparisonIntentSchema.safeParse({ type: "comparison", leftLabel: "A", rightLabel: "B", rows: Array.from({ length: 5 }, (_, index) => ({ left: `Claim ${index}`, evidence: [`Claim ${index}`] })), evidence: ["claims"] }).success);
check("rejects comparison geometry/ranking fields", !ComparisonIntentSchema.safeParse({ type: "comparison", leftLabel: "A", rightLabel: "B", rows: [{ left: "Faster", evidence: ["A is faster"] }], evidence: ["A is faster"], winner: "A", x: 10 }).success);
check(
  "rejects an enumeration with 1 item (min 2)",
  !VisualReentryIntentSchema.safeParse({ type: "enumeration", items: ["A"], evidence: ["A"] }).success,
);
check(
  "rejects an enumeration missing evidence",
  !VisualReentryIntentSchema.safeParse({ type: "enumeration", items: ["A", "B"] }).success,
);
check(
  "accepts an enumeration at the V1 max of 5 items",
  VisualReentryIntentSchema.safeParse({
    type: "enumeration",
    items: ["A", "B", "C", "D", "E"],
    evidence: ["A, B, C, D, E"],
  }).success,
);
check(
  "rejects an enumeration with 6 items (V1 max is 5, not silently truncated)",
  !VisualReentryIntentSchema.safeParse({
    type: "enumeration",
    items: ["A", "B", "C", "D", "E", "F"],
    evidence: ["A through F"],
  }).success,
);
check(
  "accepts a valid quantitative_change with evidence",
  VisualReentryIntentSchema.safeParse({
    type: "quantitative_change",
    from: 10,
    to: 40,
    evidence: ["revenue went from 10 to 40"],
  }).success,
);
check(
  "accepts optional literal approximation qualifiers",
  QuantitativeChangeIntentSchema.safeParse({
    type: "quantitative_change",
    from: 60,
    to: 400,
    toQualifier: "about",
    unit: "followers",
    evidence: ["from 60 followers to about 400 followers"],
  }).success,
);
check(
  "rejects unsupported quantitative modalities in the approximation fields",
  !QuantitativeChangeIntentSchema.safeParse({
    type: "quantitative_change",
    from: 60,
    to: 400,
    toQualifier: "nearly",
    evidence: ["from 60 to nearly 400"],
  }).success,
);
check(
  "rejects a quantitative_change missing evidence",
  !VisualReentryIntentSchema.safeParse({ type: "quantitative_change", from: 10, to: 40 }).success,
);
check(
  "strict parsing rejects an enumeration carrying a stray x/y field",
  !VisualReentryIntentSchema.safeParse({
    type: "enumeration",
    items: ["A", "B"],
    evidence: ["A and B"],
    x: 100,
    y: 200,
  }).success,
);
check(
  "strict parsing rejects a field from the wrong branch (label on quantitative_change)",
  !VisualReentryIntentSchema.safeParse({
    type: "quantitative_change",
    from: 10,
    to: 40,
    evidence: ["10 to 40"],
    label: "Revenue",
  }).success,
);
check(
  "rejects an unknown type outright",
  !VisualReentryIntentSchema.safeParse({ type: "bar_chart" }).success,
);
check(
  "rejects garbage input",
  !VisualReentryIntentSchema.safeParse("not even an object").success,
);
check(
  "strict parsing rejects an enumeration carrying quantitative_change fields — no hybrid intent can ever parse (Part 9: 0 or 1 visual)",
  !VisualReentryIntentSchema.safeParse({
    type: "enumeration",
    items: ["A", "B"],
    evidence: ["A and B"],
    from: 10,
    to: 20,
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
    enumeration: Object.keys(EnumerationIntentSchema.shape),
    quantitative_change: Object.keys(QuantitativeChangeIntentSchema.shape),
    cause_effect: Object.keys(CauseEffectIntentSchema.innerType().shape),
    comparison: Object.keys(ComparisonIntentSchema.innerType().shape),
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

{
  const t = thought("A is faster than B.");
  const valid = { type: "comparison", leftLabel: "A", rightLabel: "B", rows: [{ left: "Faster than B", evidence: ["A is faster than B"] }], evidence: ["A is faster than B"] };
  check("grounds a literal one-sided comparison without filling the other side", groundDecision(valid, t).decision.type === "comparison");
  const mirrored = { ...valid, rows: [{ left: "Faster than B", right: "Slower", evidence: ["A is faster than B"] }] };
  check("rejects an invented mirrored opposite claim", groundDecision(mirrored, t).decision.type === "none");
  const winner = { ...valid, rows: [{ left: "Winner", evidence: ["A is faster than B"] }] };
  check("rejects an unstated winner claim", groundDecision(winner, t).decision.type === "none");
}

// --------------------------------------------------------------- grounding

section("grounding");

{
  const t = thought("We shipped three things: faster search, dark mode, and offline sync.");
  const intent = {
    type: "enumeration",
    items: ["faster search", "dark mode", "offline sync"],
    evidence: ["faster search", "dark mode", "offline sync"],
  };
  const { decision: out, result } = groundDecision(intent, t);
  check("grounds enumeration whose evidence is present in the source", out.type === "enumeration", result.reason);
}

{
  const t = thought("We shipped three things: faster search, dark mode, and offline sync.");
  const intent = {
    type: "enumeration",
    items: ["faster search", "time travel", "teleportation"],
    evidence: ["time travel and teleportation"],
  };
  const { decision: out } = groundDecision(intent, t);
  check("downgrades enumeration whose evidence wasn't actually said to none", out.type === "none");
}

{
  const t = thought("Revenue went from ten to forty this quarter.");
  const intent = {
    type: "quantitative_change",
    from: 10,
    to: 40,
    evidence: ["revenue went from ten to forty"],
  };
  const { decision: out, result } = groundDecision(intent, t);
  check("grounds quantitative_change with spoken numbers (word form) and matching evidence", out.type === "quantitative_change", result.reason);
}

{
  const t = thought("We grew from 60 followers to about 400 followers.");
  const approximate = {
    type: "quantitative_change",
    from: 60,
    to: 400,
    toQualifier: "about",
    unit: "followers",
    evidence: ["grew from 60 followers to about 400 followers"],
  };
  const exact = { ...approximate, toQualifier: undefined };
  check("grounds a qualifier attached to the matching numeric anchor", groundDecision(approximate, t).result.grounded);
  check("rejects an exact intent when the source anchor is approximate", groundDecision(exact, t).decision.type === "none");
}

{
  const t = thought("We grew from 60 followers to 400 followers.");
  const inventedApproximation = {
    type: "quantitative_change",
    from: 60,
    to: 400,
    toQualifier: "about",
    unit: "followers",
    evidence: ["grew from 60 followers to 400 followers"],
  };
  check("rejects an approximate intent when the source anchor is exact", groundDecision(inventedApproximation, t).decision.type === "none");
}

{
  const t = thought("We went from about 100 users to around 200.");
  const intent = {
    type: "quantitative_change",
    from: 100,
    to: 200,
    fromQualifier: "about",
    toQualifier: "around",
    unit: "users",
    evidence: ["from about 100 users to around 200"],
  };
  check("grounds both qualifiers only when their anchor and order agree", groundDecision(intent, t).result.grounded);
  check("rejects swapped qualifier provenance", groundDecision({ ...intent, fromQualifier: "around", toQualifier: "about" }, t).decision.type === "none");
}

{
  const t = thought("Revenue went from ten to forty this quarter.");
  const intent = {
    type: "quantitative_change",
    from: 10,
    to: 999,
    evidence: ["revenue went from ten to forty"],
  };
  const { decision: out } = groundDecision(intent, t);
  check("downgrades quantitative_change with an unspoken number to none", out.type === "none");
}

{
  const t = thought("Revenue went from ten to forty this quarter.");
  const intent = {
    type: "quantitative_change",
    from: 10,
    to: 40,
    evidence: ["profits soared to the moon"], // not actually said
  };
  const { decision: out } = groundDecision(intent, t);
  check("downgrades quantitative_change whose evidence wasn't actually said, even if the numbers match", out.type === "none");
}

{
  const t = thought("Just a plain settled thought with no structure.");
  const { decision: out } = groundDecision({ type: "none", reason: "no list or change present" }, t);
  check("a none intent always grounds", out.type === "none");
}

{
  // The live-caught failure mode this item-level check exists for: a real,
  // grounded evidence phrase citing the actual list, but one item quietly
  // swapped for a category the speaker never said.
  const t = thought("There are three things we need to improve: speed, accuracy and presentation.");
  const intent = {
    type: "enumeration",
    items: ["Speed", "Accuracy", "Design"],
    evidence: ["speed, accuracy and presentation"],
  };
  const { decision: out, result } = groundDecision(intent, t);
  check(
    "downgrades an enumeration with one fabricated item even though its evidence phrase is real",
    out.type === "none",
    result.reason,
  );
}

{
  const t = thought("There are three things we need to improve: speed, accuracy and presentation.");
  const intent = {
    type: "enumeration",
    items: ["Speed", "Accuracy", "Presentation"],
    evidence: ["speed, accuracy and presentation"],
  };
  const { decision: out, result } = groundDecision(intent, t);
  check("grounds an enumeration whose items exactly match the source", out.type === "enumeration", result.reason);
}

{
  // Casing + plural/singular are "harmless differences" per the brief.
  const t = thought("My priorities are product, users and distribution.");
  const intent = {
    type: "enumeration",
    items: ["PRODUCT", "user", "Distribution"],
    evidence: ["product, users and distribution"],
  };
  const { decision: out, result } = groundDecision(intent, t);
  check("normalizes casing and simple plural/singular before grounding items", out.type === "enumeration", result.reason);
}

{
  // Part 7's own example: "ten thousand"/"twenty thousand" must ground now
  // that extractSpokenNumbers (lib/math/ground.ts) understands multipliers.
  const t = thought("Revenue went from ten thousand dollars last month to twenty thousand this month.");
  const intent = {
    type: "quantitative_change",
    from: 10000,
    to: 20000,
    unit: "dollars",
    fromLabel: "last month",
    toLabel: "this month",
    evidence: ["revenue went from ten thousand dollars last month to twenty thousand this month"],
  };
  const { decision: out, result } = groundDecision(intent, t);
  check("grounds a 'ten thousand'/'twenty thousand' quantitative_change with unit and time labels", out.type === "quantitative_change", result.reason);
}

{
  const t = thought("We had ten users last week and twenty users this week.");
  const intent = {
    type: "quantitative_change",
    from: 10,
    to: 20,
    unit: "signups", // not what was said ("users")
    evidence: ["we had ten users last week and twenty users this week"],
  };
  const { decision: out } = groundDecision(intent, t);
  check("downgrades quantitative_change whose unit wasn't actually said", out.type === "none");
}

{
  const t = thought("We had ten users last week and twenty users this week.");
  const intent = {
    type: "quantitative_change",
    from: 10,
    to: 20,
    unit: "users",
    fromLabel: "last month", // not what was said ("last week")
    toLabel: "this week",
    evidence: ["we had ten users last week and twenty users this week"],
  };
  const { decision: out } = groundDecision(intent, t);
  check("downgrades quantitative_change whose fromLabel wasn't actually said", out.type === "none");
}

{
  const t = thought("We had ten users last week and twenty users this week.");
  const intent = {
    type: "quantitative_change",
    from: 10,
    to: 20,
    unit: "users",
    fromLabel: "last week",
    toLabel: "this week",
    evidence: ["we had ten users last week and twenty users this week"],
  };
  const { decision: out, result } = groundDecision(intent, t);
  check("grounds a quantitative_change whose unit and labels were all actually said", out.type === "quantitative_change", result.reason);
}

{
  // Part 15's exact enumeration example, valid form.
  const t = thought("There are three things we need to improve: speed, accuracy and presentation.");
  const intent = {
    type: "enumeration",
    items: ["speed", "accuracy", "presentation"],
    evidence: ["speed, accuracy and presentation"],
  };
  const { decision: out, result } = groundDecision(intent, t);
  check("Part 15 example: speed/accuracy/presentation grounds", out.type === "enumeration", result.reason);
}

{
  // Part 15's exact enumeration example, invalid form (marketing swapped in).
  const t = thought("There are three things we need to improve: speed, accuracy and presentation.");
  const intent = {
    type: "enumeration",
    items: ["speed", "accuracy", "marketing"],
    evidence: ["speed, accuracy and presentation"],
  };
  const { decision: out } = groundDecision(intent, t);
  check("Part 15 example: speed/accuracy/marketing (marketing never said) downgrades to none", out.type === "none");
}

{
  const t = thought("First sign up, then create a project.");
  const valid = { type: "sequence", steps: ["Sign up", "Create a project"], evidence: ["sign up", "create a project"] };
  check("grounds every literal sequence step in source order", groundDecision(valid, t).decision.type === "sequence");
  const invented = { ...valid, steps: ["Sign up", "Verify email", "Create a project"] };
  check("rejects an invented middle sequence step", groundDecision(invented, t).decision.type === "none");
  const reversed = { ...valid, steps: ["Create a project", "Sign up"] };
  check("rejects sequence steps in an order the speaker did not say", groundDecision(reversed, t).decision.type === "none");
}

{
  // Part 15's exact quantitative example, valid form.
  const t = thought("We had ten users last week and twenty users this week.");
  const intent = {
    type: "quantitative_change",
    from: 10,
    to: 20,
    unit: "users",
    evidence: ["we had ten users last week and twenty users this week"],
  };
  const { decision: out, result } = groundDecision(intent, t);
  check("Part 15 example: 10 -> 20 users grounds", out.type === "quantitative_change", result.reason);
}

{
  // Part 15's exact quantitative example, invalid form ("thirty" never said).
  const t = thought("We had ten users last week and twenty users this week.");
  const intent = {
    type: "quantitative_change",
    from: 10,
    to: 30,
    unit: "users",
    evidence: ["we had ten users last week and twenty users this week"],
  };
  const { decision: out } = groundDecision(intent, t);
  check("Part 15 example: 10 -> 30 users (30 never said) downgrades to none", out.type === "none");
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
  check("the simulated model request owns the active slot", active?.thought.id === "active-request");
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

// --------------------------------------------------------------- rendering

// buildVisual() itself (dynamic `@excalidraw/excalidraw` import) needs a
// browser-shaped environment — same reason scripts/math-test.mjs never
// calls buildMathVisual() directly, only its pure measurement helpers.
// Rendering is exercised manually per the plan's browser verification step.
section("rendering (measurement only — buildVisual needs a browser env)");

{
  const size = measureVisual({
    type: "enumeration",
    title: "Shipped",
    items: ["faster search", "dark mode", "offline sync"],
    evidence: ["faster search, dark mode, offline sync"],
  });
  check("enumeration measures a positive footprint", size.w > 0 && size.h > 0);
}

{
  const size = measureVisual({ type: "sequence", title: "Process", steps: ["Collect data", "Clean data", "Train model"], evidence: ["first collect, then clean, finally train"] });
  check("sequence measures a compact positive footprint", size.w > 0 && size.h > 0 && size.h < 300);
}

{
  const size = measureVisual({ type: "cause_effect", nodes: ["Lower prices", "More signups"], edges: [{ from: 0, to: 1, evidence: "Lower prices caused more signups" }], evidence: ["Lower prices caused more signups"] });
  check("cause_effect measures a compact positive footprint", size.w > 0 && size.h > 0 && size.h < 300);
}

{
  const size = measureVisual({ type: "comparison", leftLabel: "Option A", rightLabel: "Option B", rows: [{ left: "Cheaper", right: "Easier to use", evidence: ["x"] }], evidence: ["x"] });
  check("comparison measures a compact positive footprint", size.w > 0 && size.h > 0 && size.h < 300);
}

{
  const size = measureVisual({
    type: "quantitative_change",
    fromLabel: "Q1",
    toLabel: "Q2",
    from: 10,
    to: 40,
    unit: "k",
    evidence: ["10k to 40k"],
  });
  check("quantitative_change measures a fixed footprint", size.w > 0 && size.h > 0);
}

{
  const flat = measureVisual({ type: "enumeration", items: ["a"], evidence: ["a"] });
  check("measureVisual doesn't throw on a short items list", flat.h > 0);
}

{
  const withLabels = measureVisual({ type: "quantitative_change", from: 10, to: 40, fromLabel: "Q1", toLabel: "Q2", evidence: ["10 to 40"] });
  const withoutLabels = measureVisual({ type: "quantitative_change", from: 10, to: 40, evidence: ["10 to 40"] });
  check("quantitative_change reserves extra height only when labels are present", withLabels.h > withoutLabels.h);
}

// Part 15: "Enumeration geometry is deterministic" / "Quantitative geometry
// is deterministic". buildVisual() itself needs a browser env (see above),
// but the skeleton builders it calls — the actual geometry logic — are pure
// functions of (spec, x, y, w, h) and can be called directly: same input
// twice must produce byte-identical output.
section("renderer determinism (same spec + placement -> byte-identical geometry, every time)");

{
  const spec = { type: "enumeration", title: "Shipped", items: ["faster search", "dark mode", "offline sync"], evidence: ["x"] };
  const a = JSON.stringify(enumerationSkeleton(spec, 10, 20, 420, 100));
  const b = JSON.stringify(enumerationSkeleton(spec, 10, 20, 420, 100));
  check("enumerationSkeleton is deterministic for identical inputs", a === b);
  check("enumerationSkeleton actually produced geometry", a.length > 2);
}

{
  const spec = { type: "quantitative_change", from: 10, to: 40, fromLabel: "Q1", toLabel: "Q2", evidence: ["x"] };
  const a = JSON.stringify(quantitativeChangeSkeleton(spec, 10, 20, 420, 90));
  const b = JSON.stringify(quantitativeChangeSkeleton(spec, 10, 20, 420, 90));
  check("quantitativeChangeSkeleton is deterministic for identical inputs", a === b);
  check("quantitativeChangeSkeleton actually produced geometry", a.length > 2);
}

{
  const spec = { type: "sequence", steps: ["Collect data", "Clean data", "Train model"], evidence: ["x"] };
  const a = JSON.stringify(sequenceSkeleton(spec, 10, 20, 420, 150));
  const b = JSON.stringify(sequenceSkeleton(spec, 10, 20, 420, 150));
  check("sequenceSkeleton is deterministic for identical inputs", a === b);
  const arrows = sequenceSkeleton(spec, 10, 20, 420, 150).filter((element) => element.endArrowhead === "arrow");
  check("sequence renderer connects adjacent steps with exactly two arrows", arrows.length === 2);
}

{
  const spec = { type: "cause_effect", nodes: ["Marketing", "Traffic", "Signups"], edges: [{ from: 0, to: 1, evidence: "Marketing creates traffic" }, { from: 1, to: 2, evidence: "Traffic creates signups" }], evidence: ["x"] };
  const a = JSON.stringify(causeEffectSkeleton(spec, 10, 20, 420, 250));
  const b = JSON.stringify(causeEffectSkeleton(spec, 10, 20, 420, 250));
  check("causeEffectSkeleton is deterministic for identical inputs", a === b);
  const skeleton = causeEffectSkeleton(spec, 10, 20, 420, 250);
  check("cause renderer uses causal connector labels rather than sequence numbering", skeleton.filter((element) => element.text === "CAUSE").length === 2 && !skeleton.some((element) => element.text === "01"));
}

{
  const spec = { type: "comparison", leftLabel: "Option A", rightLabel: "Option B", rows: [{ left: "Cheaper", right: "Easier", evidence: ["x"] }, { left: "Faster", evidence: ["x"] }], evidence: ["x"] };
  const a = JSON.stringify(comparisonSkeleton(spec, 10, 20, 420, 180));
  const b = JSON.stringify(comparisonSkeleton(spec, 10, 20, 420, 180));
  check("comparisonSkeleton is deterministic for identical inputs", a === b);
  const texts = comparisonSkeleton(spec, 10, 20, 420, 180).filter((element) => element.type === "text").map((element) => element.text);
  check("comparison renderer preserves blank sides without invented filler", texts.includes("Faster") && !texts.includes("Slower") && !texts.includes("Winner"));
  check("comparison renderer contains no judgmental check/X marks", !texts.includes("✓") && !texts.includes("✗"));
}

{
  const spec = { type: "quantitative_change", from: 60, to: 400, toQualifier: "about", unit: "followers", evidence: ["x"] };
  const skeleton = quantitativeChangeSkeleton(spec, 10, 20, 420, 60);
  const texts = skeleton.filter((element) => element.type === "text").map((element) => element.text);
  check("renderer visibly preserves literal approximation", texts.includes("about 400 followers"));
  check("renderer does not emit a strengthened exact destination label", !texts.includes("400 followers"));
}

{
  // Different placement (x/y) must move the geometry — proving the renderer,
  // not the model, owns position (invariant #16/#17).
  const spec = { type: "enumeration", items: ["A", "B"], evidence: ["x"] };
  const here = enumerationSkeleton(spec, 10, 20, 420, 100);
  const there = enumerationSkeleton(spec, 500, 900, 420, 100);
  check("moving the placement (x/y) moves the rendered geometry accordingly", JSON.stringify(here) !== JSON.stringify(there));
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
    type: "enumeration",
    items: Array.from({ length: 5 }, (_, index) => `${index + 1} ${Array.from({ length: 40 }, () => "oversized line").join("\n")}`),
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

// --------------------------------------------------------------- summary

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
