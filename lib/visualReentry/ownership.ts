/**
 * Explicit ownership guard (Part 12 of the Visual Re-entry brief): no
 * duplicate processing of the same settled-thought id. In normal operation
 * this can't happen — components/Board.tsx's handleFinal mints a fresh
 * `crypto.randomUUID()` per settled thought and the abort-and-replace
 * pattern (visualReentryAbortRef) already ensures only one job is ever in
 * flight — but this is a small, explicit, independently-testable seam
 * rather than trusting that invariant implicitly.
 *
 * A plain function over a caller-owned Set, not a class with its own
 * state, so components/Board.tsx keeps owning all the mutable
 * session-lifetime state (same idiom as every other *Ref in that file) and
 * this stays a pure, trivially testable unit.
 */

/**
 * Attempts to claim `id` for processing. Returns true (and records the
 * claim) the first time a given id is seen; returns false for every
 * subsequent attempt on the same id, without mutating `processedIds`.
 */
export function claimThought(processedIds: Set<string>, id: string): boolean {
  if (processedIds.has(id)) return false;
  processedIds.add(id);
  return true;
}
