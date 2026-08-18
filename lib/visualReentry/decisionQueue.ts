import type { SettledThought } from "./types";

export const VISUAL_REENTRY_CANDIDATE_QUEUE_CAPACITY = 3;

export interface VisualReentryCandidateJob {
  thought: SettledThought;
  experimentMode: "vr_decision" | "vr_full";
  generation: number;
  page: number;
  launchLiveSeq: number;
  candidateCompletedAt: number;
  expiresAt: number;
}

export type CandidateEnqueueResult = "queued" | "duplicate" | "full";
export type CandidateExpiryReason = "generation" | "page" | "ttl";

export interface CandidateDequeueContext {
  generation: number;
  page: number;
  now: number;
}

export interface ExpiredVisualReentryCandidate {
  job: VisualReentryCandidateJob;
  reason: CandidateExpiryReason;
}

/**
 * The bounded queue in front of Visual Re-entry's single decision worker.
 * Prepared/grounded results have their own queue in Board.tsx; this queue is
 * only for candidates that have not yet been claimed or decided.
 */
export class VisualReentryCandidateQueue {
  private readonly jobs: VisualReentryCandidateJob[] = [];
  private readonly queuedIds = new Set<string>();
  readonly capacity: number;

  constructor(capacity = VISUAL_REENTRY_CANDIDATE_QUEUE_CAPACITY) {
    this.capacity = capacity;
  }

  get size(): number {
    return this.jobs.length;
  }

  enqueue(job: VisualReentryCandidateJob): CandidateEnqueueResult {
    if (this.queuedIds.has(job.thought.id)) return "duplicate";
    if (this.jobs.length >= this.capacity) return "full";
    this.jobs.push(job);
    this.queuedIds.add(job.thought.id);
    return "queued";
  }

  /**
   * Returns the oldest still-relevant job and reports every stale job removed
   * ahead of it. The caller logs those removals as terminal candidate-expired
   * outcomes before starting the returned job.
   */
  dequeue(context: CandidateDequeueContext): {
    job: VisualReentryCandidateJob | null;
    expired: ExpiredVisualReentryCandidate[];
  } {
    const expired: ExpiredVisualReentryCandidate[] = [];
    while (this.jobs.length) {
      const job = this.jobs.shift()!;
      this.queuedIds.delete(job.thought.id);
      const reason: CandidateExpiryReason | null =
        job.generation !== context.generation
          ? "generation"
          : job.page !== context.page
            ? "page"
            : context.now > job.expiresAt
              ? "ttl"
              : null;
      if (reason) {
        expired.push({ job, reason });
        continue;
      }
      return { job, expired };
    }
    return { job: null, expired };
  }

  clear(): VisualReentryCandidateJob[] {
    const removed = this.jobs.splice(0);
    this.queuedIds.clear();
    return removed;
  }
}
