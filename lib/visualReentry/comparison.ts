import type { ComparisonIntent, ComparisonRow } from "./types";

export const COMPARISON_UNCERTAINTY = /\b(?:i\s+think|maybe|might|could|possibly|perhaps|probably|apparently|may)\b/i;
export const COMPARISON_NEGATION = /\b(?:not|never|isn['’]t|aren['’]t|wasn['’]t|weren['’]t|doesn['’]t|didn['’]t|don['’]t|cannot|can['’]t)\b/i;
export const COMPARISON_CORRECTION = /\b(?:i\s+thought|but\s+actually|actually\s+it\s+was|rather\s+than)\b/i;
export const EXPLICIT_COMPARISON_CUE = /\b(?:while|whereas|compared\s+(?:with|to)|versus|vs\.?|unlike|on\s+the\s+other\s+hand|in\s+contrast|better\s+than|faster\s+than|cheaper\s+than|more\s+\w+\s+than|less\s+\w+\s+than|solve(?:s|d)?\s+(?:the\s+problem\s+)?differently)\b/i;
export const COMPARISON_COOCCURRENCE = /\b(?:looking\s+at|testing|using|use|work(?:ing)?\s+with|considering)\b[\s\S]{0,100}\band\b/i;

export interface ParsedComparison {
  intent: ComparisonIntent | null;
  reason: string;
  rejection?: "cooccurrence" | "uncertain" | "negated" | "correction" | "subjects" | "claims" | "oversized";
}

interface SubjectClaims {
  label: string;
  claims: string[];
  evidence: string[];
}

function clean(value: string): string {
  return value.trim().replace(/^[\s,;:.-]+|[\s,;:.!?-]+$/g, "").trim();
}

function display(value: string): string {
  const literal = clean(value);
  return literal ? `${literal[0].toUpperCase()}${literal.slice(1)}` : "";
}

function labelKey(value: string): string {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function validSubject(value: string): boolean {
  const subject = clean(value);
  if (!subject || subject.split(/\s+/).length > 4 || subject.length > 40) return false;
  if (/^(?:i|we|you|he|she|it|they|this|that|there|price|revenue|users?)$/i.test(subject)) return false;
  return /^(?:(?:option|plan|product|model|approach|strategy)\s+[a-z0-9]+|claude|gemini|stripe|paypal|[a-z])$/i.test(subject) || /^[A-Z][\w.-]*(?:\s+[A-Z][\w.-]*){0,2}$/.test(subject);
}

function normalizedClaim(verb: string, payload: string): string {
  const literal = clean(payload).replace(/^(?:really|clearly)\s+/i, "");
  if (!literal) return "";
  if (/^(?:costs?|gives?|offers?|provides?|performs?|tends?)$/i.test(verb)) return display(`${verb} ${literal}`);
  return display(literal);
}

function splitLiteralClaims(verb: string, payload: string): string[] {
  const parts = clean(payload)
    .split(/\s+and\s+(?=(?:more|less|better|faster|slower|cheaper|easier|harder|larger|smaller|strong|powerful|simple|reliable|flexible|\$?\d))/i)
    .map((part) => normalizedClaim(verb, part))
    .filter(Boolean);
  return parts.length <= 4 ? parts : [];
}

function parseSubjectClause(raw: string, inherited?: string): SubjectClaims | null {
  const clause = clean(raw)
    .replace(/^but\s+/i, "")
    .replace(/^(?:and\s+)?(?:in\s+contrast|on\s+the\s+other\s+hand)[,\s]*/i, "")
    .replace(/^(.{1,40}?),\s*(?:in\s+contrast|on\s+the\s+other\s+hand),?\s*/i, "$1 ")
    .replace(/^with\s+/i, "");
  const full = /^(.{1,40}?)\s+(is|are|has|have|costs?|gives?|offers?|provides?|performs?|tends\s+to\s+give)\s+(.+)$/i.exec(clause);
  const inheritedClause = inherited ? /^(?:it\s+)?(is|has|costs?|gives?|offers?|provides?)\s+(.+)$/i.exec(clause) : null;
  const useInherited = Boolean(inheritedClause);
  const label = useInherited ? inherited ?? "" : full ? clean(full[1]) : "";
  const verb = useInherited ? inheritedClause?.[1] ?? "" : full?.[2] ?? "";
  const payload = useInherited ? inheritedClause?.[2] ?? "" : full?.[3] ?? "";
  if (!validSubject(label) || !verb || !payload) return null;

  const subclauses = payload.split(/\s*,?\s+but\s+(?=(?:it\s+)?(?:is|has|costs?|gives?|offers?|provides?)\b)/i);
  const claims = splitLiteralClaims(verb, subclauses[0]);
  const evidence = claims.map(() => clause);
  for (const tail of subclauses.slice(1)) {
    const parsedTail = parseSubjectClause(tail, label);
    if (!parsedTail) return null;
    claims.push(...parsedTail.claims);
    evidence.push(...parsedTail.evidence);
  }
  return claims.length ? { label: display(label), claims, evidence } : null;
}

function splitContrastSegments(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\s*,?\s+(?:while|whereas)\s+|\s*;\s*|\s*,\s+but\s+(?=(?:option|plan|product|model|approach|strategy|claude|gemini|[A-Z])\b)/i)
    .map(clean)
    .filter(Boolean);
}

function splitAndSubjects(segment: string): string[] {
  const pair = /^(.+?\b(?:is|are|has|have|costs?|gives?|offers?|provides?)\b.+?)\s+and\s+((?:option|plan|product|model|approach|strategy)\s+[a-z0-9]+\s+(?:is|are|has|have|costs?|gives?|offers?|provides?)\b.+)$/i.exec(segment);
  return pair ? [clean(pair[1]), clean(pair[2])] : [segment];
}

function comparativeThan(text: string): ComparisonIntent | null {
  const match = /^(.{1,40}?)\s+is\s+(.+?\bthan)\s+(.{1,40}?)$/i.exec(clean(text));
  if (!match || !validSubject(match[1]) || !validSubject(match[3])) return null;
  const leftLabel = display(match[1]);
  const rightLabel = display(match[3]);
  const claim = display(`${match[2]} ${match[3]}`);
  return { type: "comparison", leftLabel, rightLabel, rows: [{ left: claim, evidence: [clean(text)] }], evidence: [clean(text)] };
}

function pairedRows(left: SubjectClaims, right: SubjectClaims): ComparisonRow[] {
  const count = Math.max(left.claims.length, right.claims.length);
  return Array.from({ length: count }, (_, index) => ({
    ...(left.claims[index] ? { left: left.claims[index] } : {}),
    ...(right.claims[index] ? { right: right.claims[index] } : {}),
    evidence: [left.evidence[index], right.evidence[index]].filter((value): value is string => Boolean(value)),
  }));
}

function sameEntityClass(left: string, right: string): boolean {
  const prefix = (value: string) => /^(option|plan|product|model|approach|strategy)\b/i.exec(value)?.[1]?.toLowerCase();
  return Boolean(prefix(left) && prefix(left) === prefix(right));
}

/** Conservative literal extractor for exactly two explicitly contrasted subjects. */
export function parseExplicitComparison(text: string): ParsedComparison {
  const spoken = text.trim();
  if (COMPARISON_CORRECTION.test(spoken)) return { intent: null, reason: "comparison correction/revision fails closed", rejection: "correction" };
  if (COMPARISON_UNCERTAINTY.test(spoken)) return { intent: null, reason: "uncertain comparison modality is not representable", rejection: "uncertain" };
  if (COMPARISON_NEGATION.test(spoken) && (EXPLICIT_COMPARISON_CUE.test(spoken) || /\bcompar/i.test(spoken))) {
    return { intent: null, reason: "negated comparison fails closed", rejection: "negated" };
  }

  const relational = comparativeThan(spoken);
  if (relational) return { intent: relational, reason: "literal one-sided comparative relation" };

  const parsed: SubjectClaims[] = [];
  let inheritedLabel: string | undefined;
  for (const segment of splitContrastSegments(spoken).flatMap(splitAndSubjects)) {
    const entry = parseSubjectClause(segment, /^(?:but\s+)?it\s+/i.test(segment) ? inheritedLabel : undefined);
    if (!entry) continue;
    parsed.push(entry);
    inheritedLabel = entry.label;
  }
  const groups: SubjectClaims[] = [];
  for (const entry of parsed) {
    const existing = groups.find((group) => labelKey(group.label) === labelKey(entry.label));
    if (existing) {
      existing.claims.push(...entry.claims);
      existing.evidence.push(...entry.evidence);
    } else groups.push({ ...entry, claims: [...entry.claims], evidence: [...entry.evidence] });
  }
  if (groups.length !== 2) {
    if (COMPARISON_COOCCURRENCE.test(spoken) || /\b(?:claude|gemini|stripe|paypal)\b[\s\S]{0,80}\band\b/i.test(spoken)) {
      return { intent: null, reason: "two subjects merely co-occur without an explicit contrast", rejection: "cooccurrence" };
    }
    return { intent: null, reason: "comparison requires exactly two stable subjects", rejection: "subjects" };
  }
  const [left, right] = groups;
  const costsPair = left.claims.some((claim) => /^Costs?\b/i.test(claim)) && right.claims.some((claim) => /^Costs?\b/i.test(claim));
  const explicit = EXPLICIT_COMPARISON_CUE.test(spoken) || /\bbut\b/i.test(spoken) || costsPair || sameEntityClass(left.label, right.label);
  if (!explicit) return { intent: null, reason: "two claims lack explicit comparative/contrast structure", rejection: "cooccurrence" };
  const rows = pairedRows(left, right);
  if (rows.length < 1 || rows.length > 4) return { intent: null, reason: "comparison exceeds the four-row compact limit", rejection: "oversized" };
  return {
    intent: { type: "comparison", leftLabel: left.label, rightLabel: right.label, rows, evidence: [...left.evidence, ...right.evidence] },
    reason: `${rows.length} literal comparison row${rows.length === 1 ? "" : "s"} across two explicit subjects`,
  };
}

/** Narrow opener used only by the comparison evidence window; it never calls a model or renders alone. */
export function parseComparisonOpener(text: string): SubjectClaims | null {
  const parsed = parseSubjectClause(text);
  if (!parsed) return null;
  return /^(?:option|plan|product|model|approach|strategy)\s+/i.test(parsed.label) || /^(?:claude|gemini)$/i.test(parsed.label) ? parsed : null;
}
