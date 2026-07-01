-- 20260701310000_document_status.sql
-- Adds a publish-flow status to documents: draft → review → ready.
-- Only "ready" documents are shown in the public investor data room.
-- Existing documents default to 'ready' so current shared rooms are unaffected.

alter table public.documents
  add column if not exists status text not null default 'ready'
  check (status in ('draft', 'review', 'ready'));

comment on column public.documents.status is
  'Publish flow: draft (work-in-progress) | review (internal sign-off) | ready (visible in shared data room)';
