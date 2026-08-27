/**
 * Adversarial entity-identity regression suite: drives
 * scripts/fixtures/identity-scenarios.mjs through the REAL pipeline
 * (ExpressionSession.ingestDelta, enableIdentityLayer: true) with a
 * scripted (non-model) judge standing in for stage 2 — so this runs with
 * no network and no API key, exactly like every other
 * scripts/expression-*-replay.mjs fixture suite, while still exercising
 * the full retrieval -> eligibility -> score -> judge -> merge/create
 * pipeline for real.
 *
 *   node --no-warnings --import ./scripts/ts-register.mjs scripts/expression-identity-replay.mjs [--verbose]
 */

import { MeaningDeltaSchema } from "../lib/expression/schemas.ts";
import { ExpressionSession } from "../lib/expression/pipeline.ts";
import { formatTrace } from "../lib/expression/trace.ts";
import { IDENTITY_SCENARIOS, scriptedJudge, summarizeInstrumentation } from "./fixtures/identity-scenarios.mjs";

const verbose = process.argv.includes("--verbose");

let totalChecks = 0;
let passedChecks = 0;
const findings = [];
const allResolutions = [];

async function runScenario(scenario) {
  console.log(`\n${"─".repeat(80)}\n${scenario.name}\n${"─".repeat(80)}`);
  const session = new ExpressionSession({
    extract: async () => ({ entities: [], relations: [], claims: [], interpretation: "" }),
    enableIdentityLayer: true,
    identityJudge: scriptedJudge(scenario.judgeScript),
  });
  let lastTrace = null;
  const scenarioResolutions = [];

  for (const [index, turn] of scenario.turns.entries()) {
    const parsed = MeaningDeltaSchema.safeParse(turn.delta);
    if (!parsed.success) {
      console.log(`  turn ${index + 1}: INVALID FIXTURE — ${parsed.error.issues[0]?.message} at ${parsed.error.issues[0]?.path.join(".")}`);
      totalChecks += 1;
      findings.push({ scenario: scenario.name, turn: index + 1, detail: "invalid fixture delta" });
      continue;
    }
    const trace = await session.ingestDelta({ id: `t${index}`, source: "human_speech", text: turn.text, seq: index, speakerId: turn.speakerId }, parsed.data);
    lastTrace = trace;
    scenarioResolutions.push(...trace.identityResolutions);
    allResolutions.push(...trace.identityResolutions);

    console.log(`\n  turn ${index + 1} [${turn.speakerId ?? "?"}]: "${turn.text}"`);
    if (verbose) {
      console.log(formatTrace(trace).split(/\r?\n/).map((l) => `      ${l}`).join("\n"));
    } else {
      for (const r of trace.identityResolutions) {
        console.log(`      IDENTITY "${r.mentionLabel}" — ${r.candidateCount} candidate(s), judge=${r.usedJudge}${r.judgeVerdict ? `(${r.judgeVerdict})` : ""} -> ${r.action} -> ${r.resultingEntityId}`);
      }
    }
  }

  if (scenario.check && lastTrace) {
    totalChecks += 1;
    const problems = scenario.check({ world: lastTrace.world, scene: lastTrace.scene, plan: lastTrace.plan, identityResolutions: scenarioResolutions });
    if (problems.length) {
      for (const p of problems) {
        console.log(`\n  ✗ ${p}`);
        findings.push({ scenario: scenario.name, turn: "final", detail: p });
      }
    } else {
      console.log(`\n  ✓ final-state check passed`);
      passedChecks += 1;
    }
  }
}

for (const scenario of IDENTITY_SCENARIOS) await runScenario(scenario);

console.log(`\n${"═".repeat(80)}`);
console.log(`identity checks passing: ${passedChecks}/${totalChecks}`);
console.log("instrumentation totals:", JSON.stringify(summarizeInstrumentation(allResolutions), null, 2));
if (findings.length) {
  console.log(`\nfindings:`);
  for (const f of findings) console.log(`  - [${f.scenario}] turn ${f.turn}: ${f.detail}`);
  process.exitCode = 1;
} else {
  console.log("every identity scenario matched its expectation — including the ones where the correct answer was to abstain.");
}
