# ADR: Live Speech Presentation V2 as the Baseline Presentation Layer

**Date:** 2026-08-14
**Status:** Accepted

## Decision

Live Speech Presentation V2 becomes the baseline presentation layer for live speech. See [`docs/LIVE-SPEECH-PRESENTATION-V2.md`](../LIVE-SPEECH-PRESENTATION-V2.md) for the full architecture, invariants, and instrumentation.

## Reason

The previous multi-producer live experience — Tier 1 transcript, Reflex, Scribe, Beat→Artist→Organizer, Director/Choreographer, and a camera that reframed on nearly every interim, all writing to the same page simultaneously — was visually noisy (`SPEECH-TO-VISUAL-AUDIT.md`). Isolating persistent, thought-level speech presentation with a restrained camera, and suppressing the secondary producers, produced a substantially cleaner experience on manual comparison — cleaner even without any diagrams or advanced visuals present.

## Consequences

**Positive:**
- A cleaner baseline for every session, independent of whatever visual intelligence exists downstream.
- Live text itself is compelling on its own, not just a placeholder for future structure.
- Future visual systems must earn their existence — they are additive to a good baseline, not a fix for a distracting one.
- Easier to reason about downstream visual intelligence: it consumes a settled thought, not a moving target.

**Tradeoffs:**
- Fewer visuals by default — Reflex, Scribe, and structural generation are off under V2.
- Less spectacle until visual intelligence is deliberately reintroduced, one controlled family at a time.
- Text composition (anchoring, thought merging, camera restraint) now carries more of the product's expressive weight than before.

## Future

Reintroduce visual expression downstream of settled thoughts, one controlled family at a time, per `docs/LIVE-SPEECH-PRESENTATION-V2.md`'s "Relationship to Future Architecture." Do not fold that work back into V2's own active-thought lifecycle — it consumes V2's output, it does not compete with it.
