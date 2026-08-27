/**
 * Deterministic visibility / salience / compression audit of the frozen
 * 118-turn meeting. Measurement only — no policy changes live here.
 *
 * Replays the same sanitized deltas as expression-meeting-frozen-replay.mjs.
 * Identity merges that originally required the live judge are replayed from
 * the recorded AFTER-target report so the world matches the 0-duplicate,
 * 75% reference, 100% lifecycle baseline without a network call.
 *
 *   node --no-warnings --import ./scripts/ts-register.mjs scripts/expression-visibility-audit.mjs
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { ExpressionSession } from "../lib/expression/pipeline.ts";
import { isLiveEntityStatus } from "../lib/expression/schemas.ts";
import { svgRenderer } from "../lib/expression/render/svg.ts";
import { MEETING_DELTAS_V1 } from "./fixtures/meeting-transcript-deltas-v1.mjs";
import { SPEAKERS } from "./fixtures/meeting-transcript.mjs";

const OUT_DIR = "scripts/fixtures/.visibility-audit-out";
mkdirSync(OUT_DIR, { recursive: true });

const REPORT_PATHS = [
  "scripts/fixtures/.meeting-frozen-replay-out/report-AFTER-target.json",
  "scripts/fixtures/.meeting-frozen-replay-out/report-live.json",
];
const reportPath = REPORT_PATHS.find((p) => existsSync(p));
if (!reportPath) {
  console.error("No frozen identity report found. Run expression-meeting-frozen-replay.mjs first.");
  process.exit(1);
}
const recorded = JSON.parse(readFileSync(reportPath, "utf8"));
const merges = (recorded.allMerges ?? []).map((m) => ({ ...m, used: false }));

const recordedIdentityJudge = async (mention, candidates) => {
  const hit = merges.find((m) => !m.used && m.viaJudge && m.mention === mention.label && m.type === mention.type);
  if (hit) {
    hit.used = true;
    const idx = candidates.findIndex((c) => c.id === hit.target);
    if (idx >= 0) return { index: idx, verdict: "same_entity", reason: `recorded merge -> ${hit.target}` };
    const byLabel = candidates.findIndex((c) => c.label.toLowerCase() === String(hit.target).replace(/-/g, " "));
    if (byLabel >= 0) return { index: byLabel, verdict: "same_entity", reason: `recorded merge by label -> ${hit.target}` };
    return { index: null, verdict: "new_entity", reason: `recorded target ${hit.target} not in candidate list` };
  }
  return { index: null, verdict: "new_entity", reason: "recorded create/hold" };
};

const SNAPSHOT_MARKS = [5 * 60, 10 * 60, 20 * 60, 30 * 60];
const STALE_AGE_TURNS = 12;

/**
 * Semantically important concepts the group should still understand at each
 * snapshot, derived from the meeting transcript (not from whatever the
 * board currently shows). `persist` means the concept is a current
 * decision / active problem / active goal / unresolved question and should
 * remain visually available. `collapse` means a supporting detail of a
 * resolved branch that should recede once the conclusion is in place.
 */
const EXPECTED = {
  "5min": [
    { key: "fix-step-four", aliases: ["fix step four", "step-four fix", "step four fix"], role: "decision", persist: true },
    { key: "rebuild", aliases: ["rebuild onboarding from scratch", "full rebuild", "rebuild"], role: "historical", persist: false, archivedLikely: true },
    { key: "drop-off", aliases: ["biggest drop-off point", "step four", "seven-step signup"], role: "problem", persist: true },
    { key: "email-verification", aliases: ["email verification step", "email verification"], role: "supporting", persist: true },
    { key: "mocks-thursday", aliases: ["mocks", "thursday"], role: "goal", persist: true },
    { key: "race-condition", aliases: ["race condition", "sends the code twice"], role: "supporting", persist: false, collapse: true },
    { key: "six-weeks", aliases: ["six weeks", "august"], role: "historical", persist: false, collapse: true },
  ],
  "10min": [
    { key: "fix-step-four", aliases: ["fix step four", "step-four fix"], role: "decision", persist: true },
    { key: "rebuild-conditional", aliases: ["rebuild onboarding from scratch", "full rebuild", "rebuild"], role: "historical", persist: false, archivedLikely: true },
    { key: "activation", aliases: ["activation", "activation rate"], role: "problem", persist: true },
    { key: "activation-target", aliases: ["45%", "activation target"], role: "goal", persist: true },
    { key: "signups", aliases: ["signups", "1,200", "1200"], role: "supporting", persist: false },
    { key: "blog-post", aliases: ["blog post"], role: "supporting", persist: false, collapse: true },
    { key: "churn", aliases: ["churn"], role: "contextual", persist: false },
    { key: "email-verification", aliases: ["email verification step", "email verification"], role: "supporting", persist: true },
    { key: "the-number", aliases: ["the number"], role: "contextual", persist: false, collapse: true },
  ],
  "20min": [
    { key: "fix-step-four", aliases: ["fix step four", "step-four fix"], role: "decision", persist: true },
    { key: "fifteen-tier", aliases: ["$15 tier", "15 tier", "$15 a month"], role: "decision", persist: true },
    { key: "free-tier", aliases: ["free tier"], role: "decision", persist: true },
    { key: "remove-free-tier", aliases: ["revisit the free tier", "removing the free tier", "got rid of it"], role: "historical", persist: false, archivedLikely: true },
    { key: "usage-based", aliases: ["usage-based billing", "usage-based pricing"], role: "historical", persist: false, archivedLikely: true },
    { key: "incident", aliases: ["incident from last week", "billing charged", "p0", "retry bug"], role: "problem", persist: true },
    { key: "incident-fix", aliases: ["full fix", "retry logic", "real timeline"], role: "decision", persist: true },
    { key: "friday-ship", aliases: ["friday", "ship friday"], role: "historical", persist: false, collapse: true },
    { key: "affected-customers", aliases: ["affected customers", "draft that email"], role: "decision", persist: true },
    { key: "activation", aliases: ["activation", "activation rate"], role: "problem", persist: true },
    { key: "rebuild", aliases: ["rebuild onboarding from scratch", "full rebuild"], role: "historical", persist: false, archivedLikely: true },
    { key: "q4-planning", aliases: ["q4 planning"], role: "goal", persist: true },
  ],
  final: [
    { key: "fix-step-four", aliases: ["fix step four", "step-four fix"], role: "decision", persist: true },
    { key: "mocks-thursday", aliases: ["mocks", "thursday"], role: "goal", persist: true },
    { key: "fifteen-tier", aliases: ["$15 tier", "15 tier"], role: "decision", persist: true },
    { key: "free-tier", aliases: ["free tier"], role: "decision", persist: true },
    { key: "usage-based", aliases: ["usage-based billing", "usage-based pricing"], role: "historical", persist: false, archivedLikely: true },
    { key: "incident-fix", aliases: ["real timeline", "retry logic", "incident timeline"], role: "decision", persist: true },
    { key: "affected-customers", aliases: ["affected customers"], role: "decision", persist: true },
    { key: "growth-marketer", aliases: ["growth marketer role", "growth marketer"], role: "decision", persist: true },
    { key: "design-headcount", aliases: ["second headcount", "design headcount"], role: "historical", persist: false, archivedLikely: true },
    { key: "activation-40", aliases: ["activation", "40%", "activation target"], role: "goal", persist: true },
    { key: "rebuild-conditional", aliases: ["rebuild onboarding from scratch", "full rebuild", "revisit the rebuild"], role: "contextual", persist: true },
    { key: "nps-survey", aliases: ["nps", "nps survey"], role: "goal", persist: true },
    { key: "dana", aliases: ["dana"], role: "supporting", persist: false },
  ],
};

function norm(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s) {
  return norm(s).split(" ").filter((t) => t.length > 1);
}

function overlap(a, b) {
  const ta = new Set(tokens(a));
  const tb = tokens(b);
  if (!ta.size || !tb.length) return 0;
  let hit = 0;
  for (const t of tb) if (ta.has(t)) hit += 1;
  return hit / Math.max(tb.length, 1);
}

function entityHaystack(entity) {
  return [entity.id, entity.label, ...(entity.aliases ?? []), entity.description ?? ""].map(norm).join(" | ");
}

function matchExpected(world, expected) {
  let best = null;
  let bestScore = 0;
  for (const entity of world.entities) {
    const hay = entityHaystack(entity);
    for (const alias of expected.aliases) {
      const exact = hay.includes(norm(alias)) || norm(entity.label) === norm(alias) || entity.id === expected.key;
      const score = exact ? 1 : overlap(hay, alias);
      if (score > bestScore) {
        bestScore = score;
        best = entity;
      }
    }
  }
  if (bestScore < 0.5) return null;
  return best;
}

function visibleEntityIds(scene) {
  return [...new Set(scene.objects.map((o) => o.entityId).filter(Boolean))];
}

function planEntityIds(plan) {
  return [...new Set(plan.regions.map((r) => r.entityId).filter(Boolean))];
}

function classifyConcept({ expected, entity, world, plan, scene, seq }) {
  if (!entity) {
    return { class: "extraction-absent", note: "not a visibility failure — concept never entered the world" };
  }
  const live = isLiveEntityStatus(entity.status);
  const archived = !live;
  const planned = planEntityIds(plan).includes(entity.id);
  const visible = visibleEntityIds(scene).includes(entity.id);
  const importance = entity.importance;
  const age = seq - entity.lastTouchedSeq;
  const inSalience = (world.salience ?? []).includes(entity.id);

  if (expected.persist && live && importance === "detail") {
    return { class: "correct in world but incorrectly low importance", planned, visible, inSalience, age };
  }
  if ((expected.role === "historical" || expected.archivedLikely || archived) && (importance === "primary" || importance === "supporting") && live) {
    const extra = visible ? "; historical/rejected content remained visually competitive" : "";
    return { class: `stale concept incorrectly high importance${extra}`, planned, visible, inSalience, age };
  }
  if (archived && visible) {
    return { class: "historical/rejected content remained visually competitive", planned, visible, inSalience, age };
  }
  if (expected.persist && live && !planned && !visible) {
    return { class: "expression planner omitted an important concept", planned, visible, inSalience, age, importance };
  }
  if (expected.persist && live && planned && !visible) {
    return { class: "scene budget displaced an important concept", planned, visible, inSalience, age, importance };
  }
  if (expected.persist && live && !visible) {
    return { class: "current decision/problem/goal failed to persist", planned, visible, inSalience, age, importance };
  }
  if (expected.collapse && visible) {
    return { class: "supporting detail failed to collapse after a conclusion", planned, visible, inSalience, age, importance };
  }
  if (expected.role === "historical" && visible) {
    return { class: "historical/rejected content remained visually competitive", planned, visible, inSalience, age };
  }
  if (expected.persist && visible) {
    return { class: "ok-visible", planned, visible, inSalience, age, importance };
  }
  if (!expected.persist && !visible) {
    return { class: "ok-hidden", planned, visible, inSalience, age, importance };
  }
  return { class: "ok-other", planned, visible, inSalience, age, importance };
}

function isStaleVisible(entity, seq) {
  if (!entity) return false;
  if (!isLiveEntityStatus(entity.status)) return true;
  if (seq - entity.lastTouchedSeq >= STALE_AGE_TURNS && entity.importance !== "primary") return true;
  return false;
}

function isPersistKind(entity, world) {
  if (!entity || !isLiveEntityStatus(entity.status)) return false;
  if (entity.importance === "primary") return true;
  if (entity.metric?.target) return true;
  const claims = world.claims.filter((c) => (c.about ?? []).includes(entity.id) && !c.invalidated);
  const text = claims.map((c) => c.text.toLowerCase()).join(" ");
  if (/\b(decision|decided|ship|reopen|target|problem|fix|goal)\b/.test(text)) return true;
  return false;
}

const session = new ExpressionSession({
  extract: async () => ({ entities: [], relations: [], claims: [], interpretation: "" }),
  enableIdentityLayer: true,
  identityJudge: recordedIdentityJudge,
});

const perTurn = [];
const snapshots = [];
let nextMarkIndex = 0;
let prevVisible = new Set();
let prevFocus = null;
let persistSeen = new Map();
let lastTrace = null;

for (const turn of MEETING_DELTAS_V1) {
  const segment = {
    id: `mt-${turn.index}`,
    source: "human_speech",
    text: turn.text,
    seq: turn.index,
    speakerId: turn.speaker,
    timestamp: turn.t,
  };
  const trace = await session.ingestDelta(segment, turn.delta);
  lastTrace = trace;
  const world = trace.world;
  const live = world.entities.filter((e) => isLiveEntityStatus(e.status));
  const visibleIds = visibleEntityIds(trace.scene);
  const visibleSet = new Set(visibleIds);
  const added = visibleIds.filter((id) => !prevVisible.has(id));
  const removed = [...prevVisible].filter((id) => !visibleSet.has(id));
  const retained = visibleIds.filter((id) => prevVisible.has(id));
  const retention = prevVisible.size ? retained.length / prevVisible.size : 1;
  const focus = trace.plan.focusEntityId ?? trace.intent.focusEntityId ?? live.find((e) => e.importance === "primary")?.id ?? null;
  const focusChanged = prevFocus !== null && focus !== prevFocus;
  const staleVisible = visibleIds.filter((id) => isStaleVisible(world.entities.find((e) => e.id === id), world.seq));
  const importantHidden = live.filter((e) => e.importance !== "detail" && !visibleSet.has(e.id));

  for (const entity of live) {
    if (isPersistKind(entity, world)) {
      const rec = persistSeen.get(entity.id) ?? { firstSeq: world.seq, visibleTurns: 0, totalTurns: 0 };
      rec.totalTurns += 1;
      if (visibleSet.has(entity.id)) rec.visibleTurns += 1;
      rec.lastSeq = world.seq;
      persistSeen.set(entity.id, rec);
    }
  }

  const row = {
    index: turn.index,
    t: turn.t,
    speaker: turn.speaker,
    worldEntityCount: world.entities.length,
    liveEntityCount: live.length,
    visibleObjectCount: trace.scene.objects.length,
    visibleEntityCount: visibleIds.length,
    visibleEntityIds: visibleIds,
    visibleLabels: trace.scene.objects.map((o) => o.label).filter(Boolean),
    planEntityIds: planEntityIds(trace.plan),
    planGrammar: trace.plan.grammar,
    intent: trace.intent.primary,
    focusEntityId: focus,
    focusChanged,
    primaryId: live.find((e) => e.importance === "primary")?.id ?? null,
    primaryLabel: live.find((e) => e.importance === "primary")?.label ?? null,
    salience: world.salience ?? [],
    added,
    removed,
    retainedCount: retained.length,
    retention,
    staleVisibleCount: staleVisible.length,
    staleVisibleIds: staleVisible,
    importantButHiddenCount: importantHidden.length,
    importantButHiddenIds: importantHidden.map((e) => e.id),
    semanticPreservation: trace.evaluation.semanticPreservation,
    patch: {
      added: trace.patch.added.length,
      updated: trace.patch.updated.length,
      moved: trace.patch.moved.length,
      removed: trace.patch.removed.length,
    },
  };
  perTurn.push(row);
  prevVisible = visibleSet;
  prevFocus = focus;

  const crossed = [];
  while (nextMarkIndex < SNAPSHOT_MARKS.length && turn.t >= SNAPSHOT_MARKS[nextMarkIndex]) {
    crossed.push(SNAPSHOT_MARKS[nextMarkIndex]);
    nextMarkIndex += 1;
  }
  if (crossed.length) {
    const mark = crossed[crossed.length - 1];
    const name = `${mark / 60}min`;
    snapshots.push({ name, afterTurnIndex: turn.index, t: turn.t, trace, row });
    writeFileSync(`${OUT_DIR}/snapshot-${name}-world.json`, JSON.stringify(world, null, 2));
    writeFileSync(`${OUT_DIR}/snapshot-${name}.svg`, svgRenderer.render(trace.scene, trace.patch));
  }
}

const finalTraceTurn = MEETING_DELTAS_V1[MEETING_DELTAS_V1.length - 1];
const finalSessionWorld = session.getWorld();
const finalTurn = perTurn[perTurn.length - 1];
if (!snapshots.some((s) => s.name === "final")) {
  snapshots.push({
    name: "final",
    afterTurnIndex: finalTraceTurn.index,
    t: finalTraceTurn.t,
    trace: lastTrace,
    row: finalTurn,
    world: finalSessionWorld,
  });
}

const snapshotReports = [];
for (const snap of snapshots) {
  const key = snap.name === "30min" ? "final" : snap.name;
  const expected = EXPECTED[key] ?? EXPECTED.final;
  const world = snap.trace?.world ?? snap.world;
  const plan = snap.trace?.plan ?? { regions: [], grammar: "unknown", reason: "no plan on final marker" };
  const scene = snap.trace?.scene ?? { objects: [] };
  const seq = world.seq;
  const live = world.entities.filter((e) => isLiveEntityStatus(e.status));
  const visibleIds = visibleEntityIds(scene).length ? visibleEntityIds(scene) : snap.row.visibleEntityIds;
  const plannedIds = planEntityIds(plan).length ? planEntityIds(plan) : snap.row.planEntityIds;

  const concepts = expected.map((exp) => {
    const entity = matchExpected(world, exp);
    const classification = classifyConcept({ expected: exp, entity, world, plan: { regions: plannedIds.map((id) => ({ entityId: id })) }, scene: { objects: visibleIds.map((id) => ({ entityId: id })) }, seq });
    return {
      key: exp.key,
      role: exp.role,
      persist: exp.persist,
      collapse: !!exp.collapse,
      matched: entity
        ? { id: entity.id, label: entity.label, type: entity.type, status: entity.status, importance: entity.importance, lastTouchedSeq: entity.lastTouchedSeq, firstSeenSeq: entity.firstSeenSeq }
        : null,
      inSalience: entity ? (world.salience ?? []).includes(entity.id) : false,
      inPlan: entity ? plannedIds.includes(entity.id) : false,
      inScene: entity ? visibleIds.includes(entity.id) : false,
      classification: classification.class,
      detail: classification,
    };
  });

  const chain = {
    worldEntities: live.map((e) => ({
      id: e.id,
      label: e.label,
      type: e.type,
      status: e.status,
      importance: e.importance,
      lastTouchedSeq: e.lastTouchedSeq,
      degree: world.relations.filter((r) => r.source === e.id || r.target === e.id).length,
    })),
    archivedEntities: world.entities.filter((e) => !isLiveEntityStatus(e.status)).map((e) => ({
      id: e.id,
      label: e.label,
      status: e.status,
      importance: e.importance,
    })),
    salience: world.salience ?? [],
    primary: live.find((e) => e.importance === "primary") ?? null,
    supporting: live.filter((e) => e.importance === "supporting").map((e) => e.id),
    intent: snap.trace?.intent?.primary ?? snap.row.intent,
    focusEntityId: snap.trace?.plan?.focusEntityId ?? snap.row.focusEntityId,
    grammar: snap.trace?.plan?.grammar ?? snap.row.planGrammar,
    planReason: snap.trace?.plan?.reason ?? null,
    planRegions: (snap.trace?.plan?.regions ?? []).map((r) => ({ id: r.id, role: r.role, entityId: r.entityId, claimId: r.claimId })),
    sceneObjects: (snap.trace?.scene?.objects ?? []).map((o) => ({ id: o.id, entityId: o.entityId, label: o.label, primitive: o.primitive, weight: o.weight })),
    visibleLabels: snap.row.visibleLabels,
  };

  const speechTurns = snap.row.index + 1;
  snapshotReports.push({
    name: snap.name,
    afterTurnIndex: snap.afterTurnIndex,
    t: snap.t,
    measurements: {
      worldEntityCount: world.entities.length,
      liveEntityCount: live.length,
      visibleObjectCount: snap.row.visibleObjectCount,
      visibleEntityCount: visibleIds.length,
      compression: {
        speechTurns,
        semanticEntities: world.entities.length,
        liveEntities: live.length,
        visibleObjects: snap.row.visibleObjectCount,
        speechToEntity: world.entities.length / speechTurns,
        entityToVisible: live.length ? snap.row.visibleObjectCount / live.length : 0,
        speechToVisible: snap.row.visibleObjectCount / speechTurns,
      },
    },
    chain,
    concepts,
  });

  if (snap.name === "final") {
    writeFileSync(`${OUT_DIR}/snapshot-final-world.json`, JSON.stringify(world, null, 2));
    if (snap.trace) writeFileSync(`${OUT_DIR}/snapshot-final.svg`, svgRenderer.render(snap.trace.scene, snap.trace.patch));
  }
}

const churnWindow = (start, end) => {
  const slice = perTurn.slice(start, end);
  if (!slice.length) return null;
  const focusChanges = slice.filter((t) => t.focusChanged).length;
  const meanRetention = slice.reduce((a, t) => a + t.retention, 0) / slice.length;
  const meanAdded = slice.reduce((a, t) => a + t.added.length, 0) / slice.length;
  const meanRemoved = slice.reduce((a, t) => a + t.removed.length, 0) / slice.length;
  const highChurn = slice.filter((t) => t.added.length + t.removed.length >= 4).length;
  return { turns: slice.length, focusChanges, meanRetention, meanAdded, meanRemoved, highChurnTurns: highChurn };
};

const persistRetention = [...persistSeen.entries()].map(([id, rec]) => ({
  id,
  label: finalSessionWorld.entities.find((e) => e.id === id)?.label,
  status: finalSessionWorld.entities.find((e) => e.id === id)?.status,
  visibleRatio: rec.totalTurns ? rec.visibleTurns / rec.totalTurns : 0,
  visibleTurns: rec.visibleTurns,
  totalTurns: rec.totalTurns,
}));

const failureCounts = {};
for (const snap of snapshotReports) {
  for (const c of snap.concepts) {
    failureCounts[c.classification] = (failureCounts[c.classification] ?? 0) + 1;
  }
}

const nearbyChurn = perTurn.filter((t, i) => i > 0 && t.added.length + t.removed.length >= 4).map((t) => ({
  index: t.index,
  t: t.t,
  added: t.added,
  removed: t.removed,
  focus: t.focusEntityId,
  primary: t.primaryLabel,
}));

const report = {
  frozenFixtureVersion: "v1",
  identitySource: reportPath,
  duplicateClusters: finalSessionWorld.entities.filter((e) => /-[0-9]+$/.test(e.id)).map((e) => e.id),
  finalWorldEntityCount: finalSessionWorld.entities.length,
  finalLiveEntityCount: finalSessionWorld.entities.filter((e) => isLiveEntityStatus(e.status)).length,
  measurements: {
    worldEntityCount: {
      first: perTurn[0].worldEntityCount,
      at5: snapshotReports.find((s) => s.name === "5min")?.measurements.worldEntityCount,
      at10: snapshotReports.find((s) => s.name === "10min")?.measurements.worldEntityCount,
      at20: snapshotReports.find((s) => s.name === "20min")?.measurements.worldEntityCount,
      final: finalSessionWorld.entities.length,
    },
    liveEntityCount: {
      first: perTurn[0].liveEntityCount,
      at5: snapshotReports.find((s) => s.name === "5min")?.measurements.liveEntityCount,
      at10: snapshotReports.find((s) => s.name === "10min")?.measurements.liveEntityCount,
      at20: snapshotReports.find((s) => s.name === "20min")?.measurements.liveEntityCount,
      final: finalSessionWorld.entities.filter((e) => isLiveEntityStatus(e.status)).length,
    },
    visibleObjectCount: {
      first: perTurn[0].visibleObjectCount,
      at5: snapshotReports.find((s) => s.name === "5min")?.measurements.visibleObjectCount,
      at10: snapshotReports.find((s) => s.name === "10min")?.measurements.visibleObjectCount,
      at20: snapshotReports.find((s) => s.name === "20min")?.measurements.visibleObjectCount,
      final: perTurn[perTurn.length - 1].visibleObjectCount,
      mean: perTurn.reduce((a, t) => a + t.visibleObjectCount, 0) / perTurn.length,
    },
    visibleObjectRetention: {
      mean: perTurn.reduce((a, t) => a + t.retention, 0) / perTurn.length,
      lastQuarter: perTurn.slice(-30).reduce((a, t) => a + t.retention, 0) / Math.min(30, perTurn.length),
    },
    additionsRemovalsPerTurn: {
      meanAdded: perTurn.reduce((a, t) => a + t.added.length, 0) / perTurn.length,
      meanRemoved: perTurn.reduce((a, t) => a + t.removed.length, 0) / perTurn.length,
      canvasPatchAdded: perTurn.reduce((a, t) => a + t.patch.added, 0),
      canvasPatchRemoved: perTurn.reduce((a, t) => a + t.patch.removed, 0),
      canvasPatchMoved: perTurn.reduce((a, t) => a + t.patch.moved, 0),
    },
    primaryFocusChanges: perTurn.filter((t) => t.focusChanged).length,
    staleVisible: {
      mean: perTurn.reduce((a, t) => a + t.staleVisibleCount, 0) / perTurn.length,
      final: perTurn[perTurn.length - 1].staleVisibleCount,
      at20: snapshotReports.find((s) => s.name === "20min") ? perTurn.find((t) => t.index === snapshotReports.find((s) => s.name === "20min").afterTurnIndex)?.staleVisibleCount : null,
    },
    importantButHidden: {
      mean: perTurn.reduce((a, t) => a + t.importantButHiddenCount, 0) / perTurn.length,
      final: perTurn[perTurn.length - 1].importantButHiddenCount,
    },
    persistRetention,
    compression: snapshotReports.map((s) => ({ name: s.name, ...s.measurements.compression })),
    churnByHorizon: {
      first5min: churnWindow(0, snapshotReports.find((s) => s.name === "5min")?.afterTurnIndex + 1 ?? 20),
      to10min: churnWindow(0, snapshotReports.find((s) => s.name === "10min")?.afterTurnIndex + 1 ?? 40),
      to20min: churnWindow(0, snapshotReports.find((s) => s.name === "20min")?.afterTurnIndex + 1 ?? 80),
      lastQuarter: churnWindow(perTurn.length - 30, perTurn.length),
    },
  },
  failureDistribution: failureCounts,
  nearbyHighChurnTurns: nearbyChurn,
  snapshots: snapshotReports,
};

writeFileSync(`${OUT_DIR}/report.json`, JSON.stringify(report, null, 2));
writeFileSync(`${OUT_DIR}/per-turn.json`, JSON.stringify(perTurn, null, 2));

console.log("═".repeat(80));
console.log("VISIBILITY AUDIT (measurement only)");
console.log("═".repeat(80));
console.log(`identity source: ${reportPath}`);
console.log(`duplicate clusters: ${report.duplicateClusters.length} ${JSON.stringify(report.duplicateClusters)}`);
console.log(`final entities: ${report.finalWorldEntityCount} total / ${report.finalLiveEntityCount} live`);
console.log("\nCompression (speech turns → entities → visible objects):");
for (const c of report.measurements.compression) {
  console.log(`  ${c.name.padEnd(6)}  turns=${c.speechTurns}  entities=${c.semanticEntities} (live ${c.liveEntities})  visible=${c.visibleObjects}  speech→visible=${c.speechToVisible.toFixed(3)}  live→visible=${c.entityToVisible.toFixed(3)}`);
}
console.log("\nBoard dynamics:");
console.log(`  mean visible-object retention: ${report.measurements.visibleObjectRetention.mean.toFixed(3)}`);
console.log(`  last-quarter retention:        ${report.measurements.visibleObjectRetention.lastQuarter.toFixed(3)}`);
console.log(`  mean additions/removals:       ${report.measurements.additionsRemovalsPerTurn.meanAdded.toFixed(2)} / ${report.measurements.additionsRemovalsPerTurn.meanRemoved.toFixed(2)}`);
console.log(`  primary-focus changes:         ${report.measurements.primaryFocusChanges} / ${perTurn.length}`);
console.log(`  mean stale-visible:            ${report.measurements.staleVisible.mean.toFixed(2)}`);
console.log(`  mean important-but-hidden:     ${report.measurements.importantButHidden.mean.toFixed(2)}`);
console.log(`  canvas patch +/~/→/−:          ${report.measurements.additionsRemovalsPerTurn.canvasPatchAdded}/${perTurn.reduce((a, t) => a + t.patch.updated, 0)}/${report.measurements.additionsRemovalsPerTurn.canvasPatchMoved}/${report.measurements.additionsRemovalsPerTurn.canvasPatchRemoved}`);

console.log("\nFailure distribution across expected concepts:");
for (const [k, v] of Object.entries(failureCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(3)}  ${k}`);
}

for (const snap of snapshotReports) {
  console.log(`\n── ${snap.name} after turn ${snap.afterTurnIndex + 1} @ ${Math.floor(snap.t / 60)}:${String(snap.t % 60).padStart(2, "0")} ──`);
  console.log(`   world ${snap.measurements.worldEntityCount}  live ${snap.measurements.liveEntityCount}  visible ${snap.measurements.visibleObjectCount}`);
  console.log(`   primary: ${snap.chain.primary ? `${snap.chain.primary.id} (${snap.chain.primary.label})` : "(none)"}`);
  console.log(`   salience: ${(snap.chain.salience ?? []).slice(0, 8).join(", ")}`);
  console.log(`   grammar/intent: ${snap.chain.grammar} / ${snap.chain.intent}  focus=${snap.chain.focusEntityId}`);
  console.log(`   visible: ${snap.chain.visibleLabels.join(" | ")}`);
  for (const c of snap.concepts) {
    const mark = c.classification.startsWith("ok") ? "·" : "✗";
    const where = c.matched ? `${c.matched.id} [${c.matched.status}/${c.matched.importance}] plan=${c.inPlan} scene=${c.inScene}` : "NO MATCH";
    console.log(`   ${mark} ${c.key.padEnd(22)} ${c.role.padEnd(12)} ${c.classification}  (${where})`);
  }
}

console.log("\nPersist-kind entities (heuristic) visible-ratio:");
for (const p of persistRetention.sort((a, b) => a.visibleRatio - b.visibleRatio).slice(0, 20)) {
  console.log(`  ${(p.visibleRatio * 100).toFixed(0).padStart(3)}%  ${p.id} (${p.label}) [${p.status}] ${p.visibleTurns}/${p.totalTurns}`);
}

console.log(`\nWrote ${OUT_DIR}/report.json`);
