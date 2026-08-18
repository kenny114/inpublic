# InPublic Expressive Visual System Audit

Audit date: 2026-08-17

Scope: current workspace runtime, with Standard Mode as the production-default path

Method: runtime call-path tracing, schema/prompt/renderer inspection, deterministic scenario probes, existing tests and replay artifacts

Non-goal: no product behavior, prompt, model, renderer, capture, or camera code was changed

## 1. Executive Summary

### The current product is a live transcription canvas with selective structural enrichment

The production-default Standard Mode is not the older Scribe → Beat → Artist diagram system. The current feature combination is:

- `standardMode: true`
- `livePresentationV2: true`
- `visualReentryV1: true`
- `storyMode: false`

Those values are hardcoded in `lib/features.ts:22-128`. With Live Presentation V2 enabled, Standard Mode deliberately suppresses Reflex, Scribe, Beat, Artist, Director, and Math (`lib/features.ts:72-85`; `components/Board.tsx:5891-5903`; `components/Board.tsx:6051-6060`). The active path is therefore:

```text
microphone
  ↓
browser AudioWorklet PCM16 (MediaRecorder fallback)
  ↓
Deepgram Nova-3 live WebSocket
  ├─ interim transcript ───────────────→ one mutable Excalidraw text element
  └─ final transcript
       ↓
deterministic presentation-boundary logic
       ↓
settled thought ───────────────────────→ permanent Excalidraw text element
       ↓
bounded cross-thought evidence window
       ↓
conservative candidate gate
       ├─ rejected ────────────────────→ no additional visual
       └─ accepted
            ↓
       deterministic extractor, or one small model fallback
            ↓
       strict schema + source grounding
            ↓
       deterministic visual renderer
            ↓
       append one of five structures below the text when placement is safe
```

The five active enrichment families are:

1. enumeration,
2. quantitative change,
3. ordered sequence,
4. cause/effect,
5. comparison.

Even these are predominantly textual compositions. Enumeration and sequence are numbered text; comparison is a two-column text matrix; cause/effect is text in boxes connected by arrows; quantitative change is two text values joined by an arrow (`lib/visualReentry/render.ts:128-367`). There is no active Standard-Mode family for objects, actors, spatial prepositions, containment, hierarchy, metaphors, arbitrary diagrams, sketches, or scene composition.

### The primary bottleneck is the active semantic/visual contract

The dominant limitation is not Excalidraw. The repository can already draw rectangles, ellipses, arrows, polylines, icons, mathematical visuals, composed objects, characters, environments, and persistent scenes. The limitation is that the production Standard path exposes only:

```ts
SettledThought { text, sourceSegments, page, timing... }
```

followed by a strict union of five visual specs. If a thought is not confidently reducible to one of those five schemas, it is rejected locally and no planner is asked to consider another visual language. `none` is intentionally the default. The model prompt reinforces this restraint, but the prompt is downstream of the more important constraints: the local candidate gate, closed schema, source-grounding rules, one-visual cap, renderer vocabulary, and V2 suppression of the general Artist path.

### Text bias is an explicit reliability policy

For every meaningful spoken clause, the product immediately writes the words. A second representation is optional and rare. Text is therefore both the universal live response and the permanent fallback. This preserves latency, truthfulness, readability, editability, and camera stability, but it makes text accumulation inevitable during extended speech.

Existing evidence supports this. In the two current Demo Studio session snapshots inspected:

| Session artifact | Settled thoughts | Candidate outcomes | Final element mix |
|---|---:|---|---|
| `demo-c7f.../session.json` | 8 | 0 accepted, 8 rejected | 8 text / 8 total |
| `demo-8e25.../session.json` | 19 | 1 accepted, 17 rejected, one thought handled by evidence lifecycle rather than a terminal candidate event | 21 text + 1 line / 22 total |

The second session's only additional visual was `quantitative_change`; its visual itself is two text elements and one arrow line. These are small test/demo samples, not product-wide telemetry, so they must not be generalized into a traffic percentage. A separate six-minute natural validation recorded 51 thoughts evaluated, 45 rejected, 3 accepted, and 2 committed visuals, or about 0.34 committed visuals/minute (`docs/POST-STABILIZATION-NATURAL-PRESENTATION-VALIDATION-V1.md:183-223,284`). Again, that is one validation session, not a fleet-wide distribution.

### The repository contains two richer but inactive brains

1. **Legacy Standard semantic diagram system.** Scribe can emit titles, headings, words, notes, bullets, boxes, a 20-icon library, links, underlines, and a greeting wave. Beat decides when to draw; Artist edits a persistent `SemanticBoard` with concepts, relationships, sections, commands, movement, resizing, highlighting, grouping, deletion, and zoom. Director/Choreographer can rearrange existing concept boxes into comparisons and processes. This path is implemented and tested but unreachable while V2 is on.

2. **Parked Story system.** Story Mode has a richer entity/action/relation state model, persistent scene graphs, 20 prepared assets, nine specifically registered V2 proof assets, procedural object recipes, environments, relative placement, motion/effects, entity mutation, scene continuation, and atomic local event compilation. It is not exposed for new sessions because `storyMode: false`, though old saved Story sessions remain viewable.

### Overall diagnosis

Ranked causes of visual monotony:

1. **Active visual-vocabulary limitation** — five narrow, mostly text-centric families.
2. **Active semantic-representation limitation** — generic speech remains `SettledThought.text`; actor/action/object, spatial, transformational, and compositional meaning is not represented.
3. **Safety/fallback bias** — immediate text is guaranteed; any unsupported, uncertain, negated, corrected, implied, oversized, or ungrounded visual becomes no-op.
4. **Planner selection limitation** — the general Artist planner is suppressed; the active planner can choose only one of five closed specs.
5. **Layout limitation** — the active renderer appends full-width blocks using a writing pen; it does not compose or reorganize the canvas semantically.
6. **Temporal/mutation limitation** — current production enrichment is append-only; it does not bind to or evolve prior live text or prior enrichment visuals.
7. **Latency limitation** — important, but already architecturally mitigated by fast text plus asynchronous enrichment. It is not the principal reason rich visuals are absent.

## 2. Current Speech → Canvas Architecture

### 2.1 Production entry and mode routing

`app/create/page.tsx:7-47` dynamically loads `components/Board.tsx`. New Story sessions are clamped to Standard because `features.storyMode` is false; a specific saved Story session can still reopen in Story Mode (`app/create/page.tsx:26-35`).

`components/Board.tsx` is the actual orchestrator. It owns capture callbacks, live text, presentation thought boundaries, Visual Re-entry, the semantic board, legacy model calls, Story state, Excalidraw elements, layout pen, pagination, history, camera, and persistence.

The engine default is Deepgram (`components/Board.tsx:349-364`), and `.env.local` explicitly selects `NEXT_PUBLIC_ENGINE=deepgram`. A Gemini Live branch still exists, but it is not the configured path.

### 2.2 Stage-by-stage runtime trace

| Stage | Input → output | Latency sensitivity | Meaning level | Visual influence | Determinism |
|---|---|---|---|---|---|
| Browser capture | microphone stream → PCM16 chunks; MediaRecorder fallback | Critical startup and continuous path | None | None directly | Deterministic browser code |
| Credential/socket | usage guard + short-lived token → Deepgram connection | Startup-sensitive | None | None | Server/API-driven |
| Deepgram ASR | audio chunks → interim/final transcript, confidence, timing | Critical; interims are first visible source | Words | Supplies all active visual content | Model-driven ASR |
| Transcript correction | raw text + active terms → display text | Critical, local | Word/name repair | Changes visible spelling | Deterministic heuristics |
| Live line | current interim/growing thought → one mutable text element | Highest priority; must not await models | Words only | Directly creates visible text | Deterministic renderer |
| Presentation boundary | provider finals → zero or more settled thoughts + pending tail | Low-cost, live-sensitive | Clause completeness/readability, not domain semantics | Decides permanence and enrichment unit | Deterministic grammar/limits |
| Evidence window | settled thoughts → candidate/pending/rejected | Seconds-long bounded collection | Five supported structural cues | Decides whether enrichment may launch | Deterministic |
| Candidate gate | thought text → supported family or reject | Cheap; before model | Narrow semantics | Reject means text-only | Deterministic regex/parsers |
| Visual intent | candidate → strict symbolic spec | Async; never blocks live ink | One of five structures | Selects one visual family/content | Deterministic fast path, small model fallback |
| Grounding | spec + source thought → spec or `none` | Async/non-blocking | Verifies literal support | Fail means no visual | Deterministic |
| Visual renderer | symbolic spec + pen clone → Excalidraw skeleton | Waits for safe placement | No new meaning | Computes all geometry | Deterministic |
| Commit | prepared visual → appended elements | Held during mutable live line; may commit quietly | None | Adds visible structure | Deterministic policy |
| Layout pen | element footprint → next writing position | Synchronous | None | Rows/wrapping/page capacity | Deterministic |
| Camera | focal/context bounds → spring target or no-op | Must not chase speech | None | Changes view, not content | Deterministic controller |
| Pagination | pen overflow/capacity/commands → next fixed page | Must avoid mid-thought turns | Thought-completion heuristic | Changes destination page | Deterministic |
| Excalidraw | element array → visible editable canvas | Render-critical | None | Final visual surface | Library renderer |

### 2.3 Microphone and Deepgram details

`useDeepgram` acquires the microphone with `getUserMedia`, prefers an `AudioWorkletNode` using `/pcm-capture-worklet.js`, and sends PCM16 buffers directly. If the worklet cannot initialize, it falls back to `MediaRecorder` with an 80 ms timeslice (`hooks/useDeepgram.ts:453-516,737-755`).

The server mints a short-lived Deepgram credential; the root key stays server-side (`app/api/deepgram/token/route.ts`). The client connects with:

```ts
model: "nova-3"
interim_results: true
smart_format: true
endpointing: 150
utterance_end_ms: 1000
punctuate: true
vad_events: true
```

and up to 40 current keyterms (`hooks/useDeepgram.ts:682-710`). Interim results call `Board.handleInterim`; final results call `Board.handleFinal` (`hooks/useDeepgram.ts:927-1084`; `components/Board.tsx:6208-6223`).

### 2.4 Interim handling and live ink

Every non-Story interim is corrected for display and dispatched immediately to `writeLive` (`components/Board.tsx:5959-6009`). `writeLive` explicitly forbids network calls, semantic lookup, or planning in this tier (`components/Board.tsx:2710-2727`). It builds one Excalidraw `text` element, patches it in place as the interim grows, reserves its full-width row, and keeps a stable identity across revisions (`components/Board.tsx:2728-2867`; `lib/ops.ts:367-421`).

Under V2, if previous finals are still an unfinished presentation thought, the interim is displayed as a continuation of that thought (`components/Board.tsx:5999-6008`).

The code also calculates settled interim prefixes for commands and legacy Reflex/Scribe. However, V2 gates Reflex off and final handling never wakes Scribe, so these calculations do not create secondary Standard-Mode visuals today (`components/Board.tsx:6011-6115`).

### 2.5 Final handling, thought settlement, and permanence

Final transcript text is corrected, logged, added to pending legacy buffers, and passed through `pushPresentationSegment` when V2 is enabled (`components/Board.tsx:5713-5835`). That helper is a presentation boundary detector, not a general semantic parser. It uses punctuation, clause stability, continuation words, and a hard 32-word readability bound to emit complete presentation units while preserving all words (`lib/liveSpeech.ts`, especially `MAX_PRESENTATION_WORDS` and `pushPresentationSegment`).

Each emitted unit becomes:

```ts
interface SettledThought {
  id: string;
  text: string;
  sourceSegments: string[];
  page: number;
  startedAt?: number;
  settledAt: number;
  sessionGeneration?: number;
  sourceRegion?: { audioStartMs: number; audioEndMs: number };
  participantThoughtIds?: string[];
}
```

(`lib/visualReentry/types.ts:28-43`). It is written as permanent text first, then handed to Visual Re-entry (`components/Board.tsx:5843-5863`). On stop/silence, a pending thought is flushed through the same path (`components/Board.tsx:5908-5957`).

### 2.6 Visual Re-entry

`handleSettledVisualReentry` accumulates only bounded evidence for the supported families. Windows are same-page and capped by time, thought count, and characters: ordinary enumeration/quantitative evidence is at most two thoughts/12 seconds; sequence up to five thoughts/20 seconds; cause and comparison up to four thoughts/16 seconds (`lib/visualReentry/evidence.ts:1-19`).

The local `evaluateVisualCandidate` gate admits only:

- literal two-number change/comparison cues,
- explicit causal grammar,
- explicit two-subject comparison,
- explicit ordered process markers,
- explicit counted/list presentation cues.

Everything else returns `candidate: false` and never invokes a model (`lib/visualReentry/candidate.ts`).

Accepted candidates first attempt a deterministic parser. A small model fallback is allowed only if the family was already admitted but local extraction cannot safely complete it (`lib/visualReentry/fastPath.ts`; `lib/visualReentry/orchestrate.ts:59-155`). The fallback model must return one strict schema and never coordinates (`lib/visualReentry/decide.ts`). All extracted claims and evidence must ground back to the source; otherwise the complete visual becomes `none` (`lib/visualReentry/ground.ts`).

Prepared visuals are durable for up to 30 seconds and queued at most three deep (`components/Board.tsx:275-277,5481-5632`). They never race a mutable live line. During ongoing speech, an older prepared visual may commit quietly without moving the camera; a just-settled visual waits for a safe window (`lib/visualReentry/commitPolicy.ts`; `components/Board.tsx:5481-5559`).

### 2.7 Legacy Scribe → Beat → Artist pipeline

This code is real but not active under the current V2 flag:

```text
settled interim/final words
  ↓
Scribe: streaming short operations (title/word/box/icon/link/...)
  ↓
silence timer
  ↓
Beat: draw / command / section / undo / clear / math_step / skip
  ↓
Artist: semantic CanvasAction[] against SemanticBoard
  ↓
Organizer: reuse existing concept, adopt existing Scribe mark, or create
  ↓
applyAction: nodes, relationships, groups, movement, highlight, etc.
  ↓
Director: detect comparison/process in Artist output
  ↓
Choreographer: move existing nodes into semantic arrangements
```

The V2 final path gates `settleSpeculative`, `nudgeScribe`, and `resetSilenceTimer` behind `!v2Enabled`; `resetSilenceTimer` is the only entrance to `runBeat` (`components/Board.tsx:5891-5903`). This makes the entire chain, including the enabled Director flags and Math flag, unreachable in current Standard Mode.

### 2.8 Camera and pages

Pages are fixed 1040×780 sheets laid side by side with a 220 gap. A `Pen` starts at the top-left padded content origin, places blocks in rows, wraps horizontally, and advances full-width blocks vertically (`lib/ops.ts:180-266`). Current live lines and every Visual Re-entry family are full-width placements, so production composition is primarily a vertical document flow.

Hard overflow turns immediately. Soft capacity can defer until the current thought is complete; explicit new-page/clear and topic changes turn directly (`lib/pagination.ts`). Current V2 suppresses model-derived sections, so ordinary production page turns mostly arise from overflow, long utterances, or the closed voice command lane.

The camera follows a live line only if it would leave the safe viewport, then releases the hold without an automatic generic overview (`components/Board.tsx:2884-2933`). Enrichment may request a reveal only once per committed visual; quiet commits suppress it.

## 3. Current Visual Vocabulary

“Used today” below means reachable in a new production-default Standard session, not merely compiled or tested.

| Visual capability | Exists | Used today | Trigger/data | Live-safe | Can modify existing? | Position owner | Status/notes |
|---|---:|---:|---|---:|---:|---|---|
| Mutable live sentence | Yes | Yes | Every interim transcript | Yes, highest priority | Yes, patches same text element | Writing pen | Production core |
| Permanent settled sentence | Yes | Yes | Presentation boundary | Yes | No after settlement | Writing pen | Production core |
| Enumeration | Yes | Yes, rare | Explicit 2–5 item list | Async-safe | No | Visual renderer + pen | Numbered text, no enclosure |
| Quantitative change | Yes | Yes, rare | Exactly two literal numbers + change context | Async-safe | No | Visual renderer + pen | Two text values + arrow; deliberately not a chart |
| Sequence | Yes | Yes, rare | Explicit process/step markers, 2–5 steps | Async-safe | No | Visual renderer + pen | Numbered text + vertical arrows |
| Cause/effect | Yes | Yes, rare | Asserted explicit causal grammar, 2–4 nodes | Async-safe | No | Visual renderer + pen | Text boxes + `CAUSE` arrows |
| Comparison | Yes | Yes, rare | Explicit contrast between exactly two stable subjects | Async-safe | No | Visual renderer + pen | Two-column text matrix |
| Undo/new page voice commands | Yes | Yes | Exact closed phrases | Yes | Undo removes/reverts last operation | Existing history/page logic | Production |
| Title/heading/word/note/bullet | Yes | No under V2 | Scribe model ops | Historically progressive | Adds only; underline can annotate | Writing pen | Dormant legacy Standard |
| Generic concept box | Yes | No under V2 | Artist `create_concept` or local noun fallback | Behind live ink | No content mutation in renderer | Writing pen | Dormant legacy Standard |
| Bound relationship arrow | Yes | No under V2 | Artist `create_relationship` | Behind live ink | Excalidraw reroutes when nodes move | Obstacle router | Dormant legacy Standard |
| Group/enclosure | Yes | No under V2 | Artist/voice command | Yes after planning | Adds box around existing nodes | Bounds of existing nodes | Dormant legacy Standard |
| Move/resize/highlight/zoom/delete | Yes | No under V2 except undo | Artist commands | Behind live ink | Yes | Artist selects target; renderer uses fixed deltas/scales | Dormant; some incomplete mutation semantics |
| Comparison choreography | Yes | No under V2 | Director after Artist | Animated, cursor-aware | Moves existing nodes and reroutes arrows | Deterministic choreographer | Dormant |
| Process choreography | Yes | No under V2 | Accumulated Director evidence | Animated, cursor-aware | Moves existing nodes and adds order arrows | Deterministic choreographer | Dormant |
| Pictogram/icon | Yes | No under V2 | Scribe `icon <name>` from 20-name set | Progressive | No | Writing pen | Dormant; aliases in `lib/icons.ts` |
| Greeting wave | Yes | No under V2 | Scribe/gesture | Progressive | No | Writing pen | Dormant |
| Mermaid whole diagram | Yes | Not in current action path | Older `PendingRender`/`buildBeat` path | Slow/background | No; appended below notes | Mermaid auto-layout + pen | Residual/legacy; current Artist returns actions, not Mermaid |
| Math equation/step boxes | Yes | No under V2 | Beat `math_step` → Math route | Background | Mostly appends new step | Writing pen | Dormant under V2 |
| Number line | Yes | No under V2 | Math visual spec | Background | No | Deterministic math renderer | Dormant |
| Balance model | Yes | No under V2 | Math visual spec | Background | No | Deterministic math renderer | Dormant |
| Fraction bar/counters | Yes | No under V2 | Math visual spec | Background | No | Deterministic math renderer | Dormant |
| Coordinate axes/table/long multiplication | Yes | No under V2 | Math visual spec | Background | Long multiplication can replace same-type prior visual | Deterministic math renderer | Dormant |
| Persistent object/character scene | Yes | No for new sessions | Story actions/events | Partial previews + atomic final events | Yes | Story staging/relative layout | Parked Story Mode |
| Environment/weather layers | Yes | No for new sessions | Story environment events | Yes | Start/stop/replace | Story fixed stage | Parked Story Mode |
| Procedural object sketch | Yes | No for new sessions | Unprepared Story noun recipe | Yes after event | Rebuilt on entity state change | Story scene layout | Parked Story Mode |
| Free-draw/stroke stream | No application pipeline | No | None | N/A | N/A | N/A | Excalidraw itself supports drawing interactively; InPublic emits line/ellipse/rectangle skeletons, not `freedraw` speech output |
| Raster image generation | No speech pipeline | No | None | N/A | N/A | N/A | No active image model or image asset generation path |
| Generic chart | Partial | No | `chart` icon or math-specific visuals | N/A today | No | Fixed renderer | No general data-chart planner |
| Hierarchy/tree | Generic arrows can express it | No active semantic family | Legacy Artist could emit relationships | N/A today | Additive only | Pen + router | No dedicated hierarchy schema/layout |
| Containment/spatial scene | Story only | No in Standard | Story relative relation | Story-safe | Yes | Story relative layout | Absent from active Standard |

## 4. Where Visual Decisions Are Made

### Active production decisions

1. **Every transcript becomes text.** `handleInterim` and `handleFinal` unconditionally route Standard speech to `writeLive`, apart from exact voice commands (`components/Board.tsx:5713-5903,5959-6009`).

2. **Thought segmentation.** `pushPresentationSegment` decides which word spans become permanent and eligible for enrichment. It understands presentational completeness, not subject/action/object meaning (`lib/liveSpeech.ts`).

3. **Evidence ownership.** `advanceVisualEvidence` decides whether adjacent thoughts together form one supported structure and arbitrates the bounded family-specific windows (`lib/visualReentry/evidence.ts`).

4. **Candidate family selection.** `evaluateVisualCandidate` makes the decisive reachability choice. Rejection ends the expressive path locally (`lib/visualReentry/candidate.ts`).

5. **Intent extraction.** `tryDeterministicVisualIntent` parses explicit forms. Only admitted-but-hard cases go to `/api/visual-intent`, whose model can still choose only the strict five-family union or `none` (`lib/visualReentry/fastPath.ts`; `app/api/visual-intent/route.ts`; `lib/visualReentry/decide.ts`).

6. **Grounding.** `groundDecision` can veto unsupported items, claims, labels, modalities, numbers, or causal direction. There is no partial salvage into another family (`lib/visualReentry/ground.ts`).

7. **Geometry.** `buildVisual` owns all size and coordinates and dispatches by `spec.type` (`lib/visualReentry/render.ts:39-125`). The model never supplies coordinates.

8. **Placement/camera timing.** `chooseVisualCommitMode` and `flushVisualReentry` decide whether the visual waits, commits quietly, or reveals (`lib/visualReentry/commitPolicy.ts`; `components/Board.tsx:5481-5559`).

### Dormant legacy Standard decisions

- `SCRIBE_SYSTEM` selects title, heading, word, note, bullet, box, icon, wave, link, or underline. It is explicitly told to letter nameable things generously (`lib/prompts.ts:1-51`).
- `localBeatDecision` computes a shadow verdict, but the Beat model remains authoritative in the legacy path (`components/Board.tsx:4737-4781`; `lib/beatPrefilter.ts`).
- `BEAT_SYSTEM` decides draw/command/section/undo/clear/skip/math and targets approximately one drawing every two or three substantial sentences (`lib/prompts.ts:102-153`).
- `ARTIST_SYSTEM` selects semantic actions, prioritizing relationships and reuse (`lib/prompts.ts:155-248`).
- `planActions` resolves requested concepts into reuse, adoption of existing Scribe ink, creation, link, passthrough, or drop (`lib/organizer.ts:115-270`).
- `applyAction` chooses the concrete renderer and mutation behavior (`components/Board.tsx:3793-4480`).
- `advanceDirector` arbitrates comparison versus process and waits until persistent evidence is sufficient (`lib/directorState.ts`).
- `computeComparisonLayout` and `computeProcessLayout` choose semantic arrangements without model coordinates (`lib/choreographerComparison.ts`; `lib/choreographerProcess.ts`).

### Parked Story decisions

- `compileStoryEvent` recognizes known entities, action verbs, directions, spatial relations, and environment changes locally (`lib/storyV2.ts:179-275`).
- `/api/story` can return structured Story actions; deterministic fallback remains available (`app/api/story/route.ts`).
- `applyStoryEvent` resolves entities and relations atomically against persistent scene state (`lib/storyV2.ts:366-526`).
- `storyStagingDecision`, `storyEntityPositions`, asset builders, environment builders, and effect builders choose depth, relative position, and primitives (`lib/storyAssets.ts`; `lib/storyPrimitives.ts`).

## 5. Why the System Favors Text

### Mechanism, in order

1. **Text is mandatory and first.** Every interim is drawn before semantics. Every settled thought remains as text even if an additional visual later appears.

2. **V2 turns off the general visual planners.** The systems capable of boxes, icons, arbitrary concept relations, semantic node mutation, comparison movement, processes, and math are not scheduled.

3. **The active candidate gate is closed and conservative.** Most meaningful clauses do not match exactly two numbers, an explicit list, explicit step markers, explicit asserted causality, or an explicit two-subject comparison.

4. **Rejected candidates do not reach a model.** There is no open question such as “what visual language best expresses this?” for ordinary thoughts. Local rejection is terminal.

5. **The schema cannot express other answers.** `VisualReentryIntentSchema` has five visual branches plus `none`; an icon, spatial relation, sketch, actor/action/object scene, hierarchy, transformation, loop, or canvas mutation is invalid data (`lib/visualReentry/types.ts:45-183`).

6. **The prompt prefers silence.** The decision prompt explicitly calls `none` correct and expected for ordinary statements, reflection, uncertainty, hierarchy, spatial/story-like content, implied causality, unsupported structures, or weak confidence (`lib/visualReentry/decide.ts:43-58`).

7. **Grounding fails closed.** Unsupported modality, inferred inverse claims, derived numbers, invented intermediates, ambiguous causality, negation, correction, and ungrounded phrases delete the whole enrichment.

8. **Only one enrichment is permitted per thought.** Mixed structures are arbitrated to one family or `none`; they cannot layer symbol + layout + relationship.

9. **Current renderers are textual.** Four of five families primarily arrange text. Cause/effect adds boxes; the others add numbering/dividers/arrows around text.

10. **Enrichment appends instead of transforming.** Even successful semantics create a new block after the original sentence; they do not replace, bind, condense, or reorganize that sentence.

### What happens over 100 meaningful clauses

Mechanically, all 100 clauses first appear as text. Each presentation unit is checked by the five-family candidate gate. Only explicit qualifying structures can earn one additional visual. The rest remain text-only. Even successful enrichment leaves its source sentence intact and often adds more text elements. Therefore, the system cannot produce fewer than roughly one textual presentation element per settled thought without changing the current permanence contract.

There is no repository-wide telemetry that supports a defensible `Text 70% / Boxes 15% / ...` distribution. The available trace samples show stronger text dominance, but they are too small and purpose-built to treat as population estimates:

- 8/8 elements were text in one demo artifact.
- 21/22 elements were text in another; the sole non-text element was the arrow line in a quantitative-change visual.
- One six-minute validation committed two visuals for 51 evaluated thoughts.

The correct conclusion is qualitative and mechanistic: **100% of ordinary settled thoughts create text; additional visual structure is exceptional; sketches are 0% in active Standard Mode.**

### Text is the cheapest and safest universal fallback

Text does not require semantic commitment beyond transcription. It preserves uncertainty and nuance verbatim, is immediately editable in Excalidraw, needs no asset match, does not hallucinate spatial relationships, and can be laid out deterministically in milliseconds. Every richer representation introduces a lossy claim about what matters, what relates, and where it belongs. The current system resolves that asymmetry by always showing text and requiring unusually strong evidence for anything else.

## 6. Existing Expressive Recognizers

### Active Visual Re-entry recognizers

| Recognizer | Input | Confidence/arbitration | Output | Enabled in production? | Composition effect |
|---|---|---|---|---:|---|
| Quantitative change | Settled thought or two-thought evidence | Exactly two grounded anchors, compatible units/context; unsupported modality fails | `quantitative_change` | Yes | New two-value block + arrow |
| Enumeration | Settled thought or two-thought evidence | Explicit count/presentation cue; 2–5 complete items | `enumeration` | Yes | New numbered list |
| Sequence | Up to five same-page thoughts | Explicit order/process markers; 2–5 steps; uncertainty fails | `sequence` | Yes | New ordered vertical chain |
| Cause/effect | Up to four same-page thoughts | Explicit asserted direction; rejects uncertainty, negation, mere dependency, temporal order, correlation, correction | `cause_effect` | Yes | New boxed causal graph |
| Comparison | Up to four same-page thoughts | Exactly two stable subjects and explicit contrast; rejects co-occurrence/uncertainty/negation/correction | `comparison` | Yes | New side-by-side matrix |

Multiple active families do not fire together for one source. Candidate ordering and schema union establish one owner; the decision prompt also mandates at most one visual.

### Dormant Reflex recognizers

Reflex operates on words that two consecutive interims agree on, with a 0.6 confidence floor and local regex/phrase extraction. Its state supports deferred rendering, retry caps, dedupe, promotion when confirmed by final text, and retraction when contradicted (`lib/speculative.ts`). It is fully gated by `!v2Enabled` in `handleInterim`.

| Recognizer | Detects | Visual | Styling vs composition | Production now? |
|---|---|---|---|---:|
| count | “there are three reasons” | faint heading `3 REASONS` | Styling/mark only | No |
| trend | “revenue grew/fell” | faint `Revenue ↑/↓` | Symbolic mark only | No |
| title | title-shaped opening | faint title | Styling/hierarchy | No |
| concept | locally extracted noun phrase | faint box | Element type only | No |
| emphasis | “most important/critical X” | concept box at higher opacity | Styling only | No |
| contrast | settled chunk starting “but/however/on the other hand” | `⟷` heading mark | Symbolic mark only; no paired layout | No |
| cause | explicit relation whose endpoints already exist | text such as `A → B` rendered as a heading | Symbolic mark only; not a bound arrow | No |

Reflex can emit several events in one call, but it has no semantic arbitration among them. Rendering maps only title → title, concept → box, and every other kind → heading (`components/Board.tsx:3263-3268`). Thus count, trend, contrast, and cause are semantically distinguished in recognizer state but visually collapse into text glyphs/headings.

### Dormant Director recognizers

Director runs after an Artist batch in the legacy path. It detects:

- a two-concept comparison from explicit contrast and existing semantic concepts;
- one directed process edge per beat, accumulating a 3–6 concept chain over time.

It maintains hypotheses, evidence levels, conflicts, cooldowns, committed chains, and arbitration. If comparison and process compete in the same beat, process wins because it is the higher-consequence rearrangement (`lib/directorState.ts`). Unlike Reflex, Director changes composition by moving existing boxes and adding/rerouting connections.

### Story recognizers

Story V2 locally recognizes a useful actor/action/object subset: cat, tree, house, car, person, puddle; sit, stand, walk, run, look, stop; directions; under/on/inside/behind/in-front-of/near/toward/away-from; and sunlight/rain/wind/night/clouds (`lib/storyV2.ts`). The model-backed Story interpreter expands this to the full Story action and asset schema in `lib/prompts.ts:295-385`.

### Missing active Standard semantic categories

The active Standard path does not represent the following as first-class meaning:

- containment and inside/outside,
- arbitrary spatial location, between, above/below, near/far,
- actor/action/object,
- object state and state change,
- transformation without explicit process markers,
- hierarchy, ownership, membership, part/whole,
- dependency distinct from causality,
- convergence/divergence/branching/merging,
- cycles and feedback loops,
- accumulation/repetition unless phrased as a sequence or explicit list,
- scale/proximity/separation,
- emotion and metaphor,
- uncertainty as a visual property,
- question/answer or problem/solution pairs,
- revisiting or strengthening an existing idea,
- semantic importance beyond limited titles/emphasis in dormant systems.

Much of this information is not merely “thrown away by the renderer”; it is never encoded by the active semantic lane.

## 7. Existing Sketch / Drawing Infrastructure

### Classification

| Capability | Evidence | Classification | Standard reuse assessment |
|---|---|---|---|
| Native Excalidraw text/shape/arrow builders | `lib/ops.ts`, active production | **A. Production-ready** | Already the shared rendering substrate |
| Five Visual Re-entry renderers | `lib/visualReentry/render.ts`, production enabled | **A. Production-ready** | Directly extensible as a visual grammar |
| 20 small icons + aliases | `lib/icons.ts`, legacy Scribe path | **B. Reusable with work** | Geometry is ready; active semantic selection and attachment are absent |
| SemanticBoard concepts/relationships/history | `lib/semantic.ts`, legacy path | **B. Reusable with work** | Mature state/undo base, but current live text is not represented as concepts |
| Organizer adoption of existing text | `lib/organizer.ts`, `buildReferenceBox` | **B. Reusable with work** | Highly relevant bridge from live text to semantic objects; dormant under V2 |
| Bound arrow/router | `lib/ops.ts:534-640` | **B. Reusable with work** | Production-quality primitive; needs active semantic endpoints |
| Director comparison/process choreography | `lib/director*`, `lib/choreographer*` | **B. Reusable with work** | Useful mutation precedent; currently depends on dormant Artist-created concepts |
| Math visual vocabulary | `lib/math/*` | **B. Reusable with work** | Strong example of symbolic schema → deterministic geometry; domain-specific |
| Story scene graph/action model | `lib/story.ts`, `lib/storyV2.ts` | **B. Reusable with work** | Richest semantic/mutation substrate, but separate identity/layout model |
| Story prepared asset library | `lib/storyAssets.ts` | **B. Reusable with work** | Native editable Excalidraw shapes; requires a Standard visual selection contract |
| Story procedural recipes | `lib/storyPrimitives.ts` | **B. Reusable with work** | Strong generic-object fallback; currently Story-specific staging/identity |
| Story environment/effects | `lib/storyAssets.ts`, `lib/storyPrimitives.ts` | **B. Reusable with work** | Reusable primitives, but semantically easy to over-apply in abstract talks |
| Story partial/progressive rendering | `recognizeStoryPartial`, `renderStoryProvisional` | **B. Reusable with work** | Demonstrates cheap provisional visuals; not connected to Standard settled thoughts |
| Mermaid-to-Excalidraw whole diagram | `lib/scene.ts` and residual Board render queue | **C. Prototype/legacy path** | Can auto-layout graphs but produces whole appended clusters and weak ongoing identity |
| SketchRNN/Magenta | No current files, dependencies, or git-search hits | **D. Dead/removed or never present in this checkout** | No reusable implementation found |
| Speech-driven free-draw/stroke streaming | No `freedraw` application output found | **D. Not present** | Would be new infrastructure |
| SVG-to-Excalidraw conversion pipeline | No dedicated converter found | **D. Not present** | Story assets already emit Excalidraw-native skeletons instead |

### Story asset vocabulary

`STORY_ASSET_KEYS` contains 20 prepared keys:

```text
child, person, cat, dog, mouse, car, road, palm-tree, tree,
beach, sand, water, waves, sun, cloud, rain, puddle, house,
movement-arrow, speech-bubble
```

The V2 local proof manifest explicitly covers cat, tree, house, car, person, sunlight, rain, cloud, and puddle (`lib/storyAssets.ts:677-686`). Prepared objects are drawn as native Excalidraw shapes, so they remain editable and stylistically coherent.

For an unknown noun, `resolveProceduralRecipe` can choose vehicle, container, structure, creature, plant, device, or honest placeholder. `composePrimitives` then draws it from rectangles, ellipses, and lines (`lib/storyPrimitives.ts`). This is more reusable than a fixed asset library because it can render broad object classes without inventing a semantically adjacent asset.

Story also supports motion lines, direction arrows, speed lines, emotion marks, speech bubbles, rain lines, smoke, light rays, and sound marks. Environment layers support sunlight, clouds, rain, wind, and night. State changes rebuild the same logical entity rather than creating a duplicate.

### Can Story drawing become a Standard visual vocabulary?

Yes, architecturally, without reviving Story as a user-facing mode. The reusable layer is not the Story mode switch or Story prompt; it is:

```text
symbolic entity / relation / effect
  ↓
asset or procedural recipe resolution
  ↓
deterministic native-Excalidraw skeleton
  ↓
persistent identity + relative placement
```

The blockers are integration contracts, not drawing technology:

- active Standard has no entity/action/object schema;
- live text and Story entities use separate identity/state registries;
- Standard uses document-flow pages while Story uses a bounded scene stage;
- Story rebuild/render consistency and operation history are separate from `SemanticBoard` history;
- Standard needs a much stricter admission policy so ordinary nouns do not all become objects;
- Story's staging is scene-oriented, not designed to mix a few sketches into a textual explanation page.

Therefore Story assets are **reusable with work**, not drop-in production-ready for Standard.

## 8. Semantic Information Available Today

### Active Standard representations

#### Raw/final transcript records

The transcript layer retains exact text and timing, but no parsed roles or relations.

#### Presentation thought

`SettledThought` contains text, source segments, page, timing, session generation, and optional participant IDs. It carries no subject, action, object, intent, importance, uncertainty, relation, temporal order, or spatial fields.

#### Visual Re-entry specs

When admitted, semantic richness increases narrowly:

```ts
{ type: "enumeration", title?, items[2..5], evidence[] }
{ type: "quantitative_change", from, to, qualifiers?, unit?, labels?, evidence[] }
{ type: "sequence", title?, steps[2..5], evidence[] }
{ type: "cause_effect", title?, nodes[2..4], edges[1..3], evidence[] }
{ type: "comparison", leftLabel, rightLabel, rows[1..4], evidence[] }
```

These are meaningful and grounded. They are also transient render specs: commits do not register them as reusable semantic objects in `SemanticBoard`.

### Dormant legacy Standard representation

`SemanticBoard` is substantially richer than the active path:

```ts
Concept {
  conceptId, label,
  kind: input | process | output | person | product |
        problem | solution | goal | note | equation | graph | math_step,
  elementIds, sectionId, sourceText, confidence, timestamps, mathMeaning?
}

Relationship {
  relationshipId, fromConceptId, toConceptId,
  relationshipType, label, elementIds, confidence, createdAt
}

Section { sectionId, title, pageIndex, createdAt }
```

(`lib/semantic.ts:20-72`). `SemanticScene` adds active topic, current page, approximate positions, recent commands, recent transcript, and checkpoint summaries (`lib/semantic.ts:230-255`). This is a concept graph, but still not an actor/action/object or spatial scene graph. Most relation meaning lives in free-form strings.

### Parked Story representation

Story is the richest semantic representation in the repository. It includes:

- typed entity kinds and stable entity IDs,
- aliases and pronoun continuity,
- visual source: asset/composed/procedural/placeholder,
- appearance color/size,
- pose, action, direction, visibility, target,
- relative placement and named spatial relations,
- persistent relations with visual forms,
- environment layers,
- effects,
- scene activation/history/renderings,
- entity update, movement, transformation, visibility, and relation mutation.

This closely resembles the semantic richness the audit hypothesis asks about, but it is isolated behind Story mode.

### Diagnosis by layer

The limitation is a combination, ranked:

1. **Visual-vocabulary problem in the active contract.** Only five mostly textual families can be selected.
2. **Understanding/representation problem in the active lane.** Generic meaning is never encoded beyond text.
3. **Planning problem.** The broad Artist and Director planners are suppressed; Visual Re-entry is intentionally not a general planner.
4. **Composition problem.** Active layouts append blocks rather than operate on semantic spatial relationships.
5. **Rendering problem only at the margins.** Renderers for many desired primitives already exist. Missing families and integration are more important than drawing APIs.

## 9. Layout and Composition System

### Active Standard: a writing layout, not a scene composer

The current production layout is a deterministic cursor:

- fixed page dimensions and padding,
- place the next block at `(pen.x, pen.y)`,
- wrap if it exceeds the right edge,
- full-width blocks start their own row,
- advance vertically,
- turn the page when content cannot fit.

Every live sentence is full-width. Every Visual Re-entry visual is also placed full-width (`buildVisual` calls `place(pen, w, h, true)` at `lib/visualReentry/render.ts:104-110`). This guarantees order, whitespace, and non-overlap, but it means the active canvas behaves like a spatially generous transcript/document.

### What composition can and cannot do today

| Question | Active Standard answer |
|---|---|
| Place two concepts intentionally opposite? | Only inside a newly appended `comparison` block; not existing concepts |
| Place one thing semantically inside another? | No |
| Let one concept visually dominate? | No active importance-to-scale mapping |
| Express a left-to-right process? | Active sequence is vertical; dormant process choreography may choose horizontal |
| Branch divergence or convergence? | No |
| Accumulate repeated ideas spatially? | No; text dedupe/history exists only in dormant paths |
| Change an object's state? | No active objects |
| Grow a concept instead of duplicating it? | No active concept identity; live line only grows before settlement |
| Preserve blank space intentionally? | Margins/gaps yes; semantic negative space no |
| Reorganize after understanding improves? | No active enrichment mutation |
| Use existing canvas context? | Placement uses current pen and safety state, not semantic context |

### Dormant compositional capability

The legacy system can do more:

- `buildBoundArrow` routes around obstacles and binds endpoints.
- group actions enclose existing nodes.
- comparison choreography places two existing concepts side-by-side in an upper page band.
- process choreography places 3–6 existing concepts horizontally if possible, vertically otherwise.
- Excalidraw bindings reroute arrows when moved.

Story composition is richer again: depth bands, landmark/background/action zones, fixed environments, relative placements, and stateful entity positions. However, neither dormant system is a general constraint solver. The comparison/process choreographers are one-shape utilities, and Story staging is a fixed scene grammar.

### Camera is composition-aware but not meaning-aware

The camera computes safe recording viewport, readability floors, focal/context bounds, hysteresis, cooldown, and spring motion (`lib/composition.ts`). It can frame a newly committed visual or follow live content. It does not decide what content means or use the camera itself as a semantic device beyond explicit zoom commands in the dormant Artist path.

## 10. Existing-Element Mutation Capabilities

### Active production

| Mutation | Supported now? | Notes |
|---|---:|---|
| Patch current interim text | Yes | Stable element updated on every interim |
| Merge provider finals into one growing thought | Yes | Same live anchor until presentation boundary |
| Settle live text color/permanence | Yes | Soft interim → permanent ink |
| Undo last operation | Yes | Exact voice command or UI |
| New page | Yes | Exact voice command or layout overflow |
| Move/resize/relabel prior settled thought | No | Settled text has no semantic identity exposed to planner |
| Update prior enrichment visual | No | Visual Re-entry appends and does not register a reusable object |
| Connect to prior enrichment | No | No semantic endpoint registry |
| Merge/group/reorganize prior content | No | Active path lacks actions for it |

The production assumption is therefore predominantly:

```text
speech → append/settle a text mark
optional supported structure → append one additional block
```

not:

```text
speech → change a persistent semantic canvas state
```

### Dormant legacy mutations

`CanvasAction` supports create/update/delete concept, create relationship, create/clear section, group, move, resize, zoom, highlight, undo, form comparison, and form process (`lib/actions.ts:17-76`). History stores full element patches and removed entities for reversal (`lib/semantic.ts:74-126`).

Important limitations found:

- `update_concept` changes the semantic record but does not patch the visible label or rebuild the node (`components/Board.tsx:3870-3886`).
- `correct_math_step` changes semantic text but likewise does not visibly rebuild its element (`components/Board.tsx:4460-4477`).
- resize multiplies element width/height but does not explicitly scale bound label typography or reposition around a center (`components/Board.tsx:4028-4062`).
- grouping adds an enclosure but has no persistent group semantic object or ungroup action.
- no generic relationship update/delete action is exposed by Artist, even though undo records can represent deletion.
- comparison/process move existing concepts, but the general Artist cannot request arbitrary relational layout constraints.

### Story mutations

Story supports the strongest `speech → change state` model:

- update entity pose/action/direction,
- move relative to another entity,
- transform while preserving entity ID,
- show/hide,
- add/remove/upsert relationships,
- add/remove effects,
- replace environment states,
- reactivate previous scenes.

Rendering rebuilds changed logical entities and relations, so visual state follows semantic state. This is the closest existing implementation to Level 4 “canvas evolution.”

## 11. Speech Scenario Traces

These traces describe current production Standard Mode. The local candidate and deterministic fast-path results were executed against the exact source statements. Every scenario first creates live/permanent text. Only supported enrichment is listed after that.

### A. “Revenue is growing.”

```text
Speech
→ presentation thought: exact sentence
→ candidate gate: rejected; vague trend has no two literal anchors
→ visual elements: one settled text element
→ layout: next full-width row
→ lost: upward direction as geometry, magnitude, trend symbol, time axis
```

Dormant Reflex would recognize `trend` and render `Revenue ↑`, but V2 suppresses Reflex.

### B. “Revenue is growing, but our costs are growing even faster.”

```text
Speech
→ presentation thought: exact sentence
→ candidate gate: rejected; parser does not recover two stable comparison subjects/rows
→ visual elements: one settled text element
→ layout: next full-width row
→ lost: opposition, relative rate, two-series comparison, “faster” dominance
```

The word “but” alone is intentionally insufficient for active comparison. Dormant Reflex could emit a `⟷` glyph; dormant Artist/Director might form two concepts and a comparison if its concept matching succeeded.

### C. “We lost users because onboarding took too long.”

```text
Speech
→ presentation thought: exact sentence
→ cause parser sees causal grammar but rejects endpoint “We lost users”
   because its leading pronoun is treated as unresolved
→ model fallback is never called because candidate gate rejected
→ visual elements: one settled text element
→ layout: next full-width row
→ lost: ONBOARDING TOOK TOO LONG → LOST USERS
```

This is a concrete safety false negative: explicit causality exists, but endpoint materiality/resolution rules stop it locally.

### D. “At first InPublic was mostly drawing things, but over time it became much more text based.”

```text
Speech
→ presentation thought
→ candidate gate: rejected as temporal order, not supported causality
→ visual elements: one settled text element
→ layout: next full-width row
→ lost: before/after state, transformation, visual-to-text continuum
```

No active transformation or before/after qualitative schema exists.

### E. “The database sits between the API and the analytics system.”

```text
Speech
→ presentation thought
→ candidate gate: rejected; no supported spatial family
→ visual elements: one settled text element
→ layout: next full-width row
→ lost: API — DATABASE — ANALYTICS spatial topology and “between” relation
```

Legacy Artist could create three concept boxes and relationships, but its pen would initially place them in document order; there is no dedicated “between” action/layout. Story has relative spatial semantics, but is parked and object-oriented.

### F. “It feels like all these ideas are colliding in my head.”

```text
Speech
→ presentation thought
→ candidate gate: rejected; metaphor/reflection is explicitly text-only
→ visual elements: one settled text element
→ layout: next full-width row
→ lost: collision, clustering, tension, head/idea metaphor, emotion
```

This restraint prevents literalizing metaphors incorrectly, but guarantees no expressive response.

### G. “You speak, Deepgram transcribes it, we understand the meaning, and then InPublic turns that into visuals.”

```text
Speech
→ presentation thought
→ candidate gate: rejected; only one explicit “then” and causal parser classifies it as temporal
→ visual elements: one settled text element
→ layout: next full-width row
→ lost: four-stage pipeline and flow direction
```

The active sequence parser requires exceptionally explicit multiple step markers or process framing. Dormant Artist is specifically designed for this kind of relationship chain.

### H. “First we had speech recognition. Then we added structure. Then relationships. Then emphasis. Then live visual reasoning.”

```text
Speech
→ one or more settled thoughts combined in the sequence evidence window
→ candidate gate: sequence accepted
→ deterministic fast path extracts five steps
→ grounding passes if the provider segmentation preserves the phrases
→ visual elements: step numbers + step text + four downward arrows
→ layout: one appended vertical full-width sequence block
→ lost: cumulative layering/stacking; each capability is shown as order, not accumulation
```

The executed fast-path result was:

```text
01 Had speech recognition
02 Added structure
03 Relationships
04 Emphasis
05 Live visual reasoning
```

This is the only supplied scenario currently guaranteed to request a non-text-only enrichment from the exact wording.

### I. “The car drove toward the house and stopped beneath the tree.”

```text
Speech
→ presentation thought
→ candidate gate: rejected; object/action/spatial scene unsupported
→ visual elements: one settled text element
→ layout: next full-width row
→ lost: car, house, tree, movement, stop state, beneath relation
```

Parked Story Mode already understands car/house/tree, toward, stop, relative placement, movement arrows, and persistent state. This is the strongest example of semantic capability existing elsewhere but being completely unavailable to Standard.

### J. “The more freedom we give the visual system, the more expressive it becomes, but the harder it becomes to keep the canvas coherent.”

```text
Speech
→ presentation thought
→ candidate gate: rejected; correlative trade-off is not parsed as comparison or cause
→ visual elements: one settled text element
→ layout: next full-width row
→ lost: two opposing curves/forces, trade-off axis, freedom ↔ coherence tension
```

The sentence contains rich relational structure, but neither subject/value comparison nor explicit causal grammar matches the active schemas.

## 12. Sources of Visual Monotony

### Ranked causes

| Rank | Cause | Repository evidence | Effect |
|---:|---|---|---|
| 1 | Active vocabulary limitation | Five strict Visual Re-entry specs | Most meaning has no legal non-text representation |
| 2 | Active semantic limitation | `SettledThought` is text + provenance | Spatial/action/state/metaphor/hierarchy information never becomes structured data |
| 3 | Safety/fallback bias | Local terminal rejection, strict grounding, expected `none` | Unsupported or ambiguous thoughts remain text rather than risk false visuals |
| 4 | Planner limitation | V2 suppresses Beat/Artist/Director | General relationship and mutation planning is unreachable |
| 5 | Append-only layout | `place(..., fullWidth=true)` for live text and enrichment | Canvas grows like a document; semantics rarely affect global arrangement |
| 6 | Temporal limitation | Settled text/enrichment lack reusable semantic IDs | Later speech cannot evolve most prior content |
| 7 | Mostly textual enrichment design | Numbered text/matrices/value labels | Even “visual success” adds more words and linear structure |
| 8 | Attention/capacity constraints | safe placement, one in-flight decision, one visual/source, queue cap 3 | Rich/multiple visuals are intentionally throttled |
| 9 | Latency | model fallback and rendering wait behind speech | Can delay enrichment, but fast deterministic paths show latency is not the core coverage problem |
| 10 | Raw renderer limitation | Many primitives already exist | Least important broad cause; missing integration dominates |

### Semantic boredom versus visual boredom

The current system often understands enough to preserve the literal speech but not enough to choose an alternate visual abstraction. Its output is not random or broken; it is semantically conservative. The boredom comes from repeatedly applying the same truthful representation—full-width hand-lettered text—to semantically different clauses.

### Why boxes and textual structure dominated older Standard behavior

Even when the legacy chain is enabled, its schemas push toward labels and boxes:

- Scribe's vocabulary is seven text styles, box, icon, wave, link, underline.
- Artist's fundamental object is `Concept { label, kind }`, rendered as a labeled rectangle.
- Relationship meaning is a short string on an arrow.
- Director rearranges those same labeled rectangles.
- The icon library has only 20 names.
- No legacy Standard schema represents object pose, action, spatial relation, or visual metaphor.

Thus the old planner is broader than current production but still intrinsically “diagram of labeled concepts,” not “drawn visual thinking.”

## 13. Dormant / Underused Capabilities

### High-value dormant pieces

1. **Organizer adoption.** The system can recognize that a Scribe mark already on the page is the same concept the Artist wants, wrap it with a light reference box, and bind arrows to it rather than duplicate it. This is almost exactly the bridge needed to enrich live text without rewriting it (`lib/organizer.ts`; `lib/ops.ts:494-531`).

2. **Bound arrows with obstacle routing.** Relationships can attach to existing elements and reroute when nodes move. Live transcript rows can be soft obstacles (`lib/ops.ts:542-640`; `components/Board.tsx:3931-3998`).

3. **Director/Choreographer mutation.** Comparison and process act by moving existing content, not appending a duplicate diagram. This is the clearest dormant Standard precedent for canvas evolution.

4. **Semantic operation history.** Reversible operations already capture element patches, removed elements, semantic entities, relationships, and camera snapshots.

5. **Story persistent identity.** Story has stable entities, action/state transitions, relation upserts, visibility, transformation, and scene continuity.

6. **Procedural object recipes.** Generic vehicles, containers, structures, creatures, plants, and devices can be sketched without a model inventing geometry.

7. **Environment and effects.** Motion, direction, speed, sound, light, weather, and emotion primitives already exist as editable native shapes.

8. **Math visual architecture.** Math demonstrates a strong reusable pattern: model supplies symbolic values only; strict schema validates; deterministic renderer owns geometry; verifier guards correctness.

9. **Provisional rendering pattern.** Reflex and Story partials both support “cheap to be wrong” visuals with reduced opacity and later promotion/retraction.

### Dormant flags and code paths

- `features.reflex`, `features.directorV1`, and `features.choreographerComparison` are true but behaviorally dormant because V2 blocks their entrance.
- `features.storyMode` is false, parking the richest scene system.
- Math may be enabled in environment configuration, but is dormant because Beat is suppressed by V2.
- Scribe is configured on but never nudged in V2 Standard.
- `renderBeat`/Mermaid code remains in Board despite the current Artist action route no longer returning Mermaid.

This flag interaction is a major audit finding: code-level “enabled” does not imply runtime reachability.

### Information that dies before rendering

- Deepgram supplies word timing and confidence, but active semantic visuals use only thought text/provenance; prosody is not available.
- Presentation boundary decisions know continuation and completeness but do not feed importance or rhetorical structure forward.
- Visual Re-entry parsers often identify a meaningful rejection reason—dependency, temporal order, uncertainty, co-occurrence—but rejected category information is logged and discarded, not exposed as a weaker visual signal.
- Successful Visual Re-entry specs are not inserted into `SemanticBoard`, so later thoughts cannot refer to their nodes or rows.
- Legacy `Concept.kind` can distinguish problem/solution/input/process/output/person/product/goal, but V2 never populates those concepts.
- Story meaning is isolated from Standard rather than available as a shared vocabulary.

## 14. What Must Be Preserved

Any future expressive work risks damaging a carefully validated baseline.

### Protected properties

1. **Immediate speech response.** `writeLive` must remain model-free and first. This is the product's perceptual contract.

2. **Verbatim truthfulness.** Live text preserves what was said even when no abstraction is safe. Richer visuals must not silently replace nuance with an incorrect summary.

3. **Presentation thought stability.** V2/V3 coalesces provider finals into readable, non-popping blocks and caps them at 32 words. Changing visual intelligence should not reopen this segmentation problem.

4. **Text permanence under V2.** Settled text is currently the durable record. Removing it before an alternative proves sufficiently complete would create information loss.

5. **Grounding and fail-closed behavior.** Source evidence, modality preservation, numeric literal checks, and causal direction checks prevent visual hallucinations.

6. **One owner per source.** Existing arbitration prevents the same thought from producing competing or duplicate structures.

7. **No model coordinates.** Geometry is deterministic and testable. This protects coherence and prevents off-page/overlap failures.

8. **Camera restraint.** Live speech owns attention; quiet visual commits do not steal the shot; generic pause-driven overviews are removed.

9. **Page locality and readability.** Fixed pages, safe margins, capacity rules, and minimum readable zoom prevent an infinite shrinking canvas.

10. **User editability.** Native Excalidraw elements remain selectable/editable; rasterized AI images would reduce this property.

11. **Reversible state.** Operations and undo should remain precise, especially if mutation expands.

12. **Cost control.** The active gate prevents a model call for ordinary prose; deterministic fast paths handle observed supported cases.

13. **Long-session boundedness.** Transcript windows, checkpoint summaries, evidence caps, queue caps, and page limits prevent unbounded context and visual accumulation.

### Failure modes to avoid

- drawing every noun merely because an asset exists;
- treating metaphor as literal scene instruction;
- replacing all text with sketches;
- running a slow planner ahead of live ink;
- allowing two systems to move the same elements concurrently;
- letting a model own coordinates or arbitrary Excalidraw JSON;
- reviving the legacy Beat/Artist chain wholesale without reconciling it with V2 invariants;
- merging Story and Standard state models ad hoc;
- creating new appended diagrams when mutation of existing content would be clearer;
- producing visually richer but semantically unsupported content.

## 15. Possible Architectural Intervention Points

These are options for later investigation, not recommendations to implement now.

### Option A — Extend Visual Re-entry into a broader visual grammar

```text
settled thought
  ↓
expanded candidate/evidence layer
  ↓
strict symbolic visual union
  ↓
grounding
  ↓
deterministic renderers
```

Potential new families could include spatial relation, hierarchy, transformation/before-after, dependency, divergence/convergence, cycle, actor-action-object, or qualitative trend.

- **Hook:** `handleSettledVisualReentry` / `VisualReentryIntentSchema`.
- **Reuses:** settled-thought contract, evidence windows, fast path/model fallback, grounding, commit queue, camera policy, renderer architecture.
- **Latency:** low for deterministic families; model fallback remains asynchronous.
- **Complexity:** medium per family, rising with cross-family arbitration.
- **Risk:** lowest of the options if each family stays strict; can still become a growing pile of appended mini-diagrams.
- **Incremental:** yes.
- **Preserves reliability:** strongly.
- **Sketch use:** possible for a narrowly admitted `symbol/object` family using Story primitives, without Story Mode.

### Option B — Add a semantic interpretation layer before visual selection

```text
settled thought(s)
  ↓
shared semantic frame
  { entities, actions, relations, modality, time, emphasis }
  ↓
visual-language selector
  ↓
text / diagram / symbol / sketch / mutation
```

- **Hook:** after presentation settlement, before `evaluateVisualCandidate`.
- **Reuses:** Story event vocabulary, `SemanticBoard`, Visual Re-entry grounding/commit, Director patterns.
- **Latency:** semantic extraction must be local or asynchronous; live ink remains unaffected.
- **Complexity:** high because schema and identity reconciliation must be designed.
- **Risk:** medium-high; a shared semantic frame could over-normalize speech or introduce false certainty.
- **Incremental:** yes if first used only to shadow-log and then drive a small family set.
- **Preserves reliability:** yes if text remains baseline and semantics fail closed.
- **Sketch use:** strong; actor/action/object frames can select Story assets/procedural recipes.

### Option C — Reactivate a constrained semantic canvas editor downstream of V2

```text
fast live/settled text
  +
slower downstream planner
  ↓
adopt text as semantic concepts
  ↓
create/move/connect/group/update existing elements
```

This is not “turn Beat/Artist back on.” It would reuse the Organizer's adoption bridge and a constrained subset of `CanvasAction` after settled thoughts.

- **Hook:** settled-thought output, parallel to or replacing portions of Visual Re-entry.
- **Reuses:** `SemanticBoard`, Organizer, bound arrows, operation history, Director/Choreographer, existing actions.
- **Latency:** seconds are tolerable because live text is already visible; mutations must wait for safe windows.
- **Complexity:** high, especially mapping settled text elements to semantic IDs and completing visual update semantics.
- **Risk:** high; moving content can destabilize reading/camera and compete with manual edits.
- **Incremental:** possible through adoption-only → connect-only → limited choreography phases.
- **Preserves reliability:** possible with strict action budgets and undo, but requires extensive replay/browser testing.
- **Sketch use:** moderate; semantic concepts could attach icons/objects rather than default boxes.

### Option D — Extract Story's drawing vocabulary as a Standard renderer plugin

```text
visual decision: “this object/action is worth depicting”
  ↓
Story asset/procedural resolver
  ↓
native Excalidraw object + effects
  ↓
Standard page placement and identity adapter
```

- **Hook:** renderer layer after a new strict object/action visual spec.
- **Reuses:** prepared assets, procedural recipes, effects, relative placement, editable primitives.
- **Latency:** low; local deterministic rendering.
- **Complexity:** medium for drawing, high for identity/layout integration.
- **Risk:** medium; visual over-literalization and scene clutter are the main dangers.
- **Incremental:** yes, starting with a tiny admitted symbol/object set.
- **Preserves reliability:** yes if object visuals remain optional enrichments and use Standard safety/placement.
- **Sketch use without Story Mode:** this is the direct route; the Story user mode need not return.

### Comparative view

| Option | Expressive ceiling | Initial risk | Best existing reuse | Main weakness |
|---|---:|---:|---|---|
| A. Broader Visual Re-entry grammar | Medium-high | Low-medium | Active production pipeline | May remain append-only mini-diagrams |
| B. Shared semantic interpretation | High | Medium-high | Story semantics + grounding | New central abstraction required |
| C. Constrained semantic canvas editor | High | High | Organizer/SemanticBoard/Director | Mutation/camera/manual-edit coordination |
| D. Story vocabulary plugin | Medium | Medium | Assets/procedural sketches | Does not by itself decide when depiction is appropriate |

The options are composable. A is the safest surface; B supplies deeper meaning; C supplies evolution; D supplies expressive object vocabulary.

## 16. Multi-Level Visual System Feasibility

An implicit hierarchy already exists, but levels are split across mutually exclusive or dormant systems.

| Proposed level | Existing equivalent | Current reachability | Feasibility |
|---|---|---:|---|
| Level 0 — Live Ink | Deepgram interim → `writeLive` | Active | Already production-ready; protected baseline |
| Level 1 — Structure | titles/boxes/arrows/groups/sections; enumeration/comparison/etc. | Five Visual Re-entry forms active; broader Scribe/Artist forms dormant | High |
| Level 2 — Semantic Visuals | Visual Re-entry five families; math visuals; Director process/comparison | Narrow subset active | High if schemas remain symbolic/deterministic |
| Level 3 — Expressive Objects | icons; Story assets, procedural recipes, environments/effects | Dormant/parked | Technically high, product-policy work required |
| Level 4 — Canvas Evolution | live-line patching; legacy move/resize/highlight; Director choreography; Story entity mutation | Only live-line patching active | Architecturally possible, highest coordination risk |

### Where each level would naturally live

- **Level 0:** keep in `writeLive` and `lib/ops.ts`. Nothing semantic should enter this path.
- **Level 1:** active Visual Re-entry plus possibly a constrained semantic adoption layer. This is where title, grouping, relationship, and simple layout belong.
- **Level 2:** strict semantic visual specs and deterministic renderers, following the current Visual Re-entry and Math patterns.
- **Level 3:** an extracted, mode-agnostic Story vocabulary behind explicit depiction decisions—not noun extraction alone.
- **Level 4:** a semantic canvas state/operation layer with ownership, revision guards, cursor locks, undo, and safe mutation windows. `SemanticBoard` and Story state each supply part of this, but neither currently owns the active live-text canvas.

### Feasibility constraints

1. **Identity must become shared.** A settled text span, concept, visual node, and Story-style entity cannot remain separate unlinked identities if later speech is to mutate them.

2. **Ownership must be explicit.** Visual Re-entry already has thought claims; mutation requires element-level ownership so live ink, semantic planner, Story renderer, user edits, and camera do not fight.

3. **Levels must not all render.** Hierarchy should mean escalating representational choice, not adding five layers for every thought.

4. **Mutation needs stronger safety than append.** It must snapshot state, respect manual edits, reroute bindings, preserve camera coherence, and be undoable.

5. **A shared visual grammar is more important than a new model.** The repository already demonstrates deterministic renderers and model-free fast paths. A model cannot select a form the schema does not allow.

### Overall feasibility judgment

The architecture can support the proposed hierarchy without putting semantics on the live-ink critical path. Levels 0–2 are close to the current design. Level 3 has substantial reusable drawing code. Level 4 has promising precedents but needs a deliberate unified identity/operation model. The hierarchy does not exist as one system today; it exists as disconnected capabilities across active Visual Re-entry, dormant legacy Standard, Math, and parked Story.

## 17. Recommended Next Investigation

The single most useful next step is an **offline semantic coverage and representation audit over a natural-speech corpus**, before changing prompts or renderers.

For each settled thought, human-label:

- the meaning structures actually present (including none),
- the best visual language, if any,
- whether that visual should append, annotate, replace, or mutate,
- the minimum evidence required,
- whether a reusable renderer already exists in Standard, Math, icons, or Story.

Then run the current deterministic candidate/parser pipeline over the same thoughts and produce a confusion/coverage matrix:

```text
human visual category
× current accepted/rejected family
× existing renderer availability
× append vs mutation requirement
```

This would answer the most important unresolved quantitative question: not “how many visuals can we force,” but **which kinds of real spoken meaning are repeatedly left as text, at what frequency, and which missing families would unlock the most expressive value with the least risk**.

The ten scenarios in this audit already show the likely gap: only the explicitly marked sequence is admitted; trend, comparison, causality with pronouns, transformation, spatial topology, metaphor, object/action, and trade-off all remain text. A broader corpus would establish whether those are representative and rank the safest next family. It can be performed entirely offline with no production behavior change.

### Do not modify before that investigation

- `writeLive` ordering or model-free invariant,
- presentation thought-boundary policy,
- text permanence,
- current camera hold/reveal contract,
- source grounding and modality preservation,
- page/pen geometry,
- V2 suppression gates as a quick way to “get visuals back,”
- Story mode exposure,
- model selection.

The safest future work begins by measuring semantic coverage and choosing a missing visual grammar. It should not begin by tuning the existing prompt, adding a more capable model, or reactivating the entire legacy chain.
