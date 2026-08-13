/**
 * The Process Choreographer's only move for v0: lay 3-6 existing concept
 * boxes out in the order they were spoken, either left-to-right or stacked
 * top-to-bottom, inside one page.
 *
 * Deliberately not a general layout engine, same spirit as
 * lib/choreographerComparison.ts, which this mirrors closely: pure,
 * Excalidraw-agnostic, decides WHERE and not WHAT. lib/directorState.ts owns
 * deciding WHETHER a process happened; components/Board.tsx's `performProcess`
 * owns turning these targets into an animated move.
 */

import { PAGE_H, PAGE_PAD, PAGE_W, pageOrigin } from "./ops";

export interface ProcessBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProcessLayout {
  positions: { x: number; y: number }[];
  orientation: "horizontal" | "vertical";
}

/** Breathing room between consecutive stages, either axis. */
const STAGE_GAP = 56;
/** Same reserve as choreographerComparison.ts — keep the layout above active live speech. */
const LIVE_ZONE_RESERVE = 170;

/**
 * Where each stage should end up, in page-absolute coordinates, in the same
 * order as `boxes`.
 *
 * Orientation is chosen by geometry alone, never by content: horizontal
 * (reads left-to-right, matches Comparison's own layout) is preferred, and
 * only given up for vertical stacking if the boxes genuinely don't fit
 * side by side but do fit stacked. If neither fits cleanly the layout falls
 * back to horizontal, clamped to stay on the sheet — same "don't overflow
 * rather than pick a worse orientation" idiom as comparison's own clamp.
 */
export function computeProcessLayout(
  boxes: ProcessBox[],
  pageIndex: number,
  avoidBelowY?: number,
): ProcessLayout {
  const origin = pageOrigin(pageIndex);
  const contentLeft = origin.x + PAGE_PAD;
  const contentTop = origin.y + PAGE_PAD;
  const contentWidth = PAGE_W - PAGE_PAD * 2;
  const contentBottom = origin.y + PAGE_H - PAGE_PAD;
  const liveZoneTop = Math.min(avoidBelowY ?? Infinity, contentBottom - LIVE_ZONE_RESERVE);
  const availableHeight = Math.max(0, liveZoneTop - contentTop);

  const totalWidthHorizontal = boxes.reduce((sum, b) => sum + b.width, 0) + STAGE_GAP * (boxes.length - 1);
  const tallestBox = Math.max(...boxes.map((b) => b.height));
  const fitsHorizontal = totalWidthHorizontal <= contentWidth && tallestBox <= availableHeight;

  const totalHeightVertical = boxes.reduce((sum, b) => sum + b.height, 0) + STAGE_GAP * (boxes.length - 1);
  const widestBox = Math.max(...boxes.map((b) => b.width));
  const fitsVertical = totalHeightVertical <= availableHeight && widestBox <= contentWidth;

  const orientation: "horizontal" | "vertical" = fitsHorizontal || !fitsVertical ? "horizontal" : "vertical";

  if (orientation === "horizontal") {
    const centerY = contentTop + Math.min(availableHeight * 0.4, 200) + tallestBox / 2;
    const clampedCenterY = Math.min(Math.max(centerY, contentTop + tallestBox / 2), liveZoneTop - tallestBox / 2);

    let cursorX = contentLeft + Math.max(0, (contentWidth - totalWidthHorizontal) / 2);
    // Too wide even after centering attempt: pin to the left edge rather than
    // let the chain run off the sheet.
    if (totalWidthHorizontal > contentWidth) cursorX = contentLeft;

    const positions = boxes.map((box) => {
      const pos = { x: cursorX, y: clampedCenterY - box.height / 2 };
      cursorX += box.width + STAGE_GAP;
      return pos;
    });
    return { positions, orientation };
  }

  // Vertical: shared center line on the cross axis, stacked top to bottom
  // starting near the top of the content band.
  const centerX = contentLeft + contentWidth / 2;
  let cursorY = contentTop;
  const positions = boxes.map((box) => {
    const pos = { x: centerX - box.width / 2, y: cursorY };
    cursorY += box.height + STAGE_GAP;
    return pos;
  });
  return { positions, orientation };
}
