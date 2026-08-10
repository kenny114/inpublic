import { NextResponse } from "next/server";
import { guardProviderRequest, reconcileProviderCost, type ProviderUsage } from "@/lib/server/provider-guard";
import { transcribeAudioFile } from "@/lib/audio/transcribe";
import { chunkWords } from "@/lib/audio/chunk";
import { buildAudioTimeline } from "@/lib/audio/pipeline";
import { AudioTimelineSchema, MAX_AUDIO_BYTES, MAX_VIDEO_BYTES, SUPPORTED_AUDIO_TYPES, isVideoContainer } from "@/lib/audio/types";
import { newId } from "@/lib/semantic";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const LECTURE_UPLOADS_BUCKET = "lecture-uploads";

/**
 * The browser uploads the file directly to Supabase Storage (RLS-scoped to
 * its own user folder — see supabase/migrations/202608100001_lecture_upload_storage.sql)
 * and hands this route a storage path instead of the raw bytes. Vercel
 * Functions cap a request body at 4.5MB, well under a real lecture
 * recording, so the file could never have made it here as a direct upload.
 *
 * This route downloads the object with the service role key (bypassing
 * RLS — the object is otherwise write-only from the client's perspective),
 * transcribes it, and ALWAYS deletes it afterward regardless of outcome —
 * the file is never held any longer than one upload-transcribe cycle, same
 * spirit as this route's original "audio bytes are never persisted
 * server-side" design, just with an unavoidable storage hop in between now.
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

interface UploadRequestBody {
  storagePath?: string;
  mimetype?: string;
  sizeBytes?: number;
}

export async function POST(req: Request) {
  let body: UploadRequestBody;
  try {
    body = (await req.json()) as UploadRequestBody;
  } catch {
    return NextResponse.json({ error: { code: "invalid_request", message: "Expected JSON." } }, { status: 400 });
  }

  const storagePath = body.storagePath;
  if (!storagePath || typeof storagePath !== "string") {
    return NextResponse.json({ error: { code: "invalid_request", message: "No storage path provided." } }, { status: 400 });
  }

  const admin = createAdminClient();
  // Deletion is attempted on every exit path from here down — the client
  // can upload into this bucket but has no delete grant (see the RLS
  // policy), so the server is the only thing that can ever clean it up.
  try {
    const mimetype = body.mimetype || "audio/mpeg";
    if (!SUPPORTED_AUDIO_TYPES.includes(mimetype as (typeof SUPPORTED_AUDIO_TYPES)[number])) {
      return NextResponse.json({ error: { code: "unsupported_type", message: `Unsupported file type: ${mimetype || "unknown"}. Upload an audio file (mp3, wav, m4a, ogg) or a video file (mp4, webm, mov, mkv).` } }, { status: 400 });
    }

    const guard = await guardProviderRequest(req, {
      feature: "audio",
      provider: "deepgram",
      model: "nova-3",
      audioSeconds: Math.max(
        1,
        Math.round((body.sizeBytes ?? 0) / (isVideoContainer(mimetype) ? ROUGH_VIDEO_BYTES_PER_SECOND : ROUGH_AUDIO_BYTES_PER_SECOND)),
      ),
    });
    if (guard instanceof Response) return guard;

    // The RLS policy already scopes uploads to "{ownUserId}/...", but that
    // only constrains what the client COULD have written — verify the
    // authenticated caller of THIS request actually owns the path it's
    // asking the server to process, rather than trusting the client-supplied
    // string outright.
    if (!storagePath.startsWith(`${guard.userId}/`)) {
      return NextResponse.json({ error: { code: "forbidden", message: "That upload does not belong to this session." } }, { status: 403 });
    }

    const usage: ProviderUsage = {};
    try {
      const { data: blob, error: downloadError } = await admin.storage.from(LECTURE_UPLOADS_BUCKET).download(storagePath);
      if (downloadError || !blob) throw new Error(downloadError?.message ?? "download failed");

      const isVideo = isVideoContainer(mimetype);
      const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_AUDIO_BYTES;
      if (blob.size === 0 || blob.size > maxBytes) {
        return NextResponse.json({ error: { code: "invalid_file", message: `File must be under ${maxBytes / 1024 / 1024}MB.` } }, { status: 400 });
      }

      const buffer = Buffer.from(await blob.arrayBuffer());
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
  } finally {
    await admin.storage.from(LECTURE_UPLOADS_BUCKET).remove([storagePath]).catch((err) => {
      console.error("[audio/upload] cleanup failed", err);
    });
  }
}
