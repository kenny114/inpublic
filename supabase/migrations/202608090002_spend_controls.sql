-- Mutable reservation state is separate from the append-only cost_events ledger.
create table public.cost_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  session_id uuid not null references public.usage_sessions(id) on delete cascade,
  feature text not null,
  provider text not null,
  model text not null,
  idempotency_key text not null unique,
  reserved_cost_usd numeric(14,6) not null check (reserved_cost_usd >= 0),
  final_estimated_cost_usd numeric(14,6),
  final_actual_cost_usd numeric(14,6),
  status text not null default 'reserved' check (status in ('reserved','reconciled')),
  created_at timestamptz not null default timezone('utc',now()),
  reconciled_at timestamptz
);
alter table public.cost_reservations enable row level security;
revoke all on public.cost_reservations from anon,authenticated;
grant all on public.cost_reservations to service_role;

create or replace function public.reserve_provider_cost(
  p_user_id uuid, p_project_id uuid, p_session_id uuid,
  p_feature text, p_provider text, p_model text, p_unit text,
  p_reserved_cost numeric, p_idempotency_key text,
  p_user_daily_limit numeric, p_user_period_limit numeric,
  p_global_hour_limit numeric, p_global_day_limit numeric, p_global_month_limit numeric,
  p_artist_session_limit numeric, p_session_call_limit integer
) returns public.cost_reservations
language plpgsql security definer set search_path = '' as $$
declare s public.usage_sessions%rowtype; r public.cost_reservations%rowtype;
  h_start timestamptz:=date_trunc('hour',clock_timestamp());
  d_start timestamptz:=date_trunc('day',clock_timestamp());
  m_start timestamptz:=date_trunc('month',clock_timestamp());
  user_day numeric; user_period numeric; artist_total numeric; call_total integer; billing_start timestamptz; billing_end timestamptz;
begin
  if p_reserved_cost <= 0 or p_reserved_cost > 10 then raise exception using errcode='P0010',message='invalid_cost_reservation'; end if;
  perform pg_advisory_xact_lock(hashtextextended('global-budget',0));
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  select * into s from public.usage_sessions where id=p_session_id and user_id=p_user_id for update;
  if not found or s.status <> 'active' or s.lease_expires_at <= clock_timestamp() then raise exception using errcode='P0004',message='expired_lease'; end if;
  select period_start,period_end into billing_start,billing_end from public.usage_periods where id=s.usage_period_id;

  insert into public.system_budget_periods(period_type,period_start,period_end,budget_limit) values
    ('hour',h_start,h_start+interval '1 hour',p_global_hour_limit),
    ('day',d_start,d_start+interval '1 day',p_global_day_limit),
    ('month',m_start,m_start+interval '1 month',p_global_month_limit)
  on conflict(period_type,period_start) do update set budget_limit=excluded.budget_limit;
  if exists(select 1 from public.system_budget_periods where period_start<=clock_timestamp() and period_end>clock_timestamp() and emergency_stop) then
    raise exception using errcode='P0011',message='emergency_stop';
  end if;
  if exists(select 1 from public.system_budget_periods where period_start<=clock_timestamp() and period_end>clock_timestamp() and reserved_spend+estimated_spend+p_reserved_cost>budget_limit) then
    raise exception using errcode='P0012',message='global_budget_exhausted';
  end if;

  select coalesce(sum(case when status='reserved' then reserved_cost_usd else coalesce(final_actual_cost_usd,final_estimated_cost_usd,0) end),0)
    into user_day from public.cost_reservations where user_id=p_user_id and created_at>=d_start;
  select coalesce(sum(case when status='reserved' then reserved_cost_usd else coalesce(final_actual_cost_usd,final_estimated_cost_usd,0) end),0)
    into user_period from public.cost_reservations where user_id=p_user_id and created_at>=billing_start and created_at<billing_end;
  if user_day+p_reserved_cost>p_user_daily_limit or user_period+p_reserved_cost>p_user_period_limit then
    raise exception using errcode='P0013',message='user_cost_limit';
  end if;
  select coalesce(sum(case when status='reserved' then reserved_cost_usd else coalesce(final_actual_cost_usd,final_estimated_cost_usd,0) end),0)
    into artist_total from public.cost_reservations where session_id=p_session_id and feature='artist';
  if p_feature='artist' and artist_total+p_reserved_cost>p_artist_session_limit then raise exception using errcode='P0014',message='artist_session_limit'; end if;
  select count(*) into call_total from public.cost_reservations where session_id=p_session_id;
  if call_total>=p_session_call_limit then raise exception using errcode='P0015',message='session_call_limit'; end if;

  insert into public.cost_reservations(user_id,project_id,session_id,feature,provider,model,idempotency_key,reserved_cost_usd)
  values(p_user_id,p_project_id,p_session_id,p_feature,p_provider,p_model,p_idempotency_key,p_reserved_cost)
  on conflict(idempotency_key) do nothing returning * into r;
  if found then
    update public.system_budget_periods set reserved_spend=reserved_spend+p_reserved_cost
      where period_start<=clock_timestamp() and period_end>clock_timestamp();
    insert into public.cost_events(user_id,project_id,session_id,feature,provider,model,status,unit,reserved_cost_usd,estimated_cost_usd,idempotency_key)
      values(p_user_id,p_project_id,p_session_id,p_feature,p_provider,p_model,'reserved',p_unit,p_reserved_cost,p_reserved_cost,p_idempotency_key||':reserved')
      on conflict(idempotency_key) do nothing;
  else
    raise exception using errcode='P0016',message='duplicate_provider_request';
  end if;
  return r;
end $$;

create or replace function public.reconcile_provider_cost(
  p_reservation_id uuid, p_status text, p_estimated_cost numeric, p_actual_cost numeric,
  p_provider_request_id text, p_input_tokens integer, p_output_tokens integer,
  p_cache_creation_tokens integer, p_cache_read_tokens integer,
  p_audio_seconds numeric, p_request_bytes integer, p_response_bytes integer,
  p_compute_ms integer, p_metadata jsonb
) returns public.cost_reservations
language plpgsql security definer set search_path = '' as $$
declare r public.cost_reservations%rowtype; final_cost numeric; e record;
begin
  perform pg_advisory_xact_lock(hashtextextended('global-budget',0));
  select * into r from public.cost_reservations where id=p_reservation_id for update;
  if not found then raise exception 'reservation_not_found'; end if;
  if r.status='reconciled' then return r; end if;
  final_cost:=greatest(0,coalesce(p_actual_cost,p_estimated_cost,r.reserved_cost_usd));
  update public.cost_reservations set status='reconciled',final_estimated_cost_usd=greatest(0,p_estimated_cost),final_actual_cost_usd=case when p_actual_cost is null then null else greatest(0,p_actual_cost) end,reconciled_at=clock_timestamp() where id=r.id returning * into r;
  update public.system_budget_periods set reserved_spend=greatest(0,reserved_spend-r.reserved_cost_usd),estimated_spend=estimated_spend+greatest(0,p_estimated_cost,final_cost),actual_spend=actual_spend+final_cost where period_start<=clock_timestamp() and period_end>clock_timestamp();
  select * into e from public.current_entitlement(r.user_id);
  update public.usage_periods set estimated_cost_usd=estimated_cost_usd+greatest(0,p_estimated_cost,final_cost),actual_cost_usd=actual_cost_usd+final_cost where user_id=r.user_id and period_start=e.period_start and period_end=e.period_end;
  update public.usage_sessions set estimated_cost_usd=estimated_cost_usd+greatest(0,p_estimated_cost),actual_cost_usd=actual_cost_usd+final_cost where id=r.session_id;
  insert into public.cost_events(user_id,project_id,session_id,feature,provider,model,provider_request_id,status,input_tokens,output_tokens,cache_creation_input_tokens,cache_read_input_tokens,audio_input_seconds,request_bytes,response_bytes,compute_ms,unit,reserved_cost_usd,estimated_cost_usd,actual_cost_usd,idempotency_key,metadata_json)
  values(r.user_id,r.project_id,r.session_id,r.feature,r.provider,r.model,p_provider_request_id,p_status,greatest(0,p_input_tokens),greatest(0,p_output_tokens),greatest(0,p_cache_creation_tokens),greatest(0,p_cache_read_tokens),greatest(0,p_audio_seconds),greatest(0,p_request_bytes),greatest(0,p_response_bytes),greatest(0,p_compute_ms),'request',r.reserved_cost_usd,greatest(0,p_estimated_cost),final_cost,r.idempotency_key||':final',coalesce(p_metadata,'{}'::jsonb));
  return r;
end $$;

revoke all on function public.reserve_provider_cost(uuid,uuid,uuid,text,text,text,text,numeric,text,numeric,numeric,numeric,numeric,numeric,numeric,integer) from public,anon,authenticated;
revoke all on function public.reconcile_provider_cost(uuid,text,numeric,numeric,text,integer,integer,integer,integer,numeric,integer,integer,integer,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_provider_cost(uuid,uuid,uuid,text,text,text,text,numeric,text,numeric,numeric,numeric,numeric,numeric,numeric,integer) to service_role;
grant execute on function public.reconcile_provider_cost(uuid,text,numeric,numeric,text,integer,integer,integer,integer,numeric,integer,integer,integer,jsonb) to service_role;

-- Supabase Cron calls this wrapper so abandoned browser sockets release their
-- worst-case audio reservation and reconcile against leased listening seconds.
create or replace function public.expire_abandoned_usage_sessions_with_costs() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer; item record; rate numeric;
begin
  n:=public.expire_abandoned_usage_sessions();
  for item in select r.id,r.model,r.provider,s.consumed_seconds from public.cost_reservations r join public.usage_sessions s on s.id=r.session_id where r.status='reserved' and r.feature in ('deepgram','gemini') and s.status='expired' loop
    select audio_rate_usd into rate from public.provider_rate_cards where provider=item.provider and model=item.model and effective_start<=clock_timestamp() and (effective_end is null or effective_end>clock_timestamp()) order by effective_start desc limit 1;
    perform public.reconcile_provider_cost(item.id,'aborted',coalesce(rate,0)*item.consumed_seconds,coalesce(rate,0)*item.consumed_seconds,null,0,0,0,0,item.consumed_seconds,0,0,0,jsonb_build_object('actual_cost_source','expired_server_lease_seconds'));
  end loop;
  return n;
end $$;
revoke all on function public.expire_abandoned_usage_sessions_with_costs() from public,anon,authenticated;
grant execute on function public.expire_abandoned_usage_sessions_with_costs() to service_role;

-- Admin reporting view never includes transcript or payment payload columns.
create view public.admin_cost_summary with (security_invoker=true) as
select date_trunc('day',occurred_at) as day,provider,model,feature,
  count(*) filter(where status='succeeded') as succeeded_calls,
  count(*) filter(where status='failed') as failed_calls,
  sum(reserved_cost_usd) as reserved_usd,sum(estimated_cost_usd) as estimated_usd,sum(actual_cost_usd) as actual_usd
from public.cost_events where status<>'reserved' group by 1,2,3,4;
revoke all on public.admin_cost_summary from anon,authenticated;
grant select on public.admin_cost_summary to service_role;
