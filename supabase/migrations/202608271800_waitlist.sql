-- Public launch waitlist. Deliberately isolated from profiles/projects — a
-- waitlist signup is not an account and never becomes one automatically; if
-- someone later signs up for real, that's a fresh row in auth.users/profiles,
-- unlinked to this table. Same posture as anonymous_trials: no anon/
-- authenticated policies, every read/write goes through our own API route
-- using the service role.
create table public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (char_length(email) between 3 and 254 and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  source text not null default 'landing' check (char_length(source) <= 40),
  created_at timestamptz not null default timezone('utc', now())
);
create index waitlist_signups_created_at_idx on public.waitlist_signups(created_at desc);

alter table public.waitlist_signups enable row level security;
revoke all on public.waitlist_signups from anon, authenticated;
grant all on public.waitlist_signups to service_role;
