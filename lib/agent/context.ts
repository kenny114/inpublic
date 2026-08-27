import type { CanvasObservation } from "../canvas";
import type { ScenePlan, WorldState } from "../expression/schemas";
import type { VisualActionResult } from "../visual-actions";
import {
  AgentContextSchema,
  type AgentActionFeedback,
  type AgentCanvasView,
  type AgentContext,
  type AgentRevisionSet,
  type AgentWorldView,
  type PreviousAgentTurn,
} from "./types";

function compact(value: string | undefined, maximum: number): string | undefined {
  const text = value?.trim();
  return text ? text.slice(0, maximum) : undefined;
}

function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ code, 0x85ebca6b) >>> 0;
  }
  return `${left.toString(16).padStart(8, "0")}${right.toString(16).padStart(8, "0")}`;
}

export function agentWorldView(world: WorldState): AgentWorldView {
  return {
    topic: compact(world.topic, 80),
    interpretation: compact(world.interpretation, 240),
    entities: world.entities.map((entity) => ({
      id: entity.id,
      type: entity.type,
      label: entity.label,
      status: entity.status,
      importance: entity.importance,
      description: compact(entity.description, 160),
      quantity: entity.quantity,
      attributes: entity.attributes,
      confidence: entity.confidence,
      lastTouchedSeq: entity.lastTouchedSeq,
    })),
    relations: world.relations.map((relation) => ({
      id: relation.id,
      sourceEntityId: relation.source,
      targetEntityId: relation.target,
      type: relation.type,
      role: relation.role,
      spatial: relation.spatial,
      magnitude: relation.magnitude,
      step: relation.step,
      confidence: relation.confidence,
      lastTouchedSeq: relation.lastTouchedSeq,
    })),
    claims: world.claims.map((claim) => ({
      id: claim.id,
      text: claim.text,
      aboutEntityIds: claim.about ?? [],
      uncertain: claim.uncertain,
      invalidated: claim.invalidated,
      confidence: claim.confidence,
      importance: claim.importance,
    })),
    salience: [...world.salience],
    sequence: world.seq,
  };
}

function semanticOwner(elementId: string, scene: ScenePlan): string | undefined {
  const owner = scene.objects
    .filter((object) => object.entityId && (elementId === object.id || elementId.startsWith(`${object.id}-`)))
    .sort((left, right) => right.id.length - left.id.length)[0];
  return owner?.entityId;
}

export function agentCanvasView(observation: CanvasObservation, scene: ScenePlan): AgentCanvasView {
  const selected = new Set(observation.selection.elementIds);
  return {
    revisions: { ...observation.revisions },
    elements: observation.elements.slice(0, 160).map((element) => ({
      id: element.id.slice(0, 160),
      type: element.type.slice(0, 48),
      bounds: { x: element.x, y: element.y, width: element.width, height: element.height },
      angle: element.angle,
      text: compact(element.text, 160),
      selected: selected.has(element.id),
      groupIds: element.groupIds.slice(0, 16).map((id) => id.slice(0, 160)),
      frameId: element.frameId?.slice(0, 160) ?? null,
      containerId: element.containerId?.slice(0, 160) ?? null,
      order: element.order,
      semanticEntityId: semanticOwner(element.id, scene),
    })),
    selection: {
      elementIds: observation.selection.elementIds.slice(0, 160).map((id) => id.slice(0, 160)),
      groupIds: observation.selection.groupIds.slice(0, 160).map((id) => id.slice(0, 160)),
    },
    viewport: { ...observation.viewport },
  };
}

export function agentRevisions(world: WorldState, scene: ScenePlan, observation: CanvasObservation): AgentRevisionSet {
  return {
    world: fingerprint(world),
    expressionScene: fingerprint(scene),
    scene: observation.revisions.scene,
    selection: observation.revisions.selection,
    viewport: observation.revisions.viewport,
  };
}

export function buildAgentContext(input: {
  instruction: string;
  world: WorldState;
  scene: ScenePlan;
  observation: CanvasObservation;
  previous?: PreviousAgentTurn;
  step: number;
  remainingSteps: number;
}): AgentContext {
  return AgentContextSchema.parse({
    instruction: input.instruction,
    world: agentWorldView(input.world),
    canvas: agentCanvasView(input.observation, input.scene),
    previousAction: input.previous?.action,
    previousResult: input.previous?.result,
    step: input.step,
    remainingSteps: input.remainingSteps,
  });
}

export function actionFeedback(result: VisualActionResult): AgentActionFeedback {
  const beforeObservation = result.before.observation;
  const afterObservation = result.after.observation;
  return {
    status: result.status,
    actionType: result.actionType,
    category: result.category,
    reason: result.reason.slice(0, 240),
    ...(result.status === "rejected" ? { code: result.code.slice(0, 80) } : {}),
    changed: {
      world: fingerprint(result.before.world) !== fingerprint(result.after.world),
      expressionScene: fingerprint(result.before.scene) !== fingerprint(result.after.scene),
      canvasScene: beforeObservation?.revisions.scene !== afterObservation?.revisions.scene,
      selection: beforeObservation?.revisions.selection !== afterObservation?.revisions.selection,
      viewport: beforeObservation?.revisions.viewport !== afterObservation?.revisions.viewport,
    },
  };
}

export function sameRevision(left: AgentRevisionSet, right: AgentRevisionSet): boolean {
  return left.world === right.world
    && left.expressionScene === right.expressionScene
    && left.scene === right.scene
    && left.selection === right.selection
    && left.viewport === right.viewport;
}

export function stableActionKey(value: unknown): string {
  return JSON.stringify(value);
}
