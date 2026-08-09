# inpublic — behavior and architecture audit (second pass)

**Date:** 2026-08-07
**Scope:** trace the system from microphone to canvas; verify every claim in
[AUDIT.md](AUDIT.md) against the current code; run scripted behavioral tests.
**No code was changed during this audit.**

## Provenance of evidence

Two kinds of evidence appear below and are never mixed:

- **[CODE]** — read from source. Not executed.
- **[RUN]** — observed from a probe I actually executed this session, against
  the dev server on :3210, or measured from a real session log.

**Not tested:** anything requiring a human voice. I cannot speak into a
microphone. `getUserMedia`, `MediaRecorder`, the Deepgram socket, and the real
end-to-end recording flow are **[CODE]** only. Production latency figures come
from the 23:42 session log, which was recorded by a human.

**Verification of the previous audit:** every source file's mtime is 19:53 or
earlier; [AUDIT.md](AUDIT.md) was written at 22:06. **No source file has
changed since the previous audit.** Its findings were re-verified rather than
re-discovered, and where this pass contradicts it, that is called out
explicitly (§H).

---

## The central question, up front

> **Is inpublic (A) a real-time visual reasoning system, (B) a speech-to-text
> canvas, (C) a transcription tool with an AI diagram layer, or (D) something
> else?**

**C, with an unusually good B underneath it.**

The sharpest way to state what I found:

> **The AI understands relationships in language. It cannot express them on the
> canvas.**

Both halves are demonstrated. Given *"ClickLabs watches a video and creates a
thumbnail"*, the artist produced `A[Video Input] --> B[ClickLabs] --> C[Thumbnail
Output]` — correct comprehension of an input/process/output relation **[RUN]**.
But given *"Connect the uploaded video to the analyzer"* — an explicit
instruction to relate two things already on the board — it produced a **brand
new three-node flowchart** rather than an arrow between the existing elements
**[RUN]**. And across every test in this audit, **zero arrows were created on
the canvas** **[RUN]**.

The `link` operation exists in the vocabulary. In 27 marks from the 23:42
production session and in 9 scripted utterances here, it was emitted **zero
times**.

---

## A. Current system in one paragraph

inpublic is three independent writers sharing one Excalidraw surface. A
**zero-AI live line** renders Deepgram's interim transcript as hand-lettered
text at 234–384ms **[RUN, production]**; a **Scribe** (Haiku, ~0.7–2.4s) picks
nouns out of finalized speech and letters them as isolated marks; and a
**beat→artist chain** (Haiku ~0.9s → Sonnet ~1.6s) occasionally emits a
standalone Mermaid flowchart placed below the notes. None of the three can see
what the others drew: the artist receives frame *labels* only and has no access
to the lettered words, so it regenerates concepts already on the page instead
of building on them. Elements land in a flat append-only array with no semantic
index; arrows are unbound geometry; nothing persists across a refresh; nothing
can be exported.

---

## B. End-to-end architecture

```
  microphone
     │  getUserMedia({audio:true})                        [CODE] useDeepgram.ts:94
     ▼
  MediaRecorder, 100ms timeslice                          [CODE] useDeepgram.ts:133
     │  webm/opus blobs -> connection.send()
     ▼
  Deepgram nova-3 WebSocket                               [CODE] useDeepgram.ts:102
     │  interim_results:true, endpointing:150, utterance_end_ms:1000
     │  credential from GET /api/deepgram/token (60s TTL)  [RUN] 200, 1480ms
     │
     ├── is_final=false ──► onInterim(text, audioEndMs)
     │                        │
     │                        ├──► setInterim() ──► <TranscriptStrip>  (hidden by default)
     │                        │
     │                        └──► writeLive(text, false, audioEndMs)   ◄── THE FAST PATH
     │                               │   NO MODEL. NO NETWORK. NO THROTTLE.
     │                               ▼
     │                             buildLiveLine() -> convertToExcalidrawElements
     │                               │  grey #495057, Excalifont, wrapped
     │                               ▼
     │                             elementsRef.current  ──► commit() ──► updateScene()
     │                                                                     [RUN] 0–2ms
     │
     └── is_final=true ───► onFinal(text, tStart, tEnd, audioEndMs)
                              │
                              ├──► writeLive(text, true, ...)   locks line to ink #1e1e1e
                              ├──► log({type:"live", lagP50, lagMax, renderP50})
                              ├──► nudgeScribe()      throttle 700ms
                              │      └─► POST /api/scribe  [Haiku, streaming]
                              │            └─► parseLine() -> applyOp() -> elementsRef
                              │                [RUN] first byte 574ms, full 736ms
                              └──► resetSilenceTimer()  600ms
                                     └─► runBeat()
                                           ├─► POST /api/beat   [Haiku]  [RUN] p50 913ms
                                           │     -> {action, reason, focus}
                                           └─► if draw: POST /api/artist [Sonnet]
                                                 [RUN] p50 1580ms  -> mermaid
                                                 └─► buildBeat() -> frame + children
                                                       └─► renderBeat() staggered fade
                                                             [RUN, prod] 2419ms decision→pixel

  persistence: NONE          export: NONE (disabled in UIOptions)   recording: NONE
```

**The alternate engine.** `NEXT_PUBLIC_ENGINE=gemini` swaps the top half for a
single Gemini Live socket (`hooks/useGeminiLive.ts`). It is **not** the default
(`.env.local` sets `deepgram`) and cannot be live by construction: its `draw()`
tool calls only arrive at end-of-turn. Confirmed in the 22:54 log, where the
draw event and the turn-end event share a timestamp to within 17ms and turns
were 16–20s apart.

---

## C. Live speech behavior

### C-1. Audio capture **[CODE]**

`getUserMedia({ audio: true })` — no channel/sample-rate constraints on the
Deepgram path (the Gemini path constrains to 16kHz mono). A `MediaRecorder`
with `recorder.start(100)` emits webm/opus blobs every 100ms straight into the
socket. **That 100ms is a hard floor under every latency number in this
document.** A `keepAlive()` fires every 8s because Deepgram drops idle sockets
at ~10s.

### C-2. Interim handling **[CODE + RUN]**

Deepgram sends a partial roughly every 100–300ms carrying the **whole utterance
so far**, not a delta. `handleInterim` does three things: updates the
(hidden) strip, calls `writeLive(text, false, audioEndMs)`, and accumulates
"settled" words for the Scribe.

**Settled-word tracking** (`Board.tsx` `handleInterim`) compares consecutive
interims and treats a word as settled once two agree. It feeds
`scribePendingRef` but — since this session's change — **no longer wakes the
Scribe**. That was deliberate: a Scribe mark placed while the line is still
growing lands through it.

### C-3. Rebuild, not patch **[RUN]**

The live line is **rebuilt from scratch on every interim**, not patched.
`buildLiveLine` calls `convertToExcalidrawElements` fresh each time; the
previous element ids are filtered out of `elementsRef` and the new ones
appended.

**Consequence, measured:** `liveLineIdStableAcrossInterims: false` **[RUN]**.
The element id changes ~5×/second while you speak.

**Why it was built this way** (defensible): Excalidraw measures text against
the real font at creation time, so rebuilding gets correct metrics for free.
The cost is identity.

### C-4. How often the canvas changes **[CODE + RUN]**

Every interim triggers `commit()` → `updateScene({ elements })` with the **full
element array**. At ~5 interims/second that is 5 full-scene updates per second.
Measured cost: `renderP50` **0–2ms** **[RUN, production]** — so this is not
currently a problem, but it is O(n) in board size and untested past ~100
elements.

### C-5. Interim vs final **[CODE + RUN]**

| | interim | final |
| --- | --- | --- |
| Colour | grey `#495057` | ink `#1e1e1e` |
| Pen row | reserved, re-reserved each partial | reserved permanently |
| `liveRef` | holds `{ids, base, after}` | cleared to `null` |
| Ids | new every partial | stable once settled |
| Downstream | nothing | Scribe + beat timer + `live` log event |

**The `after` snapshot is this session's overlap fix.** `writeLive` rewinds the
pen to `base` so the line can regrow in place; if `penRef` no longer matches
`after`, something else drew (Scribe or wrap-up) and the line **re-anchors**
below rather than rewinding over the new mark. **[CODE]** — the underlying bug
was reproduced from a user screenshot and the log, but **the fix has not been
verified with a real voice.**

---

## D. AI decision pipeline

### D-0. Layer separation

| Layer | Is it AI? | What it actually does |
| --- | --- | --- |
| Speech recognition | Deepgram nova-3 | audio → words |
| Transcription | — | there is no separate step; Deepgram's output *is* the transcript |
| **Live line** | **no model at all** | renders the transcript as text |
| Scribe | Haiku | picks nouns, assigns a mark *kind* |
| Beat | Haiku | decides *whether* to make a diagram |
| Artist | Sonnet | writes Mermaid |
| Canvas execution | deterministic code | `parseLine` → `applyOp` → pen → Excalidraw |

### D-1. The live line — **no AI**

| | |
| --- | --- |
| **Input** | interim transcript string + `audioEndMs` |
| **Output** | one Excalidraw text element |
| **Prompt** | none — there is no model |
| **Trigger** | every interim, unconditional |
| **Latency** | **0–2ms** our share; 234–384ms total **[RUN, production]** |
| **During or after speech** | **during** |
| **Understands meaning?** | **no** — it is verbatim rendering |
| **Sees canvas state?** | only the pen position |
| **Can modify existing elements?** | only its own, and only within one utterance |

### D-2. The Scribe — Haiku

| | |
| --- | --- |
| **Input** | `{fresh, context (last 40 words), onPage (last 24 marks)}` |
| **Output** | newline-delimited ops, streamed |
| **Prompt** | `SCRIBE_SYSTEM`, `lib/prompts.ts:1` |
| **Trigger** | `nudgeScribe()` from `handleFinal` only; throttle `SCRIBE_INTERVAL_MS` 700ms |
| **Latency** | first byte **574ms**, full **736ms** server-side **[RUN]**; 681–2354ms observed end-to-end in the browser **[RUN]** |
| **During or after speech** | **after** each finalized utterance |
| **Understands meaning?** | **partially** — it genuinely chooses between title/heading/word/box/note/bullet and picks icons. That is real classification. |
| **Sees canvas state?** | **a truncated list of its own marks** (`onPage`, last 24). It cannot see the live line, the diagrams, or positions. |
| **Can modify existing elements?** | `link` and `underline` reference prior marks by text. **`underline` was used once in 27 production marks; `link` zero times.** **[RUN]** |

### D-3. The beat — Haiku

| | |
| --- | --- |
| **Input** | `{pendingText (120 words), sceneSummary (frames), lastDrawnAt, liveConcepts (20), skipStreak}` |
| **Output** | `{action: draw\|skip\|undo\|clear, reason, focus}` |
| **Prompt** | `BEAT_SYSTEM`, `lib/prompts.ts:102` |
| **Trigger** | 600ms silence (`SILENCE_MS`) with >4 pending words |
| **Latency** | p50 **913ms**, max 2030ms **[RUN]** |
| **During or after speech** | **after** — at a pause |
| **Understands meaning?** | **yes, and well.** It correctly distinguishes topic-announcement from content, and recognises retraction and reset. |
| **Sees canvas state?** | frame labels + a 20-item word list. **No positions, no geometry, no element ids.** |
| **Can modify existing elements?** | only via `undo`/`clear`, which are page-level, not element-level |

### D-4. The artist — Sonnet

| | |
| --- | --- |
| **Input** | `{focus, transcript (90s), sceneSummary (frame labels)}` |
| **Output** | one Mermaid string, or `NONE` |
| **Prompt** | `ARTIST_SYSTEM`, `lib/prompts.ts:125` |
| **Trigger** | only when the beat returns `draw` |
| **Latency** | p50 **1580ms**, max 3147ms **[RUN]** |
| **During or after speech** | **after** |
| **Understands meaning?** | **yes** — see test B |
| **Sees canvas state?** | **frame labels only. It has no access to `liveConcepts`.** `ArtistRequest` (`lib/types.ts:58`) has no field for them. |
| **Can modify existing elements?** | **no.** It emits a fresh graph every time. |

**This is the architectural heart of the problem.** The one model powerful
enough to reason about structure is the one told least about what is on the
board.

### D-5. Canvas execution — deterministic

`parseLine` (`lib/ops.ts:151`) regex-matches one op per line and **silently
drops** anything unrecognised. `isFragment` rejects danglers. `applyOp`
(`Board.tsx`) dedupes, measures, turns the page on overflow, builds, appends,
commits. No model is involved and no coordinate ever comes from a model.

---

## E. Canvas state model

### E-1. Storage **[CODE]**

| Ref | Holds |
| --- | --- |
| `elementsRef` | **flat append-only array of every element.** The source of truth. |
| `marksRef` | `Map<markKey, {x,y,w,h}>` — **page-local**, reset on `turnPage` |
| `renderedMarkKeysRef` | session-wide dedupe set |
| `framesRef` | `{id, label, nodes}` per diagram |
| `sketchRef.ids` | every element id since the last `clearSketch` |
| `penRef` | `{originX, originY, x, y, lineH}` |
| `liveRef` | `{ids, base, after}` for the sentence in progress |

There is **no id → concept map**. Nothing can answer "what is on the board
about ClickLabs?" That single absence explains most of §K.

### E-2. Identity **[RUN]**

Ids come from `convertToExcalidrawElements`. Scribe marks and diagram children
get stable ids. **The live line does not** (§C-3).

### E-3. Positioning **[CODE + RUN]**

A single pen flows left-to-right and wraps (`place`, `lineStart`,
`willOverflow`). Full-width ops (title, heading, live line, diagram frame) take
their own row. **No model ever emits a coordinate** — verified: `Op` has no
x/y field.

Verified spacing **[RUN]**: sentence 1 at y=0 h=33 → sentence 2 at y=79
(33 + `GAP_Y` 46). A 3-line block at y=157 h=98 → box at y=301.

### E-4. Arrows are visual, not semantic **[RUN]**

```
arrowExists: true
startBinding: null
endBinding: null
```

`buildOp` case `"link"` computes endpoints from cached `Mark` coordinates and
emits a bare `arrow` with a points array. **Nothing binds it to the elements it
appears to connect.** Move a box and the arrow stays. Excalidraw has no
knowledge of the relationship.

**Relationships in this system are pixels, not data.**

### E-5. Undo, clear, edit, move, zoom, reorganize

| Operation | Status | Evidence |
| --- | --- | --- |
| **undo** | **destroys the whole page** | **[RUN]** 11 elements → **0** |
| clear | dims to 20% + turns page; never deletes | **[RUN]** `clearDeletes: 0` |
| edit | **[CODE]** `onChange={() => {}}`; `commit()` pushes the app array as the whole scene, so a user drag has no path back in | not reproduced with a real pointer |
| move | no op exists | **[CODE]** `Op` union |
| zoom | `framePage()` fits the sheet; no user or voice control | **[CODE]** |
| reorganize | **does not exist** | **[CODE]** |

### E-6. One document or several drawings?

**Several.** Pages are a monotonic counter (`pageRef`) with no way back.
Diagrams are frames with no relation to the marks they summarise. The live line
is a third population. There is no object representing "the presentation".

---

## F. Decision paths, with real examples

### Title
`SCRIBE_SYSTEM` → `title "X"` → `parseLine` → `isFragment` → `applyOp` →
`buildOp` full-width at 52px + orange swoosh.
**[RUN]** *"Today I am building ClickLabs."* → `title "ClickLabs"` → rendered
`CLICKLABS` (uppercased) + underline line.

### A normal sentence
Never reaches a model. `handleInterim` → `writeLive` → one text element.
**[RUN]** *"The user uploads a video, ClickLabs analyzes it, and the result is
a thumbnail."* → one grey→ink text element, 1ms.

### A keyword
**[RUN]** *"ClickLabs watches a video and creates a thumbnail."* → Scribe emits
`word "watches a video"`, `word "creates a thumbnail"` → two text elements at
26px.

### A box
`box "X"` → rectangle + bound label, min width 170, height 70.
**[RUN]** `box "Beta"` was **rejected** — `isFragment` kills lone words under 5
characters. `box "Beta Service"` succeeded.

### An arrow
`link "A" -> "B"` requires **both** marks in `marksRef` (page-local) and
`measureOp` additionally refuses if they are >170px apart vertically and not on
the same row.
**[RUN]** Emitted zero times by the Scribe across all tests. Forced manually,
it renders unbound (§E-4).

### A group
**No grouping operation exists.** The diagram `frame` is the only container,
and only the artist can create one.

### A new section
**[RUN]** — the sharpest finding in this section:

| Utterance | Beat action |
| --- | --- |
| `"Now let's move on to Affiliate Capital."` | **skip** — *"Topic announced, no content yet"* |
| `"Moving on to Affiliate Capital."` | **skip** |
| `"Now let us move on to the next part."` | **skip** |
| `"New section: Affiliate Capital."` | **clear** ✓ |
| `"Let's move on."` | **clear** ✓ |

`BEAT_SYSTEM` lists *"moving on to"* as an explicit `clear` trigger. **Naming
the new topic causes it to be reclassified as a topic announcement and
skipped.** The bare phrase works; the natural phrasing does not.

### A diagram
600ms silence → beat → artist → `buildBeat` (Mermaid → Excalidraw) →
`waitForIdleHands` (up to 4000ms) → wait for live line to settle (up to 1500ms)
→ `place()` → staggered fade.
**[RUN]** *"ClickLabs watches a video and creates a thumbnail."* →
`flowchart LR A[Video Input] --> B[ClickLabs] --> C[Thumbnail Output]`. **This
is genuinely good comprehension.**

### A correction
**[RUN]** *"Scratch that."* → beat returns `undo` with reason *"Speaker
retracted last statement"* — recognition is reliable (6/6 phrasings). Execution
then wipes the entire page (§E-5).

### A canvas command
**[RUN]** All four fail, and the beat says why:

| Utterance | Action | Reason given |
| --- | --- | --- |
| `"Put a box around ClickLabs."` | skip | *"Instruction about layout, not content"* |
| `"Zoom in on the AI agent."` | skip | *"Topic announced, no new content yet"* |
| `"Connect the uploaded video to the analyzer."` | **draw** | produced a **new** flowchart, not an arrow |
| `"Make that bigger."` | skip | *"instruction only"* |

The beat **correctly identifies** these as layout instructions and has no
action available for them. `BeatAction` is `draw | skip | undo | clear`.

---

## G. Recording and export behavior

**[CODE + RUN]** — three separate absences:

1. **No recording.** README states it plainly: *"The app records nothing."*
   Accurate. OBS is expected to capture the window.
2. **No export.** `UIOptions.canvasActions` sets `export: false`,
   `saveToActiveFile: false`, `loadScene: false`. Excalidraw's own export is
   **deliberately disabled**. The only output is `downloadLog()` — a JSON
   debug dump of transcript and decisions.
3. **No persistence.** **[RUN]** no `localStorage`, `sessionStorage`,
   IndexedDB, or server storage anywhere in app code. A refresh loses
   everything.

The `ControlBar` has exactly two buttons: **Mic** and **Log**. There is no
pause, no save, no export, no undo button.

---

## H. What changed since the previous audit

**No source file changed.** All mtimes predate [AUDIT.md](AUDIT.md). The table
below therefore compares **pre-live-line behavior** (22:54 session, Gemini
engine) against **current**, which is the comparison that carries information.

| Area | Previous behavior | Current behavior | Improved? | Evidence |
|---|---|---|---|---|
| **Live speech latency** | 5.5s (Deepgram+Haiku) / 17s (Gemini turn-locked) | **234–384ms**, our share 0–2ms | **Yes, ~20–45×** | [RUN, prod] 23:42 `live` events |
| **Beat detection** | 21 skip / 7 draw; 9 "restating" on new material | 15 skip / 13 draw on the same transcript | **Yes** | [RUN] replay-beat.mjs, 6 flips, all skip→draw |
| **Scribe behavior** | fired mid-utterance; drew through the live line | finals only; runs behind the writing | **Yes** | [CODE] `nudgeScribe` removed from `handleInterim` |
| **Artist behavior** | fresh Mermaid, no canvas knowledge | **unchanged** | **No** | [CODE] `ArtistRequest` still lacks `liveConcepts` |
| **Canvas awareness** | frame labels only | **unchanged** | **No** | [RUN] test G drew new nodes for existing concepts |
| **Element identity** | stable for marks | marks stable, **live line unstable** | **Regression** | [RUN] `liveLineIdStableAcrossInterims: false` |
| **Arrow bindings** | unbound | **unchanged, unbound** | **No** | [RUN] `startBinding: null` |
| **Voice commands** | undo/clear recognised | **unchanged**; undo still wipes page | **No** | [RUN] 6/6 recognised; 11→0 elements |
| **Topic changes** | none | **none**; pages turn on geometry only | **No** | [RUN] "move on to X" → skip |
| **Layout** | diagrams overlapped words | re-anchor + settle wait added | **Probably** — **unverified live** | [CODE] `liveRef.after`; needs a take |
| **Persistence** | none | **none** | **No** | [RUN] no storage APIs |
| **Recording** | none | **none** | **No** | [CODE] README confirms |
| **Export** | disabled | **disabled** | **No** | [CODE] `UIOptions` |
| **Reconnect** | Gemini yes, Deepgram no | **unchanged** | **No** | [CODE] `useDeepgram.ts:162` calls `stop()` |
| **Instrumentation** | none for the live path | `live` events with lag/render percentiles | **Yes** | [RUN] 40 events in 23:42 |

---

## I. Verified strengths

1. **Sub-400ms speech-to-canvas, with our code contributing 0–2ms.** **[RUN,
   production]** Genuinely better than most commercial tools.
2. **Race-safe live line.** **[RUN]** 14 un-awaited interims at 25ms intervals →
   one element, zero strays, `elementGrowth: 1`.
3. **The beat and artist do comprehend language.** **[RUN]** Test B produced a
   correct input→process→output chain unprompted.
4. **Voice command recognition is reliable.** **[RUN]** 6/6 undo phrasings.
5. **Credential handling is correct.** **[RUN]** Ephemeral tokens, 60s TTL, no
   key in any client bundle.
6. **Layout arithmetic is sound in isolation.** **[RUN]** Exact `GAP_Y` spacing
   verified at three positions.
7. **Failure modes degrade rather than break.** **[CODE]** Scribe failure →
   local extractor; artist failure → `NONE`; unparseable op → dropped line.

## J. Verified weaknesses

1. **Undo destroys the page.** **[RUN]** 11 → 0. Highest-severity bug in the
   system.
2. **The artist cannot see the words on the canvas.** **[RUN]** Test G.
3. **Zero arrows ever created.** **[RUN]** Across 9 utterances and 27
   production marks.
4. **Live line ids are unstable.** **[RUN]**
5. **Arrows unbound when forced.** **[RUN]**
6. **Natural section-change phrasing is skipped.** **[RUN]**
7. **Intermittent beat `parse failure`.** **[RUN]** Observed 1/9 in the first
   scripted run and once in the 22:54 log; **not reproducible** — 5/5 identical
   retries returned clean `skip`. Rare and non-deterministic. `maxTokens: 300`
   truncation is the most likely cause (the route already carries a comment
   about this at 150). A skip is the failure mode, so it is silent.
8. **Multi-node structure collapses to one label.** **[RUN]** *"This is the
   problem, this is the solution, and this is the result"* → Scribe emitted a
   single `heading "Problem, Solution, Result"`.
9. **Little compositional variety.** **[RUN]** 4 artist outputs: 3× `flowchart
   LR`, 1× `flowchart TD`. Never a sequence, comparison, or hierarchy diagram.

## K. Missing capabilities

Persistence · export · recording · pause/resume · topic detection · canvas
reorganisation · element-level undo · grouping · spatial commands (move, zoom,
resize) · style selection · whole-presentation context · Deepgram reconnect ·
request cancellation · retry · rate-limit handling · auth/tenancy · BYOK · any
test suite at all.

## L. Highest-risk bugs

| # | Bug | Severity | Evidence |
|---|---|---|---|
| 1 | Undo wipes the whole page | **Critical** | **[RUN]** 11→0 |
| 2 | No persistence — refresh loses everything | **Critical** | **[RUN]** |
| 3 | Exposed API keys in `.env.local` (printed to a transcript) | **Critical** | **[CODE]** — rotate |
| 4 | `commit()` reverts user edits | **Critical** | **[CODE]**, not reproduced |
| 5 | Deepgram close ends the session silently | **High** | **[CODE]** |
| 6 | Live line ids unstable | **High** | **[RUN]** |
| 7 | Arrows unbound | **High** | **[RUN]** |
| 8 | Overlap fix unverified with a real voice | **High** | **[CODE]** |
| 9 | Intermittent beat parse failure → silent skip | **Medium** | **[RUN]** |
| 10 | Session clock never resets on restart | **Medium** | **[CODE]** |

## M. Recommended next implementation phase

Do **not** rewrite. The live path is excellent and the layering is sound; what
is missing is one layer that does not exist yet.

**Phase 0 — hours**
1. Rotate the three keys.
2. Undo pops one thought — keep a stack of id-groups per settled utterance and
   per frame, instead of using `sketchRef.ids`.
3. Reset `t0Ref` on restart.
4. **Record one real take** to verify the overlap fix. Everything else is
   guesswork until this happens.

**Phase 1 — don't lose the work (1–2 days)**
5. Autosave `elementsRef` to IndexedDB; restore on mount.
6. Re-enable Excalidraw export.
7. Deepgram reconnect, ported from `useGeminiLive.ts:276`.

**Phase 2 — the one change that matters most (~1 week)**

**Give the artist the canvas, and let it emit ops instead of Mermaid.**

Concretely: add `liveConcepts` to `ArtistRequest`; change `ARTIST_SYSTEM` to
emit the existing op vocabulary (`link`, `underline`, `box`) referencing marks
already on the page, rather than a fresh Mermaid graph; bind arrows to real
element ids in `buildOp`.

This single change addresses weaknesses 2, 3, 5 and 9 together, and turns the
board from three parallel populations into one document. It is the "Organizer"
already named in [PLAN.md](PLAN.md), and everything else in §K is easier
afterwards.

**Phase 3** — semantic index (`id → concept`), topic detection, element-level
editing, then the test suite from AUDIT.md §L.

---

## The central question, answered again

**inpublic is a transcription tool with an AI diagram layer attached (C).**

It is a *very good* transcription tool — 234–384ms, with 0–2ms attributable to
this codebase — and the diagram layer contains real comprehension, which test B
proves. But the two never meet.

The precise boundary, restated:

> **The AI understands relationships in language. It cannot express them on the
> canvas.**

Asked to relate two things already drawn, it drew a third picture. Asked to put
a box around something, it recognised the request and had no action for it.
Across every test in this audit, **not one arrow was drawn between two things
the user named.**

Nothing here is a research problem. The reasoning already works; it is pointed
at the transcript instead of at the board. Turning it around is the next phase.
