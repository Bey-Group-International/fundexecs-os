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
-- So: one row per (organisation, contact, meeting) among the machine-written
-- meeting entries, which lets the writer upsert. A regenerate then CORRECTS the
-- entry — the corrected summary reaches the timeline — rather than adding one.
--
-- Partial, and narrowly so, because it must not constrain anything a person
-- logs by hand. Somebody who genuinely met the same contact twice about the same
-- meeting can still record both: this index only covers rows with is_system,
-- activity_type 'meeting', and a meeting_id in their metadata, which together
-- describe exactly the rows this engine owns.
--
-- Rows with no contact_id (an investor-only activity) are outside the index:
-- Postgres does not treat two nulls as equal, so they would never collide
-- anyway, and naming the condition keeps the index small.

create unique index if not exists network_activities_system_meeting_uniq
  on public.network_activities (organization_id, contact_id, (metadata ->> 'meeting_id'))
  where is_system
    and activity_type = 'meeting'
    and contact_id is not null
    and metadata ? 'meeting_id';

comment on index public.network_activities_system_meeting_uniq is
  'One machine-written meeting entry per contact per meeting, so a report regenerate corrects the timeline entry instead of duplicating it.';
