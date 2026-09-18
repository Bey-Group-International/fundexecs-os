-- 20260919120000_network_crm_spine.sql
--
-- The institutional CRM spine for Network OS.
--
-- Until now the network was composed at query time from the Source hub and had
-- nowhere to PUT anything: no per-relationship history, no owner, no stage, no
-- follow-up, no record of who looked at what. That is the difference between a
-- ranked address book and a CRM an institution can run on — and every gap below
-- is one an LP or a compliance review asks about.
--
--   1. network_contacts gains the relationship state a CRM turns on: stage,
--      visibility, activity recency, and a merge tombstone. Ownership reuses
--      the relationship_owner column that has been on the table since
--      20260702000200 rather than adding a second owner concept.
--   2. network_activities — the unified timeline. One append-oriented row per
--      thing that happened with a person: note, call, meeting, email, intro,
--      stage change, commitment. This is the record view's spine.
--   3. network_tasks — follow-ups with an owner and a due date, so "next step"
--      is a tracked commitment rather than a field someone retypes.
--   4. network_saved_views — named, shareable segments of the roster.
--   5. network_audit_log — append-only, admin-readable: who viewed, edited,
--      exported, merged, or reassigned a relationship.
--   6. search_network_contacts() — lexical search over the fts column added in
--      20260702000300 and never used, with a trigram fallback for misspellings.
--
-- Composition is unchanged: investors, partners, and providers still flow into
-- the roster from their own tables. This adds the layer that was missing, it
-- does not move the graph.

-- ── 1. network_contacts: relationship state ──────────────────────────────────

alter table public.network_contacts
  -- Where this relationship sits in the capital-formation cycle. Deliberately
  -- distinct from strength_label (how warm they are) — a contact can be warm
  -- and still be 'prospect', or cold and 'committed'.
  add column if not exists stage text not null default 'prospect'
    check (stage in ('prospect','engaged','diligence','committed','dormant','passed')),
  -- 'org' — every member sees it (the existing pooled behaviour, and the
  -- default so nothing already in the table changes hands). 'private' — only
  -- the owner, the person who added it, and org admins.
  add column if not exists visibility text not null default 'org'
    check (visibility in ('org','private')),
  -- Denormalised recency, maintained by the activity trigger below. Lets the
  -- roster sort by "who has gone quiet" without aggregating the timeline.
  add column if not exists last_activity_at timestamptz,
  add column if not exists next_step_at timestamptz,
  -- Merge tombstone. The losing row is kept (foreign keys, audit trail, and
  -- so a re-import cannot resurrect the duplicate) but excluded everywhere.
  add column if not exists merged_into_id uuid
    references public.network_contacts (id) on delete set null;

comment on column public.network_contacts.stage is
  'Capital-formation stage. Distinct from strength_label, which is warmth.';
comment on column public.network_contacts.visibility is
  'org = pooled to every member (default); private = owner, creator, and admins only.';
comment on column public.network_contacts.merged_into_id is
  'Set when this row lost a merge. Non-null rows are excluded from every read.';

-- The predicate every live read uses: not archived, not merged away.
create index if not exists network_contacts_live_stage_idx
  on public.network_contacts (organization_id, stage)
  where archived_at is null and merged_into_id is null;

create index if not exists network_contacts_owner_idx
  on public.network_contacts (organization_id, relationship_owner)
  where archived_at is null and merged_into_id is null;

-- "Who have we not spoken to?" — nulls last is the point of the index.
create index if not exists network_contacts_last_activity_idx
  on public.network_contacts (organization_id, last_activity_at desc nulls last)
  where archived_at is null and merged_into_id is null;

-- Fuzzy name/company matching for the search fallback and for dedupe.
create index if not exists network_contacts_full_name_trgm_idx
  on public.network_contacts using gin (full_name extensions.gin_trgm_ops);

create index if not exists network_contacts_company_trgm_idx
  on public.network_contacts using gin (company extensions.gin_trgm_ops);

-- Dedupe lookups by email hit this rather than scanning the org.
create index if not exists network_contacts_email_lower_idx
  on public.network_contacts (organization_id, lower(email))
  where email is not null and archived_at is null and merged_into_id is null;

-- ── 2. Visibility helper ─────────────────────────────────────────────────────
-- SECURITY DEFINER so policies on the child tables can ask "may I see this
-- contact?" without recursing into the network_contacts policy.

create or replace function public.network_contact_visible(target_contact uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.network_contacts c
    where c.id = target_contact
      and c.organization_id in (select public.current_principal_org_ids())
      and (
        c.visibility = 'org'
        or c.relationship_owner = (select auth.uid())
        or c.imported_by = (select auth.uid())
        or public.is_org_admin(c.organization_id)
      )
  );
$$;

grant execute on function public.network_contact_visible(uuid) to authenticated;

-- Replace the blanket org-wide policy with one that honours visibility. Rows
-- default to 'org', so this is a no-op for everything already in the table.
drop policy if exists "org members can manage their network contacts" on public.network_contacts;

drop policy if exists network_contacts_select on public.network_contacts;
create policy network_contacts_select on public.network_contacts
  for select to authenticated
  using (
    organization_id in (select public.current_principal_org_ids())
    and (
      visibility = 'org'
      or relationship_owner = (select auth.uid())
      or imported_by = (select auth.uid())
      or public.is_org_admin(organization_id)
    )
  );

drop policy if exists network_contacts_insert on public.network_contacts;
create policy network_contacts_insert on public.network_contacts
  for insert to authenticated
  with check (organization_id in (select public.current_principal_org_ids()));

drop policy if exists network_contacts_update on public.network_contacts;
create policy network_contacts_update on public.network_contacts
  for update to authenticated
  using (
    organization_id in (select public.current_principal_org_ids())
    and (
      visibility = 'org'
      or relationship_owner = (select auth.uid())
      or imported_by = (select auth.uid())
      or public.is_org_admin(organization_id)
    )
  )
  with check (organization_id in (select public.current_principal_org_ids()));

-- Deleting a relationship is an admin act; everyone else archives.
drop policy if exists network_contacts_delete on public.network_contacts;
create policy network_contacts_delete on public.network_contacts
  for delete to authenticated
  using (public.is_org_admin(organization_id));

-- ── 3. network_activities — the relationship timeline ────────────────────────

create table if not exists public.network_activities (
  id               uuid primary key default extensions.gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  -- Exactly one subject is required; both is allowed when a contact is also a
  -- tracked investor, so the same event shows on both records.
  contact_id       uuid references public.network_contacts (id) on delete cascade,
  investor_id      uuid references public.investors (id) on delete cascade,
  actor_id         uuid references public.principals (id) on delete set null,
  activity_type    text not null
                     check (activity_type in (
                       'note','call','meeting','email','linkedin','intro',
                       'stage_change','owner_change','task','commitment',
                       'document','import','merge','other'
                     )),
  direction        text check (direction in ('inbound','outbound','internal')),
  subject          text,
  body             text,
  -- When it HAPPENED, which is not when it was logged. The timeline sorts on
  -- this so back-dating a call lands it in the right place.
  occurred_at      timestamptz not null default now(),
  -- Structured payload for machine-generated entries (from/to stage, message
  -- id, duration). Free-form by design; nothing reads it blindly.
  metadata         jsonb not null default '{}'::jsonb,
  -- System entries come from the engine and are not user-editable.
  is_system        boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint network_activities_subject_present
    check (contact_id is not null or investor_id is not null)
);

create index if not exists network_activities_org_idx
  on public.network_activities (organization_id, occurred_at desc);
create index if not exists network_activities_contact_idx
  on public.network_activities (contact_id, occurred_at desc)
  where contact_id is not null;
create index if not exists network_activities_investor_idx
  on public.network_activities (investor_id, occurred_at desc)
  where investor_id is not null;
create index if not exists network_activities_type_idx
  on public.network_activities (organization_id, activity_type, occurred_at desc);

drop trigger if exists network_activities_set_updated_at on public.network_activities;
create trigger network_activities_set_updated_at
  before update on public.network_activities
  for each row execute function public.set_updated_at();

alter table public.network_activities enable row level security;

drop policy if exists network_activities_select on public.network_activities;
create policy network_activities_select on public.network_activities
  for select to authenticated
  using (
    organization_id in (select public.current_principal_org_ids())
    and (contact_id is null or public.network_contact_visible(contact_id))
  );

drop policy if exists network_activities_insert on public.network_activities;
create policy network_activities_insert on public.network_activities
  for insert to authenticated
  with check (
    organization_id in (select public.current_principal_org_ids())
    and (contact_id is null or public.network_contact_visible(contact_id))
  );

-- Only your own hand-written entries, and never a system one.
drop policy if exists network_activities_update on public.network_activities;
create policy network_activities_update on public.network_activities
  for update to authenticated
  using (
    organization_id in (select public.current_principal_org_ids())
    and actor_id = (select auth.uid())
    and is_system = false
  )
  with check (organization_id in (select public.current_principal_org_ids()));

drop policy if exists network_activities_delete on public.network_activities;
create policy network_activities_delete on public.network_activities
  for delete to authenticated
  using (
    organization_id in (select public.current_principal_org_ids())
    and (actor_id = (select auth.uid()) or public.is_org_admin(organization_id))
    and is_system = false
  );

-- Logging an activity is what makes a relationship "recent". Maintained here
-- rather than in the app so an import, an agent, or a SQL backfill all count.
create or replace function public.network_contact_touch_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.contact_id is not null then
    update public.network_contacts
       set last_activity_at = greatest(
             coalesce(last_activity_at, new.occurred_at),
             new.occurred_at
           ),
           updated_at = now()
     where id = new.contact_id;
  end if;
  return new;
end;
$$;

drop trigger if exists network_activities_touch_contact on public.network_activities;
create trigger network_activities_touch_contact
  after insert on public.network_activities
  for each row execute function public.network_contact_touch_activity();

-- ── 4. network_tasks — tracked follow-ups ────────────────────────────────────

create table if not exists public.network_tasks (
  id               uuid primary key default extensions.gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  contact_id       uuid references public.network_contacts (id) on delete cascade,
  investor_id      uuid references public.investors (id) on delete cascade,
  title            text not null,
  notes            text,
  assignee_id      uuid references public.principals (id) on delete set null,
  created_by       uuid references public.principals (id) on delete set null,
  due_at           timestamptz,
  priority         text not null default 'normal' check (priority in ('low','normal','high')),
  status           text not null default 'open' check (status in ('open','done','cancelled')),
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- The "what's due" query: open work, soonest first.
create index if not exists network_tasks_due_idx
  on public.network_tasks (organization_id, due_at)
  where status = 'open';
create index if not exists network_tasks_assignee_idx
  on public.network_tasks (assignee_id, due_at)
  where status = 'open';
create index if not exists network_tasks_contact_idx
  on public.network_tasks (contact_id, status, due_at)
  where contact_id is not null;

drop trigger if exists network_tasks_set_updated_at on public.network_tasks;
create trigger network_tasks_set_updated_at
  before update on public.network_tasks
  for each row execute function public.set_updated_at();

alter table public.network_tasks enable row level security;

drop policy if exists network_tasks_select on public.network_tasks;
create policy network_tasks_select on public.network_tasks
  for select to authenticated
  using (
    organization_id in (select public.current_principal_org_ids())
    and (contact_id is null or public.network_contact_visible(contact_id))
  );

drop policy if exists network_tasks_insert on public.network_tasks;
create policy network_tasks_insert on public.network_tasks
  for insert to authenticated
  with check (
    organization_id in (select public.current_principal_org_ids())
    and (contact_id is null or public.network_contact_visible(contact_id))
  );

drop policy if exists network_tasks_update on public.network_tasks;
create policy network_tasks_update on public.network_tasks
  for update to authenticated
  using (organization_id in (select public.current_principal_org_ids()))
  with check (organization_id in (select public.current_principal_org_ids()));

drop policy if exists network_tasks_delete on public.network_tasks;
create policy network_tasks_delete on public.network_tasks
  for delete to authenticated
  using (
    organization_id in (select public.current_principal_org_ids())
    and (created_by = (select auth.uid()) or public.is_org_admin(organization_id))
  );

-- ── 5. network_saved_views — named roster segments ───────────────────────────

create table if not exists public.network_saved_views (
  id               uuid primary key default extensions.gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  created_by       uuid references public.principals (id) on delete set null,
  name             text not null,
  description      text,
  -- The roster query, stored as the same filter shape the API accepts.
  filters          jsonb not null default '{}'::jsonb,
  sort             text,
  is_shared        boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, created_by, name)
);

create index if not exists network_saved_views_org_idx
  on public.network_saved_views (organization_id, is_shared, name);

drop trigger if exists network_saved_views_set_updated_at on public.network_saved_views;
create trigger network_saved_views_set_updated_at
  before update on public.network_saved_views
  for each row execute function public.set_updated_at();

alter table public.network_saved_views enable row level security;

drop policy if exists network_saved_views_select on public.network_saved_views;
create policy network_saved_views_select on public.network_saved_views
  for select to authenticated
  using (
    organization_id in (select public.current_principal_org_ids())
    and (is_shared or created_by = (select auth.uid()))
  );

drop policy if exists network_saved_views_insert on public.network_saved_views;
create policy network_saved_views_insert on public.network_saved_views
  for insert to authenticated
  with check (
    organization_id in (select public.current_principal_org_ids())
    and created_by = (select auth.uid())
  );

drop policy if exists network_saved_views_update on public.network_saved_views;
create policy network_saved_views_update on public.network_saved_views
  for update to authenticated
  using (
    organization_id in (select public.current_principal_org_ids())
    and (created_by = (select auth.uid()) or public.is_org_admin(organization_id))
  )
  with check (organization_id in (select public.current_principal_org_ids()));

drop policy if exists network_saved_views_delete on public.network_saved_views;
create policy network_saved_views_delete on public.network_saved_views
  for delete to authenticated
  using (
    organization_id in (select public.current_principal_org_ids())
    and (created_by = (select auth.uid()) or public.is_org_admin(organization_id))
  );

-- ── 6. network_audit_log — append-only access trail ──────────────────────────
-- Who touched which relationship, and how. Deliberately has no update or
-- delete policy: once written, a member cannot alter or erase their own trail.
-- Only org admins can read it.

create table if not exists public.network_audit_log (
  id               uuid primary key default extensions.gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  actor_id         uuid references public.principals (id) on delete set null,
  action           text not null
                     check (action in (
                       'view','create','update','delete','archive','export',
                       'merge','assign','stage_change','bulk_update','search'
                     )),
  entity_type      text not null default 'network_contact',
  entity_id        uuid,
  -- The human label at the time of the act, so the trail still reads correctly
  -- after the underlying row is renamed, merged, or deleted.
  entity_label     text,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists network_audit_log_org_idx
  on public.network_audit_log (organization_id, created_at desc);
create index if not exists network_audit_log_entity_idx
  on public.network_audit_log (organization_id, entity_type, entity_id, created_at desc);
create index if not exists network_audit_log_actor_idx
  on public.network_audit_log (organization_id, actor_id, created_at desc);

alter table public.network_audit_log enable row level security;

drop policy if exists network_audit_log_select on public.network_audit_log;
create policy network_audit_log_select on public.network_audit_log
  for select to authenticated
  using (public.is_org_admin(organization_id));

drop policy if exists network_audit_log_insert on public.network_audit_log;
create policy network_audit_log_insert on public.network_audit_log
  for insert to authenticated
  with check (
    organization_id in (select public.current_principal_org_ids())
    and actor_id = (select auth.uid())
  );

-- ── 7. Lexical contact search ────────────────────────────────────────────────
-- Uses the fts column and GIN index added in 20260702000300, which nothing has
-- queried until now: network search has been parsing intent with a model call
-- and then running ILIKE. Ranked FTS first, trigram similarity as the fallback
-- so "Katherine" still finds "Kathryn".
--
-- SECURITY INVOKER (the default) is load-bearing: RLS on network_contacts —
-- including the visibility rule above — applies to the caller as usual.
--
-- A blank or whitespace-only query_text is NOT an error and does not match
-- nothing: it drops the text predicate so the structured filters below stand on
-- their own ("every contact in diligence", "everything Bob owns"). The result
-- is still bounded by match_limit and by the caller's own RLS, so this returns
-- no more than a plain select on the table would. The API layer short-circuits
-- an empty search box before it gets here; this is for filter-only callers.
--
-- extensions.similarity() needs USAGE on the extensions schema, which Supabase
-- grants to authenticated by default — the same thing 0024_brain_kb.sql and
-- 20260706120000_brain_kb_hybrid_search.sql already rely on.

create or replace function public.search_network_contacts(
  target_org uuid,
  query_text text,
  match_limit int default 20,
  stage_filter text default null,
  owner_filter uuid default null,
  role_filter text default null
)
returns table (
  id               uuid,
  full_name        text,
  title            text,
  company          text,
  location         text,
  email            text,
  linkedin_url     text,
  avatar_url       text,
  strength_score   integer,
  strength_label   text,
  capital_role     text,
  stage            text,
  tags             text[],
  connected_on     date,
  last_activity_at timestamptz,
  rank             real
)
language sql
stable
set search_path = public
as $$
  with q as (
    select
      nullif(trim(query_text), '') as raw,
      websearch_to_tsquery(
        'english',
        coalesce(nullif(trim(query_text), ''), 'zzzznomatchzzzz')
      ) as tsq
  )
  select
    c.id,
    c.full_name,
    c.title,
    c.company,
    c.location,
    c.email,
    c.linkedin_url,
    c.avatar_url,
    c.strength_score,
    c.strength_label,
    c.capital_role,
    c.stage,
    c.tags,
    c.connected_on,
    c.last_activity_at,
    greatest(
      ts_rank(c.fts, q.tsq),
      extensions.similarity(lower(coalesce(c.full_name, '')), lower(coalesce(q.raw, ''))),
      extensions.similarity(lower(coalesce(c.company, '')), lower(coalesce(q.raw, '')))
    )::real as rank
  from public.network_contacts c, q
  where c.organization_id = target_org
    and c.archived_at is null
    and c.merged_into_id is null
    and (stage_filter is null or c.stage = stage_filter)
    and (owner_filter is null or c.relationship_owner = owner_filter)
    and (role_filter is null or c.capital_role = role_filter)
    and (
      q.raw is null
      or c.fts @@ q.tsq
      -- q.raw is a bound parameter, never interpolated SQL, so a term
      -- containing % , or ) is matched literally instead of changing the query.
      or c.full_name ilike '%' || q.raw || '%'
      or c.company ilike '%' || q.raw || '%'
      or c.email ilike '%' || q.raw || '%'
      or extensions.similarity(lower(coalesce(c.full_name, '')), lower(q.raw)) > 0.3
      or extensions.similarity(lower(coalesce(c.company, '')), lower(q.raw)) > 0.3
    )
  order by rank desc, c.strength_score desc nulls last, c.full_name asc
  limit least(greatest(coalesce(match_limit, 20), 1), 100);
$$;

grant execute on function public.search_network_contacts(uuid, text, int, text, uuid, text) to authenticated;

-- ── 8. Backfill last_activity_at ─────────────────────────────────────────────
-- Existing rows have no timeline yet; seed recency from what the table already
-- knows so the "gone quiet" sort is meaningful on day one.

update public.network_contacts
   set last_activity_at = coalesce(strength_updated_at, updated_at, created_at)
 where last_activity_at is null;

-- ── 9. merge_network_contacts() ──────────────────────────────────────────────
--
-- Folding a duplicate into the record you keep, as one statement.
--
-- This cannot be done from the client, for two reasons.
--
-- First, RLS. network_activities_update deliberately restricts a member to
-- editing their OWN, non-system entries — that restriction is what makes the
-- timeline evidence. Reparenting a duplicate's history means moving entries
-- other people wrote and entries the engine wrote, which that policy correctly
-- forbids. Done over PostgREST the update would match zero rows, report no
-- error, and the caller would then tombstone the loser: its history stranded on
-- a hidden record, which is the exact outcome keeping the row is meant to
-- prevent.
--
-- Second, atomicity. PostgREST gives no transaction, so a client-side merge is
-- four independent writes that can stop halfway.
--
-- So the merge runs here, SECURITY DEFINER, with authorization checked
-- explicitly (membership, then visibility of BOTH records through the same
-- helper the policies use) because the definer context has bypassed RLS.
-- field_patch carries the already-decided field values from planMerge; this
-- function does not re-decide them, it applies them.

create or replace function public.merge_network_contacts(
  target_org uuid,
  keep_id uuid,
  merge_id uuid,
  field_patch jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller            uuid := (select auth.uid());
  moved_activities  integer := 0;
  moved_tasks       integer := 0;
  moved_drafts      integer := 0;
  loser_name        text;
begin
  if keep_id = merge_id then
    raise exception 'A record cannot be merged into itself' using errcode = '22023';
  end if;

  -- SECURITY DEFINER has bypassed RLS, so every check the policies would have
  -- made has to be made here instead.
  if caller is null or not exists (
    select 1 from public.organization_members
     where principal_id = caller and organization_id = target_org
  ) then
    raise exception 'Not a member of that organization' using errcode = '42501';
  end if;

  -- Visible to THIS caller, not merely present: a private record must not be
  -- reachable by merging it into one the caller can see.
  if not public.network_contact_visible(keep_id)
     or not public.network_contact_visible(merge_id) then
    raise exception 'Contact not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.network_contacts
     where id = keep_id and organization_id = target_org and merged_into_id is null
  ) then
    raise exception 'Contact not found' using errcode = 'P0002';
  end if;

  select full_name into loser_name
    from public.network_contacts
   where id = merge_id and organization_id = target_org and merged_into_id is null;

  if not found then
    raise exception 'Contact not found' using errcode = 'P0002';
  end if;

  -- History first, then the tombstone: if anything below raises, the whole
  -- function rolls back and both records are left intact and visible.
  update public.network_activities set contact_id = keep_id
   where organization_id = target_org and contact_id = merge_id;
  get diagnostics moved_activities = row_count;

  update public.network_tasks set contact_id = keep_id
   where organization_id = target_org and contact_id = merge_id;
  get diagnostics moved_tasks = row_count;

  update public.outreach_drafts set contact_id = keep_id
   where organization_id = target_org and contact_id = merge_id;
  get diagnostics moved_drafts = row_count;

  -- Suppression entries follow the person, not the row: a do-not-contact
  -- recorded against the duplicate must keep applying after the merge.
  update public.do_not_contact set contact_id = keep_id
   where organization_id = target_org and contact_id = merge_id;

  update public.unsubscribe_events set contact_id = keep_id
   where organization_id = target_org and contact_id = merge_id;

  -- Apply the decided field values. Columns are enumerated rather than built
  -- dynamically: field_patch is caller-supplied, and no part of it should ever
  -- be able to name a column of its own choosing.
  update public.network_contacts c set
    title                = coalesce(field_patch->>'title', c.title),
    company              = coalesce(field_patch->>'company', c.company),
    company_domain       = coalesce(field_patch->>'company_domain', c.company_domain),
    email                = coalesce(field_patch->>'email', c.email),
    phone                = coalesce(field_patch->>'phone', c.phone),
    linkedin_url         = coalesce(field_patch->>'linkedin_url', c.linkedin_url),
    avatar_url           = coalesce(field_patch->>'avatar_url', c.avatar_url),
    location             = coalesce(field_patch->>'location', c.location),
    relationship_type    = coalesce(field_patch->>'relationship_type', c.relationship_type),
    relationship_owner   = coalesce((field_patch->>'relationship_owner')::uuid, c.relationship_owner),
    connected_on         = coalesce((field_patch->>'connected_on')::date, c.connected_on),
    next_step_at         = coalesce((field_patch->>'next_step_at')::timestamptz, c.next_step_at),
    consent_basis        = coalesce(field_patch->>'consent_basis', c.consent_basis),
    consent_at           = coalesce((field_patch->>'consent_at')::timestamptz, c.consent_at),
    notes                = coalesce(field_patch->>'notes', c.notes),
    visibility           = coalesce(field_patch->>'visibility', c.visibility),
    communication_status = coalesce(field_patch->>'communication_status', c.communication_status),
    strength_score       = coalesce((field_patch->>'strength_score')::integer, c.strength_score),
    strength_label       = coalesce(field_patch->>'strength_label', c.strength_label),
    relevance_score      = coalesce((field_patch->>'relevance_score')::integer, c.relevance_score),
    confidence           = coalesce((field_patch->>'confidence')::integer, c.confidence),
    verified             = coalesce((field_patch->>'verified')::boolean, c.verified),
    last_activity_at     = coalesce((field_patch->>'last_activity_at')::timestamptz, c.last_activity_at),
    tags = case
             when field_patch ? 'tags'
               then array(select jsonb_array_elements_text(field_patch->'tags'))
             else c.tags
           end,
    compliance_flags = case
             when field_patch ? 'compliance_flags'
               then array(select jsonb_array_elements_text(field_patch->'compliance_flags'))
             else c.compliance_flags
           end,
    updated_at = now()
  where c.id = keep_id and c.organization_id = target_org;

  -- Tombstone last. The row is KEPT so its remaining foreign keys stay valid
  -- and a re-import recognises the duplicate instead of recreating it.
  update public.network_contacts
     set merged_into_id = keep_id,
         archived_at    = coalesce(archived_at, now()),
         updated_at     = now()
   where id = merge_id and organization_id = target_org;

  return jsonb_build_object(
    'keptId', keep_id,
    'mergedId', merge_id,
    'mergedLabel', loser_name,
    'movedActivities', moved_activities,
    'movedTasks', moved_tasks,
    'movedDrafts', moved_drafts
  );
end;
$$;

grant execute on function public.merge_network_contacts(uuid, uuid, uuid, jsonb) to authenticated;
