# InPublic Page Arrival Coalescing V1 Production Validation

## Production implementation

`turnPage` still activates the page, pen, marks, and page event immediately. Only its camera proposal is provisional. A qualifying page proposal is retained without allocating an animation identity or emitting a `camera started` event. The originating page-arrival identity is handed directly to the carried/overflow `writeLive` continuation. When that continuation requests its first live-follow proposal, the pending page target is discarded and the already-validated live target starts one animation.

No third geometry was introduced. `proposeCamera`, containment, safe-frame, readability, webcam avoidance, zoom policy, spring physics, animation duration, overview behavior, and every non-page camera path are unchanged.

## Transition identity

The identity is exact:

- page generation;
- page transition ID;
- active page index;
- logical event-cycle ID;
- explicit handoff to the carried/overflow `writeLive` continuation.

The token survives only the local font/measurement awaits belonging to that same page-arrival operation. It is not discoverable by a later, unrelated live update. There is no millisecond threshold.

## Fallback behavior

If a page turn has no owned first-live continuation, its original camera target starts in a microtask at the end of the current event cycle. If an owned continuation rejects, becomes stale, or does not request live containment, its `finally`/fallback path starts the original page target. Missing or mismatched transition ID, generation, page, or event-cycle ID falls back to existing page-then-follow behavior.

Page state never waits for any camera outcome.

## Camera lifecycle change

The coalesced path emits:

1. one `camera-page-arrival-coalesced` diagnostic;
2. no page animation identity and no fake page `started` event;
3. one animation identity for the retained live proposal;
4. one normal eventual completion or cancellation for that animation.

The diagnostic records generation, page, event-cycle ID, transition ID, page/live proposal IDs, original page target, and retained live target. It is emitted once per coalesced transition, not per frame.

## Deterministic replay equivalence

The production policy mode and the offline Page Arrival Coalescing V1 oracle produced identical summaries for all three frozen streams. The 12-case deterministic matrix passed, covering exact identity, mismatched generation/ID/cycle, later live follow, both one-sided fallbacks, exact target/zoom, fit, webcam behavior, non-page integrity, and one-start lifecycle.

| Session | Page turns | Coalesced | Old starts | New starts | Old cancels | New cancels | Completions | Target differences | Fit failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| MLBB exact PCM | 2 | 2 | 49 | 47 | 13 | 11 | 36 | 0 | 0 |
| Product/explanation | 3 | 3 | 151 | 148 | 150 | 147 | 0 | 0 | 0 |
| Narrative | 3 | 3 | 78 | 75 | 32 | 29 | 46 | 0 | 0 |
| **Total** | **8** | **8** | **278** | **270** | **195** | **187** | **82** | **0** | **0** |

All 420 proposal decisions and targets and all 555 baseline lifecycle assertions remain exactly reproducible. The production policy removes the same eight starts/cancellations as the offline oracle and changes no final target.

## Fresh natural session

The three natural recordings were rerun in the actual browser after production implementation, isolated by hard reloads. Provider/ASR output can vary between live replays, so absolute proposal counts differ from the older frozen streams; the within-run lifecycle effect remains exactly one removed start and cancellation per page arrival.

| Session | Page turns | Coalesced | Inferred old starts | Production starts | Inferred old cancels | Production cancels | Completions | Fake page starts | Retained live starts | Target/fit failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| MLBB exact PCM | 2 | 2 | 72 | 70 | 36 | 34 | 35 | 0 | 2 | 0 |
| Product/explanation | 3 | 3 | 79 | 76 | 29 | 26 | 50 | 0 | 3 | 0 |
| Narrative | 3 | 3 | 93 | 90 | 41 | 38 | 52 | 0 | 3 | 0 |
| **Total** | **8** | **8** | **244** | **236** | **106** | **98** | **137** | **0** | **8** | **0** |

“Inferred old” adds back only the page start and immediate page cancellation proven by the retained proposal pair; completed movements remain unchanged.

## Page-turn presentation review

The 166.57-second product/explanation talk was inspected visually during its three page turns. Each new page activated immediately and arrived directly on the active carried line. There was no visible page-wide target, reverse snap, blank waiting state, or double-start. Subsequent live following continued normally. The transition read as `TURN → ARRIVE`.

## Performance

- 0 long-task events across 435.722 seconds of production natural replay.
- No timer, duration, polling window, synchronous blocking, or extra animation was added.
- The coalesced path performs less lifecycle work: eight fewer starts and cancellations.
- The only deferral for an unpaired page target is one microtask; page activation itself is immediate.

## Non-page camera integrity

Every non-page frozen proposal remained exact. Overview, later live follow, structural framing, containment, dead zone, zoom, webcam avoidance, spring, reading behavior, and mobile behavior were untouched. The fresh corpus had zero live-fit, readability, page-navigation, target, zoom, or webcam failures on the eight coalesced arrivals.

## Regression results

- TypeScript typecheck: passed.
- Lint/foundation suite: passed (103 checks).
- Page Arrival Coalescing deterministic matrix: 12/12 passed.
- Replay, visual composition, pipeline, story, math, audio, Visual Re-entry, and product packaging checks passed.
- Full `npm test` still stops at the unrelated existing feature assertion `directorV1 defaults off` (17 feature checks passed, 1 failed). The camera suite passed before that assertion, and the separately-run 40 product packaging checks passed.

## Explicit answers

1. **Did all eight historical collisions coalesce?** Yes, 8/8 in the frozen oracle and 8/8 in fresh production browser traces.
2. **Did any unrelated camera proposal coalesce?** No.
3. **How many starts were removed?** 8.
4. **How many cancellations were removed?** 8.
5. **Did completion count change?** No.
6. **Did any final target change?** No; 0 target differences.
7. **Did zoom ever change unexpectedly?** No.
8. **Did active speech ever leave the safe viewport?** No; 0 fit/readability failures.
9. **Did page navigation ever fail?** No.
10. **Did any webcam collision appear?** No.
11. **Did non-page camera behavior change?** No.
12. **Was any delay/timer introduced?** No timer or perceptible wait; only an end-of-cycle microtask fallback for an unpaired page target.
13. **Does a fresh real page transition visibly feel cleaner?** Yes; the long product talk showed direct, continuous arrivals with no intermediate snap.
14. **Should Page Arrival Coalescing V1 remain enabled?** Yes.
15. **What is the next highest-priority presentation issue?** The separately observed `overview → shortly afterward → opposite live-follow` reversal. It was not changed here.
