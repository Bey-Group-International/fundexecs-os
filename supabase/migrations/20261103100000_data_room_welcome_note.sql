-- 20261103100000_data_room_welcome_note.sql
--
-- A short note from the firm that opens the LP-facing room, under its headline.
-- It is its own column rather than `description`: the description is written for
-- the team ("Who is this for?") and has never been shown to an outside reader, so
-- reusing it would publish whatever is already there.

alter table public.data_rooms
  add column if not exists welcome_note text
    check (welcome_note is null or char_length(welcome_note) <= 1200);
