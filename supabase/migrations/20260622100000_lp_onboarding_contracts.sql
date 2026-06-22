-- 20260622100000_lp_onboarding_contracts.sql
-- LP Onboarding Portal (Repool clone) + Contract Lifecycle Management (Contract Monkey clone).
-- Written idempotently (IF NOT EXISTS + drop/recreate policies) so it is safe to re-apply.

-- ---------------------------------------------------------------------------
-- lp_onboarding_sessions
-- Tracks one LP through the full onboarding flow:
--   pending → accreditation → subscription → committed → complete
-- A unique token is sent to the LP; the public portal route uses it to look
-- up the session via the service role (no anon policy required).
-- ---------------------------------------------------------------------------
create table if not exists public.lp_onboarding_sessions (
  id                        uuid primary key default extensions.gen_random_uuid(),
  organization_id           uuid not null references public.organizations (id) on delete cascade,
  investor_id               uuid references public.investors (id) on delete set null,
  fund_id                   uuid references public.funds (id) on delete set null,
  token                     text not null unique default encode(extensions.gen_random_bytes(32), 'hex'),
  status                    text not null default 'pending'
                              check (status in ('pending','accreditation','subscription','committed','complete','expired')),
  lp_name                   text not null,
  lp_email                  text not null,
  commitment_amount         numeric(18,2),
  accreditation_type        text check (accreditation_type in (
                              'accredited_investor','qualified_purchaser','qualified_client','institutional'
                            )),
  accreditation_verified_at timestamptz,
  kyc_status                text not null default 'pending'
                              check (kyc_status in ('pending','in_progress','verified','failed')),
  kyc_verified_at           timestamptz,
  docusign_envelope_id      text,
  subscription_signed_at    timestamptz,
  capital_received_at       timestamptz,
  wire_instructions         jsonb not null default '{}',
  notes                     text,
  expires_at                timestamptz not null default (now() + interval '30 days'),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists lp_onboarding_sessions_org_idx    on public.lp_onboarding_sessions (organization_id);
create index if not exists lp_onboarding_sessions_token_idx  on public.lp_onboarding_sessions (token);
create index if not exists lp_onboarding_sessions_inv_idx    on public.lp_onboarding_sessions (investor_id);
create index if not exists lp_onboarding_sessions_status_idx on public.lp_onboarding_sessions (status);

drop trigger if exists lp_onboarding_sessions_set_updated_at on public.lp_onboarding_sessions;
create trigger lp_onboarding_sessions_set_updated_at
  before update on public.lp_onboarding_sessions
  for each row execute function public.set_updated_at();

alter table public.lp_onboarding_sessions enable row level security;

drop policy if exists lp_onboarding_sessions_select on public.lp_onboarding_sessions;
create policy lp_onboarding_sessions_select on public.lp_onboarding_sessions
  for select using (organization_id in (select public.current_principal_org_ids()));

drop policy if exists lp_onboarding_sessions_write on public.lp_onboarding_sessions;
create policy lp_onboarding_sessions_write on public.lp_onboarding_sessions
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- ---------------------------------------------------------------------------
-- contract_templates
-- Reusable fund document templates with variable placeholders.
-- ---------------------------------------------------------------------------
create table if not exists public.contract_templates (
  id                 uuid primary key default extensions.gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  created_by         uuid references public.principals (id) on delete set null,
  name               text not null,
  document_type      text not null check (document_type in (
                       'lpa','subscription_agreement','side_letter','nda','loi',
                       'term_sheet','co_invest_agreement','advisory_agreement','other'
                     )),
  content_markdown   text,
  -- [{ key, label, source: 'fund'|'investor'|'deal'|'manual', required }]
  content_variables  jsonb not null default '[]',
  is_active          boolean not null default true,
  version            integer not null default 1,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists contract_templates_org_idx  on public.contract_templates (organization_id);
create index if not exists contract_templates_type_idx on public.contract_templates (document_type);

drop trigger if exists contract_templates_set_updated_at on public.contract_templates;
create trigger contract_templates_set_updated_at
  before update on public.contract_templates
  for each row execute function public.set_updated_at();

alter table public.contract_templates enable row level security;

drop policy if exists contract_templates_select on public.contract_templates;
create policy contract_templates_select on public.contract_templates
  for select using (organization_id in (select public.current_principal_org_ids()));

drop policy if exists contract_templates_write on public.contract_templates;
create policy contract_templates_write on public.contract_templates
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- ---------------------------------------------------------------------------
-- contracts
-- Live contract instances — generated from templates or uploaded directly.
-- ---------------------------------------------------------------------------
create table if not exists public.contracts (
  id                   uuid primary key default extensions.gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  template_id          uuid references public.contract_templates (id) on delete set null,
  fund_id              uuid references public.funds (id) on delete set null,
  deal_id              uuid references public.deals (id) on delete set null,
  investor_id          uuid references public.investors (id) on delete set null,
  created_by           uuid references public.principals (id) on delete set null,
  title                text not null,
  document_type        text not null,
  status               text not null default 'draft'
                         check (status in ('draft','review','sent','signed','active','expired','terminated')),
  docusign_envelope_id text,
  signed_at            timestamptz,
  effective_date       date,
  expiry_date          date,
  renewal_alert_days   integer not null default 30,
  renewal_alerted_at   timestamptz,
  -- { preferred_return, carry_pct, mfn, redemption_rights, no_shop, ... }
  extracted_clauses    jsonb not null default '{}',
  file_url             text,
  file_size_bytes      integer,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists contracts_org_idx    on public.contracts (organization_id);
create index if not exists contracts_fund_idx   on public.contracts (fund_id);
create index if not exists contracts_deal_idx   on public.contracts (deal_id);
create index if not exists contracts_inv_idx    on public.contracts (investor_id);
create index if not exists contracts_status_idx on public.contracts (status);
create index if not exists contracts_expiry_idx on public.contracts (expiry_date) where expiry_date is not null;

drop trigger if exists contracts_set_updated_at on public.contracts;
create trigger contracts_set_updated_at
  before update on public.contracts
  for each row execute function public.set_updated_at();

alter table public.contracts enable row level security;

drop policy if exists contracts_select on public.contracts;
create policy contracts_select on public.contracts
  for select using (organization_id in (select public.current_principal_org_ids()));

drop policy if exists contracts_write on public.contracts;
create policy contracts_write on public.contracts
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
