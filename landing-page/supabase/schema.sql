-- LakshX hosted-model backend: usage tracking + budget enforcement.
-- Run this once against a fresh Supabase project (SQL Editor -> New query -> paste -> Run).
--
-- Security model: RLS lets a signed-in user read ONLY their own usage/budget
-- rows via the anon/authenticated key (which ships inside the IDE and is not
-- a secret). All WRITES, and the budget check itself, go through
-- SECURITY DEFINER functions callable only by the service-role key, which
-- lives solely in the Vercel proxy's server-side env — never in the client.
-- Without this split, a user could forge a favorable "cost" for their own
-- usage row, or read every other user's spend.

create table if not exists public.usage_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  tokens_in bigint not null,
  tokens_out bigint not null,
  cost_usd numeric(10,4) not null,
  created_at timestamptz not null default now()
);
create index if not exists usage_ledger_user_id_idx on public.usage_ledger(user_id);

create table if not exists public.user_budget (
  user_id uuid primary key references auth.users(id) on delete cascade,
  credit_limit_usd numeric(10,2) not null default 20.00
);

-- Singleton row (id is always `true`) tracking total spend against the
-- $1000 Azure credit. Ceiling defaults to $800 (80% of credit, 20% buffer
-- for the last in-flight request's overshoot + Azure billing lag).
create table if not exists public.global_budget (
  id boolean primary key default true check (id),
  ceiling_usd numeric(10,2) not null default 800.00,
  -- numeric(12,4), not (10,2): individual request costs are fractions of a
  -- cent (e.g. $0.0001), and this column accumulates thousands of them —
  -- cent precision silently rounds every increment away to nothing.
  spent_usd numeric(12,4) not null default 0.00
);
insert into public.global_budget (id) values (true) on conflict (id) do nothing;

alter table public.usage_ledger enable row level security;
create policy "users read own usage" on public.usage_ledger
  for select using (auth.uid() = user_id);
-- no insert/update/delete policy for anon/authenticated -> default deny.
-- writes happen exclusively via record_usage() below, using the service-role key.

alter table public.user_budget enable row level security;
create policy "users read own budget" on public.user_budget
  for select using (auth.uid() = user_id);

alter table public.global_budget enable row level security;
-- no policies at all -> default deny for anon/authenticated; only
-- service-role (which bypasses RLS entirely) can touch this table.

-- Pre-request gate: called by the proxy BEFORE forwarding to Azure. Reads
-- the running totals directly from source-of-truth tables (no cache, no
-- eventually-consistent counter) so the check is as fresh as the DB allows.
-- Auto-provisions a user_budget row (default $20) on first use.
create or replace function public.check_budget(p_user_id uuid, p_default_limit numeric default 20.00)
returns table(allowed boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  user_spent numeric;
  user_limit numeric;
  global_spent numeric;
  global_ceiling numeric;
begin
  select credit_limit_usd into user_limit from user_budget where user_id = p_user_id;
  if user_limit is null then
    insert into user_budget (user_id, credit_limit_usd) values (p_user_id, p_default_limit)
      on conflict (user_id) do nothing;
    user_limit := p_default_limit;
  end if;

  select coalesce(sum(cost_usd), 0) into user_spent from usage_ledger where user_id = p_user_id;
  select spent_usd, ceiling_usd into global_spent, global_ceiling from global_budget where id = true;

  if global_spent >= global_ceiling then
    return query select false, 'global_ceiling_reached';
  elsif user_spent >= user_limit then
    return query select false, 'user_cap_reached';
  else
    return query select true, null::text;
  end if;
end;
$$;

-- Post-request record: called by the proxy AFTER the stream ends, once
-- actual token usage is known. Appends the ledger row and atomically bumps
-- the global running total in the same statement set.
create or replace function public.record_usage(p_user_id uuid, p_tokens_in bigint, p_tokens_out bigint, p_cost_usd numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into usage_ledger (user_id, tokens_in, tokens_out, cost_usd)
    values (p_user_id, p_tokens_in, p_tokens_out, p_cost_usd);
  update global_budget set spent_usd = spent_usd + p_cost_usd where id = true;
end;
$$;

-- Lock these down to the service role only — never callable with the
-- anon/authenticated key, or any signed-in user could forge their own cost.
revoke all on function public.check_budget(uuid, numeric) from public, anon, authenticated;
revoke all on function public.record_usage(uuid, bigint, bigint, numeric) from public, anon, authenticated;
grant execute on function public.check_budget(uuid, numeric) to service_role;
grant execute on function public.record_usage(uuid, bigint, bigint, numeric) to service_role;

-- Admin dashboard convenience view — per-user total spend + their cap.
-- Also service-role only (no grants to anon/authenticated); the /admin
-- route reads this with the service-role key from a server-side handler.
create or replace view public.admin_user_usage as
select
  u.id as user_id,
  u.email,
  coalesce(sum(l.cost_usd), 0) as total_cost_usd,
  coalesce(sum(l.tokens_in), 0) as total_tokens_in,
  coalesce(sum(l.tokens_out), 0) as total_tokens_out,
  b.credit_limit_usd,
  max(l.created_at) as last_used_at
from auth.users u
left join usage_ledger l on l.user_id = u.id
left join user_budget b on b.user_id = u.id
group by u.id, u.email, b.credit_limit_usd;

revoke all on public.admin_user_usage from public, anon, authenticated;
grant select on public.admin_user_usage to service_role;
