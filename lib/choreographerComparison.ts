/**
 * The Choreographer's only move for v0: lay two existing concept boxes out
 * side by side, readably, inside one page.
 *
 * Deliberately not a general layout engine (see the brief, Part 11/23) — this
 * is comparison-shape only. It decides WHERE; it does not draw anything and
 * does not know about Excalidraw. components/Board.tsx owns turning these
 * targets into an animated move (`animateConceptsToComparison`) and the
 * Director (lib/director.ts) owns deciding WHETHER a comparison happened at
 * all. This module is pure so it can be regression-tested without a canvas.
 */

import { PAGE_H, PAGE_PAD, PAGE_W, pageOrigin } from "./ops";

export interface ComparisonBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComparisonLayout {
  left: { x: number; y: number };
  right: { x: number; y: number };
}

/** Horizontal breathing room between the two boxes. */
const COLUMN_GAP = 64;
/**
 * Live speech is usually still being written low on the page. Reserving this
 * much height at the bottom keeps the comparison from landing on top of it —
 * "avoid placing over active live speech" (Part 11) — without needing to know
 * exactly where the live line currently is.
 */
const LIVE_ZONE_RESERVE = 170;

/**
 * Where the two concepts should end up, in page-absolute coordinates.
 *
 * `avoidBelowY`, if given (e.g. the live-writing pen's current y), pulls the
 * layout above that line when there's room; otherwise the fixed
 * `LIVE_ZONE_RESERVE` at the bottom of the page is the only guard.
 */
export function computeComparisonLayout(
  leftBox: ComparisonBox,
  rightBox: ComparisonBox,
  pageIndex: number,
  avoidBelowY?: number,
): ComparisonLayout {
  const origin = pageOrigin(pageIndex);
  const contentLeft = origin.x + PAGE_PAD;
  const contentTop = origin.y + PAGE_PAD;
  const contentWidth = PAGE_W - PAGE_PAD * 2;
  const contentRight = contentLeft + contentWidth;

  // Horizontal: centered pair, clamped to stay on the sheet even if the
  // labels are wide enough that a perfectly centered pair would not fit.
  const centerX = contentLeft + contentWidth / 2;
  let leftX = centerX - COLUMN_GAP / 2 - leftBox.width;
  let rightX = centerX + COLUMN_GAP / 2;
  if (leftX < contentLeft) {
    const shift = contentLeft - leftX;
    leftX += shift;
    rightX += shift;
  }
  if (rightX + rightBox.width > contentRight) {
    const shift = rightX + rightBox.width - contentRight;
    rightX -= shift;
    leftX -= shift;
  }
  // Still doesn't fit (both boxes together are wider than the page): pin the
  // left edge rather than let either box run off the sheet.
  leftX = Math.max(contentLeft, leftX);

  // Vertical: a fixed, readable band in the upper portion of the page, above
  // the live-writing zone. Both boxes share one center line so mismatched
  // heights (e.g. a longer label) still read as a pair, not a stagger.
  const contentBottom = origin.y + PAGE_H - PAGE_PAD;
  const liveZoneTop = Math.min(avoidBelowY ?? Infinity, contentBottom - LIVE_ZONE_RESERVE);
  const maxBoxHeight = Math.max(leftBox.height, rightBox.height);
  let centerY = contentTop + Math.min((liveZoneTop - contentTop) * 0.4, 200) + maxBoxHeight / 2;
  centerY = Math.min(centerY, liveZoneTop - maxBoxHeight / 2);
  centerY = Math.max(centerY, contentTop + maxBoxHeight / 2);

  return {
    left: { x: leftX, y: centerY - leftBox.height / 2 },
    right: { x: rightX, y: centerY - rightBox.height / 2 },
  };
}
