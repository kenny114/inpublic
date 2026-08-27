/**
 * Failure audit of every unsuccessful referenceMention and discourseAct
 * in the frozen 118-turn meeting. Offline: identity merges are replayed
 * from the recorded live-judge report, so candidate retrieval is the
 * same world the 25% / 46.2% baseline was measured against.
 *
 *   node --no-warnings --import ./scripts/ts-register.mjs scripts/expression-target-failure-audit.mjs
 */

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { ExpressionSession } from "../lib/expression/pipeline.ts";
import { isLiveEntityStatus } from "../lib/expression/schemas.ts";
import { rankEntitiesBySurface } from "../lib/expression/world/references.ts";
import { MEETING_DELTAS_V1 } from "./fixtures/meeting-transcript-deltas-v1.mjs";
import { SPEAKERS } from "./fixtures/meeting-transcript.mjs";

const reportLive = JSON.parse(readFileSync("scripts/fixtures/.meeting-frozen-replay-out/report-live.json", "utf8"));
const merges = reportLive.allMerges.map((m) => ({ ...m, used: false }));

const recordedJudge = async (mention, candidates) => {
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

const EXPECTED = {
  "the same step-four problem we just talked about": {
    expectedId: "biggest-drop-off-point",
    expectedLabel: "biggest drop-off point",
    note: "the step-four problem previously identified as the biggest drop-off; fix-step-four is the decided remedy, not the problem itself",
  },
  "what Priya said about the rebuild": {
    expectedId: "rebuild-onboarding-from-scratch",
    expectedLabel: "Rebuild onboarding from scratch",
  },
  "set that aside": {
    expectedId: "rebuild-onboarding-from-scratch",
    expectedLabel: "Rebuild onboarding from scratch",
  },
  "the second pricing option Sam mentioned in the doc": {
    expectedId: null,
    expectedLabel: "annual discount",
    note: "never spoken as its own entity in this meeting — referenced as existing in an off-meeting doc. Tagged ordinal_reference in the transcript.",
  },
  "the second pricing option Sam mentioned in the doc, the annual discount one": {
    expectedId: null,
    expectedLabel: "annual discount",
    note: "still absent: the prior unresolved reference skipped entity creation, so the follow-up also has nothing to attach to",
  },
  "the step-four onboarding issue": {
    expectedId: "biggest-drop-off-point",
    expectedLabel: "biggest drop-off point",
    note: "same problem as step four / biggest drop-off; fix-step-four is the remedy",
  },
  "what we were saying earlier about usage-based pricing": {
    expectedId: "usage-based-billing",
    expectedLabel: "usage-based billing",
    note: "the parked usage-based topic; extractor later also mints usage-based-pricing as a parallel label",
  },
  "What we were saying earlier about usage-based pricing": {
    expectedId: "usage-based-billing",
    expectedLabel: "usage-based billing",
    note: "same parked topic; this turn also emits a suspend discourse act",
  },
  "removing the free tier": {
    expectedId: "revisit-the-free-tier",
    expectedLabel: "revisit the free tier",
    note: "rejecting the proposal, not the free-tier product itself — resolving onto free-tier would be a wrong mutation",
  },
  "discussion of usage-based pricing": {
    expectedId: "usage-based-billing",
    expectedLabel: "usage-based billing",
  },
  "usage-based pricing discussion": {
    expectedId: "usage-based-pricing",
    expectedLabel: "usage-based pricing",
    note: "falls back to usage-based-billing if usage-based-pricing does not yet exist",
    altIds: ["usage-based-billing"],
  },
  "the growth marketer role that was paused": {
    expectedId: "growth-marketer-role",
    expectedLabel: "growth marketer role",
  },
  "the growth marketer role that was paused a few weeks ago": {
    expectedId: "growth-marketer-role",
    expectedLabel: "growth marketer role",
  },
  "the full rebuild": {
    expectedId: "rebuild-onboarding-from-scratch",
    expectedLabel: "Rebuild onboarding from scratch",
  },
  "the rebuild": {
    expectedId: "rebuild-onboarding-from-scratch",
    expectedLabel: "Rebuild onboarding from scratch",
  },
  "usage-based billing": {
    expectedId: "usage-based-billing",
    expectedLabel: "usage-based billing",
  },
};

function entityBrief(e) {
  if (!e) return null;
  return {
    id: e.id,
    label: e.label,
    type: e.type,
    status: e.status,
    importance: e.importance,
    aliases: e.aliases ?? [],
    description: e.description ?? null,
    firstSeenSeq: e.firstSeenSeq,
    lastTouchedSeq: e.lastTouchedSeq,
    provenance: (e.provenance ?? []).map((p) => ({ speakerId: p.speakerId, timestamp: p.timestamp })),
  };
}

function neighborhood(world, id) {
  return world.relations
    .filter((r) => r.source === id || r.target === id)
    .map((r) => ({
      type: r.type,
      other: r.source === id ? r.target : r.source,
      otherLabel: world.entities.find((e) => e.id === (r.source === id ? r.target : r.source))?.label,
      direction: r.source === id ? "out" : "in",
    }));
}

function claimsAbout(world, id) {
  return world.claims.filter((c) => (c.about ?? []).includes(id)).map((c) => ({ id: c.id, text: c.text, invalidated: c.invalidated ?? false }));
}

function classifyFailure({ expected, expectedEntity, candidates, resolution, mention, act, world }) {
  if (!expected) return "unclassified — no expected target recorded";
  const altIds = expected.altIds ?? [];
  const targetIds = [expected.expectedId, ...altIds].filter(Boolean);
  const targetInWorld = targetIds.some((id) => world.entities.some((e) => e.id === id)) ||
    (expected.expectedLabel && world.entities.some((e) => e.label.toLowerCase().includes(expected.expectedLabel.toLowerCase())));

  if (!targetInWorld && !expected.expectedId) {
    if (mention?.kind === "topic_recall" && /second|first|last|other/.test((mention.surface ?? "").toLowerCase())) {
      return "ordinal/group-selection issue";
    }
    return "extraction missing";
  }
  if (!targetInWorld) return "extraction missing";

  const retrieved = candidates.find((c) => targetIds.includes(c.id) || c.label.toLowerCase() === (expected.expectedLabel ?? "").toLowerCase());
  if (!retrieved) return "correct target absent from candidate retrieval";

  const top = candidates[0];
  const second = candidates[1];
  const isTarget = (c) => c && (targetIds.includes(c.id) || c.label.toLowerCase() === (expected.expectedLabel ?? "").toLowerCase());
  const margin = second ? top.score - second.score : 999;
  if (isTarget(top) && second && margin < 25) return "correct target present but ranking tie/ambiguity";
  if (!isTarget(top) && isTarget(second) && margin < 25) return "correct target present but ranking tie/ambiguity";
  if (!isTarget(top) && retrieved) return "correct target present but ranking tie/ambiguity";

  if (act && expectedEntity && !isLiveEntityStatus(expectedEntity.status) && act.type === "reactivate") {
    return "lifecycle/status eligibility issue";
  }

  const reason = (resolution.reason ?? "").toLowerCase();
  if (reason.includes("ambiguous") && isTarget(top) && isTarget(second) === false && margin < 25) {
    return "correct target present but ranking tie/ambiguity";
  }

  if (!mention?.topicHint && !act) return "insufficient discourse/topic context";
  return "genuinely ambiguous — abstention was correct";
}

const session = new ExpressionSession({
  extract: async () => ({ entities: [], relations: [], claims: [], interpretation: "" }),
  enableIdentityLayer: true,
  identityJudge: recordedJudge,
});

const records = [];
const successes = [];

for (const turn of MEETING_DELTAS_V1) {
  const refs = turn.delta.referenceMentions ?? [];
  const acts = turn.delta.discourseActs ?? [];
  if (!refs.length && !acts.length) {
    const segment = { id: `mt-${turn.index}`, source: "human_speech", text: turn.text, seq: turn.index, speakerId: turn.speaker, timestamp: turn.t };
    await session.ingestDelta(segment, turn.delta);
    continue;
  }

  const worldBefore = session.getWorld();
  const segment = { id: `mt-${turn.index}`, source: "human_speech", text: turn.text, seq: turn.index, speakerId: turn.speaker, timestamp: turn.t };
  const trace = await session.ingestDelta(segment, turn.delta);
  const world = trace.worldBefore; // resolution ran against world-before + in-turn entities; candidates are on the resolution
  const primary = world.entities.find((e) => e.importance === "primary");
  const focus = world.salience?.slice(0, 6).map((id) => {
    const e = world.entities.find((x) => x.id === id);
    return e ? { id: e.id, label: e.label, status: e.status } : { id };
  });

  for (let i = 0; i < refs.length; i += 1) {
    const mention = refs[i];
    const resolution = trace.referenceResolutions[i];
    const expected = EXPECTED[mention.surface];
    const expectedEntity = expected?.expectedId ? world.entities.find((e) => e.id === expected.expectedId) : world.entities.find((e) => expected?.expectedLabel && e.label.toLowerCase() === expected.expectedLabel.toLowerCase());
    const hint = mention.topicHint ?? mention.surface;
    const allRanked = rankEntitiesBySurface(world, hint, mention.speakerHint);
    const record = {
      kind: "referenceMention",
      turn: turn.index,
      t: turn.t,
      speaker: turn.speaker,
      speakerName: SPEAKERS[turn.speaker] ?? turn.speaker,
      originalSpeech: turn.text,
      extracted: mention,
      expectedSemanticTarget: expected ?? null,
      targetExistedInWorld: Boolean(expectedEntity),
      targetStatus: expectedEntity?.status ?? null,
      targetBrief: entityBrief(expectedEntity),
      targetNeighborhood: expectedEntity ? neighborhood(world, expectedEntity.id) : [],
      targetClaims: expectedEntity ? claimsAbout(world, expectedEntity.id) : [],
      candidates: resolution?.candidates ?? [],
      allRanked: allRanked.slice(0, 12),
      activeTopic: world.topic ?? null,
      activePrimary: primary ? { id: primary.id, label: primary.label } : null,
      activeFocus: focus ?? [],
      speakerProvenance: { speakerId: turn.speaker, timestamp: turn.t },
      ordinalGroupContext: mention.kind === "ordinal" ? { ordinalIndex: mention.ordinalIndex, ordinalFromEnd: mention.ordinalFromEnd, ordinalOther: mention.ordinalOther } : null,
      finalResolution: resolution
        ? { chosenId: resolution.chosenId, confidence: resolution.confidence, reason: resolution.reason, applied: Boolean(resolution.chosenId) }
        : null,
      successful: Boolean(resolution?.chosenId),
    };
    record.failureClass = record.successful ? "resolved" : classifyFailure({ expected, expectedEntity, candidates: allRanked, resolution, mention, world });
    (record.successful ? successes : records).push(record);
  }

  for (let i = 0; i < acts.length; i += 1) {
    const act = acts[i];
    const resolution = trace.discourseActResolutions[i];
    if (act.type === "invalidate") {
      if (resolution?.applied) {
        successes.push({
          kind: "discourseAct",
          turn: turn.index,
          originalSpeech: turn.text,
          extracted: act,
          successful: true,
          failureClass: "resolved",
          finalResolution: { targetId: resolution.targetId, confidence: resolution.confidence, reason: resolution.reason, applied: true },
        });
      } else {
        records.push({
          kind: "discourseAct",
          turn: turn.index,
          t: turn.t,
          speaker: turn.speaker,
          originalSpeech: turn.text,
          extracted: act,
          expectedSemanticTarget: { note: "invalidate targets a claim, not an entity" },
          candidates: resolution?.candidates ?? [],
          finalResolution: { targetId: resolution?.targetId ?? null, confidence: resolution?.confidence, reason: resolution?.reason, applied: false },
          successful: false,
          failureClass: "extraction missing",
        });
      }
      continue;
    }
    const expected = EXPECTED[act.targetSurface];
    const expectedEntity =
      (expected?.expectedId && world.entities.find((e) => e.id === expected.expectedId)) ||
      (expected?.altIds && world.entities.find((e) => expected.altIds.includes(e.id))) ||
      world.entities.find((e) => expected?.expectedLabel && e.label.toLowerCase() === expected.expectedLabel.toLowerCase());
    const allRanked = rankEntitiesBySurface(world, act.targetSurface);
    const record = {
      kind: "discourseAct",
      turn: turn.index,
      t: turn.t,
      speaker: turn.speaker,
      speakerName: SPEAKERS[turn.speaker] ?? turn.speaker,
      originalSpeech: turn.text,
      extracted: act,
      expectedSemanticTarget: expected ?? null,
      targetExistedInWorld: Boolean(expectedEntity),
      targetStatus: expectedEntity?.status ?? null,
      targetBrief: entityBrief(expectedEntity),
      targetNeighborhood: expectedEntity ? neighborhood(world, expectedEntity.id) : [],
      targetClaims: expectedEntity ? claimsAbout(world, expectedEntity.id) : [],
      candidates: resolution?.candidates ?? [],
      allRanked: allRanked.slice(0, 12),
      activeTopic: world.topic ?? null,
      activePrimary: primary ? { id: primary.id, label: primary.label } : null,
      activeFocus: focus ?? [],
      speakerProvenance: { speakerId: turn.speaker, timestamp: turn.t },
      ordinalGroupContext: null,
      finalResolution: resolution
        ? { targetId: resolution.targetId, confidence: resolution.confidence, reason: resolution.reason, applied: resolution.applied }
        : null,
      successful: Boolean(resolution?.applied),
    };
    record.failureClass = record.successful ? "resolved" : classifyFailure({ expected, expectedEntity, candidates: allRanked, resolution, act, world });
    (record.successful ? successes : records).push(record);
  }
}

const distribution = {};
for (const r of records) distribution[r.failureClass] = (distribution[r.failureClass] ?? 0) + 1;

const OUT_DIR = "scripts/fixtures/.meeting-frozen-replay-out";
mkdirSync(OUT_DIR, { recursive: true });
const out = {
  identityReplay: {
    recordedMerges: reportLive.allMerges.length,
    consumedJudgedMerges: merges.filter((m) => m.used).length,
    unusedJudgedMerges: merges.filter((m) => m.viaJudge && !m.used).length,
  },
  totals: {
    referenceMentions: MEETING_DELTAS_V1.reduce((n, t) => n + (t.delta.referenceMentions?.length ?? 0), 0),
    discourseActs: MEETING_DELTAS_V1.reduce((n, t) => n + (t.delta.discourseActs?.length ?? 0), 0),
    unsuccessful: records.length,
    successful: successes.length,
  },
  distribution,
  failures: records,
  successes: successes.map((s) => ({
    kind: s.kind,
    turn: s.turn,
    speech: s.originalSpeech,
    extracted: s.extracted,
    finalResolution: s.finalResolution,
  })),
};
writeFileSync(`${OUT_DIR}/target-failure-audit.json`, JSON.stringify(out, null, 2));

console.log(JSON.stringify({ identityReplay: out.identityReplay, totals: out.totals, distribution: out.distribution }, null, 2));
console.log("\n── FAILURES ──");
for (const r of records) {
  console.log(`\n[${r.kind} t${r.turn} ${r.speaker}] class=${r.failureClass}`);
  console.log(`  speech: ${r.originalSpeech}`);
  console.log(`  extracted: ${JSON.stringify(r.extracted)}`);
  console.log(`  expected: ${r.expectedSemanticTarget?.expectedId ?? r.expectedSemanticTarget?.expectedLabel} existed=${r.targetExistedInWorld} status=${r.targetStatus}`);
  console.log(`  reason: ${r.finalResolution?.reason}`);
  console.log(`  top candidates:`);
  for (const c of (r.allRanked ?? r.candidates ?? []).slice(0, 8)) {
    const mark = r.expectedSemanticTarget?.expectedId === c.id || (r.expectedSemanticTarget?.altIds ?? []).includes(c.id) ? " << TARGET" : "";
    console.log(`    ${c.score}\t${c.id}\t${c.label}\t${c.reason}${mark}`);
  }
}
