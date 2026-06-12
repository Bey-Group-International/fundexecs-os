-- =====================================================================
-- Compliance tab (Run hub): prototype-parity fields on compliance_items.
--
-- The posture board's obligations carry a display name, owner, an honest
-- rule-derived due label, a drives-line, the detail paragraph, the action
-- verb and a checklist — the anatomy the prototype's ComplianceCenter
-- renders per row and in the detail drawer. Additive + idempotent; legacy
-- rows (category-only) keep rendering via the vocabulary normalizer.
-- =====================================================================

alter table public.compliance_items
  add column if not exists name text,
  add column if not exists owner_name text,
  add column if not exists due_label text,
  add column if not exists drives text,
  add column if not exists detail text,
  add column if not exists action_label text,
  add column if not exists checklist jsonb not null default '[]'::jsonb;
