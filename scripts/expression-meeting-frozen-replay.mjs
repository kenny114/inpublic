/**
 * Deterministic replay of the frozen 118-turn meeting fixture
 * (scripts/fixtures/meeting-transcript-deltas-v1.mjs).
 *
 * "Deterministic" describes the INPUT, not the network: every run reads
 * back the exact same sanitized MeaningDelta per turn — the extractor never
 * runs again, so extraction's own turn-to-turn non-determinism (the
 * dominant noise source in the hardening-pass-2 live/live comparison) is
 * eliminated. The identity JUDGE, by default, still makes real model calls
 * — it is the mechanism actually being evaluated (a type-reconciliation
 * change to candidate ELIGIBILITY only matters if a judge exists to confirm
 * the newly-eligible candidates), so a fully network-free run would make
 * the effect of that change invisible: without a judge, every deferred
 * decision comes back "hold", which is only a label change, not an entity-
 * count change. Pass --no-judge for a fully offline sanity run instead
 * (useful for confirming stage-1-only behaviour, not for measuring the
 * identity layer's real effect).
 *
 *   node --no-warnings --import ./scripts/ts-register.mjs scripts/expression-meeting-frozen-replay.mjs [--no-judge] > out.txt
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { ExpressionSession } from "../lib/expression/pipeline.ts";
import { formatTrace } from "../lib/expression/trace.ts";
import { svgRenderer } from "../lib/expression/render/svg.ts";
import { isLiveEntityStatus } from "../lib/expression/schemas.ts";
import { abstainIdentityJudge } from "../lib/expression/world/identity.ts";
import { MEETING_DELTAS_V1 } from "./fixtures/meeting-transcript-deltas-v1.mjs";
import { SPEAKERS } from "./fixtures/meeting-transcript.mjs";

const noJudge = process.argv.includes("--no-judge");
if (!noJudge && !process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set — the identity judge makes real model calls. Pass --no-judge for a fully offline stage-1-only run instead.");
  process.exit(1);
}

const OUT_DIR = "scripts/fixtures/.meeting-frozen-replay-out";
mkdirSync(OUT_DIR, { recursive: true });

let identityJudge = abstainIdentityJudge;
let targetJudge;
if (!noJudge) {
  ({ defaultIdentityJudge: identityJudge } = await import("../lib/expression/world/identityJudge.ts"));
  ({ defaultTargetJudge: targetJudge } = await import("../lib/expression/world/targetJudge.ts"));
}
console.log(`identity judge: ${noJudge ? "OFF (abstain-only, fully offline)" : "ON (real model)"}`);
console.log(`target judge: ${noJudge ? "OFF (abstain-only, fully offline)" : "ON (real model)"}`);

const SNAPSHOT_MARKS = [5 * 60, 10 * 60, 20 * 60, 30 * 60];
const snapshots = [];
let nextMarkIndex = 0;

const session = new ExpressionSession({
  extract: async () => ({ entities: [], relations: [], claims: [], interpretation: "" }), // never called — every turn goes through ingestDelta
  enableIdentityLayer: true,
  identityJudge,
  ...(targetJudge ? { targetJudge } : {}),
});

const perTurn = [];
const allIdentityResolutions = [];
let cumulativeAdded = 0, cumulativeUpdated = 0, cumulativeMoved = 0, cumulativeRemoved = 0;

for (const turn of MEETING_DELTAS_V1) {
  const segment = { id: `mt-${turn.index}`, source: "human_speech", text: turn.text, seq: turn.index, speakerId: turn.speaker, timestamp: turn.t };
  const trace = await session.ingestDelta(segment, turn.delta);

  cumulativeAdded += trace.patch.added.length;
  cumulativeUpdated += trace.patch.updated.length;
  cumulativeMoved += trace.patch.moved.length;
  cumulativeRemoved += trace.patch.removed.length;
  allIdentityResolutions.push(...trace.identityResolutions);

  perTurn.push({
    index: turn.index,
    t: turn.t,
    referenceResolutions: trace.referenceResolutions,
    discourseActResolutions: trace.discourseActResolutions,
    semanticPreservation: trace.evaluation.semanticPreservation,
    sceneObjectCount: trace.scene.objects.length,
  });

  console.log(`\n[t=${Math.floor(turn.t / 60)}:${String(turn.t % 60).padStart(2, "0")}] ${SPEAKERS[turn.speaker] ?? turn.speaker}: "${turn.text}"`);
  console.log(formatTrace(trace).split(/\r?\n/).map((l) => `    ${l}`).join("\n"));

  while (nextMarkIndex < SNAPSHOT_MARKS.length && turn.t >= SNAPSHOT_MARKS[nextMarkIndex]) {
    const mark = SNAPSHOT_MARKS[nextMarkIndex];
    const svg = svgRenderer.render(trace.scene, trace.patch);
    snapshots.push({ minute: mark / 60, afterTurnIndex: turn.index, world: trace.world, scene: trace.scene });
    writeFileSync(`${OUT_DIR}/snapshot-${mark / 60}min-world.json`, JSON.stringify(trace.world, null, 2));
    writeFileSync(`${OUT_DIR}/snapshot-${mark / 60}min.svg`, svg);
    console.log(`\n  ══ SNAPSHOT @ ${mark / 60} min (after turn ${turn.index + 1}) ══`);
    nextMarkIndex += 1;
  }
}

const totalTurns = perTurn.length;
const totalReferenceMentions = perTurn.reduce((n, t) => n + t.referenceResolutions.length, 0);
const resolvedReferenceMentions = perTurn.reduce((n, t) => n + t.referenceResolutions.filter((r) => r.chosenId).length, 0);
const totalDiscourseActs = perTurn.reduce((n, t) => n + t.discourseActResolutions.length, 0);
const appliedDiscourseActs = perTurn.reduce((n, t) => n + t.discourseActResolutions.filter((d) => d.applied).length, 0);

const finalWorld = session.getWorld();
const finalLive = finalWorld.entities.filter((e) => isLiveEntityStatus(e.status));
const duplicateClusters = finalWorld.entities.filter((e) => /-[0-9]+$/.test(e.id)).length;

const preservationSeries = perTurn.map((t) => t.semanticPreservation);
const mean = preservationSeries.reduce((a, b) => a + b, 0) / preservationSeries.length;
const lastQuarter = preservationSeries.slice(-Math.ceil(preservationSeries.length / 4));
const meanLastQuarter = lastQuarter.reduce((a, b) => a + b, 0) / lastQuarter.length;

const report = {
  frozenFixtureVersion: "v1",
  identityJudge: noJudge ? "abstain (offline)" : "live model",
  totalTurns,
  finalLiveEntityCount: finalLive.length,
  finalTotalEntityCount: finalWorld.entities.length,
  duplicateClusters,
  duplicateClusterIds: finalWorld.entities.filter((e) => /-[0-9]+$/.test(e.id)).map((e) => e.id),
  referenceResolution: { total: totalReferenceMentions, resolved: resolvedReferenceMentions, rate: totalReferenceMentions ? resolvedReferenceMentions / totalReferenceMentions : null },
  discourseActs: { total: totalDiscourseActs, applied: appliedDiscourseActs, rate: totalDiscourseActs ? appliedDiscourseActs / totalDiscourseActs : null },
  canvasStability: { cumulativeAdded, cumulativeUpdated, cumulativeMoved, cumulativeRemoved },
  semanticPreservation: { mean, meanLastQuarter, first: preservationSeries[0], last: preservationSeries[preservationSeries.length - 1] },
  identitySummary: {
    totalMentions: allIdentityResolutions.length,
    creations: allIdentityResolutions.filter((r) => r.action === "create").length,
    holds: allIdentityResolutions.filter((r) => r.action === "hold").length,
    merges: allIdentityResolutions.filter((r) => r.action === "merge").length,
    judged: allIdentityResolutions.filter((r) => r.usedJudge).length,
    judgeSameEntity: allIdentityResolutions.filter((r) => r.judgeVerdict === "same_entity").length,
    judgeRelatedButDistinct: allIdentityResolutions.filter((r) => r.judgeVerdict === "related_but_distinct").length,
    judgeNewEntity: allIdentityResolutions.filter((r) => r.judgeVerdict === "new_entity").length,
    judgeUncertain: allIdentityResolutions.filter((r) => r.judgeVerdict === "uncertain").length,
    reactivations: allIdentityResolutions.filter((r) => r.reactivate).length,
  },
  allMerges: allIdentityResolutions.filter((r) => r.action === "merge").map((r) => ({ mention: r.mentionLabel, type: r.mentionType, target: r.resultingEntityId, viaJudge: r.usedJudge, reason: r.reason })),
};

writeFileSync(`${OUT_DIR}/report-${noJudge ? "offline" : "live"}.json`, JSON.stringify(report, null, 2));
console.log(`\n${"═".repeat(80)}\nMEASUREMENTS\n${"═".repeat(80)}`);
console.log(JSON.stringify(report, null, 2));
