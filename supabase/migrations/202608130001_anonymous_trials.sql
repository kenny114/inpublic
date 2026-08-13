-- Anonymous trial sessions for the /try flow. Deliberately isolated from
-- usage_periods/usage_sessions (the paid-account ledger): an anonymous
-- visitor never touches those tables, so nothing here can corrupt existing
-- free/paid accounting. Claiming a trial (see claim_anonymous_trial) is a
-- bookkeeping/analytics marker only — the actual recording/board is re-keyed
-- to the new account client-side via the existing /api/projects path, not
-- transferred through this table.
--
-- One row per anon_id (the opaque cookie value minted on first /try visit),
-- holding a single allowance and at most one active lease at a time, mirroring
-- the shape of usage_sessions/usage_periods without their monthly recurrence
-- (a trial doesn't renew).
create table public.anonymous_trials (
  id uuid primary key default gen_random_uuid(),
  anon_id text not null unique check (char_length(anon_id) between 16 and 128),
  ip_hash text not null check (char_length(ip_hash) = 64),
  allowance_seconds integer not null check (allowance_seconds > 0),
  consumed_seconds integer not null default 0 check (consumed_seconds >= 0),
  reserved_seconds integer not null default 0 check (reserved_seconds >= 0),
  lease_status text not null default 'idle' check (lease_status in ('idle','active')),
  lease_expires_at timestamptz,
  started_at timestamptz,
  last_heartbeat_at timestamptz,
  ended_at timestamptz,
  termination_reason text,
  claimed_by_user_id uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (consumed_seconds + reserved_seconds <= allowance_seconds)
);
create index anonymous_trials_ip_hash_idx on public.anonymous_trials(ip_hash, created_at desc);
create index anonymous_trials_lease_idx on public.anonymous_trials(lease_expires_at) where lease_status = 'active';
create trigger anonymous_trials_updated before update on public.anonymous_trials for each row execute function public.set_updated_at();

alter table public.anonymous_trials enable row level security;
-- No anon/authenticated policies: identical posture to usage_sessions et al.
-- The /try client never talks to Supabase directly — every read/write goes
-- through our own API routes using the service role, same as every other
-- spend-adjacent table in this schema.
revoke all on public.anonymous_trials from anon, authenticated;
grant all on public.anonymous_trials to service_role;

-- Same lease-reservation shape as start_usage_session, minus the recurring
-- usage_period: a trial has exactly one allowance, ever, for its anon_id.
-- Also enforces a soft per-IP cap (distinct anon_ids from the same hashed IP
-- within 24h) so clearing cookies alone doesn't grant unlimited trials —
-- combined with, not a replacement for, per-anon_id/per-IP rate limiting via
-- the existing consume_rate_limit RPC at the request layer.
create or replace function public.start_anonymous_trial(
  p_anon_id text, p_ip_hash text, p_allowance_seconds integer,
  p_lease_seconds integer default 30, p_ip_daily_limit integer default 3
) returns public.anonymous_trials language plpgsql security definer set search_path = '' as $$
declare t public.anonymous_trials%rowtype; reserve_seconds integer; remaining integer; distinct_ids integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_anon_id, 0));
  select * into t from public.anonymous_trials where anon_id = p_anon_id for update;
  if not found then
    select count(distinct anon_id) into distinct_ids from public.anonymous_trials
      where ip_hash = p_ip_hash and created_at > clock_timestamp() - interval '24 hours';
    if distinct_ids >= p_ip_daily_limit then
      raise exception using errcode = 'P0021', message = 'ip_trial_limit';
    end if;
    insert into public.anonymous_trials(anon_id, ip_hash, allowance_seconds)
    values (p_anon_id, p_ip_hash, greatest(1, p_allowance_seconds))
    returning * into t;
  end if;
  if t.lease_status = 'active' and t.lease_expires_at > clock_timestamp() then
    raise exception using errcode = 'P0002', message = 'active_session_conflict';
  end if;
  if t.lease_status = 'active' and t.lease_expires_at <= clock_timestamp() then
    update public.anonymous_trials set consumed_seconds = consumed_seconds + reserved_seconds,
      reserved_seconds = 0, lease_status = 'idle', lease_expires_at = null
      where id = t.id returning * into t;
  end if;
  remaining := greatest(0, t.allowance_seconds - t.consumed_seconds - t.reserved_seconds);
  if remaining <= 0 then raise exception using errcode = 'P0003', message = 'quota_exhausted'; end if;
  reserve_seconds := least(greatest(5, p_lease_seconds), remaining);
  update public.anonymous_trials set
    reserved_seconds = reserved_seconds + reserve_seconds,
    lease_status = 'active',
    lease_expires_at = clock_timestamp() + make_interval(secs => reserve_seconds),
    started_at = coalesce(started_at, clock_timestamp()),
    last_heartbeat_at = clock_timestamp()
    where id = t.id returning * into t;
  return t;
end $$;

create or replace function public.renew_anonymous_trial(p_anon_id text, p_lease_seconds integer default 30)
returns public.anonymous_trials language plpgsql security definer set search_path = '' as $$
declare t public.anonymous_trials%rowtype; elapsed integer; next_reserve integer;
begin
  select * into t from public.anonymous_trials where anon_id = p_anon_id for update;
  if not found or t.lease_status <> 'active' or t.lease_expires_at <= clock_timestamp() then
    raise exception using errcode = 'P0004', message = 'expired_lease';
  end if;
  elapsed := least(t.reserved_seconds, greatest(0, floor(extract(epoch from (clock_timestamp() - t.last_heartbeat_at)))::integer));
  next_reserve := least(greatest(5, p_lease_seconds), greatest(0, t.allowance_seconds - t.consumed_seconds - elapsed));
  update public.anonymous_trials set
    consumed_seconds = consumed_seconds + elapsed,
    reserved_seconds = next_reserve,
    last_heartbeat_at = clock_timestamp(),
    lease_expires_at = clock_timestamp() + make_interval(secs => next_reserve),
    lease_status = case when next_reserve = 0 then 'idle' else 'active' end,
    ended_at = case when next_reserve = 0 then clock_timestamp() else ended_at end,
    termination_reason = case when next_reserve = 0 then 'limit_reached' else termination_reason end
    where id = t.id returning * into t;
  return t;
end $$;

create or replace function public.end_anonymous_trial(p_anon_id text, p_reason text default 'user_stopped')
returns public.anonymous_trials language plpgsql security definer set search_path = '' as $$
declare t public.anonymous_trials%rowtype; elapsed integer;
begin
  select * into t from public.anonymous_trials where anon_id = p_anon_id for update;
  if not found then raise exception 'trial_not_found'; end if;
  if t.lease_status <> 'active' then return t; end if;
  elapsed := least(t.reserved_seconds, greatest(0, floor(extract(epoch from (least(clock_timestamp(), t.lease_expires_at) - t.last_heartbeat_at)))::integer));
  update public.anonymous_trials set
    consumed_seconds = consumed_seconds + elapsed,
    reserved_seconds = 0,
    lease_status = 'idle',
    ended_at = clock_timestamp(),
    termination_reason = left(p_reason, 80)
    where id = t.id returning * into t;
  return t;
end $$;

-- Bookkeeping only, see header comment — never moves seconds into
-- usage_periods and never touches projects/recordings.
create or replace function public.claim_anonymous_trial(p_anon_id text, p_user_id uuid)
returns public.anonymous_trials language plpgsql security definer set search_path = '' as $$
declare t public.anonymous_trials%rowtype;
begin
  update public.anonymous_trials set claimed_by_user_id = p_user_id, claimed_at = clock_timestamp()
    where anon_id = p_anon_id and claimed_by_user_id is null returning * into t;
  if not found then raise exception 'trial_not_found_or_already_claimed'; end if;
  return t;
end $$;

revoke all on function public.start_anonymous_trial(text,text,integer,integer,integer) from public, anon, authenticated;
revoke all on function public.renew_anonymous_trial(text,integer) from public, anon, authenticated;
revoke all on function public.end_anonymous_trial(text,text) from public, anon, authenticated;
revoke all on function public.claim_anonymous_trial(text,uuid) from public, anon, authenticated;
grant execute on function public.start_anonymous_trial(text,text,integer,integer,integer) to service_role;
grant execute on function public.renew_anonymous_trial(text,integer) to service_role;
grant execute on function public.end_anonymous_trial(text,text) to service_role;
grant execute on function public.claim_anonymous_trial(text,uuid) to service_role;

create or replace function public.expire_abandoned_anonymous_trials() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer := 0;
begin
  with expired as (
    update public.anonymous_trials set
      consumed_seconds = consumed_seconds + reserved_seconds,
      reserved_seconds = 0,
      lease_status = 'idle',
      ended_at = coalesce(ended_at, clock_timestamp()),
      termination_reason = coalesce(termination_reason, 'lease_expired')
      where lease_status = 'active' and lease_expires_at <= clock_timestamp()
      returning 1
  ) select count(*) into n from expired;
  return n;
end $$;
revoke all on function public.expire_abandoned_anonymous_trials() from public, anon, authenticated;
grant execute on function public.expire_abandoned_anonymous_trials() to service_role;
