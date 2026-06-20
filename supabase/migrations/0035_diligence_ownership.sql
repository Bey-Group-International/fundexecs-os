-- 0033_diligence_ownership.sql
-- Ownership & accountability on diligence_items. Two columns so every open
-- question can be assigned to a person with a deadline:
--
--   * owner    — free-text accountable party (name / initials / desk).
--   * due_date — when the item is expected to be cleared; the UI flags it
--                overdue once today passes it and the item is still open.
--
-- No new RLS: both columns inherit the existing diligence_items policies.
alter table public.diligence_items
  add column owner    text,
  add column due_date date;
