# Visual Re-entry V1

## Status

Experiment, layered strictly downstream of the protected baseline
[`docs/LIVE-SPEECH-PRESENTATION-V2.md`](LIVE-SPEECH-PRESENTATION-V2.md). This
is **not** a new protected baseline — it has no ADR, and it is not exempt
from redesign the way V2 is. It exists to test one product hypothesis before
any broader visual-intelligence work resumes.

## V1.4 truth-preserving quantitative approximation

V1.4 keeps the same two visual families and the same durable/quiet-commit
lifecycle. A quantitative anchor may now carry one literal qualifier:
`about`, `around`, `roughly`, or `approximately`. Exact anchors omit the
field, so every V1.3 exact intent remains wire-compatible. Deterministic
extraction, grounding, provenance logs, and rendering preserve the qualifier
on its specific `from` or `to` anchor. Grounding requires value, source order,
and modality to agree; approximate speech cannot ground an exact visual, and
exact speech cannot ground an invented approximation.

Distinct semantics remain unsupported: `nearly`/`almost`, inequalities,
ranges, and approximate multipliers fall back to the model/current `none`
policy. The renderer prints the literal qualifier and remains a non-
proportional pair of value blocks, so approximation never becomes fake chart
precision.

## V1.2 evidence and quiet-commit amendment

V1.2 retains V1.1's local launch gate and durable results, but no longer
assumes one V2 settled thought is always a complete visual evidence unit.
`advanceVisualEvidence()` (`lib/visualReentry/evidence.ts`) keeps at most one
incomplete, same-page opener for 12 seconds (two thoughts / 600 characters
maximum). It recognizes only incomplete evidence for the existing
`enumeration` and `quantitative_change` families. An unrelated thought,
page change, or expiry clears the window; arbitrary prose is never accumulated.

This allows, for example, "There are three things we need to improve" plus
"Speed, accuracy, and presentation", or "10 users last week" plus "20 users
this week", to become one grounded source thought. The model is called only
after the combined text passes the same deterministic candidate gate.

Active speech continues to own the camera. It no longer blocks every canvas
commit: after a newer live update has settled and reserved its row, an older
durable result may commit quietly with no camera request. A mutable interim
line remains an absolute placement block. Rendering uses a disposable pen and
rechecks the exact live sequence/pen revision before atomic commit, so speech
that advances during the build turns the attempt back into a hold.

## V1.1 launch and freshness amendment

V1.1 supersedes the original abort-on-continued-speech policy described
later in this document. A settled thought first passes the deterministic,
local `evaluateVisualCandidate()` gate. Only explicit 2–5 item list cues or
grounded two-number change/comparison cues may launch Haiku; ordinary prose,
relationships, hierarchies, and vague trends stop locally as `none`.

At most one decision request runs at a time. A later thought does not abort
it: an otherwise eligible request is suppressed while the current request is
in flight. Aborts are reserved for reset, microphone stop, mode change, and
component teardown.

A grounded decision is a durable result, not canvas geometry. Board holds up
to three results for 30 seconds, keyed to their session generation and page.
Continued speech does not invalidate the result. At a quiet settled boundary
or the next existing V2-safe camera window, it is revalidated, built against a
disposable clone of the current pen, and committed atomically. Page/session
changes, expiry, or queue pressure drop it. No Visual Re-entry code changes
V2's speech timing or the two deterministic renderers.

The deterministic replay report exposes candidate accepted/rejected, durable
ready/held/committed, decision concurrency, and the original latency metrics
so launch selectivity and useful-result rate can be measured directly.

## Hypothesis

> A clean V2 settled thought should sometimes become more visually
> expressive, but ONLY when an additional visual communicates structure that
> the text alone does not communicate as clearly.

Visuals must earn their existence. The system must be completely comfortable
producing `none` — that is the expected answer for most settled thoughts, not
a failure mode.

## Supported visual families (V1 only)

1. `enumeration` — a spoken list of 2-5 items becomes a plain numbered list
   ("01 Speed / 02 Accuracy / 03 Presentation"). No bounding card, no bullet
   glyphs — clean visual notes, not a widget.
2. `quantitative_change` — a spoken "from X to Y", where BOTH literal numbers
   were actually spoken, becomes two value blocks with an arrow between them
   ("10 users ──→ 20 users"). Deliberately not a bar chart: there is no real
   axis or scale, so a proportional-height bar would be a decorative fake
   graph. No derived values — no percentages, no computed deltas, no trend
   lines. If either literal number anchor is missing, the answer is `none`;
   V1 does not estimate or infer a missing anchor.

Nothing else. No relationships, cause/effect, hierarchy, process, comparison,
sketches, graphs, Story Mode, or free-form diagrams in V1. A causal
statement ("marketing brings traffic and traffic creates signups") or a
vague magnitude ("revenue is doing much better", "the business doubled")
must resolve to `none` — never flattened into one of the two supported
shapes just to draw something.

## Visual intent schema

`lib/visualReentry/types.ts`'s `VisualReentryIntentSchema` is the entire
closed vocabulary the model can respond in — three branches, each parsed
with zod's `.strict()`:

```ts
type VisualReentryIntent =
  | { type: "none"; reason: string }
  | { type: "enumeration"; title?: string; items: string[]; evidence: string[] }
  | { type: "quantitative_change"; from: number; to: number; fromQualifier?: "about" | "around" | "roughly" | "approximately"; toQualifier?: "about" | "around" | "roughly" | "approximately"; unit?: string; fromLabel?: string; toLabel?: string; evidence: string[] };
```

`evidence` is the phrase(s) the model claims justify the extraction —
`lib/visualReentry/ground.ts` checks that evidence actually occurred in the
source text before anything is allowed to render, rather than fuzzily
comparing extracted content to the whole thought. Grounding doesn't stop at
evidence, either: an enumeration's individual `items`, and a
quantitative_change's `from`/`to` numbers (including simple "twenty
thousand"-style figures — see `extractSpokenNumbers`,
`lib/math/ground.ts`), per-anchor qualifier/order, and its
`unit`/`fromLabel`/`toLabel`, are all checked
against the source independently, with casing/plural/punctuation normalized
as harmless differences only. If ANY single piece fails, the WHOLE intent
downgrades to `none` — never a partial edit that silently drops or swaps
one item/value, matching this codebase's existing `groundEquationInSource`
convention (lib/math/ground.ts).

Unknown `type`, malformed data, missing required fields (including a
missing `evidence`/`reason`), or any extra/unexpected field (`.strict()`
rejects rather than silently strips) all fail validation and resolve to
`{ type: "none", reason: "decision unavailable" }`. There is no fallback to
a free-form Beat/Artist action anywhere in this pipeline — a settled
thought either fits one of the two visual families exactly, or it gets
`none`.

## Pipeline

```text
V2 settled thought (components/Board.tsx's handleFinal, under v2Enabled)
   ↓
SettledThought                                lib/visualReentry/types.ts
   ↓
requestVisualIntent() — fetch, client-safe     lib/visualReentry/client.ts
   ↓  POST /api/visual-intent (guarded, one LLM call)
decideVisual()  — the actual LLM call          app/api/visual-intent/route.ts
                                                 -> lib/visualReentry/decide.ts (server-only)
   ↓
groundDecision() — deterministic, no LLM       lib/visualReentry/ground.ts
   ↓
buildVisual() — deterministic geometry         lib/visualReentry/render.ts
   ↓
commit to canvas (Board.tsx, existing elementsRef/commit())
```

Every stage may resolve to "do nothing." Only a decided, grounded, rendered
visual reaches the canvas, and at most one LLM call — and at most one
resulting visual — per settled thought. There is no Beat→Artist→Organizer
chain here; this pipeline is deliberately much simpler than that one.

The model call is split client/server the same way every other AI feature
in this codebase is: `lib/visualReentry/decide.ts` is `server-only` (calls
`lib/llm.ts`/the Anthropic SDK directly) and is only ever imported by
`app/api/visual-intent/route.ts`, which goes through the same
`guardProviderRequest`/`reconcileProviderCost` cost governance as
`/api/beat`, `/api/scribe`, `/api/story`. `components/Board.tsx` (a `"use
client"` component) never imports `decide.ts` or `lib/llm.ts` — it only
calls `lib/visualReentry/client.ts`'s `requestVisualIntent()`, a plain
`fetch()` wrapper.

## Where this hooks into V2

`components/Board.tsx`'s `handleFinal` is untouched up through the point
`pushStructuralSegment` (`lib/liveSpeech.ts`) reports a completed thought
(the same place V2's own `"thought"` log event is emitted). The Visual
Re-entry job is started inside the existing `writeLiveDone.then()`
continuation, alongside V2's `pop-suppressed` log — never awaited by
`handleFinal` or `writeLive`, so Tier 1 speech-to-ink dispatch timing is
unaffected whether Visual Re-entry is on or off. `lib/visualReentry/*`
itself never calls `framePage`/`proposeCamera` directly — see Camera
contract below for how (and when) a reveal actually happens.

Freshness is attached to meaning, not the speech sequence. Reset/teardown
aborts the request and advances a generation. A grounded result remains
relevant only while its generation, page, and 30-second TTL still match.
The speech sequence is used only as a placement-revision guard and to prove a
durable result belongs to a previous settled thought; it never semantically
invalidates that result.

## Visual governor (ownership & failure containment)

Explicit, not implicit:

- **One in-flight decision request, maximum.** A candidate arriving during
  an active request is suppressed locally. The active request is not aborted.
- **At most one response per settled thought.** Structural, not a runtime
  check — see Visual ownership above.
- **No duplicate processing of the same thought id.**
  `lib/visualReentry/ownership.ts`'s `claimThought()` — a small pure
  function over a caller-owned `Set` — is checked before a job is even
  started; `visualReentryProcessedIdsRef` owns the set.
- **No autonomous retry loop.** Unlike `/api/beat`'s one-retry-on-parse-
  failure, `lib/visualReentry/decide.ts` never retries — a failure is
  final for that thought.
- **No skip escalation, no output quota.** Neither concept exists anywhere
  in `lib/visualReentry/*` — there is no `skipStreak`, no minimum-visual
  requirement, nothing tracking "haven't drawn in a while."

Failure containment, stage by stage — every one of these leaves V2's own
behavior completely unaffected:

| Stage fails | Result |
|---|---|
| Model/API call (network, timeout, guard rejection) | `none`, logged `parse-failed` with a `REASON_*` reason |
| Response doesn't parse / fails schema validation | `none`, logged `parse-failed` |
| Grounding (evidence/item/number/unit/label not in source) | `none`, logged `grounding-failed` |
| Renderer returns null | do nothing; the durable result is dropped |
| Speech or pen placement advances during rendering | hold the durable result and retry; disposable geometry is discarded |
| Page/session/TTL relevance fails | drop, logged `durable-result-expired` |

None of these paths touch `elementsRef`, `penRef`, the camera, or anything
else V2 owns. A failure is indistinguishable, from V2's perspective, from
Visual Re-entry being off entirely.

## Page placement

Visual Re-entry never invents a layout engine — it reuses the exact page
pen (`Pen`, `lib/ops.ts`) every other write on the page already goes
through, the same `penRef.current` Tier 1 live text (`writeLive`) and math
visuals both advance. Deferred geometry is built against the current pen at
the safe commit opportunity, so `place(pen, w, h, true)` appends the visual
after the latest speech rather than reserving a stale earlier location. It
never reorganizes or moves anything already on the page.

One subtlety this required getting right: `place()` always mutates
whatever pen it's given, but Visual Re-entry's decision is asynchronous and
may finish after the pen has already moved on — a build that's about to be
discarded as stale must not be allowed to silently perturb where the NEXT
piece of live content lands. `lib/visualReentry/orchestrate.ts` therefore
builds against a disposable clone of the pen, and only copies that exact
reservation onto the real, shared pen at the moment it actually commits
(`Object.assign(ctx.pen, penSnapshot)`), guarded by the same freshness
check. A discarded build now has zero effect on anything.

## Visual ownership (0 or 1 per thought)

`VisualReentryIntentSchema` is a `z.discriminatedUnion` over exactly three
literal `type`s — structurally, a single `decide()` call can only ever
return `none` or exactly one of the two shapes; there is no representable
JSON that carries both an `enumeration` and a `quantitative_change` at
once, and `.strict()` rejects a payload that tries to smuggle one shape's
fields onto another. Combined with "one LLM call per settled thought"
(Part 4), this makes "at most one visual per thought" a structural
guarantee, not a runtime check that could be forgotten. The prompt also tells the model explicitly: when a thought hints at more
than one shape at once (e.g. "There are three things. First, users went
from 10 to 20...") — pick the one shape that adds the most explanatory
value, or answer `none` if unsure which. Never split one thought into more
than one visual.

## Camera contract

Visual Re-entry does not reintroduce continuous camera chasing. It reuses
V2's own camera contract (`docs/LIVE-SPEECH-PRESENTATION-V2.md`) rather
than adding new camera logic:

- After a normal safe-window commit, `revealIfNeeded()` (`components/Board.tsx`) runs
  the exact same pure containment check V2's live-line follow decision
  already uses — `liveLineFitsViewport` (`lib/composition.ts`) — against
  the visual's own placed bounds.
- **Already visible → no camera move.** `revealIfNeeded` simply returns.
- **Not visible → at most one deliberate reframe request**, via the same
  `framePage(false, reason)` call structural diagrams already use
  elsewhere in `Board.tsx` (no forcing, no focal element/concept override).
- `framePage` itself already refuses to execute — deferring the request
  into its existing `pendingReframeRef` slot instead — whenever
  `liveCameraHoldRef` is up, i.e. whenever active speech exists. Visual
  Re-entry doesn't need to know or check this itself; it is exactly the
  "defer/suppress while active speech exists" and "discard if stale"
  behavior V2's camera contract was already built to provide.

A visual is asked for at most one camera request, ever — `revealIfNeeded`
is called exactly once per committed visual, and only calls `framePage` at
all when the visibility check actually fails.

A quiet commit never calls `framePage`. While speech retains attention, the
visual is appended locally after settled content and logs `camera-suppressed`;
it does not request a reveal even when outside the current viewport.

## Feature flag / activation

- Flag: `features.visualReentryV1` in [`lib/features.ts`](../lib/features.ts).
  Default: `false`. Meaningless without V2 — `isVisualReentryV1Enabled()`
  always returns `false` when `isLivePresentationV2Enabled()` is `false`,
  regardless of this flag or the dev override below.
- Dev override: with `NODE_ENV !== "production"`, append `?vr=1` **together
  with** `?v2=1`. Production ignores both query params and reads only the
  committed flag values.

```
http://localhost:3210/try                legacy Standard Mode
http://localhost:3210/try?v2=1           V2, no Visual Re-entry
http://localhost:3210/try?v2=1&vr=1      V2 + Visual Re-entry V1
```

## Model

`VISUAL_REENTRY_MODEL` (`lib/visualReentry/decide.ts`) reuses `SCRIBE_MODEL`
exactly — Haiku, the fastest/cheapest model already routed in this codebase
— not just its default string, so the existing `provider_rate_cards` row
already covers it and turning this on needs no new billing configuration
(same reasoning `MATH_MODEL`'s doc comment in `lib/llm.ts` gives for reusing
`ARTIST_MODEL`). Latency matters more than depth for a single structured
"none or one of two shapes" decision.

## Instrumentation

`{ type: "visual-reentry", event, thoughtId, reason, decisionLatencyMs, renderLatencyMs, sourceExcerpt }`
log events (`lib/types.ts`), emitted through the same `log()` used
everywhere else in `Board.tsx`. `sourceExcerpt` is a fixed-length (80 char)
truncation of the thought's own text — never a full model prompt/payload.

| Event | Meaning | Notable fields |
|---|---|---|
| `thought-received` | A settled thought reached the pipeline. | `sourceExcerpt` |
| `candidate-accepted` / `candidate-rejected` | The cheap local launch gate admitted or stopped the thought. | `reason` |
| `evidence-held` / `evidence-combined` | An incomplete supported pattern entered the bounded window, or two settled thoughts completed one candidate. | `reason` |
| `request-suppressed-in-flight` | A candidate was not launched because one request already owns the decision slot. | `reason` |
| `decision-started` | The one decision request was sent. | |
| `decision-none` | The model genuinely decided no visual fits. | `reason` (model's own), `decisionLatencyMs` |
| `decision-enumeration` / `decision-quantitative` | The model chose that shape. | `decisionLatencyMs` |
| `parse-failed` | The pipeline failed to get a usable decision — network/API failure, unparseable response, or schema-invalid payload. Treated identically to `decision-none` downstream, logged separately so the two are never confused. | `reason` (`REASON_*` sentinel) |
| `grounding-passed` / `grounding-failed` | The decided shape did/didn't survive grounding against the source text. | `reason` on failure |
| `durable-result-ready` | A grounded, renderer-independent result entered the durable queue. | |
| `durable-result-held` | Placement is not quiet-safe, or speech/pen state changed during rendering, so the result waits without canvas mutation. | `reason` |
| `durable-result-committed` | The result was placed atomically in a safe window. | |
| `durable-result-quiet-committed` | A previous settled result was placed during the camera hold with zero camera request. | |
| `durable-result-expired` | Generation, page, TTL, or bounded capacity invalidated the result. | `reason` |
| `render-started` / `render-completed` | Geometry build began/finished inside a safe commit attempt. | `renderLatencyMs` |
| `stale-result-dropped` | A reset/teardown abort invalidated an in-flight result. | |
| `camera-requested` | The visual wasn't already visible; one `framePage` reframe was requested (may still be deferred/suppressed by V2's own live-hold gate). | |
| `camera-suppressed` | The visual was already visible, or it committed quietly while speech owned attention; no camera call was made. | `reason` |
| `duplicate-thought-skipped` | Reserved for the ownership guard; not expected to fire in normal operation (see Visual governor). | |

Compare two recordings of the same talk (`?v2=1` vs `?v2=1&vr=1`) and diff
these events plus the existing `"thought"`/`"v2"` events, same method the V2
doc already documents.

## Metrics

Derivable from a session log's `visual-reentry` (and V2's own `"thought"`)
events — no dashboard exists yet, this is the formula reference for when
one is built:

| Metric | Formula |
|---|---|
| `settledThoughtCount` | count of `thought-received` (equivalently, V2's own `"thought"` events for a `?vr=1` session) |
| `candidateAcceptedCount` / `candidateRejectedCount` | counts of the corresponding local gate events |
| `visualDecisionCount` | count of `decision-started` |
| `noneCount` | count of `decision-none` |
| `enumerationCount` | count of `decision-enumeration` |
| `quantitativeCount` | count of `decision-quantitative` |
| `renderedVisualCount` | count of `render-completed` |
| `durableResultReadyCount` / `durableResultHeldCount` / `durableResultCommittedCount` | counts of the corresponding durable lifecycle events |
| `groundingFailureCount` | count of `grounding-failed` |
| `visualResponseRate` | `renderedVisualCount / settledThoughtCount` |
| `averageDecisionLatency` | mean of `decisionLatencyMs` across all `decision-*`/`parse-failed` events |
| `cameraMovesCausedByVisualReentry` | count of `camera-requested` (a request, not a guaranteed move — V2's own `liveCameraHoldRef` may still defer/suppress it; cross-reference the existing `camera-metric` events for the confirmed outcome) |
| `usefulResultRate` | `durableResultCommittedCount / visualDecisionCount` |

We are **not** trying to maximize `visualResponseRate`. A low rate with a
high `groundingFailureCount` would be a real problem (the model is trying
and failing to ground); a low rate with a low `groundingFailureCount` and a
high `noneCount` is simply the hypothesis working as intended.

## Manual test matrix

Automatable coverage stops at grounding/rendering/schema/ownership — the
decision call itself needs a real voice and a real settled-thought
lifecycle, so this matrix is prepared here for manual execution, not run as
part of this change. Speak each line as a single settled thought (pause
naturally afterward) with `/try?v2=1&vr=1` open:

| # | Say | Expected |
|---|---|---|
| A | "I'm still figuring out exactly how I feel about this." | V2 text only. No additional visual. |
| B | "There are three things we need to improve: speed, accuracy and presentation." | V2 text as normal, then ONE clean 3-item enumeration. |
| C | "I've been thinking about users, pricing and the website all day." | Prefer V2 text only — several nouns is not a presented list. |
| D | "We had ten users last week and twenty users this week." | ONE grounded quantitative_change visual. |
| E | "Users increased dramatically this week." | V2 text only. No invented graph, no invented values. |
| F | "Marketing brings traffic and traffic creates signups." | V2 text ONLY — relationship visuals are out of scope for V1. |
| G | "Our company has engineering, marketing and sales." | V2 text only, unless clearly presented as a flat list rather than a hierarchy. |
| H | "I think maybe pricing is hurting conversion, but I'm not really sure." | V2 text only. |
| I | Say B, then immediately keep talking without pausing. | New active speech stays dominant; no camera yank; the visual either lands quietly, waits, or is suppressed. |
| J | Speak naturally for 60-90 seconds on any topic. | V2 remains the dominant experience; a visual appears occasionally, not constantly. |

## What V1 does NOT solve

Same list V2 already excludes, still excluded here: visual intent beyond the
two supported families, diagrams, hierarchy, cause/effect, relationship
grounding, discourse revision, Story Mode, autonomous choreography. These
remain the responsibility of a future, separately-evaluated visual layer —
decided from the recorded V1 session, not implemented speculatively now.

## Acceptance criteria

V1 is not complete unless every one of these holds:

1. Pure V2 still behaves exactly as before with `visualReentryV1=false`. — unchanged code paths; V2's own 20-check test suite still passes untouched.
2. Tier 1 latency architecture is untouched. — the visual-reentry job starts inside `writeLiveDone.then()`, never awaited by `handleFinal`/`writeLive`.
3. Visual intent runs only after settled thoughts. — only constructed at the exact point `pushStructuralSegment` reports `pushed.thought` truthy.
4. No old autonomous producer has been re-enabled. — Reflex/Scribe/Beat/Artist/Director/Math remain exactly as suppressed under V2 as before; nothing in this feature touches those gates.
5. `none` works naturally. — the default, expected, unpenalized outcome throughout the prompt, schema, and grounding.
6. Enumeration is grounded. — evidence AND every individual item checked against the source.
7. Quantitative values are grounded. — `from`/`to` (plus "twenty thousand"-style figures), `unit`, `fromLabel`, `toLabel` all checked against the source.
8. No numbers are invented. — grounding fails closed to `none` on any unsupported number; the prompt explicitly forbids derived/percentage values.
9. No model emits geometry. — the schema has no x/y/width/height/position field anywhere; asserted directly in tests.
10. One thought produces at most one response. — structural (discriminated union + a single decide call), not just a runtime check.
11. Active speech remains visually dominant. — no camera move, no pen mutation, no delay ever touches Tier 1; a discarded build cannot perturb the shared pen.
12. Visual Re-entry never causes continuous camera chasing. — at most one `framePage` request per committed visual, reusing V2's own hold gate.
13. Failed AI/validation/rendering leaves the V2 page intact. — every failure stage does nothing and returns; nothing partially commits.
14. Feature can be turned completely off. — `features.visualReentryV1: false` (default) plus the V2-gate in `isVisualReentryV1Enabled()`.
