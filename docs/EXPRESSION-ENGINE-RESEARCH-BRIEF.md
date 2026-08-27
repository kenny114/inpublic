# Expression Engine — options research

Grounded in `docs/EXPRESSION-ENGINE-FULL-AUDIT.md` (branch
`expression-engine-default`, HEAD `072e5c5`). Scope constraint taken as given:
**geometry and form stay deterministic and in-repo.** Models produce meaning;
sketches are decoration. Nothing below proposes "the LLM draws the canvas."

Every option is scored the same way: which audit bottleneck it moves,
estimated latency effect, risk to incremental patch / identity, build vs buy,
and a rank in one combined list at the end.

---

## 0. New measurement — the audit's biggest UNKNOWN is now known

The audit says the real live time budget is UNKNOWN and that the highest-value
next act is "one captured session, replayed offline, with a stopwatch on each
stage." A session log now exists —
`session-2026-08-22T12-14-05-024Z.json`, 137 s, `mode: "standard"`, 609 events,
24 settled thoughts. It carries `settledToUpdatedMs` on every
`expression/updated` and `expression/noop`, and `expression/rendered`
timestamps. That is enough to split the pipeline in two at the point where the
sketch call sits.

| Segment | What it covers | n | min | p50 | mean | p90 | max |
|---|---|---|---|---|---|---|---|
| settle → `updated` | 900 ms debounce + queue + **extract (Haiku)** + 9 deterministic layers | 11 | 3,141 | 6,448 | 6,787 | 10,846 | 13,380 |
| `updated` → `rendered` | **`resolveSketches` (Sonnet)** + `syncExpressionCanvas` + commit | 9 | 17,090 | 21,637 | 21,590 | 30,695 | 30,695 |
| settle → ink on canvas | the whole thing | 9 | 22,255 | ~28,000 | 28,211 | 33,978 | 33,978 |

Run-by-run:

| run | mode | settle→updated | updated→rendered | total | patch ops |
|---|---|---|---|---|---|
| 1 | full | 8,077 | 17,542 | 25,619 | 5 |
| 2 | patch | 3,141 | 30,695 | 33,836 | 10 |
| 3 | full | 10,846 | 23,132 | 33,978 | 16 |
| 4 | full | 3,679 | 18,576 | 22,255 | 17 |
| 5 | patch | 3,288 | 24,724 | 28,012 | 17 |
| 6 | patch | 4,197 | 19,124 | 23,321 | 23 |
| 7 | patch | 9,044 | 21,637 | 30,681 | 23 |
| 8 | patch | 13,380 | 17,090 | 30,470 | 17 |
| 9 | patch | 3,932 | 21,791 | 25,723 | 21 |

Four things follow, and they reorder the audit's own ranking:

1. **First structural ink landed at t = 34.2 s.** The first settled thought was
   at t = 6.2 s. The speaker had delivered eight settled thoughts before the
   canvas drew anything structural.
2. **The sketch phase is ~77% of the wall clock.** Run 1 has no predecessor to
   queue behind, so its 17.5 s is `resolveSketches` + sync alone. Bottleneck #1
   is not merely first in the audit's ranking — it is three quarters of the
   budget, and the proxy estimate (3.6–4.5 s from `LATENCY-AUDIT.md`) was ~4×
   too optimistic, because sketches fan out per *new* concept, cold, every
   session.
3. **The 900 ms debounce is noise.** It is 3.2% of the measured 28 s median.
   Audit bottleneck #5 should be re-read as "an un-instrumented model call is
   the floor" — the debounce itself is not worth touching yet.
4. **Preservation decayed 1.0 → 0.428 across 11 updates of a single-topic
   monologue** (1, 1, 1, .625, .593, .722, .779, .700, .708, .451, .428). No
   topic change occurred. That refines audit bottleneck #3: the page fills and
   crowds out meaning under *slot pressure alone*, so a topic-change eviction
   rule would not have saved this session. The eviction question and the budget
   question (`REGION_BUDGET = 8`) are separate, and only the second is
   implicated here.

Caveats, stated plainly: `settledToUpdatedMs` starts at submit and includes the
debounce; the `updated`→`rendered` gap from run 2 onward includes waiting behind
the previous run's sketches, because the controller serialises; and the sketch
library cache (`draw/library.ts`) is per-process, so this session was almost
certainly cold throughout. What is *not* in doubt: run 1's 17.5 s, and the
34.2 s to first ink.

Two facts verified in code while measuring, both relevant below:

- `EXTRACTION_SYSTEM_PROMPT` is **14,727 characters ≈ 3,700 tokens**, and
  `grep` finds **no `cache_control` anywhere in `lib/llm.ts`**. Every settled
  thought pays ~3.7k uncached input tokens. The minimum cacheable prefix is
  ~1024 tokens, so this qualifies with room to spare — and `streamAnthropic`
  already *reports* `cache_read_input_tokens` in usage, so the accounting half
  is built and reads zero.
- `lib/llm.ts` already has `completeStream()` with a working Anthropic SSE
  loop. `extract.ts:427` calls the non-streaming `complete()`. The transport for
  any streaming-extraction option already exists.

---

## A. Progressive / speculative UI for "structure now, detail later"

### A1 — Two-phase render: commit structure, then upgrade with sketches

Split `applyExpressionUpdate` (`components/Board.tsx:5713`) so
`syncExpressionCanvas` runs **without** sketches and commits, then
`resolveSketches` resolves in the background and a second commit dirties only
the nodes whose `sketchKey` resolved.

- **Bottleneck**: #1, directly. Also unblocks measurement for #2/#3.
- **Latency**: settle → first structural ink drops from a measured ~28 s median
  to `settle→updated` plus sync, i.e. **≈3–13 s, p50 ≈6.5 s**. Sketches arrive
  on their own schedule and no longer gate anything.
- **Risk**: low, and lower than it looks. `excalidrawSync` is a pure signature
  diff over idempotent conversion — a sketch landing later is exactly a
  signature change on one element, which is the operation the renderer is best
  at. Two real hazards: (a) the second commit must **not** call
  `revealVisualReentry`, or the camera will yank on decoration; (b) the second
  commit must be dropped if a newer run has already superseded the scene.
  Identity and patch semantics are untouched — this changes *when* elements are
  written, never *what* they are.
- **Build vs buy**: build. The comment at `Board.tsx:5815` names the exact
  reason the current order was chosen ("a sketch that arrives after the elements
  are written would not be drawn until some later sentence dirtied the same
  node") — the fix is to make the sketch arrival itself dirty the node, which is
  a few lines, not an architecture.

### A2 — Local placeholder glyph, upgraded in place

Phase 1 of A1 draws *something* in the sketchable slot rather than a bare shape:
a deterministic glyph from a local set, replaced by the Sonnet sketch when it
lands. Covered under E2 — it is the same change seen from the render side.

### A3 — Reserved "thinking" slot instead of speculative structure

Draw an honest empty region where the next node will go while extraction is in
flight, rather than guessing at structure. No re-flow of real ink, no wrong
claim on the canvas.

- **Bottleneck**: perceived latency only; does not move #1–#5.
- **Latency**: 0 real, meaningful perceived. The `canvas-expressing` pill and
  `ProductUI`'s "Expressing…" status already exist — this puts the same signal
  on the canvas, where the eye already is.
- **Risk**: very low. **Build vs buy**: build, small.

### A4 — Speculative pre-extraction ink (rejected for now)

Draw a guessed subject node from the settled thought's text before the model
returns, then correct it. This is the classic optimistic-UI pattern
(`useOptimistic`, speculative local rendering) and it is the wrong shape for
this product. The audit's own open question #12.6 says outright that nobody
knows whether early structure that later re-flows reads better than a slower
correct first frame; guessing the subject means reading label words, which the
engine deliberately refuses to do (`primitives/resolve.ts`); and a wrong
correction costs identity churn. Hold until A1 has shipped and first-frame
latency is 6 s rather than 28 s — at which point the question may be moot.

---

## B. Streaming / two-phase structured extraction

### B1 — Stream the extract call and parse partial JSON

Anthropic supports incremental structured output two ways: text streaming via
`content_block_delta` (already implemented in `completeStream`), and fine-grained
tool-input streaming via `eager_input_streaming: true` on a tool definition,
which emits `input_json_delta` events — not a beta, no header. Partial JSON is
then completed by any of several mature parsers
([`partial-json-parser-js`](https://github.com/promplate/partial-json-parser-js),
`llm-json-stream`, `gjp-4-gpt`).

- **Bottleneck**: #5 (observability), partially #4 (identity resolution can
  start on `entities[]` before `relations[]` closes).
- **Latency**: modest. Haiku 4.5 TTFT is ~0.6–1.0 s at ~90 tok/s; a typical
  delta is a few hundred tokens, so streaming recovers perhaps **0.5–1.5 s** of
  the 3–13 s `settle→updated` window.
- **Risk — and the important finding here**: folding an entities-only partial
  delta and composing from it would land the round in `scene`/`relationship`,
  because `classifyIntent` scores from relation families. That *worsens*
  bottleneck #2 — it manufactures exactly the mute-grammar rounds the audit is
  trying to eliminate. So: stream, but do not commit a scene until the relations
  array closes. Use the partial for identity pre-resolution and stage timing,
  not for drawing.
- **Build vs buy**: build (transport exists), buy the partial-JSON parser.

### B2 — Two-call split: fast "shape" call, background "detail" call

Call 1 asks for only what the deterministic layers actually consume: entity
`id`/`type`/`label`, `relations[]`, `topicEntityId`, `emphasisEntityIds`. Call 2
fills `description`, `attributes`, `metric`, `claims`, `interpretation` and
patches the world afterwards. `classifyIntent` reads relation families, path
lengths, containment, quantity and uncertainty — nothing in call 2's payload.
Claims never become boxes anyway (`buildAnnotations`), and `interpretation` is
log text.

- **Bottleneck**: #5 directly (cuts the blocking model term to roughly a third
  of its output tokens), #1 indirectly.
- **Latency**: output tokens dominate a Haiku call at ~90 tok/s. A shape-only
  delta is plausibly ~120 tokens against a current cap of 2000, so **~1.5–2.5 s
  saved** on the blocking path, with the rest landing as a patch.
- **Risk**: medium. Two extractions can disagree about ids — mitigate by passing
  call 1's ids into call 2 as fixed and rejecting any new id. A call 2 that
  arrives after a page turn must be dropped, same guard as A1's second commit.
- **Build vs buy**: build. Note this makes annotations and metrics *later*, so
  measure preservation on the frozen corpus before and after — annotations are
  part of what the evaluator scores.

### B3 — Structured outputs instead of brace-balancing

`extract.ts` currently extracts JSON by brace-balancing the completion text,
then `sanitizeDelta` + Zod. `output_config: {format: {...}}` on
`messages.create` constrains the response to the schema at the API level.

- **Bottleneck**: #4, and #5's silent-failure class. Today any parse failure
  resolves to `EMPTY_MEANING_DELTA` → `changed:false` → a `noop` that is
  indistinguishable in the log from "the speaker said nothing structural"
  (audit §8, unknown #4).
- **Latency**: ~neutral. **Risk**: low.
- **Build vs buy**: build, small. Pair it with a typed `noop` reason so the log
  can finally separate empty-delta from no-eligible-entity from
  grammar-found-nothing.

### B4 — Prompt-cache the extraction system prompt

~3,700 tokens of system prompt, resent uncached on every settled thought, with
zero `cache_control` in the codebase.

- **Bottleneck**: #5, plus cost.
- **Latency**: cached prefix reads are ~0.1× cost and cut prefill work; expect a
  modest TTFT improvement and a large cost reduction on a path that fires once
  per debounced batch regardless of content — greetings and filler included.
- **Risk**: near zero, provided the prompt stays byte-stable, which it is (a
  frozen constant — the ideal case). Verify with `usage.cache_read_input_tokens`,
  which `streamAnthropic` already surfaces and which currently reads 0.
- **Build vs buy**: build. One line plus a check.

---

## C. Small / local / fast models for tagging vs cloud Haiku for the full delta

### C1 — Keep Haiku 4.5, make it cheaper and observable (B2 + B3 + B4 stacked)

The honest baseline. Haiku 4.5 sits at ~0.6–1.0 s TTFT and ~90 tok/s, so nearly
all of the extract latency is output tokens: the highest-leverage change is
asking for fewer of them, not switching vendors.

- **Bottleneck**: #5. **Latency**: ~2–4 s off the blocking path when stacked.
- **Risk**: low. **Build**. **This is the recommended default.**

### C2 — Gemini 2.5 Flash-Lite for the shape call only

Flash-Lite benchmarks at ~0.29 s TTFT and ~390 tok/s — an order of magnitude
faster on exactly the profile B2's call 1 has (short output, single decision,
classification-shaped). The repo already supports it: `providerFor` routes any
model id starting `gemini`, `@google/genai ^2.16.0` is installed, and
`streamGoogle` exists.

- **Bottleneck**: #5. **Latency**: a ~120-token shape call at 390 tok/s with a
  0.29 s TTFT is **~0.6 s**, against ~2–3 s on Haiku.
- **Risk**: medium — quality on typed relation extraction against a persistent
  world is unmeasured, and a second provider joins the hot path (cost guard,
  failure modes, `EMPTY_MEANING_DELTA` fallback all need to hold). Mitigation is
  cheap and already built: A/B on the frozen 118-turn substrate
  (`expression-meeting-frozen-replay`), where input is deterministic and
  duplicate-cluster / preservation numbers are directly comparable.
- **Build vs buy**: buy the model, build the A/B. Gate behind an
  `EXPRESSION_SHAPE_MODEL` env var so it is one line to revert.

### C3 — Groq / Cerebras hosting an open model for relation tagging

Sub-100 ms TTFT and 1,200–2,000 tok/s on small open models — genuinely the
fastest option on the market.

- **Bottleneck**: #5. **Latency**: best-in-class on paper.
- **Risk**: high relative to payoff *right now*. New vendor, new provider
  adapter, new cost-guard integration, new rate card, and an entirely new
  quality baseline for the most correctness-sensitive call in the system — to
  win perhaps 0.5 s over C2, inside a budget whose dominant term (17–30 s) is
  not the extract call at all.
- **Recommendation**: **hold** until A1 has landed and the extract call is
  actually the critical path.

### C4 — Local / browser inference (transformers.js, WebGPU/WASM)

The repo has zero local inference today. For short inputs, browser NER runs at
~8–12 ms (WASM) to ~15–25 ms (WebGPU) — effectively free.

- **Bottleneck**: #4 in principle. **Latency**: ~0.
- **Risk**: high. NER is not what this system needs: it needs typed entities
  *plus* 22 relation types *plus* consistency with an accumulated world. A
  browser NER model produces a different, weaker signal, and you would own a
  model pipeline forever.
- **The cheaper fix for #4, which needs no model at all**: pass the world's
  existing entity ids **and their types** back into the extraction prompt as a
  "referents already known" block. The dominant remaining duplication source is
  the same referent extracted `object` then `action`/`event`/`state`
  (Hardening #2 — 3 of 4 clusters). The extractor is currently told to
  re-declare earlier entities but never told what type it previously gave them.
  Anchoring it costs a few dozen tokens (cached, per B4) and attacks the root,
  where `ROLE_BRIDGE` is — as the audit correctly says — mitigation.
- **Recommendation**: skip C4; do the type-anchoring instead.

---

## D. Systems that separate semantic graph from layout — ideas only

**[Penrose](https://penrose.cs.cmu.edu/media/Penrose_SIGGRAPH2020a.pdf)
(SUBSTANCE / STYLE / DOMAIN).** Substance states objects and relations with no
visual detail; Style encodes how to realise them; Domain declares what the
relations even are. That split is the one InPublic already has —
`MeaningDelta` is Substance, the ten grammars are Style — which is itself a
useful result: the architecture the audit calls "not the problem" has an
independent research pedigree.

- **Worth borrowing**: the Domain layer as an explicit artefact. InPublic's
  `GRAMMAR_FOR_INTENT` chain encodes "which style may fire" implicitly, in a
  table. Making it explicit is what would let a grammar declare *preconditions*
  it needs from the world, rather than being tried and then discovered to
  produce zero regions.
- **Not worth borrowing**: numerically optimised layout. Penrose re-solves
  positions per diagram. InPublic's product value is that a node stays where it
  was across turns (`anchorToPrevious`, ~5 px residual), and optimisation-based
  layout destroys that. **Explicitly reject ELK / dagre / Graphviz** for the
  same reason: they reflow globally and would break incremental patch, one of
  the few capabilities the audit lists as done.

**[Bluefish](https://vis.csail.mit.edu/pubs/bluefish/) (UIST 2024) —
declarative relations over a compound scenegraph.** A relation does not own its
children nor fully specify their layout; several relations co-constrain the same
marks.

- **Worth borrowing, and this is the strongest idea in section D**: it is a
  direct answer to bottleneck #2. Today a round with weak structure picks *one*
  grammar, and `relationship` wins by exhaustion, producing anonymous nodes. A
  Bluefish-shaped fallback would instead apply the several partial relations the
  world *does* have — one containment, one contrast, one ordering — each
  constraining part of the layout, none needing to be a complete grammar.
  Disfluent speech produces exactly that: fragments of structure, not one clean
  shape.
- **Risk**: real. Multiple partial constraints interacting is a new class of
  layout bug, and it touches `compose` — the one stage whose failure-mode column
  currently reads "none observed." Prototype against the 122-case corpus before
  it goes anywhere near live.
- **Build vs buy**: idea only. Do not take the dependency — it is a TypeScript
  DSL with its own scenegraph, and InPublic renders Excalidraw elements with
  stable ids.

---

## E. Sketch / icon pipelines that don't block primary ink

### E1 — The ordering fix

This is A1. It is the whole answer to "don't block primary ink"; everything else
in E is about making the decoration itself cheaper and better.

### E2 — Retrieved glyph as the placeholder, generated sketch as the upgrade

[Iconify](https://github.com/iconify/icon-sets) ships ~300k icons across 200+
open sets, installable offline as `@iconify-json/*` packages or self-hostable. A
deterministic lookup keyed on the *existing* `sketchKey`
(`${entityType}:${slug(label)}`, assigned in `primitives/resolve.ts:withSketch`
**after** the primitive is chosen) gives phase 1 of A1 something to draw in
~0 ms.

- **Bottleneck**: #1, the perceptual half. **Latency**: a local map lookup.
- **Risk**: aesthetic, not technical. A UI icon set does not look hand-drawn,
  and hand-drawn is the product's identity. Mitigate by using it strictly as the
  placeholder that the Sonnet sketch replaces — precisely what A1's two-phase
  commit makes possible. Note it introduces **no new label coupling**: the
  sketch key is already label-derived and already computed at this exact point.
- **Build vs buy**: buy the icon data, build the lookup.

### E3 — Persist and prewarm the sketch cache

`draw/library.ts` caches per server process and loses everything on restart; the
client cache is a `Map` on the Board and dies with the tab. Meanwhile
`activeTerms()` (`Board.tsx:5523`) already assembles ≤40 likely terms **at
socket-open time, before anyone speaks**.

- **Bottleneck**: #1. **Latency**: converts most sketch resolutions into cache
  hits, and spends the Sonnet calls during silence instead of during speech —
  the only genuinely *speculative* move in this brief that carries no
  correctness risk.
- **Risk**: low. Cost is bounded by the ≤40-term list and, if persisted, paid
  once per term ever.
- **Build vs buy**: build (disk or KV behind `library.ts`), plus a prewarm call
  where keyterms are already computed.

### E4 — Fix the stroke-count contradiction and the cost reservation

`SKETCH_SYSTEM` asks for "40-100+" strokes with cross-hatched shading;
`SketchSchema` allows 120; `sketchLooksAbstract` (`lib/expression/draw/schemas.ts:42`)
discards anything over **70**, and anything where >70% of strokes are shorter
than 10 units — which is what cross-hatching *is*. Separately `/api/sketch`
reserves `maxOutputTokens: 800` while `drawSketch` requests 6000.

- **Bottleneck**: #1's cost and quality, invisibly. Today the better the model
  follows the prompt, the likelier its output is thrown away — and **no event
  fires on rejection**, so this is unmeasurable in production.
- **Latency**: none directly. But every discarded sketch is a full Sonnet call
  paid for and wasted, and under A1 it becomes a node that never upgrades.
- **Risk**: none to correctness. **Build**, trivial: raise the gate to the
  schema's 120, log every rejection with its reason, reconcile 800 vs 6000.

---

## Combined ranking

Ordered by (bottleneck moved × confidence) ÷ effort. Bottleneck numbers are the
audit's §10 ranking.

| # | Option | Bottleneck | Latency effect | Risk to patch/identity | Build/buy | Effort |
|---|---|---|---|---|---|---|
| **R0** | `latency.observe` around `extract`, `resolveSketches`, `syncExpressionCanvas`; log sketch hit/miss/reject | #5 | none | none | build | hours |
| **R1** | **A1 — two-phase render, structure commits before sketches** | **#1** | **~28 s → ~6.5 s p50 to first ink** | low (suppress camera + supersession guard on commit 2) | build | days |
| **R2** | E2 — retrieved glyph placeholder, sketch upgrades in place | #1 | ~0 ms phase-1 decoration | none (reuses existing `sketchKey`) | buy data / build lookup | days |
| **R3** | B4 + B3 — prompt-cache the 3.7k-token system prompt; structured outputs + typed `noop` reason | #5, #4 | small TTFT win, large cost win, ends silent parse failures | none | build | hours |
| **R4** | C4-alternative — feed known entity ids **and their types** back into the extract prompt | **#4** | none (cached tokens) | low; attacks the root of type-family splits | build | days |
| **R5** | E3 — persist + prewarm the sketch cache from `activeTerms()` | #1 | most sketches become hits; cost moves into silence | low | build | days |
| **R6** | E4 — raise the 70-stroke gate to 120, log rejections, fix 800/6000 reservation | #1 | none; recovers wasted Sonnet calls | none | build | hours |
| **R7** | B2 (+ C2) — shape/detail split, optionally Flash-Lite on the shape call | #5 | ~1.5–2.5 s (B2), ~2–3 s more (C2) | medium — id agreement across two calls; annotations land later | build + buy | 1–2 wks |
| **R8** | B1 — stream extraction; partial-JSON parse for identity pre-resolution and stage timing **only** | #5, #4 | 0.5–1.5 s | medium — *must not* compose from a partial delta, or #2 gets worse | build + buy parser | 1 wk |
| **R9** | D / Bluefish — co-constraining partial relations as the fallback instead of `relationship` | **#2** | none | high — touches `compose`; prototype on the 122-case corpus first | idea only | weeks |
| **R10** | A3 — reserved "thinking" region on the canvas | perceived | none real | very low | build | days |
| **R11** | Adaptive debounce (900 ms → ~350 ms when the queue is empty) | #5 | ~0.5 s | low, but costs coalescing | build | days |
| — | **Hold**: C3 (Groq/Cerebras), C4 (browser models), A4 (speculative pre-extraction ink), ELK/dagre/Graphviz layout | — | — | — | — | — |

### Sequencing

**Now, one commit:** R0 + R1 + R6. R0 makes R1's win provable; R6 lives in the
same files. This is the only change on the list that moves the number that
matters — 28 s to first ink — and it moves it by roughly 4×.

**Next:** R2 + R3 + R5. All low-risk, all independent of each other, and R5's
prewarm only pays off once R1 has stopped the sketch call from blocking.

**Then, measured on the frozen corpus rather than live:** R4, then R7. R4 first,
because type-splitting inflates the world and therefore contaminates any
measurement of R7.

**Research, not roadmap:** R9. It is the only serious answer to bottleneck #2 in
this brief, and it is the one that could break `compose`.

### What this brief deliberately does not recommend

- Text-to-Excalidraw end to end, free-form model drawing, or replacing grammars
  — out of scope by the brief.
- Any external layout engine. Global reflow is incompatible with
  `anchorToPrevious`, which currently works.
- Agent / MCP expansion. The audit lists agent parity as done and MCP-live as
  unverified; neither is on the critical path to a live human take.
- Touching the 900 ms debounce before R1 ships. At 3.2% of the measured budget,
  it is not where the time is.

### Still unknown after this brief

1. **Extract vs identity inside the 3.1–13.4 s window.** R0 answers this.
2. **Sketch vs sync inside the 17–30 s window**, and the sketch cache hit rate.
   R0 answers this too.
3. **Whether `REGION_BUDGET = 8` is right.** The 1.0 → 0.428 preservation decay
   in a 137-second single-topic monologue is slot pressure with no topic change
   to blame. The audit's unknown #9 ("never varied experimentally") is now the
   live question behind bottleneck #3, and one frozen-corpus sweep over
   budget ∈ {8, 10, 12} would answer it.
4. **Whether early structure that re-flows reads better than a slower correct
   frame** (audit #12.6). R1 makes this testable for the first time, because
   until now there was no early frame to judge.

---

## Sources

- [Penrose: From Mathematical Notation to Beautiful Diagrams (SIGGRAPH 2020)](https://penrose.cs.cmu.edu/media/Penrose_SIGGRAPH2020a.pdf)
- [SUBSTANCE and STYLE: domain-specific languages for mathematical diagrams](https://www.cs.cmu.edu/~kqy/resources/Penrose_DSLDI.pdf)
- [Bluefish: Composing Diagrams with Declarative Relations (UIST 2024)](https://vis.csail.mit.edu/pubs/bluefish/)
- [partial-json-parser-js](https://github.com/promplate/partial-json-parser-js) · [llm-json-stream](https://www.npmjs.com/package/llm-json-stream) · [gjp-4-gpt](https://github.com/JacksonKearl/gjp-4-gpt)
- [Iconify icon-sets (200+ sets, ~300k icons)](https://github.com/iconify/icon-sets) · [Iconify offline icon data](https://iconify.design/docs/icons/icon-data.html)
- [Claude 4.5 Haiku provider benchmarks — Artificial Analysis](https://artificialanalysis.ai/models/claude-4-5-haiku/providers)
- [Gemini 2.5 Flash-Lite performance analysis — Artificial Analysis](https://artificialanalysis.ai/models/gemini-2-5-flash-lite)
- [Groq vs Cerebras inference speed comparison 2026](https://speko.ai/benchmark/groq-vs-cerebras)
- [Transformers.js WebGPU guide](https://huggingface.co/docs/transformers.js/en/guides/webgpu) · [WebGPU vs WASM browser inference benchmarks](https://www.sitepoint.com/webgpu-vs-webasm-transformers-js/)
- [Optimistic UI patterns — Simon Hearne](https://simonhearne.com/2021/optimistic-ui-patterns/) · [Speculative loading — MDN](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Speculative_loading)
