# Implementation Context

`lib/` contains product and domain implementation. Preserve the working Expression Engine while ownership is clarified; this phase does not reorganize it.

## Where changes belong

- Speech transport and transcript settling: `hooks/useDeepgram.ts`, `hooks/useGeminiLive.ts`, and speech-focused `lib/` modules.
- Meaning, identity, references, and semantic relationships: `lib/expression/meaning/` and `lib/expression/world/` today.
- Visual intent, planning, composition, evaluation, and repair: the corresponding `lib/expression/` stages.
- Canvas contracts and current Excalidraw conversion, reconciliation, identity, viewport application, and read-only structural observation: `lib/canvas/`; consult `/references/excalidraw/SOURCE.md` before changing them. Files in `lib/expression/render/excalidraw*.ts` are compatibility exports only.
- Durable session/project state: `lib/persist.ts`, `lib/sessions.ts`, and project APIs.
- Expression's versioned persistence schema and validation: `lib/expression/persistence.ts`; Session carries its output as `PersistedSession.expressionState` but must not interpret entity-resolution semantics.
- Exact-id semantic action primitives: `lib/expression/actions.ts`. Geometry-free public action validation and semantic/presentation routing: `lib/visual-actions/`.
- Bounded observe-decide-act orchestration, compact model context, strict decisions, result feedback, and stop behavior: `lib/agent/`.
- Application wiring: `components/Board.tsx`; do not add new domain logic there.

## Dependency rules

LLMs produce semantic intent, never raw canvas geometry. Meaning and state remain independent of rendering technology. Excalidraw-specific behavior belongs behind the Canvas boundary. Expression owns what `WorldState` means, including its versioned persistence validation; Session owns storing/restoring that envelope through the existing project lifecycle. Expression exposes snapshot/restore seams rather than leaking persistence logic into `lib/persist.ts`. Canvas owns current editor conversion, reconciliation, identity, scene application, viewport application, and normalized structural snapshots. `CanvasObservation` is consumed only by Agent orchestration and presentation execution; it remains absent from Meaning, WorldState folding, intent, and Expression. Observation itself must not mutate semantic or canvas state. Existing behavior must be protected by appropriate deterministic, browser, live-model, or human evaluation.

`VisualAction` is the public control vocabulary. Semantic actions target stable semantic ids, update WorldState first, and re-enter Expression; presentation actions may use Canvas directly without mutating meaning. The dispatcher may depend on Expression and Canvas, but Expression/Meaning must not depend on the dispatcher or CanvasObservation. Action schemas must never expose raw geometry or editor operations. No model belongs in validation or dispatch.

Agent may depend on WorldState types, ScenePlan identity, CanvasObservation, and the VisualAction dispatcher. Meaning, Expression, Canvas, and VisualAction must not depend on Agent. Agent decisions contain one existing VisualAction or a terminal state; the deterministic loop must re-observe after every action, enforce a hard budget, and return a structured terminal result. Provider prompting stays separate from loop execution. Continuous speech retains the direct Expression path.

Before adding a substantial capability, read `/planning/CONTEXT.md`, define its owner, and write a spec or ADR when the change establishes behavior or architecture.
