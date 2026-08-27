/**
 * Replays the three "critical test conversation" fixtures from the InPublic
 * V1 spec against the CURRENT lib/expression/ engine, turn by turn, and
 * reports which turns already meet their expectation and which don't.
 *
 * This is deliberately NOT asserting the engine should be rewritten to pass
 * everything — it's a baseline: which parts of the spec's critical
 * conversation the existing world model / composer already gets right
 * without any new code, and which parts need new work.
 *
 * It also probes one specific architectural question the spec cares about:
 * whether a `confidence: "low"` entity (the closest thing the current
 * schema has to "hypothetical") gets ANY distinguishing visual treatment on
 * the scene, since the composer is where that would have to happen.
 *
 *   node --no-warnings --import ./scripts/ts-register.mjs scripts/expression-critical-replay.mjs
 *   ... --verbose   print the full pipeline trace after every turn
 */

import { MeaningDeltaSchema } from "../lib/expression/schemas.ts";
import { ExpressionSession } from "../lib/expression/pipeline.ts";
import { attributeFailure } from "../lib/expression/evaluate/attribute.ts";
import { normalizeMention } from "../lib/expression/world/apply.ts";
import { formatTrace } from "../lib/expression/trace.ts";
import { CRITICAL_SCENARIOS } from "./fixtures/critical-scenarios.mjs";

const verbose = process.argv.includes("--verbose");

function liveEntities(world) {
  return world.entities.filter((e) => e.status !== "superseded");
}

function findEntity(world, label) {
  const wanted = normalizeMention(label);
  return liveEntities(world).find((e) => normalizeMention(e.label) === wanted || e.aliases.includes(wanted));
}

function checkAttributes(scenario, world) {
  const out = [];
  for (const [label, key, value] of scenario.attributes ?? []) {
    const entity = findEntity(world, label);
    if (!entity) {
      out.push(`"${label}" is missing, so its ${key} could not be checked`);
      continue;
    }
    const attribute = (entity.attributes ?? []).find((a) => a.key === key);
    if (!attribute || normalizeMention(attribute.value) !== normalizeMention(value)) {
      out.push(`"${label}" should have ${key}="${value}"; has ${attribute ? `"${attribute.value}"` : "nothing"}`);
    }
  }
  return out;
}

/** Does a low-confidence entity's scene object actually carry the `tentative` flag? */
function hypotheticalTreatmentGap(trace) {
  const lowConfidenceIds = new Set(
    trace.world.entities.filter((e) => e.confidence === "low" && e.status !== "superseded").map((e) => e.id),
  );
  if (!lowConfidenceIds.size) return null;
  const objects = trace.scene.objects.filter((o) => lowConfidenceIds.has(o.entityId));
  const untagged = objects.filter((o) => o.tentative !== true);
  if (!untagged.length) return null;
  return `${untagged.length}/${objects.length} low-confidence scene object(s) are not marked tentative: ${untagged.map((o) => o.id).join(", ")}`;
}

let totalTurns = 0;
let passedTurns = 0;
const findings = [];

for (const scenario of CRITICAL_SCENARIOS) {
  console.log(`\n${"─".repeat(78)}\n${scenario.name}\n${"─".repeat(78)}`);
  const session = new ExpressionSession({ extract: async () => ({ entities: [], relations: [], claims: [], interpretation: "" }) });
  let final = null;

  for (const [index, turn] of scenario.turns.entries()) {
    totalTurns += 1;
    const parsed = MeaningDeltaSchema.safeParse(turn.delta);
    if (!parsed.success) {
      console.log(`  turn ${index + 1}: INVALID FIXTURE — ${parsed.error.issues[0]?.message} at ${parsed.error.issues[0]?.path.join(".")}`);
      continue;
    }
    const trace = await session.ingestDelta({ id: `t${index}`, source: "human_speech", text: turn.text, seq: index }, parsed.data);
    final = trace;

    console.log(`\n  turn ${index + 1}: "${turn.text}"`);
    if (verbose) {
      console.log(
        formatTrace(trace)
          .split(/\r?\n/)
          .map((l) => `      ${l}`)
          .join("\n"),
      );
    }

    const expect = scenario.expectByTurn?.[index];
    if (expect) {
      const failure = attributeFailure(trace, expect);
      if (failure) {
        console.log(`    ✗ ${failure.failureClass}: ${failure.detail}`);
        findings.push({ scenario: scenario.name, turn: index + 1, ...failure });
      } else {
        console.log(`    ✓ meets expectation`);
        passedTurns += 1;
      }
    } else {
      passedTurns += 1;
    }

    const gap = hypotheticalTreatmentGap(trace);
    if (gap) console.log(`    ⚠ hypothetical/tentative gap: ${gap}`);
  }

  if (final) {
    const attrProblems = checkAttributes(scenario, final.world);
    for (const problem of attrProblems) {
      console.log(`\n  final: ✗ ${problem}`);
      findings.push({ scenario: scenario.name, turn: "final", failureClass: "WORLD_UPDATE", detail: problem });
    }
  }
}

console.log(`\n${"═".repeat(78)}`);
console.log(`turns meeting their per-turn expectation: ${passedTurns}/${totalTurns}`);
if (findings.length) {
  console.log(`\nfindings:`);
  for (const f of findings) console.log(`  - [${scenario_label(f)}] turn ${f.turn} (${f.failureClass}): ${f.detail}`);
  process.exitCode = 1;
} else {
  console.log("every per-turn expectation held.");
}

function scenario_label(f) {
  return f.scenario;
}
