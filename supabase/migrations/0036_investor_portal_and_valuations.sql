-- 0036_investor_portal_and_valuations.sql
-- Two Carta-style additions to the Execute hub:
--   1. Investor portal — read-only, token-gated external statements for any
--      stakeholder (LP, co-GP, institution), mirroring the data-room share model.
--   2. Valuation marks — an audit trail of fair-value marks per holding over
--      time, so the portfolio's value history is recorded, not just its latest.

-- ---------------------------------------------------------------------------
-- investor_portal_shares — a per-investor read-only link. Public reads are
-- served by a server route using the service role (token-gated), so no anon
-- policy is needed. Valid when not revoked and not past its (optional) expiry.
-- ---------------------------------------------------------------------------
create table public.investor_portal_shares (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  investor_id     uuid not null references public.investors (id) on delete cascade,
  token           text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  label           text,
  expires_at      timestamptz,
  revoked_at      timestamptz,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index investor_portal_shares_org_idx on public.investor_portal_shares (organization_id);
create index investor_portal_shares_investor_idx on public.investor_portal_shares (investor_id);

-- Access log, written by the public route via the service role.
create table public.investor_portal_views (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  share_id        uuid references public.investor_portal_shares (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index investor_portal_views_org_idx on public.investor_portal_views (organization_id, created_at desc);

alter table public.investor_portal_shares enable row level security;
alter table public.investor_portal_views  enable row level security;

create policy investor_portal_shares_select on public.investor_portal_shares
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy investor_portal_shares_write on public.investor_portal_shares
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

create policy investor_portal_views_select on public.investor_portal_views
  for select using (organization_id in (select public.current_principal_org_ids()));
-- No member insert policy: views are written by the public route via the
-- service role.

-- ---------------------------------------------------------------------------
-- valuation_marks — the valuation audit trail. One row per fair-value mark on a
-- holding, with the method and an optional note, so marks-over-time and a value
-- bridge can be reconstructed. The asset's current_value remains the latest mark.
-- ---------------------------------------------------------------------------
create table public.valuation_marks (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  asset_id        uuid not null references public.assets (id) on delete cascade,
  value           numeric not null,
  as_of           date not null default current_date,
  method          text,
  note            text,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index valuation_marks_asset_idx on public.valuation_marks (asset_id, as_of desc);
create index valuation_marks_org_idx on public.valuation_marks (organization_id, created_at desc);

alter table public.valuation_marks enable row level security;

create policy valuation_marks_select on public.valuation_marks
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy valuation_marks_write on public.valuation_marks
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
