# Self-Expressive Visual Agent V0 — Evaluation

Dev-only, isolated experiment. Not integrated into any production path. See
`planning/specs/SELF-EXPRESSIVE-AGENT-V0.md` for what was built and why.

## Method

`scripts/self-expressive-agent-v0-eval.mjs` (opt-in, `RUN_SELF_EXPRESSIVE_V0=1`)
runs the real `lib/communicator/` loop — real `decideWithCommunicatorModel`
(Sonnet 4.6) decision calls, real `shapeVisualIntent` (Haiku 4.5) shaping
calls, real `ExpressionLiveController` with `enableIdentityLayer: true`
(matching production), real `VisualActionDispatcher` — against the same
synthetic in-memory canvas harness used by the prior live evaluation. Each
of the three demonstration prompts starts from a **completely empty
WorldState** — no seed content, no visual instruction, only the prompt text
as both `userMessage` and `communicationGoal`. A deterministic smoke test
(`scripts/communicator-smoke-test.mjs`, 3/3 pass, no paid calls) verified the
wiring — speak-then-done, invalid-decision blocking, and unknown-target
rejection — before any paid run.

**Cost:** 9 total model calls (6 decision, 3 shaping), 10,531 input / 1,819
output tokens, **≈$0.04** (public list pricing). Cheap because every
scenario stopped after exactly one visual step — see Finding 3.

Raw trace: `evaluation/reports/self-expressive-agent-v0-raw.json`.

## Demonstration 1 — "Explain why an AI startup can gain users while becoming financially weaker."

**Decision (1 step, then done):** `speak_and_visualize` —

> "Each new user actually costs the startup money — inference, compute, and
> storage aren't free. So as the user base grows, the cash burn accelerates.
> Revenue rarely keeps pace because AI products are often free or heavily
> subsidized to win market share. The result: more users, less runway."

Intent: `{goal: "user growth and financial health move in opposite
directions... costs outpace revenue and cash reserves shrink", form:
"tension"}`.

**Shaped meaning:** 5 entities (User Growth, Operating Costs, Revenue, Cash
Reserves, AI Startup), 2 relations: `User Growth --contrasts_with--> Cash
Reserves`, `Operating Costs --prevents--> Cash Reserves`.

**Rendered:** intent `compare`, grammar **`comparison`** — two poles set
side by side with no arrow between them (the arrangement itself is the
contrast, per `lib/expression/grammars/index.ts`'s `comparison` grammar).

**Assessment:** the strongest result of the three. The communicator
correctly identified this as fundamentally a magnitude/tension idea rather
than a literal causal chain (it didn't draw "users → usage → cost → cash" as
a pipeline, which the task's own illustrative sketch suggested but did not
require), and the deterministic composer rendered it as a true positional
comparison, not a generic flow diagram. `Revenue` was extracted as an entity
but never actually appears in a relation — a real, minor loss (it's part of
the "costs outpace revenue" framing but the shaped delta only connected cost
to cash reserves, dropping the revenue side of the contrast entirely).

## Demonstration 2 — "Explain why three teams that do not communicate create organizational problems."

**Decision (1 step, then done):** `speak_and_visualize`, intent `{goal:
"Three teams isolated from each other... showing that the absence of
connection is itself the problem", form: "tension"}` — **not** `"spatial"`.

**Shaped meaning:** 8 entities (Team A/B/C, Isolation from each other,
Duplicated effort, Misaligned goals, Gaps in ownership, Cross-team
coordination), 8 relations: one `contrasts_with` and one `prevents` (both
Isolation → Cross-team coordination), three `causes` (Isolation → each
problem), three `refutes` (each problem → Cross-team coordination).

**Rendered:** intent `argue` (the three `refutes` edges dominated
`classifyIntent`'s scoring, correctly outscoring the causal edges), grammar
**`process`** — reached via Expression's own evaluate/repair layer
overriding the initial `GRAMMAR_FOR_INTENT["argue"]` chain
(`["hierarchy","relationship"]`), not a communicator choice. `process`
implies a single subject moving through successive states, which is not
what this content is (a root cause fanning out to three consequences —
structurally a hierarchy/fan-out, or a causal branch).

**Assessment:** the intended test — does the communicator reach for
`spatial` and render three separated regions — did **not** happen. The
model chose `tension` again, and the three named teams (Team A/B/C) never
received any relation to each other or to "Isolation" at all — they sit in
the shaped delta as free-floating entities with no connecting structure,
which is arguably an accidental, unintended approximation of "separateness"
(nothing links them) rather than a deliberate spatial decision. The
resulting `process` grammar is a poor semantic fit for a fan-out-of-causes
idea. This is the weakest of the three results.

## Demonstration 3 — "Explain the trade-off between moving quickly and maintaining accuracy."

**Decision (1 step, then done):** `visualize` (no accompanying speech this
time), intent `{goal: "Speed and accuracy pulling against each other as
opposing forces — the faster you go, the less accurate you are, and vice
versa", form: "tension"}`.

**Shaped meaning:** 6 entities (Speed, Accuracy, Increased/Decreased Speed,
Increased/Decreased Accuracy), 3 relations: `Speed --contrasts_with-->
Accuracy`, and a **mutual pair** — `Increased Speed --prevents--> Increased
Accuracy` and `Increased Accuracy --prevents--> Increased Speed`.

**Rendered:** intent `explain_causality`, grammar **`cause_effect`**.

**Assessment: this is exactly the failure mode the task named by name.**
`prevents` is classified as a *causal*-family relation type in
`lib/expression/schemas.ts`'s `RelationTypeSchema` grouping, and
`lib/expression/intent/classify.ts`'s `PRIORITY` tie-break list ranks
`explain_causality` above `compare`. The two `prevents` edges gave the
causal score a count of 2, tying the one `contrasts_with`'s comparative
score of 2 — and `explain_causality` won the tie-break by priority order,
not by better fitting the idea. The result was a directed causal chain for
an idea that is explicitly **not** directional — "the faster you go, the
less accurate you are, and vice versa" is symmetric, and a chain grammar
asserts a direction the sentence never claimed. This is traceable directly
to this experiment's own `lib/communicator/shape.ts` `FORM_GUIDANCE.tension`
prompt, which recommends exactly this `contrasts_with` + `prevents`
combination — a bug in the new shaping prompt, not in Expression's existing
classifier.

## Findings

### Finding 1 (positive) — the communicator visualized without being told to, every time, efficiently

Zero user instructions to draw/show/connect/visualize appeared in any of the
three prompts. All three produced a `visualize`/`speak_and_visualize`
decision as their very first move, and all three then correctly returned
`done` rather than padding the run — no wasted steps, no repeated identical
visuals, no runaway continuation. `runCommunicator`'s stall guard and step
budget were never even exercised because nothing went wrong; every run
completed cleanly in exactly 2 decision calls (one act, one confirming
done).

### Finding 2 (negative, central) — the communicator converged on one form ("tension") for all three prompts, including the one the task specifically wanted to test for `spatial`

This is the closest this run came to the task's named strong-failure signal
("if all three demonstrations become boxes/arrows/labels... failed"). It
did not literally happen — Demonstration 1 rendered as a genuine positional
`comparison`, not boxes-and-arrows — but 2 of 3 (`process`, `cause_effect`)
did land on generic flow-chain grammars, and the model never once reached
for `spatial`, `causal` (as its own distinct choice — the causal outcome in
Demo 3 was a side effect of the tension-shaping prompt, not a deliberate
`form: "causal"` decision), `magnitude`, or `process` (as a deliberate
choice) across three meaningfully different prompts. `aboutEntityIds` was
also empty in every decision — unsurprising, since every scenario started
from a blank world, but it means the model never had to exercise the
"which existing entities is this about" judgment at all.

### Finding 3 (methodology gap, not a communicator failure) — this run cannot answer "did it transform/recompose"

Every scenario started from an empty `WorldState` and stopped after one
visual step. `recompose` and `emphasize` were never chosen, not because the
communicator declined them in favor of appending, but because there was
nothing yet to recompose or emphasize, and the run ended before any
follow-up turn could test that judgment. The deterministic smoke test
confirms `emphasize` and the recompose code path both work mechanically
(dispatch through the existing `focus` action; restatement through
`express`), but **this specific evaluation produced zero live evidence,
positive or negative, of transformation-over-generation in practice.** A
proper test needs a second turn per scenario — e.g., after Demonstration 1's
comparison renders, a follow-up like "and this problem gets worse as they
scale" should prefer `recompose`/`emphasize` over a fresh `visualize`. That
follow-up was not run in this pass; flagged as the immediate next step
before drawing a conclusion either way on transformation.

### Finding 4 (bug in this experiment's own shaping prompt) — `tension`'s `prevents` recommendation collides with the existing causal-family classification

Documented in Demonstration 3. `lib/communicator/shape.ts`'s
`FORM_GUIDANCE.tension` tells the shaping model to add a `prevents`
relation, but `prevents` is one of Expression's own four causal relation
types (`causes/enables/prevents/depends_on`,
`lib/expression/schemas.ts`), so two `prevents` edges reliably tip
`classifyIntent`'s tie-break toward `explain_causality` over `compare`,
producing a directional chain for a symmetric trade-off. **Not fixed in
this pass**, in keeping with the task's "do not integrate, do not extend
production" instruction and because this is this experiment's own new
prompt, not existing production code — but it is a concrete, well-diagnosed
bug with an obvious candidate fix (steer `tension` toward `contrasts_with`
plus a `spatial`/`role` qualifier instead of `prevents`, or accept that
`tension` may need its own eleventh grammar rather than borrowing
`comparison`'s). Flagged for the first thing to fix before running this
experiment again.

## Answers

**1. Did the agent independently choose when visual communication was useful?**

**YES**, clearly. Zero draw/show/visualize instructions appeared in any
prompt; all three decisions were `visualize` or `speak_and_visualize` as the
very first move, chosen from nothing but the communication goal. The
mechanism the task asked for — "This idea needs a visual," arrived at
without being told — is demonstrated, not simulated: `lib/communicator/`
never received a scripted decision in the paid run, and the deterministic
smoke test proves the loop respects whatever the model actually decides
(including `speak`-only or `done`-immediately, neither of which happened
here, but both of which the loop supports and would have honored).

**2. Did it independently choose different visual forms for different meanings?**

**NO — not demonstrated, and the negative result is real.** All three
distinct prompts (a magnitude/trade-off startup story, a "three silent
teams" prompt written specifically to invite `spatial`, and an explicit
trade-off written to invite `tension`) produced the identical `form:
"tension"` decision. The one prompt that most obviously called for
`spatial` (Demonstration 2) did not receive it. Whether this reflects a
genuine gap in the decision model's range or an artifact of the six-form
menu (with `tension` and `comparison` overlapping enough that the model
defaults to the newer, more specific-sounding label) cannot be told apart
from three runs; it needs a larger prompt set and probably a clearer
distinction between `tension` and `comparison` in the decision prompt to
answer properly.

**3. Did it transform/recompose existing visuals instead of only appending?**

**UNDEMONSTRATED.** No scenario ran long enough to test this — every run
started empty and stopped after one visual. This is a gap in this
evaluation's scenario design, not evidence the communicator can't or won't
do it; the mechanical path (`recompose`/`emphasize` both dispatch through
existing, already-tested `VisualAction`s) works, per the deterministic smoke
test. The honest answer is: not yet shown either way, and this is the
single most important thing to test before this experiment can claim more
than it currently does.

**4. Did the resulting canvas feel like an AI communicating visually rather than an AI generating diagrams?**

**PARTIALLY.** The entity/relation choices show real conceptual translation
rather than transcription — "Isolation from each other" as a first-class
named state, a mutual `prevents` pair for a symmetric trade-off (even though
the resulting grammar mishandled it), "Cash Reserves" standing in for
"financially weaker" — these are judgments about what the idea IS, not
restatements of the prompt's nouns. That is genuine signal toward "a visual
language," not diagram generation from a template. But two of three
renders (`process`, `cause_effect`) are conventional box-and-arrow flow
diagrams despite the communicator explicitly asking for something else
(`tension`), because the deterministic grammar/classifier layer this
experiment deliberately reused has its own, sometimes conflicting, opinion
about what a set of relation types means. The idea behind the picture is
more expressive than the picture that actually rendered, in two of the
three cases.

## Overall verdict

Promising, not proven. The autonomous "when to visualize" decision — the
part of this experiment closest to a genuinely new capability — worked
cleanly and consistently across all three tests with no scripting and no
user hints. The "which form" decision did not yet show range, and one
concrete, fixable bug in this experiment's own shaping prompt (Finding 4)
degraded a form choice that was conceptually correct into a rendering that
contradicted it. Transformation-over-generation remains untested. This
result justifies a second, larger pass — more prompts, at least one
multi-turn scenario per prompt to exercise recompose/emphasize, and Finding
4's fix — before any claim that InPublic has "a visual language" rather
than "an AI that now also decides when to draw."

## Explicitly not done

No change to any production file. `lib/communicator/` is unreachable from
`components/Board.tsx`, `lib/interaction/`, or any live-speech path.
`classifyLiveInteraction` routing is unmodified. No new `VisualAction`
types were added — `emphasize` reuses `focus` verbatim, and
`visualize`/`recompose`/`speak_and_visualize` all resolve through the
existing `express` action. This experiment answered the question it set out
to answer and stops here.
