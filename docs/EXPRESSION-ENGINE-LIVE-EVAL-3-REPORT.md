# Live evaluation #3 — locating the divergence

**Evidence**: still the session-log export, not `inpublic.captureDownload()`
— stated once, plainly, and then set aside, because this session's data
turned out to be unusually diagnostic anyway. The file covers the *same*
browser tab/session as eval #2 (`sessionId cc2fba07`, same `startedAt`),
left open across a **~40-minute idle gap**, after which the speaker narrated
a children's story — a completely fresh topic, structurally nothing like
the earlier "my journey building InPublic" talk — for about 5 continuous
minutes (41:04 to 46:09). That gap turned out to be the single most useful
thing about this capture: it's a natural, extreme version of exactly the
"closed topic" scenario the brief asked about, and the result is close to
unambiguous. Screen recording provided, not reviewed frame-by-frame; available
if a specific timestamp needs visual confirmation.

**What deep capture would still add**: everything below is read from the
session log's transcript/plan-reason/patch/page-turn instrumentation, not
from raw `WorldState`/`ExpressionIntent` objects. In particular, `intent`
here is only the classifier's *output label*, not its `reason`/`strength`/
evidence trail — that gap matters for one specific claim below and is
flagged there.

## The reproduction: a 40-minute-old topic, still on stage

At 41:17 — the very first plan update of the brand-new story — the reason
string reads `relationship: 8 entities, 2 relations; attached trying`.
**`trying`** is an entity from the *previous* segment, last touched at
**1:22 into a session that is now 41 minutes in.** It appears by name in
plan reasons three separate times in the story segment. It is not alone:
across the whole 5-minute story, the objects repositioned most often in
`RENDERED` patches are **`water`(15), `Sacrifice`(13), `Waking up`(13),
`This thing`(12), `Canvas`(12), `Making money`(12), `help`(11), `computer
lessons`(11), `building`(11), `Stopping`(10)** — eight of these ten are
verbatim entities from the *first* segment (Sacrifice, This thing, Canvas,
Making money, help, computer lessons, building, Stopping have nothing to do
with a forest, a pond, or a frog) and were still being moved, ten-plus
times each, throughout a story about neither InPublic nor sacrifice nor
canvases.

## Question 4: is planner capacity "stale persistent slots + one rotating slot"?

Yes, confirmed with numbers, not impression. Across the 44 page-turns in the
story segment:

| Metric | Value |
|---|---|
| Page occupancy | **10 or 11 on all 44 turns** — never once lower. The canvas is permanently at capacity. |
| Mean new visible entities per turn | 2.25 (mode 1) |
| Turns citing `trying` by name in the plan reason | 3, spanning 41:17-41:52 |
| Preservation < 0.05 | 29 / 45 updates (64%) |
| Preservation = 0 exactly | 14 / 45 updates (31%) |

The steady state for most of the segment is: ~9-10 of the ~10-11 occupied
slots are a *rotating pool* of aged entities from the first segment (they
disappear and reappear across turns — Sacrifice, Making money, and Testing
each get removed and later re-added multiple times, competing with each
other, not with the story), while genuinely new story content (grass,
blackberry bush, the pond, dogs, an owl, a frog) gets **one** slot that
turns over almost every turn. This is exactly the shape the brief
hypothesized, now measured.

## Question 2: why do stale entities survive a genuinely closed topic?

The mechanism this session points to is turn-count vs. wall-clock time.
Every visibility/persistence window in `lib/expression/planner/visibility.ts`
(`CURRENT_WINDOW = 8`, `PERSIST_WINDOW = 36`) is measured in **segment
sequence number**, not elapsed real time. Forty real minutes passed with
the tab idle, but if only a handful of settled thoughts were ingested in
that gap (none, per the transcript — the next segment after the first one
ends is the story's opening line), the world's internal `seq` counter
barely advanced at all. From the engine's own clock, `trying` (last touched
at session-relative turn ~30-something) is still well inside a 36-turn
window of the story's opening turns. **The topic was closed by any human
definition — 40 minutes and a complete subject change — but not by the
engine's, because its only notion of "how long ago" is turns elapsed, and
almost none had.** This is a strong, mechanically-grounded hypothesis, not
a guess: it's the direct, predictable consequence of a documented constant
or file behavior, and it would reproduce in a screen-off / rejoin flow, a
long pause for a phone call, or anything else that stalls speech without
resetting the session.

## Question 3: why does `express_uncertainty` persist across unrelated turns?

Also now bigger than "unrelated turns" — it's unrelated turns *across a
40-minute gap and a full topic replacement*. Of the 45 plan updates in the
story segment, **36 are `express_uncertainty` and 9 are `show_spatial`** —
notably, the classifier is *not* frozen: it correctly breaks out to
`show_spatial` nine separate times, always on sentences with strong,
unambiguous spatial language ("right in the middle of the pond," "even his
tiny little tail was sticky," "it will increase... like a balloon"). That
argues against "stuck/broken" and for something more specific: **weak or
disfluent evidence falls back to `express_uncertainty`, and this transcript
is heavily disfluent** (fragments, false starts, run-on clauses — "Was it
that they came?", "In the back came, still I was sick. But my skin, my
skin, my skin, skin..."). A fallback intent for weak evidence is a
reasonable design; the problem is what it does next: `express_uncertainty`
maps to exactly one grammar, `relationship`, which selects entities by
world importance — and because importance changes slowly, `relationship`
keeps re-selecting nearly the same entities every time it's chosen,
producing the identical `"relationship: 8 entities, N relations; attached
X"` reason turn after turn regardless of what the sentence actually said.
**I can't confirm from this data alone whether the fallback itself is
mis-triggering or is a legitimate response to genuinely weak per-utterance
evidence each time** — that needs `trace.intent.reason`/`.strength`, which
only the deep capture carries. What's confirmed is the *consequence*: once
that fallback fires, the resulting picture stops tracking the sentence.

## Question 1: do new concepts exist correctly in WorldState when they fail to render?

Mostly yes, with one clear exception worth flagging on its own. New story
content **does** reach the canvas at least once when introduced — grass,
the blackberry bush, the pond, dogs, an owl, a frog, a branch, an owl, and
several others all appear as `ADD` at some point. WorldState creation and
initial placement are not the layer that's failing. The exception: **the
story's protagonist, "Tilly," is a named character mentioned repeatedly by
name from 42:14 onward** ("Tilly was not a baby... Tilly had one unusual
habit... Tilly smiled...") **and never once appears as a persistent named
entity.** Only a generic, unnamed "frog" (`object_glyph`, not even
`figure`) appears once at 45:55 and is removed two turns later. Every other
reference to Tilly resolves to nothing durable. Per instruction, logging
this as a secondary issue alongside the earlier "My name is Kenny Farmer"
miss — both are the same shape: a clear, repeated, named self-identification
that extraction/coreference doesn't carry forward as one persistent entity.

## Question 5: where does the failure originate?

Ordering the pipeline — input → meaning → world → **intent** → plan →
scene → render — and matching each layer against what this session shows:

- **WorldState**: not the origin. New entities are created correctly (Q1).
- **Intent classification**: this is the layer where the expected diverges
  from the actual, and it is the *first* one in pipeline order where that's
  true. A brand-new topic, spoken continuously for five minutes, is
  classified as `express_uncertainty`/`relationship` 80% of the time,
  indistinguishable in its own reason string from a 40-minutes-earlier,
  entirely different conversation. Once that classification is made,
  everything downstream — `relationship`'s importance-ranked entity
  selection, the recycled `attached X` text, the one-slot-rotates pattern —
  is a plausible, deterministic *consequence*, not an independent failure.
  A grammar built for "narrate a sequence of events" was never selected for
  five minutes of a speaker narrating a sequence of events.
- **Visibility/persistence**: a second, independent contributor, not
  downstream of intent — the turn-based aging window (Q2) is why stale
  entities are even *available* for `relationship` to keep re-selecting. If
  visibility had already aged `trying`/`Sacrifice`/`Canvas`/etc. out by the
  time the story started, the intent misclassification would have had a
  much smaller pool to draw from and might not have looked this bad, even
  uncorrected.
- **Planner selection (`attachRelatedEntities`) and scene composition**:
  behaving consistently with what they're handed. Given `express_uncertainty`
  → `relationship` and a visibility snapshot still crowded with old
  "important" entities, picking the same top-N-by-importance set every
  round is the designed behavior, not a bug in the planner itself.

**First-layer answer**: intent classification, with visibility/persistence
windowing as a compounding, independently-real second cause (not a
downstream symptom of the first) — both upstream of planner selection and
scene composition, which appear to be executing correctly given bad inputs
from either.

## What deep capture would resolve that this session can't

Whether the `express_uncertainty` fallback is a genuine per-utterance
low-confidence read each time, or something stickier (e.g. carrying forward
a previous round's classification when new evidence is weak) needs
`trace.intent.reason` and `.strength` per turn — the session log only has
the output label. That's the one place this report's answer to Q3/Q5 is a
strong, well-evidenced hypothesis rather than a confirmed mechanism.

## No fixes attempted

Per instruction — salience, visibility, intent classification, composition,
and scene budget are all untouched this pass. This report is measurement
only.
