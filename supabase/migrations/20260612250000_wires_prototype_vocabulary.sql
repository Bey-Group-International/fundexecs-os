-- =====================================================================
-- Signatures & wires: the prototype's status vocabulary.
--
-- The Execute tab-2 parity pass adopts the prototype's wire statuses —
-- staged / expected / cleared — replacing instructed / sent / settled.
-- A wire here is record-keeping + attestation (no money moves through
-- FundExecs OS): outbound wires sit `staged` until the operator releases
-- them; inbound wires sit `expected` until the operator confirms receipt
-- against their bank. Each clears in exactly one server-enforced
-- transition (staged → cleared, expected → cleared).
--
-- Signatures gain the prototype's `partial` state (some signers in,
-- countersignature outstanding) and a `chased_at` column recording the
-- Chase reminder attestation.
--
-- Additive + idempotent.
-- =====================================================================

-- ── Wires: staged / expected / cleared ───────────────────────────────

alter table public.wires drop constraint if exists wires_status_check;

update public.wires
set status = case
  when status = 'settled' then 'cleared'
  when direction = 'in' then 'expected'
  else 'staged'
end
where status in ('instructed', 'sent', 'settled');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.wires'::regclass
      and conname = 'wires_status_check'
  ) then
    alter table public.wires
      add constraint wires_status_check
      check (status in ('staged', 'expected', 'cleared'));
  end if;
end$$;

-- No column default: `staged` is outbound-only and `expected` inbound-only,
-- so status is direction-specific. Callers set it explicitly via
-- stagedWireStatus(direction) in lib/wires/actions.ts; a NOT NULL column with
-- no default forces that contract rather than silently defaulting an inbound
-- wire to a releasable outbound one.
alter table public.wires alter column status drop default;

-- ── Signatures: `partial` + the chase attestation ────────────────────

alter table public.signatures drop constraint if exists signatures_status_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.signatures'::regclass
      and conname = 'signatures_status_check'
  ) then
    alter table public.signatures
      add constraint signatures_status_check
      check (status in ('out_for_signature', 'partial', 'signed', 'declined'));
  end if;
end$$;

alter table public.signatures
  add column if not exists chased_at timestamp with time zone;
