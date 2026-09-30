-- A daily booking limit for public scheduling links.
--
-- Open hours say when a host can meet, not how much. A host with a full day of
-- open hours could be booked back to back from first slot to last; this caps
-- how many bookings one host-local day takes. Once a day reaches it, the link
-- stops offering that day, and the book route re-checks before accepting.
--
-- Null means no limit, which is what every existing page keeps.

alter table public.scheduling_pages
  add column if not exists max_bookings_per_day smallint
    check (max_bookings_per_day is null or max_bookings_per_day between 1 and 50);

comment on column public.scheduling_pages.max_bookings_per_day is
  'Most pending or confirmed bookings accepted per host-local day; null for no limit.';
