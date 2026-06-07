-- =====================================================================
-- Hardening follow-up for 20260607170000_beta_ask_rate_limit.sql.
--
-- Two fixes that landed after the original migration was applied:
--
--   1. Drop public.beta_ask_rate_limits_key_idx — it duplicates the primary
--      key, which already provides a unique btree index on (bucket_key). The
--      extra index only added write overhead.
--
--   2. Make beta_ask_rate_check window-monotonic. The original ON CONFLICT set
--      window_start = excluded.window_start unconditionally. clock_timestamp()
--      is wall-clock, so a request whose clock lags behind a concurrent one
--      could carry an *earlier* _window_start and roll the stored window
--      backwards — resetting count to 1 and handing the caller a fresh budget.
--      We now keep the later of the two windows (GREATEST) and only increment
--      when the incoming window is not older than the stored one; a stale
--      request neither rolls the window back nor resets the count.
-- =====================================================================

drop index if exists public.beta_ask_rate_limits_key_idx;

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
      -- Never let a lagging clock roll the window backward.
      window_start = greatest(public.beta_ask_rate_limits.window_start, excluded.window_start),
      count = case
        -- Stored window is the same as, or newer than, this request's window →
        -- the request belongs to the current window; count it without resetting
        -- (a stale/lagging request must not hand out a fresh budget).
        when public.beta_ask_rate_limits.window_start >= excluded.window_start
          then public.beta_ask_rate_limits.count + 1
        -- excluded window is strictly newer → the window genuinely rolled over.
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
