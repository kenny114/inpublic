-- Root-cause columns for the Speech -> Ink investigation.
--
-- The original latency_samples table could only say "audio end to ink took
-- 4.4s" — it could not say whether that 4.4s was Deepgram taking a long time
-- to respond, or InPublic sitting on a response it already had. These columns
-- hold a second, independent measurement (wall-clock time from the last
-- audio chunk sent to any message arriving, with no dependency on Deepgram's
-- self-reported audio-timeline math) plus a small raw trace of one real
-- utterance, so a single sentence's development can be reconstructed rather
-- than only ever seen as a percentile.
--
-- Same rules as the original table: every measurement column is nullable,
-- writes go through the service role, and this must never be able to block
-- or rate-limit a listening session.

alter table public.latency_samples
  add column if not exists chunk_to_message_p50_ms integer check (chunk_to_message_p50_ms >= 0),
  add column if not exists chunk_to_message_p95_ms integer check (chunk_to_message_p95_ms >= 0),
  add column if not exists chunk_to_message_max_ms integer check (chunk_to_message_max_ms >= 0),
  add column if not exists speech_onset_to_raw_interim_p50_ms integer check (speech_onset_to_raw_interim_p50_ms >= 0),
  add column if not exists speech_onset_to_raw_interim_p95_ms integer check (speech_onset_to_raw_interim_p95_ms >= 0),
  add column if not exists traces jsonb;
