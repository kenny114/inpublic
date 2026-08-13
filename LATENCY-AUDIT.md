# InPublic — live latency architecture audit

**Date:** 2026-08-11
**Commit:** `69d2c1c` (clean tree)
**Scope:** microphone → visible Excalidraw element. Investigation only; no code changed.

## Provenance rules used below

- **[CODE]** — read from source in this repo at `69d2c1c`.
- **[MEASURED]** — a number produced by a real run whose artifact is in the repo.
- **[PRIOR]** — a number measured by an earlier audit (`AUDIT-3.md`, 2026-08-09). Still
  cited, but flagged where later commits changed the code it measured.
- **[EST]** — an estimate. Labelled every time. No estimate is presented as a measurement.

---

# The headline

**You already have the architecture you were about to ask for.** The browser talks
directly to Deepgram over a WebSocket using a 60-second ephemeral token. No audio and no
transcript passes through your backend. Interim transcripts are inked to the canvas with
no model, no network, and no debounce, in 1–6 ms.

The slowness you feel is **not** in the speech path. It is in three places:

1. A **5,250 ms client-side throttle** on the Scribe, raised from 700 ms in `132cd79`
   for rate-limit/cost reasons. This is the single biggest regression from "snappy".
2. The **Beat → Artist chain** (~0.9–1.9 s + ~3.6–4.5 s, sequential, both blocking the
   first structural visual).
3. **~2 s of dead air between pressing Start and the mic going live** — measured, and
   entirely avoidable serial work.

---

# 1. Current architecture

```text
Microphone (OS/hardware)
   │  [CODE] hooks/useDeepgram.ts:542  navigator.mediaDevices.getUserMedia({audio:true})
   ↓  client-side. Stream acquired ONCE and reused across reconnects.
AudioContext({latencyHint:"interactive"}) + AudioWorklet
   │  [CODE] useDeepgram.ts:232-271 prepareCapture → public/pcm-capture-worklet.js
   │  Converts Float32 → Int16 PCM, posts a transferable ArrayBuffer every
   │  round(sampleRate * 0.08) frames = 80 ms of audio.
   │  Fallback: MediaRecorder with an 80 ms timeslice (useDeepgram.ts:398).
   ↓  worklet thread → main thread postMessage. Does NOT block.
connection.send(ArrayBuffer)
   │  [CODE] useDeepgram.ts:243-251. WebSocket. Direct to Deepgram.
   ↓  ***does not touch our server***
Deepgram nova-3 live (wss://api.deepgram.com)
   │  [CODE] useDeepgram.ts:353-367
   │  interim_results:true, endpointing:150, utterance_end_ms:1000,
   │  smart_format:true, punctuate:true, encoding:linear16, keyterm:[≤40]
   ↓  WebSocket back to the BROWSER. Not to our server.
LiveTranscriptionEvents.Transcript handler
   │  [CODE] useDeepgram.ts:411-475. Splits on data.is_final.
   ├─ interim → cbs.onInterim(text, audioEndMs, streamEpoch, confidence, timing)
   └─ final   → cbs.onFinal(...) then onInterim("") to clear
   ↓  local function call, same tick
Board.handleInterim / Board.handleFinal
   │  [CODE] components/Board.tsx:3839 / :3774
   │  handleInterim: correctTranscript() (sync, local) → setInterim() → writeLive()
   ↓  local function call
writeLive(text, settled, timing)
   │  [CODE] Board.tsx:1627-1825. THE FAST PATH.
   │  await fontsReady (resolved) → buildLiveLine (Board→lib/ops.ts:387,
   │  convertToExcalidrawElements for real font metrics) → patch the existing
   │  element in place by id → reserve the pen row → commit()
   ↓  local
commit()
   │  [CODE] Board.tsx:328-332
   │  apiRef.current.updateScene({elements}) + autosave.schedule() (debounced)
   ↓
Excalidraw <Excalidraw excalidrawAPI={...}/>  [CODE] Board.tsx:4386
   ↓
framePage(false, "following live narration", null, elementId)  [CODE] Board.tsx:1752
   │  Camera spring, requestAnimationFrame, additional updateScene per frame.
   ↓
PIXELS
```

Behind that, three slower lanes run **in parallel and never block the ink**:

```text
final transcript ──┬─→ scribePending  ──throttle 5250ms──→ POST /api/scribe (Haiku, SSE)
                   │                                        → parseLine → applyOp → marks
                   ├─→ pendingText ──600ms silence (1600ms if fragment)──→
                   │      POST /api/beat (Haiku) → decision
                   │        └─ draw/command → POST /api/artist (Sonnet) → actions
                   │             └─ applyActions → concepts, bound arrows
                   └─→ (story mode only, feature-flagged OFF) POST /api/story
```

### Per-step table

| # | Step | File / function | Side | Transport | Blocks next? | In | Out |
|---|------|-----------------|------|-----------|--------------|----|-----|
| 1 | Mic acquire | `useDeepgram.ts:542 start` | client | WebAPI | yes (startup only) | constraints | MediaStream |
| 2 | PCM capture | `pcm-capture-worklet.js process` | client | worklet→main postMessage | no | Float32 128-frame blocks | Int16 80 ms chunks |
| 3 | Send | `useDeepgram.ts:243` | client | **WebSocket → Deepgram** | no | ArrayBuffer | — |
| 4 | STT | Deepgram nova-3 | vendor | WebSocket | n/a | PCM | interim/final JSON |
| 5 | Receive | `useDeepgram.ts:411` | client | WS event | no | Deepgram JSON | text, audioEndMs, timing |
| 6 | Dispatch | `Board.tsx:3839 handleInterim` | client | fn call | no | text | corrected text |
| 7 | Correct | `lib/vocab.ts:240 correctTranscript` | client | fn call (sync) | yes (µs–ms) | text + ≤40 keyterms | corrected text |
| 8 | Build | `lib/ops.ts:387 buildLiveLine` | client | fn call (async import, cached) | yes | text, x, y | Excalidraw elements + measured w/h |
| 9 | Commit | `Board.tsx:328 commit` | client | Excalidraw API | yes | element array | scene update |
| 10 | Camera | `Board.tsx:791 framePage` → `:702 animateCamera` | client | rAF spring | no | bounds | scrollX/Y/zoom per frame |
| 11 | Paint | Excalidraw static+interactive canvas | client | — | — | scene | pixels |

Lanes 12+ (`/api/scribe`, `/api/beat`, `/api/artist`) are HTTP POST to Next route handlers
on Vercel, each fronted by `guardProviderRequest`, and none of them block steps 1–11.

---

# 2. Current Deepgram path

## **Architecture B. Exactly B.**

```text
Browser microphone ──WSS──> Deepgram ──WSS──> Browser
                    ↑
Browser ──HTTP GET /api/deepgram/token──> our server ──> Deepgram /auth/grant
```

| Question | Answer | Evidence |
|---|---|---|
| Where is the socket created? | In the browser | `useDeepgram.ts:353` `deepgram.listen.live({...})` after `await import("@deepgram/sdk")` |
| Where do credentials come from? | Server-minted ephemeral, **60 s TTL** | `app/api/deepgram/token/route.ts:7,32` `deepgram.auth.grantToken({ttl_seconds:60})`; fallback `createProjectKey` with `scopes:["usage:write"]` |
| Does audio pass through our backend? | **No** | `useDeepgram.ts:243-251` sends straight onto the Deepgram socket |
| Do transcripts pass through our backend? | **No** | `useDeepgram.ts:411` receives on the same browser socket |
| Temporary token used? | Yes | root `DEEPGRAM_API_KEY` never leaves the server |
| Proxy routes? | **None** | only `/api/deepgram/token`, which returns a credential and no audio |
| Multiple implementations? | One live, one unrelated | `lib/audio/transcribe.ts` is **prerecorded** (`listen.prerecorded.transcribeFile`), server-side, for the parked Audio Replay feature (`lib/features.ts` `audioReplay:false`). Not on the live path. |
| Dead/older implementations? | None found | `grep -rl deepgram` returns 7 files; all accounted for |

There is a second live engine, `hooks/useGeminiLive.ts` (mic → Gemini Live → `draw()` tool
calls). It is gated behind `NEXT_PUBLIC_ENGINE` which defaults to `"deepgram"`
(`Board.tsx:209`). It is dormant, not dead, and it feeds the same `applyOp` renderer.

### One real risk found here

`lib/server/limits.ts:34` — `deepgram: { limit: 3, windowSeconds: 600 }`. The token route
allows **3 mints per 10 minutes per user**. `useDeepgram`'s reconnect ladder is up to 12
attempts, and every attempt calls `openSocket()` which fetches a fresh token
(`useDeepgram.ts:309`). After 3 reconnects in a 10-minute window, listening cannot
recover — the 4th mint returns 429 and the ladder burns through its remaining attempts
against a wall. This is a reliability finding, not a latency one, but it is on the live
path.

---

# 3. Interim vs final transcripts

## What Deepgram is configured to send

| Signal | Requested? | Received? | Used for what |
|---|---|---|---|
| Interim transcripts | `interim_results:true` | yes | **Drives the ink.** |
| Final transcripts | implicit | yes (`data.is_final`) | Settles the line, feeds Scribe + Beat |
| Word-level timestamps | arrive in `alt.words` | **partially used** | only `words[0].end` → `firstWordEndMs`, telemetry only (`useDeepgram.ts:420`) |
| Confidence | `alt.confidence` | plumbed through | passed to `onInterim`; **only Story Mode reads it** (`Board.tsx:3863`); Standard Mode ignores it |
| `endpointing` | `150` ms | configured | how long Deepgram waits on silence before finalising |
| `utterance_end_ms` | `1000` | configured | **but `UtteranceEnd` is never subscribed to** — no `LiveTranscriptionEvents.UtteranceEnd` handler exists |
| `SpeechStarted` | not requested (`vad_events` absent) | no | — |
| `Metadata` | — | not handled | — |

## Interim path — no waiting anywhere

```text
Deepgram interim
   ↓  useDeepgram.ts:467  cbs.onInterim(...)
Board.handleInterim (Board.tsx:3839)
   ├→ correctTranscript(text, activeTerms)      sync, local, no logging
   ├→ setInterim(shown)                         React state → transcript strip only
   ├→ writeLive(shown, false, timing)           ← INK. immediate. no debounce.
   ├→ settled-word tracking: a word counts as settled once two consecutive
   │  interims agree on it (Board.tsx:3874-3892). Settled words are appended to
   │  scribePendingRef but the Scribe is deliberately NOT woken here.
   └→ if a silence timer is already running, reset it
```

There is **no buffering, no debounce, no minimum word count, and no wait for the final**
on the ink path. The comment at `Board.tsx:3866` says so and the code matches it.

## Final path

```text
Deepgram final
   ↓  useDeepgram.ts:431 onFinal + :439 onInterim("") to clear the strip
Board.handleFinal (Board.tsx:3774)
   ├→ localVoiceCommand(raw)  — "scratch that"/"undo"/"new page": handled 100% locally,
   │   aborts in-flight AI, no network. (lib/liveSpeech.ts:6)
   ├→ correct(raw)            — logged this time
   ├→ pendingText += text, capped at MAX_PENDING_WORDS=120
   ├→ scribePending += (words the interims hadn't already settled)
   ├→ writeLive(text, true)   ← re-inks the same element as SETTLED, reserves its row
   ├→ nudgeScribe()           → runScribe(), which then hits the 5250 ms throttle
   └→ resetSilenceTimer()     → 600 ms (complete thought) or 1600 ms (fragment) → runBeat
```

**Answer to "are we receiving speech quickly but waiting afterward?"** — for the *ink*,
no. For everything *intelligent*, yes: the Scribe waits up to 5.25 s on a client throttle
and the Beat waits 600–1600 ms on a silence timer before it even starts a ~1 s model call.

---

# 4. The critical path, measured

## What exists in the repo as real measurement

`output/demo-runs/demo-{a,b,c}.json` — produced by `scripts/demo-driver.js` driving the
real product with synthetic audio piped into its own `getUserMedia` (`docs/demo-capture.md`).
Everything downstream of the mic is the real product.

| Marker | Definition | demo-a | demo-b | demo-c |
|---|---|---|---|---|
| `micToLiveMs` | `getUserMedia` call → mic status "live" (socket open) | **8,992 ms** (cold) | **2,225 ms** | **1,945 ms** |
| `/api/beat` responses | wall-clock from run start | 33,437 / 47,048 | 13,179 / 19,504 / 25,798 / 31,158 | 11,711 / 16,823 / 23,737 / 30,045 |
| beat `draw` → artist response | | **4,517 ms** | (no artist entry) | (no artist entry) |
| errors | | `[]` | `[]` | `[]` |

Two things to note honestly: `micToLiveMs` starts at `getUserMedia`, so the
entitlement-refresh + `POST /api/usage/session` + autosave flush that run *before* it
(`Board.tsx:4034`) are **not** included — real button-press-to-live is worse than 1.9 s.
And demo-b/demo-c show `draw` decisions with no corresponding `/api/artist` entry in the
capture; the driver only records fetches whose body parses as JSON, so this is ambiguous
rather than conclusive — but it is worth a deliberate check.

## [PRIOR] from AUDIT-3.md (2026-08-09), with staleness flags

| Stage | Number | Still valid? |
|---|---|---|
| `writeLive` one interim → ink | **1–6 ms** (29 ms first call) | Yes structurally. `028f1d1` changed *capture*, not this function's body. |
| `/api/scribe` → first drawable op | **760 / 833 / 928 ms** (cold 3,205) | Route unchanged since. |
| `/api/scribe` complete | 769 / 840 / 1,214 ms | Same. |
| `/api/beat` | **901–1,916 ms** warm, 2,987 cold | ⚠️ `2568359` rewrote the beat prompt after this. Directionally valid, not exact. |
| `/api/artist` | **3,616 / 4,353 ms** | Corroborated by demo-a's 4,517 ms. |
| `applyActions` (2 concepts + bound arrow) | **10 ms** | Yes. |
| Deepgram token mint | 2,234 ms | Consistent with `micToLiveMs` 1.9–2.2 s. |

## T0–T8 against your list

| | Marker | Status |
|---|---|---|
| T0 | mic audio captured | **Not measurable from JS.** OS/hardware capture latency is invisible to the page. [EST] 10–30 ms. |
| T1 | audio sent from browser | **Instrumented but not persisted.** `noteAudioChunk` records `chunkGapP50/P95/Max` (`useDeepgram.ts:224`). Floor is 80 ms of buffering by construction. |
| T2 | Deepgram receives | **Not measurable.** Deepgram exposes no receive timestamp; only its own audio timeline. |
| T3 | first interim received | **Instrumented, not persisted.** `interimLagP50/P95/Max` = `receivedAt − audioEndMs` (`useDeepgram.ts:463`), plus `firstVisibleWordMs`. |
| T4 | useful transcript | = T3. No gate between them. |
| T5 | visual interpretation begins | Ink path: same tick as T3, no interpretation. Beat lane: T3 + 600–1600 ms silence. |
| T6 | first visual event | Ink: `writeLive` entry, `startedAt` at `Board.tsx:1632`. |
| T7 | Excalidraw mutation begins | `commit()` at `Board.tsx:1743`. |
| T8 | browser paints | **Instrumented, not persisted.** `paintP50/P95` via a post-`setInterim` rAF (`Board.tsx:3858`). |

### The instrumentation gap — this is the actionable part

The app **already computes almost exactly the numbers you asked for**. `writeLive` emits
one `{type:"live", lagP50, lagMax, renderP50, finalLag, paintP50, paintP95, interims}`
event per settled utterance (`Board.tsx:1803`), and `useDeepgram` emits a
`SpeechStreamMetrics` object per utterance with chunk cadence and interim lag.

`lagMs = inkedAt − audioEndMs` (`lib/telemetry.ts:19`), where `audioEndMs` is anchored to
Deepgram's own audio timeline per socket epoch. **That is a true mic-to-ink measurement**,
excluding only hardware capture latency, and it is epoch-guarded so a reconnect cannot
corrupt it (the fix in `028f1d1`).

What's missing is only the last mile:

1. These events live in `logRef` in memory and are lost on reload.
2. The only way out is `downloadLog()` via an Export menu item gated behind
   `process.env.NODE_ENV === "development"` (`CanvasShell.tsx:11,31-34`). **Production
   sessions cannot export their own latency data.**
3. `onStreamMetrics` **is** wired (`Board.tsx:3996` → `log({type:"speech-stream", ...})`),
   so the chunk-cadence and interim-lag percentiles are being computed correctly — they
   just land in the same in-memory log as everything else.
4. Nothing aggregates across sessions. There is no p50/p95 you can look at.

**No numbers are invented below for T0→T3. That measurement does not exist yet, and the
fix is to persist the telemetry that is already being computed, not to build new probes.**

## Separation by category

| Category | Where | Cost |
|---|---|---|
| Network (browser↔Deepgram) | direct WSS | [EST] 20–60 ms RTT |
| STT | nova-3 interim | [EST] 100–300 ms; **would be exact if `interimLagP50` were persisted** |
| Application processing | `correctTranscript` + `buildLiveLine` | **1–6 ms** [PRIOR] |
| React/UI | `setInterim` → transcript strip | small; `paintP50` measured but not persisted |
| Excalidraw render | `updateScene` + canvas paint | included in the 1–6 ms; camera spring adds an `updateScene` per rAF frame |
| LLM | Scribe / Beat / Artist | **760–930 / 901–1,916 / 3,616–4,517 ms** — the entire real cost |

---

# 5. Every artificial delay

| Delay | Location | Approx cost | Required? | Critical path? |
|---|---|---:|---|---|
| **`SCRIBE_INTERVAL_MS = 5250`** | `Board.tsx:176` | **up to 5,250 ms** | For the 12/min server limit, yes. For UX, **no** — it was **700 ms** at initial commit and until `132cd79` | **Yes** — first mark/icon |
| `SILENCE_MS = 600` | `Board.tsx:152` | 600 ms | Gates the beat on a pause | Yes — first structure |
| `FRAGMENT_GRACE_MS = 1600` | `Board.tsx:159` | +1,000 ms when the thought looks unfinished | Reduces wasted beats | Yes — first structure |
| `MIN_WORDS = 4` | `Board.tsx:160`, used `:3443` | drops short thoughts entirely | Debatable | Yes |
| `endpointing: 150` | `useDeepgram.ts:360` | 150 ms before Deepgram finalises | Already near-minimum | Final only, not ink |
| `utterance_end_ms: 1000` | `useDeepgram.ts:361` | — | **Configured but never subscribed to.** Dead config. | No |
| `TOUCH_LOCK_MS = 4000` | `Board.tsx:161` → `waitForIdleHands` `:560` | up to 4,000 ms | Prevents fighting the cursor | Yes — blocks `renderBeat` |
| `SKETCH_TOUCH_LOCK_MS = 1500` | `Board.tsx:167` | up to 1,500 ms | Same, for the Scribe | Yes |
| `LIVE_SETTLE_WAIT_MS = 1500` | `Board.tsx:184`, poll `:2147` | up to 1,500 ms, 60 ms poll | Stops diagrams landing on a growing line | Yes — blocks `renderBeat` |
| `LIVE_CAMERA_OVERVIEW_MS = 1800` | `Board.tsx:186,1754` | 1,800 ms | Camera pull-back after a settled line | No — camera only |
| `STAGGER_MS = 180` / `POLISH_STAGGER_MS = 70` | `Board.tsx:170-172`, `:2183` | 70–180 ms **per child element** | Aesthetic | Yes — final visual completeness |
| `FADE_MS = 250` / `FADE_STEPS = 5` | `Board.tsx:173-174`, `:2113,2185` | 250 ms + a trailing 250 ms | Aesthetic | Yes — same |
| `STRUCTURAL_HOLD_MS = 1600` | `lib/liveSpeech.ts:38` | 1,600 ms | Story Mode only — **feature-flagged off** | No |
| Beat serialization | `beatInFlightRef` `Board.tsx:3402-3407` | queues a whole beat cycle | Prevents overlap | Yes |
| Scribe serialization | `scribeInFlightRef` `:1934` | queues | Same | Yes |
| Beat → Artist sequential await | `Board.tsx:3189` then `:3302` | **sum of both**, ~4.5–6.4 s | Artist needs the beat's focus | **Yes — dominant** |
| `guardProviderRequest` DB work | `lib/server/provider-guard.ts:72-140` | ~6–8 Supabase round trips **per AI call** | Cost/abuse control | Yes — prepended to every LLM call |
| Startup: entitlement + lease + token, serial | `Board.tsx:4033-4035` → `useUsageSession.start` → `useDeepgram.start` | **1,945–8,992 ms [MEASURED]** | Partly | **Yes — press-to-live** |
| `autosave.schedule()` in `commit()` | `Board.tsx:331`, `lib/persist.ts:337` | debounced | Yes | No |
| Deepgram reconnect backoff | `useDeepgram.ts:87` `[400,900,2000,4000,8000]` | on failure only | Yes | No |

### Delays added for stability that are now questionable

- **`SCRIBE_INTERVAL_MS` 700 → 5250** in `132cd79` ("Add auth, billing, usage/cost
  controls"). This was a *cost/rate-limit* change, not a stability one. It made the Scribe
  7.5× less responsive. If the board felt snappier before, **this is the most likely
  single cause.** The server limit it defers to (`RATE_LIMIT_SCRIBE_PER_MINUTE = 12`) is
  itself an env-tunable default.
- **`utterance_end_ms: 1000`** — paying for a feature with no listener.
- **`TOUCH_LOCK_MS = 4000`** — `Board.tsx:325` already suppresses Excalidraw's mount-time
  `onChange` storm, so the original reason for a lock this long is partly gone.

---

# 6. LLM critical path

| Call | Model | Endpoint | Prompt | Streaming? | UI waits? | Blocks first visual? | Latency | Class |
|---|---|---|---|---|---|---|---|---|
| **Scribe** | `claude-haiku-4-5-20251001` | `POST /api/scribe` | `SCRIBE_SYSTEM` + on-page marks + context + fresh words; `maxTokens:200`, `temp:0.4` | **Yes** — `completeStream`, one op per line, rendered as it arrives (`Board.tsx:2046-2059`) | No — ink is already down | No | 760–930 ms to first op [PRIOR] | **B** |
| **Beat** | `claude-haiku-4-5-20251001` | `POST /api/beat` | `BEAT_SYSTEM` + loose words + diagram summary + full semantic board JSON; `maxTokens:300`, `temp:0` | No | No | Blocks first *structure* | 901–1,916 ms [PRIOR] | **C** (see below) |
| **Artist** | `claude-sonnet-4-6` | `POST /api/artist` | `ARTIST_SYSTEM` + focus + 90 s transcript + scene summary + semantic scene | No | No | Yes, for structure | 3,616–4,517 ms [MEASURED/PRIOR] | **A** |
| **Math** | = ARTIST_MODEL | `POST /api/math` | focus + transcript + scene | No | No | Only in math mode (flagged) | not measured | A |
| **Story** | = BEAT_MODEL | `POST /api/story` | full story context | No | No | Story mode only — **flag off** | 5,378 ms [PRIOR] | n/a |

**Nothing waits on Claude before the first visual.** The words are already on the canvas.
Claude gates the *second* and *third* visual tiers only. That is the right shape and it is
already built.

### Classification rationale

- **Artist = A.** Producing a laid-out diagram from a sentence genuinely needs a model.
  But it is Sonnet doing a structured-output task, and it is the dominant cost in the
  entire product.
- **Beat = C, arguably.** The Beat answers "has a thought landed, and is it new?" That is
  a routing decision. `lib/pagination.ts:77 isThoughtComplete` and
  `lib/liveSpeech.ts:40 isObviouslyIncomplete` already answer the first half locally, and
  `SemanticBoard` already knows what is on the board. A ~1 s Haiku call sits in front of
  every Artist call to make a decision a local classifier could make in <1 ms — and when
  it says `skip` (4 of 11 decisions across the three demo runs), that entire second is
  spent producing nothing.
- **Scribe = B.** Correctly non-blocking already. Only its throttle is the problem.

---

# 7. Existing local / deterministic intelligence

You have considerably more "instant brain" than the pipeline currently uses.

| Capability | File | Cost | Currently fires on |
|---|---|---|---|
| Voice commands (`scratch that`, `undo`, `new page`, `new scene`) | `lib/liveSpeech.ts:6` | µs | **finals only** |
| Story undo phrases (`no wait`, `forget that`, `that's wrong`) | `Board.tsx:3480` | µs | story finals |
| Thought-completeness detection | `lib/pagination.ts:77` | µs | drives the silence timer |
| Fragment detection (dangling prepositions/conjunctions) | `lib/liveSpeech.ts:40` | µs | story lane |
| Noun/phrase extraction with a ~200-word stoplist, interim-aware | `lib/sketch.ts:73 extractConcepts` | µs | **only the Scribe-failure fallback** |
| Speech-act detection (greeting, "today I'll talk about X" → title) | `lib/sketch.ts:137 detectGesture` | µs | fallback only |
| Phonetic transcript correction against on-board terms | `lib/vocab.ts:240` + `soundsLike`, `phoneticKey` | ms | **every interim** ✅ |
| Grounding check ("was this actually said?") | `lib/vocab.ts:383 groundedInSource` | µs | Scribe output validation |
| Keyterm generation from live board state | `lib/vocab.ts:76 keyterms` | µs | socket open |
| Semantic board: concepts, relationships, sections, fuzzy matching | `lib/semantic.ts:253 SemanticBoard` | µs | maintained continuously |
| Mark→concept matching, adopt thresholds | `lib/organizer.ts:88,115` | µs | after Artist |
| Obstacle-aware arrow routing with real Excalidraw bindings | `lib/routing.ts:148 routeArrow` | ms | after Artist |
| 21 hand-drawn procedural pictograms | `lib/icons.ts:17 ICONS` | µs | Scribe `icon` op |
| Linear equation parse / solve / verify | `lib/math/{parse,arithmetic,verify,visuals}.ts` | µs | math mode (flagged) |
| Story assets (procedural cat, palm tree, sun…) | `lib/storyAssets.ts` | 7 ms [PRIOR] | story mode (flagged) |
| Attention budget (max 6 concepts, 3 relationships visible) | `lib/attention.ts` | µs | camera/composition |
| Page turn policy | `lib/pagination.ts:158` | µs | continuous |
| Camera framing + spring | `Board.tsx:791,702`, `lib/composition.ts` | rAF | continuous |
| Action schema + validation | `lib/actions.ts:65,179` | µs | Artist output |

**What could react from an interim today, with code that already exists:**

- Voice commands, on the interim rather than the final — `localVoiceCommand` is a closed
  exact-match matcher (`lib/liveSpeech.ts:5` calls it "closed, deterministic"), so running
  it on settled interim words is safe and would remove 150–600 ms of endpointing latency
  from every "scratch that".
- Concept boxes, from `extractConcepts` on settled interim words, drawn provisionally.
  The Story lane **already does exactly this pattern** — `recognizeStoryPartial` →
  `renderStoryProvisional` → confirm-or-dismiss on the final (`Board.tsx:3676-3713`).
  **The speculative-render machinery is built, tested, and currently switched off with the
  Story Mode flag.**
- Titles, from `detectGesture`.
- The Beat's `skip`-vs-`draw` prefilter, from `isThoughtComplete` + `SemanticBoard`.

---

# 8. Excalidraw rendering path

```text
built elements (lib/ops.ts buildLiveLine, via convertToExcalidrawElements for metrics)
   ↓ patch the EXISTING element in place by id — identity preserved across ~5 interims/sec
elementsRef.current = [...]                              plain array, a ref, not React state
   ↓ commit()  (Board.tsx:328)
suppressChangeUntil = now + 150ms   ← guards against treating our own write as user input
apiRef.current.updateScene({elements})
   ↓
Excalidraw internal render → static canvas + interactive canvas
   ↓
framePage → animateCamera → rAF spring → updateScene({appState}) per frame
```

| Property | Answer |
|---|---|
| Individually applied or batched? | **Individually.** One `updateScene` per interim. |
| Queued? | No queue on the live path. `renderQueueRef` exists but serves the Beat render lane. |
| Through React? | **No.** `elementsRef` is a ref; `setInterim` only drives the text strip. Deliberate and correct. |
| Through a scene graph? | Yes — `SemanticBoard`, but **not** on the live-ink path. |
| Delayed for layout? | No. `place()`/`lineStart()` are synchronous arithmetic. |
| Delayed for animation? | Not for ink. `fadeIn` (250 ms) and `STAGGER_MS` apply only to Beat/Artist output. |
| Delayed for camera? | **No — but note the interaction.** `framePage` runs on *every* interim and the camera spring issues its own `updateScene` per rAF frame while the line grows. |
| Blocked by another generation process? | No. `renderBeat` waits for the live line (`Board.tsx:2147`); the live line never waits for `renderBeat`. Priority is correct. |

**Verdict: Excalidraw is not a meaningful source of delay.** 1–6 ms per interim [PRIOR],
vs 760–4,500 ms for the model tiers. The one thing worth actually measuring — because it
is the only per-interim cost that has grown — is the camera spring's `updateScene` load
during continuous speech. `paintP50/P95` already captures it; it just isn't persisted.

---

# 9. Comparison against the "direct browser" architecture

Your proposed target:

```text
MIC → Browser → Direct Deepgram WS → interim → local interpretation → speculative Excalidraw
                                     final → deeper parser / Claude → correct / enrich
```

| Question | Answer |
|---|---|
| **1. How close are we?** | **Very.** The audio path is already exactly this. |
| **2. What exists?** | Direct browser↔Deepgram WSS ✅. Ephemeral tokens ✅. Interim-driven immediate render ✅ (1–6 ms). Local interpretation library ✅ (§7). Speculative render + confirm/dismiss ✅ — built in the Story lane, flag-off. Final → Claude enrichment ✅. Backend confined to auth/credentials/usage/persistence/billing ✅. |
| **3. What doesn't?** | Local interpretation is **not wired to interims in Standard Mode** — the only interim consumer is `writeLive` (lettering) plus `correctTranscript`. `extractConcepts`/`detectGesture` run only as a Scribe-failure fallback. No local Beat prefilter. `UtteranceEnd` and word timestamps unused. Telemetry not persisted. |
| **4. Routing audio through unnecessary infrastructure?** | **No. Zero audio bytes touch your backend.** |
| **5. Would the move reduce latency?** | **No — because you are already there.** The move is a no-op. Real gains are the Scribe throttle, the Beat prefilter, and the startup chain. |
| **6. New security/reliability tradeoffs?** | None new from the move. The *existing* ones: a 60 s ephemeral token is exposed to the browser (mitigated by TTL and `usage:write` scoping); listening seconds are reconciled server-side from the lease rather than from client claims (`reconcileOpenAudioReservations`), which is the right design; and `RATE_LIMIT_DEEPGRAM_TOKENS = 3 / 600 s` will strand a session after 3 reconnects. |

**You have been asking whether to build the thing you already built.** The premise that
audio might be proxying through the backend is false, and the evidence is unambiguous.

---

# 10. Previous faster implementation

Git history is shallow (25 commits, several large squashes), so this is what it supports —
and it points the opposite way from what you expected on the *speech* path.

## The speech path got **faster**, not slower

```text
OLD (21fd7a7 … 41ac299)
Browser → MediaRecorder(webm/opus, 100ms timeslice) → Deepgram WS → Browser
   audioEnd anchored to socket open; no per-socket epoch guard on telemetry

CURRENT (028f1d1 "Improve live transcript latency and camera follow", 2026-08-11)
Browser → AudioWorklet PCM16 @ 80ms chunks (linear16, native sampleRate)
        → Deepgram WS → Browser
   MediaRecorder retained only as a compatibility fallback
   + streamEpoch guard, interim lag/gap percentiles, firstVisibleWordMs
   + camera spring instead of instant jumps
```

`028f1d1` also fixed a **measurement** bug that had been making things *look* far worse
than they were: on a reconnect, Deepgram's audio timeline restarts while the session clock
keeps running, so `now() − audioEnd` silently began measuring time-since-reconnect. The
comment at `useDeepgram.ts:162-172` records that this put **53 of 84 utterances in the
10:09 session at a reported lag of ~202 seconds**, when the real numbers were fine.

## What actually regressed

```text
132cd79  "Add auth, billing, usage/cost controls, and math/audio-replay reliability fixes"
  - const SCRIBE_INTERVAL_MS = 700;
  + const SCRIBE_INTERVAL_MS = 5250;   // "Stay safely below the server's rolling
                                       //  limit of 12 Scribe calls/minute"
  + guardProviderRequest on every AI route (~6–8 Supabase round trips per call)
  + usage lease required before any provider call

d9e4464  "Coordinate listening session startup and release usage leases"
  - if (await usage.start()) await startEngine();
  + await startListeningSession(usage.start, startEngine, usage.stop);
     → strictly serial: refreshEntitlement → POST /api/usage/session
       → getUserMedia → worklet module fetch → GET /api/deepgram/token
         (which itself runs the full guard: ~8 DB round trips + Deepgram grantToken)
       → import @deepgram/sdk → WS connect
```

**The snappiness you remember is real and it is dated.** The mic-to-ink path is better than
it has ever been. The *board filling in around your words* got 7.5× slower in `132cd79`,
and the *press-to-start* got slower in `132cd79` + `d9e4464`. Both were paid deliberately
for billing correctness and cost control — which is a legitimate trade, but it was never
tuned afterwards.

No revert performed. Nothing changed.

---

# 11. Latency budget

## First meaningful reaction (words on the canvas) — largely already achieved

| Stage | Today | Target | Basis |
|---|---|---|---|
| Audio capture + 80 ms chunking | ~40–80 ms | 40–80 ms | [CODE] worklet, 80 ms chunk = hard floor |
| Browser → Deepgram (direct WSS) | ~20–60 ms | 20–60 ms | [EST] |
| Deepgram nova-3 interim | ~100–300 ms | 100–250 ms | [EST]; **`interimLagP50` would make this exact** |
| `correctTranscript` + `buildLiveLine` | 1–6 ms | <5 ms | [PRIOR] measured |
| `updateScene` + Excalidraw paint | included above | <10 ms | [PRIOR] |
| **First ink (speech → visible word)** | **~250–450 ms [EST]** | **<350 ms p50, <600 ms p95** | |

Reducing the worklet chunk from 80 ms to 20–40 ms is the only remaining lever, and it is
worth perhaps 40 ms against more sockets/CPU. **The first-ink path is essentially done.**

## First *structural* reaction (a box, an icon, a mark) — the real opportunity

| Stage | Today | Achievable | How |
|---|---|---|---|
| Deepgram final (endpointing 150) | 150–600 ms | 0 ms | act on settled interim words |
| Scribe throttle | **0–5,250 ms** | 0–700 ms | restore the pre-`132cd79` value |
| `/api/scribe` guard (Supabase) | [EST] 50–200 ms | 20–80 ms | |
| Haiku → first streamed op | 760–930 ms | 760–930 ms | already streaming |
| `applyOp` render | ~10 ms | ~10 ms | |
| **Total** | **~0.9–6.8 s** | **~0.9–1.7 s** | |
| **With local speculative marks** | — | **<50 ms** | `extractConcepts` on settled interims, Scribe corrects behind |

## Final intelligent visual (diagram with bound arrows)

| Stage | Today | Achievable |
|---|---|---|
| Silence gate | 600 ms (1,600 fragment) | 0–600 ms (local prefilter) |
| `/api/beat` Haiku | 901–1,916 ms | **0 ms if replaced by a local classifier** |
| `/api/artist` Sonnet | 3,616–4,517 ms | 2,000–3,000 ms (streaming actions) |
| `applyActions` | 10 ms | 10 ms |
| `waitForIdleHands` + live-settle | 0–5,500 ms worst case | 0–1,500 ms |
| Stagger + fade | 250 ms + 70–180/child | unchanged (deliberate) |
| **Total** | **5.1–7.9 s [PRIOR]** | **2.5–4.0 s** |

**Stated separately, as asked:**

```text
FIRST VISUAL LATENCY (your word, lettered)          ~250–450 ms   [EST, instrumented]
FIRST STRUCTURAL LATENCY (a mark or icon)           ~0.9–6.8 s → achievable ~0.9–1.7 s
FINAL INTELLIGENT VISUAL (diagram + arrows)         ~5.1–7.9 s → achievable ~2.5–4.0 s
PRESS START → MIC LIVE                              1,945–8,992 ms [MEASURED] → ~600–900 ms
```

---

# 12. Final audit report

## 1. Current architecture
See §1. Three tiers: an instant local ink tier (interim → Excalidraw, 1–6 ms, no network,
no model), a fast enrichment tier (Scribe/Haiku, streamed), and a structural tier
(Beat/Haiku → Artist/Sonnet → deterministic organizer + arrow router). Tiers are correctly
prioritised: slow tiers wait on the live line, never the reverse.

## 2. Current Deepgram path
**Direct browser → Deepgram WebSocket** (your Architecture B), with the backend minting a
60-second ephemeral token and doing nothing else on the audio path. No proxy. No audio or
transcript through our infrastructure. One live implementation; the only other Deepgram
call is prerecorded, server-side, for a parked feature.

## 3. Current measured latency
- Press Start → mic live: **1,945 / 2,225 / 8,992 ms** [MEASURED]
- Interim → ink: **1–6 ms** [PRIOR]
- Speech → first ink: **not measured**; instrumentation exists and isn't persisted
- Scribe first op: **760–930 ms** + up to 5,250 ms throttle
- Beat: **901–1,916 ms** — Artist: **3,616–4,517 ms** [MEASURED/PRIOR]
- `applyActions`: **10 ms**

## 4. Biggest bottlenecks, largest first
1. `/api/artist` Sonnet — 3,616–4,517 ms
2. `SCRIBE_INTERVAL_MS = 5250` client throttle — up to 5,250 ms
3. Startup chain — 1,945–8,992 ms, once per session but it is the first impression
4. `/api/beat` Haiku — 901–1,916 ms, in front of every Artist call, ~36% of them `skip`
5. Silence gate — 600–1,600 ms
6. `waitForIdleHands` (4,000) + `LIVE_SETTLE_WAIT_MS` (1,500) on `renderBeat`
7. `guardProviderRequest` Supabase round trips — [EST] 50–200 ms per AI call
8. Excalidraw — **not a bottleneck**

## 5. Artificial delays
Full table in §5. The one that matters: **`SCRIBE_INTERVAL_MS` 700 → 5250 in `132cd79`**.

## 6. LLM dependencies
Nothing blocks the first visual. Claude gates tiers 2 and 3 only: Scribe (marks/icons),
Beat (routing), Artist (structure). The Beat is a ~1 s model call making a decision your
local code could largely make for free.

## 7. Existing instant capabilities
Extensive — 20+ deterministic modules (§7). Most importantly, **speculative-render-then-
reconcile is already implemented and tested** in the Story lane (`recognizeStoryPartial` →
`renderStoryProvisional` → confirm/dismiss), and is currently switched off with a feature
flag. Standard Mode uses almost none of the local intelligence at interim time.

## 8. Previous faster architecture
The speech path is **faster** than it has ever been (`028f1d1` added PCM worklet capture
and fixed a reconnect telemetry bug that made lag look ~202 s). The regression is the
Scribe throttle and the startup chain, both introduced in `132cd79`/`d9e4464` for billing
and cost control.

## 9. Direct browser → Deepgram comparison
**Nothing would change. It is already the architecture.**

## 10. Recommended architecture

```text
MICROPHONE
   ↓ AudioWorklet PCM16, 80ms (→ 40ms optional)
BROWSER ──WSS──> DEEPGRAM ──WSS──> BROWSER          [unchanged — already correct]
   ↓ interim
   ├──> writeLive              ink, 1–6 ms          [unchanged — already correct]
   ├──> localVoiceCommand      on settled interims  [NEW WIRING, code exists]
   └──> extractConcepts/detectGesture → speculative mark, low opacity
                                                    [NEW WIRING, pattern exists in Story lane]
   ↓ final
   ├──> Scribe (Haiku, streamed, throttle 700ms)    [RESTORE former value]
   │      → confirms / replaces speculative marks
   └──> local beat prefilter (isThoughtComplete + SemanticBoard)
          ├─ obvious skip → stop, 0 ms, 0 cost      [NEW, code exists]
          └─ otherwise → /api/beat → /api/artist (streamed actions)
                            → organizer + routeArrow (deterministic, 10 ms)

BACKEND: auth · ephemeral Deepgram token · usage lease · cost guard · persistence · billing
         (already exactly this, and off the audio path entirely)
```

## 11. Expected improvement

Only where evidence supports it.

| Change | Conservative | Likely | Best case | Evidence |
|---|---|---|---|---|
| Scribe throttle 5250 → ~1000 | −1.5 s to first mark | **−2.5 s** | −4.5 s | Uniform wait over a 5,250 ms window; former value 700 ms shipped and worked |
| Local beat prefilter on `skip` | −0.9 s on those beats | **−1.2 s** | −1.9 s | Measured beat latency; 4/11 demo decisions were `skip` |
| Parallelise startup | −0.5 s | **−1.0 s** | −7.0 s (cold) | 1,945–8,992 ms measured, chain is strictly serial |
| Speculative local marks from interims | — | **first mark <50 ms** | — | `writeLive` at 1–6 ms proves the render budget; Story lane proves the pattern |
| Stream Artist actions | −0.5 s | **−1.5 s** | −2.5 s | 3.6–4.5 s measured; Scribe already proves streaming works here |
| Persist existing telemetry | 0 ms | 0 ms | 0 ms | Buys measurement, not speed — but everything above is guesswork without it |

**No improvement estimate is offered for the mic→Deepgram path, because there is no
evidence of a problem there and no measurement that would support one.**

## 12. Top 5 changes, ranked by improvement ÷ risk

| # | Change | Gain | Risk | Why |
|---|---|---|---|---|
| **1** | **Persist the telemetry that already exists** — the `{type:"live"}` and `{type:"speech-stream"}` events are already being emitted correctly; write them somewhere durable and ungate the log export from `NODE_ENV==="development"` | 0 ms | **Near zero** | Every other item is an estimate until this lands. `lagMs` is already a true epoch-guarded mic-to-ink measure. Do this first. |
| **2** | **Lower `SCRIBE_INTERVAL_MS`** toward its former 700 ms, raising `RATE_LIMIT_SCRIBE_PER_MINUTE` to match (both env-tunable) | **−2.5 s** to first mark | Low — cost only, and cost is what it was built to control | Single constant. Directly reverses the known regression. Model the spend before shipping. |
| **3** | **Parallelise startup** — entitlement + lease concurrent with `getUserMedia` + worklet load; prefetch the Deepgram token; preload `@deepgram/sdk` | **−1.0 s** press-to-live | Low–medium — `guardProviderRequest` needs the session id, so ordering matters | Measured 1.9–9.0 s of dead air on the very first impression. |
| **4** | **Local beat prefilter** — `isThoughtComplete` + `SemanticBoard` novelty check gates the Haiku call | **−1.2 s** on skipped beats, plus cost | Medium — a wrong local skip silently loses a thought | Every part exists and is unit-tested. Ship it shadow-mode first, logging local-vs-Beat disagreement. |
| **5** | **Speculative local marks from settled interims** — `extractConcepts`/`detectGesture` render at low opacity, Scribe confirms or removes | **first mark <50 ms** | Medium–high — visible flicker/retraction if the reconciler is wrong | Highest ceiling of anything here, and the Story lane already proves the pattern in this codebase. Do it after 1–4. |

## 13. Recommendation

# **OPTIMIZE CURRENT ARCHITECTURE**

Not "move to direct browser → Deepgram" — **you are already there, and moving is a no-op.**
Not "hybrid" — the split between a local instant tier and a remote intelligent tier is
already exactly right, and the tier priority (slow lanes wait on the live line, never the
reverse) is correctly enforced in code.

The architecture is sound. The speech path is the best it has ever been. What degraded is
what happens *around* your words, and it degraded in one identifiable commit, for a
deliberate and defensible reason (cost control) that was never subsequently tuned.

So: instrument first, then reverse the throttle, then unblock startup, then move the Beat's
easy decisions local. Do not rebuild the audio path — measure it, and you will very likely
find it is already inside the budget you were hoping to reach.

---

### Appendix — anomalies noticed, not investigated

- `output/demo-runs/demo-b.json` and `demo-c.json` record `draw` beat decisions with **no
  corresponding `/api/artist` entry**. The capture only logs fetches whose body parses as
  JSON, so this may be an artifact of the harness. Worth a deliberate check.
- `RATE_LIMIT_DEEPGRAM_TOKENS = 3 / 600 s` vs a 12-attempt reconnect ladder that mints a
  token per attempt — a session cannot survive more than 3 reconnects in 10 minutes.
- `utterance_end_ms: 1000` is configured with no `UtteranceEnd` listener.
- `alt.confidence` is plumbed through `onInterim` but Standard Mode ignores it.
- `components/VocabularyEditor.tsx` writes `localStorage["inpublic-vocabulary"]`;
  `AUDIT-3.md` reported nothing reads it. Not re-verified here.
