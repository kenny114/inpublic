/**
 * Replays the quantitative-semantics fixtures through the real
 * extraction-bypassed pipeline (ExpressionSession.ingestDelta — same
 * convention as every other fixture in this suite): text -> hand-authored
 * MeaningDelta (with a `metric` payload, as a real extractor would produce)
 * -> world/apply.ts's mergeMetric -> intent/grammar/compose -> a real
 * ScenePlan with metric_value / metric_series / metric_gauge objects.
 *
 * Instruments the full chain per turn:
 *   speech -> extracted quantitative meaning -> normalized metric state ->
 *   world update -> expression choice -> rendered result
 * via the METRIC trace line plus each scenario's own check() against the
 * final world/scene/plan.
 *
 *   node --no-warnings --import ./scripts/ts-register.mjs scripts/expression-metric-replay.mjs --verbose
 */

import { MeaningDeltaSchema } from "../lib/expression/schemas.ts";
import { ExpressionSession } from "../lib/expression/pipeline.ts";
import { formatTrace } from "../lib/expression/trace.ts";
import { METRIC_SCENARIOS, METRIC_NASTY_SEQUENCE } from "./fixtures/metric-scenarios.mjs";

const verbose = process.argv.includes("--verbose");

let totalChecks = 0;
let passedChecks = 0;
const findings = [];

async function runScenario(scenario) {
  console.log(`\n${"─".repeat(80)}\n${scenario.name}\n${"─".repeat(80)}`);
  const session = new ExpressionSession({ extract: async () => ({ entities: [], relations: [], claims: [], interpretation: "" }) });
  let lastTrace = null;

  for (const [index, turn] of scenario.turns.entries()) {
    const parsed = MeaningDeltaSchema.safeParse(turn.delta);
    if (!parsed.success) {
      console.log(`  turn ${index + 1}: INVALID FIXTURE — ${parsed.error.issues[0]?.message} at ${parsed.error.issues[0]?.path.join(".")}`);
      totalChecks += 1;
      findings.push({ scenario: scenario.name, turn: index + 1, detail: "invalid fixture delta" });
      continue;
    }
    const trace = await session.ingestDelta({ id: `t${index}`, source: "human_speech", text: turn.text, seq: index }, parsed.data);
    lastTrace = trace;

    console.log(`\n  turn ${index + 1}: "${turn.text}"`);
    if (verbose) {
      console.log(
        formatTrace(trace)
          .split(/\r?\n/)
          .map((l) => `      ${l}`)
          .join("\n"),
      );
    } else {
      for (const m of trace.metricResolutions) {
        const entity = trace.world.entities.find((e) => e.id === m.entityId);
        console.log(`      METRIC ${entity?.label ?? m.entityId} ${m.action} — ${m.detail}`);
      }
      const metricObjs = trace.scene.objects.filter((o) => o.metric);
      for (const o of metricObjs) {
        console.log(`      SCENE  ${o.entityId}:${o.primitive}  history=${JSON.stringify(o.metric.history)}${o.metric.target ? ` target=${JSON.stringify(o.metric.target)}` : ""}`);
      }
    }
  }

  if (scenario.check && lastTrace) {
    totalChecks += 1;
    const problems = scenario.check({
      world: lastTrace.world,
      scene: lastTrace.scene,
      plan: lastTrace.plan,
      metricResolutions: lastTrace.metricResolutions,
    });
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

for (const scenario of METRIC_SCENARIOS) await runScenario(scenario);
await runScenario(METRIC_NASTY_SEQUENCE);

console.log(`\n${"═".repeat(80)}`);
console.log(`metric checks passing: ${passedChecks}/${totalChecks}`);
if (findings.length) {
  console.log(`\nfindings:`);
  for (const f of findings) console.log(`  - [${f.scenario}] turn ${f.turn}: ${f.detail}`);
  process.exitCode = 1;
} else {
  console.log("every metric scenario matched its expectation.");
}
