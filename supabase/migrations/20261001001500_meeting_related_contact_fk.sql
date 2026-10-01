-- live_meetings.related_contact_id: a foreign key, a check, and an index.
-- Deliberately nothing else.
--
-- The column has existed since 20260705143000 as a bare `uuid` -- no foreign
-- key, no index, no check, and that migration is the only place in
-- supabase/migrations that mentions it. Nothing in the product writes it: only
-- app/api/meetings/[id]/route.ts accepts a `relatedContactId` in its body, and
-- no client posts that field. Nothing renders it either -- the three components
-- that name it only declare its type. In production, 0 of 59 live_meetings rows
-- have one set.
--
-- So this does not enable a feature, and is not a step towards one. It closes
-- the gap between what the column claims to be -- a reference to a contact --
-- and what the database would actually accept, which today is any UUID at all,
-- including one belonging to a different organisation.
--
-- What links a meeting to a contact in practice is NOT this column. It is the
-- address join in lib/meetings/crm-activity.ts and lib/meetings/report-inbox.ts,
-- via lib/crm/contact-match, which resolves on normalised email and correctly
-- merges one contact holding several addresses -- something a single scalar id
-- cannot express. Neither of those files reads related_contact_id. Nothing here
-- changes that, and nothing here should be read as a plan to replace it.

-- The composite reference below needs a unique key to point at. `id` is already
-- the primary key of network_contacts, so this adds no constraint the table did
-- not already have -- it only makes (id, organization_id) nameable as a
-- foreign-key target. Same reasoning, and same shape, as
-- inbox_threads_id_org_uniq in 20260930190000.
create unique index if not exists network_contacts_id_org_uniq
  on public.network_contacts (id, organization_id);

-- A meeting may only reference a contact in its OWN organisation.
--
-- A plain `references network_contacts (id)` would stop the column holding a
-- UUID that is not a contact at all, but would happily let a meeting in
-- organisation A reference a contact in organisation B. Whoever may edit the
-- meeting supplies the id, so that is a cross-tenant reference available on
-- request -- the same shape as the inbox_thread_drafts hole (CWE-639), and the
-- composite key is the same fix: unrepresentable rather than merely forbidden.
--
-- ON DELETE SET NULL names its column explicitly. PostgreSQL 15 added that
-- syntax and this needs it (production is 17.6): WITHOUT the column list,
-- deleting a contact nulls EVERY referencing column, taking the meeting's
-- organization_id with it. That is not merely untidy. The live_meetings_select
-- policy reads
--
--   ((organization_id IS NULL) OR (organization_id IN ( SELECT ... )))
--
-- so a row whose organization_id has been nulled is readable by every
-- authenticated user. Deleting one contact would silently publish that meeting.
-- The column list is load-bearing.
--
-- ON UPDATE stays at NO ACTION: moving a contact between organisations while a
-- meeting references it should fail loudly rather than silently re-point the
-- meeting or detach it.
-- Guarded, like the other fourteen migrations in this directory that add a
-- constraint, and for a reason this repository has demonstrated three times in
-- one day: migrations here get applied out of band by hand. A bare
-- `add constraint` fails with 42710 on a second run, so a hand-run that got
-- halfway cannot simply be repeated. `create index if not exists` below is
-- already idempotent; this makes the two constraints match it.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'live_meetings_related_contact_org_fk'
      and conrelid = 'public.live_meetings'::regclass
  ) then
    alter table public.live_meetings
      add constraint live_meetings_related_contact_org_fk
      foreign key (related_contact_id, organization_id)
      references public.network_contacts (id, organization_id)
      on delete set null (related_contact_id);
  end if;
end $$;

-- A composite foreign key is MATCH SIMPLE: if ANY of its columns is NULL, the
-- constraint is not checked AT ALL. live_meetings.organization_id is nullable,
-- so without this check a row with organization_id = NULL could carry any value
-- whatever in related_contact_id and the foreign key above would never look --
-- the constraint would be present and unenforced, which is worse than absent
-- because it reads as protection.
--
-- 0 of 59 production rows have a NULL organization_id, so this forbids a shape
-- that currently exists only in the schema. That is precisely when forbidding
-- it is cheap.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'live_meetings_related_contact_needs_org'
      and conrelid = 'public.live_meetings'::regclass
  ) then
    alter table public.live_meetings
      add constraint live_meetings_related_contact_needs_org
      check (related_contact_id is null or organization_id is not null);
  end if;
end $$;

-- Partial, for two reasons rather than one.
--
-- The lookup reason: the column is NULL on every production row and will be
-- NULL on the large majority of any plausible future ones, because a meeting is
-- tied to a contact by exception. Indexing only the rows a search by contact
-- could ever return keeps the index proportional to the rows that have one.
--
-- The deletion reason, which is the one that actually matters: the foreign key
-- above has no index on the REFERENCING side without this. PostgreSQL requires
-- an index on the referenced side only, so every `delete from network_contacts`
-- would sequentially scan live_meetings to find rows to null. This index is
-- what keeps that cheap.
create index if not exists live_meetings_related_contact_idx
  on public.live_meetings (related_contact_id)
  where related_contact_id is not null;
