-- 20260707140000_shareholder_comms.sql
--
-- Backing store for the Shareholder Comms module (Execute › Shareholder Comms):
-- LP/shareholder communication templates — quarterly updates, capital calls,
-- distribution notices, annual reports, and ad-hoc notes — tracked through a
-- draft → scheduled → sent lifecycle. Org-scoped, member-read / writer-write
-- RLS, mirroring the rest of the domain. Fully idempotent.

create table if not exists public.shareholder_comms (
  id               uuid primary key default extensions.gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  title            text not null,
  type             text not null default 'ad_hoc'
                     check (type in ('quarterly_update', 'capital_call', 'distribution_notice', 'annual_report', 'ad_hoc')),
  status           text not null default 'draft'
                     check (status in ('draft', 'scheduled', 'sent')),
  last_sent_date   timestamptz,
  recipient_count  integer,
  created_by       uuid references public.principals (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists shareholder_comms_org_created_idx
  on public.shareholder_comms (organization_id, created_at desc);

-- Keep updated_at fresh on update.
drop trigger if exists shareholder_comms_set_updated_at on public.shareholder_comms;
create trigger shareholder_comms_set_updated_at
  before update on public.shareholder_comms
  for each row execute function public.set_updated_at();

alter table public.shareholder_comms enable row level security;

drop policy if exists shareholder_comms_select on public.shareholder_comms;
create policy shareholder_comms_select on public.shareholder_comms
  for select
  using (organization_id in (select public.current_principal_org_ids()));

drop policy if exists shareholder_comms_write on public.shareholder_comms;
create policy shareholder_comms_write on public.shareholder_comms
  for all
  using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
