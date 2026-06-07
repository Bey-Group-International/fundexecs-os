-- =====================================================================
-- Durable, serverless-safe rate-limit store for the anonymous /api/beta/ask
-- streaming endpoint.
--
-- The endpoint is pre-auth (no Supabase session), so a server-side in-memory
-- Map would not survive across serverless instances. This migration installs:
--
--   1. public.beta_ask_rate_limits — a fixed-window counter table keyed by an
--      arbitrary text bucket_key (e.g. "token:<tok>", "ip:<ip>").
--
--   2. public.beta_ask_rate_check(_key, _window_seconds, _max) — an atomic
--      SECURITY DEFINER RPC that upserts / increments the counter for the
--      current window and returns allowed = (count <= _max). Service-role only.
--
-- Cleanup note: rows older than the largest window become irrelevant. A
-- periodic `delete from public.beta_ask_rate_limits where window_start <
-- now() - interval '1 day'` reclaims space; not required for correctness.
-- =====================================================================

create table if not exists public.beta_ask_rate_limits (
  bucket_key text not null,
  window_start timestamptz not null,
  count integer not null default 1,
  constraint beta_ask_rate_limits_pkey primary key (bucket_key)
);

create index if not exists beta_ask_rate_limits_key_idx
  on public.beta_ask_rate_limits (bucket_key);

-- RLS on, no policies — only the service-role SECURITY DEFINER RPC touches this
-- table (the service role bypasses RLS; this is belt-and-suspenders).
alter table public.beta_ask_rate_limits enable row level security;

-- Fixed-window atomic check-and-increment. The `on conflict … do update`
-- serialises racing requests in the same window on the primary-key row lock:
-- when the stored window matches the current window, increment; otherwise the
-- window rolled over, so reset to 1.
create or replace function public.beta_ask_rate_check(
  _key text,
  _window_seconds integer,
  _max integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  _window_start timestamptz;
  _new_count integer;
begin
  _window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / _window_seconds) * _window_seconds
  );

  insert into public.beta_ask_rate_limits (bucket_key, window_start, count)
  values (_key, _window_start, 1)
  on conflict (bucket_key) do update
    set
      window_start = excluded.window_start,
      count = case
        when public.beta_ask_rate_limits.window_start = excluded.window_start
          then public.beta_ask_rate_limits.count + 1
        else 1
      end
  returning count into _new_count;

  return _new_count <= _max;
end;
$$;

revoke all on function public.beta_ask_rate_check(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.beta_ask_rate_check(text, integer, integer)
  to service_role;
