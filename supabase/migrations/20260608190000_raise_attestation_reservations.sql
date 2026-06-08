-- ============================================================================
-- W5 — Accredited self-attestation + opt-in reservation flow.
--
-- Changes (additive + idempotent):
--
--   raise_interests  : + accredited boolean (null = not asked / 506(b) gated)
--                      + attested_at timestamptz
--                      + kind text not null default 'interest'  ('interest'|'reserved')
--                      + reservation_amount numeric
--                      + stripe_session_id text
--                      + reservation_status text default 'pending'
--
--   raise_pages      : + accept_reservations boolean not null default false
--
-- The reservation columns live on raise_interests (same composite FK so org_id
-- can't be spoofed) rather than a separate table — keeps the schema additive and
-- the RLS surface minimal. kind='reserved' rows are reservations; kind='interest'
-- rows are the existing lead-gen path. Both write via the service-role admin
-- client from the public route.
-- ============================================================================

-- ---------- raise_interests additions ----------

alter table public.raise_interests
  add column if not exists accredited boolean;

alter table public.raise_interests
  add column if not exists attested_at timestamptz;

alter table public.raise_interests
  add column if not exists kind text not null default 'interest';

alter table public.raise_interests
  add column if not exists reservation_amount numeric;

alter table public.raise_interests
  add column if not exists stripe_session_id text;

alter table public.raise_interests
  add column if not exists reservation_status text not null default 'pending';

-- Guard the kind column so only valid values enter.
alter table public.raise_interests
  drop constraint if exists raise_interests_kind_chk;
alter table public.raise_interests
  add constraint raise_interests_kind_chk
  check (kind in ('interest', 'reserved'));

-- Guard reservation_status.
alter table public.raise_interests
  drop constraint if exists raise_interests_reservation_status_chk;
alter table public.raise_interests
  add constraint raise_interests_reservation_status_chk
  check (reservation_status in ('pending', 'paid', 'cancelled', 'intent_only'));

-- ---------- raise_pages additions ----------

alter table public.raise_pages
  add column if not exists accept_reservations boolean not null default false;

-- ---------- indexes ----------

create index if not exists raise_interests_kind_idx
  on public.raise_interests (kind);

create index if not exists raise_interests_stripe_session_id_idx
  on public.raise_interests (stripe_session_id)
  where stripe_session_id is not null;

-- ---------- RLS unchanged (existing policies already cover new columns) ------
-- raise_interests: owners read via "owners read raise interests" (select only).
-- raise_pages: owners manage via "owners manage raise pages" (all authenticated).
-- Public writes still go through the service-role admin client (no insert policy
-- exists on raise_interests or raise_pages for the anon/authenticated roles).
