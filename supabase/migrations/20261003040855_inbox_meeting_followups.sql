-- Tie the inbox to the meetings it comes out of.
--
-- 1. inbox_threads.meeting_id — the meeting a thread belongs to. A meeting's
--    follow-up email is now recorded as a thread per attendee, and the replies
--    land on that same thread, so the conversation a meeting started is one
--    place in the inbox and one list on the meeting's report.
--
-- 2. tracked_mail_threads — Gmail threads the app started from a MEMBER's own
--    mailbox (a host's follow-up). The org mailbox sweep cannot see a member's
--    personal Gmail, so replies there were invisible. The tracked-thread sweep
--    reads ONLY these threads — nothing else in the member's mail — and expires
--    each after 30 days. Service-role writes only.
--
-- 3. inbox_threads.ai_summary_at — when the summary was last written, so the
--    hourly batch summarises only threads that changed since.
--
-- 4. tasks.meeting_id — the meeting a workflow was started from. Follow-up packs
--    were tied to their meeting by fuzzy title match; a task that carries the id
--    is matched exactly.
--
-- 5. Backfill on contact create / email change — link the inbox threads and
--    reported meetings that already exist for the address, instead of waiting
--    for the next message.

-- ── 1 ─────────────────────────────────────────────────────────────────────────
alter table public.inbox_threads
  add column if not exists meeting_id uuid references public.live_meetings (id) on delete set null;

comment on column public.inbox_threads.meeting_id is
  'The meeting this conversation came out of (its follow-up thread). Set by the follow-up send and carried onto replies.';

create index if not exists inbox_threads_meeting_idx
  on public.inbox_threads (organization_id, meeting_id)
  where meeting_id is not null;

-- ── 3 ─────────────────────────────────────────────────────────────────────────
alter table public.inbox_threads
  add column if not exists ai_summary_at timestamptz;

comment on column public.inbox_threads.ai_summary_at is
  'When ai_summary was last written. The summary batch picks threads whose last_message_at is newer.';

-- The batch reads "threads with a newer message than their summary", newest
-- first. Partial on the threads that can be stale at all.
create index if not exists inbox_threads_summary_due_idx
  on public.inbox_threads (last_message_at desc)
  where last_message_at is not null;

-- ── 2 ─────────────────────────────────────────────────────────────────────────
create table if not exists public.tracked_mail_threads (
  id               uuid primary key default extensions.gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null,
  gmail_thread_id  text not null,
  inbox_thread_id  uuid references public.inbox_threads (id) on delete cascade,
  meeting_id       uuid references public.live_meetings (id) on delete set null,
  mailbox_email    text,
  last_checked_at  timestamptz,
  last_error       text,
  expires_at       timestamptz not null default (now() + interval '30 days'),
  created_at       timestamptz not null default now(),
  unique (user_id, gmail_thread_id)
);

comment on table public.tracked_mail_threads is
  'Gmail threads the app started from a member''s own mailbox. Only these are read back for replies (lib/integrations/gmail-sync/tracked.server.ts).';

create index if not exists tracked_mail_threads_due_idx
  on public.tracked_mail_threads (last_checked_at asc nulls first)
  where expires_at is not null;

alter table public.tracked_mail_threads enable row level security;

drop policy if exists tracked_mail_threads_select on public.tracked_mail_threads;
create policy tracked_mail_threads_select on public.tracked_mail_threads
  for select to authenticated
  using (organization_id in (select public.current_principal_org_ids()));

-- ── 4 ─────────────────────────────────────────────────────────────────────────
alter table public.tasks
  add column if not exists meeting_id uuid references public.live_meetings (id) on delete set null;

comment on column public.tasks.meeting_id is
  'The meeting this workflow was started from, when it was started from a meeting page. Follow-up packs are held back by this id rather than by title.';

create index if not exists tasks_meeting_idx
  on public.tasks (meeting_id)
  where meeting_id is not null;

-- ── 5 ─────────────────────────────────────────────────────────────────────────
-- Same rules as the app writers: EXACT lowercased address, is_system rows, one
-- per thread / meeting, conflict-free on the existing unique indexes so a row
-- the writers already made (or a corrected one) is left exactly as it is.
-- Bounded per contact so a bulk import of a long-standing counterparty costs a
-- fixed amount.
create or replace function public.network_contact_backfill_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  addr text := lower(btrim(coalesce(new.email, '')));
begin
  if addr = '' or position('@' in addr) = 0 then
    return new;
  end if;
  if new.archived_at is not null or new.merged_into_id is not null then
    return new;
  end if;

  insert into public.network_activities
    (organization_id, contact_id, actor_id, activity_type, direction, subject, body,
     occurred_at, is_system, metadata)
  select t.organization_id, new.id, null,
         case when t.channel = 'gmail' then 'email' else 'other' end,
         'inbound',
         coalesce(nullif(btrim(t.subject), ''), 'Conversation'),
         left(coalesce(nullif(btrim(t.ai_summary), ''), nullif(btrim(t.preview), ''),
                       'No preview was available for this conversation.'), 1000),
         coalesce(t.last_message_at, t.created_at),
         true,
         jsonb_build_object('thread_id', t.id::text, 'channel', t.channel,
                            'source', 'inbox_thread', 'identity', 'asserted',
                            'backfilled', true)
    from public.inbox_threads t
   where t.organization_id = new.organization_id
     and t.counterparty_email_lower = addr
   order by t.last_message_at desc nulls last
   limit 200
  on conflict (organization_id, contact_id, thread_id) do nothing;

  insert into public.network_activities
    (organization_id, contact_id, actor_id, activity_type, direction, subject, body,
     occurred_at, is_system, metadata)
  select m.organization_id, new.id, null, 'meeting', 'outbound',
         coalesce(nullif(btrim(m.title), ''), 'Meeting'),
         left(coalesce(nullif(btrim(r.summary), ''), 'No summary was generated for this meeting.'), 2000),
         coalesce(m.started_at, m.scheduled_at, m.created_at),
         true,
         jsonb_build_object('meeting_id', m.id::text, 'room_code', m.room_code,
                            'source', 'live_meeting', 'has_report', r.summary is not null,
                            'backfilled', true)
    from public.live_meetings m
    left join lateral (
      select rep.summary from public.live_meeting_reports rep
       where rep.meeting_id = m.id
       order by rep.created_at desc
       limit 1
    ) r on true
   where m.organization_id = new.organization_id
     and m.deleted_at is null
     and jsonb_typeof(m.attendees) = 'array'
     and exists (
       select 1 from jsonb_array_elements(m.attendees) a
        where lower(btrim(case jsonb_typeof(a)
                            when 'string' then a #>> '{}'
                            when 'object' then a ->> 'email'
                          end)) = addr
     )
   order by m.created_at desc
   limit 100
  on conflict (organization_id, contact_id, meeting_id) do nothing;

  return new;
end;
$$;

comment on function public.network_contact_backfill_links() is
  'Links a contact to the inbox threads and meetings already on file for their address, on create and on email change.';

drop trigger if exists network_contacts_backfill_links on public.network_contacts;
create trigger network_contacts_backfill_links
  after insert or update of email on public.network_contacts
  for each row execute function public.network_contact_backfill_links();
