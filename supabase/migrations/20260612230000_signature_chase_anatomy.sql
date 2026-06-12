-- =====================================================================
-- Signatures & wires (Execute hub interior): signature chase anatomy.
--
-- 20260611280000_execute_complete.sql created `signatures` as the e-sign
-- tracking ledger. The prototype's signature room chases stalled
-- signatures through the approve loop, and a chase is a real recorded
-- act:
--
--   chased_at — when the operator last drafted a reminder for an
--               outstanding signature through the approve loop.
--
-- Member writes already granted by 20260611280000. Additive + idempotent.
-- =====================================================================

alter table public.signatures
  add column if not exists chased_at timestamptz;
