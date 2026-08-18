# InPublic Demo Corpus V1 — Capture Wave 1

STATUS: **1 VALIDATED/REVIEWED VIDEO; 2 FAILED CAPTURES**

Date: 2026-08-17

## Frozen build

- Git commit: `ac37f04826ea43abecde7d8ae04c845b7d432cae`
- Frozen product fingerprint: `8ff4931ca736e99873980edd1a8eb427b4ed3b50721739bfa9b9fc7fa85bd896`
- Feature state: `production vr_full`
- Container: `WEBM`
- Product behavior changed during wave: **NO**

All recordings ran sequentially in the same foreground Demo Studio tab. The fingerprint was checked before the replacement recordings and matched the earlier Wave 1 baseline exactly.

## Recordings

The three replacement OGG/Opus recordings all passed browser decode and the 90-second input limit. Their filenames did not include corpus IDs. The one surviving transcript does not match any of the 12 planned scripts, so corpus IDs are not invented after the fact.

### Demo 1

ID: `W1-A-UNMAPPED` — not a planned corpus ID  
TITLE: This is InPublic — current product explainer  
EXPECTED FORM: Text-led/restraint in practice  
DURATION: source 46.580 s; video 50.662 s

SOURCE: `WhatsApp Ptt 2026-08-17 at 3.52.16 PM.ogg`  
BUNDLE: `artifacts/demo-studio/demo-c7f3168a-7bcc-4a9d-9010-2411ccdd978f/`

CAPTURE: **PASS**  
VIDEO: `artifacts/demo-studio/demo-c7f3168a-7bcc-4a9d-9010-2411ccdd978f/video.webm`

- VIDEO DECODES: YES
- AUDIO PRESENT: YES
- AUDIO NON-SILENT: YES — peak 0.8563
- FRAME MOTION: PASS — 203 samples, 93 changing pairs
- FREEZE CHECK: PASS — 3.000 s settled suffix after required work
- PAGE EVENT → PIXEL: N/A — one page, no turn
- CAMERA EVENT → PIXEL: PASS
- VISUAL EVENT → PIXEL: N/A — no committed visual
- FINAL FRAME: PASS — encoded/live difference 0.0007583

SPEECH QUALITY: **GOOD**  
Speech appears within the opening seconds and continues as eight readable settled thoughts. The bare opener `Speaker.` and the recognition `besides me and Rita` weaken polish, but important thoughts are not cut and there is no giant combined block.

TEXT QUALITY: **NOTICEABLE ISSUE**  
The middle is readable and well spaced. Around 42.8 s, the camera moves left far enough to clip multiple line beginnings. The final frame still clips the left edge and leaves the newest content at the bottom boundary. Old text remains understandable only if the viewer saw it before the move.

VISUAL QUALITY: **GOOD RESTRAINT**  
No visual is committed. That is defensible: the recording talks about product behavior but does not provide a grounded example whose structure would be clearer as a diagram. InPublic does not invent a visual merely because the speaker says “relationships, arrows, structures.”

- TRUTHFUL?: N/A
- HELPFUL?: N/A
- EASY TO UNDERSTAND?: N/A
- WELL PLACED?: N/A
- TIMELY?: N/A
- WOULD TEXT ALONE HAVE BEEN BETTER?: YES — for this supplied recording

CAMERA QUALITY: **DISTRACTING**

- UPPER WHITESPACE: NOTICEABLE
- LOW CONTENT POSITION: NOTICEABLE late
- RIGHT-EDGE CLIPPING: NONE
- RETARGETING: NOTICEABLE — 20 starts, 15 completions, 5 cancellations
- CENTERING: good through the middle; poor after the late move
- ZOOM: DISTRACTING around 42.8 s because line beginnings leave frame
- EMPTY SPACE: noticeable above the active content
- ACTIVE TEXT POSITION: too close to the bottom edge at the end
- OLD CONTENT DOMINANCE: NOTICEABLE in the final frame
- PAGE ARRIVAL: N/A
- OVERALL CAMERA CALMNESS: NOTICEABLE ISSUE

PAGE QUALITY: **GOOD / SINGLE PAGE**  
The explanation belongs on one page and no empty page is created. There is no TURN → ARRIVE event to review. Late framing, rather than page composition, causes the readability loss.

PUBLIC CLASSIFICATION: **C. INTERESTING BUT NEEDS PRODUCT WORK**

BEST MOMENT: the explanation shifts from transcription to expression while the board is still readable  
BEST TIMESTAMP: approximately **17–31 s**

WHAT HAPPENS: The speaker explains that the interesting part is not merely the transcript and that the canvas should express meaning. Settled text accumulates cleanly without an unnecessary visual.  
WHY IT IS INTERESTING: It demonstrates restraint and live thought organization, although it does not demonstrate the visual claim being spoken.  
WHAT THE VIEWER UNDERSTANDS: InPublic is trying to decide what deserves visual treatment rather than turning every sentence into a graphic.

SOCIAL: MAYBE — only after a separate packaging decision; not as the current full clip  
LANDING HERO: NO  
LANDING EXAMPLE: NO  
TRY PAGE: NO

No X caption is supplied because the result is C, not A or B.

SCRIPT QUALITY: **REPLACE BEFORE FULL CORPUS**  
The speech is natural enough, including a self-correction, but it is not one of the planned scripts. It opens awkwardly, uses implementation terms, and claims expressive visuals without giving InPublic a concrete visual idea to show. Do not replace any planned corpus script based on this file.

### Demo 2

ID: UNASSIGNED — no valid transcript/bundle survived capture validation  
TITLE: `WhatsApp Ptt 2026-08-17 at 3.53.31 PM.ogg`  
EXPECTED FORM: UNKNOWN  
DURATION: 44.4 s

CAPTURE: **FAIL**  
VIDEO: NONE — invalid output was not retained  
FAILURE: `CAMERA EVENT NOT PRESENT IN VIDEO`

- VIDEO DECODES: NO ACCEPTED VIDEO
- AUDIO PRESENT: N/A
- AUDIO NON-SILENT: N/A
- FRAME MOTION: FAIL / capture gate
- FREEZE CHECK: N/A
- PAGE EVENT → PIXEL: N/A
- CAMERA EVENT → PIXEL: FAIL
- VISUAL EVENT → PIXEL: N/A
- FINAL FRAME: N/A

SPEECH QUALITY: NOT REVIEWED  
TEXT QUALITY: NOT REVIEWED  
VISUAL QUALITY: NOT REVIEWED  
CAMERA QUALITY: NOT REVIEWED  
PAGE QUALITY: NOT REVIEWED

PUBLIC CLASSIFICATION: **E. FAILED CAPTURE**

BEST MOMENT: N/A  
BEST TIMESTAMP: N/A

SOCIAL: NO  
LANDING HERO: NO  
LANDING EXAMPLE: NO  
TRY PAGE: NO

SCRIPT QUALITY: NOT EVALUATED — telemetry from a broken capture is insufficient.

### Demo 3

ID: UNASSIGNED — no valid transcript/bundle survived capture validation  
TITLE: `WhatsApp Ptt 2026-08-17 at 3.54.53 PM.ogg`  
EXPECTED FORM: UNKNOWN  
DURATION: 52.5 s

CAPTURE: **FAIL**  
VIDEO: NONE — invalid output was not retained  
FAILURE: `CAMERA EVENT NOT PRESENT IN VIDEO`

- VIDEO DECODES: NO ACCEPTED VIDEO
- AUDIO PRESENT: N/A
- AUDIO NON-SILENT: N/A
- FRAME MOTION: FAIL / capture gate
- FREEZE CHECK: N/A
- PAGE EVENT → PIXEL: N/A
- CAMERA EVENT → PIXEL: FAIL
- VISUAL EVENT → PIXEL: N/A
- FINAL FRAME: N/A

SPEECH QUALITY: NOT REVIEWED  
TEXT QUALITY: NOT REVIEWED  
VISUAL QUALITY: NOT REVIEWED  
CAMERA QUALITY: NOT REVIEWED  
PAGE QUALITY: NOT REVIEWED

PUBLIC CLASSIFICATION: **E. FAILED CAPTURE**

BEST MOMENT: N/A  
BEST TIMESTAMP: N/A

SOCIAL: NO  
LANDING HERO: NO  
LANDING EXAMPLE: NO  
TRY PAGE: NO

SCRIPT QUALITY: NOT EVALUATED — telemetry from a broken capture is insufficient.

## Visual behavior comparison

Only Demo 1 produced reviewable evidence. It committed no visual and showed appropriate restraint. Demos 2 and 3 cannot be used to compare visual-family performance because encoded validation failed.

## Restraint behavior

Demo 1 positively demonstrates restraint. The product leaves a text-led product explanation as text instead of turning mentions of “text boxes, relationships, arrows, structures” into an ungrounded diagram. This is a valid silence result, though the recording itself is not a planned restraint script.

## Camera pattern comparison

| Issue | Demo 1 | Demo 2 | Demo 3 | Repeated? | Severity |
|---|---|---|---|---|---|
| Upper whitespace | NOTICEABLE | N/A — failed capture | N/A — failed capture | 1/3 | NOTICEABLE |
| Low positioning | NOTICEABLE late | N/A — failed capture | N/A — failed capture | 1/3 | NOTICEABLE |
| Clipping | DISTRACTING left-edge clipping after ~42.8 s | N/A — failed capture | N/A — failed capture | 1/3 | DISTRACTING |
| Retargeting | NOTICEABLE | N/A — failed capture | N/A — failed capture | 1/3 | NOTICEABLE |
| Questionable zoom | DISTRACTING late | N/A — failed capture | N/A — failed capture | 1/3 | DISTRACTING |
| Poor active-content framing | DISTRACTING late/final | N/A — failed capture | N/A — failed capture | 1/3 | DISTRACTING |

No `CAMERA PATTERN CANDIDATE` is flagged. Only one validated video exists, so no issue has repeated across at least two substantially different reviewable recordings. The identical capture-gate failure in Demos 2 and 3 is a Studio/capture pattern, not human evidence about product-camera quality.

## Script quality findings

The only surviving recording does not match the planned corpus. It sounds conversational but is more like an improvised product explanation than a deliberate corpus item. Its 46.6-second length is appropriate. Demos 2 and 3 provide no reviewable evidence. The 12 planned scripts should remain unchanged until recordings bearing their IDs are captured successfully.

## Strongest demo

Demo 1 by default, but it is class C and not a recommended public asset.

## Weakest demo

Demos 2 and 3 are tied: both are `E. FAILED CAPTURE` with the same encoded camera-event failure.

## Best social clip

Demo 1 at approximately 17–31 s is the only candidate, but it is not recommended for posting from the current capture.

## Best landing-page candidate

None from Wave 1.

## Best /try candidate

None from Wave 1.

## DEMO-CORPUS-V1.md update

Updated with the replacement-run results. Planned corpus items remain present and pending because no supplied filename/transcript maps reliably to a defined corpus ID.

## DEMO-CONTENT.md update

Updated with the accepted WebM and human review, plus both failed-capture records. The earlier overlength preflight attempt remains as history.

## Recommended next action

**D. INVESTIGATE A CAPTURE/STUDIO FAILURE**

Two sequential, supported, sub-90-second files failed with the identical encoded-validation error `CAMERA EVENT NOT PRESENT IN VIDEO`. Investigate that capture-validation pattern before collecting more corpus recordings. Do not change camera behavior based on the single human-reviewed framing failure, and do not implement the investigation in this wave.
