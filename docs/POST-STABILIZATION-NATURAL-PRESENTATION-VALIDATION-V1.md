# InPublic Post-Stabilization Natural Presentation Validation V1

No code was changed. Observe-only, as instructed.

## Session

One fresh `vr_full` replay of a real natural voice recording supplied by the
user (`WhatsApp Ptt 2026-08-17 at 8.34.01 AM.ogg`, ~5.85 min of PCM/Opus
audio by Ogg granule-position measurement), run through the actual current
production pipeline via the dev replay lab at `/try?replay=1&v2=1&vr=1`
(`NODE_ENV=development`, real Deepgram WebSocket, real cost incurred).

Two things went wrong mechanically and are reported as findings, not hidden:

1. **First attempt used the wrong pipeline entirely.** I initially opened
   `/try?replay=1` without the dev-only `?v2=1&vr=1` override. Because
   `features.livePresentationV2` is hardcoded `false` (see "What still feels
   weak" below), that run silently exercised the **legacy pre-V2** Scribe/
   Beat/Artist pipeline — not Live Speech Presentation V2, not Thought-
   Boundary Safety V3, not Visual Re-entry, not Page Arrival Coalescing, not
   the overview removal. It produced 0 `settled-thought` events and an
   unbroken storm of `401` responses from `/api/beat`/`/api/artist`/
   `/api/scribe` (guest sessions aren't authorized for those legacy
   LLM-backed endpoints). I discarded that run and restarted correctly.
2. **The corrected run stalled ~8 seconds before the file's true end and
   never returned a "completed" status.** It reached audio position
   357.691 s (97.7% of the ~366 s file) with 2,804 logged events, then
   stopped advancing entirely — no new events, no new network activity — for
   4+ minutes of real wall-clock time while the page itself stayed
   responsive (a `setTimeout` round-trip still resolved normally). This
   lines up suspiciously with the documented 180-second dev-replay
   credential lifetime: at ~360 s the sender would be on its *second*
   scripted reconnect, right where it hung. I extracted the complete event
   log directly via the app's own dev debug hook (`window.inpublic.log()`)
   rather than through the lab's normal "Export" button, since that button
   only populates after a run resolves and this one never did. This is
   itself logged as an issue below — see the issue register.

Everything analyzed below is therefore drawn from 357.691 s of a ~366 s
natural talk (97.7% coverage), not a truncated or synthetic substitute.

## Viewer-first review

**I did not watch this session as video.** The Browser pane in this
environment never composited frames for me during the run (every screenshot
attempt timed out with "the Browser pane is not displayed"), and no video
recording exists to review afterward — the in-app "Record" control was never
armed. Everything below this point is reconstructed from telemetry
(settled-thought text, camera lifecycle events, Visual Re-entry decisions,
page-turn events), not from watching the board. Per the task's own
instruction ("Do not replace it with telemetry"), I am flagging this
directly rather than writing a viewer narrative I did not actually
experience. If you want a genuine Part 13, it needs a live watch-through —
happy to do that next.

## Live speech presentation

Reconstructed from event ordering, not visual inspection:

- 621 live/transcript/v2 events across the session; the largest gap between
  any two is 6,108 ms (t=175,083→181,191 — see "Long-pause behavior"),
  everything else stays under ~4.1 s. Speech is close to continuous for most
  of the six minutes.
- 419 `live_follow` camera proposals fired, and 418 of them started an
  animation — essentially every proposal moved the camera by at least the
  meaningful-displacement threshold. Of 418 started animations, **0
  completed and 417 were cancelled** by the next proposal before settling
  (the 418th was still in flight when the log froze). This means the camera
  was almost continuously being retargeted rather than reaching a resting
  pose — see "What still feels weak."
- 0 `correction` events were logged, consistent with this being general-
  topic speech with no domain vocabulary for the correction layer to catch.

## V3 boundary quality

51 settled thoughts, 841 total words, average 16.5 words/thought, median 14,
range 3–32. Thought-boundary reason counts across all boundary evaluations
(not just final settles, since most thoughts pass through multiple holds
first): `continuation_hold` 73, `terminal_complete` 27, `safety_bound` 9,
`completed_prefix` 7, `stable_clause` 5, `safe_forced_split` 3 (124 total —
V3 evaluates roughly 2.4 times per thought it eventually settles, consistent
with a patient, hold-biased policy).

Classification of the 51 settled thoughts:

- **GOOD** (~45): clean, complete, sentence-aligned settles — e.g. "We start
  from home. Our destination is at the beach." / "That precipitation could
  be rain, snow, or hail." / "First, we have the product."
- **PREMATURE** (3, all forced by `safety_bound`/`safe_forced_split` on an
  over-long utterance, cut mid-clause): "...A man opens a number that the
  car stores" (incomplete — clause never finishes); "...We usually takes an
  hour when we" (cuts off mid-sentence); "...A traffic jam starts screwing
  upwards along" (splits "along | the highway" across two thoughts). All
  three are the documented cost of the safety bound protecting against
  unbounded `continuation_hold` accumulation, not a boundary-detection bug.
- **OVER-COMBINED** (0): max thought is 32 words; nothing runs away.
- **ASR-CORRUPTED** (0 boundary-level; several word-level errors exist — see
  "ASR errors" below, but none of them broke where V3 chose to settle).
- **AMBIGUOUS** (3): short standalone declaratives ("Second, we have
  customers." / "Then we have revenue." / "Words are sequential.") — 3–4
  words each, grammatically complete but rhetorically part of a larger list;
  defensible either way, not clearly wrong.

We were asked to check whether the frozen V3 policy still feels correct on
fresh speech, not to modify it — it does, with the same known safety-bound
trade-off already documented elsewhere in this codebase.

## Camera behavior

| Metric | Value |
|---|---:|
| Camera starts | 418 |
| Completions | 0 |
| Cancellations | 417 (1 still in flight at log freeze) |
| Moves/minute | ≈70.6 (418 starts / 5.96 min) |
| Page turns | 8 |
| Page-arrival coalesces | 8/8 |
| Generic overview proposals | **0** |
| Unexpected movements | None identified in the log (every start's `reason` is `following live narration` or `page turn: long-utterance` — nothing unexplained) |

Critical checks:

1. **Page turn feels TURN → ARRIVE**: confirmed structurally — 8/8 page
   turns coalesced (`camera-page-arrival-coalesced`), meaning no separate
   page-wide camera start ever preceded the live line landing on the new
   page. Cannot confirm the *visual feel* without watching.
2. **A pause >1.8 s alone does not reframe the page**: confirmed directly —
   see "Long-pause behavior" below.
3. **Live camera moves only when needed for containment**: consistent with
   the `liveLineFitsViewport` gate (unchanged this session) — every start's
   reason is a legitimate live-follow or page-turn cause, never a bare
   timer.
4. **No whiplash/reversal**: 0 overview proposals means the specific known
   reversal pattern (overview → opposite live-follow) is structurally
   impossible this session, matching the prior deterministic proof.
5. **No inexplicable movement**: every one of the 418 starts has a legible
   reason string in the log; none are unattributed.

The one number worth sitting with: **0 completions out of 418 starts.** The
camera is in an almost-continuous chase state rather than settling between
moves. Individually these could be small, imperceptible corrections — or
this could read as restless. I can't tell without watching it, so I'm not
calling it a defect, just flagging it as the strongest camera-side signal
this session produced.

## Long-pause behavior

The largest genuine speech gap in the session is **6,108 ms**, from
t=175,083 ms to t=181,191 ms — 3.4× the old 1.8 s overview timer threshold.
Inspecting every event in that window directly: nothing camera-relevant
happens between the two timestamps. The event right before the gap is a
Visual Re-entry quiet commit (`camera-suppressed`, reason "quiet commit
while speech owns attention"); the event right after is an ordinary
`following live narration` live-follow proposal triggered by resumed
speech. **The camera did not move during the 6.1-second silence.** This is
a real, natural-session confirmation of Generic Overview Removal V1 — not
just the deterministic replay proof from the prior audit. Eight additional
gaps of 2.0–4.1 s exist elsewhere in the session; none of them produced
camera movement either.

## Page transitions

All 8 turns fired `reason: "long-utterance"` (the block in hand outgrew the
sheet), matching the same reason distribution seen in the earlier frozen
corpus — this speaker's talk pattern (long, low-pause monologue) tends to
produce overflow turns rather than natural-completion turns. 8/8 coalesced
cleanly per Page Arrival Coalescing V1's own instrumentation. One turn
(`midThought: true` is absent from all 8 entries here — actually 0 of 8 are
mid-thought, better than the 2/8 mid-thought rate in the earlier frozen
narrative/MLBB corpus) landed while a thought was still open.

## Page composition

Not independently assessed — this requires looking at rendered pages, which
needs the video/screenshot capability I didn't have this session (see
"Viewer-first review"). Structurally: 9 pages were produced (indices 0–8)
for 51 thoughts, averaging ~5.7 thoughts/page, which is in a plausible
readable-density range, but "does it feel cluttered" is a visual judgment I
can't make from telemetry alone.

## Visual Re-entry

51 thoughts evaluated, 45 rejected, 3 accepted, 2 actually committed to the
canvas:

- **Committed 1 — cause_effect**: "That's create that creates more pressure
  on the middle lane. Drivers begin to slow down as more cars arrive from
  behind..." → accepted on "1 explicit directed causal edge with literal
  cues," fast-path succeeded, grounding passed, committed **quietly** (camera
  suppressed, "speech owns attention"). Truthful to the source text; a
  genuine causal claim ("that creates more pressure," "begin to slow down as
  more cars arrive"). Reasonably useful — the causal chain is exactly the
  kind of thing a diagram clarifies over prose.
- **Committed 2 — sequence**: "One driver breaks, then then the driver
  behind them breaks... then that creates a wave traveling backwards" →
  "4 explicit ordered markers with literal grounded step boundaries," fast
  path, committed quietly. Truthful; the source is literally describing an
  ordered chain reaction. Useful for the same reason.
- **Accepted but never committed — sequence**: "I see one word, then
  another, then another. But a visual [shows] relationships at the same
  time..." — accepted, fast-pathed, grounded, rendered, held pending
  ("speech is active"), then **expired** at t=219,687 with reason "thought
  no longer belongs to the active page/session" (a page turn happened before
  it could quietly release). This is a genuine missed opportunity, and a
  notable one: it's the one moment in the whole talk where the **speaker
  explicitly narrates wanting a visual** ("we could place the customer on
  the left... the arrow shows how exactly money moves... that's the
  difference between simply hearing and seeing the structure of the idea"),
  and no visual for that stretch survived to render. The system's underlying
  candidate detection worked (it identified and grounded a real sequence);
  the loss was a lifecycle race against the page turn, not a semantic miss.
  See the issue register.

45 rejections, by reason: "no supported enumeration/quantitative-change/
ordered-process/explicit-causality/two-sided-comparison signal" (majority —
narrative and declarative prose correctly gets nothing), "temporal order is
not causality" (5 instances — correctly declines to draw a causal diagram
just because two things happened in sequence, e.g. the traffic-jam narration
that never explicitly says "because"), "uncertain comparison modality is not
representable" (4 instances), "dependency/constraint is not causality" (2
instances, including the very last thought of the session).

Do not judge by count: 2 committed visuals across 51 thoughts and ~6 minutes
is a low, restrained density, and the majority-rejection pattern below shows
exactly why.

## Good silence

Strong evidence of correct restraint:

- **Temporal-order-is-not-causality** (5 rejections): the traffic-jam
  narrative repeatedly implies sequence ("an accident happens... cars slow
  down... a traffic jam starts") without ever using genuine causal language
  in a form the grounded detector accepts as directed causality, and the
  system withheld a cause/effect diagram for four of those five segments.
- **Uncertain comparison modality** (4 rejections): "we could place the
  customer on the left... the company... and profit on the right" — a
  comparison-shaped description that the system correctly judged too
  underspecified to ground as an actual two-sided comparison layout, rather
  than guessing at a diagram.
- **Dependency is not causality** (2 rejections): "The company [has]
  necessary expenses, we need the company and profit..." and the session's
  final thought ("...depends on another payroll traffic" — likely an ASR
  garble of "another factor") were both correctly kept out of the causal
  family despite dependency-flavored language.
- **Enumeration/quantitative-change never fired at all this session**
  despite genuinely enumerable content (three company parts: product,
  customers, revenue; three lane/traffic states) — the detector held a firm
  line rather than pattern-matching on "first/second/then."

## ASR errors

No domain-vocabulary errors (no MLBB/Aline/esports jargon appears in this
talk, so that layer wasn't exercised). General ASR errors, separated from
harmless ones:

**Materially damaging:**
- "If I reach 100 customers, that's **$50,100 dollars** per month" — should
  be ~$1,500 (100 × $15). A real numeric-transcription error that changes
  the meaning of the example, not just a word.
- "Now imagine it begins to **rear**" — almost certainly "rain" (the very
  next sentence is about a dark cloud and rain stopping ten minutes later).
  Changes the sense of that clause.
- "A man opens a number that the car stores down" — badly garbled, original
  intent unrecoverable from context alone (possibly "opens an umbrella as
  the car slows down").
- "Let's complete the **chair and sub**" — garbled topic-transition phrase,
  unrecoverable.

**Minor/harmless** (recoverable from context, doesn't change meaning):
- "hoaxes all over a narrow road" → almost certainly "houses"
- "silver cost" → almost certainly "server cost"
- "screwing upwards along the highway" → likely "forming upwards"
- "**Row a**" / "**Row b**" / "choose **your** b" → "Route a" / "Route b" /
  "choose route b," repeated consistently enough that a viewer would
  self-correct instantly

Exact PCM retention makes a future targeted A/B on these specific mishears
possible (the same corpus/vocabulary tooling this repo already has for
domain terms), but that's out of scope here — no vocabulary was touched.

## Visual density

- 2 committed visuals / 5.96 minutes ≈ **0.34 visuals/minute**
- 51 thoughts / 2 visuals ≈ **25.5 thoughts/visual**
- 2 visuals / 9 pages ≈ **0.22 visuals/page**

Reported, not optimized toward. Zero would have been a legitimate outcome
too; this session's content simply contained two clean, gettable causal/
sequence claims.

## Five-minute benchmark

**PASS WITH MINOR ISSUE.**

No P0. No P1 defect surfaced in the *frozen feature set itself* — V3, Visual
Re-entry, Page Arrival Coalescing, and Generic Overview Removal all held up
on fresh, dense, low-pause natural speech, including a direct real-session
confirmation that a 6.1-second pause produced zero camera movement. The
minor issues are: (a) the near-0%-completion camera cadence (unconfirmed
severity without video), (b) one grounded, truthful visual that expired
before rendering due to a page-turn race, (c) a couple of materially
misleading ASR mishears in the raw transcript, and (d) the mechanical
problems getting this validation run at all (see next section) — none of
which block or mislead a viewer within the actual V2/V3/Visual-Re-entry
pipeline itself.

## Issue register

| ISSUE | SEVERITY | FREQUENCY | VIEWER IMPACT | SUBSYSTEM |
|---|---|---|---|---|
| `features.livePresentationV2` is hardcoded `false` in the committed source — every real production user (not just this test) is on the legacy pre-V2/V3/Visual-Re-entry/Page-Arrival-Coalescing/Overview-removal pipeline right now | **P0** | Always, for 100% of real traffic | The entire multi-week stabilization effort ("FREEZE IT" x5) is invisible to real users until this flag flips | `lib/features.ts` |
| Dev replay lab (`vr_full`) stalled ~8s before end-of-file on a ~6-minute natural recording and never resolved to "completed" — no error, no timeout, page stayed responsive but no new events for 4+ minutes | P1 | 1/1 observed this session; timing (~357s) lines up with the documented 180s dev-replay credential's second reconnect | Blocks exactly the kind of longer natural-session validation this task asked for; silently produces no exported artifact | `hooks/useDeepgram.ts` / dev replay credential reconnect path |
| Running `vr_full` without `?v2=1&vr=1` silently falls back to the legacy Scribe/Beat/Artist pipeline with no warning, producing a storm of expected 401s against guest-unauthorized endpoints | P2 | Every time the flag is forgotten | Wastes a full session's worth of setup/wait time before the mistake is visible; no UI signal in the replay lab that V2 isn't actually active | `components/DevReplayLab.tsx` / `lib/features.ts` |
| Camera: 418 starts, 0 completions across the session — near-continuous retargeting, never settling | P2 (unconfirmed — no video) | Persistent throughout | Possibly restless/jittery camera; possibly imperceptible if each move is small. Needs a real watch-through to confirm | `components/Board.tsx` live-follow path |
| One grounded, truthful, speaker-explicitly-wanted sequence visual expired before quietly committing because a page turn intervened | P2 | 1/3 accepted candidates this session | A moment where the speaker explicitly narrated wanting a visual got nothing | `lib/visualReentry/` durable-result hold/expiry vs page-turn lifecycle |
| A few raw-transcript ASR mishears materially change the literal meaning of an example (a wrong dollar figure, "rear" for "rain") | P3 | 4 damaging instances in 841 words | Minor; text-only, doesn't affect V3/camera/visual decisions, self-evidently wrong to an attentive reader | ASR / Deepgram, not InPublic-side |

## What now feels solved

- Generic Overview Removal V1 holds on real natural speech, not just the
  frozen deterministic corpus: a genuine 6.1 s pause produced zero camera
  movement, confirmed by direct event inspection, not inference.
- Page Arrival Coalescing V1 held 8/8 on a fresh natural session with 0
  mid-thought turns (better than the 2/8 rate in the earlier frozen corpus).
- Thought-Boundary Safety V3 produces mostly clean, complete settles (45/51
  "good") on genuinely dense, low-pause speech it hasn't seen before; its
  only imperfection (3 mid-clause safety-bound cuts) is the documented,
  understood cost of a known trade-off, not a surprise.
- Visual Re-entry's restraint is real and visible in the reasons themselves,
  not just in a low count: it explicitly and correctly declined causal,
  comparison, and enumeration framings that superficially looked eligible.

## What still feels weak

- **The frozen work isn't live.** This is the headline finding, not a minor
  note: `livePresentationV2: false` is the actual shipped default.
- Camera never completes a move in this session (0/418) — worth watching
  for real before deciding if it's a problem.
- The Visual Re-entry hold/expiry lifecycle can lose a fully-grounded,
  speaker-wanted visual to a page-turn race.
- The dev replay lab itself has two rough edges (silent legacy-pipeline
  fallback, and a reconnect-adjacent stall near end-of-file) that make this
  exact kind of longer natural-session validation harder than it should be.

## Recommended SINGLE next direction

**C. Put the current build in front of real users — but only after flipping
`features.livePresentationV2` to `true`.**

Every other candidate direction (fix a defect, collect more corpus, return
to visual-expression research, work on mobile) is secondary to the fact that
none of the last five "FREEZE IT" milestones are reachable by a real user
today. There is no P0/P1 defect *in* the frozen feature set that blocks
shipping it — the fresh-session evidence above is a clean pass with minor,
non-blocking issues. The highest-leverage action is not more internal
engineering; it's turning on what's already been validated three times over.

## Explicit answers

1. **Did the session pass the five-minute benchmark?** Yes — PASS WITH MINOR
   ISSUE.
2. **Were there any P0 issues?** One, but not in the presentation
   mechanics: `livePresentationV2` is hardcoded off in production.
3. **Were there any P1 issues?** One: the replay-lab run stalled near
   end-of-file and never resolved.
4. **Did live speech remain readable?** By event-level reconstruction, yes —
   every camera move traces to a legitimate live-follow or page-turn cause,
   never an unexplained one. Not visually confirmed (no video).
5. **Did V3 produce any premature thoughts?** Yes, 3 of 51, all mid-clause
   cuts from the documented `safety_bound`/`safe_forced_split` trade-off on
   unusually long utterances.
6. **Did V3 produce any giant/over-combined thoughts?** No — max 32 words.
7. **Did page transitions remain TURN → ARRIVE?** Structurally yes, 8/8
   coalesced; visual feel not confirmed.
8. **Did a long pause trigger a generic overview?** No — a 6.1 s pause
   (largest in the session) produced zero camera movement, confirmed by
   direct inspection of every event in that window.
9. **Did any camera movement feel unnecessary or confusing?** None are
   unattributed in the log; whether the very high move rate (0/418
   completions) *feels* unnecessary needs a real watch-through.
10. **Did any visual misrepresent the speaker?** No — both committed visuals
    are traceable to genuinely truthful causal/sequence language in the
    source text.
11. **How many visuals committed?** 2 (1 cause_effect, 1 sequence); a 3rd
    grounded sequence candidate expired before committing.
12. **Was the current visual density appropriate?** 0.34/minute, 25.5
    thoughts/visual — low and restrained; consistent with most of this
    talk's content genuinely not warranting a diagram.
13. **What was the most distracting moment in the entire recording?** Not
    determinable without video. By telemetry, the closest candidate is the
    418-start/0-completion camera cadence.
14. **What was the strongest moment in the entire recording?** The
    cause_effect/sequence pair on the traffic-jam explanation — correctly
    grounded, truthful, committed quietly without interrupting speech, and
    immediately followed by 5 correct "temporal order is not causality"
    rejections on adjacent, superficially similar language.
15. **Does InPublic currently feel usable for a real person speaking
    naturally?** The frozen pipeline itself: yes, on this evidence. The
    shipped product a real visitor hits today: no, because that pipeline
    isn't turned on.
16. **Should we keep engineering internally, collect more corpus, put it in
    front of users, return to visual-expression research, or work on
    mobile?** Put it in front of users — after flipping the flag that's
    currently keeping all of this invisible.
