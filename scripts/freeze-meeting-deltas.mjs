/**
 * One-off capture: runs the real extractor over the unmodified 118-turn
 * meeting transcript ONCE and writes the resulting sanitized MeaningDelta
 * per turn to a versioned, frozen fixture file.
 *
 * This exists so later identity-layer changes can be compared against the
 * SAME input every time, instead of two separate live conversations (which
 * is what made the hardening-pass-2 before/after numbers noisier than they
 * needed to be — extraction itself is non-deterministic turn to turn, even
 * at temperature 0, and that noise was indistinguishable from the effect of
 * the code change being tested). Freezing extraction removes the dominant
 * noise source; only the identity judge's own model call remains as a
 * (much smaller) source of run-to-run variance in later comparisons.
 *
 * Uses ExpressionSession.ingest with the identity layer OFF — the capture
 * only wants the raw extracted delta per turn, which the identity layer
 * never influences (it decides entity IDENTITY downstream, not what the
 * extractor said this segment means).
 *
 * Requires ANTHROPIC_API_KEY. Run once per fixture version; the output is
 * committed and every later replay reads it back with no network at all.
 *
 *   node --no-warnings --import ./scripts/ts-register.mjs scripts/freeze-meeting-deltas.mjs
 */

import { writeFileSync } from "node:fs";
import { ExpressionSession } from "../lib/expression/pipeline.ts";
import { extractMeaning } from "../lib/expression/meaning/extract.ts";
import { MEETING_TRANSCRIPT } from "./fixtures/meeting-transcript.mjs";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set — this script makes real model calls and cannot run without it.");
  process.exit(1);
}

const VERSION = "v1";
const OUT_FILE = `scripts/fixtures/meeting-transcript-deltas-${VERSION}.mjs`;

const session = new ExpressionSession({ extract: (text, recent) => extractMeaning(text, recent), enableIdentityLayer: false });

const captured = [];
for (const [index, turn] of MEETING_TRANSCRIPT.entries()) {
  const segment = { id: `mt-${index}`, source: "human_speech", text: turn.text, seq: index, speakerId: turn.speaker, timestamp: turn.t };
  const trace = await session.ingest(segment);
  captured.push({ index, speaker: turn.speaker, t: turn.t, text: turn.text, tags: turn.tags, delta: trace.delta });
  console.log(`captured turn ${index + 1}/${MEETING_TRANSCRIPT.length}: "${turn.text.slice(0, 60)}${turn.text.length > 60 ? "…" : ""}"`);
}

const header = `/**
 * FROZEN sanitized-delta fixture, version ${VERSION} — the real extractor's
 * output for every turn of scripts/fixtures/meeting-transcript.mjs, captured
 * once (see scripts/freeze-meeting-deltas.mjs) and committed so every later
 * replay is deterministic: same input, every run, no network. The transcript
 * text/speaker/timestamp fields are duplicated here (not just an index into
 * meeting-transcript.mjs) so this fixture stays meaningful even if that file
 * changes later — a frozen version should never silently drift.
 *
 * Regenerate ONLY by re-running scripts/freeze-meeting-deltas.mjs and
 * bumping the version — never hand-edit a captured delta.
 */

export const MEETING_DELTAS_V1 = `;

writeFileSync(OUT_FILE, `${header}${JSON.stringify(captured, null, 2)};\n`);
console.log(`\nWrote ${captured.length} frozen deltas to ${OUT_FILE}`);
