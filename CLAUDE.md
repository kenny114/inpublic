# InPublic

InPublic turns meaning into live visual expression.

This file is a router. Read the context nearest the work; use `/audit` only for deeper historical evidence.

| Task | Go to | Read |
| --- | --- | --- |
| Architecture/design | `/planning` | `CONTEXT.md` |
| Implementation/bug | `/lib` | `CONTEXT.md` |
| Visual/model evaluation | `/evaluation` | `CONTEXT.md` |
| Understand current/previous architecture | `/audit` | relevant audit document |
| Excalidraw behavior/API | `/references/excalidraw` | `SOURCE.md`, then upstream source |

## Invariants

1. LLM output does not directly own raw Excalidraw geometry.
2. Meaning/state is independent of rendering technology.
3. Excalidraw-specific implementation belongs behind the Canvas boundary.
4. `Board.tsx` is application wiring, not a home for new domain logic.
5. Existing Expression Engine behavior must not be casually rewritten during architectural extraction.
6. Architectural ownership must be defined before adding substantial features.
7. Current upstream Excalidraw source is authoritative for Excalidraw behavior.
