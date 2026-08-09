# inpublic

A fullscreen web whiteboard that listens to you talk and draws diagrams on an
Excalidraw canvas in real time. Built for build-in-public video: OBS captures
the browser window as one source, your camera is a separate source. The app
records nothing. It only draws and logs.

The goal is **live sketchnoting**: hand-lettered titles, little icons, arrows
and containers appearing as you speak, the way a visual notetaker captures a
talk in real time.

```
mic → Deepgram (browser, streaming)
 │
 ├─ interims + finals ─→ POST /api/scribe  [Haiku, STREAMING]
 │                     → drawing ops, one per line, rendered as they arrive
 │                     → title / word / box / note / bullet / icon / link   ← LIVE
 │                     ( local extractor stands in if the Scribe stalls )
 │
 └─ silence 600ms ────→ POST /api/beat    [Haiku]  → {action}
                      → POST /api/artist  [Sonnet] → mermaid
                      → replaces the rough marks with a tidy frame          ← WRAP-UP
```

## The Scribe

The live hand. A tight loop of short **streaming** calls: each one is told what
is already on the page and what you just said, and streams back operations one
per line. Each line renders the instant it completes, so marks land in rhythm
with your voice rather than in a batch.

```
title "Airline"
wave
box "AI Agents"
icon brain
note "one channel per agent"
link "Airline" -> "AI Agents" : "built on"
underline "AI Agents"
```

Its mission, near-verbatim from its prompt: *you draw what they say as they say
it; you never wait for them to finish; you are allowed to be rough, you are not
allowed to be late.* It never decides **whether** to draw — that's what makes it
live. Judgement belongs to the wrap-up.

Icons are hand-authored stroke paths in [lib/icons.ts](lib/icons.ts) (person,
phone, cloud, server, database, gear, bulb, warning, lock, money, clock, chart,
globe, doc, mic, brain, rocket, check, cross, people) with an alias table, so
"security" resolves to the lock and an unknown name degrades to no icon rather
than to junk.

Three rules the code is built around:

1. **No model ever emits a coordinate.** The Scribe says *what* to draw and how
   much it matters; the pen in [lib/ops.ts](lib/ops.ts) decides *where*, by
   flowing marks left to right and wrapping like a page.
1. **Nothing already drawn ever moves, and the hand never stops.** The board is
   a book of fixed sheets. When the pen runs off the bottom of one, it turns to
   a fresh page — it must never refuse to draw. The wrap-up diagram is placed
   *below* the notes it summarises rather than replacing them.
2. **The board never goes dead.** A model in the live path can stall, so the
   local noun extractor runs underneath as a floor. If the Scribe is healthy
   you never see it.
3. **The wrap-up defaults to not drawing.** A wrong diagram looks worse than no
   diagram.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in the keys
npm run dev                  # http://localhost:3210
```

The port is pinned to **3210** so an OBS browser source keeps working across
restarts.

**When you're actually recording, run a production build:**

```bash
npm run build && npm start   # http://localhost:3210
```

`npm run dev` is fine for iterating, but Next's dev error overlay can throw a
full-screen red panel over the whiteboard if anything logs an error. The app
avoids `console.error` on the paths that can fail mid-session for exactly this
reason, but a production build removes the overlay entirely.

Both API keys are server-side only and never reach the browser. The client gets
a 60-second credential from `/api/deepgram/token`.

> **The Deepgram key must be able to mint credentials.** `/api/deepgram/token`
> tries `POST /v1/auth/grant` first and falls back to `createProjectKey`. Both
> need more than transcription rights — a key scoped only to `usage:write` /
> `account:write` gets a 403 on both and the mic will not start. Create the key
> with the **Owner** or **Admin** role in the Deepgram console. Shipping the
> root key to the browser instead is not an option; it would undo the whole
> point of the token endpoint.

### Models

Model selection is env-driven — any id starting with `gemini` routes to Google,
everything else routes to Anthropic. Defaults:

| Env var        | Default                       | Gemini alternative       |
| -------------- | ----------------------------- | ------------------------ |
| `SCRIBE_MODEL` | `claude-haiku-4-5-20251001`   | `gemini-3.6-flash`       |
| `BEAT_MODEL`   | `claude-haiku-4-5-20251001`   | `gemini-3.6-flash`       |
| `ARTIST_MODEL` | `claude-sonnet-4-6`           | `gemini-3.1-pro-preview` |

Keep `SCRIBE_MODEL` fast — it runs continuously while the mic is on, and
latency there is the difference between alive and laggy. Streaming is
implemented for both providers.

Set `GEMINI_API_KEY` if you point either at a Gemini model. Both provider paths
are verified working.

Two Gemini quirks the shim handles for you:

- **The "think less" knob differs by generation.** Gemini 2.5 takes
  `thinkingBudget: 0`; Gemini 3.x rejects that with a 400 and wants
  `thinkingLevel: "low"`. The beat call picks the right one by model id, and
  falls back to no thinking config at all if a model rejects both.
- **Thinking tokens count against `maxOutputTokens`.** The artist call is
  allowed to think, so it gets 2048 tokens of headroom on top of its budget.
  Without that, Gemini spends the whole cap thinking and returns empty text —
  which reads downstream as "nothing to draw" and silently blanks the board.

`gemini-2.5-pro` is retired for new API keys and 404s; use a 3.x model.

## Using it

Open `/` fullscreen, click the mic, and talk. Rough boxes start appearing
almost immediately, tracking the phrases as you say them. When you land the
thought and pause, they get replaced by a proper diagram.

Filler produces nothing in either tier — "um, so, yeah, okay, let me think
about this for a second" extracts zero concepts, so no box appears, and the
beat detector skips it too.

### Timing, honestly

| | Delay |
| --- | --- |
| First mark from the Scribe | ~0.9s from the phrase landing |
| Polished diagram after you stop | ~4.5s (600ms silence + ~1.4s beat + ~2.5s artist) |

The Scribe fires at most every 1.4s (`SCRIBE_INTERVAL_MS`) and works off
finals **plus the in-flight partial**, so it doesn't wait for Deepgram to
finalise a sentence before drawing.

Cost: the Scribe runs continuously while the mic is on — roughly a few cents
per minute of talking on Haiku.

The status dot tells you where you are: grey idle, amber connecting, red live,
and a blue halo while a beat or drawing is in flight. If the dot goes red-on-
grey and nothing transcribes, the mic failed to start — check the console for
`[deepgram] start failed`.

| Key          | Action                                      |
| ------------ | ------------------------------------------- |
| `Space`      | Toggle mic (ignored while typing on canvas) |
| `T`          | Toggle the transcript strip                 |
| `Cmd/Ctrl+Z` | Normal Excalidraw undo, untouched           |

Say "scratch that" to remove the last frame. Say "moving on to the next part"
to fade the board back to 20% and get fresh space on a new row — nothing is
ever deleted, so you can pan back during the video.

The **Log** button downloads `session-{timestamp}.json`. Its zero point is the
first mic click, so it lines up with your recording and gives you chapter
markers, captions, and b-roll cut timestamps.

### Rehearsing without talking

The board exposes a console handle so you can dry-run pacing:

```js
// Push text through the real Scribe, as if you had spoken it.
inpublic.scribe("Airline is an infrastructure for AI agents");

// Render a single operation by hand.
inpublic.op('icon phone');
inpublic.op('link "Airline" -> "AI Agents" : "built on"');

// Local fallback only, bypassing the Scribe.
inpublic.say("the request hits the load balancer", false);
inpublic.sketchCount();
inpublic.clearSketch();

// Wrap-up tier
inpublic.draw("flowchart LR\n A[Mic] --> B[Beat] --> C[Artist]", "the pipeline");
inpublic.undo();
inpublic.clear();
inpublic.log();
```

## Things worth knowing

- **`Space` overrides Excalidraw's space-to-pan.** The spec asks for
  space-toggles-mic and that wins. Use the hand tool or middle-drag to pan.
- **Zen mode is on.** Excalidraw's main menu, welcome screen, footer, and
  library trigger are hidden (via `UIOptions` where possible, CSS where not),
  but the shape toolbar stays so you can grab the pen yourself.
- **Dev and production builds use separate output directories.** `next dev`
  writes `.next`, `next build` / `next start` write `.next-build` (see
  `distDir` in `next.config.ts`). Sharing one directory means running a build
  while the dev server is up overwrites the chunks it is serving, and the page
  dies with `Cannot find module './331.js'`. If you ever do hit that, stop the
  server, `rm -rf .next`, and restart.
- **The touch lock is real.** If you've touched the canvas in the last 4
  seconds, the renderer holds the pending beat and applies it once you're idle.
- **Mermaid font size is left at the default.** Overriding
  `themeVariables.fontSize` desyncs mermaid's text measurement from
  Excalidraw's and clips node labels.
- Failures are silent by design: a `NONE` from the artist, a Mermaid parse
  error, or a failed beat call logs a note and leaves the board alone.

## Out of scope

No recording, auth, persistence, database, multi-user, video export, settings
panel, theming, mobile layout, or onboarding.
