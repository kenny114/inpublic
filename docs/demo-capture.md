# Recording the Standard Mode demos

The three demos on the landing page, the pricing page and the dashboard's
"See an example" are real captures of InPublic running — not illustrations,
not screenshots, not a re-created animation. This is how they are made, and
how to make them again after a change to Standard Mode.

## What is real, and what is not

The only synthetic part is the microphone. A generated speech file is played
into the app's own `getUserMedia` call, so from that point on everything is
the product: Deepgram transcribes it, `/api/beat` decides whether a thought
has landed, `/api/artist` plans it, the organizer places it, and Excalidraw
draws it. The recording is a composite of the canvases only — no toolbar, no
cursor, no browser chrome.

A run therefore doubles as a test of Standard Mode. If the output is weak,
that is the finding; do not repair the canvas by hand to make the demo look
better.

## Running a capture

1. Sign in, and make sure the account has allowance left — a run spends real
   listening seconds against the real entitlement.

2. Generate the speech (only needed when a script changes):

```bash
powershell -ExecutionPolicy Bypass -File scripts/demo-speech.ps1
```

   Writes `public/_demo-src/demo-{a,b,c}.wav`. Gitignored — these are inputs,
   not assets.

3. Start the capture server, which serves the driver and writes what comes
   back:

```bash
node scripts/demo-capture-server.mjs
```

4. Hand the signed-in session to the capture browser. From the console of a
   tab that is already signed in:

```js
fetch("http://localhost:3211/session", { method: "POST", body: document.cookie })
```

   The capture server writes it to `$DEMO_SESSION_FILE`. Delete that file
   afterwards — it is a live session token.

5. Run the captures. This launches its own visible Chrome on a throwaway
   profile, restores the session, and drives the page over the DevTools
   protocol:

```bash
node scripts/demo-capture-run.mjs demo-a demo-b demo-c
```

   **The window must stay on screen.** A hidden, minimized or fully occluded
   window does not composite: `requestAnimationFrame` stops, and the first
   attempt at this produced a 1 KB video, a 15-second microphone handshake and
   one beat where there should have been three. The script calls
   `Page.bringToFront`, which is enough as long as nothing is covering it.

   Runs are sequential on purpose — the server allows one active listening
   session per user, so overlapping runs fail with `active_session_conflict`.

6. Results land in:

   - `public/demos/demo-x.webm` — the recording
   - `public/demos/demo-x.png` — the last frame, used as the poster
   - `output/demo-runs/demo-x.json` — every beat and Artist response from the
     run, which is what to read when judging the output

7. Delete `public/_demo-src/` when finished.

## Changing a script

The scripts live in two places that must agree: `scripts/demo-speech.ps1`
generates the audio, and `lib/demos.ts` records what was said next to the
recording it produced. Update both, re-run, and re-check the output.
