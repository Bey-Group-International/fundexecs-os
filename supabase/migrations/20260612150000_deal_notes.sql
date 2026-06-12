-- =====================================================================
-- Deal notes (Source hub interior): the pipeline's written memory.
--
-- Append-only notes a member logs against a deal — the drawer's activity
-- timeline renders them interleaved with the deal's `loop_events` stage
-- history. Notes are immutable once logged (no update grant), so the
-- timeline stays an honest record. Org-scoped RLS — active members read
-- and insert their org's notes; service_role may write too. Additive +
-- idempotent.
-- =====================================================================

create table if not exists public.deal_notes (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  deal_id     uuid not null references public.deals (id) on delete cascade,
  -- The note's author (auth user at insert time); null after account removal.
  author_id   uuid references public.profiles (id) on delete set null,
  body        text not null check (length(btrim(body)) > 0 and length(body) <= 2000),
  created_at  timestamp with time zone not null default now()
);

create index if not exists deal_notes_org_idx on public.deal_notes (org_id);
create index if not exists deal_notes_deal_created_idx
  on public.deal_notes (deal_id, created_at desc);

alter table public.deal_notes enable row level security;

revoke all on table public.deal_notes from anon;
grant select, insert on table public.deal_notes to authenticated;
grant all on table public.deal_notes to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'deal_notes'
      and policyname = 'members read own org deal notes'
  ) then
    create policy "members read own org deal notes"
      on public.deal_notes
      for select to authenticated
      using (
        exists (
          select 1 from public.org_members om
          where om.org_id = deal_notes.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'deal_notes'
      and policyname = 'members insert own org deal notes'
  ) then
    create policy "members insert own org deal notes"
      on public.deal_notes
      for insert to authenticated
      with check (
        exists (
          select 1 from public.org_members om
          where om.org_id = deal_notes.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'deal_notes'
      and policyname = 'service_role writes deal notes'
  ) then
    create policy "service_role writes deal notes"
      on public.deal_notes
      for all to service_role
      using (true)
      with check (true);
  end if;
end$$;
