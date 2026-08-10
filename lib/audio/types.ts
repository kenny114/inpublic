/**
 * Audio Replay Mode's schema. An AudioSegment is the unit everything else in
 * this module operates on: a chronological slice of the uploaded file with
 * its own transcript, detected topic, and (if any) mathematical claim and
 * object references — enough to drive the same reasoning pipeline live mode
 * uses, just fed from a file instead of a microphone.
 */

import { z } from "zod";

export const AudioSegmentSchema = z.object({
  segmentId: z.string().min(1),
  startTime: z.number().min(0),
  endTime: z.number().min(0),
  transcript: z.string(),
  topic: z.string().optional(),
  mathematicalClaim: z.string().optional(),
  objectsReferenced: z.array(z.string()).default([]),
  /** Filled in as segments are applied during replay — provenance back to source. */
  visualEvents: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
});
export type AudioSegment = z.infer<typeof AudioSegmentSchema>;

export const AudioCheckpointSchema = z.object({
  checkpointId: z.string().min(1),
  throughSegmentIndex: z.number().int().min(0),
  topicSummary: z.string(),
  keyFacts: z.array(z.string()),
  createdAt: z.number(),
});
export type AudioCheckpoint = z.infer<typeof AudioCheckpointSchema>;

export const AudioTimelineSchema = z.object({
  sessionId: z.string().min(1),
  durationSeconds: z.number().min(0),
  segments: z.array(AudioSegmentSchema),
  checkpoints: z.array(AudioCheckpointSchema).default([]),
  createdAt: z.number(),
});
export type AudioTimeline = z.infer<typeof AudioTimelineSchema>;

export const SUPPORTED_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  // Lecture/tutorial recordings are very often video files (a screen
  // recording of a whiteboard, a Zoom capture) with no separate audio-only
  // export. Deepgram's prerecorded endpoint transcribes the audio track of
  // a video file directly — no video decoding of our own is needed — so
  // there is no reason to reject these at the door.
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
] as const;

export function isVideoContainer(mimetype: string): boolean {
  return mimetype.startsWith("video/");
}

/** Conservative — a 40-minute lecture at typical bitrates fits well under this. */
export const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
/** Video containers carry a lot more than the audio track; a lecture recording easily runs 300-500MB. */
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
