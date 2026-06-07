-- =====================================================================
-- Admin metrics + beta invite acceptance wiring.
--
-- Additive + idempotent. Metrics stay RLS/member-scoped via an
-- authenticated SECURITY DEFINER RPC; invite acceptance is service-role only
-- because it grants org membership after a Supabase magic-link verification.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Persist the invited org role explicitly.
-- ---------------------------------------------------------------------

alter table public.beta_invites
  add column if not exists role public.org_member_role not null default 'member';

create index if not exists beta_invites_org_role_status_idx
  on public.beta_invites (org_id, role, status);

create unique index if not exists beta_invites_org_email_exact_key
  on public.beta_invites (org_id, email);

-- ---------------------------------------------------------------------
-- 2. Real Admin platform metrics.
-- ---------------------------------------------------------------------

create or replace function public.get_admin_metrics(_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _brains_total integer := 0;
  _brains_embedded integer := 0;
  _chunks_total integer := 0;
  _chunks_embedded integer := 0;
  _docs_total integer := 0;
  _docs_processed integer := 0;
  _intake_queued integer := 0;
  _vector_status text := 'unknown';
  _truth integer := 0;
  _concept integer := 0;
  _execution integer := 0;
  _work integer := 0;
begin
  if _org_id is null or not private.is_org_member(_org_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  with visible_brains as (
    select b.id
    from public.ai_brains b
    where b.org_id is null
       or b.org_id = _org_id
  )
  select
    count(*)::integer,
    count(*) filter (
      where exists (
        select 1
        from public.knowledge_chunks kc
        where kc.brain_id = visible_brains.id
          and (kc.org_id is null or kc.org_id = _org_id)
          and kc.embedding is not null
      )
    )::integer
  into _brains_total, _brains_embedded
  from visible_brains;

  select
    count(*)::integer,
    count(*) filter (where kc.embedding is not null)::integer
  into _chunks_total, _chunks_embedded
  from public.knowledge_chunks kc
  where kc.org_id is null
     or kc.org_id = _org_id;

  select
    count(*)::integer,
    count(*) filter (
      where exists (
        select 1
        from public.knowledge_chunks kc
        where kc.document_id = kd.id
          and (kc.org_id is null or kc.org_id = _org_id)
          and kc.embedding is not null
      )
    )::integer
  into _docs_total, _docs_processed
  from public.knowledge_documents kd
  where kd.org_id is null
     or kd.org_id = _org_id;

  _intake_queued := greatest(_docs_total - _docs_processed, 0);
  _vector_status := case
    when _chunks_embedded > 0 then 'live'
    when _chunks_total > 0 or _docs_total > 0 then 'degraded'
    else 'unknown'
  end;

  with deal_layers as (
    select
      case
        when lower(pl.layer_name) like '%truth%' then 'truth'
        when lower(pl.layer_name) like '%concept%' then 'concept'
        when lower(pl.layer_name) like '%execution%' then 'execution'
        when lower(pl.layer_name) like '%work%' then 'work'
        else null
      end as layer_key,
      least(100, greatest(0, coalesce(pl.completion_percentage, 0)))::numeric as completion
    from public.chain_of_trust_records cot
    join public.proof_layers pl
      on pl.chain_record_id = cot.id
     and pl.org_id = cot.org_id
    where cot.org_id = _org_id
      and cot.entity_type = 'deal'
      and cot.status <> 'archived'
  ),
  layer_scores as (
    select layer_key, round(avg(completion))::integer as score
    from deal_layers
    where layer_key is not null
    group by layer_key
  )
  select
    coalesce(max(score) filter (where layer_key = 'truth'), 0),
    coalesce(max(score) filter (where layer_key = 'concept'), 0),
    coalesce(max(score) filter (where layer_key = 'execution'), 0),
    coalesce(max(score) filter (where layer_key = 'work'), 0)
  into _truth, _concept, _execution, _work
  from layer_scores;

  return jsonb_build_object(
    'brains', jsonb_build_object(
      'total', coalesce(_brains_total, 0),
      'embedded', coalesce(_brains_embedded, 0)
    ),
    'vector', jsonb_build_object(
      'status', _vector_status,
      'chunks', coalesce(_chunks_total, 0)
    ),
    'intake', jsonb_build_object(
      'queued', coalesce(_intake_queued, 0),
      'processed', coalesce(_docs_processed, 0)
    ),
    'trust', jsonb_build_object(
      'layerCoverage', jsonb_build_object(
        'truth', coalesce(_truth, 0),
        'concept', coalesce(_concept, 0),
        'execution', coalesce(_execution, 0),
        'work', coalesce(_work, 0)
      )
    ),
    'placeholder', false
  );
end;
$$;

revoke all on function public.get_admin_metrics(uuid) from public, anon;
grant execute on function public.get_admin_metrics(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Accept beta invite -> org membership + audit.
-- ---------------------------------------------------------------------

create or replace function public.accept_beta_invite(
  _email text,
  _user_id uuid,
  _invite_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _invite public.beta_invites%rowtype;
  _member_id uuid;
  _was_pending boolean := false;
  _accepted_at timestamptz := now();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'accept_beta_invite requires service_role' using errcode = '42501';
  end if;

  if _user_id is null then
    raise exception 'user_id is required';
  end if;

  if nullif(btrim(coalesce(_email, '')), '') is null then
    raise exception 'email is required';
  end if;

  insert into public.profiles (id, full_name)
  values (_user_id, '')
  on conflict (id) do nothing;

  select bi.* into _invite
  from public.beta_invites bi
  where lower(bi.email) = lower(btrim(_email))
    and bi.status in ('pending', 'accepted')
    and (_invite_id is null or bi.id = _invite_id)
  order by
    case bi.status when 'pending' then 0 else 1 end,
    bi.last_sent_at desc,
    bi.created_at desc
  limit 1
  for update;

  if _invite.id is null then
    return jsonb_build_object(
      'accepted', false,
      'reason', 'invite_not_found'
    );
  end if;

  _was_pending := _invite.status = 'pending';

  insert into public.org_members (org_id, user_id, role, status)
  values (_invite.org_id, _user_id, _invite.role, 'active')
  on conflict (org_id, user_id) do update
    set role = excluded.role,
        status = 'active'
  returning id into _member_id;

  update public.beta_invites
     set status = 'accepted',
         accepted_at = coalesce(accepted_at, _accepted_at)
   where id = _invite.id;

  if _was_pending then
    insert into public.admin_actions (
      org_id,
      admin_user_id,
      action_type,
      target_type,
      target_id,
      metadata
    )
    values (
      _invite.org_id,
      _invite.invited_by,
      'invite_accepted',
      'beta_invite',
      _invite.id,
      jsonb_build_object(
        'email', lower(btrim(_email)),
        'user_id', _user_id,
        'role', _invite.role,
        'member_id', _member_id
      )
    );
  end if;

  return jsonb_build_object(
    'accepted', true,
    'invite_id', _invite.id,
    'org_id', _invite.org_id,
    'member_id', _member_id,
    'role', _invite.role
  );
end;
$$;

revoke all on function public.accept_beta_invite(text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.accept_beta_invite(text, uuid, uuid)
  to service_role;
