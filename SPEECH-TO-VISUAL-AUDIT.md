# InPublic — Speech-to-Visual Architecture Audit

**Date:** 2026-08-14
**Branch:** `main` @ `fb7f849` (working tree dirty: `Board.tsx`, `hooks/useDeepgram.ts`, `docs/PRODUCTION-SETUP.md` modified; `SPEECH-ACCURACY-AUDIT.md`, `lib/sttDebug.ts`, `scripts/stt/` untracked)
**Scope:** microphone → visible Excalidraw element. **Reconnaissance only. No code was changed.**

**Provenance markers used throughout:**
- **[CODE]** — read from source in this repo, right now.
- **[MEASURED]** — a number produced by a real run whose artifact is in this repo (`LATENCY-AUDIT.md`, `SPEECH-ACCURACY-AUDIT.md`, `scripts/stt/results/`).
- **[PRIOR]** — measured by an earlier audit; flagged where later commits changed the code it measured.
- **[EST]** — an estimate, labelled every time.
- **[UNKNOWN]** — could not be proven without running or instrumenting the system.

---

# 1. Executive Summary

InPublic does **not** have one speech-to-visual pipeline. It has **four independent producers writing to one shared sheet of paper**, each with its own trigger, its own latency, its own idea of what matters, and no shared budget after the first sixty seconds.

In plain English, here is what actually happens when you talk:

1. **Your words are lettered instantly.** The browser streams PCM audio straight to Deepgram over a WebSocket (never through the server). Every partial transcript is put on the canvas as a single text element in ~1–6 ms [PRIOR] with no model, no network, and no debounce. This is *Tier 1*, and it is genuinely excellent.

2. **A local rule engine guesses ahead.** Once two consecutive partials agree on a word, a set of hand-written regexes (`count`, `trend`, `emphasis`, `contrast`, `cause`) plus a noun-phrase extractor propose faded, low-opacity marks. When Deepgram's final transcript arrives, guesses whose words survived fade to solid; guesses that were mishearings disappear. This is *Tier 2 (Reflex)*.

3. **A "sketchnote hand" letters nameable things.** On each final transcript, if a scheduler decides the words carry anything new, the fresh words go to Claude Haiku (`/api/scribe`), which streams back drawing operations one line at a time — `title`, `heading`, `word`, `box`, `note`, `bullet`, `icon`, `link`, `underline`. A "pen" object decides where each one lands; the model never emits a coordinate. This is *Tier 3a*.

4. **A two-model chain builds structure.** After 600 ms of silence (1600 ms if the sentence looks unfinished) and more than four words, Claude Haiku (`/api/beat`) classifies the moment into `draw | command | section | undo | clear | skip | math_step`. On `draw`/`command`, Claude Sonnet (`/api/artist`) receives the semantic board and returns *edit actions* — `create_concept`, `create_relationship`, `group_concepts`, `move_concept`, etc. A deterministic planner (the "Organizer") resolves each requested concept into **reuse** an existing concept / **adopt** words already lettered on the page (by drawing a ring around them) / **create** a new box. Arrows are routed around obstacles and bound to real Excalidraw elements. This is *Tier 3b*.

5. **A deterministic Director watches for structure.** With no extra model call, it looks for comparison markers (`but`, `however`, `versus`, `unlike`…) and sequence markers (`then`, `becomes`, `leads to`…) between concepts that *already exist*, accumulates a hypothesis across several beats, and — only when evidence reaches "sufficient" — physically **moves the existing boxes** into a side-by-side comparison or an ordered chain, spring-animated, re-routing their arrows. This is *Tier 3c*.

Behind all of that sits a **camera** that reframes the sheet on essentially every visual event, including every interim transcript (it follows the trailing edge of the words you are speaking), and pulls back to an overview 1.8 s after each sentence settles.

**Two structural facts explain most of what your tester experienced.**

**Fact one: the production budget expires after sixty seconds.** `lib/attention.ts` defines a real, sensible attention model — at most 6 visible concepts, 3 relationships, 8 temporary Scribe marks — but every gate that consumes it is wrapped in `withinInitialCompositionWindow(now())`, which is `sessionMs < 60_000`. After the first minute, there is **no cap on how many marks, concepts or arrows may appear**, apart from 22 marks per page (which turns the page rather than stopping production) and per-page overflow. Four producers, no governor.

**Fact two: the visual vocabulary does not depend on the meaning.** Whatever you say, the available forms are: lettered text, a box, an arrow between two boxes, a ring, a group rectangle, a highlight, and (only under `NEXT_PUBLIC_ENABLE_MATH_MODE`) a small set of math visuals. There is no chart, no timeline, no hierarchy renderer, no quantity renderer in Standard Mode. "Choosing the wrong visual form" is not really possible, because there is essentially one form. The failure mode is different and more subtle: **everything is flattened into boxes and arrows, and the arrows carry model-authored verbs that nothing verifies.**

---

# 2. Current Architecture Diagram

```text
                       ┌──────────────────────────────────────────────┐
                       │  /create  (app/create/page.tsx:29)           │
                       │  /try     (app/try/page.tsx, guest=true)     │
                       │    → next/dynamic(Board, ssr:false)          │
                       └───────────────────┬──────────────────────────┘
                                           ↓
                       components/Board.tsx:390  <Board/>   ~6,100 lines, ONE component
                                           │
   ControlBar mic toggle ─────────────────►│ Board.tsx:5505 toggle()
                                           │   ├─ usage.start()   (lease, /api/usage/session)
                                           │   └─ deepgram.start()
                                           ↓
  ┌───────────────────────── hooks/useDeepgram.ts ──────────────────────────┐
  │ prewarm():390   getUserMedia ‖ AudioWorklet graph ‖ import @deepgram/sdk│
  │ openSocket():451  GET /api/deepgram/token → 60 s ephemeral credential   │
  │ listen.live():519  nova-3, interim_results, smart_format, punctuate,    │
  │                    endpointing:150, utterance_end_ms:1000, vad_events,  │
  │                    encoding:linear16, keyterm:[≤40 from lib/vocab.ts]   │
  │ AudioWorklet → Int16 PCM, 80 ms chunks → connection.send()              │
  │        (audio NEVER touches the InPublic server)                        │
  │ Transcript handler:589  → is_final ? onFinal : onInterim                │
  └───────────────┬──────────────────────────────────┬─────────────────────┘
                  ↓ interim                          ↓ final
      Board.handleInterim:5233                Board.handleFinal:5144
                  │                                  │
   ┌──────────────┴───────────┐        ┌─────────────┴──────────────────────┐
   │ correctTranscript()      │        │ localVoiceCommand? → undo/new page │
   │  (lib/vocab.ts:240)      │        │ correct() → finalsRef (canonical)  │
   │ setInterim() → strip     │        │ pendingTextRef  (last 120 words)   │
   │ writeLive(settled:false) │        │ scribePendingRef (unsent words)    │
   └──────────────┬───────────┘        └──┬──────────┬──────────┬───────────┘
                  │                       │          │          │
 ══════ TIER 1 ═══╪═══════════════════════╪══════════╪══════════╪═══════════
   writeLive() Board.tsx:2471             │          │          │
   buildLiveLine → ONE text element,      │          │          │
   patched in place by id across          │          │          │
   ~5 interims/sec.  ~1–6 ms [PRIOR]      │          │          │
   → commit() → framePage(follow live)    │          │          │
                                          │          │          │
 ══════ TIER 2 (Reflex, features.reflex) ═╪══════════╪══════════╪═══════════
   two-interim word agreement (5278-5310) │          │          │
   → setTimeout(0) → recognizeSpeculative │          │          │
      (lib/speculative.ts:259)            │          │          │
      COUNT_RE TREND_RE EMPHASIS_RE       │  settleSpeculative(final):3017
      CONTRAST_RE CAUSE_*_RE + extract    │  ├─ confirmed → fade to 100%
   → renderSpeculative:2906 (opacity 40)  │  └─ not in final → retire
      max 3 outstanding                   │          │          │
                                                     │          │
 ══════ TIER 3a (Scribe) ═════════════════════════════╪══════════╪═══════════
   nudgeScribe:3286 → runScribe:3079                 │          │
   shouldWakeScribe (lib/scribeScheduler.ts)         │          │
   requestDelayMs (1200 ms cooldown, pointer lock)   │          │
   POST /api/scribe → Claude Haiku, STREAMING        │          │
     prompt: SCRIBE_SYSTEM + onPage[last 24]         │          │
             + context[last 40 words] + fresh        │          │
   per line → parseLine (lib/ops.ts:152)             │          │
            → isFragment() reject                    │          │
            → groundedInSource() reject              │          │
            → applyOp:2346 → pen places → commit     │          │
                                                     │          │
 ══════ TIER 3b (Beat → Artist → Organizer) ═════════╪══════════╪═══════════
   resetSilenceTimer:4765                            │          │
     600 ms silence AND >4 words                     │          │
     unfinished thought → +1000 ms grace, then go anyway
   runBeat:4397                                                 │
     POST /api/beat  Haiku temp 0, max 300 (+1 retry)           │
       in: pendingText(120w) | looseWords(20) | sceneSummary    │
           | semantic scene(24 concepts) | skipStreak           │
       out: {action, reason, focus}                             │
        ├ skip   → skipStreak++ ; nothing drawn                 │
        ├ undo   → doUndo() (one operation)                     │
        ├ clear  → doClear() (dim page + turn)                  │
        ├ section→ create_section → requestPageTurn("section")  │
        ├ math_step → POST /api/math (flagged) → verify → draw  │
        └ draw|command ↓                                        │
     POST /api/artist  Sonnet 4.6 temp 0.3, thinking on, max 1200
       in: focus | recentTranscript(90 s of finals) | scene     │
       out: {actions:[create_concept|create_relationship|...]}  │
     parseActions (lib/actions.ts) → cap 12                     │
     planActions (lib/organizer.ts:115)                         │
        reuse ─ adopt(ring existing ink) ─ create ─ link ─ drop │
     applyAction:3479 → buildConceptNode / buildBoundArrow      │
        (routeArrow avoids obstacles; live rows are "soft")     │
     → commit() → framePage()                                   │
                                                                │
 ══════ TIER 3c (Director / Choreographer, NO model) ═══════════╪═══════════
   advanceDirector (lib/directorState.ts:292) after applyActions
     detectComparison / detectProcessSignal (lib/director.ts)
     hypotheses accumulate across beats → EvidenceLevel
     "sufficient" only → commit_process / commit_comparison
   performComparison:1229 / performProcess:1379
     computeComparisonLayout / computeProcessLayout (pure)
     animateConceptMotion:1074 — springs EXISTING boxes to new
     positions, re-routes their arrows in place, one undo record

 ══════ SHARED STATE ════════════════════════════════════════════════════════
   elementsRef      — the Excalidraw scene (append-mostly)
   boardRef         — SemanticBoard: concepts / relationships / sections /
                      operation history (lib/semantic.ts:257)
   penRef + pagePensRef + marksRef + pageMarksRef  — typesetting state
   compositionRef   — camera state (lib/composition.ts)
   logRef           — ~60 typed event kinds (lib/types.ts:38)

 ══════ CAMERA (separate subsystem) ═════════════════════════════════════════
   framePage:1524 → proposeCamera (lib/composition.ts:378, pure)
                  → animateCamera:947 (critically damped spring, rAF)
   callers: every applyOp, every writeLive interim, applyActions, renderBeat,
            turnPage, gotoPage, window resize, zoom_to_concept (2nd writer)
```

---

# 3. Speech Pipeline

**The provider is Deepgram.** Verified in code, not assumed:

- `components/Board.tsx:333` — `const ENGINE = (process.env.NEXT_PUBLIC_ENGINE ?? "deepgram")`. Default is `deepgram`; `.env.local` does not override it. [CODE]
- `hooks/useDeepgram.ts:519` — `deepgram.listen.live({ model: "nova-3", … })`. [CODE]
- A second engine exists (`hooks/useGeminiLive.ts`, `LIVE_SCRIBE_SYSTEM` prompt, `handleLiveOps`/`handleLiveTranscript` at `Board.tsx:5377`/`5400`) and is fully wired, but is unreachable unless `NEXT_PUBLIC_ENGINE=gemini`. Treat it as dormant. [CODE]

| Stage | File / function | In | Out | Timing / batching |
|---|---|---|---|---|
| Mic acquisition | `useDeepgram.ts:390 prewarm` | — | `MediaStream` | Runs **concurrently** with the usage lease; stream acquired once, reused across reconnects |
| Capture | `public/pcm-capture-worklet.js` via `prepareCapture:317` | Float32 frames | Int16 PCM `ArrayBuffer` | **80 ms chunks**, transferable postMessage; MediaRecorder(80 ms) fallback |
| Transport | `connection.send()` in the worklet `onmessage` | PCM chunk | WSS frame | Direct browser→Deepgram. **No InPublic server in the audio path** |
| Credential | `GET /api/deepgram/token` | — | 60 s scoped token | Cached until ~10 s before expiry (`tokenRef`), because the mint endpoint is rate-limited 3/600 s |
| Recognition | Deepgram nova-3 | audio | `Transcript` events | `endpointing:150`, `utterance_end_ms:1000` (configured, **no `UtteranceEnd` consumer beyond a trace push** at `:697`), `smart_format`, `punctuate`, `keyterm:[≤40]` |
| Interim fan-out | `useDeepgram.ts:665-687` → `onInterim` | text, `audioEndMs`, `streamEpoch`, `confidence`, timing | — | Every partial, ~5/s, **no throttle, no debounce** |
| Final fan-out | `useDeepgram.ts:629-664` → `onFinal` then `onInterim("")` | text, tStart, tEnd, `audioEndMs` | — | One per utterance; also emits a `speech-stream` metrics summary |
| Reconnect | `reconnectRef:719` | — | — | Backoff `[400,900,2000,4000,8000]`, 12 attempts, keeps the mic stream |

**Async boundaries:** `handleInterim`/`handleFinal` are synchronous callbacks; `writeLive` is `async` (awaits font readiness and `buildLiveLine`'s dynamic import) but is *dispatched, not awaited*, by both handlers. Tier 2 recognition is explicitly pushed to a **macrotask** (`setTimeout(…, 0)` at `Board.tsx:5343`) with a documented invariant that nothing may run between Tier 1's ink request and its commit.

**Stale-response protection:** `liveSeqRef` (bumped per `writeLive` call and by every reset), `streamEpoch` (bumped per socket open — this is what fixed a broken latency meter), `comparisonEpochRef`, `aiAbortRef`, `scribeAbortRef`.

---

# 4. Live Text Pipeline

### "When I say a word, what happens before that word is visible?"

```
speech → 80 ms PCM chunk → WSS → nova-3 interim
       → useDeepgram Transcript handler (:589)
       → Board.handleInterim (:5233)
           correctTranscript(text, activeTermsRef)      ← lib/vocab.ts:240
           setInterim(shown)                            ← the DOM transcript strip
           writeLive(shown, settled:false)              ← the canvas
               await fontsReadyRef                      (resolved after warm-up)
               buildLiveLine → convertToExcalidrawElements
               patch the EXISTING element by id
               penRef reserves the row
               commit() → api.updateScene()
       → visible
```

| Question | Answer | Evidence |
|---|---|---|
| Are interim words rendered? | **Yes, every one.** No throttle, no debounce. | `Board.tsx:5272` |
| How fast? | **1–6 ms** from callback to `updateScene` | [PRIOR] `LATENCY-AUDIT.md`; instrumented live as `latency.observe("render"…)` and `"paint"` (double-rAF) |
| Are words replaced later? | Yes — the *same element id* is patched in place ~5×/s. Excalidraw reissues ids for text, so `writeLive` builds a throwaway for metrics and patches the live element (`Board.tsx:2545-2568`). Identity survives; selection/edits survive. | [CODE] |
| Interim vs final visual difference | Interim = grey `#495057`; settled = ink `#1e1e1e`. Plus a 90 ms opacity "settle flash" on the final (`Board.tsx:5209`). | `lib/ops.ts:410` |
| Punctuation / capitalisation | Added by **Deepgram** (`smart_format:true`, `punctuate:true`), not by InPublic. | `useDeepgram.ts:526-528` |
| Does an AI model modify the visible transcript? | **No.** No model is in the Tier 1 path. | `Board.tsx:2465-2470` invariant comment + code |
| Spell / vocabulary correction | **Yes** — `correctTranscript`, deterministic, runs on every interim and every final | `lib/vocab.ts:240` |
| Can semantic processing delay visible text? | **No.** Tier 2 is deferred to a macrotask *after* the ink dispatch; Tier 3 is entirely off this path. | `Board.tsx:5322-5343` |
| Can visual generation delay visible text? | Indirectly only: a Scribe/Artist mark landing mid-sentence moves the pen, which makes the live line **re-anchor** (jump down one row) on its next interim (`Board.tsx:2490-2498`). Not a delay — a displacement. | [CODE] |
| Are transcript state and visual text state separate? | **Yes, three separate stores:** `finalsRef` (canonical transcript), `interim` React state (the DOM strip), and `elementsRef` (canvas ink). Bookkeeping (`prevInterimRef`, `settledCountRef`) deliberately uses the **raw** stream, while only the corrected text reaches the sheet — see the comment at `Board.tsx:5239-5247`. | [CODE] |

### Where "Aline" → "airline" comes from

Two mechanisms, in order of impact. **The first is proven with a controlled experiment already in this repo.**

**1. InPublic tells Deepgram to expect the wrong word.** `lib/vocab.ts:33` — the *first* entry of `SEED_TERMS` is `"Airline"`. At the start of a take the board is empty, so `SEED_TERMS` *is* the entire keyterm list handed to nova-3 (`useDeepgram.ts:516` → `keyterm:` at `:539`). The substitution therefore happens **inside Deepgram, before InPublic sees any text**. `SPEECH-ACCURACY-AUDIT.md` §5 measured this on byte-identical audio, 60 streams: with production's current `SEED_TERMS`, the target proper noun was recognised **0/15**; adding `"Aline"` as a keyterm made it **15/15** at 0.993 confidence, and leaving `"Airline"` in the list did not poison it. [MEASURED]

**2. The repair layer is forbidden from fixing it.** `lib/vocab.ts:199 PROTECTED` contains `air`, `line`, `lines`, **`airline`** — so once Deepgram returns "airline" or "a line", `correctTranscript` refuses to rewrite it (`:335-339`).

**3. A third, smaller path exists** and is worth naming even though it did not produce this case: `correctTranscript` will rewrite any span that phonetically matches a *named* term at ≥ `MIN_CONFIDENCE = 0.86` (`lib/vocab.ts:227`, `:322`). Canvas ink alone has no authority — only `SEED_TERMS` + `NEXT_PUBLIC_KEYTERMS` (`:265-269`) — which is a good restriction. Every rewrite is logged as a `{type:"correction"}` event.

**Nothing here is a bug in the pipeline. It is a data problem in a fifteen-item array,** and the fix is additive.

---

# 5. Semantic Understanding

### Where text becomes meaning

There are **four** distinct places, not one:

```
TRANSCRIPT
   ├─► lib/speculative.ts:259  recognizeSpeculative   (regex, local, ~instant)
   │       count / trend / emphasis / contrast / cause / bare concept
   ├─► /api/beat  BEAT_SYSTEM (Haiku)                 (classification only)
   │       draw | command | section | undo | clear | skip | math_step
   ├─► /api/artist  ARTIST_SYSTEM (Sonnet)            (the real interpreter)
   │       concepts + typed relationships as EDIT ACTIONS
   └─► lib/director.ts + lib/directorState.ts         (regex + state, local)
           comparison pair | ordered process chain
```

**Segmentation mechanisms:**

| Mechanism | Where | Unit |
|---|---|---|
| Two-consecutive-interim word agreement | `Board.tsx:5278-5284` | "settled" word prefix |
| Deepgram finalisation (`endpointing:150`) | provider | utterance |
| Silence gate 600 ms + `isThoughtComplete` + 1000 ms fragment grace | `Board.tsx:4765`, `lib/pagination.ts:77` | thought-ish |
| `MAX_PENDING_WORDS = 120` rolling buffer | `Board.tsx:208` | beat window |
| `retirePending` (consume only the words this beat used) | `lib/liveSpeech.ts:118` | beat window |
| `TRANSCRIPT_WINDOW_MS = 90_000` finals window | `Board.tsx:290`, `recentTranscript:756` | Artist window |
| `scribeContextRef` last 40 words | `Board.tsx:3146-3150` | Scribe context |

**There is no sentence parser, no clause parser, no NLP library.** Clause boundaries are found by regex marker position (`lib/director.ts:97-107`) or by punctuation heuristics.

---

# 6. AI / Model Calls

| # | Call | Model (default) | Endpoint | Temp / max tokens | Streaming | Responsibility |
|---|---|---|---|---|---|---|
| 1 | **Scribe** | `claude-haiku-4-5-20251001` | `POST /api/scribe` | 0.4 / 200 | **Yes**, line-by-line | Transcript repair + salience + visual-form choice + text authoring + dedupe |
| 2 | **Beat** | `claude-haiku-4-5-20251001` | `POST /api/beat` | 0 / 300 (+1 retry @400) | No | Classification + importance + page/section + undo/clear |
| 3 | **Artist** | `claude-sonnet-4-6` | `POST /api/artist` | 0.3 / 1200, `allowThinking` | No | Meaning + entity resolution + relationship authoring |
| 4 | **Math** | `= ARTIST_MODEL` | `POST /api/math` | 0.2 / 700, `allowThinking` | No | One verified incremental step + visual-spec choice |
| 5 | **Story** | `= BEAT_MODEL` | `POST /api/story` | — | No | Story-mode scene actions — **feature-flagged off** |
| 6 | **Live Scribe** | Gemini Live | WebSocket | — | tool calls | Alternate engine — **off unless `NEXT_PUBLIC_ENGINE=gemini`** |

Model routing is a one-line shim: `providerFor(model)` sends anything starting with `gemini` to Google, everything else to Anthropic (`lib/llm.ts:31`). Every call is wrapped in `guardProviderRequest` / `reconcileProviderCost` for spend and rate control.

**Failure semantics are consistently safe:** Beat failure → `skip`; Artist failure → `{actions:[]}` and *pending text is deliberately NOT retired* so the next beat retries (`Board.tsx:4571-4577`); Scribe failure → falls back to the local `growSketch`; Math failure → `null`. No model failure ever reaches the canvas as garbage.

### Exact context each call receives

**Scribe** (`app/api/scribe/route.ts:38`):
```
ALREADY ON PAGE (do not repeat): <last 24 mark labels, current page>
EARLIER (context only, already handled): <last 40 words>
JUST SAID (draw this): <settled words since last call>
```

**Beat** (`app/api/beat/route.ts:79`):
```
Seconds since the canvas last changed
Times you have skipped in a row              ← skipStreak, drives an escalation ladder
LOOSE WORDS already lettered on the page     ← last 20 Scribe labels
DIAGRAMS already drawn                       ← framesRef, EMPTY in production (see §9)
THE BOARD, as meaning                        ← activeTopic, sections, ≤24 concepts,
                                               relationships, recentCommands
New transcript since the last drawing        ← pendingText, ≤120 words
```

**Artist** (`app/api/artist/route.ts:39`):
```
WHAT TO SHOW / THE SPEAKER GAVE AN INSTRUCTION   ← beat's `focus` string
EXISTING CONCEPTS  (full JSON, ≤24, with rounded x/y)
EXISTING RELATIONSHIPS (only those whose endpoints survived the 24-cap)
SECTIONS / ACTIVE TOPIC / CURRENT PAGE / RECENT COMMANDS
RECENT TRANSCRIPT   ← last 90 s of FINAL transcripts
```

**Note:** the Artist never sees the page's *ink* — only the semantic board. The bridge between "words already lettered" and "concepts" is the Organizer's `adopt` step, done **after** the model responds, not before.

---

# 7. Visual Decision System

### How does InPublic decide WHICH visual form represents something?

**Almost entirely by which tier produced it — not by what the speech means.**

| Producer | Form vocabulary | Who chooses |
|---|---|---|
| Tier 1 | one grey/ink text row | nothing to choose |
| Tier 2 | `title` / `box` / `heading` at 40% opacity | `SpeculativeKind` → hardcoded map at `Board.tsx:2949-2954` |
| Tier 3a Scribe | `title heading word note bullet box icon wave link underline` | **the prompt**, unconstrained (`lib/prompts.ts:7-17`) |
| Tier 3b Artist | boxed concept (9 colour-coded kinds) + bound arrow + group box + highlight + move/resize/zoom | **the prompt**, from a fixed action schema (`lib/actions.ts`) |
| Tier 3c Director | side-by-side pair, ordered chain | deterministic evidence thresholds |
| Math (flagged) | equation box + 7 visual types | the Math prompt picks the type; renderer computes geometry |

**Worked example — "I had ten users last week and twenty users this week."**

1. **Tier 1** letters the whole sentence. Always.
2. **Tier 2**: `COUNT_RE` (`lib/speculative.ts:173`) requires `there are|we have|i have|that's|here are` + a *number word* + a plural noun. `"I had ten"` — `had` is not in the pattern and `ten` is not in `NUMBER_WORDS` (which stops at seven). **No count mark.** `TREND_RE` needs `increased|rose|grew|went up…`; "twenty this month" has no trend verb. **No trend mark.** Bare noun-phrase extraction may letter `"Users Last Week"`.
3. **Tier 3a Scribe** letters two or three nameable things, e.g. `word "ten users"`, `word "twenty users"`.
4. **Tier 3b Beat** sees "two things that relate to each other" → likely `draw`. **Artist** returns two `create_concept` + one `create_relationship`. Organizer sees the Scribe's ink and **adopts** it, ringing both phrases in blue and drawing a labelled arrow between them.
5. **Result: two ringed phrases and an arrow.** Not a chart, not a comparison, not emphasised numbers.

There is **no path in Standard Mode that produces a chart, a bar, an axis, or a plotted point.** The quantitative visual vocabulary is empty.

### Graph generation — specifically

| Question | Answer |
|---|---|
| Do graphs require numerical information? | Charts exist **only in math mode** (`NEXT_PUBLIC_ENABLE_MATH_MODE=true`; `.env.local` has it on, `.env.example` has it off — production value **[UNKNOWN]**). They are reached only when the Beat returns `math_step`, which the addendum defines as "explicitly mathematical" content. |
| Can qualitative speech accidentally trigger a graph? | Only via a Beat misclassification into `math_step`, and only when math mode is on. Standard Mode: **impossible — no chart renderer exists.** |
| Can the AI invent graph values? | **Partly, yes.** `create_equation` is checked against the transcript by `groundEquationInSource` (`lib/math/ground.ts`), and `transform_equation` is checked by `verifyTransformStep` (`lib/math/verify.ts`) — a real deterministic verifier that also catches a stale `before`. But **`create_math_visual` has no verifier**: the `points`, `rows`, `slope`, `intercept`, `carries`, `partialProducts` a model supplies for `coordinate_axes` / `table` / `long_multiplication` are rendered as given. `Board.tsx:4090` |
| Who chooses type / axes / data? | The model (`MATH_SYSTEM`, `lib/prompts.ts:267-281`). |
| Who chooses geometry? | **The renderer, always.** The prompt is explicit: "you never invent its geometry — you supply only symbolic values … and the renderer computes exact placement." `lib/math/visuals.ts` |
| Fallback? | Failed parse → `{action:null}`. Unverified steps are still drawn, but **visually marked** (`buildMathStepBox(..., verified)` takes verification state as a parameter). |

**This math sub-system is the strongest meaning→structure→renderer chain in the codebase, and it is the only place where a visual can be wrong in a way the system can detect.**

---

# 8. Visual Grammar

| Name | Trigger | Code | AI or deterministic | Input | Output elements | Layout | Updates existing? | Delete/replace? | Page-aware? | Confidence gate | Conflict risk |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Live transcript line | every interim/final | `Board.tsx:2471`, `ops.ts:387` | deterministic | text | 1 text el | pen, full-width row | **yes, patched in place** | dropped/carried on page turn | yes (carried) | none | re-anchors when others draw |
| Settle flash | final | `Board.tsx:5209` | det. | ids | opacity pulse | — | yes | — | — | — | low |
| Speculative mark | settled interim | `Board.tsx:2906` | det. regex | phrase | title/box/heading @40% | same pen | no | **yes, fades out** | no | Deepgram conf ≥0.6 + 2-interim agreement | duplicates (guarded by `supersedes`) |
| `title` | Scribe/Reflex | `ops.ts:763` | AI (prompt) | phrase | text 52px + swoosh line | full-width | no | undo only | page-local | `isFragment`, `groundedInSource` | at most once per page |
| `heading` | Scribe | `ops.ts:777` | AI | phrase | text 34px | full-width | no | undo | yes | same | — |
| `word` | Scribe | `ops.ts:789` | AI | phrase | text 26px | inline flow | no | undo | yes | same | — |
| `note` | Scribe / math explanation | `ops.ts:801` | AI | phrase | text 21px grey | inline | no | undo | yes | same | — |
| `bullet` | Scribe | `ops.ts:813` | AI | phrase | dot + text | inline | no | undo | yes | same | no list container — bullets are independent marks |
| `box` | Scribe / Reflex | `ops.ts:826` | AI | phrase | labelled rect | inline | no | undo | yes | same | — |
| `icon` (21 pictograms) | Scribe | `ops.ts:844`, `lib/icons.ts` | AI picks name, art is procedural | name | lines + ellipses | inline | no | undo | yes | must resolve | — |
| `wave` | Scribe (greeting) | `ops.ts:871` | AI | — | 3 arcs | inline | no | undo | yes | dedup key | — |
| `link` arrow | Scribe | `ops.ts:894` | AI | two mark texts | arrow (+label) | between marks | no | undo | yes | **refuses if marks >170 px apart and not same row** | crossing ink |
| `underline` | Scribe | `ops.ts:933` | AI | mark text | swoosh line | under mark | no | undo | yes | mark must exist | — |
| Concept node | Artist `create_concept` | `Board.tsx:3487`, `ops.ts:452` | AI decides, det. placement | label+kind | rect + bound label, **colour by kind** | pen | no | `delete_concept` | yes (`conceptPageRef`) | budget gate **first 60 s only** | duplicates if `match` misses |
| Reference ring (**adopt**) | Organizer | `Board.tsx:4199`, `ops.ts:506` | det. planning | existing mark | 1 blue rect @70% behind ink | none — wraps the mark | no | undo | yes | `ADOPT_THRESHOLD 0.72` / phonetic 0.92 | ringing the wrong words |
| Bound arrow (relationship) | Artist `create_relationship` | `Board.tsx:3575`, `ops.ts:551` | AI decides, det. routing | two nodes + verb | arrow with real `startBinding`/`endBinding` + optional label | `routeArrow` around obstacles; live rows "soft" | re-routed by Director moves | undo | yes | budget gate **first 60 s only** | **label verb is model-authored and unverified** |
| Group box | Artist `group_concepts` | `Board.tsx:3819` | AI | ids | orange rect behind | bounding box of members | no | undo | no | ≥1 member | can swallow unrelated ink |
| Highlight | Artist `highlight_concept` | `Board.tsx:3751` | AI | id | stroke recolour | in place | yes | undo | — | — | — |
| Move / resize | Artist command | `Board.tsx:3714` | AI | id + direction/scale | position/size patch | ±220 px step; scale clamped 0.5–2.5 | yes | undo | no | — | can push off sheet |
| Zoom-to-concept | Artist command | `Board.tsx:3770` | AI | id | **camera only** | `scrollToContent` | — | — | — | — | **second camera writer** |
| Comparison layout | Director | `Board.tsx:1229`, `choreographerComparison.ts` | **deterministic** | 2 concept ids | moves existing els | centred pair above the live zone | **yes — moves existing** | undo | yes | pair fired once per session | moves things the viewer was reading |
| Process layout | Director | `Board.tsx:1379`, `choreographerProcess.ts` | **deterministic** | 3–6 ids | moves existing els | H chain, V fallback | **yes** | undo | yes | `EvidenceLevel === "sufficient"` | same |
| Math step box | math mode | `math/visuals.ts:131` | AI content, det. box | expression | rect + text, **verified state changes appearance** | pen | no | undo | yes | verifier | — |
| Math visuals ×7 | math mode | `math/visuals.ts:184` | AI picks + supplies values | spec | number line, balance, fraction bar, counters, axes, table, long multiplication | fully deterministic geometry | `long_multiplication` **replaces** prior | undo | yes | **none for the values** | invented data points |
| Section | Beat `section` | `Board.tsx:3861` | AI | title | (page turn + semantic section) | — | — | undo | yes | — | mid-thought turn |
| Mermaid diagram frame | **dev console only** (`inpublic.draw()`) | `Board.tsx:3313`, `lib/scene.ts:54` | — | mermaid | frame + children | below notes | no | — | yes | — | **dead in production** |
| Story entities/scenes | story mode | `lib/storyAssets.ts` | AI + assets | actions | procedural sketches | zone staging | yes | yes | yes | yes | **flag off** |

---

# 9. Graph / Structured Visuals

Summarised above in §7. Three findings worth isolating:

1. **`framesRef` is effectively always empty in production.** It is only populated by `renderBeat` (`Board.tsx:3373`), which is only reachable from `renderQueueRef`, which is only pushed to by the **dev-only console API** `inpublic.draw()` (`Board.tsx:5719`, inside `if (!isDev) return`). So the Beat prompt's "DIAGRAMS already drawn — this is the only list that counts as already drawn" is, in production, **always `(none — nothing has been diagrammed yet)`**. The Beat is structurally unable to see that it has already drawn something. [CODE — high-confidence, worth confirming with a session log]

2. **The Mermaid path is legacy.** `lib/scene.ts buildBeat` and the whole `renderBeat` staggered fade are dead code in production; the live path is the action schema.

3. **The math renderer is the architecture the rest of the system does not have:** a typed semantic object (`MathReasoningStep`), a deterministic verifier, and a renderer that owns all geometry.

---

# 10. Sketch / Story Architecture

Story Mode is parked (`lib/features.ts:24 storyMode:false`) but **fully implemented**, and it contains capabilities Standard Mode does not have:

| Capability | Story | Standard |
|---|---|---|
| Local deterministic semantic compile from raw speech | ✅ `storyV2.ts:179 compileStoryEvent` | ❌ (only regex fragments) |
| Typed event with entities / actions / relations / environment | ✅ `StoryEvent` (`storyV2.ts:66`) | ❌ |
| Persistent entity registry with ids, aliases, pronoun resolution | ✅ `lib/story.ts resolveStoryEntity` | Partial (`SemanticBoard.match`, label similarity only) |
| State separated from identity (`pose` / `action` / `direction` / `appearance`) | ✅ | ❌ |
| Transform preserving identity (cat→dog keeps the id) | ✅ | ❌ |
| Provisional render then commit | ✅ `renderStoryProvisional` | Partial (Reflex) |
| Relative placement only, renderer computes coordinates | ✅ `storyStagingDecision`, zones | ✅ (same principle) |
| Per-action accept/reject with logged reasons | ✅ `story-decision` log event with `actionsRejected` + `entityResolutions` | ❌ — the Artist's actions are planned, but rejection reasons are coarse |
| Render-consistency audit | ✅ `auditStoryRenderConsistency` | ❌ |

**The Story lane already proves, in this codebase, the "typed semantic event → validate → deterministic renderer" pattern that Standard Mode lacks.** That is the single most useful thing in the parked code.

---

# 11. Page / Book Architecture

| Property | Value | Source |
|---|---|---|
| Page size | `PAGE_W = 1040`, `PAGE_H = 780` | `lib/ops.ts:181` |
| Padding | `PAGE_PAD = 44` on all four sides | `lib/ops.ts:185`, `newPagePen:205` |
| Gap between pages | `PAGE_GAP = 220` | `lib/ops.ts:183` |
| Coordinate model | Pages laid **left to right**: `pageOrigin(i) = { x: i*(PAGE_W+PAGE_GAP), y: 0 }` — one infinite Excalidraw canvas, pages are conventions, not objects | `lib/ops.ts:192` |
| Per-page state | `pagePensRef` (pen position), `pageMarksRef` (mark registry). Restored on `gotoPage`, so returning to a page resumes **below** what is on it | `Board.tsx:1763` |
| Capacity | `MAX_MARKS_PER_PAGE = 22`, grace `+4` | `Board.tsx:263`, `lib/pagination.ts:118` |
| Element budgets | `MAX_VISIBLE_CONCEPTS 6`, `MAX_VISIBLE_RELATIONSHIPS 3`, `MAX_TEMPORARY_SCRIBE_MARKS 8` — **only enforced for the first 60 s** | `lib/attention.ts` + every call site's `withinInitialCompositionWindow` guard |
| Navigation back | `gotoPage` + `detectBackReference`/`resolveReference` — "going back to X" flies to that page, applies there, and returns | `Board.tsx:4348`, `lib/reference.ts` |
| Editing previous pages | Yes — the reference visit is a real round trip around `applyActions` |
| Deletion | Never. `doClear` dims the page to 20% opacity and turns | `Board.tsx:3456` |

### What EXACTLY causes a new page

Five triggers, split into hard and soft (`lib/pagination.ts:120`):

| Trigger | Source | Deferrable? |
|---|---|---|
| `overflow` — the block in hand does not fit | `applyOp:2414`, `renderBeat`, every math placement | **No** |
| `long-utterance` — one sentence outgrows the sheet | `writeLive:2520` | **No** |
| `clear` — "clear the board" / voice "new page" | `doClear`, `runVoiceCommand` | **No** |
| `section` — the Beat returned `section` | `applyAction create_section:3863` | **No** |
| `capacity` — 22 marks reached | `applyOp:2405`, re-checked when a line settles (`:2705`) | **Yes** — held until `isThoughtComplete(liveText)`, or 6 s (`MAX_DEFER_MS`), or 26 marks |

**And one global suppressor:** during the first 60 seconds, `requestPageTurn` refuses `capacity`/`overflow`/`section`/`long-utterance` outright (`Board.tsx:1859-1870`).

Page turns are **not** time-based, not AI-decided, and not topic-detected except via the Beat's `section`. The turn carries the in-flight sentence onto the new sheet whole (`turnPage:1801`), and logs `midThought` so a bad turn is diagnosable.

---

# 12. Layout Architecture

**A model never emits a coordinate.** This is stated as a design rule (`lib/ops.ts:4-6`, `STORY_SYSTEM`: "Never emit x/y coordinates", `MATH_SYSTEM`: "the renderer computes exact placement") and it holds everywhere in the code.

Placement is a **typesetter's pen**, not a layout engine:

- `place(pen, w, h, fullWidth)` (`lib/ops.ts:242`) — left-to-right flow, wrap at `CONTENT_W`, `GAP_X 42` / `GAP_Y 46`, `fullWidth` forces its own row.
- `lineStart(pen)` lets the live line reserve a row before it knows its height.
- `willOverflow(pen, w, h)` is the only collision test for placement.
- **There is no collision detection between placed elements**, no grid, no slots, no re-flow. Correctness comes from the invariant "everything goes through one pen, in order."
- **Arrow routing is the exception and is genuinely good:** `routeArrow` (`lib/routing.ts`) takes every element on the page as an obstacle, treats live transcript rows as *soft* obstacles (crossable only as a last resort), and produces a polyline. Arrows are bound via `startBinding`/`endBinding` + `boundElements`, so Excalidraw re-routes them when a node moves.

**Can new visuals force old ones to move?** Only in three places:
1. `move_concept` / `resize_concept` — an explicit spoken command.
2. **Director comparison/process** — moves 2–6 existing concept boxes into a layout, spring-animated, arrows re-routed in place with the same ids (`Board.tsx:1051 applyComparisonReroutes`).
3. `create_math_visual` with `long_multiplication` — replaces the previous one for that concept.

Everything else is append-only. The live line's re-anchor is a *displacement of the unfinished line*, not of finished content.

---

# 13. Camera Architecture

```
visual event → framePage(force?, reason, mathFocal?, liveFocal?, allowFullZoom?)
                 ├─ guard: live-camera hold        → remember in pendingReframeRef, return
                 ├─ guard: move already in flight  → remember, return
                 ├─ compute onPage elements → focalBounds (+ optional contextBounds)
                 ├─ readability samples (font size → role → min effective px)
                 └─ proposeCamera(...)  [pure, lib/composition.ts:378]
                        ├─ fits + no webcam collision + no readability violation
                        │   + no navigation required → move:false
                        ├─ zoom = max(fitZoom, readableZoom), clamped ±0.16/move,
                        │   max zoom 1.08
                        └─ move = urgent || (meaningful && !cooldown && !manualPriority)
                    → animateCamera(target, reason)  [critically damped spring, rAF]
```

| Control | Value | Where |
|---|---|---|
| Cooldown between moves | 900 ms | `CAMERA_RULES.cooldownMs` |
| Minimum displacement | 32 px | `minimumDisplacementPx` |
| Zoom hysteresis / max change per move / max zoom | 0.07 / 0.16 / 1.08 | `CAMERA_RULES` |
| Live hold during speech | set on every `writeLive`, released 1800 ms after a settled line | `Board.tsx:2599-2619` |
| Hard ceiling on a held streak | 6000 ms | `MAX_LIVE_CAMERA_HOLD_MS` |
| Manual pan/zoom priority | 4000 ms, **only blocks non-urgent moves** | `MANUAL_CAMERA_PRIORITY_MS` |
| Stuck-move escape | 2500 ms | `stuckMoveMs` |
| Deferred-request memory | `pendingReframeRef` — one entry, newest wins, replayed on release | `Board.tsx:545` |
| Reduced motion | honoured — instant jump | `Board.tsx:955` |
| Safe frame | margins 36 px + a reserved **webcam PiP rectangle** (top-right, 20% width) | `DEFAULT_RECORDING_VIEWPORT` |
| Readability contract | primary ≥22 px, supporting ≥18, annotation ≥15 effective px | `READABILITY_CONTRACT` |

**Who can command the camera:** `framePage` (the controller) — *and* `zoom_to_concept`, which calls Excalidraw's own `scrollToContent` directly (`Board.tsx:3792`). That second writer is explicitly coordinated (cancels the in-flight spring, drops the pending reframe, resyncs `compositionRef` after 420 ms), so it is a managed exception rather than a race.

**The distraction-relevant behaviour:** during speech, `framePage` is called with `liveFocalElementId` on **every interim** (`Board.tsx:2609`), which *bypasses the hold guard by design* and frames a 620×180 window on the **trailing edge** of the growing transcript element. So the camera follows your words as you speak, then — 1.8 s after you stop — pulls back to an overview with `allowFullZoomChange:true` (`Board.tsx:2618`), which removes the per-move zoom clamp entirely.

**Can visuals appear off-screen?** Yes, and the code knows it: `camera-metric` with `event:"failed_visibility_check"` is logged when the camera declines to move but its own post-decision check says the content still does not fit (`Board.tsx:1731-1737`).

---

# 14. Incremental Processing

| Question | Answer |
|---|---|
| Processes partial thoughts independently? | **Tier 2 yes** (settled word chunks). **Tier 3 mostly no** — it waits for silence. |
| Waits for sentence completion? | Tries to: `isThoughtComplete` (dangling-word + punctuation + trailing-pronoun heuristics). |
| Waits for final transcription? | Scribe: yes. Beat: reads `pendingTextRef`, which is built from **finals only**. |
| Groups sentences? | Yes — `pendingTextRef` accumulates up to 120 words across finals, and `retirePending` removes only the words a beat consumed. |
| Accumulates context? | Yes — `finalsRef` (90 s window), `scribeContextRef` (40 words), `SemanticBoard` (session-long), `checkpoints` (compressed aged-out concepts). |
| **Revises earlier interpretations?** | **Only Tier 2.** A speculative mark that the final contradicts is retracted. **Nothing ever revises a Scribe mark, a concept, or an arrow** — the only reversal is `doUndo`, which pops exactly one operation. |
| Maintains semantic state? | Yes, but it is a **board model** (what is drawn), not a **discourse model** (what is being argued). |
| Adds new visuals without correcting earlier ones? | **Yes. This is the default behaviour.** |

**Race / staleness protection is unusually thorough:** `liveSeqRef` epochs, per-socket `streamEpoch`, `comparisonEpochRef`, `aiAbortRef` + `scribeAbortRef`, `beatQueuedRef`/`scribeQueuedRef` (queue at most one), `firedCommandRef` (stops a voice command running twice), `renderedMarkKeysRef` + `decorationsRef` (hard dedupe), `MAX_DEFERRED_ATTEMPTS` on blocked guesses.

### Can InPublic visually commit to an interpretation before the thought is complete?

**Yes — by three separate paths, and only one of them is retractable.**

1. **Reflex** draws on settled interim words, mid-sentence. *Retractable* — `settleSpeculative` removes anything the final contradicts. This is the safe one.
2. **The Scribe** runs on finals but a "final" is one Deepgram utterance, not one thought (`endpointing:150`). It letters permanent ink from a clause. *Not retractable.*
3. **The Beat fires on unfinished thoughts by design.** `resetSilenceTimer` (`Board.tsx:4777-4788`): if `isThoughtComplete` is false, wait `FRAGMENT_GRACE_MS - SILENCE_MS` = 1000 ms more, then `fire("fragment held to the ceiling, going anyway")`. `BEAT_SYSTEM` reinforces it: *"It does NOT have to be a finished sentence or a finished thought."* The Artist then creates concepts and arrows that are **permanent** unless the speaker says "scratch that". *Not retractable.*

This is the mechanism by which "Revenue increased… but not because we gained customers" can become a committed arrow before the "but" arrives.

---

# 15. Visual Memory / Existing Element Awareness

**This is one of the system's genuinely strong areas.** Your example — canvas has `Marketing → Traffic`, you then say "traffic turns into signups" — is handled correctly, by four cooperating mechanisms:

1. **`SemanticBoard.match(labelOrId)`** (`lib/semantic.ts:298`) — exact id → slug → best token-similarity above `MATCH_THRESHOLD = 0.6`, with crude singularisation and a containment boost.
2. **The Artist prompt's central rule** — "REUSE BEFORE YOU CREATE", with a worked right/wrong example, plus "matching is by MEANING, not spelling."
3. **The Organizer** (`lib/organizer.ts:115`) — three outcomes per requested concept: `reuse` (already a concept) → `adopt` (already *ink* on the page, matched at `ADOPT_THRESHOLD 0.72` or phonetically at 0.92) → `create`. **`adopt` is what makes the system annotate the page instead of drawing a parallel copy of it**; the header comment records the measurement that motivated it: 27 concepts created, 0 reused, while 40 Scribe marks covered the same nouns.
4. **Relationship dedupe** — `addRelationship` refuses an edge that already exists in the same direction (`lib/semantic.ts:359`).

Identity plumbing: `conceptElementRef` (concept → bindable element), `conceptPageRef` (concept → page), `marksRef`/`pageMarksRef` (page-local mark registry), `renderedMarkKeysRef` (session-wide dedupe), `decorationsRef`.

**Existing visuals are treated as persistent semantic objects, not just drawing elements.** The direction of authority is explicit and correct: a concept knows its elements; an element knows nothing.

**Known gaps:** the Artist only sees the **24 most recently updated** concepts, and relationships whose endpoints fall outside that window are filtered out of the prompt entirely (`lib/semantic.ts:500`). Aged-out concepts leave only a compressed `checkpointSummaries` trace — which is passed to `/api/math` but **not** to `/api/artist` or `/api/beat`. So over a long talk, a concept can silently become invisible to the interpreter while still being visible on the canvas.

---

# 16. Timing / Latency Pipeline

Instrumentation already exists and is non-invasive: `lib/latency.ts` (`latency.mark`/`observe`, ~30 sample keys), `lib/latencySink.ts` (auto-POSTs a summary to `/api/telemetry/latency` on every session stop, in every environment), `inpublic.latency()` / `inpublic.latencyHistory()` / `inpublic.latencyOverlay()` in dev, and ~60 typed log event kinds including `{type:"timing"}` which records one row per beat→organizer→canvas trip on one clock.

**One spoken thought, estimated timeline:**

```
    0 ms   audio captured
  +40–80   80 ms PCM chunk boundary                      [CODE — hard floor]
  +20–60   browser → Deepgram WSS                        [EST]
 +100–300  nova-3 interim returned                       [EST; interim_lag is measured live]
     +1–6  correctTranscript + buildLiveLine + commit    [PRIOR MEASURED]
 ≈250–450  ── FIRST WORD VISIBLE ──                      [EST, LATENCY-AUDIT.md]
   +0–?    Reflex recognition (macrotask) + render       [EST <20 ms; `speech_to_speculative` measured live]
 +150–600  Deepgram finalises (endpointing:150)          [EST]
   +0–1200 Scribe cooldown (SCRIBE_INTERVAL_MS = 1200)   [CODE — note: LATENCY-AUDIT.md's 5250 is STALE]
 +760–930  Scribe first streamed op                      [PRIOR]
     +10   applyOp render                                [PRIOR]
≈1.5–3.0 s ── FIRST SCRIBE MARK ──
 +600/1600 silence gate (complete / fragment grace)      [CODE]
 +901–1916 /api/beat Haiku                               [PRIOR]
+3616–4517 /api/artist Sonnet                            [MEASURED/PRIOR]
     +10   planActions + applyActions                    [PRIOR]
  +0–4000  waitForIdleHands (only on the dead mermaid path)
≈6–9 s     ── FIRST STRUCTURE (box + arrow) ──
  +0–900   camera cooldown, then spring                  [CODE]
```

**Honest caveat:** the model-call numbers are `[PRIOR]` from `LATENCY-AUDIT.md` (2026-08-11) and `AUDIT-3.md` (2026-08-09). `SCRIBE_INTERVAL_MS` has since dropped 5250 → 1200 (`Board.tsx:229`), so that audit's headline "biggest regression" no longer applies. **Exact current end-to-end timings cannot be known without running a session** — but they do not require code changes to obtain: `lib/latencySink.ts` already persists a summary automatically on every stop, and `inpublic.latency()` prints it. That is the intended non-invasive path.

---

# 17. Prompt Inventory

All prompts live in `lib/prompts.ts` (plus one addendum in `app/api/beat/route.ts:17`). A full-repo search found no others.

| Prompt | Model | Output | Responsibilities (classified) |
|---|---|---|---|
| `SCRIBE_SYSTEM` | Haiku | line-oriented ops | **transcription correction** + **semantic understanding** (nameable things) + **importance** ("what they keep returning to") + **visual selection** (10 op types) + **visual generation** (the text itself) + **dedupe** |
| `LIVE_SCRIBE_SYSTEM` | Gemini Live | tool calls | same, plus prosody ("you can hear HOW they say it") — **dormant** |
| `BEAT_SYSTEM` | Haiku | `{action, reason, focus}` | **classification** + **importance/timing** + **page management** (`section`) + **command detection** + **undo/clear** + a self-escalation ladder |
| `BEAT_MATH_ADDENDUM` | Haiku | adds `math_step` | routing to the math domain |
| `ARTIST_SYSTEM` | Sonnet | `{actions:[…]}` | **semantic understanding** + **entity resolution** + **relationship authoring** + **visual selection** (implicitly: boxes and arrows) + **command interpretation** |
| `MATH_SYSTEM` | Sonnet | one action | **semantic understanding** + **step authoring** + **visual selection** (7 types) + **pedagogy** (reason/commonMistake/connection) |
| `STORY_SYSTEM` | Haiku | `{sourceText, normalizedText, confidence, actions}` | **semantic understanding** + **entity continuity** + **visual selection** + **grounding** — **flag off** |

### Prompts carrying several major decisions at once (flagged, not changed)

- **`SCRIBE_SYSTEM`** is the worst offender: it is simultaneously a speech-error corrector ("the transcript is often WRONG… draw the page's spelling"), a salience judge ("CAPTURE GENEROUSLY… a word they say three or four times is the spine of their argument"), a visual-form selector, a copywriter, and a deduplicator — with a hard "at most 5 operations" and a *"Every line you write is either a valid operation or a mistake"* framing. It is also the only prompt that both decides *what matters* and *writes the words that appear*. Its generosity bias is explicit and is the primary volume driver on the page.
- **`BEAT_SYSTEM`** contains an **escalation ladder** that overrides its own judgement: *"3-4 skips — lower your bar… 5+ skips — you are the problem. Something in there is drawable. Draw it."* combined with *"Aim for a drawing every two or three sentences of substance"* and *"If the transcript has content and you are hesitating, draw."* This is a prompt-level pressure toward production, tracked by a client-side counter it cannot reset itself.
- **`ARTIST_SYSTEM`** likewise: *"A response with concepts and no relationships is usually a wasted turn"* and *"Returning no actions because everything they named already exists… (also wrong)"*. Combined, the two prompts make "draw nothing" the discouraged answer at both stages.

Neither is a defect on its own — both were clearly written to fix real over-skipping. But they are the mechanism by which the board keeps producing when the correct answer is silence.

---

# 18. Representative Speech Traces

Traced against the code as written. Where a model's judgement is involved I say so rather than pretending to predict it.

### A — "I have three reasons why this isn't working."
- Tier 1: lettered.
- Tier 2: `COUNT_RE` matches `i have three reasons` → speculative **`3 REASONS`** heading at 40% opacity, promoted on the final. ✅ *This is the system at its best.*
- Scribe: likely `heading "3 reasons"` — blocked as a duplicate by `renderedMarkKeys`/`supersedes`. Good.
- Beat: probably `skip` (no two things named yet). Nothing structural.
- **Verdict: accurate.** But note there is **no list/enumeration renderer** — the three reasons, when they arrive, become three unrelated `bullet` or `word` marks with no container and no numbering.

### B — "Marketing brings traffic, and traffic creates signups."
- Scribe letters `Marketing`, `Traffic`, `Signups`.
- Beat → `draw`. Artist returns 3 `create_concept` + 2 `create_relationship`.
- Organizer **adopts** all three (the ink is already there, similarity ≫ 0.72), rings them blue, draws two routed bound arrows labelled with the model's verbs.
- Director: `PROCESS_MARKER_RE` does not match "brings"/"creates", so no process forms from this sentence alone.
- **Verdict: accurate, and this is the shape the system handles best.**

### C — "Revenue went from ten thousand dollars last month to twenty thousand this month."
- Tier 2: `TREND_RE` requires an explicit trend verb — "went from" is not in the list, "went up" is. **No trend mark.**
- Scribe: probably `word "ten thousand dollars"`, `word "twenty thousand"`.
- Artist: two concepts + an arrow labelled something like "grew to".
- **Verdict: understated but not wrong.** The quantity, the comparison, and the magnitude are all lost — they become two phrases and an arrow. **No chart is possible.**

### D — "Our company has engineering, marketing and sales."
- Scribe: up to 5 ops — plausibly a `box` each.
- Artist: 4 concepts + 3 relationships → a hub with three arrows, laid out by the pen in reading order (not as a tree).
- **Verdict: the hierarchy is expressed as three arrows, not as a hierarchy.** There is no tree/hierarchy renderer. Readable, but flat.

### E — "The signup page is confusing, so people leave before buying."
- Tier 2: `CAUSE_FORWARD_RE` needs `causes|leads to|results in` — "so" does not match. No cause mark.
- Beat → `draw`; Artist → `problem` and `output`-kind concepts with a causal arrow. Kind-based colouring (`problem` = crimson) does carry a little meaning here.
- **Verdict: accurate.**

### F — "The cat ran underneath the tree because it started raining."
- Standard Mode: Scribe letters `Cat`, `Tree`, maybe `Raining`. Tier 2's `CAUSE_BECAUSE_RE` **could** fire — but only if *both* "cat…" and "raining" are already on the board (`foundOnBoard` on both ends), so usually not.
- Artist: two or three boxes, an arrow labelled "because".
- **Verdict: this is exactly the sentence Story Mode was built for** (pose/action/direction/relation, procedural cat and tree assets) — and Standard Mode renders it as boxes.

### G — "I'm not really sure what I think about this yet."
- Tier 1 letters it. Tier 2: no regex matches; `extractConcepts` filters nearly everything as stopwords.
- Scribe: `shouldWakeScribe` may pass (some content words), but the prompt should refuse ("PURE filler… output NOTHING AT ALL").
- Beat: `skip` — and `skipStreak` increments.
- **Verdict: correct — the board stays quiet.** ⚠️ **But the skip is counted.** Three or four such utterances in a row push the Beat into "lower your bar" territory, so a later, equally unremarkable sentence gets drawn because of the *history of not drawing*, not because of its own content.

### H — "Revenue increased, but customers actually decreased."
- Tier 2: `TREND_RE` fires on "revenue increased" → **`Revenue ↑`**. `CONTRAST_RE` fires (the settled chunk starts with "but") → a **`⟷`** glyph. `TREND_RE` only takes the *first* match in the utterance, so **"customers decreased" gets no ↓ mark.** Result: an up-arrow and a bare contrast glyph — a *partial* picture that leans optimistic.
- Director: `MARKER_RE` matches "but"; if both "revenue" and "customers" resolve to existing concepts at ≥0.5, a comparison hypothesis fires and the two boxes are **physically moved side by side**.
- **Verdict: the most likely contradiction case in the whole audit.** A lone `Revenue ↑` on screen while the speaker is saying customers fell is exactly "the visual contradicts the speaker."

### I — Incremental: "Revenue increased…" → "…but it wasn't because we got more customers…" → "…we increased our price from ten to fifteen."
| Beat | What happens |
|---|---|
| 1 | Tier 1 letters it. Tier 2 draws `Revenue ↑`. If the speaker pauses >600 ms and >4 words, **the Beat may fire on this fragment alone** and the Artist may create a `Revenue` concept. |
| 2 | Tier 2's `CONTRAST_RE` fires → `⟷`. `CAUSE_BECAUSE_RE` may fire if both ends exist. Nothing retracts or qualifies the `↑`. |
| 3 | Scribe letters `Ten Dollars` / `Fifteen`. Artist adds a `Price` concept and an arrow. Director may now see enough for a comparison or a process. |
| Net | Three independent additions. **Nothing goes back and amends the interpretation from beat 1.** The board accumulates; it does not revise. |

**This is the clearest evidence for the "incremental semantic state" gap: the system has excellent *board* memory and no *argument* memory.**

---

# 19. Sources of Visual Contradiction

Ranked by (likelihood × visibility on camera), with code evidence.

### CRITICAL

**C1. The Beat commits on unfinished thoughts, and Tier 3 output is irreversible.**
`Board.tsx:4784-4787` fires after 1000 ms of extra grace on a fragment; `BEAT_SYSTEM` says a finished thought is not required. The Artist's concepts and arrows have **no revision path** — only `doUndo` (one operation, voice-triggered). Trace I is the canonical failure.

**C2. Production is ungoverned after 60 seconds.**
Every attention gate — `temporaryMarkBudgetReached` (`applyOp:2380`), `visibleConceptBudgetReached` (`:3508`), `visibleRelationshipBudgetReached` (`:3597`), the Scribe's `attentionBudgetFull` (`:3099`) — is conjoined with `withinInitialCompositionWindow(now())`, i.e. `sessionMs < 60_000` (`lib/attention.ts:6`). After one minute, four producers write to the page with only per-page capacity (22 marks → *turn the page*, not *stop*) as a brake. Directly explains "too many things appearing."

**C3. Relationship labels are model-authored and unverified.**
`create_relationship` carries `relationshipType` and `label` — "analyzes", "feeds", "becomes", "leads to" — straight from the Artist onto the canvas as arrow text (`Board.tsx:3641`, `ops.ts:606`). There is no equivalent of `groundedInSource` for arrow labels (the Scribe's text *is* grounded; the Artist's is not). **A wrong verb on an arrow between two correct boxes is the highest-fidelity way to contradict a speaker**, because it reads as an assertion the speaker made.

### HIGH

**H1. Tier 2 takes the first trend and ignores the rest.** `TREND_RE.match` on the utterance returns one match (`lib/speculative.ts:315`). Trace H: `Revenue ↑` appears while the sentence's actual point is the contrast.

**H2. The Beat cannot see what it has already diagrammed.** `framesRef` is only populated by the dev-only mermaid path (§9), so "DIAGRAMS already drawn" is always empty in production. The Beat's only redundancy signal is the semantic board, which the prompt then tells it not to over-weight.

**H3. Skip-streak escalation converts silence into pressure.** `beatSkipStreakRef` (`Board.tsx:4334`, `:4470`) is sent to a prompt that says at 5+ skips *"you are the problem."* A speaker who is genuinely rambling generates exactly this state.

**H4. The camera follows every interim, then snaps back.** `writeLive:2609` frames the trailing 620×180 px of the growing line on every partial (~5/s), and `:2618` schedules an overview reveal 1.8 s later **with the per-move zoom clamp removed** (`allowFullZoomChange:true`). Continuous small moves plus a periodic large one is the textbook recipe for "distracting."

**H5. Director moves things the viewer is currently reading.** `performComparison`/`performProcess` spring 2–6 existing boxes to new positions and re-route their arrows. It is gated (evidence "sufficient", once per pair, deferred on pointer input, cooldowns 1200/2000 ms) and it is *deterministic*, which is good — but the layout only avoids the *live-writing zone*, not the viewer's attention.

**H6. Duplicate concepts when `match` misses.** `MATCH_THRESHOLD = 0.6` on token similarity. A concept renamed by speech ("the signup page" → "onboarding") falls below it and becomes a second box.

### MEDIUM

**M1. Keyterm-driven substitution** — the `Aline`/`Airline` mechanism (§4). Proven, cheap to fix, data-only. [MEASURED]
**M2. `correctTranscript` rewriting a real phrase** — bounded by `PROTECTED`, named-terms-only authority, span scoring, and `MIN_CONFIDENCE 0.86`; every rewrite is logged. Low residual risk, but it *is* a path by which words the speaker said are replaced on camera.
**M3. Unverified math visual data** — `create_math_visual` points/rows/carries are rendered as supplied (§7). Only reachable with math mode on.
**M4. `group_concepts` bounding box** — drawn around the union of member nodes with 22 px padding (`Board.tsx:3828`); on a busy page it can visually enclose unrelated ink that happens to sit between members.
**M5. Page turn mid-thought** — well mitigated (`decidePageTurn` defers soft turns; `midThought` is logged) but hard triggers (`overflow`, `long-utterance`, `section`) still cut in.
**M6. Adopt ringing the wrong words** — `ADOPT_THRESHOLD 0.72`, or a phonetic match at 0.92 which can ring a homophone.

### LOW

**L1.** Stale Artist response — mitigated by `aiAbortRef` and by `renderQueue`/in-flight guards.
**L2.** Two camera writers — explicitly coordinated at `Board.tsx:3787-3807`.
**L3.** Gemini engine drift — dormant.
**L4.** Mermaid path — dev-only.

---

# 20. Sources of Visual Distraction

Distinct from contradiction: these are things that are *correct* but pull attention.

| Source | Mechanism | Frequency |
|---|---|---|
| Camera follows the words | `framePage(false, "following live narration", null, elementId)` on every interim | ~5×/s while speaking |
| Overview reveal | 1800 ms after each settled line, zoom clamp lifted | once per sentence |
| Live line re-anchor | a Scribe/Artist/Reflex mark lands, pen moves, the half-written sentence jumps down one row on its next interim | whenever tiers overlap |
| Speculative promote/retract | 4-step opacity pulse to 100%, or a 3-step fade to 0 | per utterance |
| Settle flash | 90 ms dip to 65% and back on each finalised line | per utterance |
| Director choreography | 2–6 boxes spring to new positions, arrows re-route | rare, gated |
| Page turn | camera flies to the next sheet | on capacity/overflow/section |
| Volume itself | four producers, no budget after 60 s | continuous |

**None of these is individually wrong. The problem is that there is no single component that owns "how much is happening right now."**

---

# 21. What Is Already Strong

These deserve to be preserved, and I would argue against touching most of them.

1. **Tier 1 instant transcript ink** (`writeLive`, `buildLiveLine`). 1–6 ms, no model, no network, stable element id across interims, correct font measurement, pen row reservation, epoch-guarded. It is documented with an explicit invariant and it is the product's core promise. **Do not touch.**

2. **The direct browser↔Deepgram architecture.** Ephemeral 60 s tokens, credential caching around a 3/600 s mint limit, reconnect ladder that keeps the mic stream, per-socket audio epoch anchoring. Audio never touches the server. **Do not touch.**

3. **The "no model emits coordinates" rule.** Enforced in `ops.ts`, `MATH_SYSTEM`, `STORY_SYSTEM`, the choreographers, and the staging system. This is the single best architectural decision in the codebase and it is what keeps layout sane.

4. **The Organizer's reuse/adopt/create trichotomy** (`lib/organizer.ts`). Pure, testable, and the direct fix for the measured "27 created, 0 reused" failure. `adopt` — ringing the ink the speaker already watched appear — is genuinely novel and is the right instinct for a live medium.

5. **The semantic board + operation history** (`lib/semantic.ts`). Concepts by id, relationship dedupe, whole-element undo records, `lastMeaningful()` skipping camera-only ops. One-operation undo actually works.

6. **The Director/Choreographer's patience model** (`lib/directorState.ts`). Ordinal evidence levels, never a synthesised percentage; commits only at "sufficient"; hypotheses can be weakened and abandoned; explicit arbitration between competing structures; cooldowns. **This is the only part of the system that already embodies "wait until you're sure."** It should be the template, not an exception.

7. **The math sub-system** (`lib/math/*`). Typed `MathReasoningStep`, deterministic `verifyTransformStep` (which catches a *stale* `before`, not just bad arithmetic), `groundEquationInSource`, symbolic-in/geometry-out visual specs. The only place a visual can be provably wrong and is marked as such.

8. **Tier 2's retraction contract** (`lib/speculative.ts`). Emit-once keys, deferred-vs-dropped outcomes with bounded retries, `supersedes` for duplicate prevention *before* placement, `confirmedByFinal` for retraction. Cheap-to-be-wrong is actually implemented, not just claimed.

9. **The camera's pure core** (`proposeCamera`). No React, no Excalidraw, testable, with a readability contract and a reserved webcam rectangle. The controller around it is complex, but the decision function is clean.

10. **The instrumentation.** ~60 typed log events, latency histograms with a persisted sink, `midThought` on page turns, `camera-metric` failure events, `beat-shadow` agreement scoring, `scribe-skipped` reasons. **You can already diagnose this system from a session file without adding a line of code.** That is rare and extremely valuable for what comes next.

11. **Arrow routing with real Excalidraw bindings** (`lib/routing.ts`, `buildBoundArrow`). Obstacle-aware, soft obstacles for transcript rows, `boundElements` registration so arrows survive node movement.

12. **Failure containment.** Every model failure degrades to silence or to a local fallback; none reaches the canvas.

---

# 22. What Is Actually Missing

Distinguishing **real capability gaps** from **interesting research ideas** (per Phase 27):

### Genuinely missing capabilities

| Missing | Evidence it is missing | Consequence |
|---|---|---|
| A **session-long production governor** | `lib/attention.ts` budgets exist but every call site is gated on the first 60 s | over-production, page churn |
| A **revision path for Tier 3** | only `doUndo`, voice-triggered, one op | committed-too-early interpretations stand |
| **Grounding for arrow labels** | `groundedInSource` applies to Scribe text only | unverifiable claims on the canvas |
| A **visual form for quantity, comparison, sequence, hierarchy** in Standard Mode | the whole grammar is text/box/arrow/ring/group | everything flattens |
| A **discourse-level state** (claim, qualification, contradiction, uncertainty) | `SemanticBoard` models *drawn things*, not *asserted things* | "but…" cannot amend anything |
| **Recency-window survivability** | Artist sees only 24 concepts; relationships outside the window are dropped from the prompt; `checkpointSummaries` reach only `/api/math` | long talks lose their early structure |
| **A "diagrams drawn" signal to the Beat** | `framesRef` is dev-only-populated | the Beat cannot tell it already answered this |

### Interesting ideas the code does NOT currently need

- *Semantic chunking* — segmentation already exists at four levels; a fifth is not the bottleneck.
- *Persistent visual entities* — **already built** (§15). This is a solved problem here.
- *Graph relationships* — already a typed `Relationship` map with dedupe.
- *Speech-driven drawing* — already the whole product.

**Do not rebuild what §21 lists.**

---

# 23. Primary Architectural Bottleneck

**Answer: H — multiple layers, ranked.**

**1st — F/G, page composition and choreography (the strongest evidence).**
Four independent producers, no shared budget after 60 s, a camera that follows every interim and periodically snaps to an unclamped overview, and a page that turns rather than throttles. Nothing in the system owns the question *"how much should be happening right now?"* Every symptom your tester reported — too many things, competing with the speaker, distracting movement, hard-to-read layouts — traces here, and this is the layer that requires the least new intelligence to fix.

**2nd — D, visual selection.**
Not "it chooses badly" — it barely chooses. Standard Mode has one grammar (text/box/arrow) for every kind of meaning. Quantity, sequence, hierarchy and comparison all collapse into the same picture. This is why a correct interpretation can still look like a poor explanation.

**3rd — C, semantic understanding.**
The board model is strong; the discourse model does not exist. There is no representation of "this claim qualifies that one", so the system cannot amend, only append (Traces H and I).

**4th — B, transcript stabilisation.**
Tier 2's two-interim agreement is a good answer for *guesses*. But Tier 3 commits permanently on a fragment after 1600 ms and cannot take it back. The stabilisation is well-designed for the retractable tier and absent for the irretractable one.

**5th — A, speech recognition.**
Real, measured, narrow, and cheap: a proper-noun vocabulary problem already diagnosed to 15/15 vs 0/15 on byte-identical audio. Not architectural.

---

# 24. Architecture Options

### OPTION 1 — Minimal Intervention

**Stays:** everything. All four tiers, all prompts, all renderers, the camera, the pages.
**Changes:** the highest-leverage *decision points only*, each a constant or a small guard, each independently reversible:
- Extend the attention budget past `INITIAL_COMPOSITION_WINDOW_MS` (make it a session-long soft budget with a per-minute production cap, rather than a 60 s cliff).
- Freeze the camera during active speech (stop calling `framePage` with `liveFocalElementId` on every interim; reframe on settle only).
- Require `isThoughtComplete` before the Beat may reach the Artist, or make the fragment path draw-nothing rather than draw-anyway.
- Add `groundedInSource`-style grounding to Artist relationship labels.
- Add `Aline` (and the other measured misses) to `SEED_TERMS`; remove `airline` from `PROTECTED`.

**Expected improvement:** high for distraction and volume; moderate for contradiction; none for "everything is a box."
**Complexity:** low. **Regression risk:** low-moderate (each is behaviour-visible but flag-able and revertible).
**Time:** ~1–3 days including a measured session per change.
**Limitation:** does not give the system any new way to *express* meaning. The board still flattens quantity, sequence, and hierarchy.

### OPTION 2 — Semantic Gate

```
speech → instant text (unchanged) → "is this a complete thought worth expressing?" → existing visual engine
```

**Compatibility with the actual architecture: high, and a gate already exists in three places** — `shouldWakeScribe`, `localBeatDecision` (running in shadow mode *right now*, logging `beat-shadow` agreement without ever branching on it), and `decidePageTurn`. Turning the shadow prefilter live is a ~10-line change and its false-skip rate is *already being measured in production logs* (`falseSkip` is the field the log was built around).

**What it fixes:** volume, cost, and some premature commitment.
**What it does not fix:** the visual grammar, or contradiction from a *correctly gated but wrongly interpreted* thought.
**Risk:** a false skip is a lost idea and is invisible to the user. The existing shadow data is exactly what tells you whether that risk is acceptable — **use it before building anything.**
**Time:** ~1 day to go live behind a flag; the measurement is already banked.

### OPTION 3 — Visual Intent Layer

```
Speech → Transcript → Meaning → VisualIntent{emphasis|relationship|cause_effect|sequence|comparison|hierarchy|quantitative_change|story_scene|none} → Renderer
```

**Could the current renderer consume this without a rewrite?** Partly — and the partial answer is the interesting one:

| Intent | Renderer exists today? |
|---|---|
| `emphasis` | ✅ `underline`, `highlight_concept`, Reflex `emphasis` flag |
| `relationship` | ✅ `create_relationship` + `routeArrow` |
| `cause_effect` | ✅ as a labelled arrow (Reflex already emits `A → B`) |
| `comparison` | ✅ `computeComparisonLayout` — already built and deterministic |
| `sequence` | ✅ `computeProcessLayout` — already built |
| `hierarchy` | ❌ **no renderer** |
| `quantitative_change` | ❌ **no renderer** in Standard Mode |
| `story_scene` | ✅ built, flagged off |
| `none` | ✅ every tier can already no-op |

**So six of nine intents already have renderers, and the Director already produces two of them deterministically.** The missing pieces are hierarchy and quantity — two new renderers, both of which can follow the math pattern (symbolic values in, geometry computed).

**This option's real content is not the enum. It is: promote the Director from a special case to the general decision path, and give the Artist an intent to satisfy instead of a free hand.**
**Complexity:** moderate. **Latency risk:** low if intent classification reuses the Beat call (it already returns a typed action) rather than adding a stage. **Regression risk:** moderate — the Artist's free-form action list is what currently produces most structure.
**Time:** ~1–2 weeks for the layer + one new renderer.

### OPTION 4 — Persistent Semantic Canvas

```
Speech → Transcript → Incremental semantic state → Persistent concepts/relationships → Visual planner → existing book/page renderer
```

**Important finding: three of these five stages already exist.** `SemanticBoard` *is* the persistent concept/relationship store; the Organizer *is* a planner; the pen/choreographers *are* the renderer. What is genuinely missing is the **incremental semantic state** — a discourse model that can hold "claim → qualification → revision" and drive amendments rather than appends.

**Upside:** the only option that fixes Traces H and I properly. Amendment ("actually, customers went down") becomes expressible.
**Complexity:** high. This is where most of the risk lives — an incremental interpreter that revises is much harder to make *stable* than one that appends, and instability on a live canvas is worse than under-expression.
**Latency:** manageable if the state is updated from the existing beat cadence rather than per-interim.
**How much existing code survives:** a lot — I would estimate the renderers, pen, pages, camera, undo, and semantic board all survive essentially intact; the Beat/Artist contract changes.
**Time:** ~4–8 weeks to something trustworthy. [EST]

### OPTION 5 — My evidence-based alternative: **Production Governor + generalise the math pattern**

The repository suggests a fifth option that is cheaper than 3 and 4 and targets the ranked bottleneck directly.

**Part A — a Production Governor (fixes bottleneck #1).**
One module that owns *how much may appear per unit time*, applied to all four producers instead of to none of them after 60 s. It is not new intelligence: `lib/attention.ts` already defines the policy, `applyOp`/`applyAction` already call it, and the log already records `{type:"attention", action:"suppression"}`. The change is *scope and lifetime*, plus a camera quiet-period. Everything needed to measure it is already instrumented.

**Part B — generalise the math contract to two new visual families (fixes bottleneck #2).**
The math lane is the only place in the codebase where a model supplies **symbolic values** and a **deterministic renderer computes geometry, with a verifier in between**. Reuse that exact contract for `quantitative_change` and `hierarchy`:
- model emits `{from: 10, to: 20, unit: "users", period: ["last week","this week"]}` — never pixels;
- a verifier checks the numbers are literally present in the transcript (the `groundEquationInSource` pattern);
- a renderer draws it, and marks it visually if unverified (the `buildMathStepBox(verified)` pattern).

**Why this beats Option 3 as a first move:** it needs no new classification stage, no new prompt orchestration, and no change to how the Beat and Artist already work. It adds *expressive range* and *restraint* — the two things the evidence says are missing — while leaving the parts §21 calls strong completely untouched.

**Complexity:** low-moderate. **Latency:** none added (Part A is client-side; Part B rides existing calls). **Regression risk:** low for A behind a flag, moderate for B (new renderers).
**Time:** ~2–4 days for A, ~1 week per renderer for B. [EST]

---

# 25. Decision Matrix

Scores 1–10. Higher is better **except** Complexity, Latency Risk, and Regression Risk, where higher = worse (marked ↓).

| Option | Keeps current engine | Improvement potential | Complexity ↓ | Latency risk ↓ | Regression risk ↓ | Time to prototype | Long-term potential |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 — Minimal Intervention | 10 | 6 | 2 | 1 | 3 | 1–3 days | 4 |
| 2 — Semantic Gate | 9 | 5 | 3 | 2 | 5 | ~1 day (data already banked) | 5 |
| 3 — Visual Intent Layer | 7 | 8 | 6 | 3 | 6 | 1–2 weeks | 8 |
| 4 — Persistent Semantic Canvas | 6 | 10 | 9 | 5 | 8 | 4–8 weeks | 10 |
| **5 — Governor + math pattern** | **9** | **8** | **4** | **1** | **4** | **2–4 days (A), +1 wk/renderer (B)** | **8** |

**Safest next experiment:** Option 5 Part A, behind a `features.*` flag in the existing style (`reflex`, `choreographerComparison`, `directorV1` all set the precedent) — one session with it on, one with it off, compared using the `{type:"attention"}`, `{type:"camera-metric"}`, `{type:"page"}` and `{type:"timing"}` events that are **already emitted**.

**Highest-upside architecture:** Option 4 — but only after Options 5 and 3 have established whether restraint and expressive range alone solve the reported problem. If they do, Option 4's cost is not justified.

**Cheapest meaningful improvement:** the vocabulary fix — add the real proper nouns to `SEED_TERMS`, drop `airline` from `PROTECTED`. Measured 0/15 → 15/15, zero latency cost, zero architecture change. [MEASURED]

**Most dangerous rewrite:** any incremental interpreter that *revises already-drawn structure* (Option 4's core). Live retraction on camera is more damaging than under-expression, and this codebase has exactly one working example of retraction (Tier 2), which works precisely because those marks are cheap, faded, and semantically weightless. Extending retraction to concepts and arrows is a different, much harder problem.

**Components to NOT touch yet:**
`writeLive` and the Tier 1 path · `hooks/useDeepgram.ts`'s socket/token/reconnect logic · `lib/ops.ts`'s pen · the "no model emits coordinates" rule · `lib/organizer.ts` · `lib/semantic.ts`'s undo/operation model · `lib/composition.ts:proposeCamera` (the pure core — the *callers* are what need attention) · `lib/directorState.ts`'s patience model · the math verifier chain · the logging/latency instrumentation.

---

# 26. Recommended FIRST Experiment

**Not an implementation plan. The smallest reversible change that would teach the most.**

> **Add one feature flag — `features.quietMode` — that does exactly two things, and run the same five-minute talk twice.**
>
> 1. Make the existing attention budget **session-long** instead of 60-second (one boolean at the `withinInitialCompositionWindow` call sites — no new policy, no new module, the budget values are already chosen).
> 2. Stop the camera following interims: skip the `framePage(..., liveFocalElementId)` call in `writeLive`, so the camera reframes only on settle and on page turns.

**Why this one:**
- It touches **no** semantic logic, no prompt, no renderer, no model call. Pure suppression.
- It is a single flag in the file that already holds four flags of exactly this shape, with the established convention that "off means zero behaviour change."
- **Everything needed to evaluate it is already instrumented.** Compare the two sessions on `{type:"attention"}` suppressions, `{type:"camera"}` / `{type:"camera-metric"}` counts, `{type:"page"}` turns and `midThought` rate, `{type:"sketch"}` mark counts, and `{type:"timing"}` — no new code, and `lib/latencySink.ts` persists the latency summary automatically.
- It directly tests the audit's primary hypothesis: **is the problem the volume and the movement, or is it the interpretation?** If the tester's "disruptive" verdict softens materially with quiet mode on, bottleneck #1 is confirmed and Option 5 Part A is the road. If it does not, the problem is interpretation and expressive range, and the answer is Option 3/5-B — which is a very different and much larger project.

Answering that question costs a flag and two recordings. Getting it wrong costs weeks.

---

# 27. Files That Matter Most

| File | Function | Why it matters | Risk if changed |
|---|---|---|---|
| `components/Board.tsx` | the entire client runtime, ~6,100 lines | Every tier, the camera, pages, undo, persistence and the four model calls are orchestrated here. There is no seam. | **Very high** — one component, deep `useCallback` dependency chains, several tie-the-knot refs (`writeLiveRef`, `releasePendingReframeRef`, `reconcileSpeculativeRef`) |
| `Board.tsx:2471 writeLive` | Tier 1 ink | The product's core promise; documented invariant that nothing may precede it | **Critical** — any await added here is felt immediately |
| `Board.tsx:1524 framePage` | camera controller | Every visual event routes through it; owns hold/defer/replay | High — the deferred-reframe memory is subtle |
| `Board.tsx:4397 runBeat` | Tier 3 orchestration | Beat → Artist → Organizer → Director in one function | High |
| `Board.tsx:3479 applyAction` | action → elements | ~700 lines, every visual form the Artist can produce | High |
| `hooks/useDeepgram.ts` | speech transport | Token caching, per-socket epochs, reconnect ladder | High — the epoch logic fixed a broken latency meter once already |
| `lib/attention.ts` | production budgets | **The 60-second window is the single highest-leverage constant in the codebase** | Low to change, high impact |
| `lib/prompts.ts` | all five prompts | Where "draw generously" and the skip-escalation ladder live | Medium — behaviour changes are immediate and hard to A/B without the shadow logging |
| `lib/ops.ts` | pen, geometry, all Scribe visual forms | Single source of truth for placement and sizing | High |
| `lib/semantic.ts` | concepts, relationships, undo, prompt view | Identity and reversibility | High |
| `lib/organizer.ts` | reuse/adopt/create planner | The anti-duplicate layer; pure and testable | Medium |
| `lib/composition.ts` | pure camera math | Readability contract, safe frame, springs | Medium (pure, tested) |
| `lib/speculative.ts` | Tier 2 recognisers | The only retractable visual layer | Low — retractable by construction |
| `lib/director.ts` + `lib/directorState.ts` | deterministic structure recognition | The patience model worth generalising | Medium |
| `lib/math/*` | verified structured visuals | The architecture pattern to copy | Low (flagged) |
| `lib/vocab.ts` | keyterms + correction | Where the `Aline` case originates | **Low risk, measured high reward** |
| `lib/pagination.ts` | page-turn policy | Pure; already fixed the mid-sentence turn | Low |
| `lib/types.ts` | ~60 log event kinds | The diagnostic surface every experiment depends on | Low |
| `lib/features.ts` | flags | The established pattern for reversible experiments | Low |

---

# 28. Unknowns

Things I could not prove from the code alone:

1. **Actual current end-to-end latency.** All model timings are `[PRIOR]` from audits predating `SCRIBE_INTERVAL_MS` 5250→1200. Obtainable without code changes via `inpublic.latency()` / the auto-persisted sink.
2. **Whether `NEXT_PUBLIC_ENABLE_MATH_MODE` is true in production.** `.env.local` = true, `.env.example` = false. This decides whether charts and long multiplication can appear at all. **Needs a one-line answer from your deployment config.**
3. **Whether `framesRef` is truly always empty in production.** The code path says yes (dev-only `inpublic.draw()`), but a session log's `{type:"draw"}` events would confirm it in seconds.
4. **What the tester actually saw.** No session log or recording was available. The `{type:"beat"}`, `{type:"actions"}`, `{type:"composition"}` and `{type:"camera"}` events from *that* session would convert several "High" ranked risks above into confirmed or dismissed.
5. **Real-world Beat classification accuracy.** `beat-shadow` events are being logged right now and would answer "how often does the model draw when a local classifier would skip" from real data. **This is banked evidence nobody has read yet.**
6. **Frequency of Director comparison/process commits in real sessions.** The gates are strict; whether they ever fire in practice is unmeasured.
7. **Whether "Aline → airline" specifically reproduces with your voice.** `SPEECH-ACCURACY-AUDIT.md` §5 could only reproduce `Aline → "align"` with synthetic US-accented TTS. Same mechanism, same fix, different wrong word. Needs one human recording.
8. **How the live-line re-anchor actually reads on camera** when a Scribe mark lands mid-sentence. The code path is clear; the perceptual cost is not.
9. **Whether `NEXT_PUBLIC_SCRIBE` or `NEXT_PUBLIC_ENGINE` are overridden in production.** Assumed defaults (`on`, `deepgram`).
10. **Story Mode's behaviour under load.** Fully implemented, flag-off, untested against live speech recently.

---

# 29. Final Diagnosis

**Current pipeline:**
"InPublic currently turns speech into visuals by **lettering every interim transcript instantly with no model in the path, then running four independent producers over the same page — a local regex layer that draws retractable guesses from settled words, a streaming Haiku 'scribe' that letters nameable things, a Haiku classifier that decides when a moment deserves structure and hands it to a Sonnet 'artist' that returns edit-actions against a persistent semantic board, and a deterministic Director that reorganises boxes already on the page into comparisons and chains — with a pen, not a layout engine, deciding where everything lands, and a camera that follows the words as they are spoken.**"

**Primary weakness:**
"The most important weakness in that pipeline appears to be **that nothing owns how much should be happening at once. The attention budget that would govern it exists in `lib/attention.ts` but expires sixty seconds into every session, so four producers write to one sheet unthrottled while the camera moves on every partial transcript — and, compounding it, the only visual vocabulary available is text, boxes and arrows, so quantity, sequence, hierarchy and contrast all flatten into the same picture, and a thought committed early on a fragment can never be amended, only appended to.**"

**What should be preserved:**
"The strongest parts of the existing system that should probably remain untouched are **the Tier 1 instant-ink path and the direct browser↔Deepgram transport; the absolute rule that no model ever emits a coordinate; the Organizer's reuse/adopt/create planner and the semantic board's identity and one-step undo; the Director's patience model, which is the only component that already knows how to wait for certainty; the math lane's meaning→verify→deterministic-renderer contract, which is the pattern the rest of the system should copy rather than replace; and the logging and latency instrumentation, which means the next decision can be made from data you are already collecting.**"

**First thing worth testing:**
"Before any major rewrite, the highest-value experiment is **a single reversible `quietMode` flag that makes the existing attention budget session-long instead of sixty seconds and stops the camera following interim transcripts — then recording the same talk twice and comparing the two session logs, which already contain every event needed to judge it. That one flag answers whether the problem is volume and movement or interpretation and expressive range, and those two answers lead to completely different projects.**"

---

*Audit performed by reading the running implementation. No files under `app/`, `components/`, `hooks/`, or `lib/` were modified.*
