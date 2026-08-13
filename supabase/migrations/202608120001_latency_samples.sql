-- Durable latency telemetry for the live speech path.
--
-- The board already computed interim lag, render time, paint time and chunk
-- cadence per utterance; all of it died with the tab. This table is where it
-- goes so that "is the board getting faster?" is answerable from data rather
-- than from memory.
--
-- Deliberately NOT on the provider-cost path: these rows cost nothing to
-- write, are not billable, and must never be able to block or rate-limit a
-- listening session. The route that writes them requires a valid session
-- lease purely so rows can be attributed and so an unauthenticated caller
-- cannot fill the table.
--
-- Every measurement column is nullable on purpose. A null means "this session
-- never produced that measurement", which is a real and useful answer. Writing
-- a zero instead would quietly turn a missing measurement into a fast one.

create table if not exists public.latency_samples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.usage_sessions(id) on delete set null,
  created_at timestamptz not null default now(),
  mode text not null default 'standard' check (mode in ('standard','story')),
  interim_count integer not null default 0 check (interim_count >= 0),

  -- startup
  press_to_listening_ms integer check (press_to_listening_ms >= 0),
  press_to_mic_permission_ms integer check (press_to_mic_permission_ms >= 0),
  press_to_lease_ready_ms integer check (press_to_lease_ready_ms >= 0),
  press_to_token_ready_ms integer check (press_to_token_ready_ms >= 0),
  socket_to_first_interim_ms integer check (socket_to_first_interim_ms >= 0),

  -- tier 1, live ink
  lag_p50_ms integer check (lag_p50_ms >= 0),
  lag_p95_ms integer check (lag_p95_ms >= 0),
  lag_max_ms integer check (lag_max_ms >= 0),
  render_p50_ms integer check (render_p50_ms >= 0),
  paint_p50_ms integer check (paint_p50_ms >= 0),
  paint_p95_ms integer check (paint_p95_ms >= 0),

  -- provider / transport
  final_lag_p50_ms integer check (final_lag_p50_ms >= 0),
  interim_lag_p50_ms integer check (interim_lag_p50_ms >= 0),
  interim_lag_p95_ms integer check (interim_lag_p95_ms >= 0),
  chunk_gap_p50_ms integer check (chunk_gap_p50_ms >= 0),
  chunk_gap_p95_ms integer check (chunk_gap_p95_ms >= 0),
  first_visible_word_ms integer check (first_visible_word_ms >= 0),

  -- tiers 2 and 3
  speech_to_speculative_p50_ms integer check (speech_to_speculative_p50_ms >= 0),
  speech_to_scribe_p50_ms integer check (speech_to_scribe_p50_ms >= 0),
  speech_to_structure_p50_ms integer check (speech_to_structure_p50_ms >= 0),
  scribe_request_wait_p50_ms integer check (scribe_request_wait_p50_ms >= 0),
  scribe_first_op_p50_ms integer check (scribe_first_op_p50_ms >= 0)
);

create index if not exists latency_samples_user_created_idx
  on public.latency_samples(user_id, created_at desc);
create index if not exists latency_samples_session_idx
  on public.latency_samples(session_id);

alter table public.latency_samples enable row level security;

-- Readable by the person who produced it; writes go through the service role
-- in the route handler, which is what enforces the lease check.
drop policy if exists latency_samples_select_own on public.latency_samples;
create policy latency_samples_select_own on public.latency_samples
  for select using (auth.uid() = user_id);
