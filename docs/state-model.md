# State model

This describes what changed in InPublic's session-state architecture for the
Math Explanation System and Audio Replay Mode, and — as important — what was
already there and left alone. See `COST-AUDIT.md`-style framing: this is a
factual description of the current system, not a proposal.

## What already existed (unchanged)

- **`SemanticBoard`** (`lib/semantic.ts`) — the compact, structured "what the
  talk is about" layer: `Concept` (stable `conceptId`, label, kind, source
  span, confidence), `Relationship`, `Section`, and an `Operation` history
  used for undo. This already satisfied most of the brief's "compact
  session-state architecture" list: current topic (`activeSection`), active
  objects and their IDs/types (`concepts`), relationships, source speech span
  (`sourceText` per concept), and corrections/undo (`Operation`/`UndoRecord`).
- **Bounded transcript windows** — `pendingTextRef` (120 words),
  `scribeContextRef` (40 words), `recentTranscript()` (90-second rolling
  window). The full transcript has never been resent to a model; see the
  architecture audit earlier in this project's history for the evidence.
- **`SemanticBoard.scene()`** — the per-call prompt view, capped to the 24
  most-recently-updated concepts.

## What this work added

1. **`Concept.mathMeaning?: MathReasoningStep`** (`lib/semantic.ts`) — an
   additive optional field. A concept of kind `"equation" | "graph" |
   "math_step"` carries its reasoning step; every other kind is unaffected.
2. **New `ConceptKind` values**: `equation`, `graph`, `math_step` — additive
   to the existing enum, never assigned outside the math pipeline.
3. **`SessionCheckpoint`** (`lib/semantic.ts`) — the "compressed summary of
   older context" the brief's item 14 asks for. `SemanticBoard.checkpoints`
   is a bounded array (40 max); `compactAgedConcepts(maxConcepts)` folds
   concepts that have aged out of the live 24-concept window into one
   checkpoint per section, so that content leaves a compact trace instead of
   silently vanishing from every future prompt. `scene()` now also returns
   `checkpointSummaries` (last 3, one line each) for prompts that want brief
   continuity without re-reading anything.
4. **`AudioTimeline` / `AudioSegment`** (`lib/audio/types.ts`) — the
   equivalent compact structure for an uploaded recording: chronological
   segments with topic, detected math claim, and object references, plus its
   own `checkpoints` array (one per ~10 segments) for the same reason.

## What was deliberately NOT changed

- `finalsRef`/`logRef`/`elementsRef` in `Board.tsx` remain unbounded for the
  life of a live session. The checkpoint mechanism above adds a compressed
  record alongside them; it does not evict or rewrite their existing storage
  behavior. A full eviction rewrite was judged a larger, riskier change to
  code that currently works correctly, and was out of scope for this pass —
  see the plan's "explicitly deferred" section.
- Standard Mode and Story Mode's own state (`SemanticBoard` proper,
  `StoryState`) are untouched in behavior; the new `ConceptKind`s and
  `mathMeaning` field are additive and never populated unless the math
  pipeline runs, which itself only runs when `NEXT_PUBLIC_ENABLE_MATH_MODE`
  is set.
