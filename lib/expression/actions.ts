/**
 * Exact-identity semantic actions for the VisualAction language.
 *
 * MeaningDelta remains the creation/general-expression language. These
 * primitives exist only where an explicit caller already knows the stable
 * WorldState identity and mention-based resolution would be the wrong tool.
 */

import { z } from "zod";
import {
  AttributeSchema,
  ConfidenceSchema,
  EntityTypeSchema,
  IdSchema,
  MeaningDeltaSchema,
  QuantitySchema,
  RelationTypeSchema,
  SpatialRelationSchema,
  WorldStateSchema,
  isLiveEntityStatus,
  type MeaningDelta,
  type WorldEntity,
  type WorldOp,
  type WorldRelation,
  type WorldState,
} from "./schemas";
import { normalizeMention, recomputeImportance } from "./world/apply";
import { PresentationIntentSchema } from "./presentation/intent";

export const ExpressVisualActionSchema = z
  .object({
    type: z.literal("express"),
    meaning: MeaningDeltaSchema,
    presentation: PresentationIntentSchema.optional(),
  })
  .strict();

export const UpdateEntityChangesSchema = z
  .object({
    type: EntityTypeSchema.optional(),
    label: z.string().min(1).max(60).optional(),
    description: z.string().max(160).nullable().optional(),
    quantity: QuantitySchema.nullable().optional(),
    attributes: z.array(AttributeSchema).max(8).nullable().optional(),
    confidence: ConfidenceSchema.nullable().optional(),
  })
  .strict()
  .refine((changes) => Object.keys(changes).length > 0, "at least one entity change is required");

export const UpdateEntityVisualActionSchema = z
  .object({
    type: z.literal("update_entity"),
    entityId: IdSchema,
    changes: UpdateEntityChangesSchema,
  })
  .strict();

export const RemoveEntityVisualActionSchema = z
  .object({ type: z.literal("remove_entity"), entityId: IdSchema })
  .strict();

export const RelationIntentSchema = z
  .object({
    type: RelationTypeSchema,
    role: z.string().max(32).optional(),
    spatial: SpatialRelationSchema.optional(),
    magnitude: z.number().finite().optional(),
    step: z.number().int().nonnegative().optional(),
    confidence: ConfidenceSchema.optional(),
  })
  .strict();

export const RelateEntitiesVisualActionSchema = z
  .object({
    type: z.literal("relate_entities"),
    sourceEntityId: IdSchema,
    targetEntityId: IdSchema,
    relation: RelationIntentSchema,
  })
  .strict();

export const RemoveRelationVisualActionSchema = z
  .object({ type: z.literal("remove_relation"), relationId: IdSchema })
  .strict();

export const SemanticVisualActionSchema = z.discriminatedUnion("type", [
  ExpressVisualActionSchema,
  UpdateEntityVisualActionSchema,
  RemoveEntityVisualActionSchema,
  RelateEntitiesVisualActionSchema,
  RemoveRelationVisualActionSchema,
]);

export type ExpressVisualAction = z.infer<typeof ExpressVisualActionSchema>;
export type UpdateEntityVisualAction = z.infer<typeof UpdateEntityVisualActionSchema>;
export type RemoveEntityVisualAction = z.infer<typeof RemoveEntityVisualActionSchema>;
export type RelateEntitiesVisualAction = z.infer<typeof RelateEntitiesVisualActionSchema>;
export type RemoveRelationVisualAction = z.infer<typeof RemoveRelationVisualActionSchema>;
export type SemanticVisualAction = z.infer<typeof SemanticVisualActionSchema>;
export type ExactSemanticVisualAction = Exclude<SemanticVisualAction, ExpressVisualAction>;

export type SemanticMutationResult =
  | { status: "applied"; world: WorldState; ops: WorldOp[]; reason: string }
  | { status: "noop"; world: WorldState; reason: string }
  | { status: "rejected"; world: WorldState; code: string; reason: string };

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function uniqueRelationId(base: string, taken: Set<string>): string {
  const root = base.slice(0, 44) || "relation";
  if (!taken.has(root)) return root;
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${root}-${index}`.slice(0, 48);
    if (!taken.has(candidate)) return candidate;
  }
  return `${root}-${taken.size}`.slice(0, 48);
}

function validWorld(world: WorldState): WorldState {
  return WorldStateSchema.parse(world);
}

function updateEntity(
  world: WorldState,
  action: UpdateEntityVisualAction,
  seq: number,
): SemanticMutationResult {
  const index = world.entities.findIndex((entity) => entity.id === action.entityId);
  if (index === -1) return { status: "rejected", world, code: "unknown_entity", reason: `unknown entity ${action.entityId}` };
  const previous = world.entities[index];
  if (!isLiveEntityStatus(previous.status)) {
    return { status: "rejected", world, code: "inactive_entity", reason: `entity ${action.entityId} is not active` };
  }

  const changes = action.changes;
  const next: WorldEntity = {
    ...previous,
    ...(changes.type !== undefined ? { type: changes.type } : {}),
    ...(changes.label !== undefined ? { label: changes.label } : {}),
    ...(changes.description !== undefined ? { description: changes.description ?? undefined } : {}),
    ...(changes.quantity !== undefined ? { quantity: changes.quantity ?? undefined } : {}),
    ...(changes.attributes !== undefined ? { attributes: changes.attributes ?? undefined } : {}),
    ...(changes.confidence !== undefined ? { confidence: changes.confidence ?? undefined } : {}),
  };
  const semanticBefore = { ...previous, lastTouchedSeq: 0, aliases: [] as string[] };
  const semanticAfter = { ...next, lastTouchedSeq: 0, aliases: [] as string[] };
  if (equal(semanticBefore, semanticAfter)) {
    return { status: "noop", world, reason: `entity ${action.entityId} already has those values` };
  }

  const aliases = [
    ...previous.aliases,
    normalizeMention(previous.label),
    normalizeMention(next.label),
  ].filter(Boolean);
  next.aliases = [...new Set(aliases)].slice(-12);
  next.lastTouchedSeq = seq;

  const entities = [...world.entities];
  entities[index] = next;
  const important = recomputeImportance(entities, world.relations, seq);
  const finalEntity = important.find((entity) => entity.id === next.id) ?? next;
  const nextWorld = validWorld({
    ...world,
    entities: important,
    salience: [next.id, ...world.salience.filter((id) => id !== next.id)].slice(0, 16),
    seq,
  });
  return {
    status: "applied",
    world: nextWorld,
    ops: [{ kind: "UPDATE_ENTITY", entity: finalEntity, prev: previous }],
    reason: `updated entity ${action.entityId}`,
  };
}

function removeEntity(
  world: WorldState,
  action: RemoveEntityVisualAction,
  seq: number,
): SemanticMutationResult {
  const removed = world.entities.find((entity) => entity.id === action.entityId);
  if (!removed) return { status: "noop", world, reason: `entity ${action.entityId} is already absent` };

  const droppedRelations = world.relations.filter(
    (relation) => relation.source === removed.id || relation.target === removed.id,
  );
  const relations = world.relations.filter((relation) => !droppedRelations.includes(relation));
  const survivingEntities = world.entities
    .filter((entity) => entity.id !== removed.id)
    .map((entity) =>
      entity.supersededByEntityId === removed.id
        ? { ...entity, supersededByEntityId: undefined, lastTouchedSeq: seq }
        : entity,
    );
  const entities = recomputeImportance(
    survivingEntities,
    relations,
    seq,
  );
  const claimOps: WorldOp[] = [];
  const claims = world.claims.map((claim) => {
    if (!claim.about?.includes(removed.id)) return claim;
    const next = { ...claim, about: claim.about.filter((id) => id !== removed.id), lastTouchedSeq: seq };
    claimOps.push({ kind: "UPDATE_CLAIM", claim: next, prev: claim });
    return next;
  });
  const nextWorld = validWorld({
    ...world,
    entities,
    relations,
    claims,
    salience: world.salience.filter((id) => id !== removed.id),
    seq,
  });
  return {
    status: "applied",
    world: nextWorld,
    ops: [
      { kind: "REMOVE_ENTITY", entityId: removed.id },
      ...world.entities
        .filter((entity) => entity.supersededByEntityId === removed.id)
        .map((entity) => {
          const next = entities.find((candidate) => candidate.id === entity.id)!;
          return { kind: "UPDATE_ENTITY", entity: next, prev: entity } as WorldOp;
        }),
      ...droppedRelations.map((relation) => ({ kind: "REMOVE_RELATION", relationId: relation.id }) as WorldOp),
      ...claimOps,
    ],
    reason: `removed entity ${removed.id}`,
  };
}

function relateEntities(
  world: WorldState,
  action: RelateEntitiesVisualAction,
  seq: number,
): SemanticMutationResult {
  if (action.sourceEntityId === action.targetEntityId) {
    return { status: "rejected", world, code: "self_relation", reason: "a relationship needs two distinct entities" };
  }
  const source = world.entities.find((entity) => entity.id === action.sourceEntityId);
  const target = world.entities.find((entity) => entity.id === action.targetEntityId);
  if (!source || !target) {
    const missing = !source ? action.sourceEntityId : action.targetEntityId;
    return { status: "rejected", world, code: "unknown_entity", reason: `unknown entity ${missing}` };
  }
  if (!isLiveEntityStatus(source.status) || !isLiveEntityStatus(target.status)) {
    return { status: "rejected", world, code: "inactive_entity", reason: "relationship endpoints must be active" };
  }

  const intent = action.relation;
  const existing = world.relations.find(
    (relation) =>
      relation.source === source.id &&
      relation.target === target.id &&
      relation.type === intent.type &&
      (relation.role ?? "") === (intent.role ?? ""),
  );
  let relations: WorldRelation[];
  let relationOp: WorldOp;
  if (existing) {
    const next: WorldRelation = {
      ...existing,
      ...(intent.spatial !== undefined ? { spatial: intent.spatial } : {}),
      ...(intent.magnitude !== undefined ? { magnitude: intent.magnitude } : {}),
      ...(intent.step !== undefined ? { step: intent.step } : {}),
      ...(intent.confidence !== undefined ? { confidence: intent.confidence } : {}),
      lastTouchedSeq: seq,
    };
    if (equal({ ...existing, lastTouchedSeq: 0 }, { ...next, lastTouchedSeq: 0 })) {
      return { status: "noop", world, reason: `relationship ${existing.id} already exists` };
    }
    relations = world.relations.map((relation) => (relation.id === existing.id ? next : relation));
    relationOp = { kind: "UPDATE_RELATION", relation: next, prev: existing };
  } else {
    const id = uniqueRelationId(
      `${source.id}-${intent.type}-${target.id}`,
      new Set(world.relations.map((relation) => relation.id)),
    );
    const created: WorldRelation = {
      id,
      source: source.id,
      target: target.id,
      ...intent,
      firstSeenSeq: seq,
      lastTouchedSeq: seq,
    };
    relations = [...world.relations, created];
    relationOp = { kind: "ADD_RELATION", relation: created };
  }

  const touched = world.entities.map((entity) =>
    entity.id === source.id || entity.id === target.id ? { ...entity, lastTouchedSeq: seq } : entity,
  );
  const entities = recomputeImportance(touched, relations, seq);
  const nextWorld = validWorld({
    ...world,
    entities,
    relations,
    salience: [target.id, source.id, ...world.salience.filter((id) => id !== source.id && id !== target.id)].slice(0, 16),
    seq,
  });
  return { status: "applied", world: nextWorld, ops: [relationOp], reason: `related ${source.id} to ${target.id}` };
}

function removeRelation(
  world: WorldState,
  action: RemoveRelationVisualAction,
  seq: number,
): SemanticMutationResult {
  const removed = world.relations.find((relation) => relation.id === action.relationId);
  if (!removed) return { status: "noop", world, reason: `relationship ${action.relationId} is already absent` };
  const relations = world.relations.filter((relation) => relation.id !== removed.id);
  const touched = world.entities.map((entity) =>
    entity.id === removed.source || entity.id === removed.target ? { ...entity, lastTouchedSeq: seq } : entity,
  );
  const entities = recomputeImportance(touched, relations, seq);
  const nextWorld = validWorld({
    ...world,
    entities,
    relations,
    salience: [removed.target, removed.source, ...world.salience.filter((id) => id !== removed.source && id !== removed.target)].slice(0, 16),
    seq,
  });
  return {
    status: "applied",
    world: nextWorld,
    ops: [{ kind: "REMOVE_RELATION", relationId: removed.id }],
    reason: `removed relationship ${removed.id}`,
  };
}

/** Exact-id semantic mutation. `express` is handled by the existing MeaningDelta fold. */
export function applyExactSemanticVisualAction(
  world: WorldState,
  action: ExactSemanticVisualAction,
  seq = world.seq + 1,
): SemanticMutationResult {
  switch (action.type) {
    case "update_entity":
      return updateEntity(world, action, seq);
    case "remove_entity":
      return removeEntity(world, action, seq);
    case "relate_entities":
      return relateEntities(world, action, seq);
    case "remove_relation":
      return removeRelation(world, action, seq);
  }
}

/** A data-only delta used to re-run deterministic expression after an exact-id mutation. */
export function actionExpressionDelta(world: WorldState): MeaningDelta {
  return {
    entities: [],
    relations: [],
    claims: [],
    interpretation: world.interpretation ?? "",
  };
}
