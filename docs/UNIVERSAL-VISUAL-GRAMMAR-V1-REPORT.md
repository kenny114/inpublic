# InPublic Universal Visual Grammar — Safe Shadow Experiment V1

Date: 2026-08-17  
Mode: offline shadow analysis only  
Production behavior: unchanged

## Executive conclusion

The evidence supports a **hybrid visual architecture**: one small universal
meaning graph, followed by specialized visual grammars and renderers.

A single universal schema is useful for preserving what speech says about
entities, relations, actions, quantities, order, certainty, and time. A single
universal renderer is not. Causal chains, quantitative changes, literal object
scenes, comparisons, spatial layouts, and mathematical derivations have
different truth conditions and different failure modes. Forcing them through
one canvas grammar would either flatten everything into labeled boxes or make
grounding too permissive.

The bounded shadow run processed 40 settled thoughts from eight prerecorded
recordings. The current deterministic Visual Re-entry lane produced four
visuals (10.0%). The experimental graph/grammar marked 12 thoughts as
visualization-eligible (30.0%). Eight thoughts that the current lane did not
render were newly eligible (20.0% of all thoughts): six were current
`text_only` results and two were pending evidence. This is a **threefold
coverage signal**, not a production-quality claim. The pilot is a transparent
rule-based analyzer, has no human-labeled truth set, and exposed important
precision and corpus-coverage limits.

The main positive finding is not merely “more visuals.” It is that one typed
contract can express both already-proven Visual Re-entry families and several
currently text-only meanings without granting free-form canvas mutation. The
main negative finding is equally important: graph extraction, cross-thought
reference, and specialized rendering must remain separate stages.

No production file, prompt, model, flag, renderer, transcript path, thought
boundary, camera policy, pagination behavior, or Story behavior was changed.
No Level 4 mutation was implemented. No model or provider was called.

## Experiment artifacts and reproducibility

The experiment is isolated at
`experiments/universal-visual-grammar-v1/`. Its main artifacts are:

- `schema.ts`: the actual Universal Meaning Graph and visual-plan contract;
- `analyze.ts`: a deterministic, source-grounded pilot parser and planner;
- `corpus.ts`: the selected recording manifest and transcript provenance;
- `run.mjs`: corpus inventory, thought reconstruction, baseline pass,
  experimental pass, metrics, examples, and error queues;
- `test.mjs`: focused graph/grammar and result-integrity checks;
- `results/shadow-results.json`: full machine-readable inventory, all 40
  thought results, 21 paired examples, metrics, and error analysis.

The runner imports the current thought boundary and Visual Re-entry helpers to
produce a read-only baseline. Production imports nothing from the experiment.
Model fallbacks are labeled `model_fallback_unexecuted`; there were none in
this corpus. The runner performs no canvas write and creates output only under
the experiment's `results/` directory.

Run it from the repository root:

```powershell
node --no-warnings --import ./scripts/ts-register.mjs experiments/universal-visual-grammar-v1/run.mjs
node --no-warnings --import ./scripts/ts-register.mjs experiments/universal-visual-grammar-v1/test.mjs
npx tsc --noEmit
```

All three checks passed on the final run.

## Prerecorded audio inventory

The recursive repository inventory found 49 audio-bearing files after
excluding `.git`, `.next`, and `node_modules`:

| Group | Count | Treatment |
|---|---:|---|
| `scripts/stt/audio/*.wav` | 35 | Inventoried, not selected. These are short pronunciation, number, domain, and disfluency fixtures; selecting many would inflate sample size without adding sustained meaning. |
| `public/demos/*.webm` | 3 | All selected. Each has a retained spoken script in `lib/demos.ts` and covers business explanation, a concrete teaching process, or planning. |
| Demo Studio source audio | 2 | Both selected. They have exact transcripts and retained settled thoughts. |
| Demo Studio derived videos | 2 | Not selected separately because they duplicate the selected source audio. |
| Visual Re-entry capability WAVs | 5 | Sequence, cause/effect, and the comparison proof selected. Two duplicate/superseded comparison recordings excluded. |
| Miscellaneous browser capture WebMs | 2 | Not selected. They are derived captures without a stronger retained transcript/thought pairing than the chosen corpus. |

The full per-file inventory, byte sizes, known WAV durations, selection status,
and exclusion reason are retained in `shadow-results.json`. Five selected files
have trustworthy duration metadata totaling 198,345 ms. The three older public
demo WebMs have no trustworthy duration sidecar in the repository, so the
experiment leaves their duration as `null`; it does not infer duration from
file size or fabricate an exact media length. Their recreated thought clocks
are synthetic and used only to keep the offline evidence window deterministic.

## Selected corpus

Eight recordings were selected: two natural recordings, three recorded product
demos, and three focused capability fixtures.

| Recording | Kind | Thought source | Thoughts | Current visuals | Experimental eligible | Why selected |
|---|---|---|---:|---:|---:|---|
| Natural audience-growth reflection | Natural, 87.96 s | 19 retained settled thoughts from Demo Studio | 19 | 1 | 2 | Real disfluency, people and reciprocal action, quantity change, contrast, uncertainty, emotion, and figurative “grinding/moving forward” language. |
| Natural InPublic explainer | Natural, 46.58 s | 8 retained settled thoughts from Demo Studio | 8 | 0 | 1 | Abstract system explanation, speech-to-canvas flow, relationships, structures, spatial wording, and self-correction. |
| Business thinking demo | Recorded demo; exact duration sidecar unavailable | Retained spoken script passed through the current boundary policy | 2 | 0 | 1 | Revenue/churn change, causal attribution, cancellation, and priorities. |
| Photosynthesis demo | Recorded demo; exact duration sidecar unavailable | Retained spoken script passed through the current boundary policy | 2 | 0 | 2 | Concrete objects and materials, input movement, creation, release, and transformation-like process. |
| Launch-plan demo | Recorded demo; exact duration sidecar unavailable | Retained spoken script passed through the current boundary policy | 2 | 0 | 2 | Explicit precedence, dependencies, actions, priorities, and a quantity. |
| Sequence capability | Focused fixture, 18.035 s | Retained transcript passed through the current boundary policy | 1 | 1 | 1 | Explicit four-stage process and cross-sentence order. |
| Cause/effect capability | Focused fixture, 27.185 s | Retained transcript passed through the current boundary policy | 3 | 1 | 2 | Proven causal chain plus a deliberately uncertain correlation that must not become a causal arrow. |
| Comparison capability proof | Focused fixture, 18.585 s | Retained transcript passed through the current boundary policy | 3 | 1 | 1 | Two-sided option comparison distributed across thoughts and an unresolved choice. |

The two natural recordings use the exact settled thoughts recorded by the live
system. For the six recordings without retained thought objects, the
experiment recreates presentation units using the current
`pushPresentationSegment`/`flushPresentationThought` policy. This preserves
the current boundary logic, but not original provider-final timing. Therefore
this run is valid for semantic coverage comparison, not latency measurement.

The sample spans natural and scripted speech, abstract and concrete content,
process, causal structure, comparison, quantity, uncertainty, and limited
figurative language. It does **not** adequately cover explicit hierarchy,
literal spatial predicates, repeated/cyclical action, or sustained metaphor.
The repository contains no retained, meaningful long-form audio/transcript
pairs for those categories. The short STT fixtures were deliberately not
promoted into “meaningful recordings” merely to fill cells.

## Current Visual Re-entry baseline

Each recording was run through the current side-effect-free candidate/evidence
and deterministic fast-path helpers. No `/api/visual-reentry` request and no
model fallback occurred.

| Current outcome | Thoughts | Share |
|---|---:|---:|
| Deterministic visual | 4 | 10.0% |
| Pending bounded evidence | 4 | 10.0% |
| Text only / rejected | 32 | 80.0% |
| Model fallback, deliberately unexecuted | 0 | 0.0% |

The four deterministic visuals were the expected proven cases:

1. growth from 60 followers to about 400;
2. collect → clean → train → explain sequence;
3. marketing → traffic → sign-ups causal chain;
4. Option A versus Option B comparison.

This confirms the prior audit: current Visual Re-entry is reliable within its
five owned families, but broad meaning such as material flow, dependency,
abstract system action, and unnumbered directional change often remains text.

## Universal Meaning Graph V1

The pilot schema is intentionally small. It is not a world model and it does
not contain pixels, Excalidraw element IDs, camera instructions, or arbitrary
canvas actions.

### Nodes

`MeaningNode` contains `id`, `label`, `kind`, source `evidence`, and
`confidence`. The closed V1 node kinds are:

- `person`
- `object`
- `concept`
- `place`
- `organization`
- `value`
- `event`
- `state`

These kinds are broad enough to bridge Standard, Story, and Math without
pretending they render identically. A Story renderer may resolve an `object`
to a literal asset or procedural recipe; Standard may render the same node as
a labeled concept; Math may refuse it unless it participates in a verified
symbolic structure.

### Edges

`MeaningEdge` contains typed endpoints, evidence, confidence, and a
`figurative` bit. V1 includes:

- causal/dependency: `causes`, `depends_on`;
- containment/ownership: `contains`, `part_of`, `belongs_to`;
- contrast: `opposes`, `compares_with`;
- movement: `moves_toward`, `moves_away_from`;
- spatial: `between`, `above`, `below`, `inside`, `near`;
- temporal: `before`, `after`;
- state: `changes_into`;
- weak generic relation: `connects_to`.

Typed edges matter because an arrow must not mean five different things. A
causal arrow, temporal arrow, dependency arrow, movement arrow, and generic
connection must have distinct semantics and styling. `connects_to` is a last
resort and is not permission to infer causality or order.

### Actions

`MeaningAction` records a typed action, optional actor/target, optional value,
unit and direction, evidence, confidence, and figurative status. V1 includes:

`grow`, `decline`, `move`, `create`, `remove`, `combine`, `split`, `start`,
`stop`, `increase`, `decrease`, `transform`, and `repeat`.

Actions are distinct from edges. “The plant releases oxygen” is an action even
when the source does not name a second stable object relationship. “Marketing
creates traffic” supports both a creation action and a causal edge.

### Modifiers

Modifiers represent `importance`, `certainty`, `quantity`, `direction`,
`speed`, `intensity`, `time`, and `order`. This is where “about 400,” “first,”
“today,” “still deciding,” or “next priority” survives without being promoted
to an unsupported node or edge.

### Grounding and ambiguity

Every node, edge, action, and modifier carries source evidence. The graph also
has `figurative` and `ambiguities` fields. The pilot explicitly withholds a
causal edge for “sign ups increased, but I don't know if one caused the
other.” It can still represent the stated increase as a qualified directional
change. Figurative wording can remain textual or annotated; it does not grant
literal geometry.

## Universal Visual Grammar V1

The visual grammar consumes the graph and returns a declarative visual plan.
It does not mutate a scene.

### Primitive vocabulary

The V1 primitives are deliberately renderer-neutral:

- `node`
- `directed_edge`
- `undirected_edge`
- `container`
- `lane`
- `axis`
- `value_marker`
- `state_pair`
- `cycle_edge`
- `literal_object`
- `annotation`

This is a Level 2/3 proposal: richer composition from constrained primitives
and deterministic layout. It is not Level 4 generated mutation.

### Layout rules

1. **Causal chain** — causes flow left-to-right toward effects. Uncertainty is
   an annotation, never a causal arrow.
2. **Process flow** — ordered events use one lane and preserve spoken order.
   Missing steps are not synthesized.
3. **Comparison** — two aligned lanes hold the two named subjects. A property
   appears only on the side explicitly supported by speech.
4. **Hierarchy/containment** — `contains` uses nesting; `part_of` and
   `belongs_to` use parent-child structure. These must not fall back to an
   unlabeled generic arrow.
5. **Spatial map** — placement follows explicit predicates only. “Moving
   forward” cannot move a node rightward unless the phrase is literal in
   context.
6. **Quantitative change** — exact or approximate anchors use value markers;
   unnumbered increase/decrease may use direction without inventing magnitude.
7. **State transformation** — before/after states are connected by the typed
   transformation. Combine and split require visibly distinct inputs/outputs.
8. **Cycle** — a path closes only when repetition is explicit. Repeated words
   or ASR duplication do not establish a cycle.
9. **Object relation** — concrete objects may use literal tokens, but labels
   retain distinctions the token cannot safely depict.
10. **Concept network** — abstract nodes use restrained labeled forms and
    typed edges/actions; they must not masquerade as literal objects.
11. **Text only** — named nouns alone, unsupported pronouns, vague emotional
    fragments, and unresolved figurative phrases stay textual.

### Arrow and relationship semantics

Arrows are allowed only for typed direction: causal, temporal, dependency,
movement, or transformation. Comparison uses alignment rather than an arrow.
Containment uses nesting. Generic association uses an undirected or explicitly
labeled connection. This avoids the common whiteboard failure where every
relationship becomes the same arrow and the visual overstates the source.

### Uncertainty and modifiers

Approximation stays attached to its value (`about 400`). Epistemic uncertainty
uses a textual qualifier or reduced-emphasis annotation. It never changes the
graph's direction. Importance affects emphasis, not position or causality.
Time and order affect layout only when their target is grounded.

### Literal versus abstract styling

Node kind and renderer capability jointly decide styling. Concrete objects can
use simple literal tokens or Story recipes. Abstract concepts use labeled
shapes. Organizations and people can use stable icons only when identity is
not overstated. Values use markers or verified symbolic notation. No renderer
may turn an abstract metaphor into literal scenery without explicit support.

## Quantitative results

| Measure | Current | Experimental | Difference |
|---|---:|---:|---:|
| Visualization-ready/visual thoughts | 4 / 40 (10.0%) | 12 / 40 (30.0%) | +8 thoughts, +20.0 percentage points |
| Text-only thoughts | 32 / 40 | 28 / 40 | -4; the remaining difference is current pending evidence |
| Proven/current-family overlap | 4 | 4 | The graph represented all four current deterministic successes |
| Newly eligible current text-only | — | 6 | Comparison, causal/material flow, dependency, and concept/action structures |
| Newly eligible current pending | — | 2 | One launch process and one qualified increase |

Experimental family distribution:

| Visual family | Thoughts |
|---|---:|
| Causal chain | 3 |
| Process flow | 3 |
| Comparison | 2 |
| Concept network | 2 |
| Quantitative change | 2 |
| Text only | 28 |

The graphs contained 45 typed nodes, 12 typed edges, and 16 actions. The most
common extracted edges were `before` and `causes` (four each), followed by
`compares_with` and `depends_on` (two each). This distribution reflects the
selected corpus; it is not a product-wide frequency estimate.

## Paired examples

The following 21 examples are the fixed example slice in the generated result.
“Current” means the offline current candidate/evidence/fast-path outcome.
“Experimental” is the graph-derived plan. A plan marked “review” is counted by
the rule-based threshold but belongs in the error queue before any production
use.

| # | Settled thought | Current | Experimental graph / plan | Assessment |
|---:|---|---|---|---|
| 1 | “First, we collect the data. Then we clean the data. Finally, we train the model. Once that's finished, I can explain the result to the team.” | Visual: sequence | Four `before` stages; process flow | Strong overlap; universal graph preserves the proven sequence. |
| 2 | “Marketing creates traffic. And that traffic creates more sign ups…” | Visual: cause/effect | Marketing → traffic → sign-ups; causal chain | Strong overlap; two typed causal edges. |
| 3 | “Then optimize latency… After that, bring in ten testers…” | Pending | Prior launch dependency + ordered actions; process flow | Newly eligible through one-thought bounded context. |
| 4 | “It was the first time I really grew from 60 followers to about 400…” | Visual: quantitative | 60 → about 400; quantitative change | Strong overlap; approximation preserved. |
| 5 | “Our revenue increased… Most of that churn came from new customers who cancelled…” | Text only | New-customer cancellation → churn plus increase/stop actions; causal chain | Newly eligible; useful but labels need cleaner syntactic extraction. |
| 6 | “Option B costs more. But it gives you more control.” | Visual: comparison | Option A versus Option B from bounded prior context; comparison lanes | Overlap. Cross-thought context is necessary and explicit. |
| 7 | “It uses that energy to create glucose, and releases oxygen.” | Text only | Energy/material creation relation; causal chain | Newly eligible, but likely better owned by a specialized material-flow renderer than a generic causal renderer. |
| 8 | “Compared to yesterday, today was a much better day.” | Text only | Yesterday versus today; comparison | Newly eligible; qualitative property only, no invented score. |
| 9 | “Photosynthesis starts when a plant absorbs sunlight. The plant takes carbon dioxide… and water…” | Text only | Plant/input actions; concept/object network | Newly eligible; specialized process/material-flow grammar preferred. |
| 10 | “Before we launch, we need to finish payments first.” | Text only | Launch depends on payments; process/dependency flow | Newly eligible and clearly source-grounded. |
| 11 | “After we changed the website, sign ups increased, but I don't know if one caused the other.” | Pending | Qualified increase; **no causal edge** | Newly eligible for direction only; review because the pilot has no numeric anchors. |
| 12 | “If I explain an idea, the structure of the idea… should start appearing.” | Text only | Start/action concept network | Review: ASR/self-correction makes the actor and target unstable. |
| 13 | “I was grinding in that sense… I challenged someone…” | Pending | Text only; figurative ambiguity retained | Correct restraint. No literal grinding or movement. |
| 14 | “I didn't know… I was kinda shocked because I didn't know…” | Text only | Text only; causal claim withheld | Correct restraint under uncertainty and disfluency. |
| 15 | “Speaker. This is InPublic.” | Text only | Text only | Correct; entity mention alone is not a diagram. |
| 16 | “Deepgram is listening… from that speech, InPublic starts deciding…” | Text only | Text only in V1 | Likely false negative: a parser with better clause/coreference handling could form speech → decision flow. |
| 17 | “Then it sends ideas into Excalidraw. Text boxes, relationships, arrows…” | Text only | Text only in V1, with bounded prior context | Likely false negative: movement/data-flow semantics were not extracted. |
| 18 | “Our next priority is improving onboarding and retention.” | Text only | Text only | Conservative; could become a two-item priority cluster only with a clear list/relationship contract. |
| 19 | “We will keep measuring before we make a stronger claim.” | Text only | Text only | Correct; this is a future intention, not evidence for a causal diagram. |
| 20 | “Option A is cheaper and faster to set up.” | Pending comparison | Text only until Option B arrives | Correct bounded hold; one side alone should not force a two-lane comparison. |
| 21 | “I'm still deciding which one I would actually choose.” | Text only | Text only | Correct; uncertainty modifies the existing comparison but does not add a new visual fact. |

## Which thoughts were structurally ready but currently text-only?

Six current `text_only` thoughts were classified as visualization-ready:

- yesterday versus today qualitative comparison;
- the natural “structure should start appearing” abstract action, with low
  confidence and mandatory review;
- revenue/churn/customer-cancellation causality;
- photosynthesis input/action structure;
- energy creating glucose/releasing oxygen;
- launch depending on payments.

Two current pending thoughts were also eligible:

- the continuation of the launch process;
- sign-ups increasing while causality remains explicitly unknown.

The strongest opportunities are dependency/process and material/causal flow.
The weakest is the self-corrected abstract “structure should start appearing”
thought, which demonstrates why eligibility and render authorization must not
be the same decision.

## Failure analysis

### Likely false positives

1. **Self-corrected abstract action.** The natural phrase “the structure of the
   idea starts the structure of the idea should start appearing” passed at
   confidence 0.68. It contains a real intended action, but its duplicated
   subject and incomplete ending make an immediate diagram unsafe.
2. **Unnumbered increase.** “Sign ups increased” is a valid directional claim,
   but the experiment calls it `quantitative_change` without numeric anchors.
   A specialized grammar could render only an upward direction and an
   uncertainty note; a chart or scaled axis would be a false positive.
3. **Comparison context.** Option B correctly completes Option A, but pronouns
   such as “it” remain under-resolved. The plan is valid only because the
   two-subject frame is explicit and bounded to the immediately prior thought.
4. **Material creation as generic cause.** “Energy to create glucose” passed as
   a causal chain. The meaning is broadly directional, but a material-flow or
   transformation grammar would be semantically sharper than a generic cause
   arrow.

The automated error queue deliberately includes low-confidence, figurative,
or ambiguous eligible cases. It is an audit queue, not a labeled false-positive
count.

### Likely false negatives

1. “Deepgram is listening… from that speech, InPublic starts deciding…” likely
   contains a grounded system/data flow, but the V1 parser does not resolve the
   nested clauses.
2. “Then it sends ideas into Excalidraw…” likely contains movement/data flow,
   but the pronoun target and preceding thought are not resolved into nodes.
3. “Next priority is improving onboarding and retention” might support a small
   priority cluster, but the grammar correctly lacks a clear ownership rule for
   turning a conjunction into two nodes.
4. The experiment has no meaningful opportunity to prove hierarchy, literal
   spatial composition, or cycles. A zero count in those families is therefore
   “not tested,” not “unsupported.”

### Graph extraction errors

- Clause-level labels are sometimes too broad (“new customers who cancelled
  after their first month”) and need a syntactic extractor before rendering.
- Pronouns are intentionally weak. V1 uses only immediate bounded context for
  explicit continuation/comparison; it does not maintain a general discourse
  model.
- The node classifier is a small lexical heuristic. Its type counts are useful
  for debugging, not ontological truth.
- ASR duplication can appear as a transformation or repeated action. `repeat`
  must require semantic repetition, not duplicate words.
- Recreated thoughts preserve current boundary policy but cannot reproduce the
  original provider-final cadence or historical page timing.

### Grammar/rendering errors

- `causal_chain` is too broad for some material transformations.
- `concept_network` is a safe fallback contract but risks reproducing the
  labeled-box aesthetic if used too often.
- Unnumbered increase/decrease needs a distinct directional-change recipe, not
  a numeric chart.
- Comparison properties need stable row alignment and provenance across
  thoughts.
- No pixels were rendered in V1. Visual clarity, collision behavior, arrow
  routing, camera fit, and pacing remain unmeasured.

### Generalization risks

- The corpus is small and partly capability-focused.
- Two natural recordings come from one speaker/context.
- Three public demos are scripted and their original V2 settled thoughts were
  not retained.
- The rule-based planner was designed with knowledge of the repository's
  existing capability families; coverage gain may not transfer unchanged to
  new domains.
- There is no human-labeled precision/recall set and no inter-rater agreement.
- Corpus gaps are material: hierarchy, spatial predicates, cycles, and
  sustained metaphor need real audio before those grammar branches can be
  judged.

## Reuse readiness map

Grades mean: **A** reuse directly as a bounded component; **B** reuse after
adaptation behind the new contract; **C** borrow ideas only; **D** do not reuse
for this architecture.

| Existing capability | Grade | Recommendation |
|---|:---:|---|
| Current Visual Re-entry (`lib/visualReentry/*`) | A | Keep as the production baseline and as specialized gates/renderers for enumeration, quantitative change, sequence, cause/effect, and comparison. Do not replace its strict grounding with the pilot parser. |
| Legacy SemanticBoard (`lib/semantic.ts`) | B | Adapt concepts, relationships, sections, bounded history, and provenance into graph ingestion/state. Do not revive its live production path. |
| Organizer and bound arrows (`lib/organizer.ts`, `lib/ops.ts`) | B | Reuse deterministic placement, endpoint binding, routing, and measurement as renderer substrate. Put typed plans in front of it. |
| Director/Choreographer (`lib/director.ts`, `lib/directorState.ts`, `lib/choreographerComparison.ts`, `lib/choreographerProcess.ts`) | C | Borrow comparison/process recognition and accumulation heuristics. The legacy timing/state assumptions should not become the universal contract. |
| Story schema and recipes (`lib/story.ts`, `lib/storyPrimitives.ts`, `lib/storyAssets.ts`, `lib/storyV2.ts`) | B | Reuse entity/action/relation/state vocabulary, asset validation, literal-scene constraints, and procedural recipes as a specialized Story/literal-object grammar. |
| Story production mutation path | D | Do not use as Standard integration. Its scene mutation and mode contract are broader than this experiment and explicitly out of scope. |
| Math grounding and verification (`lib/math/ground.ts`, `lib/math/types.ts`, `lib/math/verify.ts`, `lib/math/visuals.ts`) | B | Reuse provenance, schema validation, deterministic verification, and renderer separation patterns. Keep symbolic math specialized. |
| Free-form Artist/canvas actions | D | Do not make them the universal output. Arbitrary action generation weakens grounding, validation, deterministic replay, and failure isolation. |

## Architecture decision

### Recommendation: hybrid

The recommended pipeline is:

```text
settled thought(s)
  → bounded discourse/context resolver
  → Universal Meaning Graph
  → grounding + ambiguity gate
  → specialized grammar selector
  → specialized deterministic renderer
  → existing adoption/composition/camera systems
```

The universal layer owns semantic identity and provenance. Specialized
grammars own visual truth:

- current Visual Re-entry grammar for its five families;
- concept/dependency/material-flow grammar for Standard;
- literal scene/action grammar for Story;
- symbolic derivation grammar for Math;
- potentially a spatial grammar once a real corpus proves the need.

This division lets the product share understanding without flattening visual
language. It also permits independent gates: a graph may be valid while no
renderer is authorized, and a renderer may exist while the source lacks enough
grounded structure.

### Why not one universal renderer?

A universal renderer would either:

- reduce all semantics to boxes and arrows, losing expressive range; or
- expose enough free-form mutation to reintroduce hallucination, layout, and
  replay risk.

The shadow results already show the distinction. Photosynthesis material flow
and marketing causality can share graph primitives, but they should not
necessarily share the same visual recipe. Mathematical equality and a Story
character moving toward an object share “relation/action” at the graph level,
not at the rendering level.

### Why not specialized schemas only?

Separate schemas for every mode would repeat extraction, provenance,
uncertainty, quantity, and discourse logic. It would also make a settled
thought's meaning change depending on the chosen renderer. The universal graph
provides a stable semantic handoff while allowing a renderer to decline.

## Isolated render prototypes

No render prototype was produced in V1. This was deliberate. The semantic
shadow already answered the first question—whether a shared meaning contract
can improve coverage—and exposed extraction/ownership errors that would make
polished pixels misleading. Renderer work should begin only after a grammar
family has a small human-labeled semantic set. Production renderers and models
remain untouched.

## Single next production experiment — identify only, do not implement

Run one **production shadow Graph Contract Validation** experiment on settled
thoughts, with no rendering and no user-visible behavior:

- sample consent-compatible Standard sessions across multiple speakers and
  topics;
- generate only the Universal Meaning Graph plus proposed specialized family;
- store bounded structured metrics/provenance, not raw audio in telemetry;
- compare against the current Visual Re-entry outcome;
- have humans label a fixed stratified thought set for “diagram-worthy,” graph
  correctness, edge direction, uncertainty preservation, and renderer family;
- require per-family precision before any renderer experiment, with causal and
  quantitative claims held to the strictest threshold;
- treat hierarchy, spatial, cycle, and metaphor as unproven until the corpus
  contains enough real examples.

The go/no-go question for that experiment is narrow: **Can the graph contract
achieve high human-rated semantic precision on natural settled thoughts while
preserving 100% source grounding and all current deterministic successes?**

Do not couple that experiment to a new model, canvas renderer, feature flag,
camera rule, or Level 4 mutation. If it passes, the next separate step should
be one specialized renderer family, selected by natural frequency and human
value—not a universal production rollout.

## Final decision

The Universal Meaning Graph is viable as a shared intermediate contract. The
Universal Visual Grammar is viable as a selector and constrained composition
language. A universal renderer is not supported.

Proceed with a **hybrid architecture**, retain current Visual Re-entry as a
specialized proven subsystem, adapt legacy semantic/organizer/Story/Math ideas
behind the graph, and validate the graph in production shadow mode before any
user-visible integration.
