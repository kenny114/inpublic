-- Administrative account entitlements.
--
-- These flags live on profiles rather than subscriptions so internal access
-- never masquerades as a paid Whop membership. They remain service-role-only:
-- authenticated users can still update only display_name (foundation grant).

alter table public.profiles
  add column if not exists is_admin boolean not null default false,
  add column if not exists unlimited_minutes boolean not null default false;

comment on column public.profiles.is_admin is
  'Grants access to protected InPublic administrative surfaces.';
comment on column public.profiles.unlimited_minutes is
  'Removes monthly and per-session minute limits; cost and emergency controls still apply.';

-- PostgreSQL integers cannot represent Infinity. This sentinel is deliberately
-- explicit and is never shown as a number: API clients receive the boolean
-- unlimited_minutes and render "Unlimited" instead.
alter table public.usage_periods drop constraint if exists usage_periods_allowance_seconds_check;
alter table public.usage_periods
  add constraint usage_periods_allowance_seconds_check
  check (allowance_seconds in (1800,7200,9000,10800,12000,12600,14400,2147483647));

drop function if exists public.current_entitlement(uuid);

create function public.current_entitlement(p_user_id uuid)
returns table(plan text, allowance_seconds integer, consumed_seconds integer,
  reserved_seconds integer, remaining_seconds integer, max_session_seconds integer,
  period_start timestamptz, period_end timestamptz, membership_status text,
  may_start boolean, blocked_reason text, founding_number integer,
  is_admin boolean, unlimited_minutes boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_plan text := 'free';
  v_status text := 'none';
  v_start timestamptz;
  v_end timestamptz;
  v_allowance integer := 1800;
  v_max integer := 1200;
  v_founding integer;
  v_is_admin boolean := false;
  v_unlimited boolean := false;
  v_period public.usage_periods%rowtype;
begin
  select coalesce(p.is_admin,false),coalesce(p.unlimited_minutes,false)
    into v_is_admin,v_unlimited
  from public.profiles p where p.id=p_user_id;

  v_is_admin := coalesce(v_is_admin,false);
  v_unlimited := coalesce(v_unlimited,false);

  if v_unlimited then
    v_plan := 'creator';
    v_status := 'admin';
    v_allowance := 2147483647;
    v_max := 2147483647;
    v_founding := null;
    v_start := date_trunc('month',clock_timestamp());
    v_end := v_start + interval '1 month';
  else
    select 'creator',s.status,s.current_period_start,s.current_period_end,
           public.founding_allowance_seconds(s.founding_number),3600,s.founding_number
      into v_plan,v_status,v_start,v_end,v_allowance,v_max,v_founding
    from public.subscriptions s where s.user_id=p_user_id and s.provider='whop'
      and s.plan='creator'
      and s.status in ('active','trialing','canceling','canceled')
      and s.current_period_end > clock_timestamp()
      and s.last_verified_at > clock_timestamp() - interval '25 hours'
    order by s.provider_updated_at desc nulls last limit 1;
    if not found then
      v_plan := 'free'; v_status := 'none'; v_allowance := 1800; v_max := 1200; v_founding := null;
      v_start := date_trunc('month',clock_timestamp()); v_end := v_start + interval '1 month';
    end if;
  end if;

  insert into public.usage_periods(user_id,plan,period_start,period_end,allowance_seconds)
  values(p_user_id,v_plan,v_start,v_end,v_allowance)
  on conflict on constraint usage_periods_user_id_period_start_period_end_key do update set
    plan=excluded.plan,
    allowance_seconds=case
      when v_unlimited then 2147483647
      when public.usage_periods.consumed_seconds+public.usage_periods.reserved_seconds<=excluded.allowance_seconds then excluded.allowance_seconds
      else public.usage_periods.allowance_seconds
    end
  returning * into v_period;

  return query select v_plan,v_period.allowance_seconds,v_period.consumed_seconds,v_period.reserved_seconds,
    greatest(0,v_period.allowance_seconds-v_period.consumed_seconds-v_period.reserved_seconds),v_max,v_start,v_end,v_status,
    (v_period.consumed_seconds+v_period.reserved_seconds < v_period.allowance_seconds),
    case when v_period.consumed_seconds+v_period.reserved_seconds >= v_period.allowance_seconds then 'quota_exhausted' else null end,
    v_founding,v_is_admin,v_unlimited;
end $$;

revoke all on function public.current_entitlement(uuid) from public,anon,authenticated;
grant execute on function public.current_entitlement(uuid) to service_role;
