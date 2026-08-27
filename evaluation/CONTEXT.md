# Evaluation Context

Evaluation asks whether meaning survives into a coherent, usable, continuing visual world. It should eventually measure meaning survival, correct object identity, correct relationships, visual form appropriateness, readability, clipping, spatial coherence, persistence, canvas drift, continuation quality, repair quality, and browser behavior.

Use the smallest evaluation mode that can answer the question:

- Deterministic fixture tests verify semantic folding, planning, geometry, patching, and invariants with fixed inputs. They belong in the automated test suite; reusable cases may be specified in `scenarios/`.
- Browser smoke tests verify a few critical integrated browser behaviors against a real mounted canvas. They are a narrow safety net, not broad visual judgment.
- Live model evaluation measures behavior that depends on real model output, latency, ambiguity, or session continuity. Record runs and findings in `reports/`; promote stable failures to `regressions/`.
- Deterministic VisualAgent evaluation injects scripted decisions and verifies observation cadence, strict validation, deterministic ActionResult feedback, progress protection, budgets, and terminal status without spending provider money.
- Deterministic presence evaluation advances an injected clock and verifies lifecycle transitions, semantic target resolution, interruptible/reduced motion, highlight expiry, human-input suppression, cleanup on every terminal path, and unchanged provider-call counts.
- Live VisualAgent evaluation is opt-in and measures valid action selection, semantic identity choice, continuation turns, completion, invalid-action rate, and unnecessary-action rate. Do not include paid calls in normal CI or score rendering quality here; Expression evaluation owns rendering quality.
- Human visual evaluation judges appropriateness, legibility, hierarchy, coherence, and whether the result communicates what a person intended. Record the scenario, artifact, judgment, and rationale.
- Browser presence smoke verifies that lifecycle and semantic attention are perceptible on a mounted canvas while presence alone leaves `CanvasObservation.revisions.scene` unchanged and human input continues normally.
- Deterministic live-interaction evaluation covers build, connect, correct, remove, and natural continuation. Each compact trace records route, model calls, actions/results, steps, canvas revisions, latency, final semantic/canvas results, and exact gate failures. At least one scenario must change live Canvas state between turns and prove the next agent observation sees it.
- Live-interaction browser smoke exercises both routing branches in one mounted-board scenario and checks semantic identity, visible/cleaned-up presence, re-observation, and unchanged viewport for a semantic correction.
- Paid live interaction evaluation is opt-in only. Report model calls, steps, tokens, and approximate cost when actually available; never infer cost from deterministic scripted providers.

Do not collapse these into one score. A deterministic pass cannot establish visual quality, and a compelling screenshot cannot establish identity, persistence, or browser correctness.
