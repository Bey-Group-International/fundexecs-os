-- 20261102210000_lp_agreement_envelope.sql
--
-- An LP's subscription agreement is signed through the same place-blocks, send,
-- sign, countersign flow as any other document. This ties the envelope to the LP's
-- onboarding session, so the portal can show the LP their agreement and the closing
-- board can show where it stands. One live agreement per session; a voided one frees
-- the slot for a new attempt.

alter table public.envelopes
  add column if not exists lp_session_id uuid
    references public.lp_onboarding_sessions (id) on delete set null;

create unique index if not exists envelopes_one_live_agreement_per_lp_session
  on public.envelopes (lp_session_id)
  where lp_session_id is not null and status <> 'voided';
