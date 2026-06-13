-- =====================================================================
-- Unified (Relationship) Inbox — P1 read surface.
--
-- Additive + idempotent. Backend/data only. Introduces `inbox_items`: one
-- channel-agnostic row per surfaced message/conversation, modelled on the
-- `matches` triage shape (pending / accepted / dismissed, score, jsonb
-- rationale, acted_at) so the existing Match Inbox UI + calibration apply
-- directly.
--
-- The table is empty until ingestion runs (P2: Gmail/Slack normalizers).
-- The /inbox surface renders a tasteful empty state in that case. Nothing
-- here touches the notifications table or any existing surface.
-- =====================================================================

create table if not exists public.inbox_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- Communications channel. email/slack/call are P1-P3 targets; the rest are
  -- catalogued so the UI chips and ingestion can land incrementally.
  channel text not null,
  direction text not null default 'inbound',
  -- Provider-native id used to dedupe ingestion. May be null for synthetic
  -- rows; when present it is unique per (org, channel) — see index below.
  external_id text,
  -- Groups items into a single conversation thread.
  thread_id text,
  -- Soft links onto the deal loop. Set null (not cascade) so deleting a deal
  -- or contact never destroys the conversation record / audit trail.
  contact_id uuid references public.contacts (id) on delete set null,
  deal_id uuid references public.deals (id) on delete set null,
  subject text,
  preview text,
  body text,
  -- Earn's proposed reply (populated in P3). Approving sends it in-channel.
  draft_reply text,
  -- 0-100 priority from the scorer (populated in P2). 0 until then.
  score integer not null default 0,
  status text not null default 'pending',
  -- [{ factor, weight, detail }] — same shape the Match Inbox calibration reads.
  rationale jsonb not null default '[]'::jsonb,
  occurred_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  acted_at timestamp with time zone
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.inbox_items'::regclass
      and conname = 'inbox_items_channel_valid'
  ) then
    alter table public.inbox_items
      add constraint inbox_items_channel_valid
      check (channel in ('email', 'slack', 'call', 'linkedin', 'sms', 'webinar'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.inbox_items'::regclass
      and conname = 'inbox_items_direction_valid'
  ) then
    alter table public.inbox_items
      add constraint inbox_items_direction_valid
      check (direction in ('inbound', 'outbound'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.inbox_items'::regclass
      and conname = 'inbox_items_status_valid'
  ) then
    alter table public.inbox_items
      add constraint inbox_items_status_valid
      check (status in ('pending', 'accepted', 'dismissed', 'sent', 'snoozed'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.inbox_items'::regclass
      and conname = 'inbox_items_score_range'
  ) then
    alter table public.inbox_items
      add constraint inbox_items_score_range
      check (score between 0 and 100);
  end if;
end$$;

-- Idempotent ingestion: one row per provider message per org+channel.
create unique index if not exists inbox_items_external_uniq
  on public.inbox_items (org_id, channel, external_id)
  where external_id is not null;

-- The inbox view: newest first, scoped to the org.
create index if not exists inbox_items_org_created_idx
  on public.inbox_items (org_id, created_at desc);

-- Cheap pending-count + filtered triage reads.
create index if not exists inbox_items_org_status_idx
  on public.inbox_items (org_id, status);

alter table public.inbox_items enable row level security;

revoke all on table public.inbox_items from anon, authenticated;
grant select on table public.inbox_items to authenticated;
grant select, insert, update on table public.inbox_items to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'inbox_items'
      and policyname = 'members read own org inbox_items'
  ) then
    create policy "members read own org inbox_items"
      on public.inbox_items
      for select to authenticated
      using (
        exists (
          select 1 from public.org_members om
          where om.org_id = inbox_items.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'inbox_items'
      and policyname = 'service_role writes inbox_items'
  ) then
    create policy "service_role writes inbox_items"
      on public.inbox_items
      for all to service_role
      using (true)
      with check (true);
  end if;
end$$;
