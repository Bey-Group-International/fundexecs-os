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
    check (status = 'open' or closed_at is not null),
  -- A closed stage is not a forecast. "committed" is certain and "passed" is
  -- not happening, so neither can carry odds in between: weighted_total below
  -- multiplies target_amount by probability, and a won deal sitting at 50 would
  -- report half the capital the firm actually raised.
  constraint network_opportunities_terminal_probability
    check (
      (stage <> 'committed' or probability = 100)
      and (stage <> 'passed' or probability = 0)
    ),
  -- Status is derived from stage, so the two cannot disagree. Without this a
  -- direct write could close a deal while leaving it in 'diligence': it would
  -- drop out of the open pipeline while every stage-keyed report still counted
  -- it as live work. The column stays for the partial indexes below.
  constraint network_opportunities_status_stage
    check (
      status = case stage
        when 'committed' then 'won'
        when 'passed' then 'lost'
        else 'open'
      end
    )
);

-- The table above is created `if not exists`, so a database that already has it
-- from an earlier run of this branch would skip the constraint entirely.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'network_opportunities_terminal_probability'
      and conrelid = 'public.network_opportunities'::regclass
  ) then
    update public.network_opportunities
      set probability = case when stage = 'committed' then 100 else 0 end
      where (stage = 'committed' and probability <> 100)
         or (stage = 'passed' and probability <> 0);

    alter table public.network_opportunities
      add constraint network_opportunities_terminal_probability
      check (
        (stage <> 'committed' or probability = 100)
        and (stage <> 'passed' or probability = 0)
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'network_opportunities_status_stage'
      and conrelid = 'public.network_opportunities'::regclass
  ) then
    update public.network_opportunities
      set status = case stage
            when 'committed' then 'won'
            when 'passed' then 'lost'
            else 'open'
          end,
          closed_at = case
            when stage in ('committed', 'passed') then coalesce(closed_at, now())
            else null
          end
      where status <> case stage
            when 'committed' then 'won'
            when 'passed' then 'lost'
            else 'open'
          end;

    alter table public.network_opportunities
      add constraint network_opportunities_status_stage
      check (
        status = case stage
          when 'committed' then 'won'
          when 'passed' then 'lost'
          else 'open'
        end
      );
  end if;
end $$;

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
-- Tenant ownership for the rows an opportunity points at.
--
-- contact_id, investor_id, fund_id and commitment_id are single-column foreign
-- keys, so the schema alone lets a deal in org A reference org B's fund. The
-- API layer checks this too (validateOpportunityRefs), but PostgREST exposes
-- the table directly: an authenticated client can write it without going
-- through the route, so the boundary has to state the rule itself.
--
-- SECURITY DEFINER because a member cannot read another org's investors or
-- funds to check them — the question "does this row belong to my org?" has to
-- be answerable without granting sight of the row.
create or replace function public.network_opportunity_refs_ok(
  target_org uuid,
  p_investor_id uuid,
  p_fund_id uuid,
  p_commitment_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    (p_investor_id is null or exists (
      select 1 from public.investors i
      where i.id = p_investor_id and i.organization_id = target_org))
    and (p_fund_id is null or exists (
      select 1 from public.funds f
      where f.id = p_fund_id and f.organization_id = target_org))
    and (p_commitment_id is null or exists (
      select 1 from public.commitments c
      where c.id = p_commitment_id and c.organization_id = target_org));
$$;

revoke all on function public.network_opportunity_refs_ok(uuid, uuid, uuid, uuid) from public;
grant execute on function public.network_opportunity_refs_ok(uuid, uuid, uuid, uuid) to authenticated;

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
    and public.network_opportunity_refs_ok(
      organization_id, investor_id, fund_id, commitment_id
    )
  );

drop policy if exists network_opportunities_update on public.network_opportunities;
create policy network_opportunities_update on public.network_opportunities
  for update to authenticated
  using (
    organization_id in (select public.current_principal_org_ids())
    and (contact_id is null or public.network_contact_visible(contact_id))
  )
  -- Visibility is repeated on the NEW row, not just the old one. Postgres does
  -- refuse a move onto an invisible contact today (verified), but that falls
  -- out of how UPDATE re-checks the row rather than from anything this policy
  -- says. An authorization boundary should state its own rule, and the INSERT
  -- policy already states this one.
  with check (
    organization_id in (select public.current_principal_org_ids())
    and (contact_id is null or public.network_contact_visible(contact_id))
    and public.network_opportunity_refs_ok(
      organization_id, investor_id, fund_id, commitment_id
    )
  );

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

-- Dropped first: the return type gains a `currency` column, and `create or
-- replace` cannot change a function's return type. A database that already ran
-- an earlier version of this migration would otherwise fail here.
drop function if exists public.network_pipeline_summary(uuid);

create or replace function public.network_pipeline_summary(target_org uuid)
returns table (
  stage            text,
  currency         text,
  deal_count       bigint,
  target_total     numeric,
  weighted_total   numeric
)
language sql
stable
set search_path = public
as $$
  -- Grouped by currency as well as stage. Summing a EUR deal and a USD deal
  -- into one number produces a total that is not an amount of money in any
  -- currency, and the board would then label it with whichever symbol it
  -- happened to render. A firm raising across vehicles in more than one
  -- currency has to see them apart.
  select
    o.stage,
    o.currency,
    count(*) as deal_count,
    coalesce(sum(o.target_amount), 0) as target_total,
    -- What the pipeline is actually worth: size discounted by the odds.
    coalesce(sum(o.target_amount * o.probability / 100.0), 0) as weighted_total
  from public.network_opportunities o
  where o.organization_id = target_org
  -- No status filter: network_opportunities_status_stage makes stage decide
  -- status, so grouping by stage already separates open work from closed. That
  -- lets the closed columns carry real totals too, rather than whatever subset
  -- of cards the board happened to load.
  group by o.stage, o.currency;
$$;

grant execute on function public.network_pipeline_summary(uuid) to authenticated;

-- ── 6. Atomic custom-value merge ─────────────────────────────────────────────
--
-- Read-modify-write on a jsonb column loses concurrent edits: two requests read
-- the same `custom` snapshot, each merges its own key, and whichever writes
-- second erases the other's. That is not a theoretical race here — the table
-- view exists precisely so somebody can edit many cells quickly, and two cells
-- on the SAME row save independently.
--
-- These apply the already-validated keys in one statement, so the merge happens
-- in the database against the current row rather than against a snapshot the
-- application read moments earlier. `-` removes the keys the patch cleared,
-- which `||` alone cannot express.
--
-- SECURITY INVOKER (the default) is load-bearing: RLS still decides whether
-- this caller may write this row.

create or replace function public.network_contact_merge_custom(
  target_org uuid,
  target_contact uuid,
  patch jsonb,
  remove_keys text[] default '{}'::text[]
)
returns jsonb
language sql
volatile
set search_path = public
as $$
  update public.network_contacts c
     set custom = (coalesce(c.custom, '{}'::jsonb) || coalesce(patch, '{}'::jsonb))
                    - coalesce(remove_keys, '{}'::text[]),
         updated_at = now()
   where c.id = target_contact
     and c.organization_id = target_org
  returning c.custom;
$$;

grant execute on function public.network_contact_merge_custom(uuid, uuid, jsonb, text[]) to authenticated;

create or replace function public.network_opportunity_merge_custom(
  target_org uuid,
  target_opportunity uuid,
  patch jsonb,
  remove_keys text[] default '{}'::text[]
)
returns jsonb
language sql
volatile
set search_path = public
as $$
  update public.network_opportunities o
     set custom = (coalesce(o.custom, '{}'::jsonb) || coalesce(patch, '{}'::jsonb))
                    - coalesce(remove_keys, '{}'::text[]),
         updated_at = now()
   where o.id = target_opportunity
     and o.organization_id = target_org
  returning o.custom;
$$;

grant execute on function public.network_opportunity_merge_custom(uuid, uuid, jsonb, text[]) to authenticated;

-- ── 7. One-statement PATCH ───────────────────────────────────────────────────
--
-- A request can carry custom values and ordinary columns together. Doing those
-- as two calls — merge the jsonb, then update the scalars — means a failure
-- between them leaves the custom values written and the rest not, and the
-- caller is told the whole thing failed. The edit is then half-applied and
-- nobody knows which half.
--
-- Both happen in one UPDATE here, so they commit or roll back together, and the
-- jsonb merge still happens database-side (`custom || patch`) rather than as a
-- read-modify-write that would drop a concurrent edit to another key.
--
-- Columns are enumerated rather than applied dynamically: `scalars ? 'col'`
-- distinguishes "set this to null" from "leave it alone", and an explicit list
-- means a caller cannot reach a column the route never meant to expose.

create or replace function public.network_contact_apply_patch(
  target_org uuid,
  target_contact uuid,
  scalars jsonb default '{}'::jsonb,
  custom_patch jsonb default '{}'::jsonb,
  remove_keys text[] default '{}'::text[]
)
returns jsonb
language sql
volatile
set search_path = public
as $$
  update public.network_contacts c
     set title = case when scalars ? 'title' then scalars->>'title' else c.title end,
         company = case when scalars ? 'company' then scalars->>'company' else c.company end,
         notes = case when scalars ? 'notes' then scalars->>'notes' else c.notes end,
         stage = case when scalars ? 'stage' then scalars->>'stage' else c.stage end,
         visibility = case when scalars ? 'visibility'
                        then scalars->>'visibility' else c.visibility end,
         relationship_owner = case when scalars ? 'relationship_owner'
                        then (scalars->>'relationship_owner')::uuid
                        else c.relationship_owner end,
         next_step_at = case when scalars ? 'next_step_at'
                        then (scalars->>'next_step_at')::timestamptz
                        else c.next_step_at end,
         tags = case when scalars ? 'tags'
                  then coalesce(
                    (select array_agg(t) from jsonb_array_elements_text(scalars->'tags') t),
                    '{}'::text[])
                  else c.tags end,
         custom = (coalesce(c.custom, '{}'::jsonb) || coalesce(custom_patch, '{}'::jsonb))
                    - coalesce(remove_keys, '{}'::text[]),
         updated_at = now()
   where c.id = target_contact
     and c.organization_id = target_org
  returning to_jsonb(c);
$$;

grant execute on function public.network_contact_apply_patch(uuid, uuid, jsonb, jsonb, text[])
  to authenticated;

create or replace function public.network_opportunity_apply_patch(
  target_org uuid,
  target_opportunity uuid,
  scalars jsonb default '{}'::jsonb,
  custom_patch jsonb default '{}'::jsonb,
  remove_keys text[] default '{}'::text[]
)
returns jsonb
language sql
volatile
set search_path = public
as $$
  update public.network_opportunities o
     set name = case when scalars ? 'name' then scalars->>'name' else o.name end,
         stage = case when scalars ? 'stage' then scalars->>'stage' else o.stage end,
         status = case when scalars ? 'status' then scalars->>'status' else o.status end,
         contact_id = case when scalars ? 'contact_id'
                        then (scalars->>'contact_id')::uuid else o.contact_id end,
         investor_id = case when scalars ? 'investor_id'
                        then (scalars->>'investor_id')::uuid else o.investor_id end,
         fund_id = case when scalars ? 'fund_id'
                        then (scalars->>'fund_id')::uuid else o.fund_id end,
         owner_id = case when scalars ? 'owner_id'
                        then (scalars->>'owner_id')::uuid else o.owner_id end,
         target_amount = case when scalars ? 'target_amount'
                        then (scalars->>'target_amount')::numeric else o.target_amount end,
         currency = case when scalars ? 'currency' then scalars->>'currency' else o.currency end,
         probability = case when scalars ? 'probability'
                        then (scalars->>'probability')::integer else o.probability end,
         expected_close = case when scalars ? 'expected_close'
                        then (scalars->>'expected_close')::date else o.expected_close end,
         closed_at = case when scalars ? 'closed_at'
                        then (scalars->>'closed_at')::timestamptz else o.closed_at end,
         lost_reason = case when scalars ? 'lost_reason'
                        then scalars->>'lost_reason' else o.lost_reason end,
         source = case when scalars ? 'source' then scalars->>'source' else o.source end,
         notes = case when scalars ? 'notes' then scalars->>'notes' else o.notes end,
         tags = case when scalars ? 'tags'
                  then coalesce(
                    (select array_agg(t) from jsonb_array_elements_text(scalars->'tags') t),
                    '{}'::text[])
                  else o.tags end,
         custom = (coalesce(o.custom, '{}'::jsonb) || coalesce(custom_patch, '{}'::jsonb))
                    - coalesce(remove_keys, '{}'::text[]),
         updated_at = now()
   where o.id = target_opportunity
     and o.organization_id = target_org
  returning to_jsonb(o);
$$;

grant execute on function public.network_opportunity_apply_patch(uuid, uuid, jsonb, jsonb, text[])
  to authenticated;
