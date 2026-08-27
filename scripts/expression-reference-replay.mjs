/**
 * Replays the ordinal / topic-recall reference-resolution fixtures against
 * the real pipeline, turn by turn, and checks each ReferenceMention's
 * outcome: which entity (if any) it resolved to, at what confidence, and —
 * when it deliberately did NOT resolve — that nothing was silently attached
 * to the wrong concept instead.
 *
 *   node --no-warnings --import ./scripts/ts-register.mjs scripts/expression-reference-replay.mjs --verbose
 */

import { MeaningDeltaSchema } from "../lib/expression/schemas.ts";
import { ExpressionSession } from "../lib/expression/pipeline.ts";
import { formatTrace } from "../lib/expression/trace.ts";
import { REFERENCE_SCENARIOS } from "./fixtures/reference-scenarios.mjs";

const verbose = process.argv.includes("--verbose");

function labelOf(world, id) {
  return world.entities.find((e) => e.id === id)?.label ?? null;
}

let totalChecks = 0;
let passedChecks = 0;
const findings = [];

for (const scenario of REFERENCE_SCENARIOS) {
  console.log(`\n${"─".repeat(78)}\n${scenario.name}\n${"─".repeat(78)}`);
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
      for (const r of trace.referenceResolutions) {
        const outcome = r.chosenId ? `-> ${labelOf(trace.world, r.chosenId)}` : "-> UNRESOLVED";
        console.log(`      REFERENCE "${r.surface}" (${r.kind}) ${outcome}  [${r.confidence}] ${r.reason}`);
        for (const c of r.candidates) console.log(`        candidate ${c.label}  score=${c.score}  ${c.reason}`);
      }
    }

    const expect = scenario.expectByTurn?.[index];
    if (!expect) continue;
    totalChecks += 1;

    if (!trace.referenceResolutions.length) {
      console.log(`    ✗ expected a reference resolution this turn, got none`);
      findings.push({ scenario: scenario.name, turn: index + 1, detail: "no referenceResolutions produced" });
      continue;
    }
    const r = trace.referenceResolutions[trace.referenceResolutions.length - 1];

    if (expect.unresolved) {
      if (r.chosenId === null) {
        console.log(`    ✓ correctly left unresolved (${r.reason})`);
        passedChecks += 1;
      } else {
        console.log(`    ✗ expected UNRESOLVED, but attached to "${labelOf(trace.world, r.chosenId)}"`);
        findings.push({ scenario: scenario.name, turn: index + 1, detail: `expected unresolved, got "${labelOf(trace.world, r.chosenId)}"` });
      }
      continue;
    }

    const gotLabel = r.chosenId ? labelOf(trace.world, r.chosenId) : null;
    const labelOk = gotLabel === expect.chosenLabel;
    const confOk = !expect.confidence || r.confidence === expect.confidence;
    if (labelOk && confOk) {
      console.log(`    ✓ resolved to "${gotLabel}" at ${r.confidence} confidence`);
      passedChecks += 1;
    } else {
      console.log(`    ✗ expected "${expect.chosenLabel}" (${expect.confidence ?? "any"}), got "${gotLabel}" (${r.confidence})`);
      findings.push({
        scenario: scenario.name,
        turn: index + 1,
        detail: `expected "${expect.chosenLabel}" (${expect.confidence ?? "any"}), got "${gotLabel}" (${r.confidence}) — ${r.reason}`,
      });
    }

    if (expect.checks) {
      const extra = expect.checks(trace);
      for (const problem of extra) {
        totalChecks += 1;
        console.log(`    ✗ ${problem}`);
        findings.push({ scenario: scenario.name, turn: index + 1, detail: problem });
      }
      if (!extra.length) {
        totalChecks += 1;
        passedChecks += 1;
        console.log(`    ✓ world/visual checks passed`);
      }
    }
  }
}

console.log(`\n${"═".repeat(78)}`);
console.log(`reference checks passing: ${passedChecks}/${totalChecks}`);
if (findings.length) {
  console.log(`\nfindings:`);
  for (const f of findings) console.log(`  - [${f.scenario}] turn ${f.turn}: ${f.detail}`);
  process.exitCode = 1;
} else {
  console.log("every reference resolution matched its expectation.");
}
