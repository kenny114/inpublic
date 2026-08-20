# Speech → meaning → visual expression

This is the implementation that exists, not a future sketch.

## Speech

Microphone PCM → Deepgram Nova-3. Interims update one live Excalidraw text
element (`writeLive`). This path has no model on it. Do not put one there.

## Context

Live Presentation V2 turns provider finals into settled thoughts. The Meaning
Engine keeps (1) a rolling window of raw settled-thought text and (2) a
persistent `SemanticState`. Pronouns resolve against the raw window, not only
the accumulated graph.

## Meaning

Two-stage, in `lib/meaning/decideCore.ts`:

1. Extract what this chunk means (`LocalMeaning`) without seeing the full graph.
2. Reconcile that into `SemanticState` (concepts, relationships, claims,
   optional `quantity`).

The model never emits coordinates. Ids persist so “it” can update the same
object later.

## Visual reasoning

`planMeaning` in `lib/meaning/plan.ts` is deterministic. No third model call.

| Meaning cue | Family | Spatial grammar |
|---|---|---|
| `causes` / `leads_to` / `depends_on` chain of 3+ | `causal_chain` | Vertical flow, unlabeled arrows |
| `contrasts`, or two quantified concepts | `comparison` | Parallel columns |
| `contains` / `part_of`, or ≥2 `supports` into a claim | `hierarchy` | Enclosure: children inside the parent |
| One unstructured aside | nothing | Silence |
| Else | `concept_network` | Column; only flow edges become arrows |

## Layout and rendering

`computeMeaningLayout` → `syncMeaningCanvas`. Nodes are drawn at the layout
box size. Containment is a region, not a “part of” label. Comparison does not
draw a “vs” arrow — the two columns are the contrast. Boxes keep bound text
across arrow rebuilds.

## Camera

Existing V2 / reveal path. Meaning does not invent a second camera.

## Evaluation

Offline: `scripts/meaning-engine-test.mjs` (schema, plan, layout, grammar
corpus). Live meaning: `scripts/meaning-gold-replay.mjs` (needs API key).
Session logs now include `type: "meaning"`.
