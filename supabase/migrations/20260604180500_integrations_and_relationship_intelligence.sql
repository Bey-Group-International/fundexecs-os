-- =====================================================================
-- Integrations + Relationship Intelligence (warm connections).
-- Provider-agnostic: Gmail, Google/Outlook Calendar, Calendly, Slack,
-- Apollo, etc. all feed `interactions`; a trigger maintains per-user
-- relationship warmth scores that power warm-intro suggestions.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Connected integrations (tokens are NOT stored here — see private.integration_secrets)
-- ---------------------------------------------------------------------
create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null, -- google_calendar | gmail | google_drive | calendly | slack | apollo | airtable | outlook | zoom | ...
  external_account text, -- the connected account identifier (email / workspace)
  status text not null default 'connected', -- connected | error | revoked
  scopes text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id, provider, external_account)
);
create index integration_connections_user_idx on public.integration_connections (user_id);
create index integration_connections_org_idx on public.integration_connections (org_id);

-- OAuth tokens live in the non-API-exposed private schema (use Supabase Vault
-- in production). Only the service role / SECURITY DEFINER jobs can read these.
create table private.integration_secrets (
  connection_id uuid primary key references public.integration_connections (id) on delete cascade,
  access_token text,
  refresh_token text,
  token_type text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table private.integration_secrets enable row level security; -- no policies = no anon/authenticated access

-- ---------------------------------------------------------------------
-- Contacts — the org's extended network (deduped via contact_identities)
-- ---------------------------------------------------------------------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  full_name text,
  primary_email extensions.citext,
  company text,
  title text,
  source_provider text,
  enrichment jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contacts_org_idx on public.contacts (org_id);
create unique index contacts_org_email_idx
  on public.contacts (org_id, primary_email) where primary_email is not null;

-- Multiple identities (emails, phones, linkedin, slack id, domain) per contact
create table public.contact_identities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  kind text not null, -- email | phone | linkedin | slack | domain | other
  value extensions.citext not null,
  created_at timestamptz not null default now(),
  unique (org_id, kind, value)
);
create index contact_identities_contact_idx on public.contact_identities (contact_id);

-- ---------------------------------------------------------------------
-- Interactions — normalized touchpoints from every integration (the signal)
-- ---------------------------------------------------------------------
create table public.interactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  connection_id uuid references public.integration_connections (id) on delete set null,
  provider text,
  type text not null, -- email_sent | email_received | meeting | call | message | calendar_event | note
  direction text not null default 'outbound', -- inbound | outbound | internal
  occurred_at timestamptz not null default now(),
  subject text,
  summary text,
  external_ref text, -- provider message/event id (idempotency)
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (org_id, provider, external_ref)
);
create index interactions_contact_idx on public.interactions (org_id, contact_id);
create index interactions_user_idx on public.interactions (org_id, user_id);
create index interactions_occurred_idx on public.interactions (occurred_at desc);

-- ---------------------------------------------------------------------
-- Relationships — per-user ↔ contact warmth (auto-maintained by trigger)
-- ---------------------------------------------------------------------
create table public.relationships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  strength numeric(5, 2) not null default 0,
  status text not null default 'cold', -- cold | warm | hot
  interaction_count int not null default 0,
  first_interaction_at timestamptz,
  last_interaction_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  signals jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  unique (org_id, user_id, contact_id)
);
create index relationships_org_contact_idx on public.relationships (org_id, contact_id);
create index relationships_strength_idx on public.relationships (org_id, strength desc);

-- ---------------------------------------------------------------------
-- Warm introductions — "who in your network can intro you to X"
-- ---------------------------------------------------------------------
create table public.warm_introductions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  requester_id uuid references public.profiles (id) on delete set null,
  target_contact_id uuid not null references public.contacts (id) on delete cascade,
  connector_user_id uuid references public.profiles (id) on delete set null,
  connector_contact_id uuid references public.contacts (id) on delete set null,
  strength numeric(5, 2),
  rationale text,
  status text not null default 'suggested', -- suggested | requested | sent | declined | made
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index warm_introductions_org_idx on public.warm_introductions (org_id);
create index warm_introductions_target_idx on public.warm_introductions (target_contact_id);

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
create trigger set_updated_at before update on public.integration_connections for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.contacts for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.warm_introductions for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Warmth scoring: frequency (capped) + recency decay over ~180 days
-- ---------------------------------------------------------------------
create or replace function public.relationship_strength(_count int, _last timestamptz)
returns numeric language sql stable set search_path = public as $$
  select round(
    least(
      100,
      least(coalesce(_count, 0), 20) * 3
        + greatest(0, 1 - (extract(epoch from (now() - coalesce(_last, now()))) / 86400.0) / 180.0) * 40
    )::numeric,
    2
  );
$$;

-- Maintain relationships whenever an interaction lands (from any provider).
create or replace function public.touch_relationship()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.contact_id is null or new.user_id is null then
    return new;
  end if;

  insert into public.relationships (
    org_id, user_id, contact_id, interaction_count,
    first_interaction_at, last_interaction_at, last_inbound_at, last_outbound_at
  )
  values (
    new.org_id, new.user_id, new.contact_id, 1,
    new.occurred_at, new.occurred_at,
    case when new.direction = 'inbound' then new.occurred_at end,
    case when new.direction = 'outbound' then new.occurred_at end
  )
  on conflict (org_id, user_id, contact_id) do update set
    interaction_count = public.relationships.interaction_count + 1,
    first_interaction_at = least(public.relationships.first_interaction_at, excluded.first_interaction_at),
    last_interaction_at = greatest(public.relationships.last_interaction_at, excluded.last_interaction_at),
    last_inbound_at = greatest(public.relationships.last_inbound_at, excluded.last_inbound_at),
    last_outbound_at = greatest(public.relationships.last_outbound_at, excluded.last_outbound_at);

  update public.relationships r
  set strength = public.relationship_strength(r.interaction_count, r.last_interaction_at),
      status = case
        when public.relationship_strength(r.interaction_count, r.last_interaction_at) >= 66 then 'hot'
        when public.relationship_strength(r.interaction_count, r.last_interaction_at) >= 33 then 'warm'
        else 'cold'
      end,
      computed_at = now()
  where r.org_id = new.org_id and r.user_id = new.user_id and r.contact_id = new.contact_id;

  return new;
end;
$$;

create trigger on_interaction_touch_relationship
  after insert on public.interactions
  for each row execute function public.touch_relationship();

-- ---------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------
alter table public.integration_connections enable row level security;
alter table public.contacts enable row level security;
alter table public.contact_identities enable row level security;
alter table public.interactions enable row level security;
alter table public.relationships enable row level security;
alter table public.warm_introductions enable row level security;

-- ---------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------
-- integration_connections: personal to the user; org admins can view
create policy "view own or org connections" on public.integration_connections
  for select to authenticated using (user_id = auth.uid() or private.is_org_admin(org_id));
create policy "manage own connections" on public.integration_connections
  for all to authenticated
  using (user_id = auth.uid() and private.is_org_member(org_id))
  with check (user_id = auth.uid() and private.is_org_member(org_id));

-- contacts: shared at org level
create policy "members read contacts" on public.contacts for select to authenticated using (private.is_org_member(org_id));
create policy "members write contacts" on public.contacts for insert to authenticated with check (private.is_org_member(org_id));
create policy "members update contacts" on public.contacts for update to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));
create policy "admins delete contacts" on public.contacts for delete to authenticated using (private.is_org_admin(org_id));

-- contact_identities: org level
create policy "members read contact_identities" on public.contact_identities for select to authenticated using (private.is_org_member(org_id));
create policy "members write contact_identities" on public.contact_identities for insert to authenticated with check (private.is_org_member(org_id));
create policy "admins delete contact_identities" on public.contact_identities for delete to authenticated using (private.is_org_admin(org_id));

-- interactions: private to the owning user (email/meeting content); admins may read
create policy "view own interactions" on public.interactions
  for select to authenticated using (user_id = auth.uid() or private.is_org_admin(org_id));
create policy "write own interactions" on public.interactions
  for insert to authenticated with check (user_id = auth.uid() and private.is_org_member(org_id));
create policy "delete own interactions" on public.interactions
  for delete to authenticated using (user_id = auth.uid() or private.is_org_admin(org_id));

-- relationships: aggregated scores (no content) are visible org-wide so the
-- team can find warm paths; direct writes restricted to the owner (the trigger
-- runs SECURITY DEFINER so ingestion still maintains them).
create policy "members read relationships" on public.relationships
  for select to authenticated using (private.is_org_member(org_id));
create policy "owner writes relationships" on public.relationships
  for all to authenticated
  using (user_id = auth.uid() and private.is_org_member(org_id))
  with check (user_id = auth.uid() and private.is_org_member(org_id));

-- warm_introductions: org level
create policy "members read warm_introductions" on public.warm_introductions for select to authenticated using (private.is_org_member(org_id));
create policy "members write warm_introductions" on public.warm_introductions for insert to authenticated with check (private.is_org_member(org_id));
create policy "members update warm_introductions" on public.warm_introductions for update to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));
create policy "admins delete warm_introductions" on public.warm_introductions for delete to authenticated using (private.is_org_admin(org_id));
