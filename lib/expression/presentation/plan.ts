/**
 * The Presentation Agent: decide how the current story should be shown.
 *
 * Composition picked the story. Clean capped occupancy. This layer answers
 * a different question: what visual form makes that story readable at a
 * glance? It is deterministic and cheap — it reads structured plans, not
 * pixels — and it is not allowed to invent a node Composition or Clean
 * rejected. It may only DROP, for clarity, and choose a layout + emphasis
 * the composer and renderer must realise.
 *
 * Hard rules, enforced here rather than hoped for downstream:
 *  - one visual centre (the primary is heavy; nothing else is);
 *  - the simplest layout that still tells the spine;
 *  - clarity over completeness — extra fans and speaker-duplicates go.
 */

import {
  DEFAULT_PRESENTATION_EMPHASIS,
  EMPTY_PRESENTATION_PLAN,
  isLiveEntityStatus,
  relationFamily,
  type CleanPlan,
  type CompositionPlan,
  type ExpressionIntent,
  type PresentationLayout,
  type PresentationPlan,
  type WorldEntity,
  type WorldState,
} from "../schemas";
import type { BoardSnapshot } from "../clean/snapshot";
import type { PresentationIntent } from "./intent";

/** Off-spine attachments a spine layout will tolerate before they compete. */
const MAX_OFF_SPINE = 2;

const PRONOUN_LABEL = /^(i|me|we|us|my|myself|speaker)$/i;

export interface PresentationInput {
  snapshot: BoardSnapshot;
  world: WorldState;
  intent: ExpressionIntent;
  composition: CompositionPlan | null;
  clean: CleanPlan | null;
  request?: PresentationIntent;
}

function live(world: WorldState): WorldEntity[] {
  return world.entities.filter((e) => isLiveEntityStatus(e.status));
}

function boundNotes(notes: string): string {
  return notes.length <= 200 ? notes : `${notes.slice(0, 199)}…`;
}

function spineNodeIds(composition: CompositionPlan | null): string[] {
  if (!composition?.spine.length) return composition?.primaryId ? [composition.primaryId] : [];
  const ids: string[] = [];
  for (const edge of composition.spine) {
    if (!ids.includes(edge.from)) ids.push(edge.from);
    if (!ids.includes(edge.to)) ids.push(edge.to);
  }
  return ids;
}

function isKin(world: WorldState, a: string, b: string): boolean {
  return world.relations.some(
    (r) =>
      (r.type === "role_of" || r.type === "member_of" || r.type === "part_of") &&
      ((r.source === a && r.target === b) || (r.target === a && r.source === b)),
  );
}

/**
 * "I" and "Kenny" must not both appear as figures when they are the same
 * speaker. Kin (mother, team member) is a different person and stays.
 * Never drops the primary.
 */
export function speakerDuplicateIds(world: WorldState, keep: string[], primaryId: string | undefined): string[] {
  const byId = new Map(live(world).map((e) => [e.id, e]));
  const persons = keep.map((id) => byId.get(id)).filter((e): e is WorldEntity => e?.type === "person");
  if (persons.length < 2) return [];
  const pronouns = persons.filter((p) => PRONOUN_LABEL.test(p.label));
  const named = persons.filter((p) => !PRONOUN_LABEL.test(p.label));
  if (!pronouns.length || !named.length) return [];

  const drops: string[] = [];
  for (const pronoun of pronouns) {
    const duplicate = named.some((n) => !isKin(world, pronoun.id, n.id));
    if (!duplicate) continue;
    if (pronoun.id === primaryId) {
      for (const n of named) {
        if (n.id !== primaryId && !isKin(world, pronoun.id, n.id)) drops.push(n.id);
      }
    } else {
      drops.push(pronoun.id);
    }
  }
  return [...new Set(drops)];
}

function containmentAmong(world: WorldState, ids: Set<string>): number {
  let n = 0;
  for (const rel of world.relations) {
    if (!ids.has(rel.source) || !ids.has(rel.target)) continue;
    if (relationFamily(rel.type) === "structural") n += 1;
  }
  return n;
}

function spineRelationTypes(world: WorldState, composition: CompositionPlan | null): string[] {
  if (!composition?.spine.length) return [];
  const types: string[] = [];
  for (const edge of composition.spine) {
    const rel = world.relations.find((r) => r.source === edge.from && r.target === edge.to);
    if (rel) types.push(rel.type);
  }
  return types;
}

/**
 * Simplest structure that still tells the story. A directed spine is a
 * path (vertical for cause, left-to-right for sequence); containment is a
 * tree; everything else gathers around one subject.
 */
function pickLayout(input: PresentationInput, keep: string[]): PresentationLayout {
  switch (input.request?.form) {
    case "process":
      return "left-to-right";
    case "causal":
      return "vertical-spine";
    case "comparison":
    case "magnitude":
    case "tension":
    case "spatial":
      return "central-primary";
  }
  const ids = new Set(keep);
  const spine = input.composition?.spine ?? [];
  const types = spineRelationTypes(input.world, input.composition);
  const intent = input.intent.primary;

  if (intent === "show_hierarchy" || containmentAmong(input.world, ids) >= 2) return "hierarchy";
  if (intent === "compare" || intent === "show_quantity" || intent === "show_spatial") {
    return spine.length >= 1 ? "vertical-spine" : "central-primary";
  }
  if (spine.length >= 1) {
    if (types.length && types.every((t) => t === "precedes")) return "left-to-right";
    if (intent === "show_sequence") return "left-to-right";
    return "vertical-spine";
  }
  if (intent === "show_sequence") return "left-to-right";
  if (intent === "explain_causality" || intent === "show_transformation") return "vertical-spine";
  return "central-primary";
}

function pickSimplifications(input: PresentationInput, keep: string[], primaryId: string | undefined, spineIds: string[]): string[] {
  const drop: string[] = [];
  const dropSet = new Set<string>();
  const push = (id: string | undefined) => {
    if (!id || id === primaryId || dropSet.has(id) || !keep.includes(id)) return;
    if (spineIds.includes(id)) return;
    dropSet.add(id);
    drop.push(id);
  };

  for (const id of speakerDuplicateIds(input.world, keep, primaryId)) push(id);

  const spineSet = new Set(spineIds);
  const offSpine = keep.filter((id) => id !== primaryId && !spineSet.has(id) && !dropSet.has(id));
  const hasDirectedSpine = (input.composition?.spine.length ?? 0) >= 1;
  if (hasDirectedSpine && offSpine.length > MAX_OFF_SPINE) {
    const byId = new Map(live(input.world).map((e) => [e.id, e]));
    const ranked = [...offSpine].sort((a, b) => (byId.get(a)?.lastTouchedSeq ?? 0) - (byId.get(b)?.lastTouchedSeq ?? 0));
    for (const id of ranked.slice(0, ranked.length - MAX_OFF_SPINE)) push(id);
  }

  return drop;
}

export function planPresentation(input: PresentationInput): PresentationPlan {
  const keep = input.request?.scope?.entityIds ?? input.clean?.keep ?? input.composition?.allowed ?? [];
  if (!keep.length && !input.composition?.primaryId) return EMPTY_PRESENTATION_PLAN;

  const primaryId =
    input.request?.emphasis?.primaryEntityIds?.find((id) => keep.includes(id)) ??
    input.clean?.primaryId ??
    input.composition?.primaryId ??
    keep[0];
  const spineIds = spineNodeIds(input.composition);
  const layout = pickLayout(input, keep);
  const simplifications = pickSimplifications(input, keep, primaryId, spineIds);
  const remaining = keep.filter((id) => !simplifications.includes(id));
  const spineText = (input.composition?.spine ?? [])
    .map((e) => `${e.from}${e.label ? `-${e.label}->` : "->"}${e.to}`)
    .join(" ");

  const notes = boundNotes(
    `${layout}` +
      (primaryId ? `; primary ${primaryId}` : "") +
      (spineText ? `; spine ${spineText}` : "") +
      (simplifications.length ? `; drop ${simplifications.join(",")}` : "") +
      `; show ${remaining.length}`,
  );

  return {
    layout,
    emphasis: DEFAULT_PRESENTATION_EMPHASIS,
    simplifications,
    notes,
  };
}
