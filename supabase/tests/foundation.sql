-- Run after `supabase db reset` with: supabase test db supabase/tests/foundation.sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

select has_table('public', name, format('%s table exists', name))
from unnest(array[
  'profiles','projects','subscriptions','usage_periods','usage_sessions',
  'cost_events','provider_rate_cards','payment_events','rate_limit_buckets','system_budget_periods','cost_reservations'
]) as name;

select ok(
  not exists(
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname in ('profiles','projects','subscriptions','usage_periods','usage_sessions','cost_events','payment_events','cost_reservations')
      and not c.relrowsecurity
  ),
  'RLS is enabled on every protected table'
);
select ok(
  not exists(
    select 1 from pg_policies
    where schemaname='public'
      and tablename in ('subscriptions','cost_events','payment_events','system_budget_periods')
      and cmd in ('INSERT','UPDATE','DELETE')
  ),
  'privileged ledgers and billing tables have no user mutation policies'
);
select ok(
  exists(
    select 1 from pg_indexes where schemaname='public'
      and indexname='one_active_usage_session_per_user' and indexdef ilike '%unique%'
  ),
  'active-session uniqueness is enforced in Postgres'
);

insert into auth.users (
  id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('11111111-1111-4111-8111-111111111111','authenticated','authenticated','one@example.test','',now(),'{}','{}',now(),now()),
  ('22222222-2222-4222-8222-222222222222','authenticated','authenticated','two@example.test','',now(),'{}','{}',now(),now());

insert into public.projects(id,user_id,title)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','one project'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','two project');

select is(
  (select allowance_seconds from public.current_entitlement('11111111-1111-4111-8111-111111111111')),
  1800,
  'Free entitlement is exactly 1,800 seconds'
);
select is(
  (select max_session_seconds from public.current_entitlement('11111111-1111-4111-8111-111111111111')),
  1200,
  'Free maximum session is exactly 1,200 seconds'
);

insert into public.subscriptions(
  user_id,provider,provider_membership_id,provider_plan_id,status,plan,
  current_period_start,current_period_end,last_verified_at,provider_updated_at
) values (
  '11111111-1111-4111-8111-111111111111','whop','mem_test','plan_test','active','creator',
  now()-interval '1 day',now()+interval '29 days',now(),now()
);
select is(
  (select allowance_seconds from public.current_entitlement('11111111-1111-4111-8111-111111111111')),
  12000,
  'Creator entitlement is exactly 12,000 seconds'
);
select is(
  (select max_session_seconds from public.current_entitlement('11111111-1111-4111-8111-111111111111')),
  3600,
  'Creator maximum session is exactly 3,600 seconds'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';

select is((select count(*) from public.projects), 1::bigint, 'a user sees only their own project');
select is((select count(*) from public.projects where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 1::bigint, 'a user can read their own project');
update public.projects set title='updated' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select is(
  (select title from public.projects where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'updated',
  'a user can update their own project'
);
update public.projects set title='stolen' where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select throws_ok(
  $$delete from public.projects where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  '42501',
  null,
  'hard project deletion is denied'
);
select throws_ok(
  $$update public.profiles set email='changed@example.test' where id='11111111-1111-4111-8111-111111111111'$$,
  '42501',
  null,
  'a user cannot change protected profile fields'
);

reset role;
select is(
  (select title from public.projects where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  'two project',
  'cross-user project updates are denied by RLS'
);
select * from finish();
rollback;
