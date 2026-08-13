-- True wall-clock speech->ink columns.
--
-- lag_p50_ms/lag_p95_ms/lag_max_ms (from the original migration) are computed
-- against Deepgram's self-reported audio timeline (start/duration), which
-- Deepgram's own docs say should not be used for precise latency measurement.
-- Real mic testing proved the pipeline is fast (~27ms P50, ~106ms P95 chunk
-- to message) but that could not be seen in lag_p50_ms because it was never a
-- wall-clock number. These columns hold the true measurement: wall-clock time
-- from the last audio chunk sent to ink committed, with no dependency on
-- Deepgram's audio-timeline math anywhere in the computation (see
-- lib/telemetry.ts's chunkToInkSample and LATENCY-AUDIT.md).
--
-- Additive only — no existing column is renamed or dropped, so no backfill.

alter table public.latency_samples
  add column if not exists chunk_to_ink_p50_ms integer check (chunk_to_ink_p50_ms >= 0),
  add column if not exists chunk_to_ink_p95_ms integer check (chunk_to_ink_p95_ms >= 0),
  add column if not exists chunk_to_ink_max_ms integer check (chunk_to_ink_max_ms >= 0);
