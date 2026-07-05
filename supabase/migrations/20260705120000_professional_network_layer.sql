-- 20260705120000_professional_network_layer.sql
--
-- Professional Network layer: extend the existing Network OS contact model
-- (network_contacts, 20260702000200) into the Capital Relationship Graph the
-- integrations/professional-network module targets. Extends — does not
-- replace — the existing tables, per "do not rebuild the graph system".
--
--  1. network_contacts gains capital-market classification (capital_role),
--     workflow relevance (relevance_score), permission state, and soft
--     archival. Existing rows default sensibly.
--  2. outreach_drafts — approval-gated outreach artifacts. Drafting is Tier 1
--     (internal work product); SENDING remains a Tier-2 dispatch through the
--     gate layer and is never done from this table directly.

-- ── 1. network_contacts extensions ──────────────────────────────────────────

alter table public.network_contacts
  add column if not exists capital_role text not null default 'unknown'
    check (capital_role in (
      'fund_manager','limited_partner','independent_sponsor','capital_provider',
      'family_office','operator','founder','broker','lender','advisor',
      'strategic_partner','service_provider','unknown'
    )),
  add column if not exists relationship_type text,
  add column if not exists relevance_score integer not null default 0
    check (relevance_score between 0 and 100),
  add column if not exists permission_status text not null default 'connected'
    check (permission_status in (
      'not_connected','pending_user_approval','connected','sync_paused',
      'disconnected','revoked'
    )),
  add column if not exists archived_at timestamptz;

create index if not exists network_contacts_capital_role_idx
  on public.network_contacts (organization_id, capital_role)
  where archived_at is null;

create index if not exists network_contacts_relevance_idx
  on public.network_contacts (organization_id, relevance_score desc)
  where archived_at is null;

-- ── 2. outreach_drafts ───────────────────────────────────────────────────────
-- Earn-drafted (or user-drafted) outreach tied to a contact. A draft is
-- internal work product; the send happens through the dispatch gate layer
-- (send_outreach, Tier 2) and records the decision here for the audit trail.

create table if not exists public.outreach_drafts (
  id               uuid primary key default extensions.gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  contact_id       uuid references public.network_contacts (id) on delete set null,
  created_by       uuid references public.principals (id) on delete set null,
  channel          text not null default 'email'
                     check (channel in ('email','linkedin_message','intro_request','follow_up')),
  subject          text,
  body             text not null,
  -- Why Earn drafted this — evidence in business language, shown to the user.
  rationale        text,
  status           text not null default 'draft'
                     check (status in ('draft','approved','rejected','sent','archived')),
  approved_by      uuid references public.principals (id) on delete set null,
  approved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists outreach_drafts_org_idx
  on public.outreach_drafts (organization_id, status);
create index if not exists outreach_drafts_contact_idx
  on public.outreach_drafts (contact_id);

create trigger outreach_drafts_set_updated_at
  before update on public.outreach_drafts
  for each row execute function public.set_updated_at();

alter table public.outreach_drafts enable row level security;

create policy outreach_drafts_select on public.outreach_drafts
  for select to authenticated
  using (organization_id in (select public.current_principal_org_ids()));

create policy outreach_drafts_insert on public.outreach_drafts
  for insert to authenticated
  with check (
    organization_id in (select public.current_principal_org_ids())
    and created_by = (select auth.uid())
    -- Drafts are born unsent: nothing enters this table already 'sent'.
    and status in ('draft')
  );

create policy outreach_drafts_update on public.outreach_drafts
  for update to authenticated
  using (organization_id in (select public.current_principal_org_ids()))
  with check (organization_id in (select public.current_principal_org_ids()));

create policy outreach_drafts_delete on public.outreach_drafts
  for delete to authenticated
  using (organization_id in (select public.current_principal_org_ids()));
