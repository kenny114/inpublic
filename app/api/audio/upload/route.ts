import { NextResponse } from "next/server";
import { guardProviderRequest, reconcileProviderCost, type ProviderUsage } from "@/lib/server/provider-guard";
import { transcribeAudioFile } from "@/lib/audio/transcribe";
import { chunkWords } from "@/lib/audio/chunk";
import { buildAudioTimeline } from "@/lib/audio/pipeline";
import { AudioTimelineSchema, MAX_AUDIO_BYTES, MAX_VIDEO_BYTES, SUPPORTED_AUDIO_TYPES, isVideoContainer } from "@/lib/audio/types";
import { newId } from "@/lib/semantic";

export const dynamic = "force-dynamic";

/**
 * One request: accept the file, transcribe it whole (Deepgram prerecorded
 * handles long files natively, extracting the audio track directly from a
 * video container — no video decoding of our own is involved), window the
 * word timeline into chunks, run the deterministic topic/math/reference
 * detectors, and return the resulting AudioTimeline. The audio bytes
 * themselves are never persisted server-side — the browser already holds
 * the File it uploaded and plays it back from an object URL, so there is
 * nothing to round-trip. See docs/audio-timeline-schema.md for what that
 * does and doesn't cover.
 *
 * A rough bytes-per-second estimate stands in for duration before the guard
 * can know the real one; reconcileProviderCost corrects it with the actual
 * duration Deepgram reports once transcription completes. A video file has
 * a video track alongside the audio, so the same bytes-per-second constant
 * that's reasonable for a compressed audio file would wildly overestimate a
 * video file's audio duration — hence the separate, higher constant below.
 */
const ROUGH_AUDIO_BYTES_PER_SECOND = 16_000; // ~128kbps compressed audio
const ROUGH_VIDEO_BYTES_PER_SECOND = 250_000; // ~2Mbps typical screen/lecture recording

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: { code: "invalid_request", message: "Expected multipart/form-data." } }, { status: 400 });
  }

  const file = form.get("audio");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: { code: "invalid_request", message: "No audio file provided." } }, { status: 400 });
  }
  const mimetype = file.type || "audio/mpeg";
  if (!SUPPORTED_AUDIO_TYPES.includes(mimetype as (typeof SUPPORTED_AUDIO_TYPES)[number])) {
    return NextResponse.json({ error: { code: "unsupported_type", message: `Unsupported file type: ${mimetype || "unknown"}. Upload an audio file (mp3, wav, m4a, ogg) or a video file (mp4, webm, mov, mkv).` } }, { status: 400 });
  }
  const isVideo = isVideoContainer(mimetype);
  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_AUDIO_BYTES;
  if (file.size === 0 || file.size > maxBytes) {
    return NextResponse.json({ error: { code: "invalid_file", message: `File must be under ${maxBytes / 1024 / 1024}MB.` } }, { status: 400 });
  }

  const roughBytesPerSecond = isVideo ? ROUGH_VIDEO_BYTES_PER_SECOND : ROUGH_AUDIO_BYTES_PER_SECOND;
  const estimatedSeconds = Math.max(1, Math.round(file.size / roughBytesPerSecond));
  const guard = await guardProviderRequest(req, {
    feature: "audio",
    provider: "deepgram",
    model: "nova-3",
    audioSeconds: estimatedSeconds,
  });
  if (guard instanceof Response) return guard;
  const usage: ProviderUsage = {};

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { words, durationSeconds } = await transcribeAudioFile(buffer, mimetype);
    const chunks = chunkWords(words);
    const timeline = buildAudioTimeline(newId("audio-session"), chunks, durationSeconds);
    const validated = AudioTimelineSchema.parse(timeline);

    await reconcileProviderCost(guard, "succeeded", { ...usage, audioSeconds: durationSeconds });
    return NextResponse.json({ timeline: validated });
  } catch (err) {
    await reconcileProviderCost(guard, "failed", usage);
    console.error("[audio/upload]", err);
    return NextResponse.json(
      { error: { code: "transcription_failed", message: "Could not process this audio file." } },
      { status: 502 },
    );
  }
}
