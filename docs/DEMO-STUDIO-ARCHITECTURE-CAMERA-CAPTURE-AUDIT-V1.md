# InPublic Demo Studio Architecture + Camera Capture Audit V1

Audit date: 2026-08-17  
Audited commit: `ac37f04826ea43abecde7d8ae04c845b7d432cae` (`fix: keep guest background writes local`)  
Scope: architecture audit only. No Demo Studio, speech, camera, capture, product, auth, payment, landing-page, or `/try` behavior was changed.

## Executive finding

The safest V1 is a **local/internal, one-run-at-a-time Demo Studio in a normal, foreground Chrome tab**. It should decode one voice note in the browser, resample it to mono 48 kHz PCM, and use the existing development replay source swap in `useDeepgram` to send 80 ms PCM16 chunks in real time through the same live Deepgram socket and the same downstream `onInterim`/`onFinal` handlers used by the microphone. The actual Excalidraw static and interactive canvases should be composited every animation frame into one clean capture canvas; that canvas's 30 FPS stream and an audio track driven by the same source-audio clock should be recorded together.

This is not a special renderer. The only substitution is the speech source before Deepgram:

```text
uploaded file
  -> browser decode and mono/48 kHz normalization
  -> existing replay-pcm16 source in useDeepgram
  -> existing live Deepgram connection/configuration
  -> existing interim/final callbacks
  -> existing V2 -> V3 -> Visual Re-entry -> page -> camera paths
  -> actual Excalidraw canvases
  -> multi-canvas compositor -> MediaRecorder
```

The foreground requirement is architectural, not a UI preference. The camera spring, Excalidraw repaint, and current canvas compositor all run on `requestAnimationFrame`. The prior Browser-pane tab was continuously `document.hidden === true`; application timers and semantic state continued while animation frames and canvas repaint stopped. Telemetry therefore recorded page and camera events that the video never showed. Browsers commonly pause `requestAnimationFrame` in background tabs, which matches the observed failure ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/window/requestAnimationFrame)).

V1 should accept **WAV/PCM, MP3, and OGG/Opus**, reject anything the browser cannot decode, run at **1.0× real time**, enforce a **90-second maximum**, process **one file at a time**, and refuse to start or continue when the page is hidden. M4A should be deferred until a conversion policy is deliberately chosen.

The existing replay and recording code supplies most primitives, but it is not itself a complete Demo Studio. Its current gaps are: incomplete run isolation, no source-audio track in replay capture, no shared audio/capture start barrier, no positive wait for all Visual Re-entry and camera work to settle, no overall replay watchdog, an unresolved credential-boundary failure on long runs, and no video pixel-integrity gate.

## Current prerecorded-audio architecture

There are three materially different prerecorded paths.

### 1. Development deterministic replay — relevant and highest fidelity

`/try?replay=1` in a non-production build mounts `DevReplayLab`. A selected file is passed to `Board.runReplayExperiment`, which resets much of the current board state and calls `useDeepgram.startReplay`.

`startReplay`:

- is explicitly development-only;
- uses `AudioContext.decodeAudioData` on the browser file;
- renders it through a one-channel `OfflineAudioContext` at 48 kHz;
- retains a mono `Float32Array` in memory;
- converts successive 80 ms windows to signed PCM16;
- sends those buffers through the same `connectionRef` and live Deepgram configuration as microphone PCM;
- paces chunks against an absolute source clock;
- pauses at reconnect and resumes from the next unsent sample rather than restarting or bursting;
- retains per-chunk, provider-response, connection, rebase, and latency diagnostics;
- waits 1.8 seconds after the final chunk for endpointing/final transcript delivery.

The live Deepgram socket remains real: model `nova-3`, interim results, smart formatting, 150 ms endpointing, 1,000 ms utterance end, punctuation, VAD events, keyterms, mono linear16, and the production interim/final callbacks. Deepgram is not mocked.

`Board.runReplayExperiment` also uses the real V2/V3/Visual Re-entry/page/camera/rendering code and returns settled thoughts, transcript, visual lifecycles, scene evidence, page turns, camera events, and latency data. Modes such as `v2_only`, `vr_shell`, and `vr_decision` are experiments; a Studio must use only the full current production feature state, conceptually the current `vr_full` behavior, without exposing experimental mode choices.

This path bypasses the microphone device and AudioWorklet only. It does not bypass Deepgram or any downstream presentation layer.

### 2. Parked Audio Replay feature — real provider, wrong product semantics

`AudioReplayPanel` and `/api/audio/upload` are a separate lecture replay product, currently hidden by `features.audioReplay = false`.

That path:

- uploads bytes directly from the signed-in browser to the RLS-scoped Supabase `lecture-uploads` bucket;
- has the server download the object, call Deepgram prerecorded transcription once, and delete the temporary object in `finally`;
- chunks the completed word timeline into roughly 12-second transcript segments;
- prefetches `/api/artist` or `/api/math` decisions;
- applies those actions according to an `<audio>` playhead, slowing or pausing playback when visual processing lags.

It uses real Deepgram prerecorded transcription and real drawing action application, but it bypasses live interim/final segmentation, endpointing, V2, V3, and current Visual Re-entry timing. It intentionally has its own segmentation, buffering, playback-rate, and drawing schedule. It should **not** become the Demo Studio pipeline.

### 3. Existing scripted demo driver — useful capture precedent, brittle source injection

`scripts/demo-driver.js` decodes WAV, creates a `MediaStreamAudioDestinationNode`, temporarily replaces `navigator.mediaDevices.getUserMedia`, and feeds the synthetic stream through the app's microphone start button. This is structurally very close to a real microphone and uses the live AudioWorklet/Deepgram path. It also composites every Excalidraw canvas into a capture canvas and records `captureStream(30)` with `MediaRecorder`.

Its important lessons are reusable:

- wait for the real socket to become live before starting audio;
- composite all canvases, not one;
- keep the browser visible and bring it to the front;
- run sequentially;
- allow a post-speech settle tail;
- record real output without repairing it.

Its global `getUserMedia` monkeypatch, cookie handoff, fixed scripted WAV set, external capture server, and legacy API-focused report format should not become the Studio interface.

### Exact PCM retention

`lib/corpusAudio.ts` is a development-only observer of the live microphone worklet. It copies the same PCM16 buffer only after the normal socket send attempt, records sent/unsent chunks and transport epochs, caps retention at 20 minutes of 48 kHz samples, and can export a WAV plus metadata. This is valuable diagnostic/corpus infrastructure, but uploaded source audio is already exact and should be retained as the original file rather than re-recorded through this observer.

### Reuse decision

| Existing piece | Real Deepgram | Reuses production downstream code | Studio reuse |
|---|---:|---:|---|
| `useDeepgram.startReplay` PCM source swap | Yes, live socket | Yes | **Reuse/adapt** |
| `Board.runReplayExperiment` reset/reporting | Yes | Yes | **Extract/adapt carefully** |
| replay absolute scheduler and diagnostics | Yes | Yes | **Reuse** |
| `useCanvasRecorder` multi-canvas compositor | N/A | Captures actual rendered pixels | **Reuse/adapt** |
| `scripts/demo-driver.js` source injection | Yes | Yes | Learn from it; do not productize monkeypatching |
| `AudioReplayPanel` + `/api/audio/upload` | Yes, prerecorded API | Only action application | **Do not use for Studio** |
| transcript replay or settled-thought replay | No live speech pass | No | Regression tools only, never honest demos |
| dev replay authorization route | Enables real provider locally | N/A | Replace with an explicitly internal Studio authorization boundary; never expose publicly |

## Production speech entry point

The production path begins at `navigator.mediaDevices.getUserMedia({ audio: true })` in `useDeepgram.prewarm`. The stream enters an `AudioContext`, then `pcm-capture-worklet.js`. The worklet reads the first channel, converts samples to PCM16, and emits approximately 80 ms buffers at the context's native sample rate. `useDeepgram` sends each buffer directly to the active Deepgram socket.

If AudioWorklet initialization fails, production falls back to `MediaRecorder(stream)` with an 80 ms requested timeslice and sends encoded blobs. That fallback does not provide the same deterministic PCM seam and is not appropriate for Studio input.

Deepgram transcript messages are the convergence point. The socket handler calculates timing, then calls the same `Board` callbacks:

- interim -> `handleInterim` -> live text, V2/V3 accumulation, page/camera follow;
- final -> `handleFinal` -> final speech handling, thought boundaries, Visual Re-entry, page/camera changes.

The earliest safe file insertion is therefore **after file decoding/resampling but before `connection.send`**, using the existing `replay-pcm16` capture kind. This preserves the first provider-controlled boundary.

## Highest-fidelity audio insertion point

Ranked by fidelity to “the user actually spoke this into their microphone”:

1. **Existing `startReplay` decoded-PCM source swap into the shared live transport.** It replaces only acoustic capture, preserves real-time 80 ms PCM delivery, and keeps real Deepgram segmentation/interims/finals/endpointing plus every downstream layer. It is deterministic and does not depend on patching browser globals.
2. **Synthetic microphone `MediaStream` through the AudioWorklet**, as in `demo-driver.js`. This traverses one additional production component and is marginally more literal, but monkeypatching `getUserMedia` is brittle, can affect webcam/recorder requests, and adds WebAudio scheduling/resampling variability without meaningful downstream fidelity gain.
3. **A newly built raw-PCM transport alongside `useDeepgram`.** It could be equivalent, but would duplicate a working seam and invite configuration drift.
4. **Transcript replay after Deepgram.** It loses provider interim revisions, final boundaries, word/provider timing, endpointing, and network delay; V2/V3/page/camera timing changes.
5. **Settled-thought replay.** It also skips V2 and V3 and is suitable only for deterministic downstream tests.

The preferred V1 is rank 1. In implementation, the Studio-specific coordinator should call the same shared replay source rather than copy its transport.

## Supported audio-format strategy

### Current behavior

The development replay path trusts `AudioContext.decodeAudioData`. It does not inspect extension/MIME beyond the file picker. It then uses `OfflineAudioContext(1, ..., 48000)` to downmix to one channel and resample to 48 kHz. Downstream receives mono, signed 16-bit little-endian PCM in 80 ms chunks: 3,840 samples or 7,680 bytes for a full 48 kHz chunk.

The repository has repeatedly replayed an approximately 88-second WhatsApp OGG voice note successfully, so OGG/Opus works in the actual Chrome development environment. WAV and MP3 are also practical browser-decoded inputs. M4A is a container whose codec support can vary by browser/platform and should not be promised merely because of the extension.

### V1 policy

Accept:

- `.wav` containing ordinary PCM;
- `.mp3`;
- `.ogg` / `.opus`, including WhatsApp voice notes.

Defer:

- `.m4a` / `.mp4` audio until a tested codec matrix or a controlled conversion step exists;
- video containers;
- lossless/specialist formats and arbitrary “audio/*”.

Validation must decode the entire file before a run, not trust extension or MIME. Reject zero-channel, zero-duration, non-finite-duration, over-limit, and decode-failed files. Record original sample rate/channel count and normalized sample rate/channel count in metadata.

Browser-side decoding is sufficient for V1 and keeps source bytes local. Server conversion is not needed for the three accepted formats. If M4A becomes important, add a deliberate local conversion stage later; do not route it through the parked lecture upload pipeline.

## Real-time vs accelerated playback

**Recommendation: real time at 1.0×.**

Acceleration would change the visible product, not merely finish sooner:

- Deepgram interims/finals and endpointing depend on streaming cadence and silence duration.
- V2 live text is driven by the arrival and agreement of consecutive interims.
- V3 boundary decisions use receive times, holds, and safety windows.
- Visual Re-entry evidence, quiet commits, expiry, and drain behavior use timers and speech ownership.
- page arrival and live follow occur as text grows.
- camera springs advance on wall-clock animation frames.
- overview/hold timers include a 1.8-second live-camera window.
- browser/model/network latency relative to speech changes when audio is sent faster.

The replay scheduler explicitly treats two 80 ms chunks overdue as a genuine stall and rebases rather than bursting. Sending faster would violate the invariant that made replay representative.

Offline acceleration remains useful for transcript-only tests and deterministic camera-policy replay, but not for honest product video.

## Session isolation

`runReplayExperiment` performs a substantial reset: it aborts model work, bumps the Visual Re-entry generation, empties pending/evidence queues, cancels camera animation, resets camera/page-arrival counters and composition, resets Excalidraw scroll/zoom, clears key timers and scene elements, creates a new semantic board, resets page/pen/marks/concept/frame/final/live/V2 state, clears processed visual IDs and replay diagnostics, clears the visible interim, commits an empty scene, resets latency, and assigns a fresh start time.

That is good regression-harness hygiene, but it is not a proof of complete Studio isolation. Consecutive runs still occur in one mounted `Board` and reuse the existing product session ID, autosave instance, log array, and browser persistence. The reset block does not visibly create a fresh session ID or clear every long-lived ref (for example story/session persistence and some history/deferred-reference structures are outside the reset block). The report slices the log from `logStart`; it does not erase the prior log. Autosave can therefore persist replay state under the mounted session.

V1 should use a **fresh Board instance and fresh demo run/session identifier for every file**, preferably by remounting a dedicated board subtree keyed by `demoId`. Before audio begins it must assert:

- empty Excalidraw element list;
- page 0, generation 0;
- camera `(0, 0, 1)` and no active spring/target;
- empty final/interim/current thought;
- empty V3 and Visual Re-entry queues/evidence/processed ownership;
- no pending model request or timer from a prior run;
- empty run-local event log;
- fresh Deepgram connection and credential;
- demo-local persistence only, not normal project/session autosave.

After a run, abort/close all provider work, stop recorder/media tracks, revoke object URLs, and destroy/remount the board before another run. A generation token must guard every async callback.

## Current camera architecture

The camera is a view over Excalidraw, represented only by:

```ts
{ scrollX: number; scrollY: number; zoom: number }
```

`framePage` gathers visible content on the current logical page, chooses focal/context bounds, reads the current Excalidraw app state and viewport, and calls the pure `proposeCamera` policy. The policy checks the recording-safe frame, text readability, webcam collision, content fit, subject/follow/navigation intent, manual priority, cooldown, displacement threshold, and allowed zoom change.

If movement is approved, `animateCamera` starts or retargets a critically damped spring. Every `requestAnimationFrame` step advances X, Y, and zoom with `stepCameraSpring` and writes the new values through `ExcalidrawAPI.updateScene({ appState })`. A move completes only after position and velocity are below thresholds. Page turns and the first live-follow proposal can be coalesced so the viewer sees one arrival rather than a throwaway intermediate move.

Camera behaviors are therefore:

- pan/reposition through `scrollX` and `scrollY`;
- zoom through the Excalidraw zoom value;
- framing around focal and optional context bounds;
- spring target movement/retargeting;
- page-relative repositioning because pages occupy different world origins.

## What "camera rotation/angle" actually means in code

InPublic does **not** literally rotate the camera. There is no camera rotation, roll, pitch, yaw, angle, or transform matrix in the camera state or spring. Excalidraw elements can have their own angles, but the audited camera policy does not animate a view rotation.

What is likely being perceived as a questionable “angle” is one or more of:

- horizontal/vertical pan to a focal target;
- zoom level changing the apparent relationship between content and whitespace;
- centering on only the trailing live words rather than the whole text element;
- asymmetry from the safe frame reserving space for product UI/webcam areas;
- content alignment within a page;
- a page origin transition;
- repeated spring retargeting before the prior target settles;
- a very small occupied-canvas ratio, making the subject look oddly framed;
- old context being dropped to preserve readable zoom.

Those are camera-product-quality questions. This audit does not change them.

## Browser rendering dependency

The visible path is:

```text
framePage decision
  -> proposeCamera target
  -> animateCamera spring state
  -> requestAnimationFrame callback
  -> Excalidraw updateScene(appState scroll/zoom)
  -> Excalidraw render scheduling
  -> static + interactive canvas repaint
  -> compositor requestAnimationFrame
  -> capture canvas repaint
  -> CanvasCaptureMediaStreamTrack frame
  -> MediaRecorder bytes
```

Telemetry before the first animation frame proves only that a target was requested. Even a `camera completed` event proves the spring callback advanced, not by itself that every corresponding canvas frame was encoded. For the viewer to see motion, the document must receive animation frames, Excalidraw must repaint, the compositor must draw the latest layers, and the capture track/encoder must receive those frames.

## Hidden-tab / requestAnimationFrame problem

The prior failure is fully consistent with both code and recorded evidence:

1. The Browser-pane document remained `hidden` for the entire run.
2. Timers, network requests, Deepgram callbacks, and application state continued.
3. `animateCamera` and the compositor depended on `requestAnimationFrame`.
4. Excalidraw's displayed canvases stopped repainting.
5. Page turns at approximately 60.6 and 82.3 seconds existed in the event log after the captured pixels had frozen around 48 seconds.
6. The MP4 was structurally valid but visually false after the freeze.

Environment assessment:

| Environment | Effect | V1 suitability |
|---|---|---|
| Normal foreground user browser tab | Reliable while visible, foreground, unminimized, and not occluded by OS power/session behavior | **Recommended** |
| Internal browser route | Same browser rules; “internal” does not protect it from background throttling | Recommended only with a visibility lock and user instruction |
| Playwright/headless Chrome | Can record a real page and often renders rAF, but repository evidence does not establish focus/compositor guarantees for this app; browser-context video is written after context close ([Playwright](https://playwright.dev/docs/videos)) | Later, after a headed/focused validation corpus |
| Vercel/Next server function | No DOM, `window`, Excalidraw canvas, or browser compositor. Bundling Chromium is a separate heavy runtime design, not the current app | Not V1 |
| Worker/background queue | No browser rendering surface; cannot directly execute this actual renderer | Not V1 |

V1 must listen to `visibilitychange`, preflight `document.visibilityState === "visible"`, and fail—not pause silently—if it becomes hidden during capture. Keeping a normal tab in the foreground is more reliable than attempting to defeat browser throttling with flags.

## Video capture options

| Option | Camera/page/text animation | Focus requirement | Audio sync | Complexity | Reliability/batch notes |
|---|---|---|---|---|---|
| One Excalidraw canvas `captureStream()` | Incomplete because Excalidraw has at least static and interactive layers | Visible rendering still required | Can add audio track | Low | Reject: can omit a visible layer |
| Composite all Excalidraw canvases -> `captureStream(30)` -> `MediaRecorder` | Yes, if source layers repaint | **Yes for this V1** | Strong with shared clock and one recorder | Medium; primitive already exists | **Best V1**. `captureStream()` is a widely available real-time canvas stream API ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream)) |
| Browser/tab/screen capture | Yes, including DOM UI/browser surface depending on selection | Requires user permission and correct surface; foreground still safest | Browser can include tab audio | Medium UX, low compositor code | Faithful but less clean/deterministic and permission-heavy |
| Playwright browser-context video | Records actual viewport; should include all rendered layers | Prefer dedicated headed visible window based on repo evidence | Source audio muxing/export needs extra work | Medium/high | Good future automation; one context per run and explicit close required |
| Periodic screenshots/JPEG + FFmpeg/OpenCV | Only whatever the canvas painted at sample time | Yes for actual canvas freshness | Must synthesize/mux timing | High; poor at 1 FPS | Useful validation/fallback, not primary animation capture |
| Server-side static Excalidraw export | No real live camera/interim animation | No tab | Offline mux possible | Medium | Reject as fake/special renderer for this goal |
| Server-hosted Chromium/headless render | Potentially real app if full browser runs | Needs a proven compositor lifecycle | Possible | Very high infrastructure | Future only; binary, duration, focus, storage, and validation concerns |

The selected primitive is the one already embodied in `useCanvasRecorder` and `demo-driver.js`: composite all actual canvases into one canvas, then record that canvas. `MediaRecorder` should prefer a browser-supported H.264/AAC MP4 configuration. If the selected Chrome cannot record real MP4, V1 must either fail its codec preflight or preserve the native WebM intermediate and explicitly transcode it in a local finalization step. It must never rename WebM bytes to `.mp4`.

## Canvas-layer composition

The live Excalidraw DOM has been observed and recorded with two relevant canvas layers: a static/content canvas and an interactive overlay. Both existing recorders correctly query **all** canvases under the Excalidraw/board host, use each layer's DOM rectangle, and draw them in DOM order onto a white output canvas.

Capturing only one layer is insufficient as a contract. The exact division of content is an Excalidraw implementation detail and can change during interaction or canvas replacement. The compositor should discover layers each frame, because existing code already notes that Excalidraw can replace a canvas between discovery and draw.

The minimal clean demo surface is:

- white background;
- every visible Excalidraw canvas layer in DOM stacking order;
- no top bar, control bar, replay lab, error UI, developer overlays, browser chrome, or DOM cursor;
- transcript overlay only if deliberately selected as a demo style, otherwise off;
- webcam only if deliberately selected later, otherwise off.

Camera transformations are already baked into each Excalidraw layer's pixels after `updateScene`; the compositor must not independently recreate the camera.

## Audio/video synchronization

Replay currently streams PCM to Deepgram but does not play or record the source voice note. The normal canvas recorder independently calls `getUserMedia` for a microphone, which is the wrong audio source for Studio.

V1 should decode once and establish one run master clock:

1. mount/reset the board and open the real Deepgram socket;
2. create the compositor and `MediaRecorder` stream;
3. route the decoded source through an `AudioBufferSourceNode` to a `MediaStreamAudioDestinationNode` (and optionally the user's speakers);
4. add that destination's audio track to the same `MediaStream` as the capture canvas video track;
5. choose one scheduled `audioStartAt` and align replay source offset zero to it;
6. start `MediaRecorder` before that barrier, then start audible source and PCM scheduling at the barrier;
7. store the measured recording-start-to-audio-start offset.

Both human-heard speech and Deepgram input must derive from the same decoded buffer. The Deepgram scheduler should use the same source-time origin; it must not use a loosely started `<audio>` element as a second independent clock. MediaRecorder then timestamps audio and video in one recording stream.

A short, fixed pre-roll (for example 500 ms) is acceptable and should be metadata, not trimmed by guesswork. Audio/video validation should require durations within a small tolerance and confirm a non-empty audio track.

## Recording lifecycle

### Start

Recording should begin **after** decode, reset, codec, visibility, canvas-paint, and Deepgram-live preflights, but **before the first audio chunk**. Recommended lifecycle:

- render and capture 0.5 seconds of the empty/resting board;
- start source audio and the first PCM chunk at the shared barrier;
- define source speech time zero at that barrier.

Starting on first detected speech or first visible word would lose startup latency and make synchronization depend on VAD/transcript behavior. A pre-audio start is deterministic and honest.

### End

Do not end at the final source byte. End only when all of these hold:

- every source PCM sample has been sent;
- Deepgram has delivered the final/endpointed result or the bounded final wait has expired as an error;
- `flushPresentationBoundary` has completed;
- no Visual Re-entry decision/render/quiet-commit work remains;
- no pending page-arrival camera exists;
- the camera spring is absent or at target;
- at least two fresh compositor frames show the final state;
- a final resting hold of approximately 1.5–2 seconds has elapsed.

Use a bounded tail (recommended maximum 8–10 seconds after source end). Hitting the bound is a failed/incomplete run, not permission to label it complete.

The current replay's fixed 1.8-second wait plus `flushPresentationBoundary` is not a sufficient Studio completion contract because a Visual Re-entry call started by the flush is not necessarily complete when the flush returns.

## Replay credential/reconnect risk

The dev replay route mints a 180-second credential; normal live credentials remain 60 seconds. Each run deliberately discards its credential afterward. Clean approximately 88-second runs are documented as completing with all 1,100 chunks and no reconnect.

Long replay evidence reports a stall near 357 seconds, aligning with a second approximately 180-second credential boundary. The most likely compound root cause is:

1. the replay connection reaches credential expiry and closes;
2. the sender correctly pauses at the next unsent sample and requests reconnect;
3. a later reconnect/credential open fails or never reaches `Open`;
4. when reconnect attempts are exhausted, `reconnectRef` sets error state and `startedRef = false` but does **not** reject `replayCompletionRef`;
5. `startReplay` and `runReplayExperiment` therefore await forever, so the lab appears stalled instead of failed.

The exact provider-side reason for the observed second reopen failure was not retained in a completed run artifact, so it cannot honestly be narrowed further from this tree. Separately, forced-reconnect tests show that chunk sequence resumes without skips/duplicates/bursts but loses transcript characters at reconnect boundaries; this is another fidelity reason to avoid reconnect in V1.

Current maximum safety statement:

- empirically clean: approximately 88 seconds;
- credential envelope: a fresh connection should avoid expiry well below 180 seconds;
- not safe to promise today: inputs that approach/cross the first 180-second boundary;
- V1 hard maximum: 90 seconds, so reconnect is not part of a successful normal run.

The issue does not block the recommended V1. Add an overall sender/progress watchdog and explicit failure state in the later Studio implementation, but reconnect repair itself can remain a separate task.

## Recommended V1 input-duration limit

**Maximum 90 seconds; suggested content range 30–90 seconds.**

This fits the demonstrated natural WhatsApp sample, is useful for social and landing-page content, costs approximately one audio minute per minute, completes in a reasonable creator session, leaves a large margin inside the 180-second replay credential, and avoids the known reconnect path. A two-minute limit would probably fit one credential but gives less failure margin and is not needed for initial content creation.

## Demo Studio UX

Minimum internal V1:

- internal/local access only;
- file picker for WAV, MP3, or OGG/Opus;
- optional title and topic/category;
- decoded duration/format/channel/sample-rate preview;
- visible preflight indicators: page visible, MP4 codec available, canvas mounted/painting, Deepgram ready;
- one **Run** button;
- status: `decoding -> preflighting -> connecting -> recording -> settling -> validating -> complete`;
- live read-only progress with source time, expected duration, page count, visual families, and warnings;
- explicit failure status and retry from a fresh board;
- final video preview and download;
- downloads for source, session/transcript/metadata, and thumbnail;
- manual fields for best moment/timestamp and content suitability.

Do not expose replay experiment modes, disconnect tests, corpus internals, auth/payment controls, or developer reports in the creator UI.

The UI must display: “Keep this tab visible and in front until validation completes.” If visibility changes, mark the run failed and require a fresh rerun; silently resuming would create a discontinuity in both audio pacing and animation.

## Batch/queue recommendation

**One recording at a time in V1. No queue.**

Only one foreground browser surface can be trusted to render at a time, and the product also has active-session/connection lifecycle constraints. Parallel runs compete for focus, animation frames, memory, encoding, provider connections, and session state. Even a sequential hidden queue would fail when the creator changes tabs.

Later batching should be a visible sequential queue in a dedicated headed capture browser, with a brand-new context/board per item and capture-integrity validation between items. Do not add it until one-run reliability is established.

## Output artifact format

One successful run should produce a folder/bundle such as:

```text
demo-<id>/
  source-audio.<original-extension>
  video.mp4
  session.json
  transcript.txt
  metadata.json
  thumbnail.png
```

Minimum `metadata.json`:

- schema version and demo ID;
- source filename, MIME, byte size, duration, original sample rate/channels;
- normalized 48 kHz mono PCM duration/chunk count;
- run/session ID, creation time, app commit/pipeline feature state;
- recording dimensions, FPS, codec, video/audio duration and byte size;
- recording-to-audio offset and tail duration;
- settled thought count, page count, page-turn timestamps;
- committed visual families and commit timestamps;
- camera start/complete timestamps and targets;
- visibility/rAF/compositor health summary;
- capture-validation result and metrics;
- errors/warnings;
- manually reviewed best moment/timestamp and content-use flags.

`session.json` should contain the run-local event log, scene/semantic evidence, settled thoughts, transcript segments/provider timing, visual lifecycles, and replay diagnostics. Do not rely on `metadata.json` as the complete forensic record.

If native MP4 recording is unavailable and a WebM intermediate is transcoded, preserve the intermediate until the MP4 validates, record both codec/container details, then allow manual deletion.

## DEMO-CONTENT integration

V1 should **prepare**, not automatically publish, a `docs/DEMO-CONTENT.md` entry. Generate or expose the objective fields (topic, source reference, video path, duration, visual families, event timestamps), then require a human to watch the validated video and decide:

- best moment and timestamp;
- postable?;
- landing-page worthy?;
- `/try`-page worthy?;
- privacy/consent clearance;
- short editorial note.

“Good content” is subjective and must not be inferred from number of visuals or telemetry. Automatic repository editing can wait; manual review protects both quality and privacy.

## Landing-page / Try-page future use

Studio outputs should be reusable media plus metadata, not route-specific components.

Later the landing page can select validated MP4/poster pairs for a hero, example gallery, or visual-family examples. `/try` can use short approved previews and the associated topic/category metadata for “Not sure what to say?”, prompt education, and tiny examples. Both surfaces should reference the same approved artifact IDs and derivative clips.

No landing or `/try` code needs to know how the demo was captured. Derivative crops/compressions can be generated from the canonical validated video without rerunning or faking the board.

## Demo corpus categories

Organize future recordings on two axes rather than one flat list.

**Expressive form / expected behavior**

- clean text-only explanation (expected no visual);
- enumeration;
- quantitative change;
- sequence;
- cause/effect;
- comparison;
- multi-page explanation;
- long continuous thought/boundary stress;
- deliberate pause and resume;
- mixed forms where restraint matters.

**Domain / voice**

- education;
- business/product;
- science/technical;
- personal idea/reflection;
- story/anecdote in Standard Mode;
- esports/MLBB and domain vocabulary;
- creator/build-in-public.

Each corpus item should declare expected capabilities but not expected exact pixels: source type (natural/scripted/synthetic), duration, topic, consent/privacy status, desired form, expected visual family or expected `none`, app commit, accepted output artifacts, and human review notes. Keep deterministic regression fixtures distinct from natural demo candidates.

## Cost drivers

The locally configured rate card records Deepgram `nova-3` at `$0.0090 / audio minute` as of the repository's 2026-08-09 migration. Treat that as a local budgeting assumption, not a newly verified provider quote.

For source duration `m` minutes and `n` demos:

- Deepgram audio usage: `n * m` provider audio minutes;
- locally configured Deepgram estimate: `n * m * $0.0090`;
- deterministic Visual Re-entry fast paths: no model cost;
- model fallback: sum actual input/cache/output tokens for each `/api/visual-intent` call at the configured `SCRIBE_MODEL` rate;
- video encoding: local browser CPU during the run, plus optional transcode CPU approximately proportional to duration, resolution, FPS, and codec preset;
- storage: original audio bytes + video bytes + small JSON/text/thumbnail artifacts, multiplied by retained derivatives/backups;
- bandwidth: downloads/uploads of those stored artifacts if moved off the local machine.

Illustrative usage quantities for 60-second inputs:

| Count | Deepgram minutes | Locally configured Deepgram estimate | Encoding work | Storage |
|---:|---:|---:|---|---|
| 1 | 1 | `$0.009` | 1 real-time minute + tail (+ optional transcode) | 1 source + 1 video + metadata |
| 10 | 10 | `$0.09` | 10 sequential real-time minutes + tails | 10 bundles |
| 50 | 50 | `$0.45` | 50 sequential real-time minutes + tails | 50 bundles |

Fallback-token, encoding, and storage costs cannot be honestly reduced to dollars from current run-independent code alone; report measured counts/bytes per run and multiply.

## Privacy/storage

The recommended local V1 can keep original audio bytes, decoded PCM, capture stream, and final artifacts in the creator's browser/machine. Speech PCM still goes to real Deepgram; Visual Re-entry fallback sends eligible settled text to the configured model provider. That provider exposure is inherent in the real product pipeline and must be disclosed.

Avoid `/api/audio/upload` and Supabase lecture storage for V1. Although that route deletes its temporary object in `finally`, it is unnecessary for browser-decoded live replay and adds server/storage/auth infrastructure.

V1 policy:

- decode and hold PCM in memory only;
- save source/video/session artifacts locally only after a successful run or explicit user choice;
- show an explicit discard/delete action for browser IndexedDB/object URLs;
- do not sync demo board state through normal project autosave;
- do not upload videos or source audio automatically;
- store consent/privacy review in metadata before an artifact is marked public-usable;
- never log raw source bytes, access tokens, or session cookies.

If cloud storage is later added, define retention/deletion, encryption, access control, provider disclosure, and orphan cleanup before accepting uploads.

## Failure detection

A run needs explicit terminal failures for:

- unsupported extension/MIME policy;
- browser decode failure or invalid/zero/over-90-second audio;
- normalization failure or non-finite PCM;
- MP4/MediaRecorder/captureStream codec preflight failure;
- Deepgram authorization, connection, token, or reconnect failure;
- replay cursor/sender stall (no chunk progress beyond a bounded threshold);
- no speech/transcript detected despite non-silent input;
- hidden document at preflight or any `visibilitychange` during the run;
- rAF/compositor heartbeat gap;
- missing/replaced canvas layer that cannot be painted;
- MediaRecorder error, zero-byte output, invalid/undecodable video, or missing audio track;
- audio/video duration or start-offset outside tolerance;
- final transcript/boundary never arriving;
- pending Visual Re-entry/page/camera work exceeding tail timeout;
- camera/page/visual telemetry with no corresponding captured pixel change;
- visually frozen output after earlier motion;
- failed final thumbnail extraction.

`COMPLETE` is allowed only after artifact decoding and capture-integrity validation pass.

## Capture-integrity validation

Validation must test the recorded pixels, not only live telemetry.

Recommended V1 gates:

1. **Runtime visibility gate:** document was visible for the entire capture; no hidden interval is tolerated.
2. **Animation/compositor heartbeat:** record rAF timestamps, compositor frame count, maximum frame gap, discovered canvas count, and draw errors. Large gaps fail the run.
3. **Container gate:** output is non-zero, decodable, expected dimensions/FPS range, has video and audio, and duration is within tolerance of pre-roll + source + tail.
4. **Frame sampling:** decode/snapshot frames regularly (for example 4–10 samples/second for validation) and compute luma/pixel differences or perceptual hashes.
5. **Event-to-pixel correlation:** for every meaningful camera start, page turn, text commit, and visual commit, require a pixel-change window around its recorded timestamp. Page turns/camera pans should affect a broad region, not merely a few glyph pixels.
6. **Motion-shape check:** a camera spring with a material target delta should produce multiple distinct frames between start and completion, not only a start/end jump or no change.
7. **Freeze check:** if semantic/camera events continue, a long suffix of identical/near-identical frames is an automatic failure. Static final tail is allowed only after the last expected visual event.
8. **Final-state check:** the extracted final video frame should be perceptually close to a compositor snapshot taken after camera settle.
9. **Audio check:** audio track exists, is non-silent for a non-silent source, and its start/end aligns with stored offsets.

Thresholds should be calibrated from successful foreground runs. A small text update can change only a few percent of pixels, while a pan/page turn changes much more; one global difference threshold is insufficient. Store raw validation metrics so a false positive can be audited.

This would have rejected the prior bad videos: page-turn/camera events occurred after the video entered a near-static suffix.

## Camera capture vs camera quality

These are separate acceptance layers.

**Capture failure:** camera state changes but the encoded pixels do not show it. This is a Studio correctness failure and must block completion.

**Camera product quality:** the encoded pixels faithfully show the real movement, but the target, whitespace, zoom, centering, cadence, or framing feels wrong. This is valid demo evidence and should be retained for a later camera-policy review.

V1 solves capture failure first. It must not “improve” questionable framing in the compositor or post-production, because that would hide the product behavior the corpus is meant to reveal.

Once capture is trustworthy, the Studio becomes a better camera-audit instrument than telemetry alone: replay the same natural voice note through a frozen commit, watch every real frame, correlate it with proposal/spring events, and compare framing across future code changes. Exact pixel determinism is not guaranteed because Deepgram/network/model responses can vary, so retain transcripts/events/commit with every video; deterministic pure-policy replay remains complementary.

## Architecture comparison

### Option A — foreground browser Studio + real-time PCM replay + multi-canvas MediaRecorder

**Pros:** highest practical product fidelity; reuses existing live socket and real board; captures clean board pixels; simplest infrastructure; user can watch the run; source stays local except real providers; easy to retry; existing recorder proves the primitives.

**Cons:** tab must remain visible/foreground; browser/codec-specific; batch automation is intentionally weak; needs shared-clock audio wiring and validation.

**Fidelity:** very high.  
**Camera reliability:** high under enforced visibility plus validation.  
**Batchability:** low in V1; sequential later.  
**Complexity/cost:** medium; local CPU and real provider usage.  
**Main risk:** user backgrounds/minimizes the tab or browser codec behavior differs.

### Option B — dedicated headed automated Chrome + real-time replay + browser/context or multi-canvas capture

**Pros:** can create fresh contexts, force viewport, automate sequential jobs, retain video automatically, and later become a batch worker; still runs the real app.

**Cons:** reliable focus/visibility becomes an OS automation responsibility; current script explicitly warns that occlusion/backgrounding broke capture; session/auth handoff and lifecycle are more complex; Playwright video audio/mux details need validation; harder for an internal creator to observe failures.

**Fidelity:** high if it runs the identical route and capture surface.  
**Camera reliability:** medium until demonstrated under a dedicated visible desktop session.  
**Batchability:** medium/high sequentially.  
**Complexity/cost:** high; maintained machine/desktop plus browser/encoding resources.  
**Main risk:** assuming “headed” or “bringToFront” guarantees compositor activity when the desktop is locked, minimized, occluded, or disconnected.

### Option C — foreground headed browser + periodic high-FPS frame extraction + local FFmpeg assembly

**Pros:** every stored frame can be inspected; easy event-to-frame validation; deterministic final encoding/container; can recover a partial image sequence after encoder failure.

**Cons:** high storage/I/O, more timing and audio mux work, screenshots still capture stale canvases if rendering freezes, and low sampling rates miss spring/text animation. The prior 1 FPS attempt demonstrates the danger.

**Fidelity:** medium at ordinary screenshot rates; high only at costly frame rates.  
**Camera reliability:** high only with the same foreground requirement as A.  
**Batchability:** medium sequentially.  
**Complexity/cost:** high local I/O/encoding.  
**Main risk:** false confidence from valid frames that repeatedly contain the same frozen canvas.

### Option D — server/headless Chromium job

**Pros:** eventual unattended batch processing and centralized artifacts.

**Cons:** no such renderer/runtime exists in the current architecture; Vercel functions are not browser pages; full Chromium/FFmpeg, duration, storage, auth, concurrency, provider connections, and rendering validation all become infrastructure. A static Excalidraw renderer would violate the honest-demo principle.

**Fidelity:** potentially high only if the full real app runs in a proven Chromium compositor.  
**Camera reliability:** unproven.  
**Batchability:** high in theory.  
**Complexity/cost:** very high.  
**Main risk:** building an expensive background renderer that again produces valid files without faithful animation.

| OPTION | FIDELITY | CAMERA RELIABILITY | COMPLEXITY | BATCHABILITY | MAIN RISK | RECOMMENDED? |
|---|---|---|---|---|---|---|
| A. Foreground browser + real-time PCM + composited canvas MediaRecorder | Very high | High with visibility + pixel validation | Medium | Low initially | Tab hidden/codec mismatch | **Yes, V1** |
| B. Dedicated headed automated Chrome | High | Medium until OS-focus evidence exists | High | Medium/high sequential | Headed window not truly compositing | Later |
| C. Foreground frame sequence + FFmpeg | Medium–high at high FPS | High only while foreground | High | Medium | Stale repeated frames, sync/I/O | Validation/fallback only |
| D. Server/headless Chromium job | Potentially high | Unproven | Very high | High | Infrastructure repeats silent-render failure | No for V1 |

## Recommended V1 architecture

Implement **Option A** next:

- an internal/local foreground browser route;
- one file/run at a time;
- decode WAV/MP3/OGG with `decodeAudioData`;
- normalize to mono 48 kHz;
- use the existing `replay-pcm16` real-time sender and live Deepgram configuration;
- use a fresh run-scoped Board instance with production V2/V3/Visual Re-entry features only;
- establish one master start clock for source audio, PCM pacing, and recording;
- composite all actual Excalidraw canvases at 30 FPS;
- record video plus the source-audio track in one `MediaRecorder`;
- require visible/foreground state throughout;
- wait for provider finalization, presentation/Visual Re-entry drain, camera settle, and a final hold;
- validate the encoded audio/video and correlate expected events with pixel motion;
- save/download the local artifact bundle;
- hard-limit input to 90 seconds.

This architecture gives the closest safe result to a real microphone session without creating a second renderer. It is intentionally not background-capable in V1.

## V1 creator workflow

1. Record several natural 30–90 second voice notes, keeping personal/private content out unless intentionally approved.
2. Open the internal Demo Studio in Chrome and keep its window visible in front.
3. Choose one WAV, MP3, or OGG/Opus file.
4. Add an optional title/topic/category.
5. Let preflight decode the full file and verify duration, codec, visibility, canvas, recorder, and provider readiness.
6. Press **Run**.
7. Watch the real board while the file is paced through real Deepgram at 1.0×.
8. Do not change tabs, minimize, lock, or cover the capture window.
9. Let the Studio wait for the final transcript, thought/visual drain, page/camera settle, and final hold.
10. Let it validate container, audio, frame cadence, pixel motion, event correlation, and final frame.
11. If validation fails, discard the video and rerun from a freshly mounted board; never accept it as complete.
12. Preview the complete video with sound.
13. Download/save the source, MP4, session JSON, transcript, metadata, and thumbnail.
14. Watch manually and mark best moment/timestamp plus postable/landing/`/try` suitability and privacy clearance.
15. Add the reviewed entry to `docs/DEMO-CONTENT.md`.
16. Remount/reset, then repeat for the next voice note.

## Explicitly deferred scope

- public/customer voice-note upload;
- production upload/storage endpoints;
- M4A and arbitrary-format conversion;
- video-container input;
- multi-user jobs or queues;
- unattended/background/browser-hidden capture;
- Vercel/server/worker rendering;
- parallel capture;
- automated social posting;
- AI-written demo scripts;
- automatic “best clip” selection/editing;
- landing-page or `/try` redesign;
- cloud artifact gallery/CDN;
- reconnect repair and long recordings;
- camera policy/framing changes;
- automatic declaration that content is “good”;
- fake/static demo renderer;
- changes to Deepgram model/config, V2, V3, Visual Re-entry, page/camera policy, auth, persistence, payments, or product behavior.

## Direct answers

1. **Where should uploaded audio enter the real InPublic pipeline?** After browser decode/downmix/resample, at the existing `useDeepgram.startReplay` PCM source seam immediately before live Deepgram transport sends.
2. **Can we use the exact same Deepgram/V2/V3/Visual-Reentry path?** Yes. The current replay seam already uses the same live Deepgram configuration and interim/final callbacks, then the same Board pipeline. The microphone device/AudioWorklet capture is the only bypass.
3. **Should V1 run audio in real time?** Yes, at 1.0×. Acceleration changes provider segmentation, wall-clock holds, visuals, pages, and camera animation.
4. **What formats should V1 accept?** WAV/PCM, MP3, and OGG/Opus after full browser decode validation. Defer M4A.
5. **What should the maximum recording length be initially?** 90 seconds.
6. **What actually causes the camera movement called “rotation/angles”?** Pan (`scrollX/Y`), zoom, focal/context framing, page origins, whitespace/safe-frame centering, and spring retargeting.
7. **Does InPublic literally rotate the camera?** No. The camera state has only X, Y, and zoom.
8. **Why did previous captured canvases fail to show camera movement?** The capture document was hidden, so rAF-driven camera/compositor/Excalidraw repaint stopped while application logic and telemetry continued.
9. **What capture method is most likely to faithfully preserve camera movement?** A visible foreground browser compositing every live Excalidraw canvas into one 30 FPS capture canvas recorded with `captureStream` + `MediaRecorder`, followed by pixel validation.
10. **Does that method require a focused/visible browser tab?** For reliable V1 in this codebase, yes: visible, foreground, unminimized, and on an active desktop session.
11. **Can Demo Studio run reliably in the background?** Not with the current rAF/Excalidraw architecture, and V1 should explicitly refuse it.
12. **Should V1 process one recording at a time or support a queue?** One at a time.
13. **How should source audio be synchronized with the final video?** Derive audible audio and Deepgram PCM from one decoded buffer and shared source-time barrier; add the buffer's MediaStream audio track to the same MediaRecorder stream as video.
14. **When should recording begin?** After all preflights and socket readiness, approximately 0.5 seconds before the first scheduled source sample/chunk.
15. **When should recording end?** After source end, Deepgram finalization, boundary flush, Visual Re-entry drain, page/camera settle, two fresh final frames, and a 1.5–2 second resting hold, within a bounded tail.
16. **How can the Studio detect a visually frozen/bad capture?** Visibility/rAF heartbeat plus decoded frame differences correlated with camera/page/text/visual events, container/audio checks, freeze-suffix detection, and final-frame comparison.
17. **Would the current replay reconnect issue block V1?** No at a 90-second limit with a fresh 180-second credential. It blocks safely promising long/cross-boundary runs and requires an overall watchdog.
18. **What artifacts should one run save?** Original source audio, `video.mp4`, `session.json`, `transcript.txt`, `metadata.json`, and `thumbnail.png`; retain a WebM intermediate only when needed for explicit MP4 transcode.
19. **Can these outputs later power landing-page and `/try` demos?** Yes. Store canonical approved media/metadata and let both pages consume derivatives by artifact ID rather than page-specific capture hacks.
20. **Can the same infrastructure later become the camera-quality testing corpus?** Yes. Faithful videos plus camera/event metadata and frozen commits are the right evidence for framing review, alongside deterministic policy replay.
21. **What ONE architecture should we implement next?** Foreground browser Demo Studio, real-time existing PCM replay through real Deepgram, actual multi-canvas capture with source-audio mux, one run at a time, 90-second maximum, and mandatory pixel-integrity validation.
