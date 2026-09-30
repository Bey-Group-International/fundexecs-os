-- A finished meeting writes itself onto the CRM record of whoever was in it,
-- and must write itself exactly once.
--
-- network_activities has no unique constraint of any kind, and the path that
-- writes these rows can run more than once for the same meeting: the report
-- route reaches its success path on a retry from the room, and
-- /api/meetings/[id]/report/regenerate exists specifically to run the analysis
-- again. Without a key to upsert on, regenerating a report would add a second
-- copy of the same meeting to every attendee's timeline, then a third. A CRM
-- that double-counts meetings is worse than one that never had the feature:
-- relationship scoring reads this table, so duplicates do not merely look
-- untidy, they move numbers people decide on.
--
-- WHY A GENERATED COLUMN RATHER THAN AN EXPRESSION INDEX.
--
-- The obvious shape is a partial unique index on
-- (organization_id, contact_id, (metadata->>'meeting_id')) WHERE is_system and
-- activity_type = 'meeting'. It is also unusable from here. The writer reaches
-- Postgres through PostgREST, whose on_conflict parameter takes a
-- comma-separated list of COLUMN NAMES: it cannot carry an expression, and it
-- cannot carry the WHERE predicate that Postgres needs in order to infer a
-- partial index. Every upsert would have failed with "there is no unique or
-- exclusion constraint matching the ON CONFLICT specification" — silently, since
-- the writer logs and carries on, so no meeting would ever have reached a
-- timeline at all.
--
-- So the key is made of real columns. `meeting_id` is generated from the
-- metadata the writer already sets, which keeps one source of truth, and the
-- index over it is plain rather than partial.
--
-- Hand-logged rows are not constrained, and need no predicate to exempt them:
-- the activities POST never writes metadata, so their meeting_id is NULL, and
-- Postgres treats NULLs as distinct in a unique index. Somebody can still log
-- the same contact by hand as many times as they like.

alter table public.network_activities
  add column if not exists meeting_id text
    generated always as (metadata ->> 'meeting_id') stored;

comment on column public.network_activities.meeting_id is
  'The live_meetings id this entry describes, derived from metadata so the upsert has real columns to conflict on. Null for anything logged by hand. Deliberately not a foreign key: the entry is a record of what happened and must outlive the meeting row.';

create unique index if not exists network_activities_meeting_contact_uniq
  on public.network_activities (organization_id, contact_id, meeting_id);

comment on index public.network_activities_meeting_contact_uniq is
  'One machine-written meeting entry per contact per meeting, so a report regenerate corrects the timeline entry instead of duplicating it. Rows with no meeting_id (everything logged by hand) are unconstrained, because NULLs are distinct.';

-- And the other half of the same problem: matching a contact by address.
--
-- network_contacts.email is stored as it was given — there is an index on
-- (organization_id, lower(email)) precisely because the column holds mixed case.
-- A lookup comparing the raw column against a lowercased address therefore
-- misses any contact whose address was stored capitalised, and misses the index
-- too. PostgREST cannot filter on lower(email), so the lowercase becomes a
-- column, and the lookup becomes both correct and indexed.

alter table public.network_contacts
  add column if not exists email_lower text
    generated always as (lower(email)) stored;

comment on column public.network_contacts.email_lower is
  'lower(email), as a column so a case-insensitive lookup can be expressed through PostgREST and use an index. Never written directly.';

create index if not exists network_contacts_email_lower_col_idx
  on public.network_contacts (organization_id, email_lower);
