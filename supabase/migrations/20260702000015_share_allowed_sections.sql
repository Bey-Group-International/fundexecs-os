-- Allow a share link to expose only a subset of data-room sections.
-- NULL means "all sections" (existing behaviour preserved).
alter table data_room_shares
  add column if not exists allowed_sections text[] default null;
