-- 20261104100000_org_pe_root_files.sql
-- Per-organization "root files" for the PE department skills: the firm's own
-- mandate-as-tests, return hurdles, evidence grades, IC memo format, KPI
-- definitions, financing limits and reporting policy. One row per (org, file key).
-- A missing row is NOT an error: skills fall back to labelled standing settings
-- and mark their output "default-screened" / "run on default settings".
--
-- `content` is jsonb, validated defensively in application code
-- (lib/pe/root-files.ts); only the sourcing phase (`mandate`) is typed so far.
-- Tenancy: members read; only owners/admins write — these files are firm policy,
-- and `mandate.status = 'approved'` is a partner sign-off, not an analyst edit.

create table if not exists public.org_pe_root_files (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  file_key        text not null
                    check (file_key in ('firm', 'mandate', 'returns', 'evidence', 'ic_memo', 'kpi', 'financing', 'reporting')),
  content         jsonb not null default '{}'::jsonb,
  version         integer not null default 1 check (version >= 1),
  updated_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, file_key)
);

drop trigger if exists org_pe_root_files_set_updated_at on public.org_pe_root_files;
create trigger org_pe_root_files_set_updated_at
  before update on public.org_pe_root_files
  for each row execute function public.set_updated_at();

alter table public.org_pe_root_files enable row level security;

drop policy if exists org_pe_root_files_select on public.org_pe_root_files;
create policy org_pe_root_files_select on public.org_pe_root_files
  for select using (organization_id in (select public.current_principal_org_ids()));

drop policy if exists org_pe_root_files_write on public.org_pe_root_files;
create policy org_pe_root_files_write on public.org_pe_root_files
  for all using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));
