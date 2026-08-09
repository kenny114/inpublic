export const INITIAL_COMPOSITION_WINDOW_MS = 60_000;
export const MAX_VISIBLE_CONCEPTS = 6; // one primary + five supporting
export const MAX_VISIBLE_RELATIONSHIPS = 3;
export const MAX_TEMPORARY_SCRIBE_MARKS = 8;

export function withinInitialCompositionWindow(sessionMs: number): boolean {
  return sessionMs >= 0 && sessionMs < INITIAL_COMPOSITION_WINDOW_MS;
}

export function visibleConceptBudgetReached(visibleConcepts: number): boolean {
  return visibleConcepts >= MAX_VISIBLE_CONCEPTS;
}

export function visibleRelationshipBudgetReached(visibleRelationships: number): boolean {
  return visibleRelationships >= MAX_VISIBLE_RELATIONSHIPS;
}

export function temporaryMarkBudgetReached(temporaryMarks: number): boolean {
  return temporaryMarks >= MAX_TEMPORARY_SCRIBE_MARKS;
}

export interface CompositionMeaning {
  primary: string;
  supporting: string[];
  relationships: Array<{ from: string; to: string; label?: string }>;
  suppressed: string[];
}

/** Pure reference policy used by regression tests and the Board's count gates. */
export function composeAttentionBudget(
  concepts: string[],
  relationships: Array<{ from: string; to: string; label?: string }>,
): CompositionMeaning {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const concept of concepts) {
    const key = concept.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(concept.trim());
  }
  const visible = unique.slice(0, MAX_VISIBLE_CONCEPTS);
  const visibleKeys = new Set(visible.map((item) => item.toLowerCase()));
  const relSeen = new Set<string>();
  const keptRelationships = relationships.filter((relationship) => {
    const from = relationship.from.toLowerCase();
    const to = relationship.to.toLowerCase();
    const key = `${from}->${to}`;
    if (!visibleKeys.has(from) || !visibleKeys.has(to) || relSeen.has(key)) return false;
    relSeen.add(key);
    return true;
  }).slice(0, MAX_VISIBLE_RELATIONSHIPS);
  return {
    primary: visible[0] ?? "",
    supporting: visible.slice(1),
    relationships: keptRelationships,
    suppressed: unique.slice(MAX_VISIBLE_CONCEPTS),
  };
}
