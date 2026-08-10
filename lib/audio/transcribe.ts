import "server-only";

import { createClient } from "@deepgram/sdk";
import type { TimedWord } from "./chunk";

export interface TranscribeResult {
  words: TimedWord[];
  fullTranscript: string;
  durationSeconds: number;
}

/**
 * One prerecorded call for the whole file. Reuses the same Deepgram project
 * key as live mode (app/api/deepgram/token/route.ts) and the same model
 * ("nova-3") so no new provider_rate_cards row is needed for billing.
 */
export async function transcribeAudioFile(
  buffer: Buffer,
  mimetype: string,
): Promise<TranscribeResult> {
  const rootKey = process.env.DEEPGRAM_API_KEY;
  if (!rootKey) throw new Error("DEEPGRAM_API_KEY is not set");

  const deepgram = createClient(rootKey);
  const { result, error } = await deepgram.listen.prerecorded.transcribeFile(buffer, {
    model: "nova-3",
    smart_format: true,
    punctuate: true,
    mimetype,
  });

  if (error) throw new Error(`deepgram prerecorded transcription failed: ${String(error)}`);

  const alternative = result?.results?.channels?.[0]?.alternatives?.[0];
  const words: TimedWord[] = (alternative?.words ?? []).map((w) => ({
    word: w.punctuated_word ?? w.word,
    start: w.start,
    end: w.end,
    confidence: w.confidence,
  }));

  return {
    words,
    fullTranscript: alternative?.transcript ?? "",
    durationSeconds: result?.metadata?.duration ?? (words.at(-1)?.end ?? 0),
  };
}
