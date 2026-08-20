/**
 * Live run of the whole Expression Engine against the REAL extractor.
 *
 *   ANTHROPIC_API_KEY=... node --no-warnings --import ./scripts/ts-register.mjs scripts/expression-live.mjs
 *   ... scripts/expression-live.mjs "any text you want, sentence by sentence."
 *
 * The counterpart to scripts/expression-test.mjs. That one fixes the
 * extractor and asserts every deterministic layer over 100+ cases; this one
 * fixes nothing and measures the layer the corpus deliberately holds still.
 * Both are needed: a perfect score offline with a bad extractor is a perfect
 * score on the wrong input.
 *
 * Costs money. Prints the full trace per sentence and a summary at the end.
 */

import { ExpressionSession, segmentText } from "../lib/expression/pipeline.ts";
import { extractMeaning } from "../lib/expression/meaning/extract.ts";
import { describeWorldOp } from "../lib/expression/world/apply.ts";

const DEFAULT_SCRIPTS = [
  ["identity", `My name is Kenny Farmer. I'm from Trinidad and Tobago. I have a family of five. My mother's name is Mariam.`],
  ["causality", `AI is making it easier to build apps, so we're going to end up with thousands of apps, but that creates a trust problem because people don't know which apps are legitimate.`],
  ["sequence", `First authenticate the user, then fetch their projects, then open the dashboard.`],
  ["comparison", `Plan A costs more but finishes twice as quickly as Plan B.`],
  ["spatial", `The lamp is behind the chair and the chair is beside the desk.`],
  ["state change", `The water started frozen, melted into liquid, then evaporated.`],
  ["reference", `Priya joined last month. She runs the data team. That team owns the warehouse.`],
];

const custom = process.argv.slice(2).join(" ").trim();
const scripts = custom ? [["custom", custom]] : DEFAULT_SCRIPTS;

if (!process.env.ANTHROPIC_API_KEY && !process.env.GOOGLE_API_KEY) {
  console.error("No provider key in the environment. This script calls a real model.");
  process.exit(1);
}

const scores = [];

for (const [name, text] of scripts) {
  console.log(`\n\n══════════ ${name}\n${text}\n`);
  const session = new ExpressionSession({ extract: (t, recent) => extractMeaning(t, recent) });

  for (const segment of segmentText(text)) {
    const trace = await session.ingest(segment);
    console.log(`── "${segment.text}"`);
    console.log(`   meaning     ${trace.delta.entities.map((e) => `${e.label}(${e.type}${e.quantity ? `×${e.quantity.value}` : ""})`).join(", ") || "—"}`);
    if (trace.delta.relations.length) {
      console.log(`               ${trace.delta.relations.map((r) => `${r.source}-${r.type}${r.role ? `:${r.role}` : ""}->${r.target}`).join(", ")}`);
    }
    console.log(`   world       ${trace.ops.map(describeWorldOp).join("; ") || "(no change)"}`);
    console.log(`   intent      ${trace.intent.primary}  — ${trace.intent.reason}`);
    console.log(`   grammar     ${trace.plan.grammar}  — ${trace.plan.reason}`);
    console.log(`   scene       ${trace.scene.objects.map((o) => `${o.primitive}${o.count ? `×${o.count}` : ""}:${o.label ?? ""}`).join(" | ")}`);
    console.log(`   evaluation  preservation ${trace.evaluation.semanticPreservation}${trace.evaluation.inventedRelations.length ? `  INVENTED: ${trace.evaluation.inventedRelations.join("; ")}` : ""}`);
    for (const problem of trace.evaluation.problems) {
      console.log(`               ! ${problem.type} (${problem.severity}) ${problem.detail}`);
    }
    if (trace.repairOutcome) {
      console.log(`   repair      ${trace.repairOutcome.kept ? "kept" : "discarded"}: ${trace.repairOutcome.before} → ${trace.repairOutcome.after}`);
    }
    scores.push(trace.evaluation.semanticPreservation);
  }
}

const mean = scores.reduce((a, b) => a + b, 0) / (scores.length || 1);
console.log(`\n\n${scores.length} segments, mean preservation ${mean.toFixed(3)}`);
