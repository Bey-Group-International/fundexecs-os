-- =====================================================================
-- Automations: one row per (org, event).
--
-- The Workflows tab's automation toggles upsert against (org_id,
-- on_event); without a uniqueness contract, concurrent toggles could
-- race the read-then-write path into duplicate rows. Dedupe (keep the
-- most recently updated row) then add the unique index so the action
-- can use a single atomic upsert. Additive + idempotent.
-- =====================================================================

delete from public.automations a
using public.automations b
where
  a.org_id = b.org_id
  and a.on_event = b.on_event
  and (
    a.updated_at < b.updated_at
    or (a.updated_at = b.updated_at and a.id < b.id)
  );

create unique index if not exists automations_org_event_unique
  on public.automations (org_id, on_event);
