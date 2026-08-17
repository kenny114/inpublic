# InPublic Natural Speech Corpus V1
This is a research collection workflow, not a new visual feature. Live
Presentation V2 and all five Visual Re-entry families remain unchanged.

## Qualifying natural recording

A natural entry is ordinary, unscripted explanatory speech about something
real. The speaker may receive a topic prompt, but must not be told to use list,
sequence, comparison, causal, or numerical grammar. Hesitation, correction,
pronouns, and topic drift are useful evidence rather than recording defects.

Capability fixtures must be labeled `synthetic`; they remain valid regression
assets but are excluded from natural-frequency calculations.

## Collection

1. Open the development replay lab with Live Presentation V2 and Visual
   Re-entry unchanged.
2. Select the original audio and run `vr_full` once.
3. In **Natural Speech Corpus V1**, choose `Natural talk` and enter a short
   topic description. This label is research metadata; it does not affect the
   run.
4. Export the latest run as corpus artifacts.
5. Keep all emitted files together and add the manifest entry to
   `artifacts/natural-speech-corpus-v1/manifest.json`.

The export contains the original audio, complete session/event JSON, native
Excalidraw scene, exact settled-thought list, final transcript, telemetry,
manifest entry, a full-board PNG, and one stable PNG per page.

## Initial topic prompts

Use one neutral prompt, then let the speaker talk normally. Examples:

- Explain something you built recently.
- Explain a problem you encountered and how you figured it out.
- Teach a concept you understand.
- Talk through a decision you are considering.
- Tell somebody what you learned this week.

Do not coach the speaker toward particular wording or visual structure.

## Offline analysis

After several qualifying natural entries exist, classify exact settled
thoughts offline as text-only, one of the five existing families, unsupported
visual structure, or ambiguous. Manual visual-usefulness and full-board review
remain required; runtime decisions are evidence, not the offline classifier.
