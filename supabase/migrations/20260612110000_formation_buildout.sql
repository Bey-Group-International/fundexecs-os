-- =====================================================================
-- Formation buildout: amendments + data-room filing.
--
-- 1. `formation_steps` learns amendments: re-filing a step bumps
--    `version` and stamps `amended_at` instead of silently rewriting the
--    original filing (the original `filed_at` is preserved as history).
-- 2. Widen capital_materials.kind so a filed formation step can become a
--    real data-room document (Legal & Terms / Fund Overview): the six
--    formation kinds join the studio + data-room kinds. The bank step
--    produces no data-room document, so it has no kind here.
--
-- Additive + idempotent (the kind check is widened, never narrowed).
-- RLS is unchanged: members already write their org's formation_steps
-- and capital_materials rows.
-- =====================================================================

alter table public.formation_steps
  add column if not exists version integer not null default 1;

alter table public.formation_steps
  add column if not exists amended_at timestamp with time zone;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.capital_materials'::regclass
      and conname = 'capital_materials_kind_check'
  ) then
    alter table public.capital_materials
      drop constraint capital_materials_kind_check;
  end if;
  alter table public.capital_materials
    add constraint capital_materials_kind_check
    check (kind in (
      'pitch_deck', 'lp_one_pager', 'ic_memo', 'data_room_index',
      'ddq', 'track_record', 'financial_model', 'lp_update',
      'fund_narrative', 'certificate_of_formation', 'lpa', 'ppm',
      'subscription_pack', 'form_d'
    ));
end$$;
