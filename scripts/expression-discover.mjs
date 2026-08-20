/**
 * The error-discovery loop.
 *
 *   node --no-warnings --import ./scripts/ts-register.mjs scripts/expression-discover.mjs
 *   ... --verbose      print the full pipeline trace for every failure
 *   ... --only=<text>  run only scenarios whose name contains <text>
 *
 * Replays every scenario in BOTH forms (one paragraph, and the same content
 * as several settled speech segments), then answers one question per
 * failure: which layer first broke the meaning?
 *
 * It deliberately does not assert on pictures. It asserts that meaning
 * survives — entities reach the canvas, relations stay recoverable, chains
 * keep their order, negations keep their polarity — and reports the earliest
 * pipeline stage where that stopped being true. Fixing the stage it names
 * fixes a class of inputs; fixing what the canvas looks like fixes one.
 *
 * Exit code is 0 only when every scenario passes in both forms.
 */

import { MeaningDeltaSchema } from "../lib/expression/schemas.ts";
import { ExpressionSession } from "../lib/expression/pipeline.ts";
import { attributeFailure, attributeContinuity, FAILURE_CLASSES } from "../lib/expression/evaluate/attribute.ts";
import { normalizeMention } from "../lib/expression/world/apply.ts";
import { formatTrace } from "../lib/expression/trace.ts";
import { SCENARIOS, SCENARIO_CATEGORIES } from "./fixtures/expression-scenarios.mjs";

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const only = args.find((a) => a.startsWith("--only="))?.slice("--only=".length);

const findings = [];
const passes = [];

/** Runs one form of one scenario, returning every trace it produced. */
async function replay(turns) {
  const session = new ExpressionSession({ extract: async () => ({ entities: [], relations: [], claims: [], interpretation: "" }) });
  const traces = [];
  for (const [index, turn] of turns.entries()) {
    const parsed = MeaningDeltaSchema.safeParse(turn.delta);
    if (!parsed.success) {
      throw new Error(`fixture delta ${index} is invalid: ${parsed.error.issues[0]?.message} at ${parsed.error.issues[0]?.path.join(".")}`);
    }
    traces.push(
      await session.ingestDelta({ id: `t${index}`, source: "human_speech", text: turn.text, seq: index }, parsed.data),
    );
  }
  return traces;
}

function liveEntities(world) {
  return world.entities.filter((e) => e.status !== "superseded");
}

function findEntity(world, label) {
  const wanted = normalizeMention(label);
  return liveEntities(world).find((e) => normalizeMention(e.label) === wanted || e.aliases.includes(wanted));
}

/**
 * Checks the scenario-specific expectations that are not general enough to
 * live in the attributor: an attribute that had to land on an existing
 * entity, and a corrected role that had to replace the wrong one.
 */
function extraChecks(scenario, world) {
  const out = [];

  for (const [label, key, value] of scenario.attributes ?? []) {
    const entity = findEntity(world, label);
    if (!entity) {
      out.push({ failureClass: "WORLD_UPDATE", detail: `"${label}" is missing, so its ${key} could not be checked` });
      continue;
    }
    const attribute = (entity.attributes ?? []).find((a) => a.key === key);
    if (!attribute || normalizeMention(attribute.value) !== normalizeMention(value)) {
      out.push({
        failureClass: "WORLD_UPDATE",
        detail: `"${label}" should have ${key}="${value}"; has ${attribute ? `"${attribute.value}"` : "nothing"}`,
      });
    }
  }

  if (scenario.roles) {
    const { expected, retired } = scenario.roles;
    const roles = world.relations.filter((r) => r.type === "role_of").map((r) => r.role);
    if (!roles.includes(expected)) {
      out.push({ failureClass: "WORLD_UPDATE", detail: `the corrected role "${expected}" is missing (roles present: ${roles.join(", ") || "none"})` });
    }
    if (roles.includes(retired)) {
      out.push({
        failureClass: "WORLD_UPDATE",
        detail: `the retracted role "${retired}" is still asserted alongside "${expected}" — the correction added instead of replacing`,
      });
    }
  }

  return out;
}

/**
 * The two forms must converge. A pipeline that understands a paragraph but
 * drifts across four segments is broken in the only mode that ships, and
 * comparing the two final worlds is the cheapest way to see it.
 */
function compareForms(paragraphWorld, incrementalWorld) {
  const ids = (world) => new Set(liveEntities(world).map((e) => normalizeMention(e.label)));
  const p = ids(paragraphWorld);
  const i = ids(incrementalWorld);
  const onlyParagraph = [...p].filter((x) => !i.has(x));
  const onlyIncremental = [...i].filter((x) => !p.has(x));
  if (!onlyParagraph.length && !onlyIncremental.length) return null;
  return {
    failureClass: "CONTINUITY",
    detail:
      `the two forms disagree` +
      (onlyParagraph.length ? `; only in paragraph: ${onlyParagraph.join(", ")}` : "") +
      (onlyIncremental.length ? `; only in incremental: ${onlyIncremental.join(", ")}` : ""),
  };
}

/** The shared stage-by-stage view, indented to sit under its finding. */
function describeTrace(trace) {
  return formatTrace(trace)
    .split(/\r?\n/)
    .map((line) => `      ${line}`)
    .join("\n");
}

// ─────────────────────────────────────────────────────────────── run

const selected = SCENARIOS.filter((s) => !only || s.name.toLowerCase().includes(only.toLowerCase()));
console.log(`Replaying ${selected.length} scenarios across ${SCENARIO_CATEGORIES.length} categories, in two forms each.\n`);

for (const scenario of selected) {
  const forms = {};
  let crashed = false;

  for (const form of ["paragraph", "incremental"]) {
    const turns = scenario[form];
    if (!turns) continue;
    let traces;
    try {
      traces = await replay(turns);
    } catch (error) {
      findings.push({ scenario: scenario.name, form, failureClass: "MEANING_EXTRACTION", detail: String(error.message) });
      crashed = true;
      continue;
    }
    forms[form] = traces;

    const final = traces[traces.length - 1];
    const failures = [
      attributeFailure(final, scenario.expect ?? {}),
      attributeContinuity(traces),
      ...extraChecks(scenario, final.world),
    ].filter(Boolean);

    if (failures.length) {
      // One cause per form: the attributor already walked the stages in
      // order, so the first entry is the earliest one.
      const primary = failures[0];
      findings.push({ scenario: scenario.name, form, ...primary, trace: final, others: failures.slice(1) });
    } else {
      passes.push(`${scenario.name} [${form}]`);
    }
  }

  if (!crashed && forms.paragraph && forms.incremental) {
    const drift = compareForms(
      forms.paragraph[forms.paragraph.length - 1].world,
      forms.incremental[forms.incremental.length - 1].world,
    );
    if (drift) findings.push({ scenario: scenario.name, form: "convergence", ...drift });
    else passes.push(`${scenario.name} [convergence]`);
  }
}

// ──────────────────────────────────────────────────────────── report

const byClass = new Map();
for (const finding of findings) {
  byClass.set(finding.failureClass, [...(byClass.get(finding.failureClass) ?? []), finding]);
}

if (findings.length) {
  console.log(`${"═".repeat(78)}\nFAILURES BY LAYER (earliest cause only)\n${"═".repeat(78)}`);
  for (const failureClass of FAILURE_CLASSES) {
    const group = byClass.get(failureClass);
    if (!group) continue;
    console.log(`\n▼ ${failureClass}  (${group.length})`);
    for (const finding of group) {
      console.log(`   ${finding.scenario} [${finding.form}]`);
      console.log(`     ${finding.detail}`);
      for (const other of finding.others ?? []) console.log(`     · also: ${other.failureClass} — ${other.detail}`);
      for (const d of finding.downstream ?? []) console.log(`     → downstream: ${d}`);
      if (verbose && finding.trace) console.log(describeTrace(finding.trace));
    }
  }
}

console.log(`\n${"═".repeat(78)}`);
console.log(`passed ${passes.length}   failed ${findings.length}`);
if (findings.length) {
  console.log(
    `by layer: ${FAILURE_CLASSES.filter((c) => byClass.has(c)).map((c) => `${c}:${byClass.get(c).length}`).join("  ")}`,
  );
  process.exitCode = 1;
} else {
  console.log("every scenario preserved its meaning in both forms.");
}
