# InPublic Deterministic Camera Replay + Page Arrival A/B V1

## Current camera proposal architecture

The production path remains:

`Board.framePage` → freeze the current Excalidraw camera and recording viewport → assemble `CameraProposalInput` → `proposeCamera` → composition fit/readability/webcam/cooldown/threshold decision → `animateCamera` final at-target threshold → existing spring retarget or new spring → completion/cancellation lifecycle.

Inputs that can change a decision are retained at the pure-policy boundary: composition state (including cooldown time and prior movement counts), current scroll/zoom, focal and optional context bounds, current text/readability samples, viewport/safe/webcam bounds and configuration, focal subject, active cluster, reason, navigation/follow/priority flags, zoom-change limit, and the frozen `now`. Page index/generation/bounds and proposal kind are retained alongside that input. If a spring is active, its instantaneous position, velocity, destination, last frame clock, animation identity, and reason are retained.

`proposeCamera` itself was not changed. `animateCamera` still uses the existing thresholds and spring. Production policy is frozen.

## Missing historical state

The earlier three-session audit retained camera lifecycle outcomes but not the complete proposal boundary: focal/context/live bounds, exact viewport, instantaneous app camera, composition cooldown state, and active spring state were missing. Those sessions cannot be fabricated into deterministic inputs and were not used for policy replay.

## Proposal snapshot schema

`CameraProposalSnapshot` V1 contains:

- identity: `eventId`, session-relative `t`, monotonic `capturedAtPerf`, proposal kind;
- page transition: page index, page generation, page bounds, optional logical transition ID, first-live marker;
- exact pure-policy input: the serializable `CameraProposalInput` object;
- optional spring snapshot: camera, velocity, target, last-frame timestamp, animation ID, reason;
- retained current-policy result: move/suppress decision, target, reason, next composition state, safe frame, readability result, content-fit result, webcam collisions, occupied-canvas ratio.

Camera lifecycle records add animation ID, proposal ID, transition ID, replacement animation ID, target, reason, event, and frozen event time.

## Frozen clock

Replay calls the pure policy with the recorded `input.now`; it never calls `Date.now()`, `performance.now()`, or a timer. Session-relative `t` orders frozen events. `capturedAtPerf` and the spring's `lastFrameAt` preserve the monotonic browser clock domain needed for spring reconstruction. Cooldown tests use only these captured values.

## Spring-state replay

The harness mirrors `stepCameraSpring` without replacing it. A moving proposal can be reconstructed from recorded instantaneous camera, velocity, destination, and last-frame time at any frozen monotonic timestamp. Retargets are checked against the retained active animation identity. The post-policy `animateCamera` at-target threshold is mirrored separately, so a policy `move: true` whose destination is already reached does not incorrectly count as an animation start.

## Baseline reproduction accuracy

Strict coordinate/zoom tolerance: `1e-9`.

| Metric | Result |
|---|---:|
| Proposals replayed | 420 |
| Exact decision matches | 420/420 (100%) |
| Target matches | 420/420 (100%) |
| Lifecycle assertions | 555/555 (100%) |
| Cancellation matches | 195/195 (100%) |
| Completion matches | 82/82 (100%) |

The baseline gate passed, so the offline policy comparison proceeded.

## Natural sessions captured

All accepted captures used real natural recordings and a sane 1036 × 703.2 recording viewport. A hot-reload-contaminated product attempt reporting a 26,843,546-pixel viewport was rejected and recaptured after a hard reload.

| Session | Kind | Duration | Proposals | Page turns | Live follows |
|---|---|---:|---:|---:|---:|
| `exact-mic-audio (1).wav` | MLBB natural speech, exact PCM | 1:51.200 | 108 | 2 | 104 |
| `inpublic-31a909f1-bfd1-4e41-ac3a-02813f82b543.mp4` | product/explanation speech | 2:46.570 | 172 | 3 | 167 |
| `inpublic-4202f918-b850-4d8a-9d81-a55e99ee0bea.mp4` | narrative speech | 2:37.952 | 140 | 3 | 130 |
| **Total** |  | **7:15.722** | **420** | **8** | **401** |

## Page-turn transitions

The narrow identity is not a millisecond window. `turnPage` increments a camera page generation and creates one page-arrival transition ID. The page proposal and only the first live proposal in the same synchronous event cycle may consume it. A microtask expires an unconsumed identity, preventing a genuinely later follow from being grouped. All eight real pairs were 0–1 ms apart and shared page index, generation, and transition ID.

## Current policy results

Across the frozen corpus: 278 starts, 82 completions, 195 cancellations, 38.281 starts/min, and 26.852 cancellations/min. One animation was still active at export. The full instrumentation counts every spring retarget, which is why its cancellation denominator is much larger than the prior calmness audit's filtered visible-movement count.

## Coalesced policy results

The offline variant suppresses only page target A when the same-transition first live target B exists. B is already the production target that satisfies active-line containment, readability, webcam, and page-locality checks; it becomes the single page-arrival destination. No production flag or behavior was enabled.

| Session | Page turns | Current starts | New starts | Current cancels | New cancels | Active-line failures | Page-fit failures |
|---|---:|---:|---:|---:|---:|---:|---:|
| MLBB exact PCM | 2 | 49 | 47 | 13 | 11 | 0 | 0 |
| Product/explanation | 3 | 151 | 148 | 150 | 147 | 0 | 0 |
| Narrative | 3 | 78 | 75 | 32 | 29 | 0 | 0 |
| **Total** | **8** | **278** | **270** | **195** | **187** | **0** | **0** |

Completions remain 82. Starts fall from 38.281 to 37.180/min; cancellations fall from 26.852 to 25.750/min. The variant removes all eight redundant page-animation starts and all eight immediate cancellations.

## Per-transition analysis

Coordinates are `(scrollX, scrollY, zoom)`. Current final and coalesced final are exactly the listed live target.

| Session/page | Page target A | Live/coalesced target B | A lifetime | Effective distance, current = new |
|---|---|---|---:|---:|
| MLBB / 1 | (-1245.132, 168.632, 0.760000) | (-1122.013, 265.306, 1.080000) | 1 ms | 1202.614 px |
| MLBB / 2 | (-2598.152, 88.174, 0.920000) | (-2707.167, 249.056, 1.080000) | 0 ms | 1816.068 px |
| Product / 1 | (-1338.152, 88.174, 0.920000) | (-1394.101, 265.306, 1.080000) | 1 ms | 1617.419 px |
| Product / 2 | (-2598.152, 88.174, 0.920000) | (-2245.695, 265.306, 1.080000) | 0 ms | 1316.639 px |
| Product / 3 | (-3858.152, 88.174, 0.920000) | (-3968.883, 232.806, 1.080000) | 1 ms | 1548.740 px |
| Narrative / 1 | (-1227.028, 184.290, 0.735119) | (-1415.616, 272.950, 1.006154) | 1 ms | 1453.633 px |
| Narrative / 2 | (-2598.152, 88.174, 0.920000) | (-2761.507, 232.806, 1.080000) | 0 ms | 1517.409 px |
| Narrative / 3 | (-3858.152, 88.174, 0.920000) | (-3529.147, 265.306, 1.080000) | 1 ms | 1303.535 px |

Every target B had active content fit, readable zoom, zero webcam collisions, and visible overlap with the intended new page. Occupied-safe-frame ratios ranged from 0.009 to 0.151, exactly matching current B targets. The five nonzero A lifetimes total 5 ms; no A advanced for a meaningful animation interval before replacement.

## Movement-distance comparison

Current effective final navigation and coalesced navigation share the same start snapshot and exact final target for every transition. Total effective displacement is 11,776.057 px (mean 1,472.007 px) under both policies: 0 px and 0% increase. The coalesced policy removes the unused target waypoint; it does not create a longer path.

## Reading/presentation implications

Active narration visibility is unchanged because the final live-follow target is byte-for-byte the current production target. Zoom is unchanged on all eight arrivals. Full-sheet edges may remain outside the safe frame at the current readable live zoom, as they already do under baseline B; the new policy adds no clipping or empty canvas. Overview and reading-window policy remain untouched.

## Regressions

- Coalesced corpus: 0 active-line failures, 0 page-fit failures, 0 webcam collisions, 0 target differences, 0 zoom differences.
- Every non-page proposal replays unchanged; overview and later live-follow behavior are untouched.
- Deterministic camera tests: 8/8 passed.
- Typecheck and project lint/foundation checks passed.
- The full repository test command reached its existing feature-flag suite with one out-of-scope failure: `directorV1 defaults off`. Camera replay tests passed within that run; no camera code participates in that assertion.

## Recommendation

**A. IMPLEMENT PAGE-ARRIVAL COALESCING IN PRODUCTION.**

The evidence supports a deliberately narrow implementation matching the offline variant: same page-generation, same transition ID, first live proposal in the same synchronous event cycle, and retain the production live target. The expected benefit is lifecycle cleanliness, not a large reduction in completed movement. This task does not make that production change.

## Explicit answers

1. **Can current camera behavior now be deterministically replayed?** Yes.
2. **What percentage of recorded decisions reproduce exactly?** 100% (420/420), with 100% target and lifecycle assertion matches.
3. **Are page-turn + first live-follow requests reliably identifiable as one logical transition?** Yes, by page generation + transition ID + first-live marker within one synchronous event cycle; all real pairs were 0–1 ms apart.
4. **How many same-transition cancellations exist in the test corpus?** 8.
5. **How many does coalescing remove?** All 8.
6. **Does coalescing ever hide active narration?** No; 0/8 active-line failures.
7. **Does it ever fail to navigate to the new page?** No; 0/8 page-fit/navigation failures.
8. **Does it materially increase movement distance?** No; increase is exactly 0 px (0%).
9. **Does it change zoom behavior?** No; all eight final zooms are identical.
10. **Does it alter any non-page camera behavior?** No; only paired page proposal A is omitted offline, and every other proposal/result is unchanged.
11. **Does the camera lifecycle become cleaner?** Yes; 8 fewer starts and 8 fewer cancellations, with completions unchanged.
12. **Should Page Arrival Coalescing V1 ship?** Yes, as the narrow policy above, after normal production implementation review.
