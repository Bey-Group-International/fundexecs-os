-- =====================================================================
-- Data-room links: a first-class material kind.
--
-- Links for generated materials were joined to `capital_materials` by
-- their human label (`data_room_links.label` = MAT_LABEL text), which
-- breaks the moment copy changes. Store the material's DB kind on the
-- link itself and backfill existing rows from their labels. `label`
-- stays — it is still the display name on the public share page.
--
-- Additive + idempotent.
-- =====================================================================

alter table public.data_room_links
  add column if not exists material_kind text;

update public.data_room_links
set material_kind = case label
  when 'Pitch deck' then 'pitch_deck'
  when 'One-pager' then 'lp_one_pager'
  when 'Due-diligence questionnaire' then 'ddq'
  when 'Track record' then 'track_record'
  when 'Financial model' then 'financial_model'
  when 'LP update template' then 'lp_update'
  else null
end
where material_kind is null;

create index if not exists data_room_links_org_material_kind_idx
  on public.data_room_links (org_id, material_kind);
