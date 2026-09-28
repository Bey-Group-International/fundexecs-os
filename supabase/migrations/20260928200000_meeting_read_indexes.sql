-- Indexes for two reads that had none that fit.

-- The reminder sweep, every cron tick, across every organisation:
--   is_draft = false, deleted_at is null, last_reminder_sent_at is null,
--   reminder_minutes is not null, scheduled_at in (now, now + 2 weeks],
--   ordered by scheduled_at.
-- Every existing scheduled_at index leads with organization_id, so none serves
-- a query that has no organisation — each tick scanned the table. Partial on
-- exactly the sweep's constant filters, so it holds only meetings still owed a
-- reminder and stays small as history grows. (status <> 'ended' is left to the
-- scan: an ended meeting with a future start is rare.)
create index if not exists live_meetings_reminder_due_idx
  on public.live_meetings (scheduled_at)
  where is_draft = false
    and deleted_at is null
    and last_reminder_sent_at is null
    and reminder_minutes is not null;

-- The meeting log: one organisation's meetings, newest first, limit 200.
-- live_meetings_kind_idx (organization_id, kind) finds the rows but not in
-- order, so the log sorted the organisation's whole history on every visit.
-- Mirrors live_meetings_one_way_idx, which serves the call archive the same
-- way.
create index if not exists live_meetings_meeting_log_idx
  on public.live_meetings (organization_id, created_at desc)
  where kind = 'meeting' and deleted_at is null;
