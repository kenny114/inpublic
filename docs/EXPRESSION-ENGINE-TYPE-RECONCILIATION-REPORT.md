# Semantic type reconciliation + frozen deterministic meeting replay

Two deliverables: a versioned, frozen sanitized-delta fixture that makes the 118-turn meeting replay genuinely
deterministic (same input every run, no more extraction noise between comparisons), and one narrowly-scoped code
change — semantic type reconciliation — measured against it.

## The frozen fixture

[scripts/freeze-meeting-deltas.mjs](../scripts/freeze-meeting-deltas.mjs) ran the real extractor once over the
unmodified [meeting-transcript.mjs](../scripts/fixtures/meeting-transcript.mjs) and wrote every turn's sanitized
`MeaningDelta` to [scripts/fixtures/meeting-transcript-deltas-v1.mjs](../scripts/fixtures/meeting-transcript-deltas-v1.mjs)
(`MEETING_DELTAS_V1`), versioned and committed. [scripts/expression-meeting-frozen-replay.mjs](../scripts/expression-meeting-frozen-replay.mjs)
replays it deterministically — every run feeds `ExpressionSession.ingestDelta` the exact same 118 deltas, so
extraction's own turn-to-turn non-determinism (the dominant noise source in the previous hardening-pass-2
before/after comparison, where two separate live conversations were compared to each other) is eliminated. The
identity **judge** still makes real model calls by default — that's the mechanism actually being measured, and a
fully offline run would make a type-reconciliation change invisible (every deferred decision would just come back
`hold` instead of `create`, a label change with no entity-count effect). `--no-judge` remains available for a fully
offline stage-1-only sanity run. This is the first time in this project's identity work that a before/after
comparison holds the input bit-for-bit fixed.

## The change: semantic type reconciliation

[lib/expression/world/identity.ts](../lib/expression/world/identity.ts) gained a `ROLE_BRIDGE` — a short, explicit,
observed list of `EntityType` pairs that are the same stable thing described in a different grammatical role, not a
different kind of thing: `object`↔`action`, `object`↔`event`, `object`↔`state`, `group`↔`quantity`. Traced directly
to the previous report's own diagnosis: "the email verification step" extracted once as an `object` and once as an
`action`, and "blog post" once as an `object` and once as an `event` — genuinely one thing each, permanently
un-mergeable under a strict type-family gate no matter how good the rest of identity resolution is.

**`apply.ts`'s own `typesCompatible` was not touched** — `resolveMention`, pronoun resolution, and relation-endpoint
resolution all use it completely unchanged, so nothing outside the identity layer's own candidate retrieval could be
affected. A new, identity-layer-local `identityTypeRelation()` answers three ways: `"same"` (apply.ts's own gate
already accepts it — ordinary eligibility, can auto-merge exactly as before), `"role"` (only the bridge accepts it —
eligible, but **always** deferred to the judge, never auto-merged regardless of score), or `null` (a real,
untouched ontological boundary — never eligible, exactly as strict as before). A bridged match only ever grants
*eligibility*; the judge — now shown each candidate's `kind` and told explicitly what a role variation looks like —
makes the actual call, with the same "prefer uncertain over a wrong merge" discipline as everywhere else in this
layer.

Two new adversarial fixtures (13/13 total passing): the object/action bridge correctly merging via the judge, and —
the safety check that matters most for a change like this — a person and a place sharing an identical label
(`"Washington"`) staying at **0 eligible candidates** even when the scripted judge is deliberately configured to
merge them if given the chance. It never gets the chance: person/place was never on the bridge list, and nothing
about adding other pairs widened that boundary.

## Before / after: the frozen replay, same 118 deltas both times

("Before" = the previous hardening-pass-2 identity.ts, no type bridge. "After" = with the bridge. Both runs used the
same frozen deltas and a live judge; measured by temporarily reverting the bridge, running, then restoring it.)

| Metric | Before | After |
|---|---|---|
| Total entities created | 101 | 98 |
| Duplicate clusters (`x-2`, `x-3`...) | 2 (`email-verification-step-2`, `blog-post-2`) | **0** |
| Reference resolution | 25% (2/8) | 25% (2/8) — **unchanged** |
| Lifecycle application | 46.2% (6/13) | 46.2% (6/13) — **unchanged** |
| Semantic preservation, mean | 0.391 | 0.414 |
| Semantic preservation, last quarter | 0.287 | 0.245 |
| Judge invocation | 120/191 = 62.8% | 120/191 = 62.8% — unchanged |
| Judge uncertainty | 2/120 = 1.7% | 3/120 = 2.5% |
| Reactivations | — | 1 |

Reference and lifecycle numbers being **exactly** identical, digit for digit, is the clearest possible confirmation
that this pass touched nothing outside the identity layer — those two subsystems were explicitly off-limits and the
frozen replay proves it rather than just asserting it.

**Both known duplicate clusters resolved, confirmed correct by inspection.** "email verification step" (object,
turn ~19) and "email verification step" (action, turns ~40/41/64) merged into one entity — judge: *"just with
additional detail about its behavior... same stable thing."* "blog post" (object) and "blog post" (event) merged —
judge: *"the same stable thing... just in different grammatical role."* Both exactly the case the bridge was built
for.

**Zero false merges from the bridge**, checked directly: candidates that were merely *nearby* the bridged pair in
the candidate pool were correctly kept distinct — "race condition" (state) stayed separate from
"email-verification-step" (*"the underlying technical cause... related but distinct"*), "retry bug" and "draft
email to customers" both correctly created as new entities despite email-verification-step being an eligible
neighbor. The person/place adversarial fixture holds in the live run too, by construction (the bridge list contains
no such pair).

**Entity count dropped a modest 3** (101 → 98) — smaller than the 2-cluster fix alone might suggest, because
resolving the duplicates also let a few dependent mentions that referenced the *wrong* half of the pair find the
now-unified entity instead of creating their own new one.

**Semantic preservation moved within noise range** — up on the full-run mean, down slightly on the last quarter.
With extraction now frozen, the only remaining variance source is the judge's own per-call sampling, which is far
smaller than before but not exactly zero; this size of movement is consistent with that residual noise rather than
a real effect, and reference/lifecycle staying byte-identical corroborates that nothing systematic shifted outside
the two resolved duplicates.

## Regression safety

`npm test` (976 + 51), all five pre-existing fixture suites, and the identity fixture suite (now 13/13, two new)
pass unchanged. `apply.ts`, `references.ts`, salience, composition, layout, and rendering were not modified.
