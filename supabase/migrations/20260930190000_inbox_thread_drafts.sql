-- A draft that cannot send itself.
--
-- The meeting report writes a ready-to-send follow-up. The only thing the
-- product could do with it was send it straight out of the report, over the
-- host's mailbox, to everyone in the room at once — or put it on the clipboard.
-- Neither of those is how the rest of this product treats an outward move: every
-- one of those goes through the gate layer (lib/gates), becomes a task, and waits
-- for a person unless a mandate has pre-authorized it.
--
-- So the follow-up lands HERE instead: as a draft on the inbox thread with that
-- person, which somebody opens, edits and sends through the composer that already
-- exists — and therefore through the gate that already governs it. Nothing on this
-- table reaches anybody. That is the point of it being a table rather than a
-- direct send with a confirmation dialog: a dialog can be auto-confirmed, and a
-- row that has no send path cannot.
--
-- ONE DRAFT PER THREAD, enforced by the primary key rather than by a constraint
-- bolted on beside it. Two drafts on one thread is a question the composer cannot
-- answer — which of them is the draft? — so re-drafting the same thread from a
-- later meeting replaces the one that is there. A thread belongs to exactly one
-- organisation, so thread_id alone is the key; organization_id is carried for RLS
-- and for the org-scoped reads, not for uniqueness.
--
-- No tombstone column. A discarded or sent draft is deleted, because nothing
-- reads the history of drafts — what was actually sent is recorded as an
-- inbox_message and on the contact's timeline, which are the records people
-- consult. A `discarded_at` here would also force the uniqueness above into a
-- partial index, which PostgREST cannot express as an upsert target.

create table if not exists public.inbox_thread_drafts (
  -- The thread this is a draft on, and the key. Cascades: a deleted thread has
  -- no draft.
  thread_id         uuid primary key
                      references public.inbox_threads (id) on delete cascade,
  organization_id   uuid not null
                      references public.organizations (id) on delete cascade,
  body              text not null,
  -- Where the text came from, so the composer can say so. Constrained rather
  -- than free text: a label nobody can render is worse than no label.
  source            text not null default 'meeting_follow_up'
                      check (source in ('meeting_follow_up')),
  -- The meeting whose report wrote it. Set null rather than cascading: losing
  -- the meeting must not silently delete a draft somebody was about to send.
  source_meeting_id uuid references public.live_meetings (id) on delete set null,
  created_by        uuid references public.principals (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.inbox_thread_drafts is
  'Unsent reply text held against an inbox thread, written by the meeting report follow-up and sent only by a person through the inbox composer (and therefore through the gate layer). Nothing on this table has a send path. One row per thread.';

-- Every read is "what drafts exist for this organisation" (the inbox board) or
-- "is there a draft on this thread" (the composer, which has the primary key).
-- This index serves the first.
create index if not exists inbox_thread_drafts_org_idx
  on public.inbox_thread_drafts (organization_id);

-- Dropped first, because CREATE TRIGGER has no IF NOT EXISTS and this workflow
-- reruns migrations: `db push --include-all` is idempotent only to the extent the
-- migrations themselves are.
drop trigger if exists inbox_thread_drafts_set_updated_at on public.inbox_thread_drafts;
create trigger inbox_thread_drafts_set_updated_at
  before update on public.inbox_thread_drafts
  for each row execute function public.set_updated_at();

-- Same member-read / writer-write tenancy as inbox_threads itself. A draft is
-- org-visible on purpose: it is a draft of an organisation's reply, and the
-- person who sends it is often not the person the report wrote it for.
alter table public.inbox_thread_drafts enable row level security;

drop policy if exists inbox_thread_drafts_select on public.inbox_thread_drafts;
create policy inbox_thread_drafts_select on public.inbox_thread_drafts
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists inbox_thread_drafts_write on public.inbox_thread_drafts;
create policy inbox_thread_drafts_write on public.inbox_thread_drafts
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
