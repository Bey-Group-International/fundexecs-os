-- Replies to a meeting's conversations, counted on the meeting itself.
--
-- A meeting's follow-up and the conversations started from its report are
-- inbox threads linked by inbox_threads.meeting_id (20261003040855). Whether
-- anybody answered was only visible by opening each thread. These columns put
-- the answer where people look — the meetings list and the report — and keep
-- it current with triggers, so no list ever pays for a count query.
--
-- 1. inbox_threads.last_inbound_at — the newest message from the other side,
--    kept by a trigger on inbox_messages.
-- 2. inbox_threads.meeting_linked_at — when the thread was tied to its
--    meeting. A reply is an inbound message AFTER that, so a conversation that
--    existed before the meeting does not count as an answer to it.
-- 3. live_meetings.followup_threads / followup_replies / followup_unread —
--    recomputed for the affected meeting whenever a linked thread changes.
-- 4. meeting_conversation_drafts — the "Draft with Earn" result per meeting
--    and attendee, reused until the report is regenerated, so reopening the
--    composer never pays for a second model call.

-- ── 1, 2 ─────────────────────────────────────────────────────────────────────
alter table public.inbox_threads
  add column if not exists last_inbound_at timestamptz,
  add column if not exists meeting_linked_at timestamptz;

comment on column public.inbox_threads.last_inbound_at is
  'Newest inbound message on the thread. Maintained by inbox_messages_track_inbound.';
comment on column public.inbox_threads.meeting_linked_at is
  'When meeting_id was set. Inbound mail after this counts as a reply to the meeting.';

create index if not exists inbox_threads_meeting_only_idx
  on public.inbox_threads (meeting_id)
  where meeting_id is not null;

-- ── 3 ─────────────────────────────────────────────────────────────────────────
alter table public.live_meetings
  add column if not exists followup_threads integer not null default 0,
  add column if not exists followup_replies integer not null default 0,
  add column if not exists followup_unread integer not null default 0;

comment on column public.live_meetings.followup_replies is
  'Linked inbox threads with a reply since they were linked. Maintained by triggers on inbox_threads.';

create or replace function public.live_meeting_recount_replies(target uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.live_meetings m
     set followup_threads = s.threads,
         followup_replies = s.replies,
         followup_unread  = s.unread
    from (
      select count(*)::int as threads,
             count(*) filter (
               where t.last_inbound_at is not null
                 and t.last_inbound_at > coalesce(t.meeting_linked_at, t.created_at)
             )::int as replies,
             count(*) filter (
               where t.unread
                 and t.last_inbound_at is not null
                 and t.last_inbound_at > coalesce(t.meeting_linked_at, t.created_at)
             )::int as unread
        from public.inbox_threads t
       where t.meeting_id = target
    ) s
   where m.id = target
     and (m.followup_threads, m.followup_replies, m.followup_unread)
         is distinct from (s.threads, s.replies, s.unread);
$$;

-- Stamp the link time when a thread gets (or changes) its meeting.
create or replace function public.inbox_threads_stamp_meeting_link()
returns trigger
language plpgsql
as $$
begin
  if new.meeting_id is not null
     and (tg_op = 'INSERT' or new.meeting_id is distinct from old.meeting_id) then
    new.meeting_linked_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists inbox_threads_stamp_meeting_link on public.inbox_threads;
create trigger inbox_threads_stamp_meeting_link
  before insert or update of meeting_id on public.inbox_threads
  for each row execute function public.inbox_threads_stamp_meeting_link();

create or replace function public.inbox_threads_recount_meeting()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.meeting_id is not null then
    perform public.live_meeting_recount_replies(new.meeting_id);
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.meeting_id is not null
     and (tg_op = 'DELETE' or old.meeting_id is distinct from new.meeting_id) then
    perform public.live_meeting_recount_replies(old.meeting_id);
  end if;
  return null;
end;
$$;

drop trigger if exists inbox_threads_recount_meeting on public.inbox_threads;
create trigger inbox_threads_recount_meeting
  after insert or delete or update of meeting_id, last_inbound_at, unread on public.inbox_threads
  for each row execute function public.inbox_threads_recount_meeting();

-- The newest inbound message, onto its thread (which recounts its meeting).
create or replace function public.inbox_messages_track_inbound()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.direction = 'inbound' then
    update public.inbox_threads
       set last_inbound_at = new.occurred_at
     where id = new.thread_id
       and (last_inbound_at is null or last_inbound_at < new.occurred_at);
  end if;
  return null;
end;
$$;

drop trigger if exists inbox_messages_track_inbound on public.inbox_messages;
create trigger inbox_messages_track_inbound
  after insert on public.inbox_messages
  for each row execute function public.inbox_messages_track_inbound();

-- Backfill: inbound times for threads already linked to a meeting, then their
-- meetings' counts. Bounded to linked threads, which are new as of yesterday.
update public.inbox_threads t
   set last_inbound_at = s.at
  from (
    select m.thread_id, max(m.occurred_at) as at
      from public.inbox_messages m
      join public.inbox_threads tt on tt.id = m.thread_id and tt.meeting_id is not null
     where m.direction = 'inbound'
     group by m.thread_id
  ) s
 where t.id = s.thread_id;

update public.inbox_threads
   set meeting_linked_at = created_at
 where meeting_id is not null and meeting_linked_at is null;

select public.live_meeting_recount_replies(id)
  from (select distinct meeting_id as id from public.inbox_threads where meeting_id is not null) x;

-- ── 4 ─────────────────────────────────────────────────────────────────────────
create table if not exists public.meeting_conversation_drafts (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  meeting_id        uuid not null references public.live_meetings (id) on delete cascade,
  email_lower       text not null,
  subject           text not null,
  body              text not null,
  -- The report the draft was written from; a newer report invalidates it.
  report_created_at timestamptz,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  unique (meeting_id, email_lower)
);

comment on table public.meeting_conversation_drafts is
  'Cached "Draft with Earn" output per meeting and attendee, reused until the report changes.';

alter table public.meeting_conversation_drafts enable row level security;

drop policy if exists meeting_conversation_drafts_select on public.meeting_conversation_drafts;
create policy meeting_conversation_drafts_select on public.meeting_conversation_drafts
  for select to authenticated
  using (organization_id in (select public.current_principal_org_ids()));

drop policy if exists meeting_conversation_drafts_write on public.meeting_conversation_drafts;
create policy meeting_conversation_drafts_write on public.meeting_conversation_drafts
  for all to authenticated
  using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
