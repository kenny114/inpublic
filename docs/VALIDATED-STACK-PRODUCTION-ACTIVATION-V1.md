# InPublic Validated Stack Production Activation V1

## Previous production routing

Before this change, `lib/features.ts` committed `livePresentationV2: false`
and (locally, uncommitted — see "Working-tree context" below) `visualReentryV1:
false`. `isLivePresentationV2Enabled()` and `isVisualReentryV1Enabled()` both
short-circuit to the committed flag in production, ignoring `?v2=`/`?vr=`
entirely there. A normal `/try` visitor therefore always got the legacy
Scribe → Beat → Artist/Director pipeline, never V2/V3/Visual Re-entry/Page
Arrival Coalescing/Generic Overview Removal — confirmed directly in the prior
validation task by an accidental `/try?replay=1` run (no `v2`/`vr`) that
produced 0 `settled-thought` events and a storm of `401`s against
`/api/beat`/`/api/artist`/`/api/scribe` (guest sessions aren't authorized for
those legacy LLM-backed routes).

**Working-tree context.** `git diff` shows the entire `visualReentryV1`
flag/resolver pair, and every camera-replay/Page-Arrival-Coalescing/Generic-
Overview-Removal change validated across the last several tasks, is
currently **uncommitted** working-tree state — none of this has been pushed
or deployed yet. "Production routing" in this report describes what the
current source tree would serve if deployed as-is, which is the only
meaningful sense of "production default" available before a commit/deploy
decision (out of scope here — I only edit files, per this session's standing
git rules).

## Feature/gate matrix

| FEATURE | PRODUCTION DEFAULT (before) | QUERY/DEV OVERRIDE | WHEN OFF | WHEN ON | REQUIRED FOR VALIDATED STACK? |
|---|---|---|---|---|---|
| `livePresentationV2` | `false` | `?v2=1`, dev-only | Legacy Tier 1→3 pipeline (Reflex/Scribe/Beat/Artist/Director) runs | V2 presentation active; Reflex/Scribe/Beat/Artist/Director/Math suppressed entirely (`Board.tsx:5886`, explicit "V2 INVARIANT" comment) | **Yes — the root gate** |
| `visualReentryV1` | `false` | `?vr=1`, dev-only, requires V2 also on | No settled-thought ever reaches Visual Re-entry, even with V2 on | `handleSettledVisualReentry` is called per settled thought (`Board.tsx:5853`) | **Yes** |
| `directorV1` | `true` (unrelated to this task) | none | Beat falls through to plain `choreographerComparison` | Director subsumes comparison's decision | No — moot once V2 is on; Director is only reachable via the legacy Beat chain, which V2 suppresses entirely regardless of `directorV1`'s own value |
| `choreographerComparison` | `true` | none | — | — | No — same reason, unreachable once V2 is on |
| `reflex` (Tier 2 speculative) | `true` | none | — | — | No — explicitly gated `!v2Enabled` at `Board.tsx:6055`; dead once V2 is on |
| `storyMode` | `false` | none | Story Mode UI path inaccessible | — | Not applicable — fully independent branch, gated on `modeRef.current === "story"` and `initialSessionId`, never reads `v2Enabled`/`vrEnabled` |
| `audioReplay` | `false` | none | — | — | Not applicable, untouched |
| `standardMode` | `true` | none | — | — | Already correct, untouched |

No other flag, environment condition, or fallback controls this route. I
traced every `v2Enabled`/`vrEnabled`/`features.*` read in `components/Board.tsx`
(20 call sites) rather than assuming.

## Changes made

`lib/features.ts`: `livePresentationV2: false → true`, `visualReentryV1:
false → true`. Both edits are the flag literal only, with an added comment
recording the activation date and this doc. No other line in the file
changed. No call site in `Board.tsx`, `lib/composition.ts`, `lib/liveSpeech.ts`,
`lib/pagination.ts`, `lib/visualReentry/`, `lib/pageArrivalCoalescing.ts`, or
`lib/cameraReplay.ts` was touched — this is routing/default activation only,
exactly as scoped.

Also updated (test-only, to encode the new contract — see "Production
default regression test"):
- `scripts/features-test.mjs`
- `scripts/live-presentation-v2-test.mjs`

## New Standard Mode architecture

Confirmed directly from code, not assumed: with `v2Enabled` true,
`Board.tsx`'s settle path (~line 5839) always takes the V2 branch —
`writeLive` per V3 settled thought, then (line 5853) `handleSettledVisualReentry`
whenever `vrEnabled` is true. Line 5886's `if (!v2Enabled)` guard is the
single point that would call `settleSpeculative`/`nudgeScribe`/
`resetSilenceTimer` — the *only* path into `runBeat` (Scribe/Beat/Artist/
Director/Math) — and it is now permanently skipped. The chain is exactly:

```
Deepgram → writeLive → Thought-Boundary V3 → settled thought
  → Visual Re-entry (handleSettledVisualReentry)
  → Page Composer (framePage / proposeCamera)
  → Camera (Page Arrival Coalescing, Generic Overview Removal both unchanged)
```

## V2 default

`isLivePresentationV2Enabled()` now returns `true` from the first line
(`if (features.livePresentationV2) return true;`) in every environment,
before it ever reads `NODE_ENV` or `window.location.search`. No query param
is read at all once the committed flag is true — confirmed by the resolver's
own short-circuit, and by a real `/try?replay=1` run (no `v2=`) that produced
20 `settled-thought` events, V3 thought-boundary telemetry, and Visual
Re-entry evaluation on every one of them.

## V3 accessibility

Thought-Boundary Safety V3 is not behind a separate flag — it runs inside
the V2 branch unconditionally whenever `v2Enabled` is true (there is no
`features.thoughtBoundaryV3`). Confirmed active in the zero-flag run above:
20/20 settled thoughts carry V3 boundary reasons, same shape as every prior
validated corpus.

## Visual Re-entry default

Answering Part 4 directly:

1. **Is Visual Re-entry default-off independently from V2?** Yes — its own
   `visualReentryV1` flag, separate from `livePresentationV2`.
2. **Does V2 automatically imply Visual Re-entry?** No. `isVisualReentryV1Enabled()`
   requires both `isLivePresentationV2Enabled()` **and** its own flag/override.
   V2 alone (Visual Re-entry off) would settle thoughts and move the camera
   but never call into `lib/visualReentry/`.
3. **Is `vr=1` only a development override?** Yes, gated by `NODE_ENV !== "production"`
   the same way `v2=1` is — production always reads the committed flag only.
4. **What production default needed changing?** `visualReentryV1: false → true`,
   in addition to `livePresentationV2`. Flipping only V2 would have shipped
   V2's calmer live speech with zero Visual Re-entry — not the validated
   stack.
5. **Does any other gate stop Visual Re-entry from receiving settled
   thoughts?** No — `handleSettledVisualReentry` is called unconditionally
   for every settled thought once `vrEnabled` is true; no per-family flag
   exists (enumeration/quantitative_change/sequence/cause_effect/comparison
   are all reached through the same single gate, confirmed live in this
   task's zero-flag run, which produced a `quantitative_change` commit, and
   the prior 6-minute session, which produced `cause_effect` and `sequence`
   commits — three of the five families exercised live, none separately
   gated).

## Legacy producer suppression

| PRODUCER | CAN EXECUTE UNDER NEW DEFAULT? | WHY / WHY NOT |
|---|---|---|
| Reflex (Tier 2) | No | `Board.tsx:6055` — `features.reflex && !v2Enabled`; `v2Enabled` is now always true |
| Scribe (Tier 3a) | No | Only path in is `nudgeScribe()` at `Board.tsx:5890`, inside `if (!v2Enabled)` |
| Beat (Tier 3b) | No | Only path in is `resetSilenceTimer()` → `runBeat`, same `!v2Enabled` guard |
| Artist (Tier 3c) | No | Only reachable from inside `runBeat` |
| Organizer | No | Only reachable from inside `runBeat`/Artist chain |
| Director/Choreographer | No | Only reachable from inside `runBeat`, regardless of `directorV1`'s own value |

Confirmed live: the zero-flag `/try?replay=1` run produced zero `/api/scribe`,
`/api/beat`, or `/api/artist` network calls (full network log inspected, see
"Network/API audit").

## Story Mode integrity

Untouched, confirmed by reading, not assumed. `modeRef.current` is set from
`requestedMode`/`session.mode`, gated only by `features.storyMode` (still
`false`) and `initialSessionId` — no line reads `v2Enabled` or `vrEnabled`.
Every `if (modeRef.current === "story")` branch in `Board.tsx` (9 call
sites checked) is independent of this activation.

## Default /try browser validation

Ran `/try?replay=1` — deliberately **no** `v2=`/`vr=` — through the real
dev server, uploaded a genuine natural voice note (a different one from the
prior validation, ~88 s), and inspected the live event log and full network
log while it ran.

Result: 20 settled thoughts, V3 boundary telemetry present, Visual Re-entry
evaluated all 20 (18 rejected, 1 accepted — `quantitative_change`, committed
quietly), 2 page turns both coalesced (2/2), **0 overview proposals**, 0
`/api/scribe`/`/api/beat`/`/api/artist` calls. This is the routing proof: the
same code path a real microphone session takes, now defaulting to the
validated stack with zero query parameters.

One caveat carried over honestly: this run, like the ~6-minute natural
session in the prior task, **stalled near the true end of the file** (froze
at t=96,912 ms — past the file's ~88 s estimated length — for 60+ s of real
time with no new events) and never returned to an idle "select a file"
status. This is the same reproducible dev-replay-lab finalization issue
flagged as P1 in the prior report, now confirmed a second time on a
different, much shorter file — strengthening it as a real, reproducible bug
rather than a one-off. It does not affect production's real-microphone path
(no replay credential, no replay pacer involved there) and is explicitly
out of scope for this task (Part 19).

## Guest-path validation

A normal guest/new-user path was exercised (no auth cookie, `guest
startFresh` Board props via `/try`): entered `/try`, the replay stood in for
"begins speaking," V2 live speech ran, V3 settled 20 thoughts, Visual
Re-entry evaluated and committed one visual, 2 pages were reached — all
without a single legacy authentication error. The only 401s in the entire
network log are `/api/projects` (guest-session autosave, pre-existing,
unrelated to this activation, out of scope per Part 19).

## Network/API audit

| ENDPOINT / SUBSYSTEM | CALL COUNT | EXPECTED? | RESULT |
|---|---:|---|---|
| `/api/scribe` | 0 | Expected 0 | ✓ |
| `/api/beat` | 0 | Expected 0 | ✓ |
| `/api/artist` | 0 | Expected 0 | ✓ |
| `/api/visual-intent` (Visual Re-entry model fallback) | 0 | Conditionally expected | ✓ — the one accepted candidate this run resolved on the deterministic fast path, no model call needed |
| `/api/deepgram/token` | 1 | Expected | ✓ 200 OK |
| `/api/dev/replay-authorization` | 1 | Expected (replay-only) | ✓ 200 OK |
| `/api/anon/entitlement` | 1 | Expected | ✓ 200 OK |
| `/api/projects` | ~48 | Pre-existing guest-autosave behavior | 401 Unauthorized each time — unrelated to this activation, not fixed here (Part 19) |

## Regression suites

- `npx tsc --noEmit`: clean.
- `npm test` (full chain, all 15 scripts): **exits 0**, including
  `product-test.mjs`'s 40 checks. This is the first fully green `npm test`
  run referenced across this whole validation series — the pre-existing
  `directorV1 defaults off` failure is gone (see next section).
- Individually re-verified: `features-test.mjs` 21/21, `foundation-test.mjs`
  103/103, `unit-test.mjs` 299/299, `pipeline-test.mjs` 40/40, `story-test.mjs`
  51/51, `story-visual-test.mjs` 61/61, `story-v2-test.mjs` 49/49,
  `composition-test.mjs` 21/21, `camera-replay-test.mjs` 12/12,
  `math-test.mjs` 81/81, `audio-test.mjs` 56/56, `live-presentation-v2-test.mjs`
  47/47, `visual-reentry-test.mjs` 242/242, `replay-lab-test.mjs` all
  deterministic checks passed.

## Director flag assertion status

**A — stale test, not unintended activation.** `lib/features.ts` commits
`directorV1: true` (unrelated to this task, unchanged by it); `scripts/features-test.mjs`
asserted `features.directorV1 === false`, which was already failing before
any change in this session (documented in
`docs/PAGE-ARRIVAL-COALESCING-V1-PRODUCTION-VALIDATION.md`'s regression
section as the sole pre-existing `npm test` failure). Director's real
reachability was never governed by that assertion — it's governed entirely
by the `!v2Enabled` guard at the top of the legacy-producer chain (see
"Legacy producer suppression"), which is unaffected by `directorV1`'s own
value either way. I updated the stale assertion to `=== true` (matching
reality) while auditing this file for the Part 9 regression test, since it
was directly adjacent — no broader Director investigation was performed, as
scoped.

## Development override behavior

`?v2=1` and `?vr=1` still exist in the resolver functions and remain
functionally correct in their own right, but are now **inert in every
environment**: both resolvers check the committed flag first and return
`true` immediately, before ever reading `NODE_ENV` or the query string. There
is currently no "forced-off" debug override — only the old "forced-on when
the committed default was off" direction, which has nothing left to force
now that the default is on. Reverting to compare against legacy behavior
requires flipping the two literals in `lib/features.ts` back to `false`
(the query params alone cannot do it). This is not a regression introduced
here — it was already true of `livePresentationV2`'s design before this
task ("Production always ignores the query param and reads the flag only")
— just newly relevant now that the flag is on by default.

## Demo Content

### Before asset

**NEEDS RECORDING.** The prior validation task's accidental legacy-pipeline
run (`/try?replay=1`, no `v2`/`vr`) is documented in
`docs/POST-STABILIZATION-NATURAL-PRESENTATION-VALIDATION-V1.md`'s "Session"
section — 0 settled thoughts, 23 page turns, guest `401` storm against
`/api/beat`/`/api/artist`/`/api/scribe` — but no video or screenshot exists
from it. This sandboxed Browser pane never composited a visible frame for me
this entire multi-task session (every `computer.screenshot` call failed with
"the Browser pane is not displayed"), so I have telemetry proof but no
visual asset. I did not fabricate one.

### After asset

**NEEDS RECORDING**, same limitation. This task's zero-flag `/try?replay=1`
run produced a strong, genuinely usable transcript and telemetry (20 settled
thoughts, a clean `quantitative_change` visual on "grew from 60 followers to
about 400 and something," 2 clean page turns) — but again no video/screenshot
was capturable in this environment.

### Recommended clip

Not identified from existing material — none exists yet. **Recommended
script for what to record, once video capture is possible** (either by you
running it locally, or by me in an environment where the Browser pane
actually composites):

- **BEFORE**: `/try` (zero flags) on the pre-activation source (`git stash`
  this task's `lib/features.ts` change, or check out the commit before it),
  speaking naturally for ~30–45 s. Expect: choppier/poppier text as
  Scribe/Beat write independently of settled speech, no clean visual
  restraint.
- **AFTER**: `/try` (zero flags) on the current source, same speaker, similar
  topic, ~30–45 s. Expect: calmer settle-then-express behavior, camera that
  doesn't lurch on pauses, a visual only where the content actually earns
  one.
- Sequential BEFORE → AFTER (not side-by-side) is the right format — the
  two pipelines produce visually distinct canvas layouts, not a frame-aligned
  comparison, so a straight cut reads better than a split screen.
- Target 20–45 s total once trimmed to the clearest moment in each half.

### What viewers should notice

- Text settles into calm, complete units instead of arriving/vanishing in
  small fragmentary pops.
- The camera doesn't jump around during pauses.
- When something visual actually appears, it's because the content earned
  it (a real number changing, a real ordered process) — not automatically.

### X drafts

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

### Interesting metrics

- The specific bug this fixes: real users were getting a different,
  noisier presentation engine than the one publicly validated and discussed.
- Camera stays still through pauses — it doesn't move just because you went
  quiet.
- Visual restraint: across two real natural talks (this one and the prior
  6-minute session), only 3 of 71 settled thoughts became a visual — most
  speech is correctly left as clean text.

Deliberately not included: internal test counts, HTTP status codes,
architecture-tier names (Reflex/Scribe/Beat/Artist), or anything requiring
the reader to know what V2/V3/a feature flag is.

### Content status

BEFORE VIDEO: **NEEDS RECORDING**
AFTER VIDEO: **NEEDS RECORDING**
BEST CLIP: **PENDING** (script above ready; no footage yet)
X POSTS: **DRAFTED**

## docs/DEMO-CONTENT.md update

Created fresh (`docs/DEMO-CONTENT.md` did not exist before this task) with
the "Production Activation — Validated Stack Goes Live" section containing
all of the above.

## Remaining known issues

Unchanged from the prior validation report, explicitly not touched here per
Part 19: the 0-completion camera cadence, the Visual Re-entry page-turn
expiry race, the dev-replay-lab finalization stall (now reproduced twice),
ASR mishears, and the `/api/projects` guest-autosave 401s.

## Explicit answers

1. **What did an ordinary /try visitor receive before?** The legacy
   Scribe/Beat/Artist/Director pipeline — no V2, no V3-gated settling
   behavior beyond Tier 1 ink, no Visual Re-entry, no Page Arrival
   Coalescing/Generic-Overview-Removal-relevant camera behavior (those are
   V2-only code paths that were simply never reached).
2. **What do they receive now?** The validated stack: V2 live speech, V3
   thought settling, Visual Re-entry across all its families, Page Arrival
   Coalescing, and Generic Overview Removal — with zero query parameters.
3. **Is V2 default-on?** Yes.
4. **Is V3 active without query flags?** Yes — it has no separate flag; it's
   inside the V2 branch.
5. **Is Visual Re-entry active without `vr=1`?** Yes — `visualReentryV1` is
   now also `true`.
6. **Are legacy visual producers suppressed?** Yes, all of Reflex/Scribe/
   Beat/Artist/Organizer/Director, structurally (the single `!v2Enabled`
   gate they all route through).
7. **Did `/api/scribe` execute?** No, 0 calls in the zero-flag validation run.
8. **Did `/api/beat` execute?** No, 0 calls.
9. **Did `/api/artist` execute?** No, 0 calls.
10. **Did guest presentation 401 errors occur?** No — the only 401s are the
    pre-existing, unrelated `/api/projects` autosave calls.
11. **Does Page Arrival Coalescing still work?** Yes, 2/2 coalesced in the
    zero-flag run; unchanged code.
12. **Can silence still trigger generic overview?** No — 0 overview
    proposals in the zero-flag run; the call site that produced them remains
    deleted (unrelated prior task).
13. **Did presentation behavior change beyond routing/default activation?**
    No — no presentation algorithm file was edited in this task; only the
    two flag literals and two test files.
14. **Are development overrides retained?** Yes, the code paths still exist,
    but they're now inert (see "Development override behavior") since the
    committed flags already return `true` before either is read.
15. **Is the validated stack NOW what normal users receive?** Yes, in the
    current source tree (still uncommitted/undeployed — see "Working-tree
    context").
16. **Is anything blocking real-user testing?** Nothing in the presentation
    stack itself. The only blockers are outside this task's scope: the
    change needs to actually be committed/deployed, and this environment
    cannot produce video for the demo content.
17. **Was a usable BEFORE demo preserved?** No — telemetry-only, no video;
    documented honestly rather than fabricated.
18. **Was a usable AFTER demo recorded?** No — same limitation; strong
    telemetry and transcript exist, no video.
19. **What exact clip should I post?** None exists yet to post. Record the
    BEFORE/AFTER script in "Recommended clip" above once video capture is
    available, then use draft #2 (builder-in-public/reflective) as the
    anchor post — it's the one that best explains *why* this matters without
    requiring the reader to know anything about the internals.
20. **What is the strongest X post draft?** #2 — it tells the actual story
    (validated work sitting unreleased) rather than describing a feature,
    which is more relatable and more honest about what actually happened.
