-- Qualify the usage-period conflict constraint. The function's output columns
-- include period_start/period_end, which otherwise make a column-list conflict
-- target ambiguous inside PL/pgSQL on current PostgreSQL.
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

revoke all on function public.current_entitlement(uuid) from public,anon,authenticated;
grant execute on function public.current_entitlement(uuid) to service_role;
