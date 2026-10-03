-- A meeting's follow-up status, moved by what actually happens to it.
--
-- followup_status was written in two places — "draft" when a report had a
-- follow-up, "done" when an immediate send reached everyone — and nothing else.
-- A follow-up held for approval never became "done" once approved, a reply never
-- showed in the status, and regenerating a report put a sent follow-up back to
-- "draft". This makes the lifecycle
--
--   not_started → draft → pending_approval → done → replied
--
-- and keeps it current from the database, where the signals already land:
--
-- 1. live_meeting_sync_followup(meeting) derives the status from the meeting's
--    linked inbox threads: any reply → replied; else an approval still pending
--    on one of its threads → pending_approval; else an approved one → done; and a
--    meeting left at pending_approval with nothing pending (all rejected) goes
--    back to draft. Called after every reply recount, and by a trigger on
--    approvals, so approving or rejecting in the inbox moves the meeting.
-- 2. A guard on live_meetings stops ordinary writes moving it backwards: once
--    sent (done / replied) or held for approval, a report regeneration's "draft"
--    no longer reverts it. Only the sync function may step pending_approval back.
-- 3. live_meetings.followup_sent_at — stamped when it first becomes done or
--    replied — so "sent three days ago, nobody has answered" is one indexed read.
-- 4. Replies matched by sender: an inbound email from someone this org followed
--    up with in the last 14 days, on a thread of its own (a new subject), is
--    linked to that meeting and counted as the reply it is.

-- ── 3 ─────────────────────────────────────────────────────────────────────────
alter table public.live_meetings
  add column if not exists followup_sent_at timestamptz;

comment on column public.live_meetings.followup_sent_at is
  'When the follow-up first went out (status became done or replied). Set by live_meetings_guard_followup.';

create index if not exists live_meetings_awaiting_reply_idx
  on public.live_meetings (organization_id, followup_sent_at)
  where followup_status = 'done' and followup_replies = 0;

-- Reverse lookup from an inbox thread to the tasks (and so approvals) opened on
-- it. performThreadAction records the thread on the task's task.created event.
create index if not exists task_events_inbox_thread_idx
  on public.task_events ((payload ->> 'inbox_thread_id'))
  where event_type = 'task.created' and payload ? 'inbox_thread_id';

-- ── 2 ─────────────────────────────────────────────────────────────────────────
create or replace function public.live_meetings_guard_followup()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.followup_sync', true), '') <> 'on' then
    -- Sent, or waiting on an approver: a report's draft/not_started does not undo it.
    if old.followup_status in ('done', 'replied', 'pending_approval')
       and new.followup_status in ('not_started', 'draft') then
      new.followup_status := old.followup_status;
    end if;
    -- A reply is never un-heard.
    if old.followup_status = 'replied' and new.followup_status = 'done' then
      new.followup_status := 'replied';
    end if;
  end if;
  if new.followup_status in ('done', 'replied') and new.followup_sent_at is null then
    new.followup_sent_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists live_meetings_guard_followup on public.live_meetings;
create trigger live_meetings_guard_followup
  before update of followup_status on public.live_meetings
  for each row execute function public.live_meetings_guard_followup();

-- ── 1 ─────────────────────────────────────────────────────────────────────────
create or replace function public.live_meeting_sync_followup(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cur      text;
  replies  int;
  pending  int;
  approved int;
  nxt      text;
begin
  select m.followup_status, m.followup_replies into cur, replies
    from public.live_meetings m
   where m.id = target;
  if not found then
    return;
  end if;

  select count(*) filter (where a.decision = 'pending'),
         count(*) filter (where a.decision in ('approved', 'accepted'))
    into pending, approved
    from public.inbox_threads t
    join public.task_events e
      on e.event_type = 'task.created'
     and e.payload ? 'inbox_thread_id'
     and e.payload ->> 'inbox_thread_id' = t.id::text
    join public.approvals a on a.task_id = e.task_id
   where t.meeting_id = target;

  nxt := case
    when replies > 0 then 'replied'
    when pending > 0 then 'pending_approval'
    when approved > 0 and cur <> 'replied' then 'done'
    when cur = 'pending_approval' then 'draft'
    else cur
  end;

  if nxt is distinct from cur then
    perform set_config('app.followup_sync', 'on', true);
    update public.live_meetings set followup_status = nxt where id = target;
    perform set_config('app.followup_sync', 'off', true);
  end if;
end;
$$;

-- The reply recount (20261003151646) now finishes by moving the status.
create or replace function public.live_meeting_recount_replies(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
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
  perform public.live_meeting_sync_followup(target);
end;
$$;

-- Approving, rejecting or opening an approval on a meeting's thread moves it.
create or replace function public.approvals_sync_meeting_followup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  mid uuid;
begin
  for mid in
    select distinct t.meeting_id
      from public.task_events e
      join public.inbox_threads t on t.id::text = e.payload ->> 'inbox_thread_id'
     where e.task_id = new.task_id
       and e.event_type = 'task.created'
       and e.payload ? 'inbox_thread_id'
       and t.meeting_id is not null
  loop
    perform public.live_meeting_sync_followup(mid);
  end loop;
  return null;
end;
$$;

drop trigger if exists approvals_sync_meeting_followup on public.approvals;
create trigger approvals_sync_meeting_followup
  after insert or update of decision on public.approvals
  for each row execute function public.approvals_sync_meeting_followup();

-- ── 4 ─────────────────────────────────────────────────────────────────────────
-- A link made with an explicit time keeps it: an auto-linked reply carries the
-- original follow-up's link time, so mail synced late still counts as an answer.
create or replace function public.inbox_threads_stamp_meeting_link()
returns trigger
language plpgsql
as $$
begin
  if new.meeting_id is not null
     and (tg_op = 'INSERT' or new.meeting_id is distinct from old.meeting_id) then
    if tg_op = 'INSERT' then
      new.meeting_linked_at := coalesce(new.meeting_linked_at, now());
    elsif new.meeting_linked_at is not distinct from old.meeting_linked_at then
      new.meeting_linked_at := now();
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.inbox_messages_track_inbound()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  th     record;
  anchor record;
begin
  if new.direction <> 'inbound' then
    return null;
  end if;

  select t.id, t.organization_id, t.meeting_id, t.counterparty_email_lower
    into th
    from public.inbox_threads t
   where t.id = new.thread_id;
  if not found then
    return null;
  end if;

  -- An unlinked thread from someone a meeting recently wrote to: their answer,
  -- under a subject of their own. Linked to the newest such meeting thread that
  -- actually sent something, within 14 days before this message.
  if th.meeting_id is null and th.counterparty_email_lower is not null then
    select a.meeting_id, a.meeting_linked_at
      into anchor
      from public.inbox_threads a
     where a.organization_id = th.organization_id
       and a.counterparty_email_lower = th.counterparty_email_lower
       and a.meeting_id is not null
       and a.id <> th.id
       and a.meeting_linked_at <= new.occurred_at
       and a.meeting_linked_at >= new.occurred_at - interval '14 days'
       and exists (
         select 1 from public.inbox_messages o
          where o.thread_id = a.id and o.direction = 'outbound'
       )
     order by a.meeting_linked_at desc
     limit 1;
    if found then
      update public.inbox_threads
         set meeting_id        = anchor.meeting_id,
             meeting_linked_at = anchor.meeting_linked_at,
             last_inbound_at   = greatest(coalesce(last_inbound_at, new.occurred_at), new.occurred_at)
       where id = th.id;
      return null;
    end if;
  end if;

  update public.inbox_threads
     set last_inbound_at = new.occurred_at
   where id = new.thread_id
     and (last_inbound_at is null or last_inbound_at < new.occurred_at);
  return null;
end;
$$;

-- ── Backfill ─────────────────────────────────────────────────────────────────
update public.live_meetings lm
   set followup_sent_at = coalesce(
         (select min(m.occurred_at)
            from public.inbox_threads t
            join public.inbox_messages m on m.thread_id = t.id and m.direction = 'outbound'
           where t.meeting_id = lm.id),
         lm.updated_at)
 where lm.followup_status = 'done'
   and lm.followup_sent_at is null;

select public.live_meeting_sync_followup(id)
  from (select distinct meeting_id as id from public.inbox_threads where meeting_id is not null) x;
