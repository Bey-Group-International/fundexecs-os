-- Signatures & wires — prototype vocabulary (Execute tab 2).
--
-- Signatures gain the prototype's row anatomy (signer role, drives line,
-- amount label, chase timestamp) plus a 'partial' stage for multi-signer
-- documents. Wires move to the prototype's direction-aware vocabulary:
-- outbound wires stage and release (staged → cleared), inbound wires are
-- expected and confirmed (expected → cleared). Additive + idempotent;
-- existing rows are mapped in place. RLS from 20260611280000 is unchanged.

-- ── Signatures: row anatomy + partial stage ──────────────────────────

alter table public.signatures
  add column if not exists signer_role text,
  add column if not exists drives text,
  add column if not exists amount_label text,
  add column if not exists chased_at timestamp with time zone;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.signatures'::regclass
      and conname = 'signatures_status_check'
  ) then
    alter table public.signatures drop constraint signatures_status_check;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.signatures'::regclass
      and conname = 'signatures_status_check_v2'
  ) then
    alter table public.signatures
      add constraint signatures_status_check_v2
      check (status in ('out_for_signature', 'partial', 'signed', 'declined'));
  end if;
end$$;

-- ── Wires: prototype anatomy + direction-aware stages ────────────────

alter table public.wires
  add column if not exists label text,
  add column if not exists drives text;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.wires'::regclass
      and conname = 'wires_status_check'
  ) then
    alter table public.wires drop constraint wires_status_check;
  end if;
end$$;

-- Map the old three-stage model onto the prototype's vocabulary:
-- settled → cleared; anything still moving stages by direction.
update public.wires
set status = case
  when status = 'settled' then 'cleared'
  when direction = 'out' then 'staged'
  else 'expected'
end
where status in ('instructed', 'sent', 'settled');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.wires'::regclass
      and conname = 'wires_status_check_v2'
  ) then
    alter table public.wires
      add constraint wires_status_check_v2
      check (
        (direction = 'out' and status in ('staged', 'cleared'))
        or (direction = 'in' and status in ('expected', 'cleared'))
      );
  end if;
end$$;
