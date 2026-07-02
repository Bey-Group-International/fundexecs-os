-- Network OS: relationship capital layer inspired by SocialSweep.
-- Adds imported contacts, warm-intro tracking, syndicate circles, and saved lists.

-- ── 1. Network contacts ───────────────────────────────────────────────────────
-- Contacts imported from LinkedIn CSV or added manually, enriched via Apollo.

create table if not exists network_contacts (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  imported_by       uuid references auth.users(id),

  -- Identity
  first_name        text not null,
  last_name         text not null,
  full_name         text generated always as (first_name || ' ' || last_name) stored,
  email             text,
  phone             text,
  linkedin_url      text,
  avatar_url        text,

  -- Professional
  title             text,
  company           text,
  company_domain    text,
  location          text,
  seniority         text,  -- c_suite | vp | director | manager | individual
  department        text,

  -- Relationship metadata
  connected_on      date,   -- LinkedIn "Connected On" date
  source            text not null default 'linkedin_csv',  -- linkedin_csv | manual | apollo
  relationship_owner uuid references auth.users(id),

  -- Strength scoring (0–100). Computed from in-app activity + AI inference.
  strength_score    integer default 0 check (strength_score between 0 and 100),
  strength_label    text default 'cold',  -- cold | warm | active | strong
  strength_updated_at timestamptz,

  -- Apollo enrichment
  apollo_id         text,
  confidence        integer default 0 check (confidence between 0 and 100),
  verified          boolean default false,
  enriched_at       timestamptz,

  -- Notes
  notes             text,
  tags              text[] default '{}',

  -- Org-pool: if true, all org members can see this contact
  pooled            boolean default true,

  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index on network_contacts(organization_id);
create index on network_contacts(organization_id, strength_score desc);
create index on network_contacts(organization_id, company);
create index on network_contacts using gin(tags);

alter table network_contacts enable row level security;

create policy "org members can manage their network contacts"
  on network_contacts
  for all
  using (
    organization_id in (
      select organization_id from organization_members where user_id = auth.uid()
    )
  );

-- ── 2. Network import jobs ─────────────────────────────────────────────────────
-- Tracks LinkedIn CSV upload + enrichment progress.

create table if not exists network_import_jobs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  created_by      uuid references auth.users(id),
  source          text not null default 'linkedin_csv',
  status          text not null default 'pending',  -- pending | processing | enriching | done | failed
  total_rows      integer default 0,
  imported_rows   integer default 0,
  enriched_rows   integer default 0,
  failed_rows     integer default 0,
  error_message   text,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz default now()
);

alter table network_import_jobs enable row level security;

create policy "org members can view their import jobs"
  on network_import_jobs
  for all
  using (
    organization_id in (
      select organization_id from organization_members where user_id = auth.uid()
    )
  );

-- ── 3. Warm intro requests ────────────────────────────────────────────────────
-- Tracks warm introduction requests with the BFS path used.

create table if not exists intro_requests (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  requested_by      uuid references auth.users(id),

  -- Target contact
  target_contact_id uuid references network_contacts(id) on delete set null,
  target_name       text not null,
  target_company    text,

  -- BFS path (ordered array of names)
  intro_path        text[] not null default '{}',
  introducer_name   text,

  -- AI-generated message
  draft_message     text,

  -- Status
  status            text not null default 'draft',  -- draft | sent | replied | closed
  sent_via          text,  -- gmail | slack | manual
  sent_at           timestamptz,

  notes             text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

alter table intro_requests enable row level security;

create policy "org members can manage intro requests"
  on intro_requests
  for all
  using (
    organization_id in (
      select organization_id from organization_members where user_id = auth.uid()
    )
  );

-- ── 4. Syndicate circles (GP Inner Circles) ──────────────────────────────────
-- Groups of orgs/users that pool their networks for shared introductions.

create table if not exists syndicate_circles (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  created_by      uuid references auth.users(id),
  name            text not null,
  description     text,
  invite_code     text unique default substr(md5(random()::text), 1, 12),
  is_active       boolean default true,
  member_count    integer default 1,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table syndicate_circles enable row level security;

create policy "org members can view circles they belong to"
  on syndicate_circles
  for select
  using (
    organization_id in (
      select organization_id from organization_members where user_id = auth.uid()
    )
    or id in (
      select circle_id from circle_memberships where user_id = auth.uid()
    )
  );

create policy "org members can manage their circles"
  on syndicate_circles
  for insert
  with check (
    organization_id in (
      select organization_id from organization_members where user_id = auth.uid()
    )
  );

-- ── 5. Circle memberships ─────────────────────────────────────────────────────

create table if not exists circle_memberships (
  id              uuid primary key default gen_random_uuid(),
  circle_id       uuid not null references syndicate_circles(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id         uuid references auth.users(id),
  role            text not null default 'member',  -- owner | admin | member
  share_network   boolean default true,
  joined_at       timestamptz default now(),
  unique(circle_id, organization_id)
);

alter table circle_memberships enable row level security;

create policy "circle members can view memberships"
  on circle_memberships
  for select
  using (
    circle_id in (
      select id from syndicate_circles
      where organization_id in (
        select organization_id from organization_members where user_id = auth.uid()
      )
    )
    or user_id = auth.uid()
  );

-- ── 6. Saved contact lists ────────────────────────────────────────────────────
-- Like SocialSweep "Save Lists" — curated collections for follow-up.

create table if not exists contact_lists (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  created_by      uuid references auth.users(id),
  name            text not null,
  description     text,
  color           text default 'blue',
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table contact_lists enable row level security;

create policy "org members can manage contact lists"
  on contact_lists
  for all
  using (
    organization_id in (
      select organization_id from organization_members where user_id = auth.uid()
    )
  );

create table if not exists contact_list_members (
  id          uuid primary key default gen_random_uuid(),
  list_id     uuid not null references contact_lists(id) on delete cascade,
  contact_id  uuid not null references network_contacts(id) on delete cascade,
  added_at    timestamptz default now(),
  unique(list_id, contact_id)
);

alter table contact_list_members enable row level security;

create policy "org members can manage list members"
  on contact_list_members
  for all
  using (
    list_id in (
      select id from contact_lists
      where organization_id in (
        select organization_id from organization_members where user_id = auth.uid()
      )
    )
  );
