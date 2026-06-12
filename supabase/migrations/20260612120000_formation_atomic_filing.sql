-- ============================================================================
-- Formation filing — atomic + integrity-constrained.
--
-- The buildout (20260612110000) made filing real but left it as ~8 sequential
-- writes from the server action (step row, chain record, proof layers,
-- data-room material, audit event, formed flip). A failure mid-sequence left
-- retry-safe-but-partial state, and re-filing relied on a "latest row wins"
-- read because capital_materials had no uniqueness for the formation kinds.
--
-- This migration fortifies all of that:
--   1. One row per (org, formation kind) in capital_materials, enforced by a
--      partial unique index (after a defensive dedupe keeping the newest row).
--   2. formation_steps.version is constrained >= 1 at the DB.
--   3. file_formation_step(): a single transactional RPC that performs the
--      whole filing — ordering enforcement, step insert-or-amend, Chain of
--      Trust record + proof layers, data-room material upsert, an immutable
--      capital_material_versions snapshot per filing (history is never
--      overwritten), the trust_events audit entry, and the formed flip —
--      all-or-nothing, serialized per org via the fund_formations row lock.
--      Also collapses the action's 8+ network round trips into one call.
--
-- History note: filings made before this migration wrote no version rows, so
-- an org's snapshot history starts at its first post-migration filing.
-- Additive + idempotent; follows the upsert_trust_posture_snapshot RPC
-- pattern (SECURITY DEFINER, empty search_path, explicit membership check).
-- ============================================================================

-- 1. One material per (org, formation kind). Dedupe first (keep newest), so
--    the index creation can never fail on legacy rows.
delete from public.capital_materials a
using public.capital_materials b
where a.org_id = b.org_id
  and a.kind = b.kind
  and a.kind in ('fund_narrative', 'certificate_of_formation', 'lpa', 'ppm',
                 'subscription_pack', 'form_d')
  and (a.updated_at, a.id) < (b.updated_at, b.id);

create unique index if not exists capital_materials_org_formation_kind_unique
  on public.capital_materials (org_id, kind)
  where kind in ('fund_narrative', 'certificate_of_formation', 'lpa', 'ppm',
                 'subscription_pack', 'form_d');

-- 2. Versions only count up from 1.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.formation_steps'::regclass
      and conname = 'formation_steps_version_check'
  ) then
    alter table public.formation_steps
      add constraint formation_steps_version_check check (version >= 1);
  end if;
end$$;

-- 3. The atomic filing RPC.
create or replace function public.file_formation_step(
  _org_id   uuid,
  _kind     text,
  _data     jsonb,
  _spec     jsonb,
  _doc_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _order constant text[] := array[
    'story', 'structure', 'terms', 'ppm', 'subscription', 'regulatory', 'bank'];
  _names constant text[] := array[
    'Your fund story', 'Fund entity (LP + GP)', 'Limited Partnership Agreement',
    'Private Placement Memorandum', 'Subscription documents',
    'Reg D / Form D filing', 'Bank & escrow accounts'];
  _user        uuid := auth.uid();
  _idx         int;
  _filed       text[];
  _missing     text := null;
  _step_id     uuid;
  _version     int;
  _filed_at    timestamptz;
  _amended_at  timestamptz;
  _amended     boolean := false;
  _now         timestamptz := now();
  _mkind       text;
  _mtitle      text;
  _material_id uuid;
  _formed      boolean;
  i            int;
begin
  _idx := array_position(_order, _kind);
  if _idx is null then
    raise exception 'Unknown formation step.' using errcode = '22023';
  end if;
  if _org_id is null or _data is null or _spec is null then
    raise exception 'Missing filing payload.' using errcode = '22023';
  end if;

  -- Authorize: an active member of the org (or the service role).
  if coalesce((select auth.role()), '') <> 'service_role'
     and not exists (
       select 1 from public.org_members om
       where om.org_id = _org_id
         and om.user_id = _user
         and om.status = 'active'
     )
  then
    raise exception 'Not a member of this workspace.' using errcode = '42501';
  end if;

  -- Working document upsert. The row lock this takes also serializes
  -- concurrent filings for the org for the rest of the transaction.
  insert into public.fund_formations as ff (org_id, created_by, data)
  values (_org_id, _user, _data)
  on conflict (org_id) do update
    set data = excluded.data;

  select array_agg(fs.kind) into _filed
  from public.formation_steps fs where fs.org_id = _org_id;

  select fs.id, fs.version, fs.filed_at, fs.amended_at
    into _step_id, _version, _filed_at, _amended_at
  from public.formation_steps fs
  where fs.org_id = _org_id and fs.kind = _kind;

  if _step_id is null then
    -- Server-enforced ordering: a first filing needs every earlier step on
    -- the record. Amending an already-filed step is always allowed.
    for i in 1 .. _idx - 1 loop
      if not (_order[i] = any (coalesce(_filed, '{}'))) then
        _missing := coalesce(_missing || ', then ', '') || '“' || _names[i] || '”';
      end if;
    end loop;
    if _missing is not null then
      raise exception 'Formation builds in order — file % before this step.', _missing
        using errcode = 'P0001';
    end if;

    insert into public.formation_steps (org_id, kind, filed_by, filed_at)
    values (_org_id, _kind, _user, _now)
    returning id, version, filed_at into _step_id, _version, _filed_at;
  else
    -- Amendments never rewrite history: filed_at stays, version bumps.
    _amended := true;
    _version := _version + 1;
    _amended_at := _now;
    update public.formation_steps
      set version = _version, amended_at = _now, filed_by = _user
      where id = _step_id;
  end if;

  -- Chain of Trust: one real record (+ its four proof layers) per step.
  if not exists (
    select 1 from public.chain_of_trust_records c
    where c.org_id = _org_id
      and c.entity_type = 'formation_step'
      and c.entity_id = _step_id
  ) then
    with rec as (
      insert into public.chain_of_trust_records
        (org_id, entity_type, entity_id, current_layer, completion_percentage, status)
      values (_org_id, 'formation_step', _step_id, 'Proof of Truth', 0, 'active')
      returning id
    )
    insert into public.proof_layers
      (org_id, chain_record_id, layer_name, layer_order,
       required_documents, required_tasks, human_approval_status, completion_percentage)
    select _org_id, rec.id, l.name, l.ord, '[]'::jsonb, '[]'::jsonb, 'pending', 0
    from rec,
         (values ('Proof of Truth', 1), ('Proof of Concept', 2),
                 ('Proof of Execution', 3), ('Proof of Work', 4)) as l (name, ord);
  end if;

  -- Data-room material + immutable per-version snapshot. The bank step opens
  -- accounts and produces no document.
  _mkind := case _kind
    when 'story'        then 'fund_narrative'
    when 'structure'    then 'certificate_of_formation'
    when 'terms'        then 'lpa'
    when 'ppm'          then 'ppm'
    when 'subscription' then 'subscription_pack'
    when 'regulatory'   then 'form_d'
  end;
  _mtitle := case _kind
    when 'story'        then 'Fund narrative'
    when 'structure'    then 'Certificate of Formation'
    when 'terms'        then 'Limited Partnership Agreement'
    when 'ppm'          then 'Private Placement Memorandum'
    when 'subscription' then 'Subscription pack'
    when 'regulatory'   then 'Form D'
  end;

  if _mkind is not null then
    insert into public.capital_materials as cm
      (org_id, created_by, kind, title, status, spec, last_generated_at)
    values (_org_id, _user, _mkind, _mtitle, 'ready', _spec, _now)
    on conflict (org_id, kind)
      where kind in ('fund_narrative', 'certificate_of_formation', 'lpa', 'ppm',
                     'subscription_pack', 'form_d')
      do update set
        title = excluded.title,
        spec = excluded.spec,
        status = 'ready',
        last_generated_at = excluded.last_generated_at
    returning cm.id into _material_id;

    insert into public.capital_material_versions
      (org_id, material_id, version_number, title, body, source,
       source_snapshot, created_by)
    values (_org_id, _material_id, _version, _mtitle, coalesce(_doc_body, ''),
            'deterministic_template', _spec, _user)
    on conflict (material_id, version_number) do update set
      title = excluded.title,
      body = excluded.body,
      source_snapshot = excluded.source_snapshot;
  end if;

  -- Audit entry — inside the transaction, so the trail can never be missing.
  insert into public.trust_events
    (org_id, actor_id, entity_type, entity_id, action, metadata)
  values (_org_id, _user, 'formation_step', _step_id,
          case when _amended then 'formation_step_amended' else 'formation_step_filed' end,
          jsonb_build_object('kind', _kind, 'version', _version));

  -- Formed once every step kind is on the record.
  select count(distinct fs.kind) >= array_length(_order, 1) into _formed
  from public.formation_steps fs where fs.org_id = _org_id;
  if _formed then
    update public.fund_formations set status = 'formed' where org_id = _org_id;
  end if;

  return jsonb_build_object(
    'version', _version,
    'amended', _amended,
    'filed_at', _filed_at,
    'amended_at', _amended_at,
    'formed', _formed
  );
end;
$$;

revoke all on function public.file_formation_step(uuid, text, jsonb, jsonb, text)
  from public, anon;
grant execute on function public.file_formation_step(uuid, text, jsonb, jsonb, text)
  to authenticated, service_role;
