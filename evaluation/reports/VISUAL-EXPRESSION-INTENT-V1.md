# Visual Expression Intent V1 Evaluation

Date: 2026-08-27. Primary local model: `qwen3:1.7b`. Second opinion for the
failed two-turn behavior: `qwen3:4b`. Ollama `0.33.1`, CPU-only. Remote calls:
zero in both live-model runs.

Raw traces:

- `evaluation/reports/visual-expression-intent-v1-raw-qwen3-1.7b.json`
- `evaluation/reports/visual-expression-intent-v1-raw-qwen3-4b.json`

## Deterministic critical test

`npm run test:expression-intent` passes five groups:

1. A single frozen WorldState containing user growth, usage growth, cost,
   revenue, temporal order, and causal meaning was rendered as `existing`,
   `process`, `magnitude`, and `comparison`.
2. WorldState SHA-256, semantic entity ids, and relation records were identical
   after every recomposition.
3. The actual grammar sequence was `cause_effect`, `sequence`, `quantity`,
   `comparison`; all four ScenePlan hashes differed.
4. Incompatible `magnitude` and `causal` requests fell back to `relationship`
   without numbers or causes. `spatial/separated` produced a different layout
   without adding `located_at`.
5. A two-turn Revenue/Cost case updated the existing semantic ids with 20 and
   80, then recomposed to `quantity`; no duplicate Revenue or Cost appeared and
   the WorldState hash was identical immediately before and after recomposition.

Strict schema checks reject geometry on PresentationIntent and
`recompose_expression`. The repeated-speech test delivers once, rejects the
first exact repeat with explicit feedback, and terminates stalled on a second
repeat.

## Primary qwen3:1.7b behavior

Each of the three required explanation prompts began with a small relevant
visual world rather than an empty canvas. The communicator was not told a
visual form.

| Scenario | Visualized | Terminal | Forms selected | Rendered grammar | Exact speech repeat |
|---|---:|---|---|---|---:|
| AI startup gains users / weakens financially | yes | completed | spatial, then process | relationship fallback | yes; rejected once, then model chose done |
| three non-communicating teams | yes | step_limit | spatial | relationship fallback | yes on final step; rejected |
| speed vs accuracy | yes | stalled | comparison | relationship fallback | no |

All executed render steps scored semantic preservation `1.0` and reported no
invented relation ids. PresentationIntent reached Expression on every executed
visual step. Fallback grammar was honest: the shaping model did not invent the
relations merely needed by the requested visual form.

Recognizability was mixed to poor. The model repeatedly selected scopes that
were too narrow (often one entity), so `comparison` could not become a two-pole
comparison, and it sometimes copied canvas object ids instead of semantic ids.
The latter is now guarded deterministically and explicitly prohibited in the
prompt. The silent-teams run did request `separated`, but the pre-fix invalid
scope ids prevented that live trace from being evidence of a faithful spatial
render; the deterministic spatial test is the reliable evidence.

The repeated-speech failure is bounded. The model still attempted an exact
repeat, which remains visible as model weakness, but the message was not
delivered twice and the loop did not continue repeating it indefinitely.

## Persistent two-turn result

### qwen3:1.7b

Turn 1 established unique `revenue` and `cost` semantic entities and produced
a separated spatial expression. It then issued real `recompose` decisions on
the existing world. Every recomposition had byte-identical WorldState before
and after; one changed the ScenePlan and later identical ones no-oped/stalled.

Turn 2 correctly reused the same Revenue and Cost ids and added the new
four-times meaning without duplication. It visualized and completed, but chose
`spatial/surrounding`, not `magnitude`. Therefore the expected behavioral
transition from comparison to magnitude did not occur, even though the pure
recomposition mechanism itself worked and semantic identity stayed stable.

### qwen3:4b second opinion

The larger model recognized `magnitude` on turn 2, but performed worse overall:
turn 1 only spoke, repeated that speech once (rejected), and attempted an
`existing` recomposition against an empty world. Turn 2 again spoke and repeated
once, then requested magnitude recomposition with no Revenue/Cost WorldState to
render. No semantic entities were established and no visual change occurred.

Model size changed form recognition but did not fix the scenario. The 4B result
is worse than 1.7B for this loop because it failed to establish meaning first.

## Regression status

Green:

- TypeScript typecheck.
- Visual Expression Intent V1 deterministic tests.
- communicator smoke tests.
- existing VisualAction tests.
- local live-model remote-call assertions (`0`).

The full `npm test` baseline was already red before V1 at the final expression
discovery corpus: three planning failures (two family `role_of` connection
cases and one incremental `apples each` quantity case). V1 does not touch those
fixtures. The post-change full run is compared against that exact baseline
below; this report does not mislabel a pre-existing red suite as green.

## V1 success criteria

| Criterion | Result |
|---|---|
| form changes without semantic mutation | pass deterministically and in real recomposition traces |
| same WorldState, multiple recognizable expressions | pass deterministically (four distinct grammars/ScenePlans) |
| communicator form reaches Expression directly | pass architecturally and in executed traces |
| true recomposition on an existing world | pass |
| qwen no longer endlessly repeats identical speech | pass via explicit reject-once/stall policy; attempts remain observable |
| no raw geometry exposed | pass |
| normal regression status preserved | pass relative to baseline: the full run has the identical three known discovery failures and no new failure |

The architecture and deterministic expression operation satisfy V1. The local
communicator's autonomous form selection does not yet satisfy the desired
behavioral quality bar: 1.7B missed magnitude in the critical natural run and
4B failed to establish the visual world. Per scope, this experiment is not
integrated into normal live speech.

The post-change full `npm test` run reproduced exactly the same final three
`EXPRESSION_PLANNING` failures as the pre-change checkpoint and no additional
failure: 48 discovery forms passed, 3 failed, after all preceding suites were
green.
