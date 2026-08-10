# Audio timeline schema

## What this is

Audio Replay Mode lets a user upload a lesson/lecture/tutorial recording and
get a synchronized visual replay, reusing the same drawing pipeline
(`/api/artist`, `/api/math`) live mode calls — see
`components/AudioReplayPanel.tsx`'s file comment for the exact reuse point.

## `AudioSegment` / `AudioTimeline` (`lib/audio/types.ts`, zod-validated)

```ts
AudioSegment = {
  segmentId: string;
  startTime: number;       // seconds into the file
  endTime: number;
  transcript: string;
  topic?: string;
  mathematicalClaim?: string;
  objectsReferenced: string[];  // topics of earlier segments this one likely refers to
  visualEvents: string[];        // filled in by AudioReplayPanel as segments are applied
  confidence: number;             // Deepgram's average per-word confidence for this span
}

AudioTimeline = {
  sessionId: string;
  durationSeconds: number;
  segments: AudioSegment[];
  checkpoints: AudioCheckpoint[]; // one per ~10 segments — see docs/state-model.md
  createdAt: number;
}
```

This differs from the brief's illustrative JSON in one respect: there is no
separate `reasoning_step` field on the segment itself, because a segment's
math content is expressed as a normal `transform_equation` action (with its
own `MathReasoningStep`) once applied during replay — `visualEvents` carries
the provenance link (a short description string) back to what actually got
drawn, and every applied action still carries its own `sourceText`, which is
this segment's transcript.

## Pipeline (`lib/audio/`)

1. **`transcribe.ts`** — one Deepgram prerecorded call for the whole file
   (`deepgram.listen.prerecorded.transcribeFile`, same model — `nova-3` — and
   API key as live mode, so no new billing configuration is needed). Returns
   word-level timestamps.
2. **`chunk.ts`** — windows the WORD TIMELINE into ~12-second chronological
   chunks, extending a window slightly (up to a 3s grace period) to land on a
   sentence boundary rather than cut mid-word. **This is a deliberate
   difference from literally splitting the audio bytes** — there is no audio
   decoder dependency in this repo, and windowing the already-timestamped
   transcript achieves the same "small chronological chunks" property the
   brief asks for without one.
3. **`pipeline.ts`** — deterministic, cue-phrase-based detection (same style
   as `lib/reference.ts`'s existing back-reference detector, not an LLM call
   per chunk): `detectMathematicalClaim`, `detectTopic`,
   `detectObjectReferences`. Assembles the `AudioTimeline`. No drawing model
   is called at this stage — see below for why.
4. **Replay** (`components/AudioReplayPanel.tsx`, timed by
   `lib/audio/replayController.ts`'s `ReplayController`) — segments whose
   `startTime` has passed get applied in order, by calling `/api/artist` (or
   `/api/math` when `NEXT_PUBLIC_ENABLE_MATH_MODE` is set and the segment has
   a `mathematicalClaim`) with that segment's transcript — the exact same
   routes and the exact same `applyActions` commit path live mode uses. The
   canvas therefore stays editable throughout replay, for free.

   Playback is NOT driven by the `<audio>` element's own clock in isolation.
   `ReplayController` tracks four separate times — `audioTime` (the
   playhead), `processedThroughTime` (a draw call has been dispatched
   through here), `committedVisualTime` (a draw call has actually landed on
   the canvas through here), `bufferedThroughTime` (a response has been
   prefetched-but-not-applied through here) — and derives
   `processingLagMs = audioTime - committedVisualTime` on every tick:
   - lag < 1s: normal speed.
   - 1s–2s: `playbackRate` eases to 0.85 rather than letting the gap grow.
   - \>2s: the `<audio>` element is paused outright until the gap closes,
     then resumes automatically. A small "Catching up…" label reflects this
     — never a modal, never silence.
   - Before playback is allowed to start at all, the first
     `initialBufferSeconds` (default 6s) of segments are drawn synchronously
     (`prepareInitialBuffer`), so the audio never opens with an unrepresented
     lead.
   - The panel prefetches (fetches but does not commit) the next segment
     inside a 15s lookahead window while the current one plays, so the draw
     call's network/model latency doesn't itself contribute to lag once the
     segment becomes due.
   - Seeking or rewinding calls `ReplayController.beginSeek()`, which bumps a
     generation counter and aborts every in-flight `/api/artist`/`/api/math`
     fetch (`AbortController`, so cancelled work stops costing money, not
     just stops mattering). Any response that resolves after the bump is
     dropped rather than applied — a stale draw call can no longer paint
     over wherever the user jumped to.

## Why detection is offline but drawing is not

Running the drawing models (`/api/artist`/`/api/math`) once per ~12s chunk
during **upload** would mean paying for and waiting on the full recording's
worth of model calls before the user sees anything — the opposite of showing
progress as it plays. Instead, upload only does the cheap, deterministic
pass (topic/math/reference detection), and the actual drawing calls happen
during replay, paced by the audio's own clock — "ahead of playback when
safe" in spirit (segments are detected for the whole file up front) while
the expensive calls remain paced to what's actually being watched.

## Session requirement (verified live, not just in code)

`/api/audio/upload` is gated by the same `guardProviderRequest` lease every
provider-costing route uses (`/api/artist`, `/api/beat`, `/api/math`,
`/api/scribe`, `/api/story`) — it requires an active `usage_sessions` row via
the `x-inpublic-session-id` header, the same one established when the user
clicks "Start speaking". Verified live against the real dev server: calling
`/api/audio/upload` without that header returns the identical
`usage_session_required` 429 every other provider route returns, not a
special case. This means uploading a file for replay currently requires
starting a listening session first, even though replay itself never touches
the microphone — a UX friction point worth smoothing over in a follow-up
(e.g. a lightweight non-listening session type), not addressed this pass
because it touches the same billing/entitlement RPCs as live sessions and a
change there needs verification against the database this pass didn't have
safe access to.

## Known limitations (documented, not silently absent)

- **No audio persistence.** The uploaded file is never stored server-side;
  the browser plays it back from its own `URL.createObjectURL(file)`. Audio
  Replay does not currently survive a page reload or work across devices —
  only within the session that uploaded it. Persisting to Supabase Storage
  was judged to need bucket/policy configuration this pass couldn't safely
  verify without a live database to check against, so it's deferred rather
  than implemented against an unverified assumption.
- **Rewind does not un-draw.** Scrubbing the audio backward moves playback
  position; it does not reverse already-applied canvas operations for the
  segments after that point. A full timestamp -> `Operation`-log revert
  (walking `boardRef.current.history` back to the operation whose timestamp
  matches the new position) is a natural extension of the existing undo
  machinery but was not built this pass — see `AudioReplayPanel.tsx`'s file
  comment. `committedVisualTime` is deliberately left where it was on a
  backward seek, since the drawings themselves are still there.
- **Scrubbing forward** marks the intervening segments as already-applied
  (so `onTimeUpdate` never fires them) instead of drawing them — the
  timeline's checkpoints (`AudioTimeline.checkpoints`, one per ~10 segments)
  exist for a future "summarize what was skipped" affordance but replay does
  not yet draw a catch-up summary itself.
- **Prefetch is one segment deep**, not the whole remaining file — matches
  the existing "pay for what's being watched, not the whole recording"
  design rather than reversing it.
