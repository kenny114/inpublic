/**
 * The 30-minute, five-speaker synthetic meeting replay.
 *
 * This is not a pass/fail fixture. Every other scripts/expression-*-replay.mjs
 * in this repo proves ONE feature works in isolation, against hand-authored
 * or deterministic input. This script asks a different question: can one
 * evolving ExpressionSession follow a realistic, messy, 30-minute
 * conversation — interruptions, corrections, topic changes, ordinal
 * references, old-topic recall, agreement/disagreement, suspended/
 * reactivated/rejected ideas, changing metrics, hypotheticals, decisions and
 * reversals — through the REAL extractor, and end with a coherent picture of
 * what the group currently understands?
 *
 * By design this does NOT auto-fix anything it finds. It snapshots
 * WorldState / ExpressionPlan / ScenePlan / rendered SVG at the 5, 10, 20 and
 * 30 minute marks, prints the full per-turn trace log, and computes the
 * measurements the task asked for. Categorizing what went wrong is a human
 * judgment call made by reading the output, not something this script
 * decides for you.
 *
 * Requires ANTHROPIC_API_KEY. Makes ~85 real model calls — this is a
 * one-off stress test, not part of `npm test`.
 *
 *   node --no-warnings --import ./scripts/ts-register.mjs scripts/expression-meeting-stress-replay.mjs > meeting-replay-log.txt
 *
 * Pass --identity to run the SAME unmodified transcript with
 * lib/expression/world/identity.ts's two-stage identity layer turned on
 * (real model-backed judge) instead of apply.ts's plain resolveMention —
 * this is the "after" run for the identity-layer before/after comparison.
 * Output goes to a separate directory so the baseline ("before") report
 * is never overwritten.
 *
 *   node --no-warnings --import ./scripts/ts-register.mjs scripts/expression-meeting-stress-replay.mjs --identity > meeting-replay-log-identity.txt
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { ExpressionSession } from "../lib/expression/pipeline.ts";
import { extractMeaning } from "../lib/expression/meaning/extract.ts";
import { formatTrace } from "../lib/expression/trace.ts";
import { svgRenderer } from "../lib/expression/render/svg.ts";
import { isLiveEntityStatus } from "../lib/expression/schemas.ts";
import { defaultIdentityJudge } from "../lib/expression/world/identityJudge.ts";
import { MEETING_TRANSCRIPT, SPEAKERS } from "./fixtures/meeting-transcript.mjs";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set — this script makes real model calls and cannot run without it.");
  process.exit(1);
}

const useIdentityLayer = process.argv.includes("--identity");
const OUT_DIR = useIdentityLayer ? "scripts/fixtures/.meeting-replay-out-identity" : "scripts/fixtures/.meeting-replay-out";
mkdirSync(OUT_DIR, { recursive: true });
console.log(`identity layer: ${useIdentityLayer ? "ON (real judge)" : "OFF (baseline resolveMention)"}`);

const SNAPSHOT_MARKS = [5 * 60, 10 * 60, 20 * 60, 30 * 60]; // seconds
const snapshots = [];
let nextMarkIndex = 0;

const session = new ExpressionSession({
  extract: (text, recent) => extractMeaning(text, recent),
  enableIdentityLayer: useIdentityLayer,
  identityJudge: useIdentityLayer ? defaultIdentityJudge : undefined,
});

const perTurn = [];
const allIdentityResolutions = [];
let cumulativeAdded = 0;
let cumulativeUpdated = 0;
let cumulativeMoved = 0;
let cumulativeRemoved = 0;

for (const [index, turn] of MEETING_TRANSCRIPT.entries()) {
  const segment = {
    id: `mt-${index}`,
    source: "human_speech",
    text: turn.text,
    seq: index,
    speakerId: turn.speaker,
    timestamp: turn.t,
  };
  const trace = await session.ingest(segment);

  cumulativeAdded += trace.patch.added.length;
  cumulativeUpdated += trace.patch.updated.length;
  cumulativeMoved += trace.patch.moved.length;
  cumulativeRemoved += trace.patch.removed.length;
  allIdentityResolutions.push(...trace.identityResolutions);

  perTurn.push({
    index,
    t: turn.t,
    speaker: turn.speaker,
    text: turn.text,
    tags: turn.tags,
    entityCount: trace.world.entities.filter((e) => isLiveEntityStatus(e.status)).length,
    sceneObjectCount: trace.scene.objects.length,
    referenceResolutions: trace.referenceResolutions,
    discourseActResolutions: trace.discourseActResolutions,
    metricResolutions: trace.metricResolutions,
    semanticPreservation: trace.evaluation.semanticPreservation,
    changed: trace.changed,
    patch: { added: trace.patch.added.length, updated: trace.patch.updated.length, moved: trace.patch.moved.length, removed: trace.patch.removed.length },
    trace,
  });

  console.log(`\n[t=${Math.floor(turn.t / 60)}:${String(turn.t % 60).padStart(2, "0")}] ${SPEAKERS[turn.speaker]}: "${turn.text}"`);
  console.log(
    formatTrace(trace)
      .split(/\r?\n/)
      .map((l) => `    ${l}`)
      .join("\n"),
  );

  // Snapshot when this turn's timestamp crosses the next mark.
  while (nextMarkIndex < SNAPSHOT_MARKS.length && turn.t >= SNAPSHOT_MARKS[nextMarkIndex]) {
    const mark = SNAPSHOT_MARKS[nextMarkIndex];
    const svg = svgRenderer.render(trace.scene, trace.patch);
    const snapshot = {
      minute: mark / 60,
      afterTurnIndex: index,
      world: trace.world,
      plan: trace.plan,
      scene: trace.scene,
      svg,
    };
    snapshots.push(snapshot);
    writeFileSync(`${OUT_DIR}/snapshot-${mark / 60}min-world.json`, JSON.stringify(trace.world, null, 2));
    writeFileSync(`${OUT_DIR}/snapshot-${mark / 60}min-plan.json`, JSON.stringify(trace.plan, null, 2));
    writeFileSync(`${OUT_DIR}/snapshot-${mark / 60}min-scene.json`, JSON.stringify(trace.scene, null, 2));
    writeFileSync(`${OUT_DIR}/snapshot-${mark / 60}min.svg`, svg);
    console.log(`\n  ══ SNAPSHOT @ ${mark / 60} min (after turn ${index + 1}) written to ${OUT_DIR}/snapshot-${mark / 60}min-* ══`);
    nextMarkIndex += 1;
  }
}

// ---- measurements ----------------------------------------------------

const totalTurns = perTurn.length;
const totalReferenceMentions = perTurn.reduce((n, t) => n + t.referenceResolutions.length, 0);
const resolvedReferenceMentions = perTurn.reduce((n, t) => n + t.referenceResolutions.filter((r) => r.chosenId).length, 0);
const highConfidenceReferenceMentions = perTurn.reduce((n, t) => n + t.referenceResolutions.filter((r) => r.chosenId && r.confidence !== "low").length, 0);

const totalDiscourseActs = perTurn.reduce((n, t) => n + t.discourseActResolutions.length, 0);
const appliedDiscourseActs = perTurn.reduce((n, t) => n + t.discourseActResolutions.filter((d) => d.applied).length, 0);

const finalWorld = perTurn[perTurn.length - 1].trace.world;
const finalLive = finalWorld.entities.filter((e) => isLiveEntityStatus(e.status));

const snapshotSummaries = snapshots.map((s) => ({
  minute: s.minute,
  liveEntities: s.world.entities.filter((e) => isLiveEntityStatus(e.status)).length,
  totalEntitiesEverCreated: s.world.entities.length,
  sceneObjects: s.scene.objects.length,
  speechSegmentsSoFar: s.afterTurnIndex + 1,
}));

// Numeric-suffix collision signature — apply.ts's uniqueId appends "-2",
// "-3"... when the SAME slug is minted twice, which only happens when
// identity resolution failed to recognise an exact-label re-mention as the
// same thing. A cheap, objective proxy for "how much outright duplication
// happened", comparable before/after without re-reading the whole log.
const duplicateClusters = finalWorld.entities.filter((e) => /-[0-9]+$/.test(e.id)).length;

const preservationSeries = perTurn.map((t) => t.semanticPreservation);
const meanPreservation = preservationSeries.reduce((a, b) => a + b, 0) / preservationSeries.length;
const lastQuarter = preservationSeries.slice(-Math.ceil(preservationSeries.length / 4));
const meanPreservationLastQuarter = lastQuarter.reduce((a, b) => a + b, 0) / lastQuarter.length;

const identitySummary = useIdentityLayer
  ? {
      totalMentions: allIdentityResolutions.length,
      creations: allIdentityResolutions.filter((r) => r.action === "create").length,
      reuses: allIdentityResolutions.filter((r) => r.action === "merge").length,
      judged: allIdentityResolutions.filter((r) => r.usedJudge).length,
      judgeSameEntity: allIdentityResolutions.filter((r) => r.judgeVerdict === "same_entity").length,
      judgeRelatedButDistinct: allIdentityResolutions.filter((r) => r.judgeVerdict === "related_but_distinct").length,
      judgeNewEntity: allIdentityResolutions.filter((r) => r.judgeVerdict === "new_entity").length,
      judgeUncertain: allIdentityResolutions.filter((r) => r.judgeVerdict === "uncertain").length,
    }
  : null;

const report = {
  identityLayer: useIdentityLayer,
  totalTurns,
  totalMinutesCovered: MEETING_TRANSCRIPT[MEETING_TRANSCRIPT.length - 1].t / 60,
  finalLiveEntityCount: finalLive.length,
  finalTotalEntityCount: finalWorld.entities.length,
  duplicateClusters,
  finalSceneObjectCount: perTurn[perTurn.length - 1].sceneObjectCount,
  referenceResolution: {
    total: totalReferenceMentions,
    resolved: resolvedReferenceMentions,
    highConfidence: highConfidenceReferenceMentions,
    resolutionRate: totalReferenceMentions ? resolvedReferenceMentions / totalReferenceMentions : null,
  },
  discourseActs: {
    total: totalDiscourseActs,
    applied: appliedDiscourseActs,
    applicationRate: totalDiscourseActs ? appliedDiscourseActs / totalDiscourseActs : null,
  },
  canvasStability: {
    cumulativeAdded,
    cumulativeUpdated,
    cumulativeMoved,
    cumulativeRemoved,
    movedPerTurn: cumulativeMoved / totalTurns,
  },
  semanticPreservation: {
    mean: meanPreservation,
    meanLastQuarter: meanPreservationLastQuarter,
    first: preservationSeries[0],
    last: preservationSeries[preservationSeries.length - 1],
  },
  identitySummary,
  visibleConceptVsSpeechRatio: snapshotSummaries.map((s) => ({ minute: s.minute, sceneObjects: s.sceneObjects, speechSegments: s.speechSegmentsSoFar, ratio: s.sceneObjects / s.speechSegmentsSoFar })),
  snapshotSummaries,
};

writeFileSync(`${OUT_DIR}/report.json`, JSON.stringify(report, null, 2));

console.log(`\n${"═".repeat(80)}`);
console.log("MEASUREMENTS");
console.log("═".repeat(80));
console.log(JSON.stringify(report, null, 2));
console.log(`\nFull snapshots and this report were written to ${OUT_DIR}/`);
console.log("This script does not judge correctness — read the per-turn trace log above against scripts/fixtures/meeting-transcript.mjs's own tags to categorize failures.");
