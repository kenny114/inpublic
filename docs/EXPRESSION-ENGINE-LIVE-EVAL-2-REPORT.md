# Live evaluation #2 — after the two fixes

**Evidence**: one session, `/try?v2=1&xe=1&capture=1`, real mic + Deepgram +
Excalidraw, captions off. 3:45 continuous, not the intended 15 minutes — this
reads as a working dry-run rather than the full session, and the source
speech is unusually disfluent/rambling by the speaker's own admission
("I don't know what I'm gonna do", trailing/incomplete clauses throughout).
That's noted because it stresses the system harder than typical speech would
— but the structural failure below is an engine behavior, not a content
problem, and would surface on cleaner speech too, just less severely.

**Evidence caveat, stated once more plainly**: this is again the session-log
export (top-bar "Download Log"), not the deep capture
(`inpublic.captureDownload()`) the brief specifically asked for this round.
It is considerably richer than eval #1's logs, though — it now carries the
full page-turn instrumentation built after eval #1, which gets close to
answering the brief's "correlate with WorldState → visibility → plan →
scene → render" ask even without raw world/visibility snapshots. Screen
recording was also provided; not reviewed frame-by-frame here, available if
specific timestamps need visual confirmation. Where a finding needs the
missing WorldState/visibility layer to fully confirm, that's said outright.

## The two fixes, checked against real data

- **Fix 1 (reason-string validation)**: zero `planValidationFailed` across
  all 33 instrumented page-turns and all 36 plan updates. No recurrence of
  the eval #1 bug.
- **Fix 2 (empty-patch page turns)**: zero empty `RENDERED` entries this
  session (0 of 34), and every one of the 33 page-turns carries a non-empty
  `scenePlanDiff` and `renderOperationCount` ≥ 2. The specific symptom from
  eval #1 — a page turning with nothing behind it — did not recur.

Both fixes hold. Page-turn *frequency* itself is still high (33 turns in
3:45 ≈ one every 6.5s, min 2.6s) — expected and correct: the fix targeted
*spurious* turns, not overall pacing, which is governed by how much content
each utterance adds relative to the fixed page/region size.

## New finding: a sustained composition collapse, and its evidenced cause

**The dominant experiential failure in this session is different from eval
#1's**, and it's a big one: **14 of the last 36 plan updates (39%) — every
single update from 2:28 to the end of the recording at 3:45, a full 77
seconds — score `preservation: 0` with `missing_entity`.** This is not a
brief dip; it is the entire back third of the session.

The instrumented `scenePlanDiff` for these turns shows exactly why. From
**1:22 onward** (more than half the session), every plan update is
`intent: express_uncertainty, grammar: relationship`, and every single one's
reason string reads `relationship: 8 entities, N relations; attached
trying` — the SAME anaphoric entity ("trying," from an early "I'm really
trying to...") anchored into literally every remaining scene for the rest
of the recording, regardless of what the speaker actually said next. 25 of
the last 25 consecutive updates carry this identical intent.

Layered under that: from roughly **0:23 onward**, a specific cluster of six
entities — *Video*, *Trying to fix it in public*, *first meeting*,
*Stopping*, *This thing*, *Trying* — appears in the `MOVE` list of nearly
every subsequent `RENDERED` patch, all the way to 3:45. They are never
`REMOVE`d. From **2:35 onward** the pattern becomes stark and mechanical:
each new thought the speaker expresses (sacrifice → patience → things
still to do → making money → working towards a goal → wasting credit →
testing → going through → "a life that God will be placed out" → "life
with God's purpose" — nine genuinely distinct ideas over a minute) gets
exactly **one** new node added, and the **immediately previous** one
removed, one-in-one-out, while that same six-entity stale backdrop sits
untouched underneath. Nothing the speaker says in this final minute ever
accumulates into a picture; each idea is shown alone for a few seconds and
then erased to make room for the next, while three-minute-old content never
yields its space.

This is exactly the mechanism the brief asked to instrument-not-fix: stale
entities surviving well past their relevance, this time pinned down to a
specific named cluster and a specific moment (0:23 / 1:22) rather than a
general impression. The `missing_entity`/`preservation: 0` collapse for the
whole back half is very plausibly this cluster crowding the region budget so
the round's real subject can't be placed — the same causal shape as eval
#1's finding #4, now with the actual entities named and the actual turn count
(14 consecutive, not a handful).

**What's still missing to fully confirm root cause**: whether this is
purely a *region-budget* crowding effect (the six stale entities occupying
6 of ~8-11 slots) or whether the *intent classifier* locking onto
`express_uncertainty` for 25 straight turns is also independently
contributing (a plan built around "relationship, 8 entities" every time,
regardless of topic, would tend to keep re-selecting the same anchor
entities almost by construction). Both are visible in this log; telling them
apart cleanly needs the WorldState/visibility snapshots deep capture would
carry — this is the one place in this report where that gap is a real
limitation, not just a formality.

## Extraction

One clean, concrete miss: at 3:31 the speaker states "My name is Kenny
Farmer" — a direct, unambiguous factual assertion — and no new entity
appears in the following `RENDERED` patch at all (only "going through" is
added, matching the ongoing one-in-one-out pattern, with no trace of the
name). Whether this was dropped at extraction or simply lost to the same
crowding as everything else in this stretch isn't distinguishable from this
log alone.

## Against the six questions

1. **Canvas follows current thought?** Yes for the first ~80 seconds
   (guys → video → today → trying to fix it → vision → first meeting →
   visual expression tracks the speaker reasonably). No for the back two-
   thirds — see above.
2. **Corrections visibly alter understanding?** One correction fired
   ("in public" → "InPublic"), correctly, same mechanism as eval #1. No
   negative example this session.
3. **Natural callbacks manipulate existing concepts correctly?** No clear
   callback attempt in this transcript to evaluate.
4. **Important concepts remain visible appropriately?** No — same inverted
   failure as eval #1, now precisely evidenced: a six-entity cluster from
   the first 25 seconds of a 3:45 session occupies canvas space for the
   entire remaining 3:20, while a minute of the speaker's actual closing
   content is shown one idea at a time and erased.
5. **Visual changes feel stable rather than distracting?** Better than eval
   #1 on the specific "empty movement" symptom (fixed, confirmed by data),
   but the underlying cadence (a turn roughly every 6-7 seconds, every
   single one repositioning the same 6-9 background objects) would still
   read as constant motion to a viewer.
6. **Canvas communicates the conversation without the transcript?** For the
   first 80 seconds, plausibly yes. For the closing minute — arguably the
   part of a talk most likely to matter to a viewer — no: a sequence of
   single, disconnected, quickly-erased nodes over an unchanging and
   increasingly irrelevant backdrop would not tell you what the speaker
   actually said.

## Dominant experiential failure category

**Composition** — specifically, a sustained `missing_entity`/zero-
preservation collapse covering the entire back third of the session — with
**salience** (the un-clearing six-entity backdrop cluster, now named and
timestamped) as the evidenced proximate cause, and the intent classifier's
25-turn lock onto `express_uncertainty` as a plausible contributing factor
not yet isolated. This is a different failure from eval #1's dominant one
(page-turn churn, now fixed) — the fixes worked, and evaluation surfaced the
next layer down, exactly as intended.

## What would close the gap for next time

A deep capture (`inpublic.captureDownload()`) of a real, full-length session
would let the crowding-vs-intent-lock question above be answered directly
from `WorldState`/`visibility` snapshots rather than inferred from patch
text — and would be the natural next step before touching salience
behavior, per the standing instruction to defer that fix until it's proven
where the stale entities survive. This session gets close; it isn't that
capture.
