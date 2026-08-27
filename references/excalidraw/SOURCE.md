# Excalidraw Source

Canonical repository: https://github.com/excalidraw/excalidraw

Installed package: `@excalidraw/excalidraw 0.18.1`, confirmed in `package-lock.json`, the installed package manifest, and installed type definitions.

Last inspected upstream `master`: `e1bb9ff8f8931e783c11d104abb8967ac6605c9a` (2026-08-26, `feat(packages/excalidraw): support rendering into another document (#11974)`).

Important upstream areas:

- `packages/excalidraw/`
- `packages/element/`
- `packages/common/`
- `packages/math/`
- `excalidraw-app/`

Always inspect current upstream Excalidraw source before adding or changing Excalidraw-specific behavior. Do not invent APIs, types, element behavior, bindings, viewport behavior, or collaboration primitives from memory, and do not duplicate upstream documentation here.

Local `0.18.1` observation surfaces verified: `getSceneElements`, `getSceneElementsIncludingDeleted`, `getAppState`, `getFiles`, `onChange`, `onPointerDown`, `onPointerUp`, and `onScrollChange`. Phase 5 uses only explicit snapshots from `getSceneElements` and `getAppState`; it registers no event subscriptions and does not expose raw elements, `AppState`, or files.

Phase 9 presence audit verified in the installed types and bundle: `Collaborator`/`CollaboratorPointer` (pointer or laser, cursor rendering, laser color, speaking/call/mute metadata), `elementsToHighlight`, `onPointerUpdate`, `setActiveTool`, `setCursor`, and `resetCursor`. Current upstream at the commit above retains collaborator pointer/laser concepts and provides additional interaction/viewport controls. InPublic intentionally uses none of those stateful editor or collaboration surfaces for artificial agent presence. Presence is a Canvas-owned, `pointer-events: none` host overlay so it cannot masquerade as a collaborator, change the human tool/cursor, or enter editor scene/app-state revisions. No package upgrade is needed for Phase 9.

`FUTURE_UPSTREAM_CAPABILITY`: the inspected upstream API additionally exposes `onIncrement`, `onStateChange`, `getSceneElementsMapIncludingDeleted`, and `getViewportOffsets`, along with newer mutation and viewport surfaces such as `applyDeltas`, `mutateElement`, and `setViewport`. These are not available in the installed package and are not used. No Excalidraw upgrade is part of Phase 5.

Upstream Excalidraw is authoritative for generic canvas primitives and behavior. InPublic owns meaning, `WorldState`, visual intent, expression selection, agent judgment, source reasoning, and visual evaluation; those product concerns do not belong upstream and must not leak into generic canvas primitives.
