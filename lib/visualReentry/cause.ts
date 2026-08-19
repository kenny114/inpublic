import type { CauseEffectEdge, CauseEffectIntent } from "./types";

export const CAUSE_UNCERTAINTY = /\b(?:maybe|might|could|possibly|perhaps|probably|may|i\s+think)\b/i;
export const CAUSE_NEGATION = /\b(?:not|never|no|isn['’]t|wasn['’]t|weren['’]t|doesn['’]t|didn['’]t|don['’]t|cannot|can['’]t)\b/i;
export const CAUSE_CORRECTION = /\b(?:i\s+thought|but\s+actually|actually\s+it\s+was|rather\s+than)\b/i;
export const TEMPORAL_ONLY = /\b(?:after|before|then|first|next|subsequently)\b/i;
export const CORRELATION_ONLY = /\b(?:correlat(?:e|ed|ion)|connected|associated|retain\s+better|relationship|coincid(?:e|ed))\b/i;
export const DEPENDENCY_ONLY = /\b(?:depends?\s+on|requires?|relies?\s+on|is\s+constrained\s+by|are\s+constrained\s+by|is\s+based\s+on|are\s+based\s+on|needs?)\b/i;

/** `bring in/out/up` is ordinary English, not "brings traffic". */
const BRING_CAUSAL = "brings?(?!\\s+(?:in|out|up|back|over|along|forward)\\b)|brought(?!\\s+(?:in|out|up|back)\\b)";
/**
 * Beyond the textbook causal verbs, natural speech about what a thing DOES
 * for the speaker is just as much a causal claim ("InPublic lets me explain
 * myself" is exactly as directed as "InPublic causes X") — these were the
 * missing cues across every real recording tried against this pipeline:
 * conversational self-description never once used "causes"/"leads to", but
 * routinely used "lets"/"means"/"allows"/"helps"/"enables".
 */
const NATURAL_CUE = "means?|meant|lets?|allows?|allowed|enables?|enabled|helps?|helped";
const RELATION_CUE = "handles?|handled|uses?|used|includes?|included|contains?|contained|shows?|showed|represents?|represented|decides?|decided|builds?|built|turns?\\s+into|turned\\s+into|becomes?|became|connects?\\s+to|connected\\s+to|is\\s+part\\s+of|are\\s+part\\s+of|is\\s+made\\s+of|are\\s+made\\s+of|consists?\\s+of";
const DIRECT_CUE = `causes?|caused|causing|leads?\\s+to|led\\s+to|results?\\s+in|resulted\\s+in|creates?|created|produces?|produced|${BRING_CAUSAL}|${NATURAL_CUE}|${RELATION_CUE}`;
export const EXPLICIT_CAUSAL_CUE = new RegExp(`\\b(?:${DIRECT_CUE}|because|therefore|due\\s+to)\\b`, "i");

const QUESTION_STEM = /^(?:what|why|how|when|where|who|whom|whose|which|should|could|would|can|do|does|did|will)\b/i;
const DANGLING_END = /\b(?:and|but|because|so|to|for|with|of|that|which|who|what|why|how|when|where|is|are|was|were|be|been|being|have|has|had|do|does|did|will|would|could|should|can|may|might|must|considering|thinking|put|give|bring|create|produce|implement|more)\s*$/i;
const PLANNING_FRAGMENT = /^(?:(?:and|so)\s+)?(?:(?:i(?:'m|\s+am)|we(?:'re|\s+are))\s+(?:considering|thinking)|(?:are|should|could|would)\s+(?:i|we)\s+(?:gonna|going\s+to)|the\s+idea\s+is\s+just|i(?:'m|\s+am)\s+also\s+thinking)\b/i;
const DISCOURSE_OPENER = /^(?:interestingly|basically|well|yeah|so)\s*,?\s*(?:i\s+was\s+like|i\s+mean|let\s+me\s+just|it['’]?s\s+like)?\b/i;
const PERSONAL_PRONOUN = /^(?:i|we|you|he|she|they|it)\b/i;
const EMPTY_DEMONSTRATIVE = /^(?:this|that|these|those)(?:\s+(?:is|are|was|were|seems?|means?))?(?:\s+(?:it|that|this|like|so|really|basically))*\s*$/i;
const TRIVIAL_POSSESSIVE_CLASSIFICATION = /^[^,.!?]{1,100}\b(?:is|are|was|were)\s+(?:our|my|your|their)\b/i;
const ACTION_LIST = /^(?:post|create|make|build|go|use|try|give|record|implement)\b[^,]{0,80},\s*(?:post|create|make|build|go|use|try|give|record|implement)\b/i;
const BARE_ACTION = /^(?:post|create|make|build|go|use|try|give|record|implement)$/i;
const REPAIR_FRAGMENT = /\b(?:it['’]?s\s+it\s+is|it['’]?s\s+it['’]?s|i\s+i|what\s+exactly\s+how\s+exactly|so\s+it['’]?s\s*,?\s*like)\b/i;
const FILLER_WORD = /^(?:so|it|its|it's|like|you|know|i|mean|basically|really|kind|sort|of|well|yeah|just|actually|and|the|a|an|is|are|was|were|for|that|this)$/i;

export interface ParsedCauseEffect {
  intent: CauseEffectIntent | null;
  reason: string;
  rejection?: "uncertain" | "negated" | "temporal" | "correlation" | "dependency" | "correction" | "incomplete" | "materiality" | "oversized" | "ambiguous";
}

/**
 * "InPublic lets me explain myself" is a real causal claim, but its effect
 * endpoint literally starts with a personal pronoun ("me explain myself" ->
 * after the cue word strips to "explain myself"... but "I can explain
 * myself" strips to nothing useful without this). Stripping a leading
 * pronoun subject + modal turns the effect into its actual content ("explain
 * myself") instead of failing the whole edge on PERSONAL_PRONOUN below —
 * every real recording tried against this pipeline described effects this
 * way ("so I can talk about things", "which lets me express myself").
 * Endpoints that are ONLY the pronoun (nothing left after stripping) still
 * fail PERSONAL_PRONOUN/EMPTY_DEMONSTRATIVE untouched.
 */
const LEADING_PRONOUN_SUBJECT = /^(?:(?:i|we|you)(?:['’](?:m|re|ve|ll|d))?\s+(?:can|could|will|would|am|are|is|get\s+to)|(?:me|us|you)(?:\s+to)?)\s+/i;

function clean(value: string): string {
  return value
    .trim()
    .replace(/^(?:and|that|which)\s+/i, "")
    .replace(/^[\s,;:.-]+|[\s,;:.!?-]+$/g, "")
    .trim()
    .replace(LEADING_PRONOUN_SUBJECT, "")
    .trim();
}

function display(value: string): string {
  const literal = clean(value);
  return literal ? `${literal[0].toUpperCase()}${literal.slice(1)}` : "";
}

function splitClauses(text: string): string[] {
  return text
    .split(new RegExp(`(?<=[.!?])\\s+|\\s*,\\s+and\\s+(?=[^,.!?]{1,100}\\b(?:${DIRECT_CUE})\\b)`, "i"))
    .map(clean)
    .filter(Boolean);
}

interface LiteralEdge { source: string; target: string; evidence: string }

interface EndpointCheck { safe: boolean; reason: string }

function words(value: string): string[] {
  return clean(value).toLowerCase().match(/[a-z0-9]+(?:['’][a-z]+)?/g) ?? [];
}

/**
 * This is intentionally a rejection filter, not a general English parser.
 * Cause/effect is admitted only when neither endpoint has one of the
 * high-confidence shapes observed in the natural-corpus false positives.
 */
function checkEndpoint(value: string): EndpointCheck {
  const endpoint = clean(value);
  const tokens = words(endpoint);
  if (!endpoint || tokens.length === 0) return { safe: false, reason: "empty causal endpoint" };
  if (endpoint.length > 160 || tokens.length > 24) return { safe: false, reason: "causal endpoint is too broad to be stable" };
  if (QUESTION_STEM.test(endpoint) || /\?$/.test(value.trim())) return { safe: false, reason: "unresolved question cannot be a causal endpoint" };
  if (PLANNING_FRAGMENT.test(endpoint) || DISCOURSE_OPENER.test(endpoint) || DANGLING_END.test(endpoint)) return { safe: false, reason: "unfinished causal endpoint" };
  if (REPAIR_FRAGMENT.test(endpoint) || ACTION_LIST.test(endpoint) || BARE_ACTION.test(endpoint)) return { safe: false, reason: "repair/action-list fragment cannot be a causal endpoint" };
  if (EMPTY_DEMONSTRATIVE.test(endpoint) || PERSONAL_PRONOUN.test(endpoint)) return { safe: false, reason: "causal endpoint has an unresolved referent" };
  const content = tokens.filter((token) => !FILLER_WORD.test(token));
  if (content.length === 0 || content.length * 2 < tokens.length && content.length < 2) {
    return { safe: false, reason: "causal endpoint is primarily filler" };
  }
  return { safe: true, reason: "complete content-bearing endpoint" };
}

function checkEdge(edge: LiteralEdge): EndpointCheck {
  const source = checkEndpoint(edge.source);
  if (!source.safe) return source;
  const target = checkEndpoint(edge.target);
  if (!target.safe) return target;
  if (TRIVIAL_POSSESSIVE_CLASSIFICATION.test(edge.source) && /\bbecause\b/i.test(edge.evidence)) {
    return { safe: false, reason: "trivial possessive explanation is not material enough for a causal visual" };
  }
  return { safe: true, reason: "complete explicit causal edge" };
}

function parseClause(clause: string): LiteralEdge | null {
  const reasonWas = /^the\s+reason\s+(.+?)\s+was\s+that\s+(.+)$/i.exec(clause);
  if (reasonWas) return { source: clean(reasonWas[2]), target: clean(reasonWas[1]), evidence: clause };

  const becauseFront = /^because\s+(.+?),\s*(.+)$/i.exec(clause);
  if (becauseFront) return { source: clean(becauseFront[1]), target: clean(becauseFront[2]), evidence: clause };

  const becauseReverse = /^(.+?)\s+because\s+(.+)$/i.exec(clause);
  if (becauseReverse) return { source: clean(becauseReverse[2]), target: clean(becauseReverse[1]), evidence: clause };

  const dueTo = /^(.+?)\s+(?:was\s+|is\s+)?due\s+to\s+(.+)$/i.exec(clause);
  if (dueTo) return { source: clean(dueTo[2]), target: clean(dueTo[1]), evidence: clause };

  // `so` is intentionally not deterministic in V2. Natural discourse uses it
  // far more often as filler than as a stable consequence boundary.
  const consequence = /^(.+?)[,;]\s*therefore\s+(.+)$/i.exec(clause);
  if (consequence) return { source: clean(consequence[1]), target: clean(consequence[2]), evidence: clause };

  const direct = new RegExp(`^(.+?)\\s+(${DIRECT_CUE})\\s+(.+)$`, "i").exec(clause);
  if (direct) {
    const source = clean(direct[1]);
    if (BARE_ACTION.test(source)) return null;
    return { source, target: clean(direct[3]), evidence: clause };
  }
  return null;
}

function conceptKey(value: string): string {
  return clean(value)
    .toLowerCase()
    .replace(/^(?:the|a|an|more)\s+/, "")
    .replace(/\b(?:that|this)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function compatibleConcept(left: string, right: string): boolean {
  const a = conceptKey(left);
  const b = conceptKey(right);
  if (!a || !b) return false;
  if (a === b || a.endsWith(` ${b}`) || b.endsWith(` ${a}`)) return true;
  const aw = new Set(a.split(/\s+/));
  const bw = new Set(b.split(/\s+/));
  const overlap = [...aw].filter((word) => word.length > 3 && bw.has(word));
  return overlap.length > 0 && (aw.size <= 3 || bw.size <= 3);
}

function hasCycle(nodeCount: number, edges: CauseEffectEdge[]): boolean {
  const visiting = new Set<number>();
  const visited = new Set<number>();
  const visit = (node: number): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const edge of edges) if (edge.from === node && visit(edge.to)) return true;
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  return Array.from({ length: nodeCount }, (_, index) => index).some(visit);
}

/** Small, explicit grammar recognizer. It deliberately returns null for prose that merely implies a relationship. */
export function parseExplicitCauseEffect(text: string): ParsedCauseEffect {
  const spoken = text.trim();
  if (CAUSE_CORRECTION.test(spoken)) return { intent: null, reason: "correction/revision discourse fails closed", rejection: "correction" };
  if (CAUSE_UNCERTAINTY.test(spoken)) return { intent: null, reason: "uncertain causal modality is not representable", rejection: "uncertain" };
  if (CAUSE_NEGATION.test(spoken) && EXPLICIT_CAUSAL_CUE.test(spoken)) return { intent: null, reason: "negation near causal language fails closed", rejection: "negated" };
  if (DEPENDENCY_ONLY.test(spoken)) return { intent: null, reason: "dependency/constraint is not causality", rejection: "dependency" };
  if (/\bfirst(?:ly)?\b[\s\S]{0,240}\b(?:then|next|finally)\b/i.test(spoken) && !EXPLICIT_CAUSAL_CUE.test(spoken)) {
    return { intent: null, reason: "temporal order is not causality", rejection: "temporal" };
  }

  const clauses = splitClauses(spoken);
  const literalEdges = clauses.map(parseClause).filter((edge): edge is LiteralEdge => edge !== null);
  if (literalEdges.length === 0) {
    if (TEMPORAL_ONLY.test(spoken)) return { intent: null, reason: "temporal order is not causality", rejection: "temporal" };
    if (CORRELATION_ONLY.test(spoken)) return { intent: null, reason: "correlation/association is not causality", rejection: "correlation" };
    return { intent: null, reason: EXPLICIT_CAUSAL_CUE.test(spoken) ? "causal direction is not safely recoverable" : "no explicit causal cue", rejection: "ambiguous" };
  }
  if (literalEdges.length > 3) return { intent: null, reason: "causal explanation exceeds three edges", rejection: "oversized" };

  for (const edge of literalEdges) {
    const safety = checkEdge(edge);
    if (!safety.safe) {
      const materiality = safety.reason.includes("material enough");
      return { intent: null, reason: safety.reason, rejection: materiality ? "materiality" : "incomplete" };
    }
  }

  const nodes: string[] = [];
  const nodeIndex = (literal: string): number => {
    const existing = nodes.findIndex((node) => compatibleConcept(node, literal));
    if (existing >= 0) return existing;
    nodes.push(display(literal));
    return nodes.length - 1;
  };
  const edges = literalEdges.map((edge) => ({ from: nodeIndex(edge.source), to: nodeIndex(edge.target), evidence: edge.evidence }));
  if (nodes.length < 2 || nodes.length > 4 || edges.some((edge) => edge.from === edge.to) || hasCycle(nodes.length, edges)) {
    return { intent: null, reason: "causal graph is empty, oversized, self-referential, or cyclic", rejection: "oversized" };
  }
  return {
    intent: { type: "cause_effect", nodes, edges, evidence: literalEdges.map((edge) => edge.evidence) },
    reason: `${edges.length} explicit directed causal edge${edges.length === 1 ? "" : "s"} with literal cues`,
  };
}

export function causeEdgesFormChain(intent: CauseEffectIntent): boolean {
  if (intent.edges.length < 2) return false;
  return intent.edges.every((edge, index) => index === 0 || intent.edges[index - 1].to === edge.from);
}
