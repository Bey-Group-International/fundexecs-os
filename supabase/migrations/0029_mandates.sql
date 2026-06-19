-- 0029_mandates.sql
-- Mandates — the operator's standing job-description for Earn, persisted. The
-- gate layer (lib/gates.ts) is a pure classifier; a Mandate is the stored
-- delegation it consumes: a named set of Tier-2 actions the operator has
-- standing-approved to run unattended, up to an autonomy ceiling.
--
-- The sacred approval loop is preserved. A mandate can only ever RELAX Tier 2;
-- Tier 1 is always free and Tier 3 is always the operator's. The autonomy
-- ceiling is capped at 2 in the database itself — Tier 3 is never delegable, so
-- there is no row that could even claim to authorize it.
--
-- One mandate is "active" at a time per org (enforced softly: the lookup reads
-- the most recent active row); the rest are history the operator can re-activate.

create table public.mandates (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null,
  -- the operator's plain-English intent for this delegation, e.g. "Run LP
  -- outreach for the Fund III raise without me in the loop".
  goal            text,
  -- ActionKind values (lib/gates.ts) the operator has standing-approved. Only
  -- Tier-2 kinds belong here; the gate ignores any Tier-1/Tier-3 entry anyway.
  auto_approve     text[] not null default '{}',
  -- the highest tier this mandate may auto-execute. Capped at 2 — Tier 3 is
  -- never delegable, so the constraint makes an impossible ceiling unstorable.
  autonomy_ceiling int not null default 2 check (autonomy_ceiling between 1 and 2),
  is_active        boolean not null default true,
  created_by       uuid references public.principals (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index mandates_org_idx on public.mandates (organization_id, created_at desc);
-- The active-mandate lookup finds the org's current standing delegation here.
create index mandates_active_idx on public.mandates (organization_id, updated_at desc)
  where is_active;

create trigger mandates_set_updated_at
  before update on public.mandates
  for each row execute function public.set_updated_at();

-- RLS: same member-read / writer-write org tenancy as the rest of the domain.
alter table public.mandates enable row level security;

create policy mandates_select on public.mandates
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy mandates_write on public.mandates
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
