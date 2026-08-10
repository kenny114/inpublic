# Event schema

InPublic's existing event/action system (`lib/actions.ts`, `CanvasAction`)
already met most of the brief's requirements before this work: each action is
schema-shaped (hand-validated, not zod), atomic (one action, one board
change), reversible (every mutation goes through `recordOperation`/
`UndoRecord`), idempotent in the sense that reapplying a `create_concept` for
an existing concept reuses it rather than duplicating, and safe to discard
(`parseAction` returns `null` for anything malformed — dropped, never
thrown). See the architecture audit for the full account of the existing
`create_concept` / `create_relationship` / ... action set and how
`planActions` (`lib/organizer.ts`) resolves reuse-vs-adopt-vs-create.

This document covers only what's new: the six math actions layered onto that
same union.

## Math actions (`lib/math/actions.ts`)

Unlike the rest of `CanvasAction`, these are validated with **zod**
(`MathActionSchema`, a discriminated union on `type`) rather than hand-coded
field coercion. That's a deliberate, scoped exception — see
`lib/math/actions.ts`'s file comment for why: a malformed `value` on a math
step would produce a wrong-but-confident-looking verification result if
silently coerced, which is a worse failure mode than the generic actions'
existing "drop a bad field" tolerance.

| Action | Fields | What it does |
|---|---|---|
| `create_equation` | `conceptId, expression, domain, topic?, goal?` | Starts a new equation/graph concept. `domain` is one of `linear_equation \| fraction \| coordinate_graph \| word_problem`. |
| `transform_equation` | `conceptId, step: {operation, value?, from, reason, before, result, commonMistake?, connection?}` | One step. `before` MUST be the literal current expression on the board — verification (`lib/math/verify.ts`) recomputes what `operation`/`value` actually produces from `before` and compares it structurally to `result`. Creates a NEW concept (kind `math_step`) linked to the previous one by a relationship, so each step is its own visible, undoable object. |
| `add_math_explanation` | `conceptId, meaning, invariant` | Attaches a note-style explanation near a concept. |
| `create_math_visual` | `conceptId, visual: MathVisualSpec` | Draws one of the deterministic visual types (see `docs/math-reasoning-schema.md`). |
| `verify_step` | `conceptId, verified, detail?` | Explicitly (re-)sets a step's verified flag — for correction flows that don't restate the whole step. |
| `correct_math_step` | `conceptId, correctedResult, reason` | Overwrites a step's result after an explicit correction ("scratch that, it should be negative"). |

## Commit and revert

Math actions are executed by the same `applyAction` switch in `Board.tsx`
that every other `CanvasAction` goes through, and reuse the **existing**
`OperationType` values (`create_concept`, `create_relationship`,
`update_concept`) rather than inventing new ones — `revertOperation` is
driven entirely by the generic `UndoRecord` fields (added element/concept/
relationship ids, removed-concept snapshots), not by `op.type`, so undo works
for math steps with no changes to the revert logic at all.

Concretely: `transform_equation` produces one `create_concept` operation (the
new step box) and, when it successfully links to a prior step, one
`create_relationship` operation (the connecting arrow) — both independently
undoable, in order, exactly like any other two-part Artist action.

## Verification is separate from parsing

A math action parsing successfully (`parseMathAction` returns non-null) says
nothing about whether the mathematical claim is *correct* — that's
`lib/math/verify.ts`'s job, run client-side in `applyAction`'s
`transform_equation` case, deterministically, independent of what the model
claimed. An unverified step still commits (so the board doesn't stall), but
visibly: `buildMathStepBox` draws it with a dashed amber outline instead of
solid blue. See `docs/math-reasoning-schema.md` for the verification
contract.
