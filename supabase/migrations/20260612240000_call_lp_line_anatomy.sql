-- =====================================================================
-- Capital calls (Execute hub interior): LP line anatomy.
--
-- 20260611101000_hub_data_room_execute.sql created `call_lp_status` with
-- only a status per LP line; the prototype's funding funnel shows each
-- LP's own amount, and chasing a late LP is a real recorded act. Two
-- additive columns:
--
--   amount    — the LP's share of the call, fixed pro-rata to their real
--               commitment at issue time (so a later commitment edit never
--               silently rewrites an already-issued call).
--   chased_at — when the operator last drafted a reminder for an overdue
--               line through the approve loop.
--
-- Member writes already granted by 20260611280000. Additive + idempotent.
-- =====================================================================

alter table public.call_lp_status
  add column if not exists amount numeric(18, 2);
alter table public.call_lp_status
  add column if not exists chased_at timestamptz;
