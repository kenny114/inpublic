# Universal Visual Grammar V1 — shadow experiment

This directory is an offline, read-only experiment. It consumes retained audio
metadata, transcripts, and settled thoughts; it never opens a microphone,
contacts Deepgram or a model provider, writes to the canvas, or changes a
production feature flag.

The experiment has two independent lanes:

1. the current Visual Re-entry gate/evidence/fast-path code is run as a
   side-effect-free baseline; model fallbacks are recorded but deliberately not
   called;
2. the same settled thoughts are parsed into a small Universal Meaning Graph
   and mapped to an experimental visual plan.

Run from the repository root:

```powershell
node --no-warnings --import ./scripts/ts-register.mjs experiments/universal-visual-grammar-v1/run.mjs
node --no-warnings --import ./scripts/ts-register.mjs experiments/universal-visual-grammar-v1/test.mjs
```

Generated JSON is written only beneath `results/`.

