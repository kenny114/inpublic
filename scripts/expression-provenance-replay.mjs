/**
 * Replays the eight speaker/timestamp/source provenance scenarios through
 * the real pipeline — ExpressionSession.ingestDelta, exactly like every
 * other fixture — with each turn carrying InputSegment.speakerId/timestamp
 * the way a real speech/agent adapter would supply them, never something
 * the model infers.
 *
 * Instruments the full chain per turn:
 *   speech → speaker/timestamp metadata → semantic extraction → world patch → resulting provenance
 * via PROVENANCE / REFERENCE / STANCE lines in formatTrace(), plus each
 * scenario's own `check(traces, finalWorld)` assertions.
 *
 *   node --no-warnings --import ./scripts/ts-register.mjs scripts/expression-provenance-replay.mjs --verbose
 */

import { MeaningDeltaSchema } from "../lib/expression/schemas.ts";
import { ExpressionSession } from "../lib/expression/pipeline.ts";
import { formatTrace } from "../lib/expression/trace.ts";
import { PROVENANCE_SCENARIOS } from "./fixtures/provenance-scenarios.mjs";

const verbose = process.argv.includes("--verbose");

function labelOf(world, id) {
  return world.entities.find((e) => e.id === id)?.label ?? null;
}

let totalChecks = 0;
let passedChecks = 0;
const findings = [];

for (const scenario of PROVENANCE_SCENARIOS) {
  console.log(`\n${"─".repeat(80)}\n${scenario.name}\n${"─".repeat(80)}`);
  const session = new ExpressionSession({ extract: async () => ({ entities: [], relations: [], claims: [], interpretation: "" }) });
  const traces = [];

  for (const [index, turn] of scenario.turns.entries()) {
    const parsed = MeaningDeltaSchema.safeParse(turn.delta);
    if (!parsed.success) {
      console.log(`  turn ${index + 1}: INVALID FIXTURE — ${parsed.error.issues[0]?.message} at ${parsed.error.issues[0]?.path.join(".")}`);
      totalChecks += 1;
      findings.push({ scenario: scenario.name, turn: index + 1, detail: "invalid fixture delta" });
      continue;
    }
    const segment = {
      id: `t${index}`,
      source: "human_speech",
      text: turn.text,
      seq: index,
      ...(turn.speaker !== undefined ? { speakerId: turn.speaker } : {}),
      ...(turn.timestamp !== undefined ? { timestamp: turn.timestamp } : {}),
    };
    const trace = await session.ingestDelta(segment, parsed.data);
    traces.push(trace);

    console.log(`\n  turn ${index + 1} [${turn.speaker ?? "?"}@${turn.timestamp ?? "?"}]: "${turn.text}"`);
    if (verbose) {
      console.log(
        formatTrace(trace)
          .split(/\r?\n/)
          .map((l) => `      ${l}`)
          .join("\n"),
      );
    } else {
      console.log(`      PROVENANCE  ${trace.provenance ? `${trace.provenance.speakerId ?? "?"}@${trace.provenance.timestamp ?? "?"} (segments: ${trace.provenance.sourceSegmentIds.join(",")})` : "(none)"}`);
      for (const r of trace.referenceResolutions) {
        const outcome = r.chosenId ? `-> ${labelOf(trace.world, r.chosenId)}` : "-> UNRESOLVED";
        console.log(`      REFERENCE   "${r.surface}" (${r.kind}) ${outcome}  [${r.confidence}] ${r.reason}`);
      }
      for (const s of trace.stanceResolutions) {
        const target = s.targetClaimId ? trace.world.claims.find((c) => c.id === s.targetClaimId) : null;
        console.log(`      STANCE      ${s.type} -> ${target ? `"${target.text}"` : "UNRESOLVED"}  (said: "${s.targetSurface}")`);
      }
    }

    const expect = scenario.expectByTurn?.[index];
    if (expect) {
      totalChecks += 1;
      const r = trace.referenceResolutions[trace.referenceResolutions.length - 1];
      const gotLabel = r?.chosenId ? labelOf(trace.world, r.chosenId) : null;
      if (r && gotLabel === expect.chosenLabel && (!expect.confidence || r.confidence === expect.confidence)) {
        console.log(`    ✓ resolved to "${gotLabel}" at ${r.confidence} confidence`);
        passedChecks += 1;
      } else {
        console.log(`    ✗ expected "${expect.chosenLabel}" (${expect.confidence ?? "any"}), got "${gotLabel}" (${r?.confidence})`);
        findings.push({ scenario: scenario.name, turn: index + 1, detail: `expected "${expect.chosenLabel}", got "${gotLabel}"` });
      }
    }
  }

  if (scenario.check) {
    const finalWorld = traces[traces.length - 1]?.world;
    const problems = finalWorld ? scenario.check(traces, finalWorld) : ["no traces produced"];
    totalChecks += 1;
    if (problems.length) {
      for (const p of problems) {
        console.log(`\n  ✗ ${p}`);
        findings.push({ scenario: scenario.name, turn: "final", detail: p });
      }
    } else {
      console.log(`\n  ✓ scenario checks passed`);
      passedChecks += 1;
    }
  }
}

console.log(`\n${"═".repeat(80)}`);
console.log(`provenance checks passing: ${passedChecks}/${totalChecks}`);
if (findings.length) {
  console.log(`\nfindings:`);
  for (const f of findings) console.log(`  - [${f.scenario}] turn ${f.turn}: ${f.detail}`);
  process.exitCode = 1;
} else {
  console.log("every provenance scenario matched its expectation.");
}
