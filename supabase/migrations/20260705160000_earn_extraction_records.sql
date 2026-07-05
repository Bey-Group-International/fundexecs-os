-- 20260705160000_earn_extraction_records.sql
--
-- SEAM #2 — the real, browser-FREE live-extraction record homes. Data reaches
-- these tables ONLY on explicit operator approval of a review-queue item (see
-- /api/earn/browser/approve-extraction); extraction alone never writes here.
--
--   1. edgar_filing_records — approved SEC EDGAR filings (form, date, accession,
--      primary document URL) tied to the company they belong to.
--   2. diligence_reports    — approved company/entity facts gathered from a
--      public source (EDGAR facts or a public website), one row per subject.
--
-- RLS mirrors 20260705120000_professional_network_layer.sql: reads/writes are
-- scoped to the caller's orgs via current_principal_org_ids(), and inserts tie
-- the acting principal to (select auth.uid()).

-- ── 1. edgar_filing_records ──────────────────────────────────────────────────

create table if not exists public.edgar_filing_records (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  -- The browser-operator session this filing was approved from (optional link).
  session_id        uuid references public.earn_browser_sessions (id) on delete set null,
  created_by        uuid references public.principals (id) on delete set null,
  company_name      text,
  cik               text,
  form              text,
  filing_date       date,
  accession_number  text,
  primary_doc_url   text,
  source_url        text,
  filed_summary     text,
  raw               jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists edgar_filing_records_org_idx
  on public.edgar_filing_records (organization_id, filing_date desc);
create index if not exists edgar_filing_records_cik_idx
  on public.edgar_filing_records (organization_id, cik);
create index if not exists edgar_filing_records_session_idx
  on public.edgar_filing_records (session_id);

alter table public.edgar_filing_records enable row level security;

create policy edgar_filing_records_select on public.edgar_filing_records
  for select to authenticated
  using (organization_id in (select public.current_principal_org_ids()));

create policy edgar_filing_records_insert on public.edgar_filing_records
  for insert to authenticated
  with check (
    organization_id in (select public.current_principal_org_ids())
    and (created_by is null or created_by = (select auth.uid()))
  );

create policy edgar_filing_records_update on public.edgar_filing_records
  for update to authenticated
  using (organization_id in (select public.current_principal_org_ids()))
  with check (organization_id in (select public.current_principal_org_ids()));

create policy edgar_filing_records_delete on public.edgar_filing_records
  for delete to authenticated
  using (organization_id in (select public.current_principal_org_ids()));

-- ── 2. diligence_reports ─────────────────────────────────────────────────────

create table if not exists public.diligence_reports (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  session_id        uuid references public.earn_browser_sessions (id) on delete set null,
  created_by        uuid references public.principals (id) on delete set null,
  subject           text not null,
  source_type       text,
  source_url        text,
  summary           text,
  -- Approved field → value map (company facts, contact details, etc.).
  data              jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists diligence_reports_org_idx
  on public.diligence_reports (organization_id, created_at desc);
create index if not exists diligence_reports_session_idx
  on public.diligence_reports (session_id);

create trigger diligence_reports_set_updated_at
  before update on public.diligence_reports
  for each row execute function public.set_updated_at();

alter table public.diligence_reports enable row level security;

create policy diligence_reports_select on public.diligence_reports
  for select to authenticated
  using (organization_id in (select public.current_principal_org_ids()));

create policy diligence_reports_insert on public.diligence_reports
  for insert to authenticated
  with check (
    organization_id in (select public.current_principal_org_ids())
    and (created_by is null or created_by = (select auth.uid()))
  );

create policy diligence_reports_update on public.diligence_reports
  for update to authenticated
  using (organization_id in (select public.current_principal_org_ids()))
  with check (organization_id in (select public.current_principal_org_ids()));

create policy diligence_reports_delete on public.diligence_reports
  for delete to authenticated
  using (organization_id in (select public.current_principal_org_ids()));
