# InPublic Demo Studio V1 Implementation Validation

Validation date: 2026-08-17  
Validated bundle: `artifacts/demo-studio/demo-8e2512e7-f856-42af-b90a-c393d673c5c0/`

## Implementation summary

Demo Studio V1 is implemented as a development-only foreground browser route. It decodes one local audio file, normalizes it once to mono 48 kHz, releases the existing live Deepgram PCM replay sender and source-audio playback from one barrier, records the actual rendered Excalidraw layers, and refuses COMPLETE until encoded audio/video pixel validation passes.

The final natural run passed the WebM capture path. Native browser MP4 was attempted first but its encoded file did not provide reliable frame-seek evidence; it was rejected rather than relabelled. The Studio now selects an honest VP9/Opus WebM fallback. No local FFmpeg/transcode runtime was available, so the separate MP4 success criterion remains unmet.

## Route/access model

`/demo-studio` is an App Router route that calls `notFound()` in production. The replay authorization, artifact writer, and Studio Board mode are development-only. The artifact writer accepts bounded 5 MiB chunks and writes only beneath `artifacts/demo-studio/demo-<uuid>/`.

No public upload product, cloud storage, Supabase audio path, product usage lease, or normal project autosave is used.

## Audio decode

- Accepted policy: WAV/PCM, MP3, OGG/Opus.
- Full file is decoded before Run; extension/MIME is only the initial policy gate.
- Zero/non-finite duration, zero channels, invalid PCM, decode failure, and duration over 90 seconds fail preflight.
- The known over-limit WhatsApp OGG was rejected before Run.
- Validated source decoded as 87.960 s, 48 kHz, mono, then produced 1,100 80 ms PCM chunks (3,840 samples per full chunk).

## Replay integration

`useDeepgram.startReplay` now accepts a prepared source while retaining its original `File` path for Replay Lab. The existing absolute scheduler, live socket, reconnect/rebase rules, 80 ms PCM16 conversion, and diagnostics remain shared. Studio adds synchronization and progress hooks around that sender; it does not duplicate Deepgram transport/configuration.

The validated run recorded 1,100 successful chunks and 108 provider responses.

## Pipeline equivalence

The Board run uses `vr_full` and the existing interim/final callbacks. Evidence from `session.json` includes:

- real replay provider timing/transport diagnostics;
- 39 Thought Boundary V3 boundary events;
- 19 settled V2 thoughts;
- 50 Visual Re-entry lifecycle events;
- one grounded `quantitative_change` durable commit;
- two page turns and the production camera events.

No V2, V3, Visual Re-entry, visual-family, page, or camera policy was changed.

## Run isolation

Every completion/failure remounts a Board keyed by a fresh demo generation. Demo mode disables autosave, saved-session restore, product chrome, microphone controls, recording controls, and Replay Lab UI. The existing comprehensive replay reset is still applied before PCM starts, and the run gets fresh session/demo IDs and a fresh Deepgram credential.

## Master clock / A-V sync

The source is decoded once. After the real Deepgram socket opens, Studio starts MediaRecorder, holds approximately 500 ms of resting board, and then starts the `AudioBufferSourceNode` while releasing source sample zero to the existing replay scheduler.

Measured recording-start-to-audio-start offset: 501.6 ms.

## Canvas composition

The compositor rediscovers all visible canvases under the Board host every animation frame, paints a white background, and draws each canvas in DOM order at its actual bounding rectangle. It does not recreate Excalidraw/camera transforms.

Validated health: two visible canvas layers, 5,707 compositor frames, zero draw errors, maximum rAF gap 166.7 ms.

## MediaRecorder

The recorder combines `captureStream(30)` video with the original decoded-source audio track from `MediaStreamAudioDestinationNode`.

Native MP4 capability advertising was insufficient: the first MP4 attempt failed encoded-pixel integrity. V1 therefore records `video/webm;codecs=vp9,opus` honestly. WebM bytes are never renamed to MP4.

## Visibility enforcement

Run preflight requires `document.visibilityState === "visible"`. Any hidden transition stops source/recorder/provider work and fails with `TAB BECAME HIDDEN`. The successful natural run recorded zero visibility changes.

## Completion lifecycle

Recording begins before source speech, waits for existing provider finalization/presentation flush, records two fresh compositor frames, holds the settled presentation, and stops within the bounded tail. Measured post-source tail: 3.573 s. The run watchdog, reconnect timeout, PCM progress check, 10-second post-source tail timeout, and bounded frame sampling prevent indefinite running.

## Watchdog

One integration bug in the first attempt cancelled the socket before PCM began; the run terminated as `RUN WATCHDOG TIMED OUT` rather than hanging. The Studio-only Board API lifecycle was corrected without changing product reconnect behavior. Subsequent runs completed.

## Capture validation

Validated file:

- exists and is 8,842,790 bytes;
- decodes at 784×698;
- measured 30 FPS capture health;
- duration 92.018 s versus 92.035 s expected (16.8 ms delta);
- audio track decoded and peak amplitude was 0.8631;
- 369 encoded frame samples were analyzed;
- 149 adjacent sampled pairs materially changed;
- static suffix was 3.748 s and began after required visual work;
- final encoded/live compositor difference was 0.0000996;
- capture validation: PASS.

## Event-to-pixel validation

Text, visual, page, and material camera events use separate thresholds. Tiny camera retargets (under 60 px and 0.04 zoom) are retained in telemetry but are not mislabeled as material pans. Material camera events require at least two distinct changed frames. Both page turns produced broad pixel change. The quantitative visual commit produced pixel change. No page/camera failure remained.

Two text events immediately before a page transition fell below the conservative local text threshold; this is retained as a warning, while the ensuing page transition and final state passed.

## Output artifacts

- `source-audio.ogg` — 180,301 bytes
- `video.webm` — 8,842,790 bytes
- `session.json` — 1,624,469 bytes
- `transcript.txt` — 1,299 bytes
- `metadata.json` — 41,577 bytes
- `thumbnail.png` — 46,287 bytes

## Demo Studio UX

The route includes file/title/topic inputs, decoded source facts, status lifecycle, real-time source/frame health, exact failure reasons, preview/download controls, explicit local-bundle save, discard/reset, and manual content-review fields. One file/run is enforced; failed captures never appear as valid previews.

## First natural validation run

SOURCE: `WhatsApp Ptt 2026-08-14 at 4.50.36 PM.ogg`  
DURATION: 87.960 s  
FORMAT: OGG/Opus, 48 kHz mono

VIDEO: `artifacts/demo-studio/demo-8e2512e7-f856-42af-b90a-c393d673c5c0/video.webm`  
DURATION: 92.018 s  
RESOLUTION: 784×698  
FPS: 30  
CODEC: VP9/Opus WebM  
AUDIO TRACK: present, non-silent

SETTLED THOUGHTS: 19  
PAGES: 3  
VISUAL FAMILIES: `quantitative_change`  
CAMERA EVENTS: 39 starts, 26 completions, 13 cancellations

CAPTURE VALIDATION: **PASS (WEBM); MP4 NOT VALIDATED**

## Camera quality notes

Do not fix these in this task:

- final content is low with excessive whitespace above;
- the final page's first line is clipped at the right edge;
- live follow/page arrival produced frequent retargeting (39 starts, 13 cancellations);
- the 784×698 capture viewport is awkward for normal 16:9 publishing;
- the final frame lets the most recent page dominate appropriately, but its framing does not keep the full line inside the right edge.

## DEMO-CONTENT.md update

`docs/DEMO-CONTENT.md` now documents Studio V1, supported inputs/limit/pipeline/capture/background constraint, objective natural-run facts, artifact path, validation metrics, camera notes, and manual-review fields. Nothing was auto-published or marked postable/privacy-cleared.

## Regression tests

- `npx tsc --noEmit`: PASS
- `npm test`: PASS (existing suite plus deterministic Demo Studio policy/gate/pixel tests)
- `npm run build`: PASS
- normal `/try`: source unchanged; existing product packaging and replay regression checks pass

## Known V1 limitations

- foreground/visible active desktop required;
- one file/run, maximum 90 seconds;
- no M4A/video input;
- output is WebM until a verified native MP4 path or explicit local transcode is added;
- publishing-quality fixed 16:9 viewport is not enforced;
- browser-local artifact saving is development-only;
- manual best-moment/postability/page suitability/privacy decisions remain required;
- broader replay reconnect architecture and camera quality are deliberately unchanged.

## Explicit answers

1. **Can I upload a voice note now?** Yes, on the development-only `/demo-studio` route.
2. **Which formats work?** WAV, MP3, and OGG/Opus, subject to full browser decode.
3. **Is 90 seconds enforced?** Yes; over-limit audio was observed failing preflight.
4. **Does the voice note use the real Deepgram pipeline?** Yes.
5. **Does it use production V2?** Yes.
6. **Does it use V3?** Yes.
7. **Does it use Visual Re-entry?** Yes.
8. **Is camera behavior the real production camera behavior?** Yes; unchanged.
9. **Does the exported video faithfully show camera movement?** Yes for the validated WebM; material events required multi-frame pixel motion.
10. **Does it faithfully show page turns?** Yes; both validated page turns correlate with encoded pixel change.
11. **Does the final video contain the source voice audio?** Yes; encoded audio is present and non-silent.
12. **Is audio/video synchronized from one shared source clock?** Yes; measured start offset is stored.
13. **Will the Studio fail if I switch tabs?** Yes.
14. **Will it detect a visually frozen capture?** Yes; the bad MP4 attempt was rejected.
15. **Can one run hang forever?** No; connection, source, tail, overall, and validation operations are bounded.
16. **Does one run produce video/session/transcript/metadata/thumbnail?** Yes, plus the original source.
17. **Was the first natural voice-note run actually successful?** The final natural run passed WebM validation and produced a bundle; native MP4 did not pass and is not claimed.
18. **Did the validation expose questionable camera framing?** Yes; see camera quality notes.
19. **Was normal `/try` changed?** No.
20. **Is Demo Studio V1 ready for me to start recording demo scripts?** Yes if validated WebM is acceptable; no if MP4 is a hard deliverable until a verified transcode/native path is added.
