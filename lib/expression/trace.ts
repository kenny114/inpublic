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
import type { WorldState } from "./schemas";

function live(world: WorldState) {
  return world.entities.filter((e) => e.status !== "superseded");
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
    `INTENT      ${trace.intent.primary}${trace.intent.secondary.length ? ` (+${trace.intent.secondary.join(",")})` : ""} — ${trace.intent.reason}`,
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

/** What each imperfect dimension actually lost — the part that says what to fix. */
function lossLines(trace: ExpressionTrace): string[] {
  const out: string[] = [];
  for (const [name, score] of Object.entries(trace.evaluation.preservation)) {
    if (score.score === null || score.score === 1) continue;
    for (const lost of score.lost) out.push(`   lost ${name.padEnd(11)} ${lost}`);
  }
  return out;
}
