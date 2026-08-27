import type { CanvasObservation } from "../canvas";
import type { PresentationForm } from "../expression/presentation/intent";
import { grammarChainForPresentation } from "../expression/presentation/intent";
import type { ScenePlan, WorldState } from "../expression/schemas";
import type {
  CommunicationDecision,
  CommunicationOutcome,
  CommunicationStage,
  CommunicationState,
  SemanticDeltaSummary,
  TransformationCandidate,
  VisualDeltaSummary,
} from "./types";

const EMPTY_SEMANTIC_DELTA: SemanticDeltaSummary = {
  addedEntityIds: [], updatedEntityIds: [], removedEntityIds: [],
  addedRelationIds: [], updatedRelationIds: [], removedRelationIds: [],
  addedClaimIds: [], updatedClaimIds: [], removedClaimIds: [], changed: false,
};

function changedIds<T extends { id: string }>(before: T[], after: T[]) {
  const left = new Map(before.map((item) => [item.id, JSON.stringify(item)]));
  const right = new Map(after.map((item) => [item.id, JSON.stringify(item)]));
  return {
    added: [...right.keys()].filter((id) => !left.has(id)),
    updated: [...right.keys()].filter((id) => left.has(id) && left.get(id) !== right.get(id)),
    removed: [...left.keys()].filter((id) => !right.has(id)),
  };
}

export function summarizeSemanticDelta(before: WorldState | undefined, after: WorldState): SemanticDeltaSummary {
  if (!before) return EMPTY_SEMANTIC_DELTA;
  const entities = changedIds(before.entities, after.entities);
  const relations = changedIds(before.relations, after.relations);
  const claims = changedIds(before.claims, after.claims);
  const summary: SemanticDeltaSummary = {
    addedEntityIds: entities.added,
    updatedEntityIds: entities.updated,
    removedEntityIds: entities.removed,
    addedRelationIds: relations.added,
    updatedRelationIds: relations.updated,
    removedRelationIds: relations.removed,
    addedClaimIds: claims.added,
    updatedClaimIds: claims.updated,
    removedClaimIds: claims.removed,
    changed: false,
  };
  summary.changed = Object.entries(summary).some(([key, value]) => key !== "changed" && (value as string[]).length > 0);
  return summary;
}

export function visibleSemanticEntityIds(
  world: WorldState,
  scene: ScenePlan,
  observation: CanvasObservation,
): string[] {
  const valid = new Set(world.entities.map((entity) => entity.id));
  const observedIds = observation.elements.map((element) => element.id);
  return [...new Set(scene.objects
    .filter((object) => object.entityId && valid.has(object.entityId))
    .filter((object) => observedIds.some((id) => id === object.id || id.startsWith(`${object.id}-`)))
    .map((object) => object.entityId!))].sort();
}

export function meaningfulVisualExists(world: WorldState, scene: ScenePlan, observation: CanvasObservation): boolean {
  return visibleSemanticEntityIds(world, scene, observation).length > 0;
}

export function deriveTransformationCandidate(
  world: WorldState,
  currentForm?: PresentationForm,
): TransformationCandidate | undefined {
  const compatible = (form: PresentationForm) =>
    grammarChainForPresentation(world, { form }, ["relationship"])[0] !== "relationship";
  const quantified = world.entities.filter((entity) => entity.quantity).length;
  const forms: PresentationForm[] = [];
  let reason = "";
  if (quantified >= 2) {
    forms.push("magnitude", "comparison");
    reason = "quantitative contrast is now available";
  } else if (quantified === 1) {
    forms.push("magnitude");
    reason = "quantitative magnitude is now available";
  } else if (compatible("causal")) {
    forms.push("causal");
    reason = "causal structure is now available";
  } else if (compatible("process")) {
    forms.push("process");
    reason = "ordered change is now available";
  } else if (compatible("comparison")) {
    forms.push("comparison", "tension");
    reason = "comparative structure is now available";
  } else if (compatible("spatial")) {
    forms.push("spatial");
    reason = "semantic spatial structure is now available";
  }
  const compatibleForms = forms.filter((form) => compatible(form));
  return compatibleForms.length ? { ...(currentForm ? { currentForm } : {}), compatibleForms, reason } : undefined;
}

export function summarizeVisualDelta(input: {
  previousActiveEntityIds: string[];
  activeEntityIds: string[];
  previousForm?: PresentationForm;
  currentForm?: PresentationForm;
  canvasChanged: boolean;
  decision?: CommunicationDecision;
}): VisualDeltaSummary {
  const previous = new Set(input.previousActiveEntityIds);
  const current = new Set(input.activeEntityIds);
  const presentationChange = input.currentForm && input.currentForm !== input.previousForm
    ? { ...(input.previousForm ? { from: input.previousForm } : {}), to: input.currentForm }
    : undefined;
  const focusTarget = input.decision?.type === "emphasize" ? input.decision.target : undefined;
  return {
    addedEntityIds: [...current].filter((id) => !previous.has(id)),
    removedEntityIds: [...previous].filter((id) => !current.has(id)),
    ...(presentationChange ? { presentationChange } : {}),
    ...(focusTarget ? { focusTarget } : {}),
    canvasChanged: input.canvasChanged,
    noCanvasChange: !input.canvasChanged,
  };
}

export function deriveStage(input: {
  visualEstablished: boolean;
  semanticDelta: SemanticDeltaSummary;
  visualDelta: VisualDeltaSummary;
  transformationCandidate?: TransformationCandidate;
  lastDecision?: CommunicationDecision;
  lastOutcome?: CommunicationOutcome;
  currentForm?: PresentationForm;
  newTurn?: boolean;
}): CommunicationStage {
  if (!input.visualEstablished) return "establish";
  if (input.newTurn) return "develop";
  if (
    input.semanticDelta.changed
    && input.transformationCandidate?.compatibleForms[0] !== input.currentForm
  ) return "transform";
  if (input.semanticDelta.changed || input.visualDelta.addedEntityIds.length || input.visualDelta.removedEntityIds.length) {
    return "develop";
  }
  if (input.lastDecision && input.lastOutcome && input.lastOutcome.status !== "rejected") return "conclude";
  return "develop";
}

export function initialCommunicationState(seed?: CommunicationState): CommunicationState {
  return seed
    ? structuredClone(seed)
    : {
        stage: "establish",
        visualEstablished: false,
        activeEntityIds: [],
        deliveredMessages: [],
        visualRevision: 0,
        semanticRevision: 0,
      };
}
