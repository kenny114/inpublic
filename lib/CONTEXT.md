# Implementation Context

`lib/` contains product and domain implementation. Preserve the working Expression Engine while ownership is clarified; this phase does not reorganize it.

## Where changes belong

- Speech transport and transcript settling: `hooks/useDeepgram.ts`, `hooks/useGeminiLive.ts`, and speech-focused `lib/` modules.
- Meaning, identity, references, and semantic relationships: `lib/expression/meaning/` and `lib/expression/world/` today.
- Visual intent, planning, composition, evaluation, and repair: the corresponding `lib/expression/` stages.
- Canvas contracts and current Excalidraw conversion, reconciliation, identity, viewport application, and read-only structural observation: `lib/canvas/`; consult `/references/excalidraw/SOURCE.md` before changing them. Files in `lib/expression/render/excalidraw*.ts` are compatibility exports only.
- Durable session/project state: `lib/persist.ts`, `lib/sessions.ts`, and project APIs.
- Application wiring: `components/Board.tsx`; do not add new domain logic there.

## Dependency rules

LLMs produce semantic intent, never raw canvas geometry. Meaning and state remain independent of rendering technology. Excalidraw-specific behavior belongs behind the Canvas boundary. Expression owns form and deterministic planning; Canvas owns current editor conversion, reconciliation, identity, scene application, viewport application, and normalized structural snapshots. `CanvasObservation` is not consumed by Meaning, WorldState, intent, or agent reasoning yet, and observation must not mutate either semantic or canvas state. Existing behavior must be protected by appropriate deterministic, browser, live-model, or human evaluation.

Before adding a substantial capability, read `/planning/CONTEXT.md`, define its owner, and write a spec or ADR when the change establishes behavior or architecture.
