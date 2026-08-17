# Visual Re-entry Sequence V2 Validation Report

## Sequence schema

Added one strict `sequence` branch with an optional title, 2–5 non-empty steps, and one or more evidence phrases. The discriminated schema rejects unknown fields, including coordinates, layout, arrows, and animation instructions. Enumeration and quantitative-change schemas remain intact.

## Candidate detection

The local gate admits explicit order markers (`first/then/finally`, numbered steps) and conservatively framed processes with process transitions. It rejects ordinary narrative, unsupported causal language, and declared processes longer than five steps before any model call. Family ownership is deterministic and mutually exclusive: grounded quantitative change has first priority, explicit ordered process has second priority, and flat enumeration has third priority.

## Evidence-window behavior

Enumeration and quantity retain the existing 12-second, two-thought, 600-character window. Sequence alone receives a bounded same-page window of at most 20 seconds, five thought fragments, and 900 characters. An opener is held, a continuation extends it without rendering, and a completion marker emits one combined source thought. Unrelated speech, expiry, overflow, or a page turn closes the window and fails closed.

## Deterministic fast path

Clear ordered speech is parsed locally into 2–5 literal or conservatively normalized steps. The parser rejects uncertain modality and never truncates an oversized process. Family-owned extraction prevents a source from producing both a sequence and another visual family.

## Haiku fallback

Haiku remains available only after the candidate gate accepts a real but structurally ambiguous process and the deterministic extractor declines it. A deterministic test of “The way I usually do it…” made exactly one mocked fallback request, returned a sequence, and passed grounding. Clear first/then/finally speech made no request.

## Grounding

All evidence phrases must match the source. Every sequence step must match meaningful contiguous source language, and step matches must occur in increasing source order. Tests reject an invented middle step and reordered steps. Missing, unsupported, or ungrounded content returns no visual.

## Renderer

The renderer owns all geometry and produces one stable compact vertical treatment: numbered labels (`01`–`05`), step text, and arrows between adjacent steps. The model and extractor cannot specify coordinates. Measurement and byte-for-byte deterministic geometry tests pass.

## Single-thought process test

“First we collect the data, then we clean it, then we train the model” produced one sequence candidate, three grounded steps (`Collect the data`, `Clean it`, `Train the model`), one deterministic render, and zero Haiku calls.

## Multi-thought process test

The three separate settled thoughts “First…”, “Then…”, and “Finally…” produced `sequenceEvidenceOpened = 1`, `sequenceEvidenceExtended = 1`, and `sequenceEvidenceCompleted = 1`, followed by exactly one combined candidate and one visual—not three visuals.

## Enumeration non-regression

“There are three things we need to improve: speed, accuracy and presentation” resolves to enumeration, not sequence. Existing enumeration extraction, grounding, and rendering tests remain green.

## Quantitative non-regression

“We had 10 users last week and 20 this week” resolves to `quantitative_change`, not sequence. The natural replay also produced one existing approximate quantitative visual while producing zero sequence candidates.

## Causal false-positive test

“Marketing creates traffic, which creates signups” and “Low prices lead to more users” produce no sequence candidate. Chronological narration without explicit instructional/process semantics also remains text-only.

## Natural benchmark

The existing 87.96-second WhatsApp sample produced 10 settled thoughts, zero sequence evidence events, zero sequence candidates, zero sequence fast paths/fallbacks, and zero sequence commits. It retained one existing quantitative candidate/commit. Transport completed all 1,100 sends with 12 ms p95 source-clock error, 58 ms maximum error, zero rebases, and zero reconnects. Interim latency was 67 ms p50 / 225 ms p95. One normal page turn occurred, with no active sequence evidence to invalidate.

## Capability benchmark

The 18.035-second deterministic fixture used ordinary speech pacing and continued speaking after the third step. Deepgram produced four settled thoughts and the exact requested process wording. Telemetry recorded one opened, one extended, and one completed sequence evidence event; one sequence candidate; one deterministic fast path; one grounding pass; one durable result; and one committed sequence. The rendered three-step result is captured in `artifacts/visual-reentry-sequence-v2/sequence-capability.png`.

## Model calls

Capability replay: 0 calls from 1 sequence candidate; one call avoided by the fast path and three avoided by the candidate gate. Natural replay: 0 calls; nine avoided by the candidate gate and one by the pre-existing quantitative fast path. Across observed sequence candidates, 100% (1/1) were deterministic. The ambiguous-process unit test confirms the fallback can still make exactly one call when needed.

## Candidate→durable latency

The capability sequence reached durable-ready 2 ms after candidate completion. Its safe commit occurred 1,805 ms after candidate completion. The natural benchmark's existing quantitative result reached durable-ready in 1 ms and quiet-committed in 5,031 ms.

## Quiet commit behavior

No sequence-specific lifecycle or timing rule was introduced. In the capability replay, the ready sequence was held once while speech/camera ownership made ordinary reveal unsafe, then committed after the 18.035-second audio ended; it did not claim a quiet commit or move the camera during speech. The natural replay independently exercised the unchanged quiet path once: its older quantitative result committed with camera suppression while newer speech owned attention.

## Camera/live-text integrity

The capability sequence did not modify or overlap the continuing live sentence. Its camera request occurred only during the later ordinary safe reveal. The natural quiet commit suppressed its camera request. There were no anchor resets, reconnects, rebases, or sequence page-locality violations. TypeScript and the 123 Visual Re-entry checks pass; replay-lab deterministic checks pass. The repository-wide test command reaches the final feature suite and has one unrelated existing failure, `directorV1 defaults off`; all earlier suites, including protected Live Presentation V2, pass.

1. **Can sequence span multiple V2 settled thoughts?** Yes—three settled process thoughts combined into one sequence candidate.
2. **Did the explicit 3-step process render?** Yes—one compact three-step visual rendered and committed.
3. **Did it require Haiku?** No. The capability used the deterministic fast path with zero Haiku calls.
4. **Did any step appear that the speaker never said?** No. All three steps grounded to source phrases; invented-step tests fail closed.
5. **Did an enumeration get incorrectly rendered as a sequence?** No.
6. **Did causal language get incorrectly rendered as sequence?** No.
7. **Did quantitative change regress?** No. Quantitative ownership and rendering remained intact in deterministic tests and the natural replay.
8. **Did sequence interfere with active speech?** No. The durable sequence waited and committed after active speech ended.
9. **What percentage of sequence candidates were deterministic?** 100% in browser replay (1 of 1); ambiguous candidates retain the grounded Haiku fallback.
10. **What is the next most valuable missing visual family after sequence?** Cause/effect, because it would add directional explanatory value to supported causal statements. It was not implemented in this task.
