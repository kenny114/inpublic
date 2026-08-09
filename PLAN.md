# inpublic — status and plan

The goal, in your words: **a live sketchnote artist.** You talk to camera, and
the board fills in behind you as you speak — rough while you're talking, tidied
into structure when you land a thought. Pages you can fill and come back to.

The reason it exists, also in your words: you have to make build-in-public
content, and you don't want your face to be the main thing on screen. So the
board has to carry the video. That is the bar everything here is measured
against.

This file tracks what exists, what doesn't, and what's next.

---

## The thing that was wrong, and is now fixed

> *"I am speaking, then I pause for a second, and then it writes. It's making me
> speak differently, and I don't like that."*

**Solved 2026-08-07.** The cause was not model speed, network, or Excalidraw.
It was that a language model sat between your mouth and the page — so nothing
could be written until something had finished thinking about it.

Two engines, same disease:

- **Gemini Live** emits `draw()` only as part of a model turn, and a turn only
  begins once its VAD decides you stopped. In the 22:54 session the drawing
  event and the end-of-turn event were *the same event*, every time, to within
  17ms — and turns were 16–20s apart. `silenceDurationMs` cannot fix this.
  There is no mid-turn tool call.
- **Deepgram + Haiku** waited on settled interims, then a 700ms throttle, then
  a round trip. 5.5s.

The fix was to stop asking a model to write. Deepgram's interim stream already
contains your words ~200ms after you say them; putting them on the sheet costs
a render, not an inference. See **The live line** below.

---

## Done

### The live line — the fast path
- **Your words are written as you say them.** `writeLive` in
  [components/Board.tsx](components/Board.tsx) is wired straight to Deepgram's
  `onInterim`. Each partial rebuilds one text element in place, so the line
  grows word by word rather than appearing in a batch.
- **Grey while it can still change, ink once it can't.** Deepgram revises
  interims; the colour is the honest signal for which state a phrase is in.
- **No model, no network, no throttle on this path.** That is the whole design.
  Anything that can block does not belong here.
- **The line owns the pen while it's live.** It re-reserves its row on every
  interim, so marks drawn afterwards land underneath rather than through it.
- **It yields the row when something else takes it.** Re-reserving means
  rewinding the pen to where the sentence started, which is only safe while the
  row is still ours. The Scribe takes up to 2s and the wrap-up renderer takes
  longer; both land marks while you have already started the next sentence.
  The line now compares the pen against where it left it and re-anchors
  instead of rewinding when they differ — the half-written sentence jumps down
  once to clear what landed, rather than being drawn through. Fixed 2026-08-07
  after the 23:42 session; this was the "everything is drawn on top of
  everything" problem.
- **The wrap-up waits for the sentence to settle** before placing, up to
  1500ms, so the jump is rare rather than routine.
- **Race-safe.** Interims arrive faster than a build finishes, so a sequence
  guard drops stale renders. Verified at 25ms intervals — faster than Deepgram
  will ever send — with no stacking and no strays.
- Wraps to the sheet, turns the page mid-sentence if it has to, and carries the
  half-written line over whole rather than stranding it.

**Measured, 23:26 session, real speech with a real stammer:**

| | |
| --- | --- |
| `"To handle my in circuit my insert my in"` | written live, in full |
| `"in my insec my insecurities."` | written live, in full |
| Speaker had to pause for the tool | **no** |
| Scribe round trips, same session | 823ms – 3549ms |
| Did those 3549ms show on screen | **no** — off the critical path |

### The page
- **Pages, not a grid.** Fixed sheets side by side. The pen flows marks left to
  right and wraps; when a sheet fills it turns to a fresh one. Nothing already
  drawn ever moves.
- **Camera holds still.** The whole sheet is framed once per page, so the view
  only moves when a page actually turns.
- **Hand-drawn everything.** Excalifont, roughness on every stroke, orange
  accent for emphasis. Fonts preloaded so text isn't measured against a
  fallback and clipped.

### The drawing vocabulary
- `title` `heading` `word` `note` `bullet` `box` `icon` `wave` `link`
  `underline` — see [lib/ops.ts](lib/ops.ts).
- **20 hand-authored icons** with an alias table, so "security" → lock and an
  unknown name draws nothing rather than junk. See [lib/icons.ts](lib/icons.ts).
- **No model ever emits a coordinate.** The model picks what and how important;
  the pen decides where.

### The Scribe — now a second pass, not the main event
- Streaming Haiku, one op per line, rendered as each line completes.
- **Runs on finals only.** It used to fire mid-utterance because it was the
  only thing writing. Now the live line is, and a mark placed while the line is
  still growing lands straight through it.
- Fragment filter ([lib/ops.ts](lib/ops.ts) `isFragment`) rejects scaffolding.
  Verified 32/32 on a corpus drawn from real sessions.
- **Hard dedupe** on marks, waves and decorations.
- **Local fallback** ([lib/sketch.ts](lib/sketch.ts)) if the Scribe stalls.
- `NEXT_PUBLIC_SCRIBE=off` disables it entirely — worth doing once, to judge
  the writing on its own.

### The wrap-up tier
- Silence detector → beat (Haiku, decides) → artist (Sonnet, Mermaid) →
  rendered as a framed diagram **below** your notes, not replacing them.

**The beat's over-skipping — fixed 2026-08-07.** The 23:42 session went 21
skips to 7 draws, and 9 of those skips said some form of *"restating existing
content"* about material that was genuinely new.

The cause was the request, not the model. `liveConcepts` handed the beat every
word the Scribe had lettered, run together with the drawn diagrams under one
heading — "already on the board". The Scribe is told to capture generously, so
within a minute nearly every noun the speaker used was on that list. The beat
read **its own raw material as finished work** and skipped.

Three changes:
- **The two lists are now labelled as different kinds of thing.** Loose words
  are raw material and explicitly not a reason to skip; only a drawn diagram
  showing the same relationship makes something redundant.
- **`liveConcepts` is capped at 20.** An unbounded list makes every sentence
  look like a repeat.
- **The beat is told its own skip streak.** It has no memory between calls, so
  it re-derived the same skip from the same material every few seconds. At 3+
  consecutive skips its bar drops; at 5+ it is told it is the problem.

**Verified by replaying the 23:42 session through the live endpoint**
(`scratchpad/replay-beat.mjs`), rebuilding the state Board.tsx held at each of
the 28 real beat calls: **21/7 became 15/13, six decisions flipped, every one
skip → draw.** Nothing that was correctly drawing broke. The run of four
consecutive "restating" skips from t=64221 to t=76692 now draws, caught at the
third.

Caveat on that number: the replay follows the log's own path, so the streak
accumulates exactly as it really did. In a live take a draw resets the streak,
so the real count lands below 13 — the effect is breaking out of skip runs
several beats earlier, not thirteen diagrams.

**Watch for the opposite failure.** The beat may now be too eager rather than
too shy. In the replay, `t=19051` flipped to draw on *"Airline is"* — a genuine
fragment. If diagrams start appearing on half-formed thoughts, the escalation
thresholds in [lib/prompts.ts](lib/prompts.ts) (currently 3 and 5) are the
dial; raise them before touching anything else.

### Plumbing
- Deepgram nova-3 streaming, ephemeral credentials via `/auth/grant` — the root
  key never reaches the browser. Audio leaves in 100ms chunks, which is the
  hard floor under how soon an interim can come back.
- Session log with `transcript` / `live` / `sketch` / `scribe` / `beat` /
  `draw` / `page` events, zeroed at first mic click.
- Dev and production builds write to separate directories so a build can't
  clobber a running dev server.
- Both Anthropic and Gemini supported for every text call.
- `inpublic.live("some words")` in the console drives the live line without a
  microphone — useful for rehearsing pacing.

### Instrumentation for the live line
Every settled utterance logs a `live` event: `lagP50`, `lagMax`, `renderP50`,
and how many interims built it.

`lag` is milliseconds from the end of the spoken audio to ink on the sheet.
Deepgram stamps each result with its position on the audio timeline and the
session clock starts with the socket, so the two are directly comparable.
`render` is our share of that — build plus commit — so a bad number can be
blamed on the network or on us without guessing.

**Measured on real speech, 23:42 session, 2m20s of continuous talking:**

| | |
| --- | --- |
| `lagP50`, every utterance | **234–384ms** |
| `renderP50`, every utterance | **0–2ms** |
| Where the time goes | all of it is Deepgram round-trip |

There is nothing left to win here. Our share is a rounding error, and the rest
is the network. Do not tune this further — spend the effort on the wrap-up
tier, which is where the remaining ugliness is.

---

## The Gemini Live engine — built, not the default
`NEXT_PUBLIC_ENGINE=gemini` switches the live tier to a single Gemini Live
socket. Both engines feed the same `applyOp` renderer and the same live line,
so the page, pen, dedupe and fragment filter are shared and cannot drift.

Worth keeping and worth understanding, but **it is not the answer to latency**
— its drawing still only arrives at end-of-turn. What it is good at is coming
back with structured `draw()` calls instead of text.

- **AUDIO response modality, which we never play.** No general Live model
  supports TEXT output — verified across all five on the account. The drawing
  comes back as `draw()` tool calls, which are structured data.
- `Behavior.NON_BLOCKING` and `FunctionResponseScheduling.SILENT` keep it
  listening while we render without prompting it to speak.
- Ephemeral tokens on **`v1alpha`**. On the default version the socket dies
  with a bare "Internal error encountered".
- `sessionResumption` + `contextWindowCompression`, and reconnect on `goAway`,
  so a 30-minute take survives the 15-minute session ceiling.
- Audio captured as 16kHz PCM through an AudioWorklet.
- `scripts/live-probe.mjs` replays a wav through the engine without a mic.

---

## Not built

### The Organizer — *the next real feature*
Today's wrap-up generates a *new* Mermaid diagram. It should instead draw
structure **around what is already on the page** — a container around a group,
arrows between them, an underline on the key term.

**This got much easier.** It used to have to guess what was on the board;
now your words are always there, in full, in order. What a sketchnoter
actually does: letter the words, then box and connect them. We now do the
first half automatically.

### Reference and return — *designed, never implemented*
Saying *"also, for Airline…"* should fly the camera back to that page and add
to it. **This does not exist.** What exists is continuation pages only.

The design we agreed: local title matching (a closed set of ~6 page titles, so
it's instant string work — no model), gated on a back-reference cue
("also", "back to", "remember", "as for"). Glance by default — fly there, add
the mark, fly back after a few seconds — and commit only when you dwell.

### Keyterm boosting
Deepgram nova-3 accepts a `keyterm` list. Feeding it your vocabulary
("Airline", product names) would fix mis-hearings at the source rather than
filtering them downstream. Ten minutes of work; needs your word list.

**The same word list seeds the icon library.** Write it once, use it twice.

---

## Open questions

| | |
| --- | --- |
| **Does the flicker read as live thinking, or as a glitch?** | Deepgram revises interims, so a word can appear wrong and correct itself. The settled-word path is still in the file if it bothers you — costs ~200ms, buys full stability. |
| **The same words now appear twice.** | The live line writes `"Public is a tool I built."` and the Scribe letters `title "Public"` + `word "tool I built"`. In the 23:26 session this read fine. Watch whether it stays fine over ten minutes. |
| **Is the icon library too small to depict anything?** | 20 icons, ~40 aliases. `resolveIcon("airline")` returns null — your own headline example draws no picture. Only matters if the drawing is meant to carry more than the words do. |

---

## The organizing pass — 2026-08-08

Measured against the 10:09 session first, then changed. The numbers that
justified each change are in the report; the shape of the work:

- **The Organizer works around your words.** `lib/organizer.ts` resolves every
  requested concept to one of three outcomes — reuse an existing concept, ADOPT
  a mark the Scribe already lettered, or create. Adopting draws a light blue
  ring around the words that are already there and binds arrows to the ring.
  In the 10:09 session the Artist created 27 concepts and reused 0, next to 40
  Scribe marks covering most of the same nouns. Every one of those was a
  visible duplicate.
- **Page turns say why.** `lib/pagination.ts`. Hard overflow turns immediately;
  reaching the mark cap is a *request* that waits for the thought to land,
  bounded at 6s. Eleven of eighteen turns in the 10:09 session cut a sentence
  in half. The sentence in flight is now carried onto the new sheet instead of
  being dropped.
- **Keyterms and repair.** `lib/vocab.ts`. Terms already on the canvas are fed
  to nova-3 at connect time and used to correct the transcript afterwards —
  conservatively, and only ever toward something already visible.
- **Reference and return.** `lib/reference.ts` plus per-page pens, so "going
  back to Airline" adds to Airline's page and comes back.
- **Arrows route.** `lib/routing.ts`. Orthogonal detours around anything that
  names something; the transcript is a *soft* obstacle it may cross when there
  is no other way.
- **One timing row per trip.** `type: "timing"` — transcript, beat, organizer,
  apply, total, on one clock.

Tests: `npm test` (offline, deterministic) and `npm run test:live` (real beat
and Artist against the dev server).

---

## Known defects

| | |
| --- | --- |
| **Pages turn much faster now** | Every sentence takes a full-width row, so a sheet holds ~8. May still want a taller sheet or tighter line spacing — but turns no longer land mid-thought, which was the part that read badly. |
| ~~Beat over-skips~~ | **Fixed 2026-08-07.** |
| ~~Mid-thought page turns~~ | **Fixed 2026-08-08.** |
| ~~Duplicate concepts~~ | **Fixed 2026-08-08** — reuse/adopt/create. |
| ~~Junk marks (`"puts AI"`)~~ | **Fixed 2026-08-08** — a mark must be traceable to what was said. |
| ~~Link arrows overlap icons~~ | **Fixed 2026-08-08** — obstacle routing. |
| ~~Broken latency meter~~ | **Fixed 2026-08-08** — the audio timeline is anchored per socket. |
| Artist returns NONE | Still possible. It now logs the mode and focus so the cause is visible, and the transcript and marks survive it untouched. |
| Keyterms are fixed at connect time | Deepgram takes them when the socket opens. Terms discovered mid-take only reach the recogniser on the next reconnect; the correction layer covers the gap. |
| Mermaid | Only reachable from `inpublic.draw()` now — the Artist returns actions. Invalid Mermaid costs that one call and nothing else. |

---

## Who this is for — corrected 2026-08-08

The framing was **"you talk to camera and the board carries the video."** That
is one case, not the market. In your words:

> *"they could be in a meeting, they could be a teacher on a Zoom — they just
> have to be in front of a computer and want to express themselves."*

The real constraint was never a camera. It is **synchronous speech that a
visual has to keep up with**: a lesson, a standup, a design review, a sales
call, a tutoring session, a workshop.

This makes the case *stronger*, not just wider. For recorded content there is
always the objection "add the visuals in post." In a live meeting **there is no
post.** A teacher mid-explanation cannot alt-tab, paste into a prompt box and
wait. The latency architecture stops being a preference and becomes the only
way the product can exist. The situation forces the design.

### What the competition actually is

Scanned 2026-08-08. Nothing found that draws for a human who is speaking.

| | |
| --- | --- |
| **Async text → visual** | Napkin AI (~$10M seed, reportedly 5M+ registered users), Eraser/DiagramGPT, Whimsical AI, Gamma. Paste text, get a diagram. Commercially successful and irrelevant to a live talker. |
| **Transcript → sketchnote** | sketchnote.app, VisualNote AI, NoteGPT. Our exact output, produced after the talk ends. |
| **Canvas + AI prompts** | tldraw, Miro, FigJam, Jeda.ai, Lucid. Human-triggered, every one. |
| **Meeting AI** | Zoom AI Companion shipped prompt-to-diagram and meeting-to-whiteboard in March 2026. Read it closely: prompt-to-diagram is *you typing*; meeting-to-whiteboard converts *notes, afterwards*. |
| **Education** | iDroo, LiveBoard, LearnCube — manual whiteboards with AI lesson prep. Studdy, Brightboard — the AI *is* the tutor. Neither draws for a human teacher. |
| **Live speech → canvas** | Demos only. One tldraw + OpenAI Realtime API experiment (Nov 2025). No shipped product, no company. |
| **Human graphic recorders** | A real paid profession — conference scribes charging real money to do exactly this job by hand. Their own trade press calls AI graphic recording "still experimental." That is the demand signal. |

Figures above come from review sites, not filings. Directional only.

### Build with Zoom, not against it

Zoom owns the meeting surface and we will not win it by being a browser tab
next to the call. The good news is that we do not have to fight — **Zoom
already exposes exactly the pipe this needs.**

**Realtime Media Streams (RTMS)** is a WebSocket API giving a third-party app
live **per-participant audio, transcripts, screen share and participant
events**, during the meeting, with **no bot joining the call**. The Layers API
lets a Zoom App render into the meeting UI rather than beside it.

Two consequences, and the first one is the important one:

- **RTMS separates speakers for us.** Audio arrives per participant, already
  split. In the Zoom path there is nothing to diarize — the hard problem is
  handed over at the door.
- The Zoom-native build is therefore *less* work than the local-mic build, not
  more, and it lands inside the surface where the meetings already happen.

Unverified and worth checking before committing: RTMS latency versus our
Deepgram floor (~234–384ms), whether transcripts arrive fast enough to feed the
live line or whether we still run our own STT on the RTMS audio, and what the
Zoom Marketplace review process demands.

### What diarization would actually cost

Costed against the current code, 2026-08-08. The surprise is that **the
expensive part is not speaker detection.**

**Cheap — the recognizer.** `hooks/useDeepgram.ts` adds `diarize: true` to the
`listen.live` config. One line. Labels arrive on `alt.words[].speaker`, and the
hook currently reads only `alt.transcript` — so it needs a function that walks
`alt.words` and splits one Deepgram result into per-speaker runs. Call it an
hour.

**Moderate — the plumbing.** `onFinal(text, tStart, tEnd, audioEndMs)` grows a
speaker, which touches `handleFinal` and `handleInterim` in
[components/Board.tsx](components/Board.tsx), the `Final` type in
[lib/types.ts](lib/types.ts), `finalsRef` and its consumers, and the transcript
blocks handed to the Scribe, beat and Artist prompts. The Gemini Live path has
no speaker concept at all and would simply not support it. Half a day.

**Expensive — the live line is single-tenant.** This is the real cost. The fast
path assumes **one utterance in flight**. `writeLive` re-reserves its row on
every interim and rewinds the pen to where the sentence started — safe only
while the row is still ours. Two people talking interleaved means speaker B's
interim overwrites speaker A's half-written sentence, which is the
"everything drawn on top of everything" bug we already fixed once, back again
by a different route. It needs **N live lines, one per active speaker, each
owning its own row**, plus a rule for retiring a row when someone stops.
That is a genuine rework of the most delicate code in the project.

**Also unresolved:** Deepgram may revise speaker labels as an utterance
settles. A line that changes attribution mid-sentence would be worse than no
attribution at all. Unverified — test before building on it.

**So the order is inverted from the obvious one.** Build the multi-track
plumbing — speaker-tagged transcript, one live line per speaker — because
*both* paths need it. Then take speaker separation free from RTMS rather than
paying for Deepgram's diarization accuracy. Local-mic diarization is only
needed for the co-located case: several people round one laptop.

### The other two gaps the meeting case opens

- **Audio source.** We capture `getUserMedia({audio:true})` — your mic. To hear
  the other participants outside Zoom we need tab or system audio capture.
  Plumbing, but load-bearing.
- **Screen-share ergonomics.** A page turn mid-share is disorienting when other
  people are watching live, in a way it is not when you are recording and can
  cut. The camera-stability rules were written for an audience of one.

### Story Mode may be an education feature

Worth sitting with. The Visual Action Engine — entities, poses, actions,
directions, spatial relations — is a **narration engine**. Zoom's own chosen
example for prompt-to-diagram was *"the water cycle for third graders"*: a
teacher narrating a process with things that move and act on each other. That
is precisely what the engine was built to portray, and it already exists.

---

## Order I'd work in

1. **Talk at it.** Everything above is measured against one recorded session
   and two test suites. It has not yet met a live microphone.
2. **Page density** — decide whether ~8 marks a sheet is right now that turns
   happen at sensible moments.
3. **Adoption precision** — `matchMark` currently binds "Infrastructure" to a
   heading that reads "Infrastructure for AI agents". Right call, slightly
   wrong words.
4. **Multi-track live line** — N rows, one per speaker. The prerequisite for
   every meeting use case, and the only expensive part of diarization.
5. **RTMS spike** — one Zoom App reading live per-participant transcripts,
   measured against our Deepgram floor before anything is built on it.
6. **Then** further story and object visualisation.
