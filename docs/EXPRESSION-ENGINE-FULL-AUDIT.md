# Expression Engine — full system audit

Read-only. No fixes, no refactors, no stack proposals. This is the ground
truth as the code stands on branch `expression-engine-default`
(HEAD `072e5c5`, 2026-08-22), plus every measurement that already exists in
`docs/` and `scripts/`.

**North star this is measured against:** while a human (or an agent) speaks,
the *structure of the meaning* appears as visual argument — causal chain,
comparison, hierarchy, process, tension. Captions are secondary. Agents use
the same path.

Where a number does not exist, it says **UNKNOWN** and how to get it.

---

## 1. Architecture map (as-built)

```
                                   ┌─ Tier 1 (never blocked) ────────────────────────────┐
mic ─80ms PCM─► Deepgram nova-3 ──►│ interim/final ──► correctTranscript ──► writeLive    │──► caption ink (1–6 ms)
   (WSS, browser)                  │  (lib/vocab.ts)     (Board.tsx:2840)                 │    right rail, opacity 72/48/22
   endpointing 150                 └─────────────────────────────────────────────────────┘
   utterance_end_ms 1000 (never subscribed)
        │
        │ final only
        ▼
  pushPresentationSegment           lib/liveSpeech.ts:381        SYNC, deterministic, no model
   ├ stable_clause | completed_prefix | terminal_complete
   ├ safety split at MAX_PRESENTATION_WORDS = 32
   └ hold ceiling MAX_PRESENTATION_HOLD_MS = 4000
        │  SettledThought { id, text, sourceSegments, sourceRegion, ... }
        ▼
  handleSettledExpression           components/Board.tsx:5896    logs expression/submitted, marks pending
        ▼
  ExpressionLiveController.submit   lib/expression/live.ts       DEBOUNCE 900 ms · SERIALISE (1 in flight) · COALESCE burst into one segment
        ▼
  ExpressionSession.ingest          lib/expression/pipeline.ts:ingest / ingestDelta
        │
        ├─(1) extract  ──► requestMeaningDelta ──► POST /api/express ──► extractMeaning       ASYNC · MODEL (Haiku) · BLOCKING
        │                  lib/expression/meaning/client.ts        lib/expression/meaning/extract.ts
        ├─(2) identity  ── resolveEntityIdentity per mentioned entity                          async signature, deterministic in prod (judge abstains)
        ├─(3) references ─ precomputeReferences                                                SKIPPED live (targetJudge abstains)
        ├─(4) world fold  applyDelta                              lib/expression/world/apply.ts        SYNC
        ├─(5) intent      classifyIntent                          lib/expression/intent/classify.ts    SYNC, never reads words
        ├─(6) visibility  assignVisibility                        lib/expression/planner/visibility.ts SYNC
        ├─(7) plan        planExpression (grammar chain + attachRelatedEntities + emphasis + annotations)  SYNC
        ├─(8) compose     compose (+ anchorToPrevious)            lib/expression/compose/compose.ts    SYNC
        ├─(9) evaluate    evaluateScene → planRepair → applyRepair (kept only if it scored better)       SYNC
        └─(10) diff       diffScenes → RenderPatch                                                      SYNC
        │  ExpressionTrace (every stage preserved)
        ▼
  applyExpressionUpdate             components/Board.tsx:5713
        ├─ log expression/updated (intent, grammar, mode, preservation, problems, settledToUpdatedMs)
        ├─ ?debug=1 → stop here, no canvas write
        ├─ await resolveSketches ──► POST /api/sketch (per new sketchKey) ──► drawSketch   ASYNC · MODEL (Sonnet, 6000 tok) · BLOCKING
        ├─ await syncExpressionCanvas (dynamic import @excalidraw/excalidraw, signature diff, onOverflow → decideExpressionOverflow → turnPage)
        ├─ recordOperation("expression_engine") + commit()  → Excalidraw updateScene
        ├─ revealVisualReentry(bounds of ADDED ids) → framePage only if the new ink does not fit
        ├─ demoteLiveCaptions() → captions drop to opacity 22
        └─ fadeConsumedTranscript(consumedIds)
```

### Stage table

| Stage | Entry file / function | Sync? | Blocks next stage | Failure modes |
|---|---|---|---|---|
| STT | `hooks/useDeepgram.ts` (nova-3, `interim_results`, `endpointing:150`) | async stream | yes for finals | socket drop → reconnect; `UtteranceEnd` never subscribed |
| Thought boundary | `lib/liveSpeech.ts:pushPresentationSegment` | sync | yes — nothing reaches the engine until a thought emits | held text is invisible; ceiling 4 s guarantees emission |
| Cadence | `lib/expression/live.ts:ExpressionLiveController` | async | yes — 900 ms debounce, one run at a time | buffer flushes on completion; `reset()` settles waiters as `failed` |
| Meaning | `meaning/client.ts` → `/api/express` → `extract.ts` | async, **model** | yes | any failure → `EMPTY_MEANING_DELTA` → `changed:false` → **noop** (silent by design) |
| Identity | `world/identity.ts` (+`identityJudge.ts`) | async sig. | yes | judge abstains live → `hold` → new entity minted |
| World fold | `world/apply.ts:applyDelta` | sync | yes | unresolved pointers abstain rather than mutate |
| Intent | `intent/classify.ts` | sync | yes | weak evidence → `express_uncertainty` |
| Plan | `planner/plan.ts` | sync | yes | `ExpressionPlanSchema` reject → fallback reason string (eval #1 bug, fixed) |
| Compose | `compose/compose.ts` | sync | yes | none observed |
| Evaluate/repair | `evaluate/evaluate.ts`, `repair.ts` | sync | yes | repair kept only if score improved |
| Sketch | `draw/client.ts` → `/api/sketch` → `draw/agent.ts` | async, **model** | **yes — awaited before any canvas write** | fails soft to plain shape; still costs the wait |
| Render | `render/excalidrawSync.ts` + `render/excalidraw.ts` | async (dyn import) | yes | `skipped` reason logged as `expression/failed` |
| Camera | `Board.tsx:revealVisualReentry` → `framePage` | sync | — | only ADDED ink pulls the camera |

### What keyterms actually do

**STT bias only.** `activeTerms()` (`Board.tsx:5523`) builds a ≤40-term list
from section titles + board concepts + canvas marks + `NEXT_PUBLIC_KEYTERMS`
+ `SEED_TERMS`, and it is passed to Deepgram at socket-open time
(`useDeepgram.ts:686`, `keyterm:` repeated). The same vocabulary also feeds
`correctTranscript` (`lib/vocab.ts`), which rewrites known mishearings before
the text is logged or settled.

**No expression path reads keyterms.** `grep` over `lib/expression/**` returns
zero hits: the primitive chooser explicitly refuses to look at label wording
(`primitives/resolve.ts` docstring), and the only label-derived value in the
engine is the sketch *cache key* — computed after the primitive was already
chosen by type. Keyterms are also fixed at connection time, so terms the
engine discovers mid-take never reach the recogniser in that take.

### Agent entrypoints, and whether the world is shared

| Surface | File | Shares the speech world? |
|---|---|---|
| `express({text})` / `express({delta})` | `lib/expression/entry.ts` | **Yes** — facade over the same `ExpressionLiveController` |
| `express_meaning` tool (name/description/schema) | `lib/expression/tool.ts` | Yes — `tool.call → entry.express → controller.express` |
| MCP stdio server + loopback queue `:3212` | `scripts/express-mcp-server.mjs` | Yes, via the page |
| Browser-side bridge poller (`?agent=1`) | `lib/expression/agentBridge.ts` | Yes |
| `window.inpublic.express/tool` | `Board.tsx` | Yes |

One world, one debounce, one canvas. `InputSegment.source = "ai_agent"` is the
only difference below the segment, and nothing downstream reads it.

---

## 2. Latency & timing audit

### Measured / constant

| Metric | How measured | Value |
|---|---|---|
| PCM chunking | `useDeepgram.ts` worklet | 80 ms frames |
| Deepgram endpointing | config | 150 ms (`utterance_end_ms:1000` configured but unsubscribed) |
| Speech onset → first caption ink | `latency.observe("speech_onset_to_raw_interim")` + `writeLive` timing | interim lag instrumented per session but **never aggregated**; `writeLive` ink itself **1–6 ms** (29 ms first call) — `LATENCY-AUDIT.md` |
| Final → settled thought | deterministic policy | 0 ms when the final closes a clause; otherwise up to **4000 ms** (`MAX_PRESENTATION_HOLD_MS`) |
| Settled → run starts | `ExpressionLiveController` | **900 ms** debounce, plus queueing behind any in-flight run |
| Deterministic pipeline (fold→intent→plan→compose→evaluate→diff) | agent structured-delta live check, `AGENT-ENTRY-REPORT` | **917 ms end-to-end of which 900 ms was debounce ⇒ ≈17 ms of engine** |
| Whole 122-case corpus through 9 deterministic layers | `scripts/expression-test.mjs` | "under a second" (corpus docstring) — i.e. single-digit ms/turn |
| `settledToUpdatedMs` / `settled_to_expression` | `Board.tsx:5885` `latency.observe`, and every `expression/*` log line | instrumented, **never aggregated across sessions** — no p50/p95 exists |
| Extract model call | — | **UNKNOWN.** Proxy: `/api/scribe` (same Haiku, similar size) measured **760 / 833 / 928 ms** warm, 3205 ms cold (`LATENCY-AUDIT.md`) |
| Sketch resolve | — | **UNKNOWN.** Proxy: `/api/artist` (same Sonnet tier) **3616 / 4353 / 4517 ms** (`LATENCY-AUDIT.md`); this call asks for up to 6000 tokens of coordinates |
| Page-turn cadence (proxy for churn) | eval logs | one every **8–10 s** (eval #1), one every **6.5 s**, min 2.6 s (eval #2) |

`LATENCY-AUDIT.md` predates the Expression Engine — its Scribe/Beat/Artist
numbers are the right *models on the right routes*, but not this pipeline's
prompts. Treat them as order-of-magnitude proxies, explicitly.

### Every await on the critical path, settle → first node on canvas

1. `setTimeout(debounceMs = 900)` — `live.ts:schedule`
2. `await this.extract(...)` → `fetch /api/express` → Anthropic Haiku (2000 max tokens, temp 0) — **network + model**
   - in dev only, a preceding `fetch /api/dev/replay-authorization` (compiled out in production)
3. `await resolveEntityIdentity(...)` × mentioned entities — deterministic in production (judge abstains, no network)
4. `await this.precomputeReferences(...)` — returns immediately live (target judge abstains)
5. `await this.judgePendingDiscourseActs(...)` — returns immediately live
6. `await resolveSketches(...)` → `fetch /api/sketch` × distinct new sketchKeys, in parallel → Anthropic Sonnet (6000 max tokens) — **network + model, blocking the canvas write**
7. `await syncExpressionCanvas(...)` → `await import("@excalidraw/excalidraw")` (first call only) + element conversion
8. `commit()` → Excalidraw `updateScene`

Steps 4–5 are free today only because both judges default to abstain. Turning
either on adds a second and third model call inside the same blocking run.

### Progressive ink today? **No.**

Blocked in two independent places:

- **Contract**: `onUpdate` fires exactly once per run, with a finished
  `ExpressionTrace`. There is no partial-scene event, and `applyExpressionUpdate`
  is the only writer.
- **Order**: `Board.tsx:5821` awaits `resolveSketches` *before*
  `syncExpressionCanvas`, deliberately ("a sketch that arrives after the
  elements are written would not be drawn until some later sentence dirtied
  the same node"). So structure waits on decoration.

The stroke-by-stroke reveal that exists (`lib/expression/render/svg.ts`
`pathLength="1"` + staggered `animation-delay`, CSS in
`app/dev/express/express.css`) is **SVG-lab only**. The live Excalidraw path
writes all strokes as static line elements in one commit.

---

## 3. Meaning layer audit

`MeaningDelta` (`lib/expression/schemas.ts`, enforced by `MeaningDeltaSchema`,
`.strict()` at every level):

- `entities[]` — `id` (local slug), `type` ∈ {person, group, place, object,
  concept, action, event, state, time, quantity}, `label` (1–4 words, ≤60
  chars), `description`, `quantity{value,unit}`, `attributes[]`,
  `metric{unit, currency, points[], target, direction, changePercent}`
- `relations[]` — 22 types: `causes, enables, prevents, depends_on, precedes,
  transforms_into, contains, part_of, member_of, instance_of, has_property,
  role_of, originates_from, located_at, contrasts_with, greater_than,
  less_than, equivalent_to, supports, refutes, relates_to` + `role`,
  `spatial`, `magnitude`, `step`
- `claims[]` — free text + `about[]` + `uncertain` + `stance{agrees|disagrees, targetSurface}`
- `topicEntityId`, `emphasisEntityIds[]`, `supersededMentions[]`
- `referenceMentions[]` — `ordinal` | `topic_recall`, with grammar-only fields
  (`ordinalIndex/FromEnd/Other`, `topicHint`, `speakerHint`)
- `discourseActs[]` — `reject | suspend | deemphasize | invalidate | supersede | reactivate` + `targetSurface`
- `interpretation` — one sentence

**No geometry field exists anywhere in the schema.** That is the enforcement,
not the prompt.

### What the prompt demands vs what it misses

The prompt (`extract.ts:EXTRACTION_SYSTEM_PROMPT`) is long and unusually
specific: re-declare an earlier entity when a relation needs it; compare like
with like; attach dimensions with `has_property`; never merge or split
entities; filler → empty arrays. Post-hoc repair (`sanitizeDelta`) slugs ids,
drops relations with missing endpoints, and blocks `precedes` on
person/group/place (a real live failure: "Priya joined last month" became a
three-step chain that then pinned the classifier to `show_sequence`).

Observed misses, from the reports:

| Miss | Evidence |
|---|---|
| **Type inconsistency across turns** — the same referent extracted as `object` then `action`/`event`/`state` | Identity Hardening #2: 3 of 4 duplicate clusters; partially mitigated by `ROLE_BRIDGE` (type-reconciliation pass) |
| Entities stated in a doc but never spoken as entities never enter the world | Target-resolution R4/R5 (`annual discount`) |
| Anaphoric fragments become durable entities ("trying") | Live eval #2: `attached trying` on 25 consecutive turns |
| Extraction is non-deterministic turn to turn even at temp 0 | Hardening #2 explicitly: two live 118-turn runs are not comparable; motivated the frozen fixture |

### structure_type / grammar / intent — derived, never model-emitted

`classifyIntent` is deterministic and **blind to the transcript**: it scores
14 intents from relation families, longest causal/temporal path, containment
groups, quantity/metric presence and uncertainty count, with a documented
tie-break priority list. The grammar then comes from
`GRAMMAR_FOR_INTENT[intent]` walked as a fallback chain ending at
`relationship`, which can express any non-empty world. The model has no vote.

### Incomplete utterances, greetings, fragments

They **do** hit the full extract call: the only gates are `!text.trim()` in
`extractMeaning` and `!input.text.trim()` in `enqueue`. Cost is one Haiku call
(≤2000 output tokens) per debounced batch regardless of content. Coalescing
means a burst is one call, not one per clause. The prompt instructs filler to
return empty arrays; an empty delta ⇒ `ops.length === 0` ⇒ `changed:false` ⇒
`noop`.

### Confidence / abstain paths

- Entity/relation `confidence: "low"` survives into `WorldState` and reaches
  `SceneObject.tentative` → dashed + opacity 60 (added after the gap analysis
  flagged it missing).
- Identity: `create` | `merge` | **`hold`** (judge asked, could not tell).
- References/discourse acts: abstain rather than mutate; unresolved pointers
  are still recorded in the trace.
- Repair: applied only if `semanticPreservation` improved or problem cost fell.

### Top failure patterns (from tests + session logs)

1. `missing_entity` / `preservation: 0` bursts — 14/36 updates in eval #2 (39%,
   the entire back third), 14/45 in eval #3 (31%); 64% of eval-#3 updates
   scored < 0.05.
2. `clutter` from stale re-attachment — eval #1 finding #5, preservation decay
   0.802 → 0.365 over one minute.
3. Identity duplication minting a 2–3× oversized world — meeting stress: 142
   entities for a meeting whose canvas holds 10.
4. `noop` on genuinely contentful but structureless openers ("I just wanna
   talk about my experience") — eval #1 finding #7.
5. `express_uncertainty` lock-in: 25 consecutive turns on one intent in eval #2.

---

## 4. Identity & world audit

- **Assignment/merge**: `lib/expression/world/identity.ts` (662 lines), a
  two-stage layer. Stage 1 is deterministic — hyphen-split + stemmed tokens,
  token-set equality / shared 2-token core, phrase-head anaphora, alias and
  description overlap, `typesCompatible()` as a hard gate with an explicit
  `ROLE_BRIDGE` for object↔action / object↔event / object↔state /
  group↔quantity. Topic/relation/claim signals are **bonus-only** and no
  longer grant eligibility. Stage 2 is `identityJudge.ts`, consulted only on
  ties, returning `same_entity | related_but_distinct | new_entity | uncertain`.
  Callers: `pipeline.ts:resolveIdentities` (pre-pass, decisions handed to
  `applyDelta` so apply never re-decides).
- **Live path**: `enableIdentityLayer: true` (`Board.tsx:863`) — **stage 1 on**.
  `identityJudge` and `targetJudge` are **left at their abstain defaults**, so
  the live board never pays a second model call, and every tie becomes `hold`
  → a new entity.
- **Known residue**: object-vs-action (and object/event/state) type splits for
  the same referent — the dominant remaining duplication source; `InPublic-N`
  style suffix ids when a hold mints a sibling; borderline merges named
  honestly in Hardening #2 ("step four" → "biggest drop-off point").

### Latest numbers

Frozen 118-turn meeting (`meeting-transcript-deltas-v1.mjs`, deterministic input):

| Metric | Identity off | Identity v1 (stage 1, abstain judge) | Latest frozen substrate |
|---|---|---|---|
| World entities | 121 (live 119) | 107 (live 105) | 97–98 |
| Duplicate clusters | 3 exact-label / 4 suffix | 7 / 10 | **0** |
| Mean preservation | 0.148 | 0.366 | 0.409 |
| Last-quarter preservation | 0.152 | 0.216 | 0.264 |
| Stage-1 merges / holds | — | 84 / 41 | — |
| Reference resolution | — | — | **6/8 = 75%** (target judge ON) |
| Lifecycle application | — | — | **13/13 = 100%** (target judge ON) |

Live (unfrozen, real extraction, judge ON) — Hardening #2: 112 entities, 4
duplicate clusters, judge invoked on 62% of mentions, uncertainty 1.4%,
mean preservation 0.381.

**Caveat that matters for the product**: the 75% / 100% target-resolution
figures and the judge-uncertainty behaviour were measured with judges
**enabled**. The shipping live board runs both judges **abstaining**. There is
no measurement of reference/lifecycle resolution rate on the live
configuration. Earlier meeting stress (no identity layer, no judges) measured
**reference 4/8 = 50%, lifecycle 11/23 = 47.8%** — that is closer to what live
does today.

### Impact of duplicates on the page budget

`REGION_BUDGET = 8` regions + `ANNOTATION_BUDGET = 3`. Every duplicate is a
full-price competitor for one of 8 slots and an extra node the evaluator scores
as unexpressed meaning. The mechanism is visible directly: mean preservation
more than doubled (0.148 → 0.366) from removing 14 duplicate entities alone,
with no change to layout, budget or grammar.

---

## 5. Form selection & expression quality

### Grammars (10)

`scene`, `relationship`, `cause_effect`, `sequence`, `comparison`,
`hierarchy`, `grouping`, `process`, `quantity`, `spatial`
(`lib/expression/grammars/index.ts`).

### How a grammar is chosen

`GRAMMAR_FOR_INTENT[intent]` is a fallback chain; `firstUsable` takes the first
grammar that produces ≥1 region. A grammar returning nothing is treated as a
correct report that this world has no such structure. Every chain ends at
`relationship`, so the planner can never fail to produce something and never
invents structure to fill a gap. `repair` may force a `grammarOverride`, and a
grammar change is what makes the round `mode: "full"` rather than `"patch"`.

### Selectivity — what earns a node

There is no single "is this worth drawing" predicate. Selectivity is the
composition of four rules:

1. **The grammar's own selection** — each grammar picks only entities that
   participate in its structure (spine, poles, root+children, …).
2. **`canvasEligible` + visibility tier** (`planner/visibility.ts`): `primary`,
   `supporting`, `contextual` compete; `historical` and `archived` are memory
   only. Tier is assigned per round from recency (`CURRENT_WINDOW = 8` turns),
   durable signals (`PERSIST_WINDOW = 36`), lifecycle status, and — since the
   eval-#3 fix — wall-clock idleness (`IDLE_GAP_MS = 15 min`, gated on
   `nowMs` being supplied, which the live path does supply).
3. **`attachRelatedEntities`** (`planner/plan.ts`): the intent focus earns a
   node even unlinked; anything else must have a **real** relation to something
   already shown. Never an invented edge. `PERSIST_RESERVE = 3` of the 8 slots
   are held for standing-persist entities, ranked by `durabilityRank`, not
   recency. Already-visible entities get a −0.5 hysteresis bonus.
4. **Claims never become boxes** — they become annotations or nothing.

A caption-only outcome is therefore implicit: if nothing survives 1–3, the run
is a `noop` and only the transcript rail carries the sentence.

### Annotation policy

`buildAnnotations`: at most `ANNOTATION_BUDGET = 3` per scene; a claim must be
`about` an entity that is *actually shown* or it is dropped (never floated);
invalidated claims are kept in the world but never drawn. Rendered beneath
their anchor, width tracking the anchor.

### Incremental patch vs full

`isContinuation(plan, {previous, previousGrammar})` → `patch` when the grammar
is unchanged; `compose.anchorToPrevious` then holds retained objects at their
existing coordinates (median translation of retained objects; documented ~5 px
residual when *every* retained object resized). `full` on the first scene of a
session or on a grammar change — the spatial logic itself changed, so no slot
can be said to persist. `excalidrawSync` then does a pure signature diff: an
unchanged element is not touched at all; arrows are rebuilt only when an
endpoint moved.

### Overflow / page-turn / hysteresis

`decideExpressionOverflow` (`render/excalidrawSync.ts`):

- diagram already owns this page → **grow in place, never turn**
- a blank page would not fit either → stay, clamp the region
- otherwise `SAME_TOPIC_TURN_COOLDOWN_MS = 12_000` unless the topic changed
- `REGION_PADDING` 1.35 → 1.12 so headroom stops forcing re-reservation

Failure modes when occupancy → 1: measured in eval #3 — page occupancy **10 or
11 on all 44 turns**, mean 2.25 new visible entities per turn, and a steady
state of ~9–10 aged slots rotating among themselves while genuinely new
content gets **one** slot that turns over almost every turn ("one in, one
out"). Preservation < 0.05 on 64% of updates in that state. The overflow
policy fixed *spurious* turns; it did not fix *what occupies the page*.

### Isomorphism check — would the diagram still argue the idea with labels removed?

Honest ratings, from the code plus the form-fidelity and incremental reports:

| Grammar | Rating | Why |
|---|---|---|
| `cause_effect` | **Good** | Vertical spine + directed arrows + branches placed on the row of the step they attach to. Direction and chaining are visible without words. `prevents`/`refutes` carry a label because the sign is not visible in arrangement — an honest, named exception. |
| `comparison` | **Good** | Two poles on a shared row grid, dimensions aligned row-for-row; `evaluate.ts` reads same-row siblings as `parallel`. Which side is "more" needs the `more`/`less` label. |
| `sequence` / `process` | **Fair-good** | Ordered chain reads as order; sequence vs transformation are not visually distinguished from each other. |
| `hierarchy` | **Good** | Root-above-children is unambiguous. |
| `grouping` | **Fair** | A container with members reads as containment; *why* they are grouped does not. |
| `quantity` | **Good** | Extent as repeated marks (≤12), never a numeral in a box; metric series/gauge draw the actual shape of the number. |
| `spatial` | **Good** | `honourSpatialRelations` places by stated spatial term. |
| `scene` | **Fair** | Presence and rough association only — closest to "labelled boxes". |
| `relationship` | **Poor** | Deliberately the last resort: top entities by importance with real edges. Unlabelled, it is a graph of anonymous nodes. **And it is the grammar the live evals spend most of their time in** (eval #2: 25 consecutive `express_uncertainty` → `relationship` turns). |

That last row is the honest headline of this section: the grammars that argue
well are the ones that need confident structure in the world, and live
disfluent speech keeps landing in the one that doesn't.

---

## 6. Render & live surface

- **Excalidraw path**: `skeletonsForScene` (`render/excalidraw.ts`) →
  `applyStableIds` → signature diff (`planCanvasDiff`) → `convertToExcalidrawElements`
  (dynamic import) → `commit()`. Conversion is **idempotent**: same scene at
  same origin ⇒ byte-identical elements with identical ids, which is what makes
  "don't touch what didn't change" possible.
- **sketchKey**: attached in `primitives/resolve.ts:withSketch` to `node`,
  `moment`, `state_marker`, `object_glyph` only (a `figure`, `place_marker` or
  `quantity_array` already draws its own meaning). Key is
  `${entityType}:${slug(label)}` — deterministic, decided *after* the primitive.
- **resolveSketches wiring**: client cache (`Map` on the Board) → `/api/sketch`
  → server-side `sketchFor` → in-memory `library.ts` cache (per process, lost
  on restart) → `drawSketch` (Sonnet). Fan-out is `Promise.all` over distinct
  missing keys.
- **Two contradictions worth naming**, both in code today:
  - `SKETCH_SYSTEM` asks for "40-100+" strokes with cross-hatched shading and
    `SketchSchema` allows 120 — but `sketchLooksAbstract` **discards any sketch
    with > 70 strokes**, and also any sketch where > 70% of strokes are shorter
    than 10 units. Cross-hatching is, by definition, many short strokes. The
    better the model follows the prompt, the more likely the render silently
    falls back to a plain node.
  - `/api/sketch` reserves `maxOutputTokens: 800` in the provider guard while
    `drawSketch` requests `maxTokens: 6000` — the cost guard under-reserves by
    ~7.5×.
- **Caption rail vs expression centre**: when `xeEnabled`, `writeLive` writes
  into a right rail (`LIVE_CAPTION_RAIL_W`, 16 px type) and does not advance
  the main pen; opacity 72 active → 48 settled → 22 once expression ink lands
  (`demoteLiveCaptions`, `fadeConsumedTranscript`). Caption overflow wraps in
  the rail instead of turning the page.
- **"Expressing…" / pending pill**: `expressionPending` set on
  `handleSettledExpression`, cleared in a `finally` after the canvas write
  (so it covers the sketch wait). Tracks thought ids **plus**
  `controller.hasPending()`, so a coalesced burst stays pending across
  flushes. Surfaces as the `canvas-expressing` pill and `ProductUI`'s
  "Expressing…" status.
- **Camera**: expression ink uses `revealVisualReentry` → `framePage(false,
  "visual re-entry reveal")` **only when the newly added bounds don't already
  fit**; repositioned-but-not-added ink never pulls the camera. The general
  camera has a `live_follow` vs structural proposal split with a documented
  `contentFits:false` zoom-floor bug (`Board.tsx:1775`, "9 consecutive
  proposals") and coalesced page-arrival framing.
- **Known camera/composition bugs from logs**: page-turn churn (eval #1 #6 —
  11 turns/108 s and 24/194 s); page turning on empty renders (eval #1 #2,
  fixed and confirmed 0/34 in eval #2); turn cadence still ~6.5 s in eval #2
  by content pressure, not bugs.

---

## 7. Agent / MCP surface (status only)

- `entry.express({text|delta|id|speakerId})` → `ExpressResult {id, status,
  mode, intent, grammar, reason, objects, connectors, error, trace}`.
- Tool: `express_meaning` (`lib/expression/tool.ts`), schema advertised from
  the same module the handler validates with. Geometry rejection is
  structural — `MeaningDeltaSchema` is `.strict()` at every level, so an `x`
  key fails the parse; `findGeometryKey` exists only to turn that into a
  sentence an agent can act on.
- Transport: `scripts/express-mcp-server.mjs` (stdio JSON-RPC 2.0 +
  loopback `:3212` queue), page-side poller `lib/expression/agentBridge.ts`,
  gated by `?agent=1` and dev-only (`isAgentBridgeEnabled`). `AGENT.md`
  documents the contract.
- **Shared world with speech: Yes.** Same controller, same debounce, same
  session, same canvas.
- **Built and verified on a real board**: text and structured-delta submission
  (`/try?v2=1&xe=1`, dev console) — a 4-step causal chain from
  `{text}`, `mode:"patch"` on a follow-up, `917 ms` for `{delta}` (900 of it
  debounce), and a coordinate-carrying delta refused live. MCP-over-stdio and
  the bridge are in `npm test` (`express-mcp-test.mjs`) but **not evidenced on
  a real board in any report in `docs/`** — treat end-to-end MCP as
  **unverified live**.
- **Agents are not required for the human live path.** All three agent flags
  return `false` in production; `?agent=1` only attaches the bridge, and the
  speech path never touches `entry.ts`.

---

## 8. Observability

Session-log event types on the expression path (`log({type:"expression"...})`):

| Event | Fields |
|---|---|
| `submitted` | `thoughtId`, `text` (`… [structured meaning]` for agent deltas) |
| `updated` | `intent`, `grammar`, `mode`, `reason`, `preservation`, `problems[]`, `interpretation`, `settledToUpdatedMs` |
| `noop` | same minus patch fields |
| `failed` | `detail` (throw, `render skipped: …`, or `sketch resolution: …`), `thoughtId` |
| `rendered` | `patch` (`describePatch`) |
| `page-turn` | `trigger`, `msSincePreviousTurn`, `activeTopic`, `topicChanged`, `pageOccupancy`, `pageCapacity`, `newSemanticEntities`, `newVisibleEntities`, `removedVisibleEntities`, `planValidationFailed`, `scenePlanDiff`, `renderOperationCount`, `overflow{neededW,neededH,pen,pageIndex}`, `suppressed`, `suppressReason` |
| `invented-relation` | `detail` — the evaluator's loudest verdict |

Adjacent: `settled-thought`, `thought`, `thought-boundary`, `transcript`,
`keyterms`, `v2`, camera `decision`/`suppression`.
Latency keys: `settled_to_expression`, `speech_onset_to_raw_interim`,
`interim_gap`, `interim_lag`, `build_live_line`, `commit`, `render`, `paint`,
`long_task`, plus milestones (`first_ink`, `token_ready`, `socket_open`, …).
Deep capture: `lib/expression/capture.ts` (`?capture=1`, dev-only) buffers full
`ExpressionTrace`s + a `VisibilitySnapshot` per turn for offline replay by
`scripts/expression-live-replay.mjs`.

### What you cannot answer from logs today

1. **Extract time vs sketch time vs render time.** Only the aggregate
   `settledToUpdatedMs` exists (and it starts at *submit*, so it includes the
   900 ms debounce). Fix: `latency.observe` around `this.extract`, around
   `resolveSketches`, and around `syncExpressionCanvas`.
2. **Cross-session p50/p95 of anything.** `LatencyRecorder` is per-session,
   in-memory; `LATENCY-AUDIT.md` says it plainly ("nothing aggregates across
   sessions"). `app/api/telemetry/latency` exists as a sink — no rollup reads it.
3. **Speech onset → first *structural* ink.** `first_ink` marks the caption,
   not the diagram. No milestone is marked at the first expression element.
4. **Why a `noop` happened** — empty delta vs no eligible entity vs grammar
   found nothing are one event today (`plan.reason` hints, but is not typed).
5. **Sketch hit/miss rate and per-key cost.** No event fires on cache hit,
   miss, fetch duration, or `sketchLooksAbstract` rejection — so the >70-stroke
   discard above is currently invisible in production.
6. **Identity `hold` rate on the live board.** `identityResolutions` is on the
   trace but never logged; only `?capture=1` sees it.

### Test-suite counts

| Suite | Size |
|---|---|
| `scripts/expression-test.mjs` corpus | **122 cases, 16 categories** (`identity, causality, abstract, sequence, state-change, comparison, trade-off, hierarchy, mathematics, quantity, spatial, argument, narrative, definition, multi-turn, everyday`) — 119/119 preservation 1.000 reported at the visibility pass |
| Identity fixtures | 13/13 (`identity-scenarios.mjs`), + 11/11 adversarial in Hardening #2 |
| Reference / lifecycle / critical / provenance / metric | 13/13 · 10/10 · 9/9 · 8/8 · 11/11 |
| Discovery | `scripts/expression-discover.mjs` (in `npm test`) |
| Freeze / replay harnesses | `freeze-meeting-deltas`, `expression-meeting-frozen-replay`, `expression-meeting-stress-replay`, `expression-live-replay`, `expression-identity-replay`, `expression-visibility-audit`, `expression-idle-gap-test` (9 checks), `expression-critical-replay`, `expression-metric-*`, `expression-reference-*`, `expression-provenance-replay`, `expression-target-failure-audit`, `express-mcp-test` |
| Whole suite | `npm test` ≈ 976 + 51 checks reported at Hardening #2 |

---

## 9. Gap matrix vs product goal

| Capability | Status | Evidence | Blocks live "maxed" expression? |
|---|---|---|---|
| Speech → captions | **done** | `writeLive` 1–6 ms; right-rail demotion at opacity 72/48/22 | No |
| Settled thought detection | **done** | `pushPresentationSegment`; hold ceiling 4 s; verb-whitelist starvation bug fixed in `ede4e37` | No, but the 4 s ceiling sets a floor on how late meaning can arrive |
| Meaning extraction | **partial** | 122-case corpus green on the deterministic layers; live type-inconsistency and anaphoric-entity failures (Hardening #2, eval #2 `trying`) | Yes — bad types split identities, bad entities occupy slots |
| Structure/form choice | **partial** | 10 grammars, deterministic chain; but eval #2 shows 25 consecutive `express_uncertainty → relationship` turns | **Yes** — the fallback grammar argues nothing |
| Progressive first ink | **missing** | single `onUpdate`; `resolveSketches` awaited before `syncExpressionCanvas` (`Board.tsx:5821`); stroke reveal exists only in `render/svg.ts` + `app/dev/express` | **Yes** |
| Identity stability | **partial** | frozen: 0 duplicate clusters, preservation 0.148 → 0.409; live: judge abstains, type-family splits remain | Yes — every duplicate costs one of 8 slots |
| Selectivity (what earns a node) | **partial** | tiering + `attachRelatedEntities` + persist reserve; eval #3: occupancy 10–11 on 44/44 turns, one rotating slot | **Yes** |
| Incremental patch | **done** | `isContinuation` + `anchorToPrevious` + signature diff; agent check showed patch with ~5 px residual | No |
| Caption demotion | **done** | `demoteLiveCaptions`, `fadeConsumedTranscript` | No |
| Latency acceptable for live talk | **UNKNOWN → likely no** | 900 ms debounce + Haiku extract (~0.8–0.9 s by proxy) + Sonnet sketch (~3.6–4.5 s by proxy, blocking) before any ink | **Yes** |
| Agent same path | **done** (bridge/MCP unverified live) | `entry.ts` → same controller; 917 ms structured-delta round trip | No |
| Camera stable when full | **partial** | overflow policy fixed spurious turns (0/34 empty renders in eval #2); cadence still ~6.5 s; `contentFits:false` zoom-floor bug documented | Yes, secondary |

---

## 10. Critical path bottleneck ranking

### 1. The blocking sketch call sits between meaning and first ink

- **Symptom**: nothing appears on the canvas until every new concept's sketch
  has been fetched. Model is Sonnet with a 6000-token budget, asked for
  40–100+ strokes. Compounded by two silent losses: sketches >70 strokes or
  >70% short strokes are discarded at render (`sketchLooksAbstract`), and the
  library cache is per-process in memory.
- **Root**: `components/Board.tsx:5821` (`await resolveSketches` before
  `syncExpressionCanvas`); `lib/expression/draw/agent.ts`;
  `lib/expression/draw/schemas.ts:sketchLooksAbstract`.
- **Fix class**: **architecture** (two-phase render: structure now, strokes
  when they land) + **policy** (the stroke-count gate contradicts the prompt).
- **Dependency**: none — this is the one that can move first, and it unblocks
  #2's measurement.

### 2. Low-confidence speech lands in the `relationship` grammar, which argues nothing

- **Symptom**: eval #2 — from 1:22 to the end, *every* update is
  `express_uncertainty / relationship`, 25 consecutive; the canvas becomes a
  graph of anonymous nodes plus one rotating slot.
- **Root**: `lib/expression/intent/classify.ts` (scoring, `express_uncertainty`
  second-to-last in priority) and `GRAMMAR_FOR_INTENT.express_uncertainty =
  ["relationship"]` with the low-confidence guard added in
  `planner/plan.ts`.
- **Fix class**: **model + policy** — extraction produces too few confident
  relations on disfluent speech, and the fallback is entitled to too much
  authority. Not architecture.
- **Dependency**: interacts with #3 — a better-behaved fallback matters less
  if the page is full of the wrong things.

### 3. The page is permanently at capacity, occupied by the previous topic

- **Symptom**: occupancy 10–11 on 44/44 turns (eval #3); eight of the ten
  most-moved objects in a 5-minute frog story were entities from a talk about
  InPublic 40 minutes earlier; preservation 0 on 31% of updates.
- **Root**: `lib/expression/planner/visibility.ts` (turn-count windows,
  partially fixed by `IDLE_GAP_MS`), `planner/plan.ts:attachRelatedEntities`
  (`REGION_BUDGET = 8`, `PERSIST_RESERVE = 3`, hysteresis bonus).
- **Fix class**: **policy** first (topic-change eviction is not the same test
  as idleness), possibly **architecture** if "current topic" needs to become a
  first-class world concept rather than a derived focus.
- **Dependency**: after #1 (so the effect of any change is visible quickly),
  independent of #2.

### 4. Extraction type inconsistency splits identities

- **Symptom**: the same referent extracted `object` then `action`; 3 of 4
  remaining duplicate clusters in Hardening #2. Each split costs a slot in the
  8-region budget and reads as unexpressed meaning to the evaluator.
- **Root**: `lib/expression/meaning/extract.ts` prompt; mitigated but not
  solved by `identity.ts:ROLE_BRIDGE` and `typesCompatible`.
- **Fix class**: **model** (extraction consistency), not identity logic —
  loosening `typesCompatible` is the false-merge risk that gate exists for.
- **Dependency**: partially masks #3's measurement; fix after #3 or measure
  jointly on the frozen corpus.

### 5. The 900 ms debounce plus an un-instrumented model call is the floor

- **Symptom**: nothing can appear sooner than settle + 900 ms + one Haiku
  round trip, and we cannot say what the second term actually is.
- **Root**: `lib/expression/live.ts:DEFAULT_DEBOUNCE_MS`;
  `meaning/client.ts`; missing `latency.observe` around each awaited stage.
- **Fix class**: **policy** (the debounce trade-off is real — it buys
  coalescing and world-fold serialisation) + **observability** before anything
  else.
- **Dependency**: instrument first; it is also what turns #1's fix into a
  provable win.

---

## 11. Stack inventory (facts only)

| Slot | What | Where |
|---|---|---|
| STT | Deepgram **nova-3**, browser WSS, `interim_results:true`, `smart_format:true`, `endpointing:150`, `utterance_end_ms:1000` (handler never registered), ≤40 `keyterm` values fixed at socket open, 80 ms Int16 PCM chunks (worklet; MediaRecorder fallback at 80 ms timeslice) | `hooks/useDeepgram.ts`, `app/api/deepgram/token/route.ts` |
| Extract / express LLM | `EXPRESSION_MODEL = process.env.EXPRESSION_MODEL || SCRIBE_MODEL` = **`claude-haiku-4-5-20251001`**; `maxTokens: 2000`, `temperature: 0`, single non-streaming completion; JSON extracted by brace-balancing then `sanitizeDelta` + Zod | `lib/expression/meaning/extract.ts`, `app/api/express/route.ts`, `lib/llm.ts` |
| Sketch generation | `SKETCH_MODEL = process.env.SKETCH_MODEL || ARTIST_MODEL` = **`claude-sonnet-4-6`**; `maxTokens: 6000`, `temperature: 0.5`; ≤120 strokes × ≤40 points, unit square 100×100 | `lib/expression/draw/agent.ts`, `app/api/sketch/route.ts` |
| Identity judge | `defaultIdentityJudge` (`identityJudge.ts`) — **not wired on the live board**; abstain default | `lib/expression/world/identityJudge.ts` |
| Target judge | `targetJudge.ts`, constrained (candidate indices only) — **not wired on the live board**; abstain default | `lib/expression/world/resolveTarget.ts` |
| Other project models (not on this path) | `BEAT_MODEL` haiku-4-5, `ARTIST_MODEL` sonnet-4-6, `STORY_MODEL`, `MATH_MODEL`; Gemini supported by `providerFor` (any model id starting `gemini`) | `lib/llm.ts` |
| Local / HF models | **None.** No local inference, no HF client anywhere in the repo | — |
| Provider SDKs | `@anthropic-ai/sdk ^0.68.0`, `@google/genai ^2.16.0`, `@deepgram/sdk ^4.11.2` | `package.json` |
| Timeouts / retries | No explicit timeout or retry on `/api/express` or `/api/sketch`; every failure resolves to `EMPTY_MEANING_DELTA` / `{sketch:null}`. Gemini path retries once without `thinkingConfig`. Agent bridge retries polling on error. | `meaning/client.ts`, `draw/client.ts`, `lib/llm.ts`, `agentBridge.ts` |
| Batching | Controller debounce 900 ms, coalesce a burst into one segment (a `delta` submission is always alone); sketches fan out with `Promise.all` over distinct keys; sketch library caches per key client-side and per server process | `lib/expression/live.ts`, `draw/client.ts`, `draw/library.ts` |
| Cost governance | `guardProviderRequest` / `reconcileProviderCost` on both routes; `/api/express` reserves 2000 output tokens, `/api/sketch` reserves 800 (agent requests 6000) | `lib/server/provider-guard.ts` |

---

## 12. What we know we don't know

1. **What the live pipeline's real time budget is.** No stage timing, no
   cross-session percentiles. Measure: `latency.observe` around extract,
   sketch, and sync; persist through `app/api/telemetry/latency`.
2. **Whether the sketch call is worth its position.** Unknown hit rate,
   unknown fetch duration, unknown `sketchLooksAbstract` rejection rate.
   Measure: three log events on the sketch path, one session.
3. **How the live configuration (both judges abstaining) actually resolves
   references and lifecycle acts.** Every good number we have was measured
   with judges on. Measure: rerun `expression-meeting-frozen-replay --no-judge`
   and compare to the 75%/100% baseline.
4. **Whether extraction quality or planner selectivity dominates the
   preservation collapse.** Eval #2/#3 could not separate them from a session
   log. Measure: one real 15-minute session with `?capture=1`, replayed
   offline — the tooling exists and has never been used on a full session.
5. **What a good "current topic" test is.** `IDLE_GAP_MS` fixes the idle case;
   nothing evicts on a clean in-conversation topic change.
6. **Whether progressive structure-then-detail actually reads better**, or
   whether early partial structure that later re-flows is worse than a slower,
   correct first frame. Untested in either direction.
7. **The extractor's own accuracy**, independent of everything downstream.
   The 122-case corpus deliberately bypasses it; `scripts/expression-live.mjs`
   is the intended instrument and no report cites its output.
8. **Whether MCP end-to-end works against a real open board.** Unit-tested,
   never evidenced live in `docs/`.
9. **Whether 8 regions is the right budget.** Never varied experimentally;
   every finding to date is about *which* 8, never *how many*.

---

## Key files

- `lib/expression/schemas.ts` · `lib/expression/pipeline.ts` · `lib/expression/live.ts` · `lib/expression/entry.ts` · `lib/expression/tool.ts` · `lib/expression/agentBridge.ts` · `lib/expression/capture.ts` · `lib/expression/trace.ts`
- `lib/expression/meaning/extract.ts` · `lib/expression/meaning/client.ts` → `app/api/express/route.ts`
- `lib/expression/world/apply.ts` · `identity.ts` · `identityJudge.ts` · `references.ts` · `resolveTarget.ts` · `targetJudge.ts`
- `lib/expression/intent/classify.ts` · `lib/expression/grammars/index.ts` · `lib/expression/planner/plan.ts` · `lib/expression/planner/visibility.ts` · `lib/expression/primitives/resolve.ts` · `lib/expression/compose/compose.ts`
- `lib/expression/evaluate/evaluate.ts` · `attribute.ts` · `repair.ts`
- `lib/expression/render/excalidraw.ts` · `excalidrawSync.ts` · `svg.ts` · `core.ts` · `metricFormat.ts`
- `lib/expression/draw/agent.ts` · `client.ts` · `resolve.ts` · `library.ts` · `schemas.ts` → `app/api/sketch/route.ts`
- `components/Board.tsx` (controller construction ~859, `applyExpressionUpdate` 5713, `handleSettledExpression` 5896, settled-thought emission ~5979) · `components/ProductUI.tsx` · `components/ControlBar.tsx`
- `hooks/useDeepgram.ts` · `lib/liveSpeech.ts` · `lib/vocab.ts` · `lib/features.ts` · `lib/latency.ts` · `lib/ops.ts`
- `scripts/expression-test.mjs` · `expression-discover.mjs` · `expression-live-replay.mjs` · `expression-meeting-frozen-replay.mjs` · `expression-visibility-audit.mjs` · `expression-idle-gap-test.mjs` · `express-mcp-server.mjs` · `scripts/fixtures/*`
- `docs/EXPRESSION-ENGINE-V1.md` · `V1-GAP-ANALYSIS.md` · `LIVE-EVAL-{1,2,3}-REPORT.md` · `LIVE-EVAL-{1,3}-FIXES-REPORT.md` · `VISIBILITY-REPORT.md` · `IDENTITY-*-REPORT.md` · `TARGET-RESOLUTION-REPORT.md` · `MEETING-STRESS-REPORT.md` · `INCREMENTAL-REPORT.md` · `FORM-FIDELITY-REPORT.md` · `AGENT-ENTRY-REPORT.md` · `LIVE-CAPTURE.md` · `AGENT.md`

---

## Distance to "live visual expression as a human or agent speaks"

The architecture is there and is not the problem: speech becomes settled
thoughts deterministically, one model call turns a thought into typed meaning,
and nine deterministic layers turn meaning into a laid-out scene in roughly
seventeen milliseconds — a number we can state because an agent submitting
structured meaning round-tripped in 917 ms, 900 of which was a debounce we
chose. What stands between that and the product is three things, in order.
First, the canvas cannot draw until a second, much slower model has finished
inventing pen strokes for every new concept, so the fastest part of the system
waits on the slowest and there is no first frame at all until everything is
ready. Second, on real disfluent speech the world rarely accumulates enough
confident relations for a grammar that argues — the engine keeps falling back
to a generic relationship graph, which is structurally honest and visually
mute. Third, the page is permanently full, and full of the previous topic:
measured occupancy was 10 or 11 objects on 44 out of 44 consecutive turns
while genuinely new content fought over a single rotating slot. None of those
three is a rewrite; the first is an ordering and a policy contradiction, the
second is extraction quality plus how much authority a low-confidence round is
granted, the third is an eviction rule the codebase currently expresses only as
idleness. And we are flying with the instruments half-installed: there is no
per-stage timing and no cross-session percentile anywhere, so the single
highest-leverage next act is not a fix at all — it is one captured fifteen-minute
session, replayed offline, with a stopwatch on each stage.
