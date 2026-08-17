# InPublic Overview Eligibility V2 Offline A/B

Offline / development-only. No production behavior was changed. Page Arrival
Coalescing V1 remains enabled and unchanged; its 12-case deterministic matrix
still passes (`node --import ./scripts/ts-register.mjs scripts/camera-replay-test.mjs`).

## Current timer overview

Unchanged from the Overview Usefulness + Reversal Audit V1: `writeLive(...
settled=true)` arms a 1,800 ms timer; any later live write rearms it; firing
with no queued durable visual or pending structural reframe produces a
forced, urgent, full-page `framePage` proposal (`force=true`,
`explicitNavigation=true`), which bypasses the normal cooldown, manual-camera
priority, and meaningful-displacement guards. It requires only "a thought
settled and 1.8 s of silence," not page, topic, or session completion.

## Explicit completion signals available

**A. Session completion.** `lib/types.ts` declares `type: "latency"` as "one
latency summary per listening session, written when the mic stops"
(`lib/types.ts:265`). A real, deterministic mic-stop call site exists —
`stop()` in `hooks/useDeepgram.ts:564`, which tears down the socket, finishes
`exactMicAudio`, and sets status to `idle`. But grepping all of `lib/` and
`hooks/` for `"latency"` finds only the type declaration — **there is no
call site anywhere that actually pushes a `latency` event**. Session
completion therefore has a real lifecycle boundary but no wiring that makes
it observable to the camera/overview layer today. This audit does not add
that wiring (would be new instrumentation, not a policy comparison), so
Policy C's session-completion branch is evaluated against real telemetry and
never fires in any available corpus.

**B. Page completion.** Fully available today: `type: "page"` events carry
`index`, `reason` (`PageTurnReason`), and `midThought`. This is real,
deterministic, and already logged on every turn.

**C. Topic/presentation-beat completion.** No deterministic signal exists.
The only architectural candidates are terminal punctuation, thought
settlement, and the 1.8 s timer — the audit V1 already showed the timer is
not reliable end-of-beat evidence, and the other two are exactly the "not
sufficient evidence" list this task rules out. Per Part 12: **topic
completion is not implemented and not recommended.**

## Page completion

All 8 page turns across the three frozen sessions carry `reason:
"long-utterance"` (one long single utterance exceeded the sheet), not
`"completed-section"` or `"topic-change"`. No turn in this corpus represents
a speaker actually finishing a page's content — every turn here is a forced,
mid-content overflow split. That matters for Part 3/10: this corpus contains
zero examples of a *content-complete* page turn to test "does the old page
deserve a last look before turning," only overflow turns where the content
is unfinished by construction. The design rule stands regardless
(`PAGE TURN CONSUMES COMPLETION` — no pre-turn overview), but its practical
value cannot be demonstrated from this corpus specifically.

## Topic completion availability

Not available. See above. Strong-completion V1, per Part 12's mandate,
consists only of page completion (which does not get a separate overview)
and session completion (currently unobservable).

## Natural corpus

Same three frozen deterministic proposal streams as the V1 audit (identical
files, re-verified against `lib/cameraReplay.ts` unchanged):

| Session | Source | Duration | Page turns | Overview proposals |
|---|---|---:|---:|---:|
| Product/explanation | `inpublic-replay-1786934535869.json` | 166.570 s | 3 | 2 |
| Narrative | `inpublic-replay-1786934781808.json` | 157.952 s | 3 | 0 |
| MLBB natural speech | `inpublic-replay-1786935164041.json` | 111.200 s | 2 | 1 |
| **Total** | | **435.722 s** | **8** | **3** |

A full scan of every `.playwright-cli/inpublic-replay-*.json` capture in the
repo (19 files, including sessions not in the frozen set) found **zero**
`type: "latency"` events in any of them. No fresh session with a captured
mic-stop boundary exists locally to substitute. Per Part 8, no positive
overview event was fabricated to compensate.

## Durable-visual overview evidence

Re-checked programmatically: no capture in `.playwright-cli/` has an
overview proposal co-occurring with any durable/Visual-Re-entry-related
event. Consistent with V1: **VISUAL OVERVIEW VALUE REMAINS
EVIDENCE-INCOMPLETE.** No natural durable-visual-then-strong-completion case
was obtained, and none is assumed.

## Policy A — Current

Same 3 proposals as V1: 2 cancelled before rendered displacement (product,
page 1 and page 2), 1 completed (MLBB, page 2, end of capture). Reproduced
here via `scripts/overview-eligibility-v2-ab.mjs` against the unchanged
`lib/cameraReplay.ts` policy functions.

## Policy B — No Overview

`proposalKind === "overview"` is fully suppressed. 0 starts, 0 completions,
0 cancellations, 0 px movement attributable to overview in all three
sessions.

## Policy C — Strong Completion

Eligibility requires a real `type: "latency"` (session-stop) event logged
before the proposal's timestamp — no retrospective "nothing happens later in
the capture" shortcut was used, since that would be non-causal knowledge a
real-time policy could not have. Because that event is never emitted
anywhere in the current app, eligibility evaluates to `false` for all 3
overview proposals in the corpus. **Policy C therefore produces identical
counts to Policy B in every session available today** — not because the two
policies are conceptually the same, but because Policy C's one legal firing
condition is currently unobservable.

| POLICY | STARTS | COMPLETIONS | CANCELLATIONS | MOVEMENT (intended px) | REVERSALS | FIT FAILURES |
|---|---:|---:|---:|---:|---:|---:|
| A — Current | 3 | 1 | 2 | 2,049.8 | 0 rendered (1 corroborating prior case, not in this corpus) | 0 |
| B — No overview | 0 | 0 | 0 | 0 | 0 | 0 |
| C — Strong completion | 0 | 0 | 0 | 0 | 0 | 0 |

Total camera starts including non-overview proposals: A = 270, B = 267,
C = 267 (matches V1's counterfactual exactly; Page Arrival Coalescing's 8
retained pairs are identical across all three policies).

## Page-turn comparison

All 8 page turns in the corpus are `long-utterance` overflow turns (see
above), so none of them were preceded by a current-policy overview in the
first place — the 2 current overviews both occurred mid-page, not
immediately before a turn, and were invalidated by ordinary continuing
speech, not by a turn. Under Policy C, zero pre-turn overviews would be
suppressed in this corpus because zero existed to suppress; the "page turn
consumes completion" rule is validated by design, not by a case this corpus
contains. Page Arrival Coalescing, active page transition, and carried-live
targets are unchanged under all three policies (0 target/fit differences).

## Session-end comparison

Only one candidate exists: MLBB `p108` at t=115.987 s, page 2, the last
event in that capture. Its status is unresolved:

- Last camera position before overview: MLBB frozen camera at the time.
- Candidate overview target: `(-2515.50, 94.03, .8462)`, 736.1 px away,
  zoom −0.234.
- It exposes the full page-2 text union (6 samples) versus whatever was
  previously framed.
- Whether the current view was already sufficient is unknown — no earlier
  camera state in that window was compared for readability equivalence
  beyond what V1 already reported (7/5/6 text samples, 0 readability
  violations either way).
- Classification: **NEUTRAL/UNRESOLVED**, not beneficial or wasteful,
  because the capture ends immediately after and there is no logged
  session-stop event proving this really was the end of the session rather
  than the recording simply being cut.

## Overview geometric value

For the one completed case (MLBB `p108`): 736.1 px displacement, zoom change
−0.234 (zooms out), page-2 text union (6 samples) newly framed in full. This
is a real, non-trivial reframe — but "the geometry fits and reveals more of
the page" was already established in V1 and does not by itself prove reading
value, since the capture provides no post-completion dwell to observe
whether a viewer used the exposure.

## Stable reading opportunity

Not computable for Policy C: it produces zero completed overviews in this
corpus, so there is no eligible-overview stable-framing interval to measure.
For page completion, stable framing after a turn is already covered
identically by Page Arrival Coalescing V1 (unchanged, 8/8 retained pairs) —
Policy C does not alter it in any direction.

## False overview eligibility

Policy A: of 3 starts, 2 are false-eligible by the timer's own admission —
both were followed by ordinary continuing speech at +213 ms and +712 ms,
well inside the "still mid-beat" range V1 already established. Policy C:
0 starts, so 0 false-eligible and 0 true-eligible — its false-positive rate
is 0/0 (undefined, not "good"), because it never had the information it
needed to fire correctly either.

## Missed useful overview moments

The only candidate Policy C could plausibly have missed is MLBB `p108`,
which Policy A did render. Whether that was a genuinely useful moment is
itself unproven (see "Session-end comparison" above) — it cannot be counted
as a confirmed missed value case, only a candidate one.

## Page Arrival Coalescing integrity

Re-ran the deterministic suite unmodified: `12/12` checks pass
(`scripts/camera-replay-test.mjs`). All 8 page-arrival pairs remain
coalesced and identical in target, zoom, fit, and webcam result across
Policy A/B/C, since none of the three overview policies touches page-arrival
proposals.

## Recommended SINGLE production policy

**B. Remove generic overview completely.**

Not C/D, even though the audit's hypothesis was strong-completion
eligibility, because Policy C cannot currently fire at all: its one honest
eligibility signal (an explicit session-stop event) is declared in the type
system but never emitted anywhere in the app. Shipping "policy C" today
would in practice ship policy B with extra dead branches, since the
session-completion path is unreachable and page completion is defined to
never fire an overview. Policy A is measurably worse than doing nothing in
this corpus (2 wasteful starts/cancellations, 0 proven-useful completions,
1 corroborating harmful reversal from prior natural use) and Policy B causes
zero measured live-fit, page-fit, readability, or webcam regression. Wiring
an actual session-stop signal and re-testing Policy C/D is future work this
audit does not authorize or implement (Part E's corpus-collection need is
real but is a prerequisite for C/D, not a substitute for shipping B now).

## Explicit answers

1. **What deterministic strong-completion signals exist today?** Page
   completion (`type: "page"`, fully wired). Session completion has a real
   call site (`stop()` in `hooks/useDeepgram.ts`) but no event emission
   anywhere — not currently observable. Topic completion: none.
2. **Does page completion require a separate overview before turning?** No.
   By design the turn itself is the transition; Part 3's rule stands.
3. **How many page-turn overviews would be suppressed?** 0 in this corpus —
   none of the 3 current overviews occurred immediately before a turn.
4. **Is session-end overview useful?** Unproven. The one candidate (MLBB) is
   right-censored with no logged session-stop event to confirm it was a real
   end rather than a cut recording.
5. **How many strong-completion overview opportunities exist?** 0, because
   the only legal signal never fires in any available or loggable corpus.
6. **How many would actually require movement?** N/A — 0 eligible.
7. **Does Policy C create any live-fit failures?** No — 0/0, it removes
   proposals rather than adding any.
8. **Any page-fit failures?** No, 0 in all three policies.
9. **Any webcam failures?** No, 0 in all three policies.
10. **Does Policy C remove all known harmful/wasteful overview cases?** Yes
    — it removes both wasteful current-corpus cases and would have removed
    the corroborating harmful prior case too, since that case also had no
    session-stop event.
11. **Does it preserve any demonstrably useful overview?** No — the one
    overview it would also remove (MLBB) was never demonstrated useful, only
    plausible and right-censored.
12. **Does a natural durable-visual page benefit from overview?**
    Evidence-incomplete; no such natural case exists in any capture checked.
13. **Is deterministic topic completion currently possible?** No.
14. **Is strong-completion eligibility meaningfully better than simply
    removing overview?** Not measurably today — they produce identical
    outcomes in every available corpus because the strong-completion signal
    is unwired. It is a better-specified target for future instrumentation,
    not a currently-different policy.
15. **Which ONE production overview policy should ship?** B — remove
    generic overview completely.
