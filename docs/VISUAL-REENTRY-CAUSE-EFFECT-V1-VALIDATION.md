# Visual Re-entry Cause/Effect V1 Validation Report

## Cause/effect schema

Added exactly one strict `cause_effect` branch: optional title, 2–4 non-empty nodes, 1–3 directed edges, per-edge evidence, and visual-level evidence. Edge indices must reference distinct nodes and the graph must be acyclic. Unknown fields—including coordinates, geometry, colors, and animation—fail parsing.

## Candidate detection

The local gate admits only explicit causal grammar. Supported deterministic cues are `cause`, `lead to`, `result in`, `create`, `produce`, `bring`, reversed `because`, unambiguous `due to`, and comma/semicolon consequence forms. The natural replay exposed and eliminated an over-broad `so` match: adjective intensifiers such as “so weak” are now rejected because consequence-form `so` requires an explicit clause boundary.

## Causal direction extraction

Active grammar maps subject to consequence. Reversed grammar maps the clause after `because` to the clause before it. Focused tests prove `LOWER PRICES → MORE PEOPLE TO SIGN UP`, `PRICES WERE LOWER → MORE PEOPLE SIGNED UP`, and `SERVER OVERLOAD → REQUEST FAILED`.

## Multi-thought causal evidence

Cause/effect alone uses a same-page window capped at 16 seconds, four thought fragments, and 720 characters. A one-edge assertion is held for a six-second collection delay, then flushed if standalone. A connected next thought completes one chain. The Deepgram capability replay combined two V2 thoughts into one source and one three-node/two-edge visual.

## Deterministic fast path

The capability chain used one deterministic fast path and zero model calls. Direct single-edge and same-thought chain tests also use the deterministic extractor.

## Haiku fallback

The narrow gate still admits explicit but harder syntax. A mocked integration test for “The reason people kept leaving was that the app took too long to respond” rejected the fast path, made exactly one fallback request, parsed a strict `cause_effect`, and passed causal grounding.

## Causal grounding

Every node must ground to source language. Every edge evidence string must itself parse as exactly one explicit directed causal clause, and its source/target must match the claimed edge direction. Any missing endpoint, invented intermediate, reversed edge, unsafe modality, or unsupported edge fails the whole visual. Focused tests reject `Marketing → Traffic → Signups` when only “Marketing causes signups” was spoken.

## Negation handling

Negation near a causal cue fails closed. Focused tests reject “Marketing did not cause the increase” and “Pricing isn't what caused churn.” The natural replay logged one negated-causality rejection and produced no causal candidate.

## Uncertainty handling

`maybe`, `might`, `could`, `may`, `possibly`, `perhaps`, `probably`, and `I think` reject the hard-arrow family. No modality is dropped or visually strengthened.

## Temporal-vs-causal tests

`after`, `before`, `then`, and ordinary chronology do not establish causality. “Revenue increased after we launched the campaign” and “We changed pricing, then signups improved” produce no causal visual. The capability fixture's website statement also produced no causal candidate.

## Correlation tests

Retention association, connection, correlation, co-occurrence, and simultaneous increases remain text-only. Focused tests cover each class.

## Renderer

The deterministic compact renderer uses unnumbered uppercase proposition boxes and warm, heavier connectors labelled `CAUSE`. Sequence remains numbered (`01`, `02`, …) with restrained blue process arrows. The model supplies no geometry. Identical inputs produce byte-identical causal geometry.

## Capability replay

The generated 27.185-second WAV transcribed the requested positive chain and negative restraint statement. Final corrected run: four settled thoughts; one cause evidence open/completion; one combined candidate; one deterministic fast path; one grounding pass; one render; one durable commit; zero causal fallback/model calls. The negative website statement produced no causal visual.

## Natural replay

The existing 87.96-second sample ran end to end after the final gate correction. It produced 10 settled thoughts, zero causal evidence windows, zero causal candidates, zero causal fast paths/fallbacks, and zero causal commits. One pre-existing approximate quantitative visual committed quietly. Transport had 13 ms p95 source-clock drift, zero rebases, and zero reconnects. Interim latency was 90/179 ms p50/p95; chunk-to-ink was 17/78 ms.

## Family ownership / non-regressions

Ownership order is conservative: a source with two literal anchors and change grammar remains quantitative; explicit process grammar remains sequence unless causal language owns it; explicit causal language owns `cause_effect`; flat-list rules remain unchanged. A source produces at most one visual. Protected Live Speech Presentation V2 tests, existing enumeration/quantitative/sequence checks, replay lifecycle checks, and TypeScript all pass.

## Model calls

Capability: 0. Natural: 0. Observed causal candidates were 100% deterministic (1/1). The fallback path is separately proven with one mocked request for hard causal syntax.

## Candidate→durable latency

Capability cause/effect: 1 ms candidate-to-durable-ready and 7,219 ms candidate-to-commit while safe placement waited behind continuing speech. Natural pre-existing quantitative result: 3 ms to durable and 5,025 ms to quiet commit.

## Commit behavior

The existing durable/quiet lifecycle is unchanged. The capability result was held once, then committed without a camera request. The natural quantitative result used the unchanged quiet-commit path. No cause-specific placement or camera rule was introduced.

## Camera/live-text integrity

Capability telemetry recorded no causal camera request and one suppression while attention remained with speech. Natural replay retained one ordinary page turn, zero reconnects/rebases, and no causal page-locality violation. The repository test command passes every suite through replay-lab; the final feature suite retains its unrelated pre-existing `directorV1 defaults off` failure.

1. **Did explicit causal speech render?** Yes—one combined three-node/two-edge capability visual rendered and committed.
2. **Was causal direction correct?** Yes.
3. **Can causal chains span multiple V2 thoughts?** Yes—two settled thoughts combined into one causal source.
4. **Did the explicit chain require Haiku?** No; it used zero model calls.
5. **Did any unstated intermediate node appear?** No.
6. **Did temporal language produce a false causal visual?** No.
7. **Did correlation produce a false causal visual?** No.
8. **Did uncertainty become visually stronger than spoken?** No.
9. **Did negated causality render incorrectly?** No.
10. **Did sequence/enumeration/quantitative regress?** No.
11. **What percentage of causal candidates were deterministic?** 100% (1 of 1 observed browser candidates).
12. **What is the next most valuable missing expressive family?** Comparison/contrast: it adds explicit side-by-side explanatory structure without implying causality. It was not implemented.
