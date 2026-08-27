/**
 * Live smoke test for quantitative semantics: real speech, real model call
 * (lib/expression/meaning/extract.ts's extractMeaning), real sanitizeDelta,
 * real MetricSchema validation, real world/apply.ts mergeMetric, real
 * planner/composer, real SVG. Nothing here hand-constructs a Metric — every
 * one instrumented below is whatever the live model actually produced from
 * plain text.
 *
 * This is the one thing the fixture suite (scripts/expression-metric-replay.mjs)
 * cannot prove: fixtures hand-author the MeaningDelta, so they verify the
 * deterministic merge/render chain but say nothing about whether the model
 * can actually recover "conversion" from "it's down to four" using only
 * recentContext. This script is the other half.
 *
 * Requires ANTHROPIC_API_KEY. Costs real tokens — manual/occasional smoke
 * test, not part of `npm test`.
 *
 *   node --no-warnings --import ./scripts/ts-register.mjs scripts/expression-metric-live-replay.mjs
 */

import { ExpressionSession } from "../lib/expression/pipeline.ts";
import { extractMeaning } from "../lib/expression/meaning/extract.ts";
import { formatTrace } from "../lib/expression/trace.ts";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set — this script makes real model calls and cannot run without it.");
  process.exit(1);
}

function metricEntities(world) {
  return world.entities.filter((e) => e.metric);
}

function describeMetric(e) {
  const m = e.metric;
  const hist = m.history.map((p) => `${p.approximate ? "~" : ""}${p.value}`).join("->");
  const target = m.target ? ` target=${m.target.value}` : "";
  return `${e.id}[${e.status}] ${m.unit} ${hist}${target}`;
}

/**
 * Conversation A: exactly the phrasing the task specified, with just enough
 * topic anchoring for a human listener to track — "we're at 200" only means
 * something once traffic has been named. Tests whether contextual
 * continuations attach to the SAME metric across turns rather than minting
 * a new entity per number.
 */
const SEQUENTIAL = {
  name: "A — sequential contextual continuations (traffic, then conversion)",
  turns: [
    "Let's look at traffic this month.",
    "We're at 200.",
    "It's up to 500 now.",
    "Let's check conversion too.",
    "Conversion was ten percent.",
    "It's down to four.",
    "Actually it's six today.",
    "Our target is twelve percent.",
  ],
  expect: "one traffic metric with history 200,500; one conversion metric with history 10,4,6 and target 12 — never more than two metric-bearing entities total",
};

/**
 * Conversation B: two metrics get mentioned in the SAME recent-context
 * window, then a bare continuation ("it moved to 15") arrives with no
 * disambiguating word. A human would probably read this as continuing
 * whichever was just discussed (conversion), but it is genuinely ambiguous
 * — this is the case the task asks us to check: does the system pick
 * confidently, or does it show its uncertainty rather than silently
 * guessing wrong?
 */
const AMBIGUOUS = {
  name: "B — ambiguous continuation across two recently-mentioned metrics",
  turns: [
    "Traffic is at 200 visitors.",
    "Conversion is at 10 percent.",
    "It moved to 15.",
  ],
  expect: "no forced merge into the wrong metric — either it attaches to conversion (last-mentioned, and 15 is a plausible percent) or it creates a new entity; it must NOT silently corrupt traffic's history with an unrelated 15",
};

/**
 * Conversation C: a bare number as the very FIRST thing said in a session —
 * zero prior context, nothing to anchor "200" to. There is no deterministic
 * abstention lever for the model's own extraction (it always returns some
 * JSON), so the real question is whether sanitizeDelta/MetricSchema still
 * requires a real label, and whether the model invents a nonsense entity
 * rather than leaving it out.
 */
const NO_CONTEXT = {
  name: "C — bare number with zero prior context",
  turns: ["We're at 200."],
  expect: "either no metric entity at all, or one with an honest generic label (e.g. \"the number\") — never a confident, specific label like \"traffic\" invented from nothing",
};

let anyFindings = false;
const findings = [];

for (const convo of [SEQUENTIAL, AMBIGUOUS, NO_CONTEXT]) {
  console.log(`\n${"═".repeat(80)}\n${convo.name}\n${"═".repeat(80)}`);
  console.log(`expect: ${convo.expect}`);
  const session = new ExpressionSession({ extract: (text, recent) => extractMeaning(text, recent) });
  let lastTrace = null;

  for (const [index, text] of convo.turns.entries()) {
    const trace = await session.ingest({ id: `t${index}`, source: "human_speech", text, seq: index });
    lastTrace = trace;
    console.log(`\n  turn ${index + 1}: "${text}"`);
    console.log(
      formatTrace(trace)
        .split(/\r?\n/)
        .map((l) => `      ${l}`)
        .join("\n"),
    );
  }

  const finalMetrics = metricEntities(lastTrace.world);
  console.log(`\n  FINAL METRIC ENTITIES:`);
  for (const e of finalMetrics) console.log(`    ${describeMetric(e)}`);
  if (!finalMetrics.length) console.log(`    (none)`);

  // ---- structural checks, read against each conversation's own expectation ----

  if (convo === SEQUENTIAL) {
    if (finalMetrics.length > 2) {
      console.log(`  ✗ expected at most 2 metric entities (traffic, conversion), got ${finalMetrics.length}`);
      findings.push({ convo: convo.name, detail: `${finalMetrics.length} metric entities instead of 2` });
      anyFindings = true;
    }
    const traffic = finalMetrics.find((e) => /traffic|visitor/i.test(e.label));
    const conversion = finalMetrics.find((e) => /conversion/i.test(e.label));
    if (!traffic) {
      console.log(`  ✗ no entity recognisable as "traffic" found`);
      findings.push({ convo: convo.name, detail: "no traffic entity" });
      anyFindings = true;
    } else {
      const values = traffic.metric.history.map((p) => p.value);
      if (JSON.stringify(values) !== JSON.stringify([200, 500])) {
        console.log(`  ✗ traffic history expected [200,500], got ${JSON.stringify(values)}`);
        findings.push({ convo: convo.name, detail: `traffic history ${JSON.stringify(values)}` });
        anyFindings = true;
      }
    }
    if (!conversion) {
      console.log(`  ✗ no entity recognisable as "conversion" found`);
      findings.push({ convo: convo.name, detail: "no conversion entity" });
      anyFindings = true;
    } else {
      const values = conversion.metric.history.map((p) => p.value);
      if (JSON.stringify(values) !== JSON.stringify([10, 4, 6])) {
        console.log(`  ✗ conversion history expected [10,4,6], got ${JSON.stringify(values)}`);
        findings.push({ convo: convo.name, detail: `conversion history ${JSON.stringify(values)}` });
        anyFindings = true;
      }
      if (conversion.metric.target?.value !== 12) {
        console.log(`  ✗ conversion target expected 12, got ${conversion.metric.target?.value}`);
        findings.push({ convo: convo.name, detail: `conversion target ${conversion.metric.target?.value}` });
        anyFindings = true;
      }
    }
  }

  if (convo === AMBIGUOUS) {
    const traffic = finalMetrics.find((e) => /traffic|visitor/i.test(e.label));
    if (traffic) {
      const values = traffic.metric.history.map((p) => p.value);
      if (values.includes(15)) {
        console.log(`  ✗ INVARIANT VIOLATED: 15 was merged into traffic's history (${JSON.stringify(values)}) — wrong-metric contamination`);
        findings.push({ convo: convo.name, detail: `traffic history contaminated: ${JSON.stringify(values)}` });
        anyFindings = true;
      }
    }
    console.log(`  (read the trace above to judge whether "15" attached sensibly — this case is genuinely ambiguous, not a pass/fail assertion)`);
  }

  if (convo === NO_CONTEXT) {
    const suspicious = finalMetrics.find((e) => /traffic|conversion|revenue|visitor|users?/i.test(e.label));
    if (suspicious) {
      console.log(`  ✗ model invented a specific label "${suspicious.label}" from a context-free "We're at 200."`);
      findings.push({ convo: convo.name, detail: `invented specific label "${suspicious.label}"` });
      anyFindings = true;
    }
  }
}

console.log(`\n${"═".repeat(80)}`);
console.log(anyFindings ? "one or more structural invariants were violated — see ✗ lines above" : "no structural invariants were violated across all conversations");
console.log("This is a live, non-deterministic smoke test: read the traces above to judge whether the model's real phrasing produced sensible metric identity, not just whether an assertion passed.");
if (findings.length) {
  console.log(`\nfindings:`);
  for (const f of findings) console.log(`  - [${f.convo}] ${f.detail}`);
  process.exitCode = 1;
}
