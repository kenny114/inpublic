/**
 * One readable view of a pipeline run, shared by the dev console and the
 * offline discovery runner.
 *
 * The trace object already carries every stage; this turns it into something
 * a person can read in a terminal or a devtools console without expanding
 * ten nested objects. It exists because the question asked of a bad picture
 * is never "what are the coordinates" — it is "which transformation first
 * went wrong", and answering that needs the stages side by side, in order,
 * at a glance.
 *
 * Deliberately compact. A dump nobody reads is the same as no trace at all,
 * so each stage gets one line and the full objects stay one property access
 * away for when a line is not enough.
 */

import type { ExpressionTrace } from "./pipeline";
import { isLiveEntityStatus, type Provenance, type WorldState } from "./schemas";

function live(world: WorldState) {
  return world.entities.filter((e) => isLiveEntityStatus(e.status));
}

/** `0.83` / `  —  ` for a dimension that does not apply. */
function dim(score: number | null): string {
  return score === null ? "—" : score.toFixed(2);
}

/**
 * The stage-by-stage summary, one line each, in pipeline order:
 * what came in, what it meant, what the world became, how that was read,
 * what was planned, what was drawn, what changed on the canvas, and what
 * the evaluator made of the result.
 */
export function formatTrace(trace: ExpressionTrace): string {
  const p = trace.evaluation.preservation;
  const before = live(trace.worldBefore);
  const after = live(trace.world);

  return [
    `INPUT       [${trace.input.source}] ${trace.input.text}`,
    `MEANING     ${trace.delta.entities.map((e) => `${e.label}:${e.type}${e.quantity ? `(${e.quantity.value})` : ""}`).join(", ") || "(nothing)"}`,
    `            ${trace.delta.relations.map((r) => `${r.source}-${r.type}->${r.target}`).join("  ") || "(no relations)"}`,
    `            "${trace.delta.interpretation}"`,
    `WORLD ←     ${before.map((e) => e.id).join(", ") || "(empty)"}`,
    `WORLD →     ${after.map((e) => `${e.id}:${e.type}:${e.importance}`).join(", ") || "(empty)"}`,
    `            ${trace.world.relations.map((r) => `${r.source}-${r.type}${r.role ? `:${r.role}` : ""}->${r.target}`).join("  ") || "(no relations)"}`,
    `CHANGED     ${trace.opsDescribed.join("  |  ") || "(nothing)"}`,
    `PROVENANCE  ${formatProvenance(trace.provenance)}`,
    ...referenceLines(trace),
    ...stanceLines(trace),
    ...discourseLines(trace),
    ...metricLines(trace),
    ...identityLines(trace),
    `INTENT      ${trace.intent.primary}${trace.intent.secondary.length ? ` (+${trace.intent.secondary.join(",")})` : ""} — ${trace.intent.reason}`,
    `COMPOSITION ${trace.composition ? `${trace.composition.reason}  spine ${trace.composition.spine.map((e) => `${e.from}${e.label ? `-${e.label}->` : "->"}${e.to}`).join(" ") || "—"}  allow ${trace.composition.allowed.join(",") || "—"}` : "(fast path — not composed)"}`,
    `CLEAN       ${trace.clean ? `${trace.clean.reason}  keep ${trace.clean.keep.join(",") || "—"}  drop ${trace.clean.remove.join(",") || "—"}` : "(fast path — not policed)"}`,
    `PRESENT     ${trace.presentation ? `${trace.presentation.layout}  ${trace.presentation.notes}${trace.presentation.simplifications.length ? `  drop ${trace.presentation.simplifications.join(",")}` : ""}` : "(fast path — not presented)"}`,
    `PLAN        ${trace.plan.grammar} — ${trace.plan.reason}`,
    `            regions: ${trace.plan.regions.map((r) => `${r.entityId ?? r.claimId}:${r.role}`).join("  ") || "(none)"}`,
    `SCENE       ${trace.scene.objects.map((o) => `${o.entityId ?? o.claimId}:${o.primitive}${o.count ? `×${o.count}` : ""}@${o.x},${o.y}`).join("  ") || "(empty)"}`,
    `            ${trace.scene.connectors.map((c) => `${c.relationId}:${c.style}${c.label ? `"${c.label}"` : ""}`).join("  ") || "(no connectors)"}`,
    `CANVAS      +${trace.patch.added.length} added, ${trace.patch.updated.length} updated, ${trace.patch.moved.length} moved, ${trace.patch.removed.length} removed`,
    `EVALUATION  ${trace.evaluation.semanticPreservation}  ` +
      `entity ${dim(p.entity.score)} · relation ${dim(p.relation.score)} · causal ${dim(p.causal.score)} · ` +
      `quantity ${dim(p.quantity.score)} · ordering ${dim(p.ordering.score)} · polarity ${dim(p.polarity.score)} · uncertainty ${dim(p.uncertainty.score)}`,
    ...lossLines(trace),
    `PROBLEMS    ${trace.evaluation.problems.map((x) => `${x.type}(${x.severity})`).join(", ") || "none"}`,
    `REPAIR      ${trace.repair.steps.map((s) => s.action).join(", ") || "none"}` +
      (trace.repairOutcome
        ? `  [${trace.repairOutcome.kept ? "kept" : "rejected"}: ${trace.repairOutcome.before} → ${trace.repairOutcome.after}]`
        : ""),
  ].join("\n");
}

/** "who/when/which segment" for this round's PROVENANCE line — world metadata, never rendered. */
function formatProvenance(provenance: Provenance | null): string {
  if (!provenance) return "(none — this segment carried no speaker/timestamp)";
  const who = provenance.speakerId ?? "(unknown speaker)";
  const when = provenance.timestamp !== undefined ? `@${provenance.timestamp}` : "";
  return `${who}${when}  segments: ${provenance.sourceSegmentIds.join(", ")}`;
}

/** One line per ordinal/topic-recall mention this round, resolved or not — empty when the segment made none. */
function referenceLines(trace: ExpressionTrace): string[] {
  return trace.referenceResolutions.map((r) => {
    const target = r.chosenId ? trace.world.entities.find((e) => e.id === r.chosenId) : null;
    const outcome = r.chosenId ? `-> ${target?.label ?? r.chosenId}` : "-> UNRESOLVED";
    return `REFERENCE   "${r.surface}" (${r.kind}) ${outcome}  [${r.confidence}] ${r.reason}`;
  });
}

/** One line per "I agree" / "that's not right" claim this round, resolved or not. */
function stanceLines(trace: ExpressionTrace): string[] {
  return trace.stanceResolutions.map((s) => {
    const target = s.targetClaimId ? trace.world.claims.find((c) => c.id === s.targetClaimId) : null;
    const outcome = s.targetClaimId ? `-> "${target?.text ?? s.targetClaimId}"` : "-> UNRESOLVED";
    return `STANCE      ${s.claimId} ${s.type} ${outcome}  (said: "${s.targetSurface}")`;
  });
}

/** One line per lifecycle transition this round performed, applied or not. */
function discourseLines(trace: ExpressionTrace): string[] {
  return trace.discourseActResolutions.map((d) => {
    const outcome = d.applied ? `-> ${d.targetId}` : "-> UNAPPLIED";
    return `DISCOURSE   ${d.type} ${outcome}  [${d.confidence}] (said: "${d.targetSurface}") ${d.reason}`;
  });
}

/** One line per entity this round attached quantitative meaning to — created, appended, target set, or a unit mismatch that was deliberately NOT merged. */
function metricLines(trace: ExpressionTrace): string[] {
  return trace.metricResolutions.map((m) => {
    const entity = trace.world.entities.find((e) => e.id === m.entityId);
    return `METRIC      ${entity?.label ?? m.entityId} ${m.action} — ${m.detail}`;
  });
}

/** One line per entity this round mentioned, when the identity layer is on — new mention -> candidates -> judge (if invoked) -> action -> resulting id, empty when `enableIdentityLayer` is off. */
function identityLines(trace: ExpressionTrace): string[] {
  return trace.identityResolutions.map((r) => {
    const top = r.topCandidateId ? `top candidate "${r.topCandidateId}"[${r.topCandidateStatus}]@${r.topScore?.toFixed(0)}` : "no candidates";
    const judge = r.usedJudge ? ` · judge said ${r.judgeVerdict}` : "";
    const reactivate = r.reactivate ? " · REACTIVATED" : "";
    return `IDENTITY    "${r.mentionLabel}" (${r.mentionType}) — ${r.candidateCount} eligible / ${r.rejectedCount} rejected, ${top}${judge} -> ${r.action}${reactivate} -> ${r.resultingEntityId ?? "(dropped)"}  [${r.reason}]`;
  });
}

/** What each imperfect dimension actually lost — the part that says what to fix. */
function lossLines(trace: ExpressionTrace): string[] {
  const out: string[] = [];
  for (const [name, score] of Object.entries(trace.evaluation.preservation)) {
    if (score.score === null || score.score === 1) continue;
    for (const lost of score.lost) out.push(`   lost ${name.padEnd(11)} ${lost}`);
  }
  return out;
}
