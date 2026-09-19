-- 20260919140000_network_workspace.sql
--
-- Phase 1 of the institutional workspace: the pipeline object the Network OS
-- was missing, and org-defined columns.
--
-- Why an opportunity object at all. 20260919120000 put a `stage` on the
-- contact, which says where ONE relationship sits — but an allocator does not
-- have one position. The same LP can be in diligence on Fund III, committed to
-- Fund II, and passed on the co-invest, all at once. A single column on the
-- person cannot express that, and forcing it to is what makes a sales CRM feel
-- wrong to a capital-formation team. So the pipeline moves onto its own row.
--
-- What this is NOT. funds and commitments already exist (0004_capital.sql) and
-- are not re-modelled here. A commitment is the CLOSED outcome — signed, with a
-- real amount, unique per (fund, investor). An opportunity is the work BEFORE
-- that: a target size, a probability, an expected close. When one is won it
-- points at the commitment it produced rather than becoming a second copy of it.
--
--   1. network_opportunities — the allocation being worked.
--   2. network_field_defs    — per-org column definitions.
--   3. custom jsonb          — the values those definitions describe, on both
--                              contacts and opportunities.
--   4. opportunity_id        — on activities and tasks, so the timeline and the
--                              follow-up queue cover deals as well as people.

-- ── 1. network_opportunities ─────────────────────────────────────────────────

create table if not exists public.network_opportunities (
  id               uuid primary key default extensions.gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,

  -- Who it is with. A contact, a tracked investor, or both — an LP is often
  -- both a firm in the capital map and a person in the relationship book.
  contact_id       uuid references public.network_contacts (id) on delete set null,
  investor_id      uuid references public.investors (id) on delete set null,
  -- What they would be committing into. Nullable: early pipeline often predates
  -- the vehicle being chosen.
  fund_id          uuid references public.funds (id) on delete set null,

  name             text not null,
  stage            text not null default 'sourced'
                     check (stage in (
                       'sourced','qualified','diligence','ic_review',
                       'legal','committed','passed'
                     )),
  status           text not null default 'open'
                     check (status in ('open','won','lost')),

  -- The size being worked. Deliberately distinct from commitments.committed_amount,
  -- which is what was actually signed.
  target_amount    numeric(18, 2),
  currency         text not null default 'USD',
  probability      integer not null default 0 check (probability between 0 and 100),
  expected_close   date,
  closed_at        timestamptz,
  lost_reason      text,

  -- Set when this is won: the commitment row it produced. This is the join that
  -- keeps the pipeline honest — a won opportunity with no commitment is a
  -- reporting error, not a closed deal.
  commitment_id    uuid references public.commitments (id) on delete set null,

  owner_id         uuid references public.principals (id) on delete set null,
  created_by       uuid references public.principals (id) on delete set null,
  source           text,
  notes            text,
  tags             text[] not null default '{}',
  -- Values for this org's own columns; see network_field_defs below.
  custom           jsonb not null default '{}'::jsonb,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- An opportunity with no counterparty is not a pipeline entry, it is a note.
  constraint network_opportunities_counterparty
    check (contact_id is not null or investor_id is not null),
  -- A closed opportunity has to say when. Keeps "won last quarter" answerable.
  constraint network_opportunities_closed_at
    check (status = 'open' or closed_at is not null)
);

create index if not exists network_opportunities_org_stage_idx
  on public.network_opportunities (organization_id, stage)
  where status = 'open';
create index if not exists network_opportunities_org_status_idx
  on public.network_opportunities (organization_id, status, expected_close);
create index if not exists network_opportunities_contact_idx
  on public.network_opportunities (contact_id) where contact_id is not null;
create index if not exists network_opportunities_investor_idx
  on public.network_opportunities (investor_id) where investor_id is not null;
create index if not exists network_opportunities_fund_idx
  on public.network_opportunities (fund_id) where fund_id is not null;
create index if not exists network_opportunities_owner_idx
  on public.network_opportunities (organization_id, owner_id)
  where status = 'open';
create index if not exists network_opportunities_custom_idx
  on public.network_opportunities using gin (custom jsonb_path_ops);

drop trigger if exists network_opportunities_set_updated_at on public.network_opportunities;
create trigger network_opportunities_set_updated_at
  before update on public.network_opportunities
  for each row execute function public.set_updated_at();

alter table public.network_opportunities enable row level security;

-- An opportunity inherits its contact's visibility: a private relationship's
-- pipeline must not be readable through the deal when the person is hidden.
drop policy if exists network_opportunities_select on public.network_opportunities;
create policy network_opportunities_select on public.network_opportunities
  for select to authenticated
  using (
    organization_id in (select public.current_principal_org_ids())
    and (contact_id is null or public.network_contact_visible(contact_id))
  );

drop policy if exists network_opportunities_insert on public.network_opportunities;
create policy network_opportunities_insert on public.network_opportunities
  for insert to authenticated
  with check (
    organization_id in (select public.current_principal_org_ids())
    and (contact_id is null or public.network_contact_visible(contact_id))
  );

drop policy if exists network_opportunities_update on public.network_opportunities;
create policy network_opportunities_update on public.network_opportunities
  for update to authenticated
  using (
    organization_id in (select public.current_principal_org_ids())
    and (contact_id is null or public.network_contact_visible(contact_id))
  )
  with check (organization_id in (select public.current_principal_org_ids()));

drop policy if exists network_opportunities_delete on public.network_opportunities;
create policy network_opportunities_delete on public.network_opportunities
  for delete to authenticated
  using (
    organization_id in (select public.current_principal_org_ids())
    and (created_by = (select auth.uid()) or public.is_org_admin(organization_id))
  );

-- ── 2. network_field_defs — the org's own columns ────────────────────────────
--
-- Every institution tracks something the next one does not: an AUM band, a
-- consultant, an investment-committee date, a placement agent. Shipping a fixed
-- schema means the first firm that needs one of those is blocked on a migration.
--
-- Definitions live in a table; the VALUES live in a jsonb column on the row
-- they describe. That keeps one row per contact (a join-per-field EAV would
-- turn every list read into a fan-out) while letting the UI stay driven by data
-- rather than by code.

create table if not exists public.network_field_defs (
  id               uuid primary key default extensions.gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  -- Which object this column belongs to.
  entity           text not null default 'contact'
                     check (entity in ('contact','opportunity')),
  -- The key inside the row's `custom` object. Slug-shaped so it is safe to use
  -- as a jsonb key and stable across renames of the label.
  field_key        text not null check (field_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label            text not null,
  field_type       text not null default 'text'
                     check (field_type in (
                       'text','long_text','number','currency','percent',
                       'date','boolean','select','multi_select','url','email'
                     )),
  -- Allowed choices for select / multi_select, as a json array of strings.
  options          jsonb not null default '[]'::jsonb,
  help_text        text,
  is_required      boolean not null default false,
  position         integer not null default 0,
  -- Soft-retire rather than delete: existing rows keep the value they hold, and
  -- dropping a column should never silently destroy recorded data.
  archived_at      timestamptz,
  created_by       uuid references public.principals (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, entity, field_key)
);

create index if not exists network_field_defs_org_idx
  on public.network_field_defs (organization_id, entity, position)
  where archived_at is null;

drop trigger if exists network_field_defs_set_updated_at on public.network_field_defs;
create trigger network_field_defs_set_updated_at
  before update on public.network_field_defs
  for each row execute function public.set_updated_at();

alter table public.network_field_defs enable row level security;

-- Everyone in the org reads the column definitions — they are the shape of the
-- shared workspace. Only admins change them, because adding or retiring a
-- column changes what every member sees.
drop policy if exists network_field_defs_select on public.network_field_defs;
create policy network_field_defs_select on public.network_field_defs
  for select to authenticated
  using (organization_id in (select public.current_principal_org_ids()));

drop policy if exists network_field_defs_insert on public.network_field_defs;
create policy network_field_defs_insert on public.network_field_defs
  for insert to authenticated
  with check (public.is_org_admin(organization_id));

drop policy if exists network_field_defs_update on public.network_field_defs;
create policy network_field_defs_update on public.network_field_defs
  for update to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

drop policy if exists network_field_defs_delete on public.network_field_defs;
create policy network_field_defs_delete on public.network_field_defs
  for delete to authenticated
  using (public.is_org_admin(organization_id));

-- ── 3. Custom values on contacts ─────────────────────────────────────────────

alter table public.network_contacts
  add column if not exists custom jsonb not null default '{}'::jsonb;

comment on column public.network_contacts.custom is
  'Values for this org''s network_field_defs rows (entity = contact), keyed by field_key.';

create index if not exists network_contacts_custom_idx
  on public.network_contacts using gin (custom jsonb_path_ops);

-- ── 4. Deals on the timeline and in the queue ────────────────────────────────

alter table public.network_activities
  add column if not exists opportunity_id uuid
    references public.network_opportunities (id) on delete cascade;

create index if not exists network_activities_opportunity_idx
  on public.network_activities (opportunity_id, occurred_at desc)
  where opportunity_id is not null;

alter table public.network_tasks
  add column if not exists opportunity_id uuid
    references public.network_opportunities (id) on delete cascade;

create index if not exists network_tasks_opportunity_idx
  on public.network_tasks (opportunity_id, status, due_at)
  where opportunity_id is not null;

-- network_activities_subject_present required a contact or an investor. An
-- activity logged against a deal is now equally valid, so the constraint widens
-- rather than being dropped — an activity attached to nothing is still refused.
alter table public.network_activities
  drop constraint if exists network_activities_subject_present;
alter table public.network_activities
  add constraint network_activities_subject_present
    check (contact_id is not null or investor_id is not null or opportunity_id is not null);

-- Logging against a deal should also refresh the person's recency, so the
-- roster's "gone quiet" sort does not go stale while the deal is being worked.
create or replace function public.network_contact_touch_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := new.contact_id;
begin
  if target is null and new.opportunity_id is not null then
    select o.contact_id into target
      from public.network_opportunities o
     where o.id = new.opportunity_id;
  end if;

  if target is not null then
    update public.network_contacts
       set last_activity_at = greatest(
             coalesce(last_activity_at, new.occurred_at),
             new.occurred_at
           ),
           updated_at = now()
     where id = target;
  end if;
  return new;
end;
$$;

-- ── 5. Pipeline rollup ───────────────────────────────────────────────────────
-- The numbers the board header shows, computed in one pass rather than by
-- pulling every deal to the client and summing it there.

create or replace function public.network_pipeline_summary(target_org uuid)
returns table (
  stage            text,
  deal_count       bigint,
  target_total     numeric,
  weighted_total   numeric
)
language sql
stable
set search_path = public
as $$
  select
    o.stage,
    count(*) as deal_count,
    coalesce(sum(o.target_amount), 0) as target_total,
    -- What the pipeline is actually worth: size discounted by the odds.
    coalesce(sum(o.target_amount * o.probability / 100.0), 0) as weighted_total
  from public.network_opportunities o
  where o.organization_id = target_org
    and o.status = 'open'
  group by o.stage;
$$;

grant execute on function public.network_pipeline_summary(uuid) to authenticated;
