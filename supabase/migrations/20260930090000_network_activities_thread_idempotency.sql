-- An inbox conversation writes itself onto the CRM record of the person on the
-- other end, and must write itself exactly once per thread.
--
-- Same problem and same shape as the meeting entries
-- (20260930083000_network_activities_meeting_idempotency.sql), for the same
-- reason: a thread is ingested again on every reply, so without a key the
-- fortieth message in a conversation would be the fortieth copy of it on
-- somebody's timeline. Relationship scoring reads this table, so duplicates do
-- not merely look untidy — they move numbers people decide on.
--
-- And the same mechanics, because the constraint is the same: the writer reaches
-- Postgres through PostgREST, whose on_conflict carries a list of COLUMN NAMES
-- and cannot carry an expression or a partial index's WHERE clause. So the key
-- is made of real columns, with thread_id generated from the metadata the writer
-- already sets.
--
-- Hand-logged rows have a NULL thread_id and NULLs are distinct in a unique
-- index, so nothing a person types is constrained by this.
--
-- DEPLOYMENT NOTE. Adding a STORED generated column rewrites the table and holds
-- an ACCESS EXCLUSIVE lock for the duration; the index build then blocks writes
-- while it runs. CREATE INDEX CONCURRENTLY is not an escape, because migrations
-- run inside a transaction. So check network_activities' row count and apply this
-- in a low-traffic window if it is large. The same caveat applies to
-- 20260930083000, which added meeting_id to this table; the two are independent
-- rewrites of the same table and are cheaper applied back to back than apart.

alter table public.network_activities
  add column if not exists thread_id text
    generated always as (metadata ->> 'thread_id') stored;

comment on column public.network_activities.thread_id is
  'The inbox_threads id this entry describes, derived from metadata so the upsert has real columns to conflict on. Null for anything logged by hand and for meeting entries. Deliberately not a foreign key: the entry is a record of what happened and must outlive the thread row.';

create unique index if not exists network_activities_thread_contact_uniq
  on public.network_activities (organization_id, contact_id, thread_id);

comment on index public.network_activities_thread_contact_uniq is
  'One machine-written entry per contact per inbox thread, so every reply updates that conversation on the timeline instead of adding another copy of it.';
