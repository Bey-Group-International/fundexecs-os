-- ============================================================================
-- partner_intro_requests — apply / request-intro for directory entries.
--
-- Partners (service_providers, capital_providers) are not contacts, so the
-- existing warm_introductions table (which requires target_contact_id) cannot
-- be reused directly. This table tracks user-initiated apply / request-intro
-- actions against either provider table. Additive + idempotent.
-- ============================================================================

create table if not exists public.partner_intro_requests (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  requester_id uuid not null references public.profiles (id) on delete cascade,
  -- Which directory table the target lives in: 'service_provider' | 'capital_provider'
  partner_type text not null,
  partner_id  uuid not null,
  partner_name text not null,
  rationale   text,
  -- 'requested' | 'accepted' | 'declined' | 'introduced'
  status      text not null default 'requested',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One open request per (org, requester, partner) at a time. The table is
-- polymorphic (service_provider / capital_provider), so partner_type is part of
-- the identity to avoid cross-table id collisions in the dedupe key.
drop index if exists public.partner_intro_requests_open_uniq;
create unique index if not exists partner_intro_requests_open_uniq
  on public.partner_intro_requests (org_id, requester_id, partner_type, partner_id)
  where status = 'requested';

create index if not exists partner_intro_requests_org_idx
  on public.partner_intro_requests (org_id);

create index if not exists partner_intro_requests_requester_idx
  on public.partner_intro_requests (requester_id);

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_updated_at'
      and tgrelid = 'public.partner_intro_requests'::regclass
  ) then
    create trigger set_updated_at
      before update on public.partner_intro_requests
      for each row execute function public.set_updated_at();
  end if;
end$$;

-- RLS
alter table public.partner_intro_requests enable row level security;

revoke all on table public.partner_intro_requests from anon, authenticated;
grant select, insert on table public.partner_intro_requests to authenticated;
grant select, insert, update, delete on table public.partner_intro_requests to service_role;

drop policy if exists "members read own partner_intro_requests" on public.partner_intro_requests;
create policy "members read own partner_intro_requests"
  on public.partner_intro_requests
  for select to authenticated
  using (
    private.is_org_member(org_id)
    and requester_id = auth.uid()
  );

drop policy if exists "members insert partner_intro_requests" on public.partner_intro_requests;
create policy "members insert partner_intro_requests"
  on public.partner_intro_requests
  for insert to authenticated
  with check (
    private.is_org_member(org_id)
    and requester_id = auth.uid()
  );
