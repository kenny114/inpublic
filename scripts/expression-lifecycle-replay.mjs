/**
 * Replays the discourse-act lifecycle fixtures (reject / suspend /
 * deemphasize / invalidate / supersede / reactivate) through the real
 * pipeline, plus the eight-turn "nasty sequence" from the revision-discourse
 * hardening task, and checks the exact WorldEntity.status /
 * WorldEntity.supersededByEntityId / WorldClaim.invalidated distinctions —
 * not just "is it gone", because that is precisely the caption-vs-thought
 * distinction this task exists to prove.
 *
 *   node --no-warnings --import ./scripts/ts-register.mjs scripts/expression-lifecycle-replay.mjs --verbose
 */

import { MeaningDeltaSchema } from "../lib/expression/schemas.ts";
import { ExpressionSession } from "../lib/expression/pipeline.ts";
import { formatTrace } from "../lib/expression/trace.ts";
import { LIFECYCLE_SCENARIOS, NASTY_SEQUENCE } from "./fixtures/lifecycle-scenarios.mjs";

const verbose = process.argv.includes("--verbose");

let totalChecks = 0;
let passedChecks = 0;
const findings = [];

async function runScenario(scenario) {
  console.log(`\n${"─".repeat(80)}\n${scenario.name}\n${"─".repeat(80)}`);
  const session = new ExpressionSession({ extract: async () => ({ entities: [], relations: [], claims: [], interpretation: "" }) });

  for (const [index, turn] of scenario.turns.entries()) {
    const parsed = MeaningDeltaSchema.safeParse(turn.delta);
    if (!parsed.success) {
      console.log(`  turn ${index + 1}: INVALID FIXTURE — ${parsed.error.issues[0]?.message} at ${parsed.error.issues[0]?.path.join(".")}`);
      totalChecks += 1;
      findings.push({ scenario: scenario.name, turn: index + 1, detail: "invalid fixture delta" });
      continue;
    }
    const trace = await session.ingestDelta({ id: `t${index}`, source: "human_speech", text: turn.text, seq: index }, parsed.data);

    console.log(`\n  turn ${index + 1}: "${turn.text}"`);
    if (verbose) {
      console.log(
        formatTrace(trace)
          .split(/\r?\n/)
          .map((l) => `      ${l}`)
          .join("\n"),
      );
    } else {
      for (const d of trace.discourseActResolutions) {
        const outcome = d.applied ? `-> ${d.targetId}` : "-> UNAPPLIED";
        console.log(`      DISCOURSE ${d.type} ${outcome}  [${d.confidence}] (said: "${d.targetSurface}") ${d.reason}`);
      }
    }

    const perTurn = scenario.checkByTurn?.[index];
    if (perTurn) {
      totalChecks += 1;
      const problems = perTurn(trace.world);
      if (problems.length) {
        for (const p of problems) {
          console.log(`    ✗ ${p}`);
          findings.push({ scenario: scenario.name, turn: index + 1, detail: p });
        }
      } else {
        console.log(`    ✓ turn check passed`);
        passedChecks += 1;
      }
    }
  }

  if (scenario.check) {
    totalChecks += 1;
    const session2World = session.getWorld();
    const problems = scenario.check(session2World);
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

for (const scenario of LIFECYCLE_SCENARIOS) await runScenario(scenario);
await runScenario(NASTY_SEQUENCE);

console.log(`\n${"═".repeat(80)}`);
console.log(`lifecycle checks passing: ${passedChecks}/${totalChecks}`);
if (findings.length) {
  console.log(`\nfindings:`);
  for (const f of findings) console.log(`  - [${f.scenario}] turn ${f.turn}: ${f.detail}`);
  process.exitCode = 1;
} else {
  console.log("every lifecycle scenario matched its expectation.");
}
