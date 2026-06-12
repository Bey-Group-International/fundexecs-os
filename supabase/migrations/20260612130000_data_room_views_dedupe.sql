-- =====================================================================
-- Data-room views: dedupe per recipient, keyed by email.
--
-- The public gate stored every verification as a fresh row with the
-- email embedded in the display string ("Name · email"), so a repeat
-- visitor (or a script holding a leaked link) could grow the table and
-- the operator's access bench without bound. Give the email its own
-- column, backfill it from the stored strings, collapse duplicates
-- (latest per link+email wins), and enforce uniqueness so the action's
-- upsert has a constraint to land on.
--
-- Additive + idempotent.
-- =====================================================================

alter table public.data_room_views
  add column if not exists viewer_email text;

update public.data_room_views
set viewer_email = lower(trim(split_part(viewer, ' · ', -1)))
where viewer_email is null
  and viewer like '% · %';

delete from public.data_room_views d
using public.data_room_views k
where d.link_id = k.link_id
  and d.viewer_email is not null
  and d.viewer_email = k.viewer_email
  and (k.created_at > d.created_at
    or (k.created_at = d.created_at and k.id > d.id));

create unique index if not exists data_room_views_link_email_unique
  on public.data_room_views (link_id, viewer_email);
