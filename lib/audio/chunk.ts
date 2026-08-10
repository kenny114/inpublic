/**
 * Chronological chunking.
 *
 * We don't split the audio bytes themselves — that needs a decoder this repo
 * has no dependency on. Instead we transcribe the whole file once (Deepgram's
 * prerecorded endpoint handles long files natively and returns word-level
 * timestamps), then window the WORD TIMELINE into ~12s chunks here. This
 * still gives strictly chronological, small, timestamped pieces to feed the
 * reasoning pipeline — the property that actually matters — without ever
 * cutting a word in half the way a fixed-byte-offset split would.
 */

export interface TimedWord {
  word: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface TranscriptChunk {
  startTime: number;
  endTime: number;
  transcript: string;
  avgConfidence: number;
}

const DEFAULT_WINDOW_SECONDS = 12;

/**
 * Groups words into windows of roughly `windowSeconds`, but never splits
 * mid-sentence if a sentence-ending word is within `graceSeconds` of the
 * boundary — small distortion in chunk length in exchange for chunks that
 * read as complete thoughts, which is what topic/math detection needs.
 */
export function chunkWords(
  words: TimedWord[],
  windowSeconds = DEFAULT_WINDOW_SECONDS,
  graceSeconds = 3,
): TranscriptChunk[] {
  if (words.length === 0) return [];
  const chunks: TranscriptChunk[] = [];
  let bucket: TimedWord[] = [];
  let windowStart = words[0].start;

  const flush = () => {
    if (bucket.length === 0) return;
    const confidences = bucket.map((w) => w.confidence).filter((c): c is number => typeof c === "number");
    chunks.push({
      startTime: bucket[0].start,
      endTime: bucket[bucket.length - 1].end,
      transcript: bucket.map((w) => w.word).join(" ").trim(),
      avgConfidence: confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 1,
    });
    bucket = [];
  };

  for (const w of words) {
    bucket.push(w);
    const elapsed = w.end - windowStart;
    if (elapsed < windowSeconds) continue;
    const endsSentence = /[.!?]$/.test(w.word);
    const overshoot = elapsed - windowSeconds;
    if (endsSentence || overshoot > graceSeconds) {
      flush();
      windowStart = w.end;
    }
  }
  flush();
  return chunks;
}
