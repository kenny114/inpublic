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

---

# Real User Trial V1 — Frozen Deployment

DEPLOYMENT: **`https://inpublic-mhmswnyjn-kenny114s-projects.vercel.app` (`dpl_F81qj3ijLqChZSDz3RjcYNdGWwZr`), aliased to `https://inpublic.vercel.app`**<br>
COMMIT: **`ac37f04826ea43abecde7d8ae04c845b7d432cae`**<br>
DATE: **2026-08-17**<br>
PRODUCT STATE: **Validated V2 + Thought Boundary Safety V3 + Visual Re-entry families + Page Arrival Coalescing + Generic Overview Removal remain deployed as the zero-query production defaults. The clean guest recheck observed 52/52 2xx responses, zero `/api/projects` or `/api/telemetry/latency` requests, intact local evidence, and no 4xx/5xx. The build is ready for tester 1; no new demo video was created.**

---

# Guest 401 Readiness Fix

DEMO VALUE: **LOW / NOT VISUALLY MEANINGFUL**

BEFORE: **Background anonymous requests produced repeated authentication failures.**

AFTER: **Guest `/try` performs only requests valid for a guest session; local session persistence remains intact.**

PUBLIC VIDEO: **NOT REQUIRED**

---

# Natural InPublic Demo — Founder Test

SOURCE: `inpublic-22fab528-56fb-44c2-9cfc-42ce5f3f5423.mp4` (user-recorded, real
InPublic session, 73.5 s, 1536×730, screen capture of the live board — no
webcam)
FINAL VIDEO: `artifacts/demo/inpublic-demo-clean.mp4`
X CUT: none — the clean cut is already 58 s, inside the X target window, so a
second file would just be a duplicate (see reasoning below)
DURATION: 58.3 s (from 73.5 s source: trimmed ~9.3 s silent lead-in before he
starts speaking, ~3.6 s silent tail after the last word, and tightened two
internal pauses that ran 1.5–1.8 s down to ~0.5 s each — nothing mid-speech
was cut, no sentence was shortened or rewritten)

BEST MOMENT: "Imagine you have an idea in your head, but the person listening
to you can only hear one word at a time."
TIMESTAMP: 0:00–0:07 (new cut) — this became the opening line; it's the
natural hook already in the recording, no invented intro needed.

FUNNIEST / MOST HUMAN MOMENT: none present. This recording is earnest and
explanatory throughout — there's no laugh, aside, or blooper in the source
audio. Per the brief's own rule ("do not claim graphs/visual behavior that
isn't visible"), nothing was added or implied here that didn't happen.

STRONGEST PRODUCT MOMENT: 0:35–0:42 (new cut) — "So instead of you just
listening to me explaining something, you can actually watch your thoughts
take shape while I'm speaking," spoken while the board visibly has five
paragraphs of his own words already organized on screen behind the caption.

WHAT THE VIDEO ACTUALLY SHOWS: A screen recording of the live InPublic board
accumulating clean, readable paragraphs of handwritten-style text in real
time as the founder talks through what the product does, followed by a
straight ask to try it and give feedback.

WHAT IT DOES NOT SHOW: No webcam/face footage. No diagram, graph, or visual
object being drawn — this session's speech never triggered one, so none is
shown or implied. No camera movement/reframing (the board is a static text
column that simply grows). No laugh or bloopered moment.

## Edit notes

- **Captions**: burned in via ASS, word-timed from a local `faster-whisper`
  transcript (no Deepgram, nothing sent to a cloud STT service), corrected in
  two spots against the board's own on-screen text where whisper mis-heard
  ("speed turns" / "can't see" — whisper heard "experience turns" / "can
  see"). Positioned in a top band (~y=15–60 of 730px) instead of the bottom:
  in this footage the top is the region that's reliably empty for the whole
  video, while the board's own text grows downward from the middle and gets
  close to the bottom edge by the end — bottom captions would have collided
  with product content the brief says to protect.
- **Text overlays**: one small "InPublic — talk, watch your thoughts take
  shape" label, bottom-left, first 2.6 s only; one "Try it: inpublic.app/try"
  card, bottom-center, last ~3.8 s only. Nothing else on screen the whole
  video — the board is the demonstration.
- **Audio**: loudness-normalized (EBU R128, -16 LUFS), short fades at the
  very start/end only. No music, no pitch/voice processing, no fabricated
  speech.
- No mid-sentence cuts, no reordering, no invented product behavior.

DURATION: 58.3s
RESOLUTION: 1536x730
FPS: 30
SIZE: 3.78 MB
FILE: `artifacts/demo/inpublic-demo-clean.mp4`

## X post drafts

**1. Punchy**

> Alright I'm actually putting myself out there with this one 😂
>
> This is InPublic right now. You talk. It follows what you're saying and
> starts turning it into a live board while you're still talking.
>
> Try it: inpublic.app/try
> Tell me what feels good and what feels weird.

**2. Build-in-public / reflective**

> Recorded myself actually using the thing I've been building.
>
> You talk, InPublic listens, and your words turn into a clean, readable
> board in real time — no editing, no cuts to the demo part, just what it
> actually does right now.
>
> inpublic.app/try — go talk to it for two minutes and tell me how it felt.

**3. Product-focused**

> Imagine you have an idea in your head, but the person listening can only
> hear one word at a time. That's normal conversation.
>
> InPublic organizes what you're saying as you say it, so the other person
> can actually watch the idea take shape.
>
> Try it: inpublic.app/try

RECOMMENDED X POST: **#2 (Build-in-public)**. The footage is earnest and a
little raw (a founder narrating over his own product, no jump cuts inside
the explanation, no laugh to lean on), so a caption that owns "no editing,
no cuts to the demo part" fits what's actually on screen better than a joke
the video doesn't set up. #1's "😂" promises a laugh moment the recording
doesn't have.

---

# InPublic Demo Studio V1

STATUS: **IMPLEMENTED; CAPTURE VALIDATED WITH THE HONEST WEBM FALLBACK. NATIVE MP4 NOT VALIDATED.**

SUPPORTED INPUTS: WAV, MP3, OGG/Opus

MAX LENGTH: 90 seconds (full-file browser decode; an over-limit WhatsApp OGG was rejected before Run)

PIPELINE: real Deepgram → Live Presentation V2 → Thought Boundary Safety V3 → Visual Re-entry → real Excalidraw canvas/page/camera

CAPTURE: all visible Excalidraw canvas layers composited at 30 FPS with the original decoded source-audio track

BACKGROUND CAPTURE: **NOT SUPPORTED**; hidden-tab transition fails the run

VALIDATION: encoded-pixel sampling, event/pixel correlation, multi-frame camera-motion checks, frozen-suffix detection, audio decode/non-silence, and final-frame comparison are required before COMPLETE

## First validated natural run

TOPIC: Natural founder day recap; audience growth, interactions, and progress

SOURCE: `WhatsApp Ptt 2026-08-14 at 4.50.36 PM.ogg`

VIDEO PATH: `artifacts/demo-studio/demo-8e2512e7-f856-42af-b90a-c393d673c5c0/video.webm`

DURATION: source 87.960 s; video 92.018 s

VISUAL FAMILIES: `quantitative_change`

PAGE COUNT: 3

VISUAL TIMESTAMP: approximately 41.4 s in the encoded video

PAGE TIMESTAMPS: approximately 57.8 s and 81.9 s in the encoded video

CAPTURE VALIDATION: **PASS** — audio peak 0.8631, 369 decoded frame samples, 149 changing frame pairs, both page turns present in pixels, all material camera events produced multiple changed frames, final-frame difference 0.0000996

Manual review remains required:

- BEST MOMENT: not selected
- BEST TIMESTAMP: not selected
- POSTABLE?: not reviewed
- LANDING PAGE WORTHY?: not reviewed
- TRY PAGE WORTHY?: not reviewed
- PRIVACY CLEARED?: not reviewed

## Camera quality notes

Capture fidelity passed; these are product-camera observations only and were not repaired:

- The final settled frame leaves substantial empty space above the active content.
- The active text sits low in the frame.
- The first line of the final page is clipped at the right edge.
- The run logged 39 camera starts, 26 completions, and 13 cancellations, showing repeated retargeting during live follow/page arrival.
- The capture viewport was 784×698, which is not a standard 16:9 publishing frame.

---

# Demo Corpus V1

STATUS: **12 DELIBERATE SCRIPTS READY; AWAITING APPROVAL AND VOICE-NOTE RECORDINGS**

CONTAINER: **WEBM**

CORPUS INDEX: `docs/DEMO-CORPUS-V1.md`

The deliberate corpus has 12 conversational scripts spanning text-only restraint, enumeration, quantitative change, sequence, cause/effect, comparison, mixed structure, multi-page explanation, education, business/product, creator topics, and MLBB/esports.

No corpus recordings have been received yet. The previously validated natural founder run is retained as Demo Studio evidence but is not misclassified as a recording of one of the deliberate scripts.

For each future completed run, add:

- TITLE
- DOMAIN
- SOURCE
- VIDEO
- DURATION
- VISUAL FAMILY
- PAGES
- BEST MOMENT
- BEST TIMESTAMP
- CAMERA QUALITY
- POSTABLE?
- LANDING PAGE?
- TRY PAGE?
- PRIVACY CLEARED?

Process one file at a time. Accept only capture-integrity PASS, then watch the actual WebM before assigning public quality. Do not infer public quality from telemetry alone.

Camera-pattern conclusions remain pending until at least five corpus videos. Final corpus synthesis remains pending until at least eight successful, human-reviewed captures.

## Capture Wave 1 — input preflight

DATE: 2026-08-17

FROZEN PRODUCT FINGERPRINT: `8ff4931ca736e99873980edd1a8eb427b4ed3b50721739bfa9b9fc7fa85bd896`

Three supplied files were processed sequentially through Demo Studio preflight:

| Source | Duration | Result | Video |
|---|---:|---|---|
| `WhatsApp Ptt 2026-08-17 at 8.34.01 AM.ogg` | approximately 350.954 s | REJECTED — exceeds 90 s | NONE |
| `exact-mic-audio (1).wav` | 111.200 s | REJECTED — exceeds 90 s | NONE |
| `exact-mic-audio.wav` | 125.200 s | REJECTED — exceeds 90 s | NONE |

Run remained disabled for every file. No audio was sent to Deepgram, no capture started, and no video/session/transcript/metadata/thumbnail bundle was created. These are input-preflight rejections, not accepted corpus entries and not capture-integrity failures. No speech, visual, camera, page, public-content, or script-quality conclusion was assigned.

REPORT: `docs/DEMO-CORPUS-V1-WAVE-1.md`

## Capture Wave 1 — replacement recordings

DATE: 2026-08-17

FROZEN PRODUCT FINGERPRINT: `8ff4931ca736e99873980edd1a8eb427b4ed3b50721739bfa9b9fc7fa85bd896`

### W1-A-UNMAPPED — This is InPublic

- TITLE: This is InPublic — current product explainer
- DOMAIN: Product / building in public
- SOURCE: `WhatsApp Ptt 2026-08-17 at 3.52.16 PM.ogg`
- VIDEO: `artifacts/demo-studio/demo-c7f3168a-7bcc-4a9d-9010-2411ccdd978f/video.webm`
- DURATION: source 46.580 s; video 50.662 s
- VISUAL FAMILY: NONE — appropriate restraint
- PAGES: 1
- BEST MOMENT: readable text accumulation while explaining that expression matters more than transcription
- BEST TIMESTAMP: approximately 17–31 s
- CAMERA QUALITY: DISTRACTING — left-edge clipping and poor active-content framing after approximately 42.8 s; noticeable whitespace/retargeting
- POSTABLE?: NO as captured
- LANDING PAGE?: NO
- TRY PAGE?: NO
PRIVACY CLEARED?: NOT REVIEWED

PUBLIC QUALITY: **C. INTERESTING BUT NEEDS PRODUCT WORK**

CAPTURE VALIDATION: **PASS** — WebM decodes, source audio present/non-silent, 203 sampled frames, 93 changing pairs, camera events correlate with pixels, final frame passes.

The actual WebM was watched from beginning to end. It remains readable through the middle, then visibly clips several line beginnings during the late camera move. No visual appears, and that restraint is reasonable for the supplied speech. The transcript does not match a planned Demo Corpus V1 script, so no corpus ID is retroactively assigned.

### W1-B-UNASSIGNED

- SOURCE: `WhatsApp Ptt 2026-08-17 at 3.53.31 PM.ogg`
- DURATION: 44.4 s
- CAPTURE: **E. FAILED CAPTURE**
- FAILURE: `CAMERA EVENT NOT PRESENT IN VIDEO`
- VIDEO: NONE
PUBLIC/CAMERA/SCRIPT REVIEW: NOT PERFORMED

### W1-C-UNASSIGNED

- SOURCE: `WhatsApp Ptt 2026-08-17 at 3.54.53 PM.ogg`
- DURATION: 52.5 s
- CAPTURE: **E. FAILED CAPTURE**
- FAILURE: `CAMERA EVENT NOT PRESENT IN VIDEO`
- VIDEO: NONE
PUBLIC/CAMERA/SCRIPT REVIEW: NOT PERFORMED

WAVE RESULT: one validated class-C restraint video, two failed captures, no landing/`/try`/social selection, and no camera-pattern candidate because only one video was reviewable.

---

# Recapture targets — mute test (not yet captured)

Do not replace `public/demos/*` until a take passes: mute the video, you can still follow the idea. Intended spoken scripts:

- Sequence / hero: "First we finish payments. Then we cut latency. Then we bring in ten testers."
- Cause: "Marketing creates traffic, and traffic creates signups."
- Quant: "We went from 60 followers to about 400."
- List: "There are three things we need to improve: speed, accuracy, and presentation."

Existing posters stay until those takes exist. `/try` already prompts the first three.
