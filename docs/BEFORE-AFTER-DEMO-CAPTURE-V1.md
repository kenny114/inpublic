# InPublic Before / After Demo Capture V1

## Audio selected

A WhatsApp voice note already on this machine (`WhatsApp Ptt 2026-08-14 at
4.50.36 PM.ogg`, ~88 s), the same recording used for the zero-flag routing
validation in the immediately prior task.

## Why this sample

Genuine, unscripted, ~88 s (fits the 30–90 s target), already proven to
produce real V3 settled thoughts and a committed Visual Re-entry visual
under the current stack, and short enough to capture cleanly twice — once
per state — in one session without excess real Deepgram cost.

## Before capture

FILE: `artifacts/demo/inpublic-before.mp4`
SIZE: 185,477 bytes (185 KB)
DURATION: 134 s
RESOLUTION: 550×520, 134 frames @ 1 fps

## After capture

FILE: `artifacts/demo/inpublic-after.mp4`
SIZE: 547,672 bytes (548 KB)
DURATION: 127 s
RESOLUTION: 550×520, 127 frames @ 1 fps

## Combined demo

FILE: `artifacts/demo/inpublic-before-after.mp4` — 316,515 bytes, 89 s
(BEFORE 0–33 s, 1 s black transition, AFTER 0–53 s), 550×520, labeled
"BEFORE" / "INPUBLIC NOW". Runs longer than the nominal 20–60 s target
because AFTER's meaningful growth (fragments → full sentences → visual
commit) doesn't resolve until ~53 s; a tighter 40 s manual re-cut
(BEFORE 0–15 s + AFTER 30–55 s) is documented in `docs/DEMO-CONTENT.md` as
an alternative rather than force-trimming this one and losing the payoff.

## How this was actually captured

Not a screen recording — this environment's Browser-pane screenshot tool
never composited a capturable frame at any point across this whole
validation series (re-confirmed once more at the start of this task), and
the Claude-in-Chrome extension isn't connected here. Real desktop
`computer-use` access was granted, but browsers are restricted to
read-only there by design (masked, no click/type) — not a workaround path
either.

What actually worked: the running page's own two Excalidraw `<canvas>`
layers (`static` content + `interactive` overlay) were captured **inside
the real browser tab**, once per second, for the full duration of a real
Deepgram replay session — each capture drew both canvases onto a scaled-down
offscreen canvas and exported it as a JPEG data URL. The frames were pulled
out of the page (routed through the tool's own overflow-to-disk mechanism
when a batch exceeded the response size limit), decoded, and assembled into
real MP4 files with OpenCV (`cv2.VideoWriter`). I read two of the actual
decoded frames back as images myself before reporting anything, to confirm
this was genuinely working and not silently producing blank canvases —
included below.

## What visibly changed

Real frame content, not a description:

- **BEFORE** (~30 s in): four small, disconnected boxes floating in empty
  space — "Interesting Day," "Aspects," "Inpublic," "Understood." Fragments,
  not sentences. This is the legacy pipeline's actual behavior for a guest
  session: Tier 2 (Reflex) scatters speculative keyword guesses, and the
  Tier 3 pipeline that would normally resolve them into real handwriting
  (Scribe/Beat/Artist) can't authenticate as a guest, so nothing ever
  completes.
- **AFTER** (same ~30 s mark): full, complete, readable sentences building
  steadily — "Today was an interesting day in the aspects of InPu[blic],"
  "I really understood what I was doing for once...to grow an audience,"
  "and I was doing the follow back follow method..." Coherent prose, not
  fragments, growing frame over frame until it plateaus and (per this run's
  telemetry) one `quantitative_change` visual commits quietly.

This is a stronger, more concrete before/after story than "noisy vs. calm"
— it's "broken/fragmentary for a guest" vs. "actually works," which is
arguably more compelling for a public post.

## DEMO-CONTENT.md update

Appended a new `# Validated Stack — Before vs After` section with the full
requested field structure (Source Audio, BEFORE, AFTER, COMBINED DEMO,
X POST), all fields filled with real captured data — not left pending.
Earlier sections marking things `NEEDS RECORDING`/`PENDING` were left in
place (not deleted) since they honestly document the two real dead ends
hit before this capture method was found.

## Recommended X post

**#2, Build-in-public** (unchanged wording from the prior task, now backed
by real footage instead of a plan):

> Funny thing about building in public: I spent days making InPublic's live
> presentation calmer, more selective about what it draws, less jumpy with
> the camera — tested it constantly, loved the results.
>
> Then I found out none of it was actually reaching anyone. It was all
> sitting behind a flag I forgot to flip.
>
> Fixed that today. This is what InPublic actually looks like now.

## Final production flag state

`livePresentationV2: true`, `visualReentryV1: true` — re-verified by
`git diff -- lib/features.ts` (shows only the permanent activation, zero
trace of the temporary BEFORE-state flip) and by importing the module fresh
and calling both resolvers with no window/query context. `npx tsc --noEmit`
clean, `npm test` exits 0.

## Explicit answers

1. **Did you use the exact same audio for both?** Yes, byte-identical file,
   both runs.
2. **Did BEFORE reproduce the old stack?** Yes — `livePresentationV2:
   false`, `visualReentryV1: false`, local only, reverted immediately after,
   never committed.
3. **Did AFTER use the current stack?** Yes — the real committed default,
   `/try?replay=1` with zero `v2`/`vr` params, 20 settled thoughts and a
   committed visual per this run's own telemetry.
4. **Is the BEFORE video actually saved?** Yes —
   `artifacts/demo/inpublic-before.mp4`, 185 KB, verified readable.
5. **Is the AFTER video actually saved?** Yes —
   `artifacts/demo/inpublic-after.mp4`, 548 KB, verified readable.
6. **Can both files be opened and contain real rendered frames?** Yes — both
   re-opened with `cv2.VideoCapture` (frame count, fps, resolution all
   confirmed), and I additionally read two decoded frames back as actual
   images myself (not just file-size checks) before reporting success — see
   "What visibly changed."
7. **Was a combined video created?** Yes —
   `artifacts/demo/inpublic-before-after.mp4`, 89 s, labeled.
8. **What exact clip/range is best for X?** The 89 s full combined file for
   a complete comparison, or the documented 40 s manual re-cut (BEFORE
   0–15 s + AFTER 30–55 s) for a tighter social edit.
9. **Is the application restored to V2=true and VR=true?** Yes, verified
   directly, not assumed.
10. **Did any temporary demo state get committed/pushed/deployed?** No —
    nothing was committed or pushed this session (or any session in this
    series); `git diff` after the revert shows only the permanent
    activation.
