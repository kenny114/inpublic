/**
 * Draws the reflex layer's provisional signs (lib/meaning/reflex.ts).
 *
 * Kept out of lib/meaning/apply.ts on purpose. The two renderers have opposite
 * contracts and mixing them would blur both:
 *
 *   apply.ts        settled, model-decided meaning. Composed layout, arrows,
 *                   containment, a reserved region that grows with the
 *                   diagram, ink that is meant to persist.
 *   this module     guesses made mid-sentence. One band, no relations, no
 *                   camera, no page reservation, and every mark cleared the
 *                   moment the thought settles.
 *
 * Provisional signs live in a fixed band low on the sheet rather than in the
 * pen's flow. Flow placement would advance the pen for ink that is about to be
 * erased, permanently indenting the settled content that follows it — the band
 * costs a reserved strip and buys back the guarantee that a retracted guess
 * leaves no trace in the layout.
 *
 * Reconciles against the full current state rather than applying a diff, for
 * the same reason apply.ts does: a sign's slot depends on how many other signs
 * are present, so an add or a removal can legitimately move its neighbours.
 */

import { PAGE_H, PAGE_PAD, PAGE_W, pageOrigin } from "../ops";
import type { SceneElement } from "../scene";
import type { ProvisionalState } from "./reflex";
import { buildSign, signGeometry } from "./sign";

export interface ProvisionalIdentity {
  /** Every element drawn for a key, so removal takes the whole sign with it. */
  elementIdsByKey: Map<string, string[]>;
  /** Slot + signature per key — lets an unchanged sign be left completely alone. */
  placementByKey: Map<string, string>;
  page: number | null;
}

export function createProvisionalIdentity(): ProvisionalIdentity {
  return { elementIdsByKey: new Map(), placementByKey: new Map(), page: null };
}

/**
 * How many guesses may be on screen at once.
 *
 * A long sentence can scan to a dozen clauses, and a dozen tentative marks is
 * not a mind following along — it is noise. The most recent clauses win: what
 * the speaker is saying *now* is what a viewer is trying to follow.
 */
export const MAX_PROVISIONAL = 5;

/** The band's vertical centre, as a distance up from the page's bottom edge. */
const BAND_UP_FROM_BOTTOM = 118;
const SLOT_GUTTER = 34;

export interface SyncProvisionalResult {
  elements: SceneElement[];
  addedIds: string[];
  removedIds: string[];
}

/**
 * @param pageIndex The sheet the band belongs to. A page turn retires every
 *                  provisional mark rather than migrating it — a guess is tied
 *                  to the moment it was made, and moving it would strand it
 *                  next to content it was never about.
 */
export async function syncProvisionalCanvas(
  state: ProvisionalState,
  elements: SceneElement[],
  pageIndex: number,
  identity: ProvisionalIdentity,
): Promise<SyncProvisionalResult> {
  let current = elements;
  const added: string[] = [];
  const removed: string[] = [];

  const pageChanged = identity.page !== null && identity.page !== pageIndex;
  identity.page = pageIndex;

  const visible = [...state.byKey.values()]
    .sort((a, b) => a.index - b.index)
    .slice(-MAX_PROVISIONAL);
  const keep = pageChanged ? new Set<string>() : new Set(visible.map((p) => p.key));

  // Retire anything no longer shown: revised away, pushed out by the cap,
  // cleared on settlement, or left behind by a page turn.
  for (const [key, ids] of [...identity.elementIdsByKey]) {
    if (keep.has(key)) continue;
    const stale = new Set(ids);
    current = current.filter((el) => !stale.has(el.id));
    removed.push(...ids);
    identity.elementIdsByKey.delete(key);
    identity.placementByKey.delete(key);
  }
  if (pageChanged) return { elements: current, addedIds: added, removedIds: removed };

  const origin = pageOrigin(pageIndex);
  const cy = origin.y + PAGE_H - BAND_UP_FROM_BOTTOM;

  // Lay the band out centred, so a growing sentence expands outward from the
  // middle instead of marching off the right edge.
  const widths = visible.map((p) => signGeometry(p.sign).size);
  const total = widths.reduce((sum, w) => sum + w, 0) + SLOT_GUTTER * Math.max(0, visible.length - 1);
  const usable = PAGE_W - PAGE_PAD * 2;
  const scale = total > usable ? usable / total : 1;
  let cursor = origin.x + PAGE_PAD + Math.max(0, (usable - total * scale) / 2);

  for (let i = 0; i < visible.length; i++) {
    const entry = visible[i];
    const width = widths[i] * scale;
    const cx = cursor + width / 2;
    cursor += width + SLOT_GUTTER * scale;

    // Slot and reading together: either changing means this sign must move or
    // sharpen, and nothing else needs touching.
    const placement = `${Math.round(cx)}|${entry.signature}`;
    if (identity.placementByKey.get(entry.key) === placement) continue;

    const stale = new Set(identity.elementIdsByKey.get(entry.key) ?? []);
    if (stale.size) {
      current = current.filter((el) => !stale.has(el.id));
      removed.push(...stale);
    }

    const built = await buildSign(entry.key, entry.sign, cx, cy);
    if (!built) {
      identity.elementIdsByKey.delete(entry.key);
      identity.placementByKey.delete(entry.key);
      continue;
    }
    const ids = built.elements.map((el) => el.id);
    identity.elementIdsByKey.set(entry.key, ids);
    identity.placementByKey.set(entry.key, placement);
    current = [...current, ...built.elements];
    added.push(...ids);
  }

  return { elements: current, addedIds: added, removedIds: removed };
}
