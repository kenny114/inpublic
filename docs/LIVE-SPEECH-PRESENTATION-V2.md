# Live Speech Presentation V2

## Status

- V2 is a **known-good product baseline**, not an experiment. It was manually compared against legacy Standard Mode and found materially cleaner.
- It was created after the speech-to-visual architecture audit (`SPEECH-TO-VISUAL-AUDIT.md`) identified an ungoverned, multi-producer live pipeline as the primary source of visual distraction.
- It should **not** be casually rewritten while work continues on higher visual layers (diagrams, charts, semantic structure, etc.).
- Future visual systems should **integrate with V2**, consuming its settled output, rather than bypassing it or reaching back into the live thought lifecycle.
- See [`docs/decisions/ADR-LIVE-PRESENTATION-V2.md`](decisions/ADR-LIVE-PRESENTATION-V2.md) for the short decision record.

## Why V2 Exists

Before V2, several independent producers wrote to the same page while someone spoke — Tier 1 live transcript, Reflex speculative visuals, the Scribe, Beat→Artist→Organizer structural generation, and the Director/Choreographer — while the camera reframed on essentially every interim transcript. Individually, each of these was reasonable. Together, with nothing governing how much should be happening at once, the result was visually impressive in places but often felt poppy, jumpy, fragmented, and distracting rather than attractively expressive.

The problem was not simply "too many visuals." **The problem was that live speech itself lacked a calm, intentional presentation lifecycle.** Words appeared, were recolored, sometimes flashed on finalization, sometimes jumped to a new anchor mid-sentence, and the viewport moved to chase them — before any diagram or AI-generated structure was even in the picture.

**Design goal: turn distraction into attraction.** The words should still draw the viewer's eye — through intentional composition, a stable page, and a restrained camera — rather than through constant popping and movement.

## Product Principle

**Live speech is a first-class visual experience.**

InPublic must be useful and visually compelling before any graph, sketch, diagram, or AI-generated structure appears. Advanced visuals are enhancements to the speech layer, not substitutes for it.

## V2 Pipeline

```text
Microphone
   ↓
Deepgram (hooks/useDeepgram.ts)
   ↓
Interim / final transcript
   ↓
Board.handleInterim / Board.handleFinal
   ↓
Tier 1 writeLive  (components/Board.tsx) — no model, no network, no throttle
   ↓
Active thought block
   (pushStructuralSegment, lib/liveSpeech.ts — same deterministic merge Story
   Mode already uses; provisional colour, stable anchor, may span several
   Deepgram finals)
   ↓
Thought completion  (isThoughtComplete, lib/pagination.ts)
   ↓
Settled thought
   (ink colour, anchor released, stays on the page — dropSettledLiveLine is
   skipped under V2)
   ↓
Persistent page content

Secondary visual producers (Reflex, Scribe, Beat → Artist → Organizer,
Director/Choreographer, Math):
   SUPPRESSED IN V2 BASELINE — see "Protected Invariants" below for the
   exact gates.

Camera (framePage → proposeCamera, lib/composition.ts):
   STABLE UNLESS THE ACTIVE THOUGHT GENUINELY THREATENS TO LEAVE THE
   VISIBLE VIEWPORT — see "Camera Contract" below.
```

This diagram is derived from, and must stay in sync with, the actual gates in `components/Board.tsx`'s `writeLive`, `handleFinal`, and `handleInterim`, all conditioned on `v2Enabled` (`lib/features.ts`'s `isLivePresentationV2Enabled()`).

## Active Thought

An active thought is:

- **Provisional** — the text has not yet reached a completion boundary and may still change.
- **Anchored** — it keeps one stable anchor position and one stable Excalidraw element id for its entire duration; the anchor is chosen once and does not move because of a new interim, a width change, or a new Deepgram final.
- **Growable** — it may span multiple Deepgram finals. `pushStructuralSegment` (`lib/liveSpeech.ts`) decides, deterministically and without a model, whether a new final continues the same thought or starts a new one, using `isThoughtComplete` (`lib/pagination.ts`).
- **Visually soft** — rendered in the interim colour for as long as any part of it remains open, even across several finals, so the block doesn't pop from grey to ink and back on every sentence within one thought.
- **Not a semantic commitment.** An active thought carries no claim about whether anything downstream understands it — it only describes the presentation layer's own state.

## Settled Thought

A thought settles when:

- The thought-completion heuristic (`isThoughtComplete`) fires on the accumulated text.
- The text becomes stable, ink-coloured, permanent page content — it is not deleted or rewritten by V2 itself once settled.
- The next thought may begin, receiving a fresh anchor position.
- Future visual systems may inspect this settled state as their input.

**Important:** settled does **not** mean "AI fully understands this statement." It means **"the live speech presentation layer considers this thought structurally complete enough to stop mutating the same active block."** Presentation state and semantic confidence are deliberately kept separate — nothing about `isThoughtComplete` firing implies any model has reasoned about the content.

## Camera Contract

- Do not follow every interim transcript. The camera is not a subtitle tracker.
- Viewport stability is the default while a thought is active — the preferred outcome of a camera check during active speech is "do nothing."
- Move only when visibility genuinely requires it: `liveLineFitsViewport` (`lib/composition.ts`) is a pure containment check that decides whether to even *ask* `framePage`/`proposeCamera` to move; it does not itself decide zoom, hysteresis, or cooldown — that decision core is untouched.
- Meaningful visual events downstream of a settled thought may still request a deliberate reframe (e.g. the existing overview reveal after a thought settles, or a page turn) — V2 does not forbid all camera movement, only continuous chasing during active speech.
- Camera movement must remain subordinate to speaker attention: a viewer should be able to watch the speaker, not the canvas, while a thought is being spoken.

## What V2 Does NOT Solve

V2 intentionally does **not** solve, and must not be expanded to solve:

- Visual intent (what kind of visual a statement deserves)
- Diagrams
- Charts
- Hierarchy
- Quantitative expression
- Semantic contradiction
- Relationship grounding
- Discourse revision (amending an earlier claim)
- Story Mode
- Advanced visual choreography

These remain the responsibility of higher visual layers, built downstream of V2's settled-thought output — not folded back into V2 itself.

## Protected Invariants

### DO NOT BREAK THESE

1. No model in the Tier 1 live text path (`Deepgram → handleInterim → writeLive → canvas`).
2. No artificial transcript delay introduced for animation or presentation purposes.
3. No per-interim camera chasing.
4. An active thought should not repeatedly re-anchor.
5. Finalisation should not visibly pop.
6. Secondary visual systems (Reflex, Scribe, Beat/Artist/Organizer, Director, Math) must not write directly into the live thought lifecycle while V2 is active.
7. Future visual intelligence should consume **settled** speech/thought state downstream — not compete with the active one.
8. No model emits canvas coordinates (a pre-existing, codebase-wide rule; V2 does not weaken it).
9. V2 must remain independently testable and independently toggleable from legacy behavior — see "Feature Flag / Activation" below.

## Relationship to Future Architecture

```text
speech
  ↓
V2 live presentation
  ↓
settled thought
  ↓
future visual decision layer
  ↓
optional structured visual
  ↓
page
```

The important word is **optional**. A settled thought may produce no additional visual at all — silence remains a correct answer downstream, just as it is today when Beat returns `skip`.

## Feature Flag / Activation

- Flag: `features.livePresentationV2` in [`lib/features.ts`](../lib/features.ts). Default: `false`.
- Resolved via `isLivePresentationV2Enabled()` (same file), which also honours a **development-only** override.
- Dev override: with `NODE_ENV !== "production"`, append `?v2=1` to the URL. Production ignores this query param entirely and reads only the committed flag value (same reasoning as every other flag in this file — see its top-of-file doc comment).

**To compare legacy vs. V2 without touching source:**

```
http://localhost:3210/try            legacy Standard Mode behavior
http://localhost:3210/try?v2=1       V2 behavior (dev-only override)
```

(Port may differ if `3210` is taken — see `.claude/launch.json`. Any authenticated route, e.g. `/create`, works the same way once logged in.)

To make V2 the default for every session regardless of URL, flip `livePresentationV2: true` in `lib/features.ts` and deploy.

## Instrumentation

V2-specific and V2-relevant existing log events (`lib/types.ts`), all emitted through the same `log()` used everywhere else in `Board.tsx`:

| Event | Meaning |
|---|---|
| `{type:"v2", event:"camera-follow-allowed"}` | The active thought was about to leave the safe viewport; `framePage` was asked to follow it. |
| `{type:"v2", event:"camera-follow-skipped"}` | The active thought still fit the safe viewport; no camera request was made. |
| `{type:"v2", event:"anchor-reset"}` | Diagnostic: the pen moved out from under an active V2 thought unexpectedly. Should not occur in normal operation — see Protected Invariant #4. |
| `{type:"v2", event:"pop-suppressed"}` | A thought finalised under V2; the legacy opacity pulse was intentionally skipped. |
| `{type:"thought", rawSegments, merged, heldMs}` | A thought completed — which finals were merged into it and how long it was held open. Reused unchanged from Story Mode's existing event. |
| `{type:"composition", ...}` / `{type:"camera-metric", ...}` / `{type:"camera", ...}` | The existing camera decision/execution trail (`framePage`/`proposeCamera`) — unchanged by V2, and the ground truth for whether a requested follow actually moved the camera. |
| `{type:"live", ...}` | Per-utterance speech→ink timing (render/paint/lag percentiles) — unchanged by V2, confirms Tier 1 latency wasn't affected. |

**Use:** record the same talk twice, once with V2 off and once with `?v2=1`, and diff the session logs on these event types — no new tooling required, per the audit's original recommended comparison method.

## Known V2 Limitations

- **One active/settled state per thought, not per word.** A multi-final thought is uniformly "soft" until the whole thought completes, then flips to ink once — there is no graduated, per-word settling within a single growing block.
- **Very long thoughts may remain provisional for a long time**, since `isThoughtComplete` is the only thing that closes a block; an unusually long monologue without a clear completion boundary stays in the active/soft state throughout.
- **Hard overflow can still page-turn mid-thought.** The `overflow`/`long-utterance` page-turn triggers (`lib/pagination.ts`) are non-deferrable and independent of thought-completion state; V2 does not attempt to carry a still-open thought whole onto the next page.
- **Story Mode + V2 is not validated.** Story Mode takes an entirely separate branch in `handleFinal`/`handleInterim` and was not exercised in combination with V2.
- **Downstream speech-provider latency is a separate concern from render latency.** A slow Deepgram interim/final is not a V2 regression — V2 changes nothing between a transcript arriving and `writeLive` dispatching ink for it. Attribute latency spikes accordingly before assuming V2 caused them.
