-- InPublic production foundation. Apply with the Supabase CLI; never run from the browser.
create extension if not exists pgcrypto;

create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = timezone('utc', now()); return new; end $$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text check (char_length(display_name) <= 80),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled visual session' check (char_length(title) between 1 and 120),
  mode text not null default 'standard' check (mode in ('standard','story')),
  canvas_json jsonb not null default '{}'::jsonb,
  transcript_json jsonb not null default '[]'::jsonb,
  preview_data text check (octet_length(preview_data) <= 262144),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_opened_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  constraint project_payload_limit check (
    pg_column_size(canvas_json) + pg_column_size(transcript_json) <= 4194304
  )
);
create index projects_user_updated_idx on public.projects(user_id, updated_at desc) where deleted_at is null;

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'whop' check (provider = 'whop'),
  provider_customer_id text,
  provider_membership_id text unique,
  provider_plan_id text,
  status text not null,
  plan text not null check (plan in ('free','creator')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  provider_updated_at timestamptz,
  last_verified_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create unique index subscriptions_one_current_per_user on public.subscriptions(user_id, provider);

create table public.usage_periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null check (plan in ('free','creator')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  allowance_seconds integer not null check (allowance_seconds in (1800,12000)),
  consumed_seconds integer not null default 0 check (consumed_seconds >= 0),
  reserved_seconds integer not null default 0 check (reserved_seconds >= 0),
  estimated_cost_usd numeric(14,6) not null default 0 check (estimated_cost_usd >= 0),
  actual_cost_usd numeric(14,6) not null default 0 check (actual_cost_usd >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique(user_id, period_start, period_end),
  check (period_end > period_start),
  check (consumed_seconds + reserved_seconds <= allowance_seconds)
);

create table public.usage_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_period_id uuid not null references public.usage_periods(id) on delete restrict,
  project_id uuid references public.projects(id) on delete set null,
  mode text not null check (mode in ('standard','story')),
  status text not null check (status in ('active','paused','ended','expired','blocked')),
  started_at timestamptz not null default timezone('utc', now()),
  last_heartbeat_at timestamptz not null default timezone('utc', now()),
  lease_expires_at timestamptz not null,
  ended_at timestamptz,
  consumed_seconds integer not null default 0 check (consumed_seconds >= 0),
  reserved_seconds integer not null default 0 check (reserved_seconds >= 0),
  estimated_cost_usd numeric(14,6) not null default 0 check (estimated_cost_usd >= 0),
  actual_cost_usd numeric(14,6) not null default 0 check (actual_cost_usd >= 0),
  termination_reason text,
  client_session_id text not null check (char_length(client_session_id) between 1 and 128),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create unique index one_active_usage_session_per_user on public.usage_sessions(user_id)
  where status in ('active','paused');
create unique index usage_client_session_id on public.usage_sessions(user_id, client_session_id);
create index usage_sessions_lease_idx on public.usage_sessions(lease_expires_at) where status = 'active';

create table public.provider_rate_cards (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model text not null,
  unit text not null,
  input_rate_usd numeric(18,9) not null default 0,
  output_rate_usd numeric(18,9) not null default 0,
  audio_rate_usd numeric(18,9) not null default 0,
  cache_creation_rate_usd numeric(18,9) not null default 0,
  cache_read_rate_usd numeric(18,9) not null default 0,
  effective_start timestamptz not null,
  effective_end timestamptz,
  source_url text not null,
  last_verified_date date not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique(provider, model, unit, effective_start)
);

create table public.cost_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default timezone('utc', now()),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  session_id uuid references public.usage_sessions(id) on delete set null,
  feature text not null,
  provider text not null,
  model text not null,
  provider_request_id text,
  attempt integer not null default 1 check (attempt > 0),
  status text not null check (status in ('reserved','succeeded','failed','aborted','blocked')),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cache_creation_input_tokens integer not null default 0 check (cache_creation_input_tokens >= 0),
  cache_read_input_tokens integer not null default 0 check (cache_read_input_tokens >= 0),
  audio_input_seconds numeric(14,3) not null default 0 check (audio_input_seconds >= 0),
  request_bytes integer not null default 0 check (request_bytes >= 0),
  response_bytes integer not null default 0 check (response_bytes >= 0),
  compute_ms integer not null default 0 check (compute_ms >= 0),
  quantity numeric(18,6) not null default 0 check (quantity >= 0),
  unit text not null,
  unit_price_usd numeric(18,9) not null default 0 check (unit_price_usd >= 0),
  reserved_cost_usd numeric(14,6) not null default 0 check (reserved_cost_usd >= 0),
  estimated_cost_usd numeric(14,6) not null default 0 check (estimated_cost_usd >= 0),
  actual_cost_usd numeric(14,6) not null default 0 check (actual_cost_usd >= 0),
  rate_card_version uuid references public.provider_rate_cards(id),
  idempotency_key text not null unique,
  metadata_json jsonb not null default '{}'::jsonb
);
create index cost_events_user_day_idx on public.cost_events(user_id, occurred_at desc);
create index cost_events_session_idx on public.cost_events(session_id, occurred_at desc);

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  whop_event_id text not null unique,
  event_type text not null,
  membership_id text,
  user_id uuid references auth.users(id) on delete set null,
  gross_amount numeric(14,6),
  fees numeric(14,6),
  affiliate_amount numeric(14,6),
  net_amount numeric(14,6),
  currency text,
  status text,
  provider_timestamp timestamptz not null,
  received_timestamp timestamptz not null default timezone('utc', now()),
  processed_timestamp timestamptz,
  sanitized_payload_json jsonb not null default '{}'::jsonb
);

create table public.rate_limit_buckets (
  scope text not null,
  subject_hash text not null,
  window_start timestamptz not null,
  window_seconds integer not null check (window_seconds > 0),
  count integer not null default 0 check (count >= 0),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key(scope, subject_hash, window_start)
);

create table public.system_budget_periods (
  id uuid primary key default gen_random_uuid(),
  period_type text not null check (period_type in ('hour','day','month')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  reserved_spend numeric(14,6) not null default 0 check (reserved_spend >= 0),
  estimated_spend numeric(14,6) not null default 0 check (estimated_spend >= 0),
  actual_spend numeric(14,6) not null default 0 check (actual_spend >= 0),
  budget_limit numeric(14,6) not null check (budget_limit > 0),
  emergency_stop boolean not null default false,
  updated_at timestamptz not null default timezone('utc', now()),
  unique(period_type, period_start)
);

create table public.security_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default timezone('utc', now()),
  user_id uuid references auth.users(id) on delete set null,
  session_id uuid references public.usage_sessions(id) on delete set null,
  event_type text not null,
  feature text,
  reason_code text not null,
  metadata_json jsonb not null default '{}'::jsonb
);

-- Current public list prices, effective 2026-08-09. Rates are per token or second.
insert into public.provider_rate_cards(provider, model, unit, input_rate_usd, output_rate_usd, cache_creation_rate_usd, cache_read_rate_usd, effective_start, source_url, last_verified_date) values
('anthropic','claude-haiku-4-5-20251001','token',0.000001,0.000005,0.00000125,0.00000010,'2026-08-09','https://platform.claude.com/docs/en/about-claude/pricing','2026-08-09'),
('anthropic','claude-sonnet-4-6','token',0.000003,0.000015,0.00000375,0.00000030,'2026-08-09','https://platform.claude.com/docs/en/about-claude/pricing','2026-08-09'),
('deepgram','nova-3','audio_second',0,0,0,0,'2026-08-09','https://deepgram.com/pricing','2026-08-09'),
('google','gemini-3.1-flash-live-preview','audio_second',0,0,0,0,'2026-08-09','https://ai.google.dev/gemini-api/docs/pricing','2026-08-09');
update public.provider_rate_cards set audio_rate_usd = 0.0090 / 60 where provider='deepgram' and model='nova-3'; -- $0.0077 + $0.0013 keyterm, conservatively rounded
update public.provider_rate_cards set audio_rate_usd = 0.005 / 60 where provider='google' and model='gemini-3.1-flash-live-preview';

create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id,email,display_name)
  values(new.id, coalesce(new.email,''), nullif(left(new.raw_user_meta_data->>'display_name',80),''));
  return new;
end $$;
create trigger auth_user_profile after insert on auth.users for each row execute function public.handle_new_auth_user();

create trigger profiles_updated before update on public.profiles for each row execute function public.set_updated_at();
create trigger projects_updated before update on public.projects for each row execute function public.set_updated_at();
create trigger subscriptions_updated before update on public.subscriptions for each row execute function public.set_updated_at();
create trigger usage_periods_updated before update on public.usage_periods for each row execute function public.set_updated_at();
create trigger usage_sessions_updated before update on public.usage_sessions for each row execute function public.set_updated_at();

-- RLS: authenticated users can only reach their own durable product data.
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.subscriptions enable row level security;
alter table public.usage_periods enable row level security;
alter table public.usage_sessions enable row level security;
alter table public.cost_events enable row level security;
alter table public.provider_rate_cards enable row level security;
alter table public.payment_events enable row level security;
alter table public.rate_limit_buckets enable row level security;
alter table public.system_budget_periods enable row level security;
alter table public.security_events enable row level security;

create policy profile_select_own on public.profiles for select using ((select auth.uid()) = id);
create policy profile_update_own on public.profiles for update using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy project_select_own on public.projects for select using ((select auth.uid()) = user_id);
create policy project_insert_own on public.projects for insert with check ((select auth.uid()) = user_id);
create policy project_update_own on public.projects for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy subscription_select_own on public.subscriptions for select using ((select auth.uid()) = user_id);
create policy usage_period_select_own on public.usage_periods for select using ((select auth.uid()) = user_id);
create policy usage_session_select_own on public.usage_sessions for select using ((select auth.uid()) = user_id);

-- No direct user policies exist for ledgers, rate cards, payment events, limits,
-- budgets or security events. Only the service role can read/write them.
revoke all on public.profiles,public.projects,public.subscriptions,public.usage_periods,public.usage_sessions,
  public.cost_events,public.provider_rate_cards,public.payment_events,public.rate_limit_buckets,
  public.system_budget_periods,public.security_events from anon,authenticated;
grant select on public.profiles to authenticated;
grant update(display_name) on public.profiles to authenticated;
grant select on public.projects to authenticated;
grant insert(id,user_id,title,mode,canvas_json,transcript_json,preview_data,last_opened_at) on public.projects to authenticated;
grant update(title,mode,canvas_json,transcript_json,preview_data,last_opened_at,deleted_at) on public.projects to authenticated;
grant select on public.subscriptions,public.usage_periods,public.usage_sessions to authenticated;
grant all on public.profiles,public.projects,public.subscriptions,public.usage_periods,public.usage_sessions,
  public.cost_events,public.provider_rate_cards,public.payment_events,public.rate_limit_buckets,
  public.system_budget_periods,public.security_events to service_role;

-- Append-only ledgers: even privileged callers may not mutate historical rows.
create or replace function public.prevent_ledger_mutation() returns trigger
language plpgsql set search_path = '' as $$ begin raise exception 'append-only ledger'; end $$;
create trigger cost_events_append_only before update or delete on public.cost_events for each row execute function public.prevent_ledger_mutation();
create trigger payment_events_append_only before update or delete on public.payment_events for each row execute function public.prevent_ledger_mutation();

-- Atomic, cross-instance fixed-window limiter. Call through the service role.
create or replace function public.consume_rate_limit(
  p_scope text, p_subject_hash text, p_window_seconds integer, p_limit integer
) returns table(allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql security definer set search_path = '' as $$
declare v_start timestamptz; v_count integer;
begin
  if p_limit < 1 or p_window_seconds < 1 then raise exception 'invalid rate limit'; end if;
  v_start := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limit_buckets(scope,subject_hash,window_start,window_seconds,count)
  values(p_scope,p_subject_hash,v_start,p_window_seconds,1)
  on conflict(scope,subject_hash,window_start) do update set count=public.rate_limit_buckets.count+1,updated_at=clock_timestamp()
  returning count into v_count;
  return query select v_count <= p_limit, greatest(0,p_limit-v_count), greatest(1,ceil(extract(epoch from (v_start + make_interval(secs=>p_window_seconds) - clock_timestamp())))::integer);
end $$;

-- Access state is Creator only when Whop last verified a valid membership and
-- its period has not ended. Failure to reconcile therefore fails closed.
create or replace function public.current_entitlement(p_user_id uuid)
returns table(plan text, allowance_seconds integer, consumed_seconds integer,
  reserved_seconds integer, remaining_seconds integer, max_session_seconds integer,
  period_start timestamptz, period_end timestamptz, membership_status text,
  may_start boolean, blocked_reason text)
language plpgsql security definer set search_path = '' as $$
declare v_plan text := 'free'; v_status text := 'none'; v_start timestamptz; v_end timestamptz; v_allowance integer := 1800; v_max integer := 1200; v_period public.usage_periods%rowtype;
begin
  select 'creator',s.status,s.current_period_start,s.current_period_end,12000,3600
  into v_plan,v_status,v_start,v_end,v_allowance,v_max
  from public.subscriptions s where s.user_id=p_user_id and s.provider='whop'
    and s.plan='creator'
    and s.status in ('active','trialing','canceling','canceled')
    and s.current_period_end > clock_timestamp()
    and s.last_verified_at > clock_timestamp() - interval '25 hours'
  order by s.provider_updated_at desc nulls last limit 1;
  if not found then
    v_plan := 'free'; v_status := 'none'; v_allowance := 1800; v_max := 1200;
    v_start := date_trunc('month',clock_timestamp()); v_end := v_start + interval '1 month';
  end if;
  insert into public.usage_periods(user_id,plan,period_start,period_end,allowance_seconds)
  values(p_user_id,v_plan,v_start,v_end,v_allowance)
  on conflict on constraint usage_periods_user_id_period_start_period_end_key do update set plan=excluded.plan,
    allowance_seconds=case when public.usage_periods.consumed_seconds+public.usage_periods.reserved_seconds<=excluded.allowance_seconds then excluded.allowance_seconds else 12000 end
  returning * into v_period;
  return query select v_plan,v_allowance,v_period.consumed_seconds,v_period.reserved_seconds,
    greatest(0,v_allowance-v_period.consumed_seconds-v_period.reserved_seconds),v_max,v_start,v_end,v_status,
    (v_period.consumed_seconds+v_period.reserved_seconds < v_allowance),
    case when v_period.consumed_seconds+v_period.reserved_seconds >= v_allowance then 'quota_exhausted' else null end;
end $$;

-- Session leases reserve the next lease window so racing tabs cannot consume
-- the same seconds. Renewals move elapsed reserved seconds to consumed seconds.
create or replace function public.start_usage_session(p_user_id uuid,p_project_id uuid,p_mode text,p_client_session_id text,p_lease_seconds integer default 30,p_global_session_limit integer default 100)
returns public.usage_sessions language plpgsql security definer set search_path = '' as $$
declare e record; s public.usage_sessions%rowtype; reserve_seconds integer; v_period_id uuid; expired_session public.usage_sessions%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('global-sessions',0));
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  if exists(select 1 from public.system_budget_periods where period_start<=clock_timestamp() and period_end>clock_timestamp() and emergency_stop) then raise exception using errcode='P0011',message='emergency_stop'; end if;
  if (select count(*) from public.usage_sessions where status='active' and lease_expires_at>clock_timestamp())>=p_global_session_limit then raise exception using errcode='P0017',message='global_session_capacity'; end if;
  for expired_session in select * from public.usage_sessions where user_id=p_user_id and status in ('active','paused') and lease_expires_at<=clock_timestamp() for update loop
    update public.usage_periods set consumed_seconds=consumed_seconds+expired_session.reserved_seconds,reserved_seconds=greatest(0,reserved_seconds-expired_session.reserved_seconds) where id=expired_session.usage_period_id;
    update public.usage_sessions set status='expired',ended_at=clock_timestamp(),termination_reason='lease_expired',consumed_seconds=consumed_seconds+reserved_seconds,reserved_seconds=0 where id=expired_session.id;
  end loop;
  if exists(select 1 from public.usage_sessions where user_id=p_user_id and status in ('active','paused')) then raise exception using errcode='P0002',message='active_session_conflict'; end if;
  select * into e from public.current_entitlement(p_user_id);
  if not e.may_start then raise exception using errcode='P0003',message=coalesce(e.blocked_reason,'quota_exhausted'); end if;
  reserve_seconds := least(greatest(5,p_lease_seconds),e.remaining_seconds,e.max_session_seconds);
  update public.usage_periods set reserved_seconds=reserved_seconds+reserve_seconds where user_id=p_user_id and period_start=e.period_start and period_end=e.period_end returning id into v_period_id;
  insert into public.usage_sessions(user_id,usage_period_id,project_id,mode,status,lease_expires_at,reserved_seconds,client_session_id)
  values(p_user_id,v_period_id,p_project_id,p_mode,'active',clock_timestamp()+make_interval(secs=>reserve_seconds),reserve_seconds,p_client_session_id) returning * into s;
  return s;
end $$;

create or replace function public.renew_usage_session(p_user_id uuid,p_session_id uuid,p_lease_seconds integer default 30)
returns public.usage_sessions language plpgsql security definer set search_path = '' as $$
declare s public.usage_sessions%rowtype; e record; elapsed integer; next_reserve integer;
begin
  select * into s from public.usage_sessions where id=p_session_id and user_id=p_user_id for update;
  if not found or s.status <> 'active' or s.lease_expires_at <= clock_timestamp() then raise exception using errcode='P0004',message='expired_lease'; end if;
  if exists(select 1 from public.system_budget_periods where period_start<=clock_timestamp() and period_end>clock_timestamp() and emergency_stop) then raise exception using errcode='P0011',message='emergency_stop'; end if;
  select * into e from public.current_entitlement(p_user_id);
  elapsed := least(s.reserved_seconds,greatest(0,floor(extract(epoch from (clock_timestamp()-s.last_heartbeat_at)))::integer));
  next_reserve := least(greatest(5,p_lease_seconds),greatest(0,e.allowance_seconds-e.consumed_seconds-elapsed),greatest(0,e.max_session_seconds-s.consumed_seconds-elapsed));
  update public.usage_periods set consumed_seconds=consumed_seconds+elapsed,reserved_seconds=greatest(0,reserved_seconds-s.reserved_seconds)+next_reserve where id=s.usage_period_id;
  update public.usage_sessions set consumed_seconds=consumed_seconds+elapsed,reserved_seconds=next_reserve,last_heartbeat_at=clock_timestamp(),lease_expires_at=clock_timestamp()+make_interval(secs=>next_reserve),
    status=case when next_reserve=0 then 'ended' else 'active' end,ended_at=case when next_reserve=0 then clock_timestamp() else null end,
    termination_reason=case when next_reserve=0 then 'limit_reached' else null end where id=s.id returning * into s;
  return s;
end $$;

create or replace function public.end_usage_session(p_user_id uuid,p_session_id uuid,p_reason text default 'user_stopped')
returns public.usage_sessions language plpgsql security definer set search_path = '' as $$
declare s public.usage_sessions%rowtype; e record; elapsed integer;
begin
  select * into s from public.usage_sessions where id=p_session_id and user_id=p_user_id for update;
  if not found then raise exception 'session_not_found'; end if;
  if s.status not in ('active','paused') then return s; end if;
  select * into e from public.current_entitlement(p_user_id);
  elapsed := case when s.status='active' then least(s.reserved_seconds,greatest(0,floor(extract(epoch from (least(clock_timestamp(),s.lease_expires_at)-s.last_heartbeat_at)))::integer)) else 0 end;
  update public.usage_periods set consumed_seconds=consumed_seconds+elapsed,reserved_seconds=greatest(0,reserved_seconds-s.reserved_seconds) where id=s.usage_period_id;
  update public.usage_sessions set consumed_seconds=consumed_seconds+elapsed,reserved_seconds=0,status='ended',ended_at=clock_timestamp(),termination_reason=left(p_reason,80) where id=s.id returning * into s;
  return s;
end $$;

revoke all on function public.consume_rate_limit(text,text,integer,integer) from public, anon, authenticated;
revoke all on function public.current_entitlement(uuid) from public, anon, authenticated;
revoke all on function public.start_usage_session(uuid,uuid,text,text,integer,integer) from public, anon, authenticated;
revoke all on function public.renew_usage_session(uuid,uuid,integer) from public, anon, authenticated;
revoke all on function public.end_usage_session(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text,text,integer,integer) to service_role;
grant execute on function public.current_entitlement(uuid) to service_role;
grant execute on function public.start_usage_session(uuid,uuid,text,text,integer,integer) to service_role;
grant execute on function public.renew_usage_session(uuid,uuid,integer) to service_role;
grant execute on function public.end_usage_session(uuid,uuid,text) to service_role;

-- Cleanup can run from Supabase Cron every five minutes.
create or replace function public.expire_abandoned_usage_sessions() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer:=0; expired_session public.usage_sessions%rowtype;
begin
  for expired_session in select * from public.usage_sessions where status='active' and lease_expires_at<=clock_timestamp() for update skip locked loop
    update public.usage_periods set consumed_seconds=consumed_seconds+expired_session.reserved_seconds,reserved_seconds=greatest(0,reserved_seconds-expired_session.reserved_seconds) where id=expired_session.usage_period_id;
    update public.usage_sessions set status='expired',ended_at=clock_timestamp(),consumed_seconds=consumed_seconds+reserved_seconds,reserved_seconds=0,termination_reason='lease_expired' where id=expired_session.id;
    n:=n+1;
  end loop;
  return n;
end $$;
revoke all on function public.expire_abandoned_usage_sessions() from public,anon,authenticated;
grant execute on function public.expire_abandoned_usage_sessions() to service_role;
