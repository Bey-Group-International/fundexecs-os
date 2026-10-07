-- A meeting's follow-up counts as sent when it was DELIVERED, not when it was
-- approved.
--
-- 20261003163012 moved followup_status to "done" as soon as an approval on one
-- of the meeting's threads was approved. Approving an inbox reply did not send
-- it then (the generic workflow engine ran, found no steps, and marked it
-- complete), so meetings read "Follow-up sent" while nobody had received
-- anything. Approval now sends the reply and records the outcome on the task
-- (result.inboxReply.delivered); this counts only those, and re-syncs the
-- meeting when the task finishes, which is after the approval row changed.

create or replace function public.live_meeting_sync_followup(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cur       text;
  replies   int;
  pending   int;
  delivered int;
  nxt       text;
begin
  select m.followup_status, m.followup_replies into cur, replies
    from public.live_meetings m
   where m.id = target;
  if not found then
    return;
  end if;

  select count(*) filter (where a.decision = 'pending'),
         count(*) filter (
           where a.decision in ('approved', 'accepted')
             and k.status = 'completed'
             and coalesce((k.result -> 'inboxReply' ->> 'delivered')::boolean, false)
         )
    into pending, delivered
    from public.inbox_threads t
    join public.task_events e
      on e.event_type = 'task.created'
     and e.payload ? 'inbox_thread_id'
     and e.payload ->> 'inbox_thread_id' = t.id::text
    join public.approvals a on a.task_id = e.task_id
    join public.tasks k on k.id = e.task_id
   where t.meeting_id = target;

  nxt := case
    when replies > 0 then 'replied'
    when pending > 0 then 'pending_approval'
    when delivered > 0 and cur <> 'replied' then 'done'
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

-- The meetings a task's inbox thread belongs to, re-synced.
create or replace function public.sync_meeting_followup_for_task(target_task uuid)
returns void
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
     where e.task_id = target_task
       and e.event_type = 'task.created'
       and e.payload ? 'inbox_thread_id'
       and t.meeting_id is not null
  loop
    perform public.live_meeting_sync_followup(mid);
  end loop;
end;
$$;

create or replace function public.approvals_sync_meeting_followup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_meeting_followup_for_task(new.task_id);
  return null;
end;
$$;

-- Delivery is recorded on the task after the approval row changed.
create or replace function public.tasks_sync_meeting_followup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('completed', 'failed', 'cancelled')
     and new.status is distinct from old.status
     and new.result ? 'inboxReply' then
    perform public.sync_meeting_followup_for_task(new.id);
  end if;
  return null;
end;
$$;

drop trigger if exists tasks_sync_meeting_followup on public.tasks;
create trigger tasks_sync_meeting_followup
  after update of status on public.tasks
  for each row execute function public.tasks_sync_meeting_followup();

-- Meetings marked "done" by an approval that never sent anything. Their tasks
-- carry no inboxReply (they predate it), so nothing was delivered: step them
-- back to "draft" so the follow-up shows as still owed. Only meetings with no
-- delivered message of any kind — an immediate send records an outbound message
-- on a linked thread, and those stay "done".
do $$
declare
  mid uuid;
begin
  perform set_config('app.followup_sync', 'on', true);
  for mid in
    select m.id
      from public.live_meetings m
     where m.followup_status = 'done'
       and exists (
         select 1
           from public.inbox_threads t
           join public.task_events e
             on e.event_type = 'task.created'
            and e.payload ->> 'inbox_thread_id' = t.id::text
           join public.approvals a on a.task_id = e.task_id and a.decision in ('approved', 'accepted')
          where t.meeting_id = m.id
       )
       and not exists (
         select 1
           from public.inbox_threads t
           join public.inbox_messages o on o.thread_id = t.id and o.direction = 'outbound'
          where t.meeting_id = m.id
            and coalesce(o.metadata ->> 'action', '') <> 'send_reply'
       )
  loop
    update public.live_meetings
       set followup_status = 'draft', followup_sent_at = null
     where id = mid;
  end loop;
  perform set_config('app.followup_sync', 'off', true);
end;
$$;
