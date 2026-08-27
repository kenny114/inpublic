# Planning Context

## The work

InPublic turns meaning into live visual expression. The product goal is a live visual expressive agent that can understand input, inhabit and observe an Excalidraw canvas, act on existing visual structures, evaluate the result, and continue, repair, or stop.

Today the primary runtime is speech through Deepgram, wired by `Board`, into the Expression Engine and then Excalidraw. The engine's durable foundation is semantic model output, `WorldState`, deterministic geometry, incremental `RenderPatch` rendering, an evaluate/repair layer, and a centralized text-model provider.

Current structural canvas perception is consumed by one bounded visual-agent loop for explicit instructions. `WorldState` is durable across reload/project reopen. The Agent sees compact WorldState plus actual CanvasObservation, returns one strict geometry-free `VisualAction` or a terminal decision, executes through the deterministic dispatcher, re-observes, and stops under budget/stall rules. Canvas now renders that loop's ephemeral lifecycle and semantic-target attention without adding canvas elements, semantic state, editor state, or model calls. Known gaps are: no generic Canvas/WorldState reconciliation; no semantic placement constraints; no continuous-speech agent policy; no external agent bridge; `Board.tsx` still owns too much wiring; visual diff caches do not survive reload; and browser coverage remains intentionally focused.

The target conceptual ownership boundaries are Speech, Meaning, Expression, Canvas, Agent, Session, and App. Define ownership and dependency direction before extracting code. Do not move the repository wholesale into those names.

## Process

- A spec in `specs/` defines observable behavior, constraints, and evaluation before substantial feature work.
- An ADR in `decisions/` records an accepted architectural choice, its context, consequences, and superseded decisions.
- `architecture/CURRENT.md` describes only the stripped system that runs now.
- `architecture/TARGET.md` describes conceptual direction, not a premature interface or class design.

## Recovery point

- Branch: `expression-engine-default`
- Phase 6 checkpoint commit: `e191601111ae5e3cefd567aef52e3cd38d524638`
- Branch: `expression-engine-default`
- Tag: `inpublic-barebones-v0`
- The checkpoint truthfully contains the completed strip-down, architecture/control-plane, Canvas boundary, and Canvas perception phases. Phase 6 durable-memory work begins after it.
- Phase 8 agent-core checkpoint commit: `ddddef7eadca4b35d4d941837b89e27fa0437e56`
- Tag: `inpublic-agent-core-v0`
- Phase 9 begins from that clean checkpoint.
