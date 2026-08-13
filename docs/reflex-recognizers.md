# Reflex recognizers

Tier 2 (`lib/speculative.ts`, wired in `components/Board.tsx`'s `handleInterim`)
runs on settled interim words — the prefix two consecutive Deepgram interims
have agreed on — never on the raw, still-revising tail. Everything below is
deterministic: regex and lookups, no model, no network.

## count

- **Trigger**: `COUNT_RE` — `"there are"` / `"there were"` / `"we have"` /
  `"i have"` / `"that's"` / `"here are"` followed by a spelled-out number
  two–seven and a plural noun.
- **Example speech**: "there are three reasons"
- **Visual**: a heading, e.g. `3 REASONS`
- **Confidence requirement**: `MIN_SPECULATIVE_CONFIDENCE` (0.6) floor, same as
  every recognizer; the regex match itself is the primary confidence signal —
  a stated count is one of the few things speech states unambiguously.
- **Stability requirement**: read from `utteranceText` (the whole settled
  utterance so far, not just the newly-settled delta), because the phrase
  spans multiple settled chunks.
- **Reconciliation**: `supersedes()` retires it the moment a real mark's text
  matches (Scribe or Artist landing "3 Reasons" or similar).
- **Retraction**: `confirmedByFinal()` — if the final transcript doesn't
  contain the counted words, the mark is retired as a mishearing.

## trend

- **Trigger**: `TREND_RE` — a subject followed by an up/down verb
  (increased, rose, grew, up, jumped, climbed, doubled / decreased, fell,
  dropped, down, declined, shrank, halved).
- **Example speech**: "revenue increased", "churn went down"
- **Visual**: `SUBJECT ↑` or `SUBJECT ↓`
- **Confidence/stability**: same as `count` — whole-utterance match, 0.6 floor.
- **Reconciliation / retraction**: same mechanism as `count`.

## title (gesture)

- **Trigger**: `detectGesture()` (`lib/sketch.ts`) recognizing a title-shaped
  opening ("today I'll talk about X", a greeting-then-topic pattern).
- **Example speech**: "Today I want to talk about distribution."
- **Visual**: the title text, lettered once.
- **Confidence/stability**: once-per-session — `gestures` in `SpeculativeState`
  prevents a second title gesture from firing even if the pattern repeats.
- **Reconciliation / retraction**: same `supersedes()` / `confirmedByFinal()`
  path as the others.

## concept (bare)

- **Trigger**: `extractConcepts()` (`lib/sketch.ts`) run on the newly-settled
  text only, `isInterim: true` — this holds back the trailing word run so a
  phrase still being spoken ("distribution chan…") doesn't get chopped into a
  premature "Distribution" that then blocks the real phrase as a duplicate.
- **Example speech**: any noun phrase ≥ `MIN_CONCEPT_LENGTH` (4 chars) not
  already on the board.
- **Visual**: a faint box (`{op: "box", text}`).
- **Confidence requirement**: the weakest of the four — this is a guess, not a
  near-certain reading, and is ordered last for exactly that reason.
- **Stability requirement**: newly-settled words only, so a speaker circling
  back to a topic doesn't restack it (`seen` set, shared across calls).
- **Reconciliation / retraction**: same mechanism as the others.

## Which of these earn their place

All four contribute to "the canvas is responding while I speak": `count` and
`trend` are near-certain and land instantly on an unambiguous phrasing;
`title` gives the very first sentence of a session a visible reaction; `concept`
is the workhorse that makes ordinary nouns show up before the Scribe would
letter them. None were removed. Part 7 adds three more (`emphasis`, `contrast`,
`cause`) using the same pattern — see `lib/speculative.ts`'s file header for
the full list and `docs/latency-deferred.md`-style notes on what was
deliberately not added (`enumeration`, `increase`/`decrease` as a distinct
kind — the latter already fully covered by `trend`).
