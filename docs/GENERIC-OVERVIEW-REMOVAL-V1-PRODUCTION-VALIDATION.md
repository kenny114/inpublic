# InPublic Generic Overview Removal V1 Production Validation

## Removed behavior

The single production call site that produced a generic full-page overview
is gone. In `components/Board.tsx`, the settled-line timer
(`liveCameraOverviewTimerRef`, still `LIVE_CAMERA_OVERVIEW_MS` = 1,800 ms)
used to end with:

```
if (pendingReframeRef.current) releasePendingReframeRef.current?.();
else framePage(true, "overview after live narration", null, null, true);
```

The `else framePage(...)` branch — the only call in the whole repository
that ever constructed the reason string `"overview after live narration"` —
is deleted. `settled live thought → 1.8s quiet → forced full-page overview`
can no longer happen. No replacement timer (2.5 s, 3 s, or otherwise) was
added; Part 2 required none and none exists.

## Preserved behavior

The timer itself, `liveCameraHoldRef`/`liveCameraHoldSetAtRef`/
`liveCameraHoldStartedAtRef`, `MAX_LIVE_CAMERA_HOLD_MS`, and
`pendingReframeRef`/`releasePendingReframeRef` are untouched. They do more
than gate the removed overview call: the hold suppresses *every* non-live
reframe while speech is live (`framePage`'s `holdIsStale`/`holdExceedsCeiling`
staleness escape hatch, lines ~1686–1705), and this timer is what normally
releases that hold. Removing the timer or the hold would have silently
broken every queued structural/diagram reframe, not just overview — Part 3
called this out explicitly, so only the trailing `else` branch was touched.
On firing, the timer still: clears the hold, flushes any queued Visual
Re-entry commit first (unchanged priority), and releases a pending
structural reframe if one is queued. It now does nothing at all if neither
is waiting, instead of falling back to a generic reveal.

`framePage`, `proposeCamera`, and the `"overview"` → `CameraProposalKind`
classification at `Board.tsx:1838-1839` are all untouched (Part 4): they
remain reachable by explicit navigation, structural framing, and other
product behavior, and by the frozen replay/historical-log tooling. The
`composition-test.mjs` case that feeds `reason: "overview after live
narration"` straight into `proposeCamera` still exercises that pure geometry
path directly and still passes — this is deliberately independent of
whether `Board.tsx` ever produces that reason again.

## Timer/callback cleanup

No orphaned refs, dead constants, or stale comments were left behind.
`LIVE_CAMERA_OVERVIEW_MS` remains genuinely used (the hold-staleness check at
`Board.tsx:1689` and the unrelated Visual Re-entry drain-retry timer at
`Board.tsx:5538`, which never called `framePage` and was not part of the
overview path — left unchanged per Part 15's "no unrelated refactoring").
The comment at the removed call site was rewritten to state what the timer
now does and why, rather than describing behavior that no longer exists.

## Visual Re-entry release integrity

`flushVisualReentryRef.current?.()` is still invoked first, unconditionally,
on every settle-timer fire, before the (now-shrunk) pending-reframe check.
A queued durable visual still commits — quietly if speech still owns
attention, revealed otherwise — exactly as before. Nothing about
`chooseVisualCommitMode`, `commitPreparedVisualReentry`, or the quiet/reveal
decision was touched. `scripts/visual-reentry-test.mjs`: 242 passed, 0
failed (unchanged from before this edit).

## Deterministic camera comparison

The removed call site was the only production path that could ever produce
a `proposalKind: "overview"` camera proposal. Every other `framePage` call
site, and all of `proposeCamera`/`lib/composition.ts`, is byte-for-byte
unchanged, so production camera decisions for every non-overview proposal
are provably identical before and after this change — this is not a
counterfactual, it follows directly from the diff. Production output is
therefore now exactly the "no overview" / Policy B oracle already validated
in `docs/OVERVIEW-ELIGIBILITY-V2-OFFLINE-AB.md`, re-stated per session:

| SESSION | OLD STARTS | NEW STARTS | OLD CANCELS | NEW CANCELS | OLD COMPLETIONS | NEW COMPLETIONS | NON-OVERVIEW TARGET DIFFERENCES | FIT FAILURES |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Product/explanation | 148 | 146 | 147 | 145 | 0 | 0 | 0 | 0 |
| Narrative | 75 | 75 | 29 | 29 | 46 | 46 | 0 | 0 |
| MLBB natural speech | 47 | 46 | 11 | 11 | 36 | 35 | 0 | 0 |
| **Total** | **270** | **267** | **187** | **185** | **82** | **81** | **0** | **0** |

Exactly the three known generic-overview proposals disappear (2 product
cancellations, 1 MLBB completion); every other start, cancellation,
completion, target, zoom, fit, and readability result is unchanged. This
matches Part 8's expected 270/267, 82/81, 187/185 exactly.

## Harmful reversal regression

The known harmful case (435.2 px overview pan → 65 ms dwell → 555.8 px
opposite live-follow, 179.5° reversal, 870.3 px excess path) required a
generic overview to fire and render before the reversal could happen. Since
`"overview after live narration"` can no longer be constructed anywhere in
the app, that overview leg is now structurally impossible, not just
unlikely — there is no code path left that can produce it. The subsequent
legitimate live-follow move (the one that used to snap back) is untouched
and still fires normally whenever live containment requires it; nothing
about `liveLineFitsViewport` or the live-follow call at `Board.tsx:2910`
changed.

## Page Arrival Coalescing integrity

Re-ran the deterministic suite unmodified: `12/12` checks pass
(`node --import ./scripts/ts-register.mjs scripts/camera-replay-test.mjs`).
Page Arrival Coalescing V1's code (`lib/pageArrivalCoalescing.ts`,
`lib/cameraReplay.ts`) was not touched by this change, and none of its
proposals are ever `proposalKind: "overview"`, so this result was expected
and is now confirmed. No pre-turn overview existed in any retained page-turn
case in the corpus to begin with (all 8 turns are `reason:
"long-utterance"` overflow splits — see `docs/OVERVIEW-ELIGIBILITY-V2-OFFLINE-AB.md`),
so this removal has no page-turn-timing effect to observe in this specific
corpus beyond making the "no pre-turn overview" rule permanent by
construction rather than by absence of a case.

## Visual Re-entry integrity

`scripts/visual-reentry-test.mjs`: 242/242 passed. No candidate evaluation,
grounding, ownership, rendering, or renderer-determinism check regressed.
Quiet-commit-while-speech-owns-attention behavior is bit-for-bit unchanged
(see "Visual Re-entry release integrity" above).

## Fresh natural browser validation

**Not performed in this pass.** Running a fresh natural session through the
real app (`DevReplayLab`/`?replay=1`) makes a real Deepgram WebSocket call
and incurs real provider usage/cost each time, so I did not start one
without checking first. The deterministic evidence above is exact (not
inferred) because the diff removes the only call site that could ever
produce an overview proposal and touches nothing else — but it does not
substitute for watching a live session. Say the word and I'll run one
(reusing an existing corpus recording) and report what actually rendered.

## Long-pause behavior

By construction: the timer still fires at 1,800 ms of live-write inactivity,
still clears the hold, still flushes Visual Re-entry, still releases a
pending structural reframe — and then does nothing else. A pause of any
length — 3 seconds, 30 seconds — cannot by itself move the camera anymore,
because the only code that used to do that on a bare timeout no longer
exists. This is a direct consequence of the diff, not something requiring a
timer-length-specific test.

## Performance

No new timer, poll, or synchronous work was added; a branch was removed.
`npx tsc --noEmit`: clean. No new long-task risk was introduced.

## Tests

Ran the full relevant deterministic suite after the change:

- `camera-replay-test.mjs`: 12/12 Page Arrival Coalescing checks passed.
- `visual-reentry-test.mjs`: 242/242 passed.
- `live-presentation-v2-test.mjs`: 48/48 passed.
- `composition-test.mjs`: 21/21 passed (including the pure-`proposeCamera`
  overview-geometry case, deliberately still exercised — see "Preserved
  behavior").
- `foundation-test.mjs`: 103/103 passed.
- `npx tsc --noEmit`: clean.

No new automated test was added. This codebase's regression coverage for
camera behavior is the deterministic proposal-replay suite against pure
`lib/` functions (`lib/composition.ts`, `lib/cameraReplay.ts`); the removed
code is a `setTimeout` callback embedded in the `Board.tsx` client component
with no existing harness for testing component-level timer/ref behavior in
isolation, and Part 15 rules out unrelated refactoring (extracting it into a
newly-testable pure function would be exactly that). Coverage for this
specific change is therefore: (a) exact diff-level proof that the removed
branch was the sole `"overview"` producer, (b) the full unchanged suite
passing clean, and (c) the deterministic replay comparison table above,
which is what the equivalent Page Arrival Coalescing V1 validation also
relied on rather than a component-level unit test.

## Explicit answers

1. **Is generic timer overview completely removed?** Yes — the sole call
   site that could produce `proposalKind: "overview"` in production is
   deleted.
2. **Can a settled thought plus 1.8 seconds of silence move the camera
   anymore?** No, unless a queued Visual Re-entry commit or pending
   structural reframe was already waiting — those are pre-existing
   legitimate events, not silence itself.
3. **Were exactly the expected overview starts removed?** Yes — 3 (2
   product, 1 MLBB), matching the offline audit exactly.
4. **Did any legitimate live camera movement disappear?** No —
   `liveLineFitsViewport`/live-follow code is untouched.
5. **Did any non-overview target change?** No, 0 differences, provable
   directly from the diff.
6. **Did Page Arrival Coalescing regress?** No, 12/12 still pass.
7. **Did Visual Re-entry regress?** No, 242/242 still pass.
8. **Did quiet visual commit behavior change?** No — the flush call and its
   priority over the (now-removed) overview fallback are unchanged.
9. **Did structural framing regress?** No — `pendingReframeRef` release is
   unchanged; `framePage`/`proposeCamera` are untouched.
10. **Can the known 65 ms overview reversal still occur through this
    path?** No — the overview leg that produced it can no longer be
    constructed anywhere in the app.
11. **What happens now if the speaker pauses for 3 seconds and resumes?**
    Nothing camera-specific happens at the pause; when speech resumes, the
    camera moves only if ordinary live containment (`liveLineFitsViewport`)
    decides the line is about to leave the viewport, same as any other live
    update.
12. **What happens when a session ends?** Nothing new. No final-page framing
    was added, and the unused `latency` event was not wired up (Part 12).
13. **Does fresh natural speech visibly feel calmer?** Not independently
    verified this pass — see "Fresh natural browser validation" above.
14. **Should generic overview remain removed?** Yes, per the offline audit's
    evidence: 0 proven-useful completions, 2 wasteful cancellations, 1
    corroborating harmful reversal, and 0 measured regression from removing
    it.
15. **What is now the highest-priority presentation problem?** None
    identified by this change. The next-highest item on record from the V1
    audit was the overview→reversal pattern itself, which this removal
    directly eliminates; no new problem was surfaced.
