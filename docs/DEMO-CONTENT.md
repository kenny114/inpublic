# InPublic Demo Content

Living file of before/after material and public post drafts tied to shipped
changes. Append new sections below; do not overwrite prior ones.

---

# Production Activation — Validated Stack Goes Live

## What changed

InPublic's newer live visual system — the one that settles speech into
clean text units, decides carefully when (rarely) to draw an actual visual,
and keeps the camera calm instead of jumping around — had been running
behind development flags for weeks of testing. The public/default experience
was still using an older pipeline underneath. This change makes the system
that's been tested and validated the actual product, for every visitor, with
no special URL needed.

## BEFORE

- **Source session/video**: not preserved as video — see "Content status."
  Documented in `docs/POST-STABILIZATION-NATURAL-PRESENTATION-VALIDATION-V1.md`,
  "Session" section.
- **Timestamp/clip range**: n/a — no recording exists.
- **Route used**: `/try?replay=1` (no `v2`/`vr` — this was the accidental
  pre-activation default).
- **What the viewer should notice**: choppier, more fragmentary text
  behavior; the camera and canvas reacting to every small speech fragment
  independently rather than settling into clean units.
- **Why this represents the old experience**: this route/flag combination is
  exactly what a real production visitor got before this activation — 0
  settled-thought events, legacy Scribe/Beat/Artist calls, no Visual
  Re-entry, no Page Arrival Coalescing-relevant behavior.

## AFTER

- **Source session/video**: not preserved as video — see "Content status."
  Full telemetry and transcript in
  `docs/VALIDATED-STACK-PRODUCTION-ACTIVATION-V1.md`, "Default /try browser
  validation."
- **Timestamp/clip range**: n/a — no recording exists; the underlying
  session covers a ~88 s natural talk about the product's own recent
  development.
- **Route used**: `/try?replay=1` (no `v2`/`vr` — this is now the same as
  plain `/try` for routing purposes).
- **What the viewer should notice**: text settles into complete, calm
  units; the camera holds still through pauses; one visual appears exactly
  once, tied to a real quantitative claim ("grew from 60 followers to about
  400 and something"), and nothing else gets drawn.
- **What visibly improved**: selective, restrained visual expression instead
  of constant small reactions; calmer camera; cleaner text.

## Best comparison clip

**Not yet identified — no footage exists to compare.** Recommended approach
once recording is possible:

- **Format: sequential BEFORE → AFTER**, not side-by-side. The two pipelines
  produce structurally different canvas layouts (different text rhythm,
  different element counts), so a frame-aligned split screen would look
  arbitrary rather than illustrative. A straight cut from one to the other,
  same speaker, similar topic, reads more honestly.
- **Target length**: 20–45 s total after trimming to the clearest moment in
  each half (roughly 10–20 s per side).
- **Suggested topic for both halves**: the speaker explaining InPublic
  itself, or a day of building it — genuine, unscripted, and it doubles as
  content that explains the product while demonstrating it.

## X post drafts

**1. Very short / punchy**

> I just found out the InPublic people were actually using wasn't the one
> I've spent the last week making calmer and smarter.
>
> Flipped one switch. Before → after.

**2. Builder-in-public / reflective**

> Funny thing about building in public: I spent days making InPublic's live
> presentation calmer, more selective about what it draws, less jumpy with
> the camera — tested it constantly, loved the results.
>
> Then I found out none of it was actually reaching anyone. It was all
> sitting behind a flag I forgot to flip.
>
> Fixed that today. This is what InPublic actually looks like now.

**3. Product-focused**

> InPublic listens to you talk and turns it into a live visual board —
> writing, structuring, and occasionally drawing a diagram, but only when
> your words actually call for one.
>
> That's the real product now, not a preview. Talk, and watch it think with
> you.

## Interesting metrics

- Real users were getting a materially different, noisier presentation
  engine than the one that had actually been validated.
- The camera doesn't move just because you went quiet — confirmed against a
  genuine 6+ second pause producing zero camera movement.
- Visual restraint is real: across two natural talks totaling ~71 settled
  thoughts, only 3 became an actual visual — most speech is correctly left
  as clean text, not forced into a diagram.

Deliberately excluded: internal test counts, HTTP status codes,
architecture-tier names (Reflex/Scribe/Beat/Artist), feature-flag names —
none of it means anything to someone who hasn't been following the
engineering.

## Content status

BEFORE VIDEO: **NEEDS RECORDING**
AFTER VIDEO: **NEEDS RECORDING**
BEST CLIP: **PENDING**
X POSTS: **DRAFTED**

---

## Update — capture attempt (Release Checkpoint V1)

Attempted to close the two "NEEDS RECORDING" gaps above. Neither closed —
documenting exactly why, and exactly what to do to close them, rather than
leaving a placeholder. Full reasoning in
`docs/PRODUCTION-ACTIVATION-DEMO-RELEASE-CHECKPOINT-V1.md`.

**BEFORE** was a dead end by the checklist itself: no forced-off dev
override exists anymore (`?v2=`/`?vr=` are inert once the committed flag is
`true` — confirmed by re-reading the resolvers), and no historical
recording exists (only telemetry from the pre-activation session). The only
remaining option is editing `lib/features.ts`, which the task instructions
explicitly say to stop at rather than do.

**AFTER** is blocked by this environment specifically: the Browser pane has
never composited a capturable frame across this entire validation series
(confirmed independently three times now) — not a replay-lab problem, a
screenshot-capability problem. Re-running the replay again would only
reproduce telemetry already on file.

### BEFORE

FILE: none captured
ROUTE: `/try` (zero query params), on a checkout/stash of `lib/features.ts`
with `livePresentationV2: false` — **do this on a non-shipping branch**,
never on the branch that deploys
CLIP: not recorded — script: the traffic-jam explanation in Part 7 below,
~25–35 s
WHAT TO NOTICE: text arriving in small competing fragments rather than
settling into clean units; more camera/canvas activity per second of speech

### AFTER

FILE: none captured
ROUTE: `/try` (zero query params, current tree — this is now the default,
no flag needed)
CLIP: not recorded — same script as BEFORE for a true comparison
WHAT TO NOTICE: speech settles into complete units before anything happens
visually; camera holds still through pauses; a visual (if the script earns
one) appears once, quietly, tied to the actual causal/sequence claim in the
traffic-jam script

### BEST PUBLIC CUT

FORMAT: sequential BEFORE → AFTER (not side-by-side — the two pipelines lay
out the canvas too differently for frame alignment to read as fair)
LENGTH: 20–35 s combined
BEFORE RANGE: first ~10–17 s of the BEFORE recording, starting the instant
speech begins
AFTER RANGE: first ~10–17 s of the AFTER recording, ending on the committed
visual (or a clean settled page if the script doesn't trigger one)
OPENING FRAME: BEFORE half, speech just started, busier text already visible
ENDING FRAME: AFTER half, resting on the calm final state — never mid-word

### ON-SCREEN TEXT

BEFORE
"Old InPublic"

AFTER
"InPublic now"

Nothing else — two words per half, bottom-left, ~2 s hold. The visual
difference should read before either label needs to.

---

# Validated Stack — Before vs After

**Real video files captured and saved.** Previous entries above marked
`NEEDS RECORDING`/`PENDING` — superseded by this section; not deleted, since
they document the two real dead ends hit first (see
`docs/PRODUCTION-ACTIVATION-DEMO-RELEASE-CHECKPOINT-V1.md`) before this
capture method was found.

> **Correction, found after initial delivery**: the user reported the videos
> show no camera movement. Investigation confirmed this is real, not a
> perception issue — pixel-diffed every consecutive frame in both videos and
> found no full-frame change anywhere (max ~6% of pixels changed between any
> two consecutive frames, consistent with text growing, never with a pan or
> page reframe). Root cause, directly confirmed via
> `document.hidden`/`document.visibilityState` on the capture tab: this
> Browser pane's tab runs with `hidden: true` the whole time (the pane never
> actually displays/focuses in this environment — the same reason the
> screenshot tool has never worked here). Chrome fully suspends
> `requestAnimationFrame` for hidden tabs; Excalidraw's canvas render loop
> runs on rAF; so the canvas silently stops repainting mid-session while the
> app's own logic keeps running underneath (proven: a follow-up capture
> logged real page turns at t=60.6s and t=82.3s, well after that run's
> canvas had already frozen at t=48s). **Neither `inpublic-before.mp4` nor
> `inpublic-after.mp4` shows real camera movement or a page turn** — both
> froze before either occurred. The text-settling comparison in the earlier
> portion of each video is real and unaffected by this. See each file's
> `.json` for the exact freeze timestamp. Fixing this properly requires a
> genuinely focused browser window (Claude-in-Chrome extension, not
> connected as of this note, or the user recording locally) — flagged to the
> user, not silently worked around.

**How this was captured, honestly**: this environment's Browser-pane
screenshot tool has never once composited a capturable frame across this
entire validation series, and the Claude-in-Chrome extension isn't
connected here — so this is not a screen recording. It's real: the page's
own two Excalidraw canvases (`static` + `interactive` layers) were captured
in-browser via `canvas.drawImage` into an offscreen canvas once per second
for the full duration of a real Deepgram replay session, exported as JPEG,
pulled out of the page, and assembled into MP4 with OpenCV. Every frame is
the actual running app's actual rendered pixels — verified by reading two
of them back as images (not just checking file size), reproduced below.

## Source Audio

FILE / SESSION: a WhatsApp voice note already present in this machine's
local corpus (the same natural-talk recording used for the routing
validation in the immediately prior task) — a genuine, unscripted ~88 s talk
about growing a following and a friendly in-game challenge.
START: 0:00
END: 1:28 (full clip, identical file used for both runs)
WHY SELECTED: already proven in the prior task to produce real settled
thoughts and a committed Visual Re-entry visual under the current stack,
and short enough (under 90 s) to capture cleanly twice in one session.

## BEFORE

VIDEO: `artifacts/demo/inpublic-before.mp4` (185 KB, 134 frames, 134 s @ 1
fps, 550×520) + `artifacts/demo/inpublic-before.json`
FEATURE STATE: `livePresentationV2: false`, `visualReentryV1: false` —
reproduced **locally and temporarily only**, reverted immediately after
capture (verified: `git diff -- lib/features.ts` after revert shows only
the permanent activation, no trace of the temporary flip; `npm test` and
`tsc --noEmit` both clean afterward).
WHAT TO NOTICE: content plateaus at frame 21 (~21 s) as small, disconnected
keyword fragments floating in empty space — a real captured frame shows
exactly four isolated boxes: "Interesting Day," "Aspects," "Inpublic,"
"Understood." Not settled sentences — scattered fragments of what the Tier 2
speculative recognizer guessed, never resolved into readable thoughts,
because the legacy Tier 3 pipeline that would normally follow it
(Scribe/Beat/Artist) can't authenticate as a guest. **Does not show camera
behavior** — rendering froze at 21 s, before anything camera-relevant would
have occurred; see the correction note above.

## AFTER

VIDEO: `artifacts/demo/inpublic-after.mp4` (548 KB, 127 frames, 127 s @ 1
fps, 550×520) + `artifacts/demo/inpublic-after.json`
FEATURE STATE: `livePresentationV2: true`, `visualReentryV1: true` — the
real committed default, `/try?replay=1` with zero `v2`/`vr` params.
WHAT TO NOTICE: a captured frame shows full, complete, readable sentences:
"Today was an interesting day in the aspects of InPu[blic]," "I really
understood what I was doing for once...to grow an audience," "and I was
doing the follow back follow method..." — coherent prose building steadily,
not fragments, up to the freeze point at frame 53 (~53 s). **Does not show
camera behavior** — a same-audio, same-flags follow-up run logged real page
turns at 60.6 s and 82.3 s, but that run's canvas had already frozen at 48s;
see the correction note above. The settled-thought/visual-commit telemetry
quoted below is from that same-audio run, not literally this video's own
frames: 19-20 settled thoughts, 1 `quantitative_change` visual committed
quietly, 2 page turns both coalesced, 0 overview proposals, 0 legacy
`/api/scribe`/`/api/beat`/`/api/artist` calls.

## COMBINED DEMO

VIDEO: `artifacts/demo/inpublic-before-after.mp4` (317 KB, 89 frames/seconds
@ 1 fps, 550×520) — BEFORE frames 0–33 (34 s, labeled "BEFORE"), a 1 s black
transition frame, then AFTER frames 0–53 (54 s, labeled "INPUBLIC NOW").
Both halves are entirely within their source video's pre-freeze window, so
this combined cut is unaffected by the freeze issue — but by the same
token it shows the text-settling difference only, not camera/page-turn
behavior (neither source video reaches that far).
BEST RANGE: the full 89 s combined cut, or a tighter manual re-cut of
BEFORE 0–15 s + AFTER 30–55 s (~40 s total) for a punchier social edit.
RECOMMENDED LENGTH: 40 s (tight social cut) or 89 s (full fair comparison).

## X POST

**1. Punchy**

> I just found out the InPublic people were actually using wasn't the one
> I've spent the last week making calmer and smarter.
>
> Flipped one switch. Before → after.

**2. Build-in-public**

> Funny thing about building in public: I spent days making InPublic's live
> presentation calmer, more selective about what it draws, less jumpy with
> the camera — tested it constantly, loved the results.
>
> Then I found out none of it was actually reaching anyone. It was all
> sitting behind a flag I forgot to flip.
>
> Fixed that today. This is what InPublic actually looks like now.

**3. Product-focused**

> InPublic listens to you talk and turns it into a live visual board —
> writing, structuring, and occasionally drawing a diagram, but only when
> your words actually call for one.
>
> That's the real product now, not a preview. Talk, and watch it think with
> you.

RECOMMENDED X POST: **#2 (Build-in-public)**, with one caveat: its "less
jumpy with the camera" line is true and validated (see
`docs/POST-STABILIZATION-NATURAL-PRESENTATION-VALIDATION-V1.md`'s 6.1 s
pause producing zero camera movement), but this specific footage doesn't
demonstrate it — the camera claim would be riding on the text-settling
footage's credibility rather than showing itself. The
fragmented-keywords-vs-complete-sentences difference the footage *does*
show is still exactly the kind of thing a viewer grasps in the first few
seconds. If posting before real camera footage exists, consider trimming
the camera line from draft #2, or pairing it only with the text comparison
claim.

## Content status (superseding the earlier section above)

BEFORE VIDEO: **CAPTURED, LIMITED** — `artifacts/demo/inpublic-before.mp4`;
real, shows text-settling behavior only (froze at 21 s, before any
camera-relevant moment)
AFTER VIDEO: **CAPTURED, LIMITED** — `artifacts/demo/inpublic-after.mp4`;
same limitation, froze at 53 s
CAMERA/PAGE-TURN FOOTAGE: **NOT YET CAPTURED** — blocked by this
environment's Browser pane never being a genuinely focused tab (`document.hidden:
true` throughout, confirmed directly), which suspends Excalidraw's rAF
render loop. Needs either the Claude-in-Chrome extension connected (asked
the user; not connected as of this note) or a locally-recorded capture.
BEST CLIP: **IDENTIFIED for the text-comparison story** —
`artifacts/demo/inpublic-before-after.mp4` (89 s full cut; 40 s manual
re-cut recommended for social, ranges above). Not usable for a
camera/page-turn story yet.
X POSTS: **DRAFTED**, recommendation chosen, with the camera-line caveat
above

---

# Real User Trial V1 — Natural Demo Candidates

Status: **NO REAL-USER MOMENTS CAPTURED YET**

Use this section only for moments that happen naturally during the frozen
3–5-person trial documented in `docs/REAL-USER-TRIAL-V1.md`. Do not coach a
tester, interrupt the session, or create social content during the test. Record
only material covered by the tester's consent.

For each candidate append:

SESSION: **participant code + session ID**<br>
TIMESTAMP: **session-relative time**<br>
WHAT HAPPENED: **observable event or reaction**<br>
WHY IT IS INTERESTING: **surprisingly good visual, clear speech-to-visual
transformation, genuine user reaction, or strong before/after candidate**
