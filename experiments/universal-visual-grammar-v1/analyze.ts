import type {
  ActionKind,
  EdgeKind,
  MeaningAction,
  MeaningEdge,
  MeaningModifier,
  MeaningNode,
  NodeKind,
  UniversalMeaningGraph,
  UniversalVisualPlan,
  VisualFamily,
  VisualPrimitive,
} from "./schema.ts";

const ABSTRACT = new Set(
  "idea meaning relationship structure priority feedback retention onboarding revenue churn latency usage cost control result process speech transcript energy traffic sign ups photosynthesis audience".split(" "),
);
const ORGANIZATION = /\b(?:team|company|organization|department|division|marketing|sales|deepgram|inpublic)\b/i;
const PLACE = /\b(?:air|soil|website|canvas|room|page|inside|outside|home|office|market)\b/i;
const PERSON = /\b(?:i|we|you|he|she|they|customer|customers|tester|testers|people|speaker|team)\b/i;
const OBJECT = /\b(?:plant|sunlight|carbon dioxide|water|glucose|oxygen|data|model|plan|payments|box|boxes|arrow|arrows|video|videos|website)\b/i;
const EVENT = /\b(?:launch|month|day|today|yesterday|setup|win|challenge)\b/i;
const STATE = /\b(?:finished|complete|cancelled|weak|better|cheaper|faster|interesting|shocked|embarrassed)\b/i;
const FIGURATIVE = /\b(?:like a|like an|as if|metaphorically|bottleneck|grinding|moving forward|flow of ideas|roadmap)\b/i;
const UNCERTAINTY = /\b(?:maybe|perhaps|possibly|probably|might|could|may|i don'?t know|still deciding|about|around|roughly|approximately|something)\b/i;

function compact(value: string, max = 86): string {
  return value
    .replace(/^[\s,;:.!?-]+|[\s,;:.!?-]+$/g, "")
    .replace(/^(?:and|but|so|first|then|next|finally|after that|once that(?:'s| is) finished)[,:]?\s+/i, "")
    .replace(/\s+/g, " ")
    .slice(0, max)
    .trim();
}

function canonical(value: string): string {
  return compact(value).toLowerCase().replace(/\b(?:the|a|an|our|my|their|this|that)\b/g, " ").replace(/\s+/g, " ").trim();
}

function nodeKind(label: string): NodeKind {
  if (/^-?\d[\d,.]*(?:%|k|m)?$/i.test(label)) return "value";
  if (ORGANIZATION.test(label)) return "organization";
  if (PLACE.test(label)) return "place";
  if (PERSON.test(label)) return "person";
  if (OBJECT.test(label)) return "object";
  if (EVENT.test(label)) return "event";
  if (STATE.test(label)) return "state";
  const words = canonical(label).split(" ");
  return words.some((word) => ABSTRACT.has(word)) ? "concept" : "concept";
}

function sentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]?/g)?.map((value) => value.trim()).filter(Boolean) ?? [];
}

function isNegatedCausality(value: string): boolean {
  return /\b(?:not|isn'?t|wasn'?t|don'?t|doesn'?t|didn'?t|no evidence|unknown|unclear)\b[\s\S]{0,45}\b(?:cause|caused|causes|because|lead|led|result)/i.test(value) ||
    /\bi (?:don'?t|didn'?t) know(?: if)?\b/i.test(value);
}

export function buildMeaningGraph(sourceText: string): UniversalMeaningGraph {
  const nodes: MeaningNode[] = [];
  const edges: MeaningEdge[] = [];
  const actions: MeaningAction[] = [];
  const modifiers: MeaningModifier[] = [];
  const ambiguities: string[] = [];
  const figurative = FIGURATIVE.test(sourceText);
  const byLabel = new Map<string, MeaningNode>();

  const node = (raw: string, evidence: string, confidence = 0.82): MeaningNode | null => {
    const label = compact(raw);
    const key = canonical(label);
    if (!key || key.length < 2 || /^(?:it|that|this|one|other|something|what happened)$/i.test(key)) return null;
    const existing = byLabel.get(key);
    if (existing) return existing;
    const result: MeaningNode = { id: `n${nodes.length + 1}`, label, kind: nodeKind(label), evidence, confidence };
    nodes.push(result);
    byLabel.set(key, result);
    return result;
  };
  const edge = (kind: EdgeKind, fromRaw: string, toRaw: string, evidence: string, confidence = 0.82) => {
    const from = node(fromRaw, evidence, confidence);
    const to = node(toRaw, evidence, confidence);
    if (!from || !to || from.id === to.id) return;
    if (edges.some((item) => item.kind === kind && item.from === from.id && item.to === to.id)) return;
    edges.push({ id: `e${edges.length + 1}`, kind, from: from.id, to: to.id, evidence, confidence, figurative: figurative && FIGURATIVE.test(evidence) });
  };
  const action = (kind: ActionKind, actorRaw: string | undefined, targetRaw: string | undefined, evidence: string, extra: Partial<MeaningAction> = {}) => {
    const actor = actorRaw ? node(actorRaw, evidence)?.id : undefined;
    const target = targetRaw ? node(targetRaw, evidence)?.id : undefined;
    actions.push({ id: `a${actions.length + 1}`, kind, actor, target, evidence, confidence: 0.78, figurative: figurative && FIGURATIVE.test(evidence), ...extra });
  };

  if (UNCERTAINTY.test(sourceText)) {
    const match = sourceText.match(UNCERTAINTY)?.[0] ?? "uncertain";
    modifiers.push({ kind: "certainty", value: "qualified", evidence: match });
  }
  for (const match of sourceText.matchAll(/\b(?:main|top|next)\s+(?:thing|priority|goal|reason)s?\b/gi)) {
    modifiers.push({ kind: "importance", value: match[0].toLowerCase(), evidence: match[0] });
  }
  for (const match of sourceText.matchAll(/\b(first|second|third|then|next|after that|finally|before|after|once)\b/gi)) {
    modifiers.push({ kind: "order", value: match[1].toLowerCase(), evidence: match[0] });
  }
  for (const match of sourceText.matchAll(/\b(today|yesterday|before|after|first month|last month|right now)\b/gi)) {
    modifiers.push({ kind: "time", value: match[1].toLowerCase(), evidence: match[0] });
  }
  for (const match of sourceText.matchAll(/\b(about|around|roughly|approximately)?\s*(\d[\d,]*(?:\.\d+)?)\s*(%|percent|followers?|testers?|customers?|sign[- ]?ups?)?\b/gi)) {
    const value = Number(match[2].replace(/,/g, ""));
    modifiers.push({ kind: "quantity", value, evidence: match[0] });
    node(match[0], match[0], match[1] ? 0.72 : 0.9);
  }
  const wordNumbers: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10 };
  for (const match of sourceText.matchAll(/\b(one|two|three|four|five|ten)\s+(followers?|testers?|customers?|steps?|things?|options?)\b/gi)) {
    modifiers.push({ kind: "quantity", value: wordNumbers[match[1].toLowerCase()], evidence: match[0] });
  }

  for (const sentence of sentences(sourceText)) {
    if (isNegatedCausality(sentence)) {
      ambiguities.push(`Causal claim withheld by source uncertainty: ${sentence}`);
    } else {
      const causalPatterns: Array<{ re: RegExp; reverse?: boolean; confidence?: number }> = [
        { re: /^(.{2,100}?)\s+\b(?:causes?|creates?|produces?|drives?|leads?\s+to|results?\s+in|gives?\s+rise\s+to)\b\s+(.{2,110})$/i, confidence: 0.9 },
        { re: /^(.{2,100}?)\s+came\s+from\s+(.{2,110})$/i, reverse: true, confidence: 0.84 },
        { re: /^(.{2,100}?)[,;]\s+so\s+(.{2,110})$/i, confidence: 0.76 },
        { re: /^(.{2,100}?)\s+because\s+(.{2,110})$/i, reverse: true, confidence: 0.88 },
      ];
      for (const pattern of causalPatterns) {
        const match = pattern.re.exec(sentence);
        if (match) edge("causes", pattern.reverse ? match[2] : match[1], pattern.reverse ? match[1] : match[2], sentence, pattern.confidence);
      }
    }

    const dependency = /^(?:before\s+)?(.{2,90}?)\s+(?:depends?\s+on|requires?|needs?\s+to\s+finish)\s+(.{2,90})$/i.exec(sentence);
    if (dependency) edge("depends_on", dependency[1], dependency[2], sentence, 0.84);

    const containmentPatterns: Array<[RegExp, EdgeKind, boolean]> = [
      [/^(.{2,80}?)\s+(?:is|are)\s+part\s+of\s+(.{2,80})$/i, "part_of", false],
      [/^(.{2,80}?)\s+belongs?\s+to\s+(.{2,80})$/i, "belongs_to", false],
      [/^(.{2,80}?)\s+contains?\s+(.{2,80})$/i, "contains", false],
    ];
    for (const [re, kind] of containmentPatterns) {
      const match = re.exec(sentence);
      if (match) edge(kind, match[1], match[2], sentence, 0.9);
    }

    const spatialPatterns: Array<[RegExp, EdgeKind]> = [
      [/^(.{2,70}?)\s+(?:is|are|appears?|sits?)\s+inside\s+(.{2,70})$/i, "inside"],
      [/^(.{2,70}?)\s+(?:is|are|appears?|sits?)\s+above\s+(.{2,70})$/i, "above"],
      [/^(.{2,70}?)\s+(?:is|are|appears?|sits?)\s+below\s+(.{2,70})$/i, "below"],
      [/^(.{2,70}?)\s+(?:is|are|appears?|sits?)\s+(?:near|beside|besides)\s+(.{2,70})$/i, "near"],
      [/^(.{2,70}?)\s+(?:is|are|appears?|sits?)\s+between\s+(.{2,35}?)\s+and\s+(.{2,35})$/i, "between"],
    ];
    for (const [re, kind] of spatialPatterns) {
      const match = re.exec(sentence);
      if (match) {
        edge(kind, match[1], match[2], sentence, 0.9);
        if (kind === "between" && match[3]) edge(kind, match[1], match[3], sentence, 0.9);
      }
    }

    const transform = /^(.{2,80}?)\s+(?:becomes?|changes?\s+into|turns?\s+into|transforms?\s+into)\s+(.{2,80})$/i.exec(sentence);
    if (transform) {
      edge("changes_into", transform[1], transform[2], sentence, 0.91);
      action("transform", transform[1], transform[2], sentence);
    }

    const comparison = /^(.{2,70}?)\s+(?:is|are)\s+(cheaper|faster|slower|better|worse|larger|smaller|more expensive|less expensive)\s+than\s+(.{2,70})$/i.exec(sentence);
    if (comparison) {
      edge("compares_with", comparison[1], comparison[3], sentence, 0.9);
      modifiers.push({ kind: "intensity", value: comparison[2].toLowerCase(), evidence: comparison[2] });
    }
    if (/\bcompared\s+to\b/i.test(sentence)) {
      const match = /compared\s+to\s+([^,]+),?\s+(.+?)\s+(?:was|is)\s+(.+)/i.exec(sentence);
      if (match) edge("compares_with", match[1], match[2], sentence, 0.83);
    }

    const fromTo = /\b(?:grew|rose|increased|climbed|fell|dropped|decreased|declined)?\s*from\s+(about\s+|around\s+|roughly\s+|approximately\s+)?(\d[\d,]*(?:\.\d+)?)\s*([a-z% -]{0,20}?)\s+to\s+(about\s+|around\s+|roughly\s+|approximately\s+)?(\d[\d,]*(?:\.\d+)?)\s*([a-z% -]{0,20})/i.exec(sentence);
    if (fromTo) {
      const from = Number(fromTo[2].replace(/,/g, ""));
      const to = Number(fromTo[5].replace(/,/g, ""));
      action(to >= from ? "increase" : "decrease", undefined, undefined, sentence, { value: to - from, direction: to >= from ? "up" : "down", unit: compact(fromTo[6] || fromTo[3], 20) || undefined, confidence: fromTo[4] ? 0.76 : 0.9 });
    }

    const verbPattern = /^(?:and\s+|but\s+)?(.{1,70}?)\s+(grew|grows|declined|declines|fell|falls|moved|moves|created|creates|removed|removes|combined|combines|split|splits|started|starts|stopped|stops|increased|increases|decreased|decreases|transformed|transforms|repeated|repeats|absorbs|takes|uses|releases|collect|collects|clean|cleans|train|trains|optimize|optimizes|prepare|prepares|cancelled|cancels)\s*(.*)$/i.exec(sentence);
    if (verbPattern) {
      const map: Record<string, ActionKind> = {
        grew: "grow", grows: "grow", declined: "decline", declines: "decline", fell: "decline", falls: "decline",
        moved: "move", moves: "move", created: "create", creates: "create", removed: "remove", removes: "remove",
        combined: "combine", combines: "combine", split: "split", splits: "split", started: "start", starts: "start",
        stopped: "stop", stops: "stop", increased: "increase", increases: "increase", decreased: "decrease", decreases: "decrease",
        transformed: "transform", transforms: "transform", repeated: "repeat", repeats: "repeat", absorbs: "combine", takes: "move",
        uses: "combine", releases: "create", collect: "create", collects: "create", clean: "transform", cleans: "transform",
        train: "transform", trains: "transform", optimize: "transform", optimizes: "transform", prepare: "create", prepares: "create",
        cancelled: "stop", cancels: "stop",
      };
      const verb = verbPattern[2].toLowerCase();
      action(map[verb], verbPattern[1], verbPattern[3] || undefined, sentence, map[verb] === "move" ? { direction: "toward" } : {});
    }
  }

  const orderedClauses = sentences(sourceText)
    .filter((value) => /^(?:first|then|next|after that|finally|once)/i.test(value.trim()))
    .map((value) => compact(value));
  for (let index = 0; index < orderedClauses.length - 1; index += 1) {
    edge("before", orderedClauses[index], orderedClauses[index + 1], sourceText, 0.93);
  }

  const optionA = /\boption\s+a\b/i.exec(sourceText);
  const optionB = /\boption\s+b\b/i.exec(sourceText);
  if (optionA && optionB) edge("compares_with", optionA[0], optionB[0], sourceText, 0.95);

  if (figurative) ambiguities.push("Figurative language detected; literal geometry must not be inferred without corroboration.");
  return { sourceText, nodes, edges, actions, modifiers, figurative, ambiguities };
}

function confidenceFor(graph: UniversalMeaningGraph, family: VisualFamily): number {
  if (family === "text_only") return 0.35;
  const structural = graph.edges.length * 0.08 + graph.actions.length * 0.05 + graph.modifiers.length * 0.02;
  const uncertainty = graph.ambiguities.length * 0.08 + (graph.figurative ? 0.08 : 0);
  return Math.max(0.45, Math.min(0.96, 0.63 + structural - uncertainty));
}

export function planVisual(graph: UniversalMeaningGraph): UniversalVisualPlan {
  const edgeKinds = new Set(graph.edges.map((item) => item.kind));
  const actionKinds = new Set(graph.actions.map((item) => item.kind));
  const concreteNodes = graph.nodes.filter((item) => item.kind === "object" || item.kind === "person" || item.kind === "place");
  const quantities = graph.modifiers.filter((item) => item.kind === "quantity");
  let family: VisualFamily = "text_only";
  let primitives: VisualPrimitive[] = [];
  let composition = "Keep the settled thought as text; the graph has no sufficiently grounded visual structure.";

  if (edgeKinds.has("causes")) {
    family = "causal_chain";
    primitives = ["node", "directed_edge", "annotation"];
    composition = "Lay causes left-to-right toward effects; keep uncertainty as an explicit annotation, never an arrow.";
  } else if (edgeKinds.has("before") || graph.modifiers.filter((item) => item.kind === "order").length >= 2) {
    family = "process_flow";
    primitives = ["node", "directed_edge", "lane"];
    composition = "Lay ordered events left-to-right in one lane, preserving spoken order without inventing missing steps.";
  } else if (edgeKinds.has("compares_with") || edgeKinds.has("opposes")) {
    family = "comparison";
    primitives = ["lane", "node", "annotation"];
    composition = "Use two aligned lanes; attach only explicitly supported properties to their named side.";
  } else if (["contains", "part_of", "belongs_to"].some((kind) => edgeKinds.has(kind as EdgeKind))) {
    family = "hierarchy_or_containment";
    primitives = ["container", "node", "directed_edge"];
    composition = "Nest contained nodes or draw parent-child edges according to the literal relation.";
  } else if (["inside", "above", "below", "between", "near", "moves_toward", "moves_away_from"].some((kind) => edgeKinds.has(kind as EdgeKind))) {
    family = "spatial_map";
    primitives = ["node", "container", "directed_edge", "literal_object"];
    composition = "Place entities according to explicit spatial predicates only; do not convert metaphorical direction into position.";
  } else if (quantities.length >= 2 || actionKinds.has("increase") || actionKinds.has("decrease") || actionKinds.has("grow") || actionKinds.has("decline")) {
    family = "quantitative_change";
    primitives = ["axis", "value_marker", "directed_edge", "annotation"];
    composition = "Show anchored values or a qualified direction; preserve approximate language on its value marker.";
  } else if (edgeKinds.has("changes_into") || actionKinds.has("transform") || actionKinds.has("combine") || actionKinds.has("split")) {
    family = "state_transformation";
    primitives = ["state_pair", "directed_edge", "literal_object"];
    composition = "Show before/after states with the supported transformation on the connecting edge.";
  } else if (actionKinds.has("repeat")) {
    family = "cycle";
    primitives = ["node", "cycle_edge"];
    composition = "Close the path only because repetition is explicit in the source.";
  } else if (graph.edges.length > 0 && concreteNodes.length > 0) {
    family = "object_relation";
    primitives = ["literal_object", "node", "directed_edge"];
    composition = "Use simple object tokens and grounded relations; labels carry distinctions the token cannot safely depict.";
  } else if (graph.edges.length > 0 || graph.actions.length > 0) {
    family = "concept_network";
    primitives = ["node", "directed_edge", "annotation"];
    composition = "Use labeled concept nodes and typed edges; avoid literal-object styling for abstract concepts.";
  }

  const confidence = confidenceFor(graph, family);
  const unsupported = [...graph.ambiguities];
  if (graph.figurative) unsupported.push("No literal spatial or object mutation for figurative phrases.");
  if (family === "text_only" && graph.nodes.length > 0) unsupported.push("Named entities alone do not justify a diagram.");
  return {
    eligible: family !== "text_only" && confidence >= 0.55,
    family,
    primitives,
    composition,
    confidence: Number(confidence.toFixed(2)),
    evidence: [...new Set([...graph.edges.map((item) => item.evidence), ...graph.actions.map((item) => item.evidence)])].slice(0, 8),
    unsupported,
  };
}

export function analyzeThought(text: string): { graph: UniversalMeaningGraph; plan: UniversalVisualPlan } {
  const graph = buildMeaningGraph(text);
  return { graph, plan: planVisual(graph) };
}
