# Excalidraw Comparison

## How Excalidraw is embedded today

`components/Board.tsx:7471-7497` mounts `<Excalidraw>` directly, captures the
imperative API (`excalidrawAPI={(instance) => setApi(instance)}`), disables
most of Excalidraw's own UI (`canvasActions: {toggleTheme, export,
saveToActiveFile, loadScene, clearCanvas: false}`, `renderTopRightUI={() =>
null}`), and — notably — sets `onChange={() => {}}`, a **deliberate no-op**
with an explicit comment explaining that Excalidraw's own change events fire
for InPublic's own writes and camera moves too, which would falsely mark the
touch-lock as "user active." All mutation goes through
`apiRef.current?.updateScene(...)` (7+ call sites) — pure imperative-API
usage, no controlled/declarative-elements pattern.

## Comparison table

| InPublic capability | Currently does X | Excalidraw already provides Y | Overlap | Migration opportunity | Migration risk |
|---|---|---|---|---|---|
| Scene/element mutation | Custom signature-based diff (`render/excalidrawSync.ts:planCanvasDiff`, `signatureOf() = JSON.stringify(skeleton)`), explicitly chosen over field-by-field comparison | `updateScene`, Excalidraw's own scene reconciliation | High | Low-value — InPublic's diff is deliberately stricter (idempotent, byte-identical, untouched elements never touch) than what Excalidraw would give for free | Low if left alone |
| Deltas | `RenderPatch` (add/update/remove) computed in `render/core.ts:diffScenes`, entirely custom | Excalidraw doesn't expose a first-class "delta" API beyond `updateScene`'s full-array input | Low | None — this is InPublic's own semantic-diff concept, not reimplementing something Excalidraw offers | N/A |
| Bindings/arrows | Raw `line`/`arrow` skeletons with explicit `points`, **deliberately not bound** (`excalidraw.ts:488-502`); zero `startBinding`/`endBinding`/`boundElements` usage anywhere in `lib/expression` (grep-confirmed) | Native `startBinding`/`endBinding` — auto-reroutes when a bound element is dragged | High (avoided on purpose) | Binding would buy auto-reroute-on-drag; InPublic's own comment states the tradeoff explicitly — binding costs control over element ids, which the stable-id workaround (`applyStableIds`) depends on not fighting | Medium — adopting bindings would require redesigning the stable-id strategy; a human dragging a bound element would silently move it out of sync with `WorldState`'s geometry-free model anyway (see CANVAS_AUDIT.md's "no canvas perception" finding), so binding alone wouldn't fix drift |
| Bounds/collision | Custom `overlaps()` + overlap-separation pass, `compose/compose.ts:756,784` | Excalidraw has no native layout/collision-avoidance system to lean on | None | N/A — this is InPublic-owned by necessity | N/A |
| Frames | Not used at all (grep-confirmed zero `Frame` element usage) | Native frame elements exist | None currently | Possible future use for grouping/pagination, unexplored | Low to explore |
| Viewport/camera | Fully custom — `lib/composition.ts`/`lib/cameraReplay.ts` spring physics, `excalidrawSync.ts`'s overflow/page-turn logic, driven via `updateScene({appState:{scrollX,scrollY,zoom}})` | Excalidraw exposes `scrollToContent`, `appState.scrollX/scrollY/zoom` as the same underlying mechanism InPublic already writes to | High (InPublic's decision logic is custom; the actual mutation is via Excalidraw's own appState) | Already using the native mechanism at the write layer; the *policy* (spring physics, page semantics) is and should remain InPublic's | Low — no unnecessary reimplementation found here, just custom policy on top of the native primitive |
| Selection / pointer events | `onChange` is a no-op; InPublic tracks its own `markPointerInput`/`markUserInput` on the wrapping `<div>` | Excalidraw's `onChange`/`onPointerUpdate` callbacks | Medium (avoided on purpose, with a stated reason) | Low-value to change — the stated reason (self-write false positives) is a real, specific problem with the native callback, not an oversight | Low if left alone; would need careful filtering logic if revisited |
| Scene observation / "AI sees the canvas" | **Does not observe the live scene at all** — see CANVAS_AUDIT.md | Excalidraw exposes `getSceneElements()`/`getAppState()` on the imperative API right now | **This is the one place Excalidraw already provides something InPublic needs but doesn't use** | **High** — a `getSceneElements()` read-back, compared against the engine's last-known `ScenePlan`, could detect human edits (drag/delete) and either reconcile `WorldState` or at least flag drift. Currently no code path does this. | Low to prototype (read-only), higher to decide what to *do* with detected drift (a genuine product/design decision, not just plumbing) |
| Stable element identity | `applyStableIds()` workaround for Excalidraw minting fresh ids on every `convertToExcalidrawElements` call | Not a gap Excalidraw could close from its side — this is inherent to the conversion function's design | N/A | N/A | N/A |
| Collaborator presence / cursor / laser / follow | Not investigated — no multi-user collaboration surface was found anywhere in the traced flows | Excalidraw has native collaboration primitives | Unexplored | Out of current scope — no evidence InPublic has a multi-user story yet | N/A |
| Custom tools/actions | InPublic disables nearly all of Excalidraw's own toolbar/actions (`canvasActions` mostly `false`) — the canvas is presented as a read-mostly rendering surface for the engine's output, not a general drawing tool for the end user | Excalidraw's tool/action system is fully available but intentionally unused | N/A | N/A | N/A |

## Things that must remain InPublic-specific

Per the audit brief's own framing, these should **not** be delegated to
Excalidraw regardless of the comparison above — confirmed by this audit as
genuinely InPublic-owned, novel logic with no Excalidraw equivalent:

- **Meaning understanding** — `meaning/extract.ts`, the sole model call that
  turns speech into `MeaningDelta`.
- **Semantic/world state** — `WorldState`, `world/apply.ts`'s identity/
  lifecycle machinery. No canvas library owns "what does this graph of
  entities and relations mean."
- **Visual intent / form selection** — `intent/classify.ts`,
  `composition/plan.ts`, `presentation/plan.ts`, `grammars/index.ts` — the
  decision of *what kind of picture* a thought becomes.
- **Agent reasoning** — the repair loop, the identity/target judges.
- **Source/context intelligence** — not really present today (see
  RUNTIME_FLOWS.md flow D), but conceptually InPublic's to own if built.
- **Evaluation** — `evaluate/evaluate.ts`'s reverse-interpretation scoring is
  domain-specific to this product's meaning model; no generic canvas library
  could provide it.

## Headline finding for this phase

InPublic's reimplementation choices relative to Excalidraw are, on the whole,
**deliberate and documented**, not accidental duplication — the arrow-binding
tradeoff and the `onChange` no-op both carry explicit in-code rationale. The
one place this audit found a *genuine, unexploited* opportunity is scene
observation: Excalidraw already exposes `getSceneElements()`, and InPublic's
Expression Engine currently has no read-back path at all, which is also the
root cause of the "no canvas perception" gap flagged in `CANVAS_AUDIT.md` and
`AGENT_AUDIT.md`. This is the strongest, most concrete convergence point
across Phases 4, 5, and 8 of this audit.
