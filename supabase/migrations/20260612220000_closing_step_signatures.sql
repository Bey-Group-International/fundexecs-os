-- =====================================================================
-- Closings (Execute hub interior): e-signature envelopes.
--
-- The Closings room's signature steps can be sent for e-signature through
-- DocuSign (gated behind the approve loop). Each send records a real
-- envelope reference against the step so the room can show its status
-- ("Sent · awaiting signature" → "Signed"). Sending never marks the step
-- done — the operator still executes/attests the step separately.
--
-- Honest-data: a row exists only when an envelope was actually created on
-- DocuSign. Additive + idempotent; org-scoped RLS with member writes,
-- mirroring 20260611240000_closings_member_writes.sql.
-- =====================================================================

create table if not exists public.closing_step_signatures (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  closing_id uuid not null,
  step_id uuid not null,
  seq integer not null,
  envelope_id text not null,
  status text not null default 'sent',
  signer_name text,
  signer_email text,
  subject text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (closing_id, org_id) references public.closings (id, org_id) on delete cascade,
  foreign key (step_id, org_id) references public.closing_steps (id, org_id) on delete cascade
);

-- One live envelope per step (a re-send replaces the reference via upsert).
create unique index if not exists closing_step_signatures_step_uniq
  on public.closing_step_signatures (org_id, step_id);

create index if not exists closing_step_signatures_closing_idx
  on public.closing_step_signatures (org_id, closing_id);

alter table public.closing_step_signatures enable row level security;

grant select, insert, update on table public.closing_step_signatures to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'closing_step_signatures'
      and policyname = 'members read own org closing signatures'
  ) then
    create policy "members read own org closing signatures"
      on public.closing_step_signatures
      for select to authenticated
      using (
        exists (
          select 1 from public.org_members om
          where om.org_id = closing_step_signatures.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'closing_step_signatures'
      and policyname = 'members write own org closing signatures'
  ) then
    create policy "members write own org closing signatures"
      on public.closing_step_signatures
      for all to authenticated
      using (
        exists (
          select 1 from public.org_members om
          where om.org_id = closing_step_signatures.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      )
      with check (
        exists (
          select 1 from public.org_members om
          where om.org_id = closing_step_signatures.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      );
  end if;
end$$;
