# InPublic Production Activation Demo + Release Checkpoint V1

## Release state

`lib/features.ts`: `livePresentationV2 = true`, `visualReentryV1 = true`,
re-verified directly (not assumed) by importing the module and calling both
resolvers with no window/query context — both return `true` from the
committed flag alone. `npx tsc --noEmit`: clean. `npm test` (all 15 scripts
in the chain, ending in `product-test.mjs`'s 40 checks): exits 0.

## Git/change summary

67 changed/untracked paths total, none of them from this task (no code was
touched here — checkpoint and demo work only). Classified:

**COMMIT-READY** (real, intentional feature work from this validation
series):
- `lib/features.ts` — the activation itself
- `components/Board.tsx`, `hooks/useDeepgram.ts` — V2/replay/camera work
  (+1,007 / +543 lines)
- `lib/liveSpeech.ts`, `lib/types.ts`, `lib/latency.ts`, `lib/telemetry.ts`,
  `lib/sessionLog.ts`, `lib/vocab.ts`, `lib/math/ground.ts`,
  `lib/server/limits.ts`, `lib/server/provider-guard.ts`,
  `app/api/deepgram/token/route.ts`, `app/try/page.tsx`
- `lib/cameraReplay.ts`, `lib/pageArrivalCoalescing.ts`, `lib/replayLab.ts`,
  `lib/replayPacing.ts`, `lib/replayAuthorizationPolicy.ts`, `lib/corpus.ts`,
  `lib/corpusAudio.ts`, `lib/server/developmentReplayAuthorization.ts`
  (untracked, new files)
- `lib/visualReentry/` (13 new files) + `app/api/visual-intent/route.ts`
- `app/api/dev/replay-authorization/route.ts` — dev-only, gated by
  `NODE_ENV=development` + loopback + same-origin (documented in
  `docs/REPLAY-LAB-AUTHORIZATION.md`)
- `components/DevReplayLab.tsx` — dev-only UI, gated by `isReplayLabEnabled`
- `scripts/features-test.mjs`, `scripts/live-presentation-v2-test.mjs`
  (this session's edits), `scripts/foundation-test.mjs`,
  `scripts/math-test.mjs`, `scripts/unit-test.mjs` (modified),
  `scripts/camera-replay-test.mjs`, `scripts/visual-reentry-test.mjs`,
  `scripts/replay-lab-test.mjs`, `scripts/overview-camera-audit.mjs`,
  `scripts/overview-eligibility-v2-ab.mjs`, `scripts/camera-policy-ab.mjs`,
  `scripts/thought-boundary-v3-replay.mjs`, `scripts/merge-replay-investigation.mjs`
  (new, untracked)
- `package.json` — wires the three new test scripts (`camera-replay-test`,
  `visual-reentry-test`, `replay-lab-test`) into the `test` chain
- `scripts/stt/aline.mjs`, `scripts/stt/stream.mjs` (modified) — vocabulary
  work referenced by prior docs
- `docs/*.md` (18 files) — the full validation paper trail this series has
  produced, including the two new files from this task's own predecessor
  (`VALIDATED-STACK-PRODUCTION-ACTIVATION-V1.md`, `DEMO-CONTENT.md`)

**TEMPORARY** (nothing found this task — the two `public/tmp-*.ogg` files I
created in prior tasks for browser file-upload were already deleted at the
end of each of those tasks; `git status public/` confirms zero changes
there now).

**DEBUG/ARTIFACT** (real captured evidence, not source, but not throwaway
either — referenced by the docs above as their supporting data):
- `artifacts/` (33 MB: `natural-speech-corpus-v1/`, `replay-pacing-v2-2026-08-15/`,
  `speech-tail-latency-2026-08-15/`, `visual-reentry-cause-effect-v1/`,
  `visual-reentry-comparison-v1/`, `visual-reentry-sequence-v2/`) — recorded
  audio/JSON/PNG evidence from prior validation tasks
- `scripts/stt/domain-natural-ab-1786931466365.json`,
  `scripts/stt/domain-natural-clips-e7a76c03.json` — timestamped/hashed
  generated output from ASR vocabulary A/B runs
- `scripts/stt/domain-natural-clips.example.json` — looks like an intentional
  committed fixture template (no timestamp/hash in the name), not a
  generated artifact — flagging the distinction rather than guessing

Nothing was deleted. This is a checkpoint/classification only, per
instructions — commit/push decisions are yours to make.

## Tests

`npx tsc --noEmit`: clean.
`npm test`: 0 exit code, every one of the 15 chained scripts green,
including `product-test.mjs`'s 40 checks at the end. Directly re-verified
`features.livePresentationV2 === true` and `features.visualReentryV1 ===
true` by importing `lib/features.ts` fresh and calling both resolver
functions with no window/query state — both return `true` from the
committed flags alone, confirming legacy suppression holds with zero query
parameters.

## Before demo

**Blocked — correctly, per this task's own instructions, not worked
around.** Part 4 gives an explicit decision order: (1) an existing
dev override that forces V2/VR off, (2) an existing historical recording,
(3) local dev-only reproduction — and explicitly says to **stop** and fall
back to (2) if (3) would require code modification, never to flip the
production default back to `false` "merely for content."

I checked (1) directly: `isLivePresentationV2Enabled()` and
`isVisualReentryV1Enabled()` both return `true` from the committed flag
before ever reading `window.location.search` — confirmed by re-reading
`lib/features.ts`'s resolvers and by a fresh import-and-call test just now.
There is no forced-off override left; `?v2=`/`?vr=`/any variant (`?v2=0`,
etc. — grepped for one, found none) is dead code from the moment the
committed flag is `true`. Reproducing legacy behavior would require editing
`lib/features.ts`, which is exactly the code-modification case Part 4 says
to stop on.

I checked (2): no historical recording exists. The prior task
(`docs/POST-STABILIZATION-NATURAL-PRESENTATION-VALIDATION-V1.md`) captured
the legacy pipeline's *telemetry* (0 settled-thought events, 23 page turns,
a `401` storm against `/api/beat`/`/api/artist`/`/api/scribe`) but no video —
the Browser pane in this environment never composited a visible frame for
me across that entire task (every screenshot attempt failed with "the
Browser pane is not displayed"), so no footage was ever capturable, not
just not yet captured.

Per Part 4's own instruction, this is a stop condition, not a workaround
opportunity — I did not flip the flag, even temporarily.

## After demo

Same underlying blocker, for a different reason: video/screenshot capture
itself has failed in this Browser pane every single time it's been
attempted across this entire validation series (confirmed independently in
two prior tasks, not a one-off). Re-running another live replay session
right now would reproduce telemetry I already have — routing correctness
with zero query params is already proven twice, most recently this task's
predecessor with a real `/api/` network audit showing 0
scribe/beat/artist calls — without producing the one thing actually
missing (video). I did not spend a further real Deepgram session confirming
something already confirmed; that would be cost for no new information, not
diligence.

What exists instead, usable as the AFTER script/transcript reference:
`docs/VALIDATED-STACK-PRODUCTION-ACTIVATION-V1.md`'s zero-flag `/try?replay=1`
run — 20 settled thoughts, a `quantitative_change` visual on "grew from 60
followers to about 400 and something," 2 clean coalesced page turns, 0
overview proposals, 0 legacy calls.

## Recommended public clip

**None exists to post.** I'm not going to describe a clip I don't have
footage for as if it's ready. What I can hand off precisely: the script and
routes needed to capture it, so recording it (by you, locally, where the
browser actually renders) is a five-minute task, not a research problem:

- **BEFORE**: on a separate branch/stash with `lib/features.ts` reverted to
  `livePresentationV2: false` (not on the branch that ships), open `/try`
  with zero query params, speak the traffic-jam script from Part 7 for
  ~25–35 s.
- **AFTER**: on the current tree, open `/try` with zero query params, speak
  the same script.
- **Format**: sequential BEFORE → AFTER, not side-by-side — the two
  pipelines lay out the canvas differently enough that frame alignment
  would look arbitrary rather than clarifying.
- **Target length**: 20–35 s combined after trimming to the clearest ~10–17 s
  of each half.
- **Opening frame**: BEFORE half starts the instant speech begins, so the
  first thing on screen is the older, busier text behavior.
- **Ending frame**: AFTER half ends on the one committed visual (or, if none
  fires on this particular script, on a clean settled final page) — not
  mid-sentence.
- **On-screen text**: two words each, bottom-left, ~2 s hold: `Old InPublic`
  over the BEFORE half, `InPublic now` over the AFTER half. Nothing else —
  the visual difference should read in the first 5 seconds without a label
  doing the work.

## docs/DEMO-CONTENT.md status

Updated with the exact field structure requested (BEFORE/AFTER/BEST PUBLIC
CUT/ON-SCREEN TEXT), all fields filled where I have real information (route,
script, format reasoning) and explicitly marked pending where footage is the
only missing piece — not left as an unexplained placeholder.

## Recommended X post

Draft 2 (builder-in-public/reflective), unchanged from the prior task's
wording — it's the one that explains *why this matters* without requiring
the reader to know anything about feature flags, and it's honest about what
actually happened rather than describing a shipped feature:

> Funny thing about building in public: I spent days making InPublic's live
> presentation calmer, more selective about what it draws, less jumpy with
> the camera — tested it constantly, loved the results.
>
> Then I found out none of it was actually reaching anyone. It was all
> sitting behind a flag I forgot to flip.
>
> Fixed that today. This is what InPublic actually looks like now.

## Optional follow-up reply

Held until real footage exists — a reply promising "here's what changed"
without a clip to back it up would undercut the post rather than extend it.
Draft, to use once the BEFORE/AFTER clip is attached to the original post:

> The camera used to jump around and expression was noisier — now it settles
> speech into clean thoughts first and only draws something when the content
> actually earns it.

## Known issues intentionally deferred

Per Part 14, not touched, not investigated further this task: the
replay-lab reconnect/finalization stall, the 418-start/0-completion camera
cadence, the Visual Re-entry page-turn expiry race, ASR numeric errors,
roamer, mobile, family #6, the V3 safety-bound cuts. All remain exactly as
documented in the prior two reports' issue registers.

## User-test readiness

A normal `/try` visitor, zero query params, confirmed twice across two
separate real replay sessions (one ~6 min, one ~88 s, both through the
actual production code path): gets V2, V3 (no separate flag — inside the V2
branch), Visual Re-entry (all families reachable through one gate, three of
five exercised live), Page Arrival Coalescing (2/2 and 8/8 coalesced across
the two sessions), zero generic overview proposals, and zero legacy
Reflex/Scribe/Beat/Artist/Director calls. No P0 or P1 blocks a real user
today.

On the replay-lab stall specifically: current evidence points to
development-tool-only, not user-facing, but I want to be precise about the
limit of that evidence rather than overclaim it. The stall has only ever
been observed through the dev replay lab's `replay-pcm16` capture path,
which uses a credential explicitly documented (`docs/REPLAY-LAB-AUTHORIZATION.md`)
as issued only through `/api/dev/replay-authorization` with a 180 s
lifetime specific to that dev-only flow — a real microphone session never
requests that credential and uses an entirely different capture path in
`hooks/useDeepgram.ts` with the ordinary 60 s production credential. I have
not personally driven a real microphone session end-to-end (no microphone
in this environment) to directly confirm the stall doesn't reproduce there
too — the "development-only" conclusion is a strong code-path argument, not
a live-mic-session negative result. Worth a real check before calling it
fully closed, but nothing here should hold up launch on its own account.

## Explicit answers

1. **Is the validated stack still production-default?** Yes — reconfirmed by
   direct import/call, not assumption.
2. **Are all tests green?** Yes — `tsc --noEmit` clean, `npm test` exits 0.
3. **Is there a clean BEFORE recording?** No — and per Part 4's own decision
   tree, correctly not manufactured by reverting the flag or otherwise
   modifying code.
4. **Is there a clean AFTER recording?** No — blocked by this environment's
   Browser pane never compositing a capturable frame, confirmed across
   three separate tasks now.
5. **Did AFTER use plain /try with no v2/vr flags?** The *telemetry* proof
   did, twice, most recently in the immediately prior task. No video exists
   from either run.
6. **Is the same/comparable speech shown in both?** N/A — no footage of
   either side exists to compare.
7. **What exact 15–40 second clip should be posted?** None exists yet. The
   script/route/format needed to make one is fully specified above.
8. **Side-by-side or sequential?** Sequential (BEFORE → AFTER), for the
   reason given above.
9. **What should the on-screen labels say?** `Old InPublic` / `InPublic now`.
10. **What is the recommended X post?** Draft 2, reproduced above.
11. **Is there any real-user P0 remaining?** No.
12. **Is there any real-user P1 remaining?** No, based on the routing/
    suppression evidence gathered so far.
13. **Is the replay-lab stall user-facing or development-only based on
    current evidence?** Development-only by strong code-path argument (a
    real mic session never touches the credential path that stalls); not
    yet confirmed by an actual live-mic test, which I cannot perform myself
    in this environment.
14. **Is this build ready to put in front of people?** Yes, on the
    presentation-behavior evidence gathered across this whole series. What's
    not ready is the public demo footage — that's a content-production gap,
    not a product blocker.
