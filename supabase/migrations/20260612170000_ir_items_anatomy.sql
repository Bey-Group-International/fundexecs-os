-- IR & reporting: deliverable anatomy for prototype parity.
--
-- ir_items was seeded Wave-3 with only (cat, status, due_at); the prototype's
-- IRCenter renders a name, a category chip, an owner, a "drives" line, a
-- detail paragraph and a contents checklist per deliverable. Additive and
-- idempotent: new columns are nullable (contents defaults to an empty list),
-- and existing rows are backfilled from the legacy `cat` column, which held
-- the deliverable's display name.

alter table public.ir_items add column if not exists name text;
alter table public.ir_items add column if not exists category text;
alter table public.ir_items add column if not exists who text;
alter table public.ir_items add column if not exists drives text;
alter table public.ir_items add column if not exists detail text;
alter table public.ir_items add column if not exists contents jsonb not null default '[]'::jsonb;

-- Legacy rows: `cat` carried the deliverable name; lift it into `name` and
-- map the known baseline deliverables onto the prototype's categories.
update public.ir_items
set name = cat
where name is null;

update public.ir_items
set category = case
  when cat ilike '%letter%' or cat ilike '%update%' then 'Letters'
  when cat ilike '%statement%' or cat ilike '%k-1%' or cat ilike '%capital call%' then 'Statements'
  when cat ilike '%meeting%' or cat ilike '%webinar%' or cat ilike '%event%' then 'Events'
  when cat ilike '%portal%' or cat ilike '%survey%' then 'Portal'
  else null
end
where category is null;
