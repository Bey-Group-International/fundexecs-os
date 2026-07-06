-- Contact compliance layer for the native Relationship Intelligence Engine.
--
-- Compliance-by-design for outbound: before any contact is enrolled in a
-- sequence or messaged, the system must know (a) whether they've asked not to
-- be contacted, (b) the lawful basis for contacting them, and (c) any flags
-- that require review. This migration adds the suppression + consent primitives
-- the outreach path checks. Native and self-contained — no external service.

-- ── 1. Consent / communication state on each contact ──────────────────────────
alter table network_contacts
  add column if not exists communication_status text not null default 'allowed',
  -- allowed | unsubscribed | bounced | do_not_contact | blocked
  add column if not exists consent_basis text,
  -- existing_relationship | opt_in | referral | public_professional | legitimate_interest
  add column if not exists consent_source text,
  add column if not exists consent_at timestamptz,
  add column if not exists compliance_flags text[] not null default '{}';

comment on column network_contacts.communication_status is
  'Outbound eligibility gate: only "allowed" contacts may be enrolled/messaged.';

-- ── 2. Do-not-contact suppression list ────────────────────────────────────────
-- Org-scoped suppression that outlives any single contact row. A match by
-- contact_id, exact email, or company domain blocks outreach. Keeping this
-- separate from network_contacts means a suppression survives re-imports and
-- can pre-empt a contact that doesn't exist in the CRM yet.
create table if not exists do_not_contact (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  scope           text not null default 'email',  -- email | domain | contact
  contact_id      uuid references network_contacts(id) on delete set null,
  email           text,
  domain          text,
  reason          text,
  source          text,                            -- unsubscribe | manual | bounce | complaint | import
  added_by        uuid references auth.users(id),
  created_at      timestamptz default now()
);

create index if not exists do_not_contact_org_idx on do_not_contact(organization_id);
create index if not exists do_not_contact_email_idx on do_not_contact(organization_id, lower(email));
create index if not exists do_not_contact_domain_idx on do_not_contact(organization_id, lower(domain));
create index if not exists do_not_contact_contact_idx on do_not_contact(contact_id);

alter table do_not_contact enable row level security;

create policy "org members can manage their do-not-contact list"
  on do_not_contact
  for all
  using (
    organization_id in (
      select organization_id from organization_members where principal_id = auth.uid()
    )
  );

-- ── 3. Unsubscribe / complaint events ─────────────────────────────────────────
-- An append-only log of unsubscribe and complaint signals, for audit and to
-- drive the suppression list. Never updated in place.
create table if not exists unsubscribe_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  contact_id      uuid references network_contacts(id) on delete set null,
  email           text,
  campaign_ref    text,                             -- free-form sequence/campaign identifier
  event_type      text not null default 'unsubscribe',  -- unsubscribe | complaint | bounce
  source          text,
  created_at      timestamptz default now()
);

create index if not exists unsubscribe_events_org_idx on unsubscribe_events(organization_id);
create index if not exists unsubscribe_events_contact_idx on unsubscribe_events(contact_id);

alter table unsubscribe_events enable row level security;

create policy "org members can view their unsubscribe events"
  on unsubscribe_events
  for all
  using (
    organization_id in (
      select organization_id from organization_members where principal_id = auth.uid()
    )
  );
