-- live_meetings.related_fund_id: the same treatment 20261001001500 gave
-- related_contact_id -- a composite foreign key, a check, and a partial index.
--
-- related_company_id is DELIBERATELY NOT HERE. The reason is in the last
-- section of this file, and it is not an oversight.

-- ---------------------------------------------------------------------------
-- related_fund_id
-- ---------------------------------------------------------------------------
--
-- Unlike related_contact_id, this column is actually READ.
-- lib/meetings/meeting-context.ts:169 and :194 pass it to loadFund(), which
-- queries
--
--   .from("funds").eq("id", fundId).eq("organization_id", orgId)
--
-- so the application already refuses a fund from another organisation at the
-- READ. That is the whole argument for this migration: the rule already exists
-- and is already relied on, it is simply enforced in one TypeScript function
-- instead of in the schema. Everything that writes the column -- today
-- lib/meetings/service.ts:452 via app/api/meetings/[id]/route.ts, tomorrow
-- anything else -- is unconstrained, and a value the read will silently
-- resolve to null is exactly the kind of value that gets written and never
-- noticed.
--
-- The foreign key makes the read's own filter a property of the data. After
-- this, `.eq("organization_id", orgId)` in loadFund can never discard a row:
-- a fund that is in the meeting's organisation is the only fund the column can
-- hold.

-- The composite reference needs a unique key to point at. `id` is already the
-- primary key of funds, so this adds no constraint the table did not already
-- have -- it only makes (id, organization_id) nameable as a foreign-key
-- target. Same shape as network_contacts_id_org_uniq in 20261001001500 and
-- inbox_threads_id_org_uniq in 20260930190000.
create unique index if not exists funds_id_org_uniq
  on public.funds (id, organization_id);

-- A meeting may only reference a fund in its OWN organisation.
--
-- ON DELETE SET NULL names its column, and the column list is load-bearing for
-- the same reason it was for related_contact_id. WITHOUT the list PostgreSQL
-- nulls EVERY referencing column, taking the meeting's organization_id with
-- it -- and live_meetings_select reads
--
--   ((organization_id IS NULL) OR (organization_id IN ( SELECT ... )))
--
-- so a row whose organization_id has been nulled is readable by every
-- authenticated user. Deleting one fund would silently publish that meeting.
-- Measured: after deleting the referenced fund, related_fund_id became NULL
-- and organization_id was unchanged.
--
-- ON UPDATE stays at NO ACTION: moving a fund between organisations while a
-- meeting references it should fail loudly rather than silently re-point or
-- detach the meeting.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'live_meetings_related_fund_org_fk'
      and conrelid = 'public.live_meetings'::regclass
  ) then
    alter table public.live_meetings
      add constraint live_meetings_related_fund_org_fk
      foreign key (related_fund_id, organization_id)
      references public.funds (id, organization_id)
      on delete set null (related_fund_id);
  end if;
end $$;

-- A composite foreign key is MATCH SIMPLE: if ANY of its columns is NULL the
-- constraint is not checked AT ALL. live_meetings.organization_id is nullable,
-- so without this check a row with organization_id = NULL could carry any
-- value whatever in related_fund_id and the key above would never look.
--
-- This is not a theoretical concern and was not taken on faith. With the key
-- in place and the check dropped, a null-organisation row carrying a random
-- UUID was ACCEPTED; with the check, it is refused. 0 of 61 production rows
-- have a NULL organization_id, so this forbids a shape that currently exists
-- only in the schema.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'live_meetings_related_fund_needs_org'
      and conrelid = 'public.live_meetings'::regclass
  ) then
    alter table public.live_meetings
      add constraint live_meetings_related_fund_needs_org
      check (related_fund_id is null or organization_id is not null);
  end if;
end $$;

-- Partial, and the reason that matters is the deletion rather than the lookup.
-- PostgreSQL requires an index on the REFERENCED side only, so without this
-- every `delete from funds` would sequentially scan live_meetings to find rows
-- to null. The column is NULL on all 61 production rows and will be NULL on
-- most future ones, because a meeting is tied to a fund by exception.
create index if not exists live_meetings_related_fund_idx
  on public.live_meetings (related_fund_id)
  where related_fund_id is not null;

-- ---------------------------------------------------------------------------
-- related_company_id: why it is not in this file
-- ---------------------------------------------------------------------------
--
-- It cannot have a foreign key, because there is nothing for it to reference.
--
-- There is no companies table in this database and there never has been. No
-- table in the public schema has "compan" in its name, and no migration in
-- this directory creates one. The column has been a bare `uuid` pointing at
-- nothing since 20260705143000, alongside related_contact_id and
-- related_fund_id, and it is the only one of the three whose referent does not
-- exist.
--
-- Nothing resolves it either. The column is accepted by
-- app/api/meetings/[id]/route.ts, written by lib/meetings/service.ts:450, and
-- declared in three component prop types -- and then never read against any
-- table by any code path. 0 of 61 production rows have one set.
--
-- The near misses were considered and rejected, because a wrong target is
-- worse than none: it would start refusing legitimate writes.
--
--   entities          legal entities for the Build module -- jurisdiction,
--                     formation_date, parent_entity_id. A holding structure,
--                     not the company a meeting is about. 0 rows.
--   sourcing_entities the sourcing radar's own records.
--   organizations     the tenant itself, which is what organization_id
--                     already references.
--
-- live_meetings also carries a (related_record_type, related_record_id) pair,
-- unused in production, which is the shape a polymorphic "related company"
-- would take if that is the intent.
--
-- So the honest options for related_company_id are to point it at a table once
-- one exists, or to drop the column. Both need a decision about what a company
-- IS in this product, which is not a decision a migration should make
-- silently. Guessing a target here would produce a constraint that looks like
-- protection and is really a landmine.
