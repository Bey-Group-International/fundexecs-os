-- =====================================================================
-- FundExecs OS — Earn XP awarding for Chain-of-Trust completions
-- Reward is fixed server-side per proof layer (clients cannot inflate it),
-- idempotent per (actor, entity ref), and org-membership checked. Records a
-- trust_events row. Tolerates non-uuid entity refs (stored in metadata).
-- =====================================================================

create or replace function public.award_trust_xp(
  _org uuid,
  _layer text,
  _entity_type text,
  _entity_id text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _amount integer;
  _eid uuid;
  _new_xp integer;
begin
  if _uid is null then
    return null;
  end if;

  -- Only members of the org may earn against it.
  if not exists (
    select 1 from org_members where user_id = _uid and org_id = _org
  ) then
    return null;
  end if;

  -- Server-fixed reward per Chain-of-Trust layer.
  _amount := case _layer
    when 'truth' then 15
    when 'concept' then 25
    when 'execution' then 40
    when 'work' then 60
    else 10
  end;

  -- entity_id is a uuid column; tolerate non-uuid refs by keeping them only in
  -- metadata.entity_ref and leaving the uuid column null.
  begin
    _eid := _entity_id::uuid;
  exception when others then
    _eid := null;
  end;

  -- Idempotent: award once per (actor, entity ref). Re-completing is a no-op.
  if exists (
    select 1 from trust_events
    where actor_id = _uid
      and action = 'trust_complete'
      and metadata->>'entity_ref' = _entity_id
  ) then
    select xp into _new_xp from profiles where id = _uid;
    return _new_xp;
  end if;

  insert into trust_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    _org, _uid, 'trust_complete', _entity_type, _eid,
    jsonb_build_object('layer', _layer, 'xp', _amount, 'entity_ref', _entity_id)
  );

  update profiles set xp = xp + _amount where id = _uid returning xp into _new_xp;
  return _new_xp;
end;
$$;

revoke all on function public.award_trust_xp(uuid, text, text, text) from public;
revoke execute on function public.award_trust_xp(uuid, text, text, text) from anon;
grant execute on function public.award_trust_xp(uuid, text, text, text) to authenticated;
