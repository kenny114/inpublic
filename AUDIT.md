# inpublic — technical audit

**Date:** 2026-08-07
**Commit state:** working tree, post live-line and beat-escalation work
**Method:** full source read, running dev server on :3210, live probes against
every API route, console-driven canvas tests, and replay of three real session
logs (22:54, 23:26, 23:42).

**Not tested:** anything requiring a human voice into a real microphone. I
cannot speak. Every claim below is either code-derived (marked *code*) or came
from a probe I actually ran (marked *tested*), and the two are never conflated.

---

## A. Executive summary

### The question, answered honestly

> *Does inpublic understand what the user is saying and creatively turn it into
> a coherent visual diagram in real time — or is it mainly transcribing speech
> and placing text on the canvas?*

**It is mainly transcribing speech and placing text on the canvas.**

That is not a dismissal — the transcription-to-canvas path is genuinely
excellent and measured at **234–384ms**, which is better than most commercial
tools. But it must be named accurately:

- **The real-time layer contains no AI at all.** `writeLive`
  ([components/Board.tsx](components/Board.tsx)) takes Deepgram's interim
  stream and renders the words. There is no model, no understanding, no
  intent. It is a very fast, very good teleprompter running backwards.
- **The AI layer is not real-time.** The Scribe is 574–736ms server-side plus
  up to 700ms of client throttle. The beat+artist chain measured **~2.5s**, and
  in a real session took **2419ms** from decision to rendered diagram.
- **The AI layer does not produce a coherent evolving diagram.** It produces
  (a) loose lettered words with no relationships, and (b) occasional standalone
  Mermaid flowcharts that are generated fresh, know nothing about the words
  already on the page, and are never revisited or refined.

There is no single artifact on the canvas that represents the user's idea. There
is a transcript rendered in a handwriting font, some words the model liked, and
a few disconnected flowcharts. **Three separate systems draw onto one surface
without any of them owning the result.**

### What it feels like

Of the four options offered: **a voice transcription tool with an experimental
diagram generator attached.** It is well past "unfinished prototype" — the
engineering quality is high, the comments are honest, the instrumentation is
real. But it is not yet a live visual reasoning tool, because nothing in the
system reasons about the visual.

### The three findings that matter most

1. **Undo destroys the entire page** (§E-1). *Tested:* 7 elements → 0.
2. **Nothing persists.** No storage, no export, no recording (§D-1, §D-2). A
   browser refresh loses the whole session. For a presentation tool this is
   disqualifying.
3. **The canvas has no semantic model** (§I-1). Elements are appended to a flat
   array. Nothing knows that "Airline" the lettered word and "Airline" the
   flowchart node are the same thing, so nothing can ever reorganise or refine.

---

## B. What currently works

### B-1. The live line — mic to ink in under 400ms *(tested, and measured in production)*

| File | `components/Board.tsx` `writeLive`, `lib/ops.ts` `buildLiveLine` |
| --- | --- |
| **Behavior** | Deepgram interims render directly to canvas, rebuilt in place per partial. Grey while revisable, ink on final. |
| **Evidence** | 23:42 session, 40 `live` events: `lagP50` 234–384ms, `renderP50` 0–2ms. Race-tested at 25ms interim intervals — one element, zero strays. |
| **Severity** | — (this is the strong part) |

Our share of the latency is **0–2ms**. All remaining lag is Deepgram
round-trip. This cannot be meaningfully improved without changing ASR provider.

### B-2. Server-side key handling *(tested)*

| File | `app/api/deepgram/token/route.ts`, `app/api/gemini/token/route.ts` |
| --- | --- |
| **Behavior** | Root keys never leave the server. Browser gets a 60s Deepgram bearer token or a scoped Gemini auth token. |
| **Evidence** | Both routes probed: 200, returning `eyJ...` / `auth_tokens/...`. No key appears in any `NEXT_PUBLIC_*` var. |
| **Severity** | — |

### B-3. Voice command *recognition* for undo and clear *(tested)*

| File | `lib/prompts.ts` `BEAT_SYSTEM` |
| --- | --- |
| **Behavior** | With a diagram on the board, 6/6 retraction phrasings correctly returned `undo`. 3/4 reset phrasings returned `clear`. |
| **Evidence** | `"scratch that"`, `"no wait, forget that"`, `"delete that"`, `"that is wrong"`, `"undo that"`, `"remove the last diagram"` → all `undo`. |
| **Severity** | — (recognition is fine; **execution is broken**, see §E-1) |

An earlier probe with an *empty* board returned `skip` for all of these. That
is correct behavior, not a bug.

### B-4. Fragment filtering *(tested)*

`lib/ops.ts` `isFragment` correctly rejected `box "Beta"` (lone 4-char word)
during testing. The 32/32 corpus result claimed in PLAN.md is consistent with
what I observed.

### B-5. Streaming Scribe with progressive render *(code + tested)*

`app/api/scribe/route.ts` streams line-by-line; the client renders each op as
its newline arrives. First byte p50 **574ms**, full stream **736ms**.

### B-6. Page/pen layout and camera stability *(tested)*

`lib/ops.ts` `place`/`willOverflow`/`lineStart`. Verified: second sentence
lands at y=79 under a 33px-tall first; a 3-line wrapped block at y=157 is
followed by a box at y=301 — exactly `GAP_Y` below. No overlap in isolation.

### B-7. Beat over-skipping, after this session's fix *(tested by replay)*

21 skip / 7 draw → 15 skip / 13 draw on the real 23:42 transcript, six flips,
all skip→draw. See PLAN.md.

---

## C. What is partially working

### C-1. The beat→artist wrap-up is slow and disconnected — **HIGH**

| File | `components/Board.tsx` `runBeat`/`renderBeat`, `app/api/artist/route.ts` |
| --- | --- |
| **Current** | Beat p50 **913ms** → artist p50 **1580ms** → render with stagger. Real session: decision t=125644, rendered t=128063 = **2419ms**. The artist receives only `focus` + raw transcript + frame labels. It has **no knowledge of the lettered words on the page**. |
| **Expected** | Structure drawn *around* what is already on the canvas, within ~1s. |
| **Evidence** | `ArtistRequest` (`lib/types.ts`) has no field for live marks. `sceneSummary` carries only previous *frames*. |
| **Severity** | High |
| **Fix** | Pass `liveConcepts` to the artist, and have it emit ops that reference existing marks (`link`, `underline`, container) rather than a fresh Mermaid graph. This is the "Organizer" already named in PLAN.md. |

### C-2. Element IDs are unstable for the live line — **HIGH**

| File | `lib/ops.ts` `buildLiveLine` |
| --- | --- |
| **Current** | `convertToExcalidrawElements` mints a new id on every interim. *Tested:* `liveLineIdStableAcrossInterims: false`. |
| **Expected** | Stable identity for the duration of an utterance. |
| **Impact** | Any user selection, edit, or drag of the sentence being spoken is destroyed by the next partial ~200ms later. Also makes the element ineligible as an arrow target. |
| **Severity** | High |
| **Fix** | Pass a stable `id` into the skeleton (Excalidraw's `_newElementBase` honours `rest.id`), or patch `text`/`width`/`height` on the existing element instead of rebuilding. |

### C-3. Arrows are free-floating geometry, not bindings — **HIGH**

| File | `lib/ops.ts` `buildOp` case `"link"` |
| --- | --- |
| **Current** | *Tested:* arrow rendered with `startBinding: null`, `endBinding: null`. Endpoints are computed from cached `Mark` coordinates. |
| **Expected** | `startBinding`/`endBinding` referencing real element ids, so arrows follow their nodes. |
| **Impact** | Move a box, the arrow stays behind. Excalidraw cannot maintain the relationship. The connection is visual only — it carries no data. |
| **Severity** | High |
| **Fix** | Emit `start: { id }` / `end: { id }` in the skeleton so `convertToExcalidrawElements` creates real bindings. |

### C-4. Deepgram has no reconnect — **HIGH**

| File | `hooks/useDeepgram.ts:162` |
| --- | --- |
| **Current** | `connection.on(Close, () => { if (startedRef.current) stop(); })`. A dropped socket **ends the session silently**. Status goes `idle`; nothing tells the user. |
| **Expected** | Reconnect with backoff, as `useGeminiLive` already does (`reconnectRef`, `sessionResumption`). |
| **Evidence** | *Code.* The Gemini path has a full reconnect implementation; the default engine has none. |
| **Severity** | High — this is the default engine, mid-recording, with no warning. |
| **Fix** | Port the reconnect pattern from `useGeminiLive.ts:276`. |

### C-5. The Scribe understands *kind* but not *structure* — **MEDIUM**

The Scribe does make real judgements: title vs heading vs word vs box, icon
selection, generosity vs scaffolding. That is genuine language understanding.
But its vocabulary is almost entirely **nouns in isolation**. Of 27 marks in
the 23:42 session, **zero** were `link` and one was `underline`. It letters;
it does not relate.

### C-6. `clear` dims rather than deletes — **LOW, by design**

*Tested:* `clearDeletes: 0`. Old pages stay at 20% opacity so the user can pan
back. Intentional and documented. But combined with §D-1 (no persistence) and
the absence of any pan control, the dimmed content is unreachable in practice.

---

## D. What is missing

### D-1. No persistence of any kind — **CRITICAL**

| File | none — nothing exists |
| --- | --- |
| **Current** | *Tested:* no `localStorage`, `sessionStorage`, IndexedDB, or server persistence anywhere in app code. `elementsRef` is React state in memory. |
| **Expected** | The canvas survives a refresh, a crash, a closed tab. |
| **Impact** | A 30-minute take is lost by an accidental Cmd-R. |
| **Severity** | Critical |
| **Fix** | Autosave `elementsRef` + log to IndexedDB on a debounced timer; restore on mount. |

### D-2. No recording and no export — **CRITICAL for the stated product**

| File | `components/Board.tsx` `UIOptions`, `components/ControlBar.tsx` |
| --- | --- |
| **Current** | `canvasActions: { export: false, saveToActiveFile: false, loadScene: false }` — export is **deliberately disabled**. ControlBar has exactly two buttons: Mic and Log (a JSON debug dump). There is no video recording, no image export, no `.excalidraw` save. |
| **Expected** | The product is described as a tool for producing build-in-public content. The artifact has to leave the machine. |
| **Impact** | The user must screen-record externally and can never recover the board afterwards. |
| **Severity** | Critical |
| **Fix** | Re-enable Excalidraw's PNG/SVG export at minimum; add `exportToBlob` on a keystroke. Video capture is a larger piece. |

### D-3. No pause / resume — **HIGH**

*Tested:* `toggle()` calls `stop()`, which tears down the recorder, stops all
media tracks, and closes the socket. Restarting mints a new token and a new
`getUserMedia` prompt path. There is no pause. The session clock `t0Ref` is
never reset, so a stop/start mid-session produces a misleading log timeline.

### D-4. No spatial or canvas commands — **HIGH**

*Tested* against the live beat: `"move this over to the left"`, `"zoom in on
that"`, `"make that bigger"`, `"put a box around that"` — **all four returned
`skip`**, with reasons like *"Instruction about canvas, no content yet"*. The
`BeatAction` union is `draw | skip | undo | clear`. There is no vocabulary for
manipulation, so these cannot be implemented without a new action type.

### D-5. `"moving on to the next part"` does not clear — **MEDIUM**

*Tested:* returned `skip` ("Topic announced, no content yet"), despite
`BEAT_SYSTEM` listing *"moving on to"* as an explicit `clear` trigger. Three
other reset phrasings worked. Prompt/behavior mismatch.

### D-6. No topic-change detection — **HIGH**

Nothing anywhere detects that the subject changed. Pages turn on **geometric
overflow only** (`willOverflow`, `MAX_MARKS_PER_PAGE`). In the 23:42 session
the page turned 7 times in 142 seconds, at arbitrary points mid-sentence. A
page boundary carries no semantic meaning.

### D-7. No canvas reorganisation — **HIGH**

Nothing ever moves an element after placement. This is stated as a design
principle ("Nothing already drawn ever moves"), and it is the right call for a
live take — but it means a crowded canvas stays crowded forever. There is no
compaction, no reflow, no grouping pass.

### D-8. No visual style selection — **MEDIUM**

One style exists: Excalifont, roughness 2, `#1e1e1e` ink, `#e8590c` accent.
Nothing varies by subject. `ARTIST_SYSTEM` explicitly forbids styling
(*"No styling directives, no classDef, no subgraphs"*).

### D-9. No multi-user anything — **N/A today, CRITICAL if hosted**

No auth, no user id, no tenancy, no session ownership. Currently a
single-user local app, so nothing leaks. See §H.

### D-10. No request cancellation — **MEDIUM**

*Tested:* zero `AbortController` in app code. A beat or artist call started
before the user says "scratch that" completes anyway and renders into a board
that has moved on.

---

## E. Critical bugs

### E-1. Undo destroys the entire page — **CRITICAL**

| File | `components/Board.tsx` `doUndo` → `clearSketch` |
| --- | --- |
| **Current** | *Tested:* built a page with three lettered sentences and two boxes (7 elements), called `undo()` → **0 elements remain.** |
| **Cause** | `doUndo` calls `clearSketch()`, which removes every id in `sketchRef.current.ids`. That array accumulates *every* element from *every* `applyOp` and *every* settled live line since the last page turn — not just the last thought. |
| **Expected** | "Scratch that" retracts the last thought. |
| **Impact** | The single most likely voice command a nervous presenter uses erases their board. And §B-3 proves the recognition works, so this fires reliably. |
| **Severity** | Critical |
| **Fix** | Track thought boundaries — a stack of id-groups pushed per settled utterance and per frame — and pop one group. `sketchRef.ids` is the wrong granularity for undo. |

### E-2. `commit()` reverts user edits — **CRITICAL** *(code-derived, not reproduced)*

| File | `components/Board.tsx` `commit` |
| --- | --- |
| **Current** | `updateScene({ elements: elementsRef.current })` pushes the app's array as the whole scene. Excalidraw's own copy — including anything the user dragged, resized, or retyped — is overwritten. |
| **Expected** | User edits survive the next mark. |
| **Evidence** | *Code.* My console test showed `userEditSurvivesNextMark: true`, but that test is **invalid** — I mutated `elementsRef` directly rather than going through Excalidraw, so it proved nothing. `onChange={() => {}}` is wired to a no-op, so the app never reads edits back. A real drag has no path into `elementsRef`. |
| **Severity** | Critical (pending reproduction with a real pointer drag) |
| **Fix** | Reconcile in `onChange`: merge Excalidraw's element state back into `elementsRef` for ids the app didn't just write. |

### E-3. Diagrams drew on top of words — **HIGH, fixed this session, unverified live**

| File | `components/Board.tsx` `writeLive` |
| --- | --- |
| **Cause** | `writeLive` rewound the pen to a snapshot from the start of the sentence so the line could regrow in place. The Scribe (600–2000ms) and the wrap-up renderer (~2.4s) finish *after* the next sentence has started, and their `place()` reservations were rewound over. |
| **Evidence** | User screenshot showing a frame drawn through three lines of text; log confirms Scribe mark t=126847, live rewind t=127756, diagram t=128063 all in the same rows. |
| **Fix applied** | `liveRef` now stores an `after` snapshot; if the pen has moved, the line re-anchors instead of rewinding. The wrap-up also waits up to `LIVE_SETTLE_WAIT_MS` (1500ms) for the sentence to settle. |
| **Status** | **Not verified with a real voice.** Needs a take. |

### E-4. Session clock is never reset on restart — **MEDIUM**

`handleSessionStart` sets `t0Ref` only `if (t0Ref.current === null)`. Stop and
restart mid-session and every subsequent `t` in the log is measured from the
*first* mic open, silently corrupting all latency measurements.

### E-5. `clearSketch` early-return mutates without committing — **LOW**

The `sketchRef.current.ids.length === 0` branch returns before `commit()`, but
`dropLiveLine()` above it may already have mutated `elementsRef`. The canvas
shows stale content until some later write. Cosmetic and self-healing.

### E-6. Dead layout code — **LOW**

`lib/scene.ts` exports `slotOrigin`, `FRAMES_PER_ROW`, `CELL_W`, `CELL_H`;
`renderBeat` always calls `buildBeat(..., 0)` and then repositions via
`place()`. `slotRef` in Board.tsx is incremented in `doUndo` and never read.

---

## F. Latency measurements

All measured this session against the running dev server, except where marked
as production (from real session logs).

### F-1. Microphone → transcript → ink *(production, 23:42 session)*

| | |
| --- | --- |
| `lagP50` across 40 utterances | **234–384ms** |
| `lagMax` (worst partial) | 2258ms |
| `renderP50` (our share) | **0–2ms** |

**Source of the remaining latency:** `recorder.start(100)` sets a 100ms audio
chunk floor; Deepgram network round-trip and model inference account for the
rest. **Not addressable in our code.**

### F-2. Transcript → AI → canvas

| Stage | p50 | min | max |
| --- | --- | --- | --- |
| Scribe first byte | **574ms** | — | — |
| Scribe full stream | **736ms** | — | — |
| Beat decision | **913ms** | 820ms | 2030ms |
| Artist (Mermaid) | **1580ms** | 1481ms | 3147ms |
| Beat + artist chain | **~2.5s** | | |
| Decision → rendered *(production)* | **2419ms** | | |

### F-3. Total speech → visual

| Path | Latency | AI involved |
| --- | --- | --- |
| Spoken word → written on canvas | **~250–400ms** | **none** |
| Spoken word → Scribe mark | ~1.3–1.9s | Haiku |
| Spoken word → wrap-up diagram | **~3–5s** | Haiku + Sonnet |

### F-4. Time to first visual response

*Production, 23:42:* first `live` event at **t=3617** — essentially the moment
speech began. First Scribe mark t=5635. First diagram **t=29449** (29 seconds).

### F-5. Additional latency sources found

| Source | File | Cost |
| --- | --- | --- |
| `TOUCH_LOCK_MS` | Board.tsx | **4000ms** — any pointer/key input blocks the wrap-up renderer for a full 4s after |
| `SCRIBE_INTERVAL_MS` | Board.tsx | up to 700ms client-side throttle before a Scribe call |
| `LIVE_SETTLE_WAIT_MS` | Board.tsx | up to 1500ms (new, deliberate) |
| Render stagger | `renderBeat` | 70ms/child + 250ms fade |
| Token mint on start | probe | Deepgram **1480ms**, Gemini **2378ms** |

**Conclusion: "the AI is slow" is wrong.** Haiku returns a first byte in
574ms. The visible delay is the *chain* — beat, then artist, then a staggered
render — plus up to 4s of touch-lock. The architecture costs more than the
models do.

### F-6. Continuous speech and rapid topic change

*Continuous:* handled well. The live line has no turn boundary. Race-tested at
25ms intervals with no duplication. **Not tested with a real continuous voice.**

*Rapid topic change:* **no mechanism exists.** No topic detection (§D-6), pages
turn on geometry alone, and the artist regenerates from scratch each time. A
fast pivot produces disconnected flowcharts with no relationship between them.

---

## G. Architecture weaknesses

### G-1. Three uncoordinated writers on one canvas — **CRITICAL (design)**

`writeLive`, `applyOp` (Scribe), and `renderBeat` all append to `elementsRef`
and all mutate the shared `penRef`. Coordination is by convention only. §E-3
was exactly this failing. The re-anchor fix is a patch, not a scheduler.

**Fix:** one serialized layout owner — a queue that every writer submits to.

### G-2. `elementsRef` is a flat append-only array — **HIGH**

No grouping, no semantic index, no id→meaning map. `marksRef` is a partial
index that resets per page. Nothing can answer "what is on the board about
Airline?", which is why nothing can ever reorganise (§D-7) or refine (§I-1).

### G-3. Excalidraw is write-only — **HIGH**

`onChange={() => {}}`. The app pushes and never reads. Root cause of §E-2 and
the reason user edits have no path into the model's view of the board.

### G-4. Non-cancellable in-flight work — **MEDIUM**

No `AbortController` (§D-10). `beatQueuedRef`/`scribeQueuedRef` coalesce to one
pending call, which prevents pile-up but not staleness.

### G-5. No retry anywhere — **MEDIUM**

Scribe failure falls back to the local extractor (good). Beat failure returns
`skip`. Artist failure returns `NONE`. Deepgram close ends the session (§C-4).
Nothing is ever retried.

### G-6. No rate-limit handling — **MEDIUM**

No 429 detection, no backoff. The Scribe can fire every 700ms indefinitely.

### G-7. `page` is a global counter, not a document — **MEDIUM**

`pageRef` only increments. No way to go back, and `dropLiveLine` on `turnPage`
means content can be silently discarded mid-sentence. "Reference and return"
(PLAN.md) is unimplementable against this structure.

### G-8. Mic cleanup is correct — **no issue** *(code)*

`stop()` stops tracks, closes the AudioContext, disconnects the worklet, and
clears the keepalive. `useEffect(() => stop, [stop])` runs it on unmount.

---

## H. Security and privacy risks

### H-1. `.env.local` holds live keys in plaintext, and they were exposed — **CRITICAL**

| File | `.env.local` |
| --- | --- |
| **Current** | Live `DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` in plaintext. These were printed into a chat transcript during this session. |
| **Severity** | Critical |
| **Fix** | **Rotate all three now.** They should be considered compromised. |

### H-2. No auth, no tenancy — **CRITICAL if hosted, N/A locally**

No user identity anywhere. Every API route is unauthenticated. If deployed as
the SaaS the directory name implies, `/api/deepgram/token` becomes an open
credential-minting endpoint for anyone on the internet, billed to the owner.

**Fix before any deploy:** authenticate the token routes at minimum.

### H-3. Full speech content sent to third parties without visible control — **HIGH**

Every word goes to Deepgram; substantial excerpts go to Anthropic and
optionally Google. There is no indicator, no consent, no opt-out, and no
redaction. A user rehearsing something private has no signal it left the
machine. The red dot means "recording", not "transmitting to three vendors".

### H-4. Session log contains a full verbatim transcript — **MEDIUM**

`downloadLog` writes every utterance to `~/Downloads` unencrypted. Fine for a
solo dev; a data-handling problem the moment there is a second user.

### H-5. No BYOK — **MEDIUM (missing feature)**

No mechanism exists. Every user's speech would run on the owner's keys and
budget. Noting it as absent rather than unsafe.

### H-6. Token TTLs are reasonable — **no issue** *(tested)*

Deepgram 60s. Gemini 20 uses / 1h expiry / 55m new-session window. Both scoped
correctly. This part is done well.

---

## I. Creative reasoning gaps

### I-1. Nothing owns the diagram — **the central gap**

Three writers produce three unrelated artifact types onto one surface:

| Writer | Produces | Knows about the others? |
| --- | --- | --- |
| `writeLive` | verbatim sentences | no |
| Scribe | isolated lettered nouns | sees its own `onPage` list only |
| Artist | standalone Mermaid flowcharts | sees frame labels only |

The artist has **no access to the lettered words**. So when it draws
`A[Airline] --> B[AI Agents]`, it has no idea "Airline" is already on the page
20 pixels away. That is why the screenshot showed duplicate concepts stacked on
each other. **There is no object representing "the user's idea".**

### I-2. Relationships are barely used — **HIGH**

Of 27 Scribe marks in the 23:42 session: **0 links, 1 underline.** The vocabulary
exists (`link`, `underline`, containers) and goes unused. The Scribe letters
nouns; the artist draws graphs elsewhere. **Nothing draws a relationship between
two things already on the board** — which is precisely what sketchnoting is.

### I-3. No refinement pass — **HIGH**

Every artifact is write-once. A diagram is never revisited when the user adds
to the thought 30 seconds later. Real sketchnoting is iterative; this is
append-only.

### I-4. Context window is shallow — **MEDIUM**

Scribe: last 40 words + 24 marks. Beat: 120 words + 20 concepts. Artist: 90
seconds. **Nothing holds the whole presentation.** By minute ten the system has
no idea what minute one was about, so it cannot detect a callback, a theme, or
a contradiction.

### I-5. Icon library too small to depict — **MEDIUM**

20 icons, ~40 aliases. `resolveIcon("airline")` returns `null` — the user's own
headline example draws no picture.

### I-6. No compositional intent — **HIGH**

Nothing chooses a *form* for the idea. Everything is either a line of text or
an LR/TD flowchart. A comparison, a timeline, a hierarchy, a cycle, a quadrant —
all render identically. `ARTIST_SYSTEM` offers four Mermaid types and the model
almost always picks `flowchart LR`.

---

## J. Recommended implementation order

**Phase 0 — stop the bleeding (hours)**
1. Rotate the three exposed API keys (§H-1).
2. Fix undo to pop one thought (§E-1).
3. Reset `t0Ref` on restart (§E-4).
4. Verify §E-3's fix with a real take.

**Phase 1 — don't lose the user's work (1–2 days)**
5. Autosave to IndexedDB, restore on mount (§D-1).
6. Re-enable canvas export (§D-2).
7. Deepgram reconnect (§C-4).
8. Reconcile `onChange` so user edits survive (§E-2, §G-3).

**Phase 2 — make it one system (the real work, 1–2 weeks)**
9. A semantic board model: id → concept, with grouping (§G-2).
10. One serialized layout owner (§G-1).
11. Stable ids for the live line (§C-2).
12. Real arrow bindings (§C-3).
13. **The Organizer** — give the artist the lettered words and let it emit
    `link`/`underline`/container ops against existing marks instead of a new
    Mermaid graph (§C-1, §I-1, §I-2). *This is the highest-value item in the
    document.*

**Phase 3 — creative reasoning**
14. Topic-change detection to drive page turns semantically (§D-6).
15. Refinement pass over existing diagrams (§I-3).
16. Form selection beyond flowchart (§I-6).
17. Icon library expansion (§I-5).

**Phase 4 — if it becomes a hosted SaaS**
18. Auth and tenancy (§H-2) — **blocking for any deploy.**
19. Data-handling disclosure and controls (§H-3).
20. BYOK (§H-5).

---

## K. Suggested MVP definition

The current build is trying to be three products. A defensible MVP is one:

> **A live sketchnote board that writes what you say and draws the structure
> between the things you name, and that you can save.**

**In:**
- The live line (already excellent — do not touch it)
- The Scribe, narrowed: letter nouns **and** emit `link`/`underline` between
  them
- The Organizer replacing the artist: structure over existing marks, not new
  Mermaid
- Persistence + export
- Undo that retracts one thought
- `clear` for a new section

**Out for now:**
- Gemini Live engine (structurally cannot be live — keep the code, drop it from
  the product)
- Spatial commands (§D-4)
- Style selection (§D-8)
- Multi-user, BYOK, video recording

**The MVP is done when** a 10-minute talk produces one coherent board you would
publish without editing, and the app never loses it.

---

## L. Tests that must be added

There is currently **no test suite at all** — no runner, no test files, no CI.
`npm run typecheck` is the only gate.

**Unit**
1. `isFragment` — the 32-case corpus referenced in PLAN.md, as an actual test.
2. `wrapSpeech` — long words, no spaces, exact-boundary widths.
3. `place`/`willOverflow`/`lineStart` — overflow, wrap, page-turn boundaries.
4. `parseLine` — every op, trailing icons, malformed input.
5. `resolveIcon` — aliases and unknown-name null.

**Integration — layout invariants (the §E-3 class of bug)**
6. **No two elements overlap** after any interleaving of live line, Scribe
   mark, and diagram render. Property test over random orderings.
7. Pen reservation survives a concurrent `applyOp` — a direct regression test
   for the rewind bug.
8. Page turn mid-utterance moves the whole sentence, strands nothing.

**Integration — canvas semantics**
9. Undo pops exactly one thought (regression for §E-1).
10. A simulated user drag survives the next mark (regression for §E-2).
11. Arrows keep pointing at their nodes after a node moves.

**Pipeline**
12. Interim race: N un-awaited interims at 25ms yield one element, zero strays.
    *(exists as an ad-hoc console probe — make it a real test)*
13. Deepgram socket drop reconnects and keeps the canvas.

**Model behavior (golden-file, run against real sessions)**
14. `replay-beat.mjs` promoted into the repo with a checked-in expected
    draw/skip ratio, so prompt edits can't silently regress it.
15. Voice-command recognition: the 12-phrase probe from this audit, asserting
    `undo`/`clear` classification.
16. Artist output always parses as Mermaid (the known "invalid Mermaid" defect
    has no test).

**Performance regression**
17. Assert `renderP50 < 10ms` and `lagP50 < 600ms` over a replayed interim
    stream, failing the build if the live path regresses.

---

## Closing answer

**Does inpublic understand what the user is saying and creatively turn it into a
coherent visual diagram in real time?**

**No.** It does two separate things well and does not do the thing in the
middle.

It **transcribes beautifully and fast** — 234–384ms, with our own code
contributing 0–2ms of that. That path contains no AI whatsoever.

It **occasionally generates a reasonable flowchart** — 3–5 seconds later, from a
model that cannot see the words already on the canvas, placed into a scene it
has no model of, never revisited.

The gap between them is where the product lives, and it is empty. There is no
object in this codebase that represents *the diagram*. Until something owns
that — knows that a lettered "Airline" and a flowchart node "Airline" are one
concept, and can add a relationship between existing marks rather than starting
a new picture — inpublic will remain a very good live transcript with drawings
occurring nearby.

The good news is that the hard, unglamorous part is already done and measured:
the real-time substrate works. What is missing is a semantic layer over the
canvas, and that is ordinary engineering rather than a research problem.
