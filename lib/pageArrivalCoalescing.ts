import type { CameraView } from "./composition";

/** Exact production identity for one synchronous page-arrival event cycle. */
export interface PageArrivalIdentity {
  transitionId: string;
  pageGeneration: number;
  pageIndex: number;
  eventCycleId: number;
  /** An explicit writeLive continuation owns the first live proposal. */
  expectsLiveFollow?: boolean;
}

export interface PendingPageArrivalCamera extends PageArrivalIdentity {
  proposalId: string;
  target: CameraView;
  reason: string;
}

export function samePageArrivalTransition(
  page: PageArrivalIdentity | null | undefined,
  live: PageArrivalIdentity | null | undefined,
): boolean {
  return Boolean(page && live
    && page.transitionId === live.transitionId
    && page.pageGeneration === live.pageGeneration
    && page.pageIndex === live.pageIndex
    && page.eventCycleId === live.eventCycleId);
}
