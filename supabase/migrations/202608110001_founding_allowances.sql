-- Founding 100 allowances, and the finalized Creator base of 120 minutes.
--
-- Creator was 200 minutes (12000s). The shipped structure is:
--
--   free                 30 min   (1800s)   20-min sessions
--   creator             120 min   (7200s)   60-min sessions
--   founding #1-10      240 min  (14400s)
--   founding #11-25     210 min  (12600s)
--   founding #26-50     180 min  (10800s)
--   founding #51-100    150 min   (9000s)
--   founding #101+      120 min   (7200s, i.e. the base plan)
--
-- There is still exactly ONE Whop plan. Founding position is assigned here,
-- in order of first verified Creator membership, and the allowance follows
-- from it. Nothing about checkout or billing changes.
--
-- Mirrored in lib/plans.ts. Apply with the Supabase CLI.

alter table public.subscriptions
  add column if not exists founding_number integer check (founding_number >= 1);

create unique index if not exists subscriptions_founding_number_key
  on public.subscriptions(founding_number) where founding_number is not null;

-- The allowance ladder, as data rather than a chain of CASE arms, so the
-- entitlement function and any future reporting read the same source.
create or replace function public.founding_allowance_seconds(p_position integer)
returns integer language sql immutable set search_path = '' as $$
  select case
    when p_position is null then 7200
    when p_position <= 10 then 14400
    when p_position <= 25 then 12600
    when p_position <= 50 then 10800
    when p_position <= 100 then 9000
    else 7200
  end;
$$;

-- allowance_seconds was pinned to the two values that existed when the table
-- was created. Widen it to the ladder above.
alter table public.usage_periods drop constraint if exists usage_periods_allowance_seconds_check;
alter table public.usage_periods
  add constraint usage_periods_allowance_seconds_check
  check (allowance_seconds in (1800,7200,9000,10800,12600,14400,12000));

/*
 * Claim the next founding place the first time a Creator membership verifies.
 *
 * Under an advisory lock, and only ever assigned once per subscription: a
 * lapse and re-subscribe keeps the original number rather than pushing the
 * user to the back of the queue, and a renewal cannot consume a second place.
 * Positions past 100 are still recorded — they cost nothing, and they are what
 * makes "places remaining" answerable from real data.
 */
create or replace function public.claim_founding_number() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_next integer;
begin
  if new.plan = 'creator'
     and new.status in ('active','trialing','canceling')
     and new.founding_number is null then
    perform pg_advisory_xact_lock(hashtextextended('founding-100',0));
    select coalesce(max(s.founding_number),0)+1 into v_next from public.subscriptions s;
    new.founding_number := v_next;
  end if;
  return new;
end $$;

drop trigger if exists subscriptions_claim_founding_number on public.subscriptions;
create trigger subscriptions_claim_founding_number
  before insert or update on public.subscriptions
  for each row execute function public.claim_founding_number();

-- Backfill anyone who subscribed before this migration, oldest first.
with ordered as (
  select id, row_number() over (order by created_at, id) as position
  from public.subscriptions
  where plan = 'creator' and status in ('active','trialing','canceling') and founding_number is null
)
update public.subscriptions s set founding_number = ordered.position
from ordered where s.id = ordered.id;

-- How many of the 100 are left. Nothing renders a spots-remaining number
-- unless it comes from here.
create or replace function public.founding_places_remaining()
returns integer language sql security definer set search_path = '' as $$
  select greatest(0, 100 - coalesce((select count(*) from public.subscriptions where founding_number is not null), 0))::integer;
$$;

revoke all on function public.founding_places_remaining() from public,anon,authenticated;
grant execute on function public.founding_places_remaining() to service_role;

-- current_entitlement gains a founding_number column, so the return type
-- changes and the function has to be dropped rather than replaced.
drop function if exists public.current_entitlement(uuid);

create function public.current_entitlement(p_user_id uuid)
returns table(plan text, allowance_seconds integer, consumed_seconds integer,
  reserved_seconds integer, remaining_seconds integer, max_session_seconds integer,
  period_start timestamptz, period_end timestamptz, membership_status text,
  may_start boolean, blocked_reason text, founding_number integer)
language plpgsql security definer set search_path = '' as $$
declare v_plan text := 'free'; v_status text := 'none'; v_start timestamptz; v_end timestamptz; v_allowance integer := 1800; v_max integer := 1200; v_founding integer; v_period public.usage_periods%rowtype;
begin
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
  insert into public.usage_periods(user_id,plan,period_start,period_end,allowance_seconds)
  values(p_user_id,v_plan,v_start,v_end,v_allowance)
  on conflict on constraint usage_periods_user_id_period_start_period_end_key do update set plan=excluded.plan,
    -- Never shrink an allowance out from under seconds already spent or held.
    allowance_seconds=case when public.usage_periods.consumed_seconds+public.usage_periods.reserved_seconds<=excluded.allowance_seconds then excluded.allowance_seconds else public.usage_periods.allowance_seconds end
  returning * into v_period;
  return query select v_plan,v_period.allowance_seconds,v_period.consumed_seconds,v_period.reserved_seconds,
    greatest(0,v_period.allowance_seconds-v_period.consumed_seconds-v_period.reserved_seconds),v_max,v_start,v_end,v_status,
    (v_period.consumed_seconds+v_period.reserved_seconds < v_period.allowance_seconds),
    case when v_period.consumed_seconds+v_period.reserved_seconds >= v_period.allowance_seconds then 'quota_exhausted' else null end,
    v_founding;
end $$;

revoke all on function public.current_entitlement(uuid) from public,anon,authenticated;
grant execute on function public.current_entitlement(uuid) to service_role;
