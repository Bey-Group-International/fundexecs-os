-- 20260907120000_access_request_profile.sql
-- /request-access becomes a real sign-up form: who they are, what kind of firm
-- they run, and the details that differ by type.
--
-- Two shapes of column, on purpose:
--
--   * Typed columns for the answers ONBOARDING also asks for (organization
--     name, HQ, AUM band, fund count, strategy). An approved operator should
--     confirm these in the wizard, not retype them, and prefill needs to read
--     them without unpacking JSON. The values deliberately reuse the vocabulary
--     organizations already constrains (aum_range buckets, strategy slugs) so a
--     prefill is a straight copy.
--   * `details` jsonb for the answers that only matter to the reviewer and vary
--     per applicant type — an advisor's service line, an LP's ticket size, an
--     operator's sector. Six types × their own fields would otherwise be a wide
--     sparse table that grows a column every time we add a question.
--
-- applicant_type is its OWN vocabulary, not organizations.operator_role. Four
-- of the six map to a role one-to-one; 'lp' and 'service_provider' do not exist
-- as operator roles today, and inventing them here would mean touching the
-- ecosystem matcher's lane matrix. They are captured, reviewed and approved
-- like anyone else — they simply pick their role in onboarding rather than
-- having it prefilled.

alter table public.access_requests
  add column if not exists applicant_type    text,
  add column if not exists organization_name text,
  add column if not exists hq_location       text,
  add column if not exists website           text,
  add column if not exists phone             text,
  add column if not exists aum_range         text,
  add column if not exists fund_count        integer,
  add column if not exists primary_strategy  text,
  add column if not exists details           jsonb not null default '{}'::jsonb;

-- Guarded separately: ADD COLUMN ... CHECK is not re-runnable once the column
-- exists, and this repo's migrations must stay idempotent.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'access_requests_applicant_type_check'
  ) then
    alter table public.access_requests
      add constraint access_requests_applicant_type_check
      check (
        applicant_type is null or applicant_type in (
          'gp', 'family_office', 'advisory', 'operator', 'lp', 'service_provider'
        )
      );
  end if;

  -- Same buckets organizations.aum_range is constrained to, so an approved
  -- request prefills the wizard without translation.
  if not exists (
    select 1 from pg_constraint where conname = 'access_requests_aum_range_check'
  ) then
    alter table public.access_requests
      add constraint access_requests_aum_range_check
      check (
        aum_range is null or aum_range in
          ('sub_25m', '25m_100m', '100m_500m', '500m_1b', 'over_1b')
      );
  end if;

  -- A negative fund count is a typo, not a fund.
  if not exists (
    select 1 from pg_constraint where conname = 'access_requests_fund_count_check'
  ) then
    alter table public.access_requests
      add constraint access_requests_fund_count_check
      check (fund_count is null or fund_count >= 0);
  end if;
end $$;

comment on column public.access_requests.applicant_type is
  'gp | family_office | advisory | operator | lp | service_provider — drives which fields the form asks for';
comment on column public.access_requests.details is
  'Type-specific answers that only the reviewer reads (service line, ticket size, sector, …)';
