# Live evaluation #1 — unscripted speech through the real UI

**Evidence**: two independent takes, `/try?v2=1&xe=1`, real mic + Deepgram +
Excalidraw, transcript overlay off (default). Session A: 108s, "my journey
building InPublic." Session B: 194s, a new-phone story that pivots into
"please InPublic, make money." Combined ~5 minutes, not the intended 15 —
these read as warm-up takes.

**Evidence caveat, stated plainly**: both files are the session-log export
(top-bar "Download Log" — `lib/sessionLog.ts`), not the deep capture this
pass built (`inpublic.captureDownload()` — `lib/expression/capture.ts`). The
log has transcript text, expression-plan `reason`/`interpretation` strings,
patch summaries (ADD/MOVE/UPDATE/REROUTE/REMOVE), page turns, and camera
decisions, all timestamped — enough to assess composition/camera/layout
directly and to *observe the symptoms* of extraction/salience/target-
resolution problems. It does not have world snapshots, visibility tiers, or
resolution internals, so anywhere I could not confirm root cause from this
data alone, I've said so rather than guessed.

No fixes were attempted. This is the record.

## Findings, timestamped and classified

| # | Time | Category | What happened |
|---|---|---|---|
| 1 | A 0:55–1:04 | **composition** | Three consecutive turns fail with `grammar cause_effect produced an invalid plan: String must contain at most 200 character(s)`, preservation drops to 0, `missing_entity`. Root cause visible directly in the reason text: the plan's `reason` string (`"{grammar reason}; attached {list}"`, `lib/expression/planner/plan.ts`) grows past `ExpressionPlanSchema`'s 200-char cap as the attached-entity list lengthens, so the whole plan fails Zod validation and the pipeline falls back to an empty/broken scene — for ~9 seconds, mid-thought, while the speaker is explaining what InPublic actually is. **High confidence** — the error string names the exact schema constraint. |
| 2 | B 1:39–1:51 | **salience** (with a **camera** symptom) | Preservation frozen at exactly 0.229 across 3 consecutive expression updates while new speech keeps arriving ("screen issues", "can't play anything", "foreign experience"). Two of those turns render an *empty* patch (`EXPR RENDERED:` with nothing after) while the page still turns (`reason: long-utterance`) — camera moves, canvas doesn't change. This is the clearest instance of "visual changes that feel distracting rather than stable": movement with no content behind it. **Medium confidence** on cause (looks like the same entities keep re-attaching without new ones landing) — can't confirm from this log alone why extraction/attachment stalled. |
| 3 | B 2:09→3:13 | **salience** | The topic cleanly pivots at 2:09 ("Since I started building InPublic, it's phenomenal") from the phone story to InPublic/dreams/goals/plea. The phone-story objects (New phone, Phone experience, return the phone, three phone text labels) are never cleared — they persist as MOVE-only background clutter for the entire final minute of a now-unrelated, emotionally central closing monologue. **High confidence** from the patch log directly (`MOVE New phone` / `MOVE the phone began shutting off...` recurring at 2:13, 2:20, 2:30, 2:34, 2:46, 3:01 — six turns after the topic left phones behind). |
| 4 | B 2:46, 3:07, 3:13 | **composition** | Preservation collapses to 0 with `missing_entity` three times, each exactly when the speaker states the point of the talk ("I have dreams... goals... ambitions", "please bear fruit and make money"). Plausibly caused by #3: stale phone-story leftovers crowding the region budget so the new topic's own subject entity can't be placed. **Medium confidence** — the timing correlation with #3 is strong but I can't see the region-budget arithmetic in this log to confirm it's literally budget exhaustion rather than something else in scene composition. |
| 5 | A 1:13–2:20 | **salience** | Declining preservation (0.802 → 0.617 → 0.418 → 0.387 → 0.396 → 0.365) driven by repeated `clutter` problems: stale entities (self-expression, visualization, entertaining-people, learning-to-visualize-speech) keep getting re-attached to scenes about "the tool" / "clarity" / "the purpose" that aren't really about them. At 1:25, "Let's go back to the other thing" — a genuine natural callback — is followed by a scene about "tool" that doesn't obviously resolve to anything specific. **Low-medium confidence** on the callback specifically (could be a correct resolution to something not visible as such in this log; flagging as a candidate target-resolution miss, not a confirmed one). |
| 6 | Both, throughout | **layout / camera** (dominant, see below) | Page turns roughly every 8–10 seconds in both takes — 11 in session A's 108s, 24 in session B's 194s — most triggered by `overflow`, several by `long-utterance` with empty renders (see #2). The canvas is almost never still long enough to read. |
| 7 | B 0:17 | **product-interaction** (minor) | First ~20s of speech ("I just wanna talk about my experience recently") produces no drawable content (`no grammar could express this world`). Reasonable given the sentence has no concrete structure yet — noted for completeness, not treated as a failure. |
| 8 | A 0:06, 0:53; B 2:35, 2:51, 2:58, 3:02 | **extraction — working correctly** | "in public" → "InPublic" fires correctly 6 times total across both takes (`canvas-term` correction). Listed because it's a real recurring case, not because it failed. |
| 9 | B 0:34–1:01 | **composition/lifecycle — working correctly** | The phone causal spine (issue-discovery → automatic-shutoff → batch-program) builds and stays coherent for ~30s, and the reversal at 0:48–1:01 ("decided to not go back") is picked up as a new `decision-not-to-return` node connected to `interaction-with-phone-return`, with the earlier issue-discovery detail correctly removed. This is the one clean example of corrections visibly altering prior understanding (evaluation question #2) in this data. |

## Against the six questions

1. **Does the canvas follow the speaker's current thought?** Partially. Clear early in each take (the InPublic-origin causal chain in A, the phone story in B), degrades as topics get more abstract or as old context accumulates (findings #2, #5).
2. **Do corrections visibly alter previous understanding?** Yes, at least once, cleanly (#9). No second clear example in this data to generalize from.
3. **Do natural callbacks correctly manipulate existing concepts?** Unclear. One candidate ("the other thing," #5) doesn't show clean resolution, but the shallow log can't confirm whether that's a target-resolution miss or something else.
4. **Do important concepts stay visible appropriately?** No — the dominant counter-example is the inverse problem: *unimportant, resolved* concepts (the closed-out phone story) stay visible well past their relevance (#3), and that appears to actively crowd out the new topic's own subject (#4).
5. **Do visual changes feel stable rather than distracting?** No. Page-turn churn (#6) is the single most consistent, both-takes, whole-session behavior, and it includes turns where the page moves with nothing new to show (#2).
6. **Can the canvas communicate the conversation without reading the transcript?** Not reliably, in this data — three separate multi-turn stretches (the 200-char bug, the frozen/empty-render stretch, the two `missing_entity` collapses at the emotional close of session B) would show a viewer either a broken/empty frame or a page flip with no new content, at exactly the moments that mattered most.

## Dominant experiential failure category

**Layout/composition instability, specifically page-turn churn** (#6), with **salience** (stale concepts not clearing, #3/#5) as the closely-linked second driver — and in session B, salience appears to be the direct cause of a composition failure (#4) at the narrative climax. The single concrete, high-confidence bug in this data is the 200-character `reason`-string schema violation (#1), which is a composition-layer defect with a clear, reproducible signature.

## What this run doesn't tell us

Five minutes across two disjoint short takes is not the 15-minute continuous
unscripted session the brief asked for, and the shallow log means several
findings above are symptom-level rather than root-cause-confirmed. A real
15-minute run captured with `inpublic.captureDownload()` (the deep capture
built this pass) would let the same six questions be answered against actual
world/plan/visibility state rather than inferred from patch summaries.
