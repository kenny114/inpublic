# Planning Context

## The work

InPublic turns meaning into live visual expression. The product goal is a live visual expressive agent that can understand input, inhabit and observe an Excalidraw canvas, act on existing visual structures, evaluate the result, and continue, repair, or stop.

Today the primary runtime is speech through Deepgram, wired by `Board`, into the Expression Engine and then Excalidraw. The engine's durable foundation is semantic model output, `WorldState`, deterministic geometry, incremental `RenderPatch` rendering, an evaluate/repair layer, and a centralized text-model provider.

Known gaps are: no live canvas perception; `WorldState` is not durable across reloads; `Board.tsx` still owns too much wiring and domain behavior; Canvas ownership is fragmented; the agent runtime is not yet a full observe-act-observe loop; and browser coverage is intentionally minimal.

The target conceptual ownership boundaries are Speech, Meaning, Expression, Canvas, Agent, Session, and App. Define ownership and dependency direction before extracting code. Do not move the repository wholesale into those names.

## Process

- A spec in `specs/` defines observable behavior, constraints, and evaluation before substantial feature work.
- An ADR in `decisions/` records an accepted architectural choice, its context, consequences, and superseded decisions.
- `architecture/CURRENT.md` describes only the stripped system that runs now.
- `architecture/TARGET.md` describes conceptual direction, not a premature interface or class design.

## Recovery point

- Branch: `expression-engine-default`
- Commit at documentation start: `072e5c56233da4f0aae126c4383f1843f235f672`
- Working tree: intentionally dirty; it contains the completed Phase 1/2 strip-down and active Expression Engine work.
- Tag: none. `inpublic-barebones-v0` was not created because a Git tag can point only to the committed `HEAD`, which does not contain this working-tree baseline and would therefore be a misleading recovery point.
- Recovery evidence: `STRIP_DOWN_REPORT.md`, the working-tree diff, and the verification record in `architecture/CURRENT.md`.
