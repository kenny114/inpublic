export type NodeKind =
  | "person"
  | "object"
  | "concept"
  | "place"
  | "organization"
  | "value"
  | "event"
  | "state";

export type EdgeKind =
  | "causes"
  | "depends_on"
  | "contains"
  | "part_of"
  | "belongs_to"
  | "opposes"
  | "compares_with"
  | "moves_toward"
  | "moves_away_from"
  | "between"
  | "above"
  | "below"
  | "inside"
  | "near"
  | "before"
  | "after"
  | "changes_into"
  | "connects_to";

export type ActionKind =
  | "grow"
  | "decline"
  | "move"
  | "create"
  | "remove"
  | "combine"
  | "split"
  | "start"
  | "stop"
  | "increase"
  | "decrease"
  | "transform"
  | "repeat";

export interface MeaningNode {
  id: string;
  label: string;
  kind: NodeKind;
  evidence: string;
  confidence: number;
}

export interface MeaningEdge {
  id: string;
  kind: EdgeKind;
  from: string;
  to: string;
  evidence: string;
  confidence: number;
  figurative: boolean;
}

export interface MeaningAction {
  id: string;
  kind: ActionKind;
  actor?: string;
  target?: string;
  value?: number;
  unit?: string;
  direction?: "up" | "down" | "toward" | "away";
  evidence: string;
  confidence: number;
  figurative: boolean;
}

export interface MeaningModifier {
  kind: "importance" | "certainty" | "quantity" | "direction" | "speed" | "intensity" | "time" | "order";
  value: string | number;
  target?: string;
  evidence: string;
}

export interface UniversalMeaningGraph {
  sourceText: string;
  nodes: MeaningNode[];
  edges: MeaningEdge[];
  actions: MeaningAction[];
  modifiers: MeaningModifier[];
  figurative: boolean;
  ambiguities: string[];
}

export type VisualFamily =
  | "causal_chain"
  | "process_flow"
  | "comparison"
  | "hierarchy_or_containment"
  | "spatial_map"
  | "quantitative_change"
  | "state_transformation"
  | "cycle"
  | "object_relation"
  | "concept_network"
  | "text_only";

export type VisualPrimitive =
  | "node"
  | "directed_edge"
  | "undirected_edge"
  | "container"
  | "lane"
  | "axis"
  | "value_marker"
  | "state_pair"
  | "cycle_edge"
  | "literal_object"
  | "annotation";

export interface UniversalVisualPlan {
  eligible: boolean;
  family: VisualFamily;
  primitives: VisualPrimitive[];
  composition: string;
  confidence: number;
  evidence: string[];
  unsupported: string[];
}

export interface ShadowThoughtResult {
  recordingId: string;
  thoughtId: string;
  text: string;
  sourceSegments: string[];
  current: {
    status: "text_only" | "pending" | "visual" | "model_fallback_unexecuted";
    family?: string;
    reason: string;
    visualIntent?: unknown;
  };
  experimental: {
    analysisText: string;
    contextThoughtIds: string[];
    graph: UniversalMeaningGraph;
    plan: UniversalVisualPlan;
  };
}
