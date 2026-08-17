# InPublic Overview Usefulness + Reversal Audit V1

## Decision

Current overview is not earning its movement in the retained natural corpus. It is rare (3 starts in 435.722 seconds), but two of the three starts were invalidated almost immediately and the only completion occurred at the end of the MLBB recording, where post-completion reading time is right-censored. A separate retained natural product lifecycle contains the already-observed harmful case: 435.2 px out, 555.8 px back at a 179.5-degree reversal, after only 65 ms of static dwell.

The dominant problem is **eligibility**, with large overview geometry acting as a harm multiplier. Production treats a settled thought plus 1.8 seconds without another live update as sufficient evidence for an overview. That is not the same as page, topic, or session completion.

No production behavior was changed. Page Arrival Coalescing V1 remains enabled and unchanged.

## Method and scope

The primary counts use the deterministic proposal/state streams selected for the Page Arrival Coalescing audit:

| Session | Source | Duration |
|---|---|---:|
| Product/explanation | `inpublic-replay-1786934535869.json` | 166.570 s |
| Narrative | `inpublic-replay-1786934781808.json` | 157.952 s |
| MLBB natural speech | `inpublic-replay-1786935164041.json` | 111.200 s |
| **Total** |  | **435.722 s** |

No Deepgram call was made. Every camera decision was recomputed from its frozen proposal input. The offline production baseline suppresses the same eight page-arrival A targets as Page Arrival Coalescing V1. The no-overview variant then suppresses only proposal kind `overview`; all live, structural, and retained page-arrival targets remain unchanged.

Screen displacement is measured in the recorded screen transform as the Euclidean change in `(scrollX × zoom, scrollY × zoom)`. For a cancelled animation, actual displacement is taken from the replacement proposal's frozen spring/app camera. This is why the two product overview starts have large intended targets but zero rendered displacement: their frozen camera did not advance before replacement.

The earlier 65 ms product reversal comes from `session-2026-08-16T20-48-55-463Z.json`. It is retained natural lifecycle evidence but predates proposal-boundary capture, so it is reported as corroborating evidence and is not mixed into deterministic proposal totals.

## Current overview architecture

- **Trigger:** `writeLive(... settled=true)` arms `LIVE_CAMERA_OVERVIEW_MS`, currently 1,800 ms.
- **Required state:** a live line has settled. Each later interim/final clears and rearms the timer.
- **Speech inactivity:** there is no explicit semantic speech-ended check at firing. The only evidence is that no later `writeLive` call reset the 1.8-second timer.
- **Thought settlement:** yes. The timer is armed only on a settled live write, but it does not require page/topic/session completion.
- **Visual content:** generic overview does not require a visual. At timer fire, a queued Visual Re-entry result gets first chance; if it commits, generic overview is skipped. A pending structural reframe also wins.
- **Page scope:** the target is computed from visible elements on the current page at firing. The eligibility itself is thought-scoped, not page-completion-scoped.
- **Target:** for standard mode, `framePage` unions the current page's visible elements. Overview passes `force=true`, `explicitNavigation=true`, `primarySubjectChanged=true` when the active cluster changes, and `maximumZoomChange=1`. `proposeCamera` centers/fits that union in the recording-safe frame subject to readability and webcam avoidance.
- **Cooldown:** `explicitNavigation=true` makes the proposal urgent, so the normal 900 ms cooldown, manual-camera priority, and meaningful-displacement gate cannot suppress it.
- **Cancellation:** `animateCamera` cancels any active spring; a subsequent page/live/structural start can cancel the overview.
- **Suppression:** a committed queued visual, a pending structural reframe, or an eventual proposal/animation no-op can prevent the generic movement. The ordinary live-hold and move-in-flight guards are bypassed by `force=true`.

In short, production overview means “a thought settled and no new live write arrived for 1.8 seconds,” not “this page/topic is complete.”

## Natural sessions analyzed

The product run contains ordinary product/explanation speech and all three retained pages. The narrative run contains three pages and no overview proposal. The MLBB exact-PCM run contains three pages and one end-of-run overview. None of the three proposal streams contains a durable visual/Visual Re-entry event; these overview opportunities are text-only.

## Overview frequency

| Session | Overview proposals | Starts | Completions | Cancels | Reversals |
|---|---:|---:|---:|---:|---:|
| Product/explanation | 2 | 2 | 0 | 2 | 0 rendered |
| Narrative | 0 | 0 | 0 | 0 | 0 |
| MLBB natural speech | 1 | 1 | 1 | 0 | 0 observed after completion |
| **Total** | **3** | **3** | **1** | **2** | **0 in deterministic corpus** |

That is 0.413 overview starts/minute. The result is sparse, so the audit supports a narrow eligibility experiment, not a broad redesign.

## Overview inventory

| Session / ID | Time | Page | Thought/speech state | Target `(x, y, z)` | Intended / rendered motion | Outcome | Next camera event |
|---|---:|---:|---|---|---:|---|---|
| Product `p94` | 99.883 s | 1 | `terminal_complete`; last live 1,814 ms earlier | `(-1256.53, 38.53, .8462)` | 456.3 / 0 px | cancelled at 712 ms | page turn at +712 ms, then same-cycle live |
| Product `p150` | 152.260 s | 2 | two settled thoughts (`safety_bound` + `terminal_complete`); last live 1,802 ms earlier | `(-2521.13, 84.53, .8462)` | 857.4 / 0 px | cancelled at 213 ms | live-follow at +213 ms |
| MLBB `p108` | 115.987 s | 2 | `terminal_complete`; last live 1,807 ms earlier | `(-2515.50, 94.03, .8462)` | 736.1 / 736.1 px | completed in 949 ms | none before capture ended |

All three targets fit, had zero webcam collisions, and had zero readability violations. Correct geometry constraints do not establish that the movement was useful.

## Time-to-next-speech distribution

Measured from overview start to the next frozen V2 live update (and identically to the next live-follow proposal where one existed):

| Bucket | Count |
|---|---:|
| <100 ms | 0 |
| 100–250 ms | 1 |
| 250–500 ms | 0 |
| 500 ms–1 s | 1 |
| 1–2 s | 0 |
| 2–4 s | 0 |
| 4+ s | 0 |
| No later speech captured | 1 |

The two product starts were followed by live activity after 213 ms and 712 ms. The earlier corroborating product case received its next interim 1,036 ms after overview start, but the overview itself took 971 ms to finish, leaving only 65 ms after completion.

Time from overview start to the next settled thought was 10.499 s and 15.146 s in the two product cases. Waiting for the next provider-final thought would therefore conceal that speech had already resumed; interim/live lifecycle is the relevant signal.

## Effective reading-time distribution

The deterministic corpus has only one completed overview. It is the final MLBB movement and capture ends with its completion, so its completion-to-next-movement interval is right-censored rather than measurable.

| Class | Deterministic count | Corroborating prior case |
|---|---:|---:|
| No useful dwell (<250 ms) | 0 measured | 1 (65 ms) |
| Very short (250–750 ms) | 0 | 0 |
| Short (750 ms–1.5 s) | 0 | 0 |
| Usable (1.5–3 s) | 0 | 0 |
| Stable (3+ s) | 0 | 0 |
| Right-censored at capture end | 1 | 0 |

The median finite completion-to-next-movement dwell is therefore **65 ms (n=1 finite interval)** when the corroborating lifecycle is included; the deterministic corpus alone has no finite completed interval from which to compute a median.

## Reversal geometry

No strong rendered reversal occurs in the three deterministic streams: both product animations were replaced before the frozen camera advanced, and MLBB has no following movement.

The corroborating product case is unambiguous:

| Leg | Screen displacement |
|---|---:|
| Last live target → overview | 435.2 px |
| Overview → next live target | 555.8 px |
| Direction angle | 179.5° |
| Total motion | 991.0 px |
| Net prior-live → next-live change | 120.7 px |
| Excess path length | 870.3 px |
| Static dwell after overview | 65 ms |

This is a strong reversal, not an orthogonal reframe or same-direction continuation.

## Wasted movement analysis

At the proposal boundary, the three overview targets request 2,049.8 px of screen-transform movement. The deterministic browser rendered 736.1 px of it: the completed MLBB end reframe. The two product starts rendered 0 px before cancellation but still added two starts and two cancellation handoffs.

The prior strong reversal moved 991.0 px to achieve only 120.7 px of net framing change, an excess of 870.3 px. Page navigation is excluded from that calculation.

## Why overviews fire

Every overview fired for the same reason:

1. a thought settled;
2. the last live line remained the current presentation object;
3. exactly about 1.8 seconds passed without another live write;
4. no queued durable visual or pending structural reframe consumed the release;
5. the forced generic full-page proposal ran.

The last-live-to-overview gaps were 1,814 ms, 1,802 ms, and 1,807 ms. That near-zero variance is the timer, not a naturally discovered quiet-state boundary.

## Overview during continuing speech

- Product `p150` was followed by a new interim/live-follow only 213 ms after it started. This is ordinary continuing speech and is the clearest deterministic false end-of-beat.
- Product `p94` was followed 712 ms later by a page turn and its carried live continuation. The completed thought was effectively page-transition setup, not a reading beat worth a separate full-page reframe.
- In the prior harmful case, the settled text “silly content, and I'm like, okay” was followed by an interim 1,036 ms after overview start and only 65 ms after completion; later finals continued the same creator/approach topic.
- MLBB had no later speech in the capture and is consistent with actual end-of-session quiet.

The system is therefore mistaking some ordinary provider/interim gaps for the end of a presentation beat.

## High-value overview examples

None is proven. The MLBB final overview is the only plausible candidate because it occurs at the end of captured speech and exposes the full text page, but the recording contains no post-completion dwell and cannot prove comprehension value.

## Wasteful overview examples

- Product `p94`: an urgent 456.3 px target was created, then invalidated by page navigation at +712 ms before visible displacement.
- Product `p150`: an urgent 857.4 px target was created, then invalidated by live speech at +213 ms before visible displacement.

These are lifecycle-wasteful rather than visibly harmful in the deterministic capture.

## Harmful overview examples

The prior product case is harmful: it completed a 435.2 px pan, exposed the overview for 65 ms, and then moved 555.8 px almost exactly back toward live framing. That is visible camera whiplash and interrupts reading without providing an inspection window.

No additional harmful rendered example appears in the three frozen proposal streams.

## Visual/page comprehension value

All three deterministic overview inputs are text-only (7, 5, and 6 text readability samples; zero durable visual/Visual Re-entry events). None demonstrates material text comprehension benefit:

- two never rendered before replacement;
- one rendered only at capture end with no observed reading period.

The corpus contains no natural overview over a durable visual, so whether overview materially helps pages with visuals is **evidence-incomplete**. Safe-frame fit alone cannot answer whether the viewer could inspect a visual. A future policy evaluation should retain overview only where a durable visual materially gains visibility and a real quiet/page-completion eligibility signal exists; this audit does not authorize that geometry rule.

## Current vs No-Overview counterfactual

The current column includes production Page Arrival Coalescing V1. “Movement” below is proposal-target screen-transform distance; it is a stable offline design-motion metric, not a claim that every cancelled spring rendered its full path.

| Metric | Current | No overview | Delta |
|---|---:|---:|---:|
| Camera starts | 270 | 267 | -3 |
| Completions | 82 | 81 | -1 end-of-run overview |
| Cancellations | 187 | 185 | -2 overview handoffs |
| Intended movement distance | 85,327.7 px | 83,277.9 px | -2,049.8 px (-2.4%) |
| Live content fit failures | 0 | 0 | 0 |
| Page-arrival fit failures | 0 | 0 | 0 |
| Page-arrival pairs retained | 8 | 8 | 0 |

Removing overview does not change any live target, live containment decision, safe-frame result, readability result, webcam result, or page-arrival target. It therefore does not hurt measured live readability or page visibility in this corpus. Visual visibility cannot be compared because no retained natural overview contains a durable visual.

Exact stable-framing duration is not claimed: suppressing a start changes downstream spring state, while the frozen proposal boundary intentionally preserves the originally observed viewport. Directionally, no-overview removes three urgent starts and cannot introduce a new movement, but the audit does not fabricate counterfactual animation frames.

## Quiet-period evidence

There is no clean timer-only separation:

- all overview starts occur ~1.8 seconds after the previous live update because that is how the timer is defined;
- two of three deterministic starts receive new live activity within 1 second;
- the harmful prior case also passed the 1.8-second timer, then received an interim 65 ms after overview completion;
- the only end-quiet candidate is the MLBB end-of-capture case.

Thus “no live text for 1.8 seconds” is not a reliable quiet-state signal. The signal that best separates the plausible candidate from the failures is **explicit strong page/topic/session completion**, not a slightly longer arbitrary delay. There are too few positive examples to call this validated; it is the narrowest next hypothesis.

## Target-distance analysis

The overview geometry is not subtle:

| Case | Current → overview target | Next live target relationship |
|---|---:|---|
| Product `p94` | 456.3 px intended | page navigation supersedes it |
| Product `p150` | 857.4 px intended | live resumes at +213 ms |
| MLBB `p108` | 736.1 px rendered | no next target captured |
| Prior harmful product | 435.2 px rendered | 555.8 px, 179.5° reversal |

Median intended overview distance is 736.1 px. Forced full-page fitting and unrestricted zoom make a bad eligibility decision visually expensive. Geometry is secondary: a smaller wrong-time overview could still interrupt reading, while suppressing the ineligible overview prevents the reversal entirely.

## Page Arrival Coalescing integrity

All eight page-arrival pairs remain coalesced. The offline no-overview variant changes zero page proposal IDs, transition IDs, retained live targets, zoom values, active-line fit results, or page-fit results. The deterministic camera replay suite still passes all 12 Page Arrival Coalescing checks, and the production/offline policies remain equivalent.

## Recommended SINGLE next intervention

**Test overview only at explicit strong page/topic/session completion; do not treat ordinary thought settlement as overview eligibility. A page turn consumes the completion itself and should not receive a separate pre-turn overview.**

This is one eligibility change. Do not combine it with dead-zone, spring, duration, zoom, containment, or geometric-value changes. Speech continues to win whenever live containment requires movement.

## Explicit answers

1. **How many overview movements occurred?** Three proposals/starts in the deterministic corpus: two cancelled before rendered displacement and one completed. One additional prior natural lifecycle contains the known rendered harmful reversal.
2. **How many were genuinely useful?** Zero proven.
3. **How many were neutral?** One, conservatively: the MLBB end overview is plausible but right-censored and therefore unproven.
4. **How many were wasteful or harmful?** Two wasteful in the deterministic corpus; the separate prior product case is one harmful rendered example.
5. **How many were followed by live-follow within 250 ms?** One of three from overview start in the deterministic corpus (`+213 ms`). The prior case was `+65 ms` from completion.
6. **Within 1 second?** Two of three from overview start in the deterministic corpus (`+213 ms`, `+712 ms`). The prior case was within one second of completion but 1,036 ms from start.
7. **What is median usable dwell after overview?** Not computable from deterministic completed intervals: the sole completion is right-censored. Including the one finite prior completion interval, the median finite dwell is 65 ms (`n=1`).
8. **How many strong direction reversals occurred?** Zero rendered in the deterministic corpus; one in the corroborating prior product lifecycle.
9. **How much unnecessary camera distance did those reversals create?** The prior reversal created 870.3 px of excess path (991.0 px total versus 120.7 px net). No reversal distance was rendered in the deterministic corpus.
10. **Does overview materially help text-only pages?** Not in the evidence observed.
11. **Does overview materially help pages with visuals?** Unknown; the retained natural overview corpus has no durable-visual case.
12. **Would removing overview completely hurt readability?** Not in this corpus: zero additional live-fit, readability, webcam, or page-fit failures. Visual benefit remains untested.
13. **Is the main problem timing, eligibility, or geometry?** Eligibility. The 1.8-second timing rule is the current weak proxy; large geometry amplifies the cost.
14. **Is there a reliable quiet-state signal that separates useful from harmful overview?** The fixed quiet timer does not. Explicit strong page/topic/session completion is the best narrow candidate, but positive evidence is too sparse to call it validated.
15. **What ONE overview policy should be tested next?** Overview only at explicit strong page/topic/session completion, with page turns consuming completion without a separate overview.
