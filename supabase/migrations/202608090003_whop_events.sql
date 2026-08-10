create or replace function public.apply_whop_membership_event(
  p_event_id text,p_event_type text,p_event_timestamp timestamptz,p_membership_id text,
  p_user_id uuid,p_whop_user_id text,p_plan_id text,p_status text,p_valid boolean,
  p_period_start timestamptz,p_period_end timestamptz,p_cancel_at_period_end boolean,
  p_provider_updated_at timestamptz,p_sanitized jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
declare existing public.subscriptions%rowtype; resolved_user uuid:=p_user_id;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_membership_id,0));
  if exists(select 1 from public.payment_events where whop_event_id=p_event_id) then return false; end if;
  select * into existing from public.subscriptions where provider_membership_id=p_membership_id;
  resolved_user:=coalesce(resolved_user,existing.user_id);
  insert into public.payment_events(whop_event_id,event_type,membership_id,user_id,status,provider_timestamp,processed_timestamp,sanitized_payload_json)
    values(p_event_id,p_event_type,p_membership_id,resolved_user,p_status,p_event_timestamp,clock_timestamp(),coalesce(p_sanitized,'{}'::jsonb));
  if resolved_user is null then return false; end if;
  if existing.id is not null and existing.provider_updated_at is not null and p_provider_updated_at < existing.provider_updated_at then return false; end if;
  insert into public.subscriptions(user_id,provider,provider_customer_id,provider_membership_id,provider_plan_id,status,plan,current_period_start,current_period_end,cancel_at_period_end,provider_updated_at,last_verified_at)
  values(resolved_user,'whop',p_whop_user_id,p_membership_id,p_plan_id,p_status,case when p_valid then 'creator' else 'free' end,p_period_start,p_period_end,p_cancel_at_period_end,p_provider_updated_at,clock_timestamp())
  on conflict(user_id,provider) do update set provider_customer_id=excluded.provider_customer_id,provider_membership_id=excluded.provider_membership_id,provider_plan_id=excluded.provider_plan_id,status=excluded.status,plan=excluded.plan,current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,cancel_at_period_end=excluded.cancel_at_period_end,provider_updated_at=excluded.provider_updated_at,last_verified_at=excluded.last_verified_at;
  return true;
end $$;

create or replace function public.record_whop_payment_event(
  p_event_id text,p_event_type text,p_event_timestamp timestamptz,p_membership_id text,
  p_user_id uuid,p_gross numeric,p_fees numeric,p_affiliate numeric,p_net numeric,
  p_currency text,p_status text,p_sanitized jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  insert into public.payment_events(whop_event_id,event_type,membership_id,user_id,gross_amount,fees,affiliate_amount,net_amount,currency,status,provider_timestamp,processed_timestamp,sanitized_payload_json)
  values(p_event_id,p_event_type,p_membership_id,p_user_id,p_gross,p_fees,p_affiliate,p_net,p_currency,p_status,p_event_timestamp,clock_timestamp(),coalesce(p_sanitized,'{}'::jsonb))
  on conflict(whop_event_id) do nothing;
  return found;
end $$;

revoke all on function public.apply_whop_membership_event(text,text,timestamptz,text,uuid,text,text,text,boolean,timestamptz,timestamptz,boolean,timestamptz,jsonb) from public,anon,authenticated;
revoke all on function public.record_whop_payment_event(text,text,timestamptz,text,uuid,numeric,numeric,numeric,numeric,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.apply_whop_membership_event(text,text,timestamptz,text,uuid,text,text,text,boolean,timestamptz,timestamptz,boolean,timestamptz,jsonb) to service_role;
grant execute on function public.record_whop_payment_event(text,text,timestamptz,text,uuid,numeric,numeric,numeric,numeric,text,text,jsonb) to service_role;
