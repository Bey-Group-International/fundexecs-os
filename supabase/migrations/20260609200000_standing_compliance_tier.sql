-- =====================================================================
-- Strategy → compounding command surface, Phase 4: the standing
-- compliance tier (memory/STRATEGY_COMPOUNDING_BLUEPRINT.md, decision #4).
--
-- A permanent, never-empty compliance lane per org, owned by Adrian
-- (GC/Compliance, brain slug 'legal-admin'), feeding the Compliance pillar
-- of the Institutional Posture scorecard. The lane is materialized as a
-- governance_plan + governance_objectives carrying category = 'compliance'.
--
-- Additive + idempotent. No drops, no backfill of existing rows. Everything
-- guarded so re-running is safe. RLS is inherited from governance_plans /
-- governance_objectives (org-member scoped); the seed/refresh RPCs run
-- SECURITY DEFINER so the cron (service role) and a first read (an org member)
-- can both keep the lane non-empty.
--
-- DO NOT apply against a live DB from here — committed-only; the migration is
-- applied via the normal `supabase db push` flow.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Additive column: which specialist owns an objective.
--
-- owner_id references public.profiles (a human user). The compliance lane is
-- owned by Adrian, an AI specialist (no profiles row), so we record ownership
-- as a brain slug here. NULL = no specialist owner (the existing manual path).
-- ---------------------------------------------------------------------
alter table public.governance_objectives
  add column if not exists owner_specialist text;

comment on column public.governance_objectives.owner_specialist is
  'AI specialist (ai_brains.slug) that owns this objective, e.g. legal-admin (Adrian) for the standing compliance tier. NULL = no specialist owner.';

-- Mirror the column onto the plan so the lane itself carries its owner.
alter table public.governance_plans
  add column if not exists owner_specialist text;

comment on column public.governance_plans.owner_specialist is
  'AI specialist (ai_brains.slug) that owns this plan, e.g. legal-admin (Adrian) for the standing compliance tier.';

-- Partial index for the compliance-lane loader so it never seq-scans.
create index if not exists idx_governance_objectives_compliance_lane
  on public.governance_objectives (org_id)
  where category = 'compliance' and deleted_at is null;

-- ---------------------------------------------------------------------
-- 2. ensure_compliance_tier(_org) — idempotent seed/ensure.
--
-- Guarantees a permanent category='compliance' lane for the org, owned by
-- Adrian, seeded with real baseline compliance objectives so it is NEVER
-- empty. Safe to call on every read and from the cron. Returns the
-- compliance plan id.
--
-- Baseline objectives (real RIA/exempt-reporting compliance cadence, not
-- fabricated busywork):
--   - Form ADV annual amendment (within 90 days of fiscal year-end)
--   - Form ADV interim "other-than-annual" material-change check
--   - Form D / amendment follow-ups on closed or amended offerings
--   - Annual compliance program review (Rule 206(4)-7)
--   - Code of Ethics / personal-trading attestation cadence
-- ---------------------------------------------------------------------
create or replace function public.ensure_compliance_tier(_org uuid)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  _plan uuid;
  _adrian constant text := 'legal-admin';
  _seed_tag constant text := '[seed:compliance-tier]';
begin
  if _org is null then
    return null;
  end if;

  -- Authorize: the cron (service_role) or an active member of the org. Without
  -- this guard any authenticated caller could seed a lane into an arbitrary org
  -- (the function is SECURITY DEFINER and bypasses RLS).
  if coalesce((select auth.role()), '') <> 'service_role'
     and not exists (
       select 1 from public.org_members om
       where om.org_id = _org
         and om.user_id = auth.uid()
         and om.status = 'active'
     )
  then
    raise exception 'not a member of org %', _org using errcode = '42501';
  end if;

  -- Serialize concurrent seeds for the same org so the select-then-insert
  -- below stays race-free (two first-reads cannot both create the lane).
  perform pg_advisory_xact_lock(hashtext(_org::text));

  -- One canonical compliance lane per org. Match on the category marker so we
  -- never create a duplicate plan, regardless of name.
  select id
    into _plan
  from public.governance_plans
  where org_id = _org
    and owner_specialist = _adrian
    and name = 'Compliance — standing'
  order by created_at asc
  limit 1;

  if _plan is null then
    insert into public.governance_plans (org_id, name, horizon, status, owner_specialist)
    values (_org, 'Compliance — standing', 'ongoing', 'active', _adrian)
    returning id into _plan;
  end if;

  -- Seed each baseline objective at most once per org (keyed by ai_recommendation
  -- carrying the seed tag + a stable per-item slug). Inserts are guarded by a
  -- NOT EXISTS so re-running adds nothing and never overwrites operator edits.
  insert into public.governance_objectives
    (org_id, plan_id, objective, timeline, priority, status, category, source,
     owner_specialist, ai_recommendation)
  select _org, _plan, v.objective, v.timeline, v.priority, 'open', 'compliance',
         'lifecycle', _adrian, _seed_tag || ' ' || v.slug || ' :: ' || v.note
  from (values
    ('form-adv-annual',
      'File the Form ADV annual updating amendment',
      'Within 90 days of fiscal year-end',
      'high',
      'Adrian: the annual ADV amendment is due within 90 days of your fiscal year-end. Refresh AUM, fees, and disciplinary disclosures before filing.'),
    ('form-adv-interim',
      'Review Form ADV for material changes (interim amendment)',
      'Ongoing — file promptly on material change',
      'medium',
      'Adrian: any material change (ownership, control, custody, disciplinary events) triggers a prompt other-than-annual ADV amendment. Log a quarterly check.'),
    ('form-d-followups',
      'Reconcile Form D filings and amendments on live offerings',
      'Within 30 days of first sale; amend annually',
      'medium',
      'Adrian: every Reg D offering needs a Form D within 15 days of first sale, plus an annual amendment while open. Track each live offering here.'),
    ('compliance-program-review',
      'Complete the annual compliance program review (Rule 206(4)-7)',
      'Annually',
      'high',
      'Adrian: Rule 206(4)-7 requires an annual review of the adequacy and effectiveness of your compliance policies. Document findings and remediation.'),
    ('code-of-ethics-attestation',
      'Collect Code of Ethics and personal-trading attestations',
      'Quarterly',
      'low',
      'Adrian: supervised persons must acknowledge the Code of Ethics and report personal securities holdings/transactions on cadence. Capture the attestation log.')
  ) as v(slug, objective, timeline, priority, note)
  where not exists (
    select 1
    from public.governance_objectives go
    where go.org_id = _org
      and go.category = 'compliance'
      and go.deleted_at is null
      and go.ai_recommendation like _seed_tag || ' ' || v.slug || ' %'
  );

  return _plan;
end;
$$;

revoke all on function public.ensure_compliance_tier(uuid) from public, anon;
grant execute on function public.ensure_compliance_tier(uuid) to service_role, authenticated;

-- ---------------------------------------------------------------------
-- 3. refresh_compliance_tier(_org, _stale_days) — scheduled maintenance.
--
-- Server-side aging + signal refresh, run from the intelligence cron:
--   (a) ensures the lane exists (never-empty even pre-cron),
--   (b) ages open, unread compliance objectives that have sat untouched past
--       _stale_days into 'high' priority (ignored compliance is the risk),
--   (c) drafts a follow-up compliance objective from each recent unprocessed
--       EDGAR Form ADV / Form D market signal (deduped by source_signal_id),
--       owned by Adrian.
--
-- Returns the number of objectives created or escalated. Never throws on an
-- empty signal pool — degrades to just the ensure + aging pass.
-- ---------------------------------------------------------------------
create or replace function public.refresh_compliance_tier(_org uuid, _stale_days integer default 14)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  _plan uuid;
  _adrian constant text := 'legal-admin';
  _seed_tag constant text := '[seed:compliance-tier]';
  _touched integer := 0;
  _aged integer := 0;
  _drafted integer := 0;
begin
  if _org is null then
    return 0;
  end if;

  -- Authorize: the cron (service_role) or an active member of the org. Mirrors
  -- ensure_compliance_tier; this RPC is SECURITY DEFINER and mutates org rows.
  if coalesce((select auth.role()), '') <> 'service_role'
     and not exists (
       select 1 from public.org_members om
       where om.org_id = _org
         and om.user_id = auth.uid()
         and om.status = 'active'
     )
  then
    raise exception 'not a member of org %', _org using errcode = '42501';
  end if;

  -- (a) Never-empty guarantee. Takes a per-org advisory xact lock that also
  -- serializes the signal-draft insert in section (c) below.
  _plan := public.ensure_compliance_tier(_org);
  if _plan is null then
    return 0;
  end if;

  -- (b) Age ignored compliance objectives into high priority. "Ignored" =
  -- still open, never read, and untouched (no update) past the threshold.
  update public.governance_objectives
  set priority = 'high'
  where org_id = _org
    and category = 'compliance'
    and deleted_at is null
    and archived_at is null
    and status not in ('done', 'complete', 'completed', 'closed', 'archived')
    and priority <> 'high'
    and read_at is null
    and updated_at < now() - make_interval(days => greatest(_stale_days, 1));
  get diagnostics _aged = row_count;

  -- (c) Draft a follow-up compliance objective from each recent SEC filing
  -- signal we haven't already linked. Form ADV + Form D sources only; capped so
  -- the lane stays focused. Deduped on source_signal_id.
  with fresh as (
    select ms.id,
           ms.source,
           coalesce(ms.normalized ->> 'issuer_name', 'a recent filer') as issuer,
           coalesce(ms.normalized ->> 'form_type', ms.kind) as form_type
    from public.market_signals ms
    where ms.source in ('edgar-form-adv', 'form-adv', 'edgar-form-d', 'form-d')
      and ms.captured_at > now() - interval '30 days'
      and not exists (
        select 1
        from public.governance_objectives go
        where go.org_id = _org
          and go.category = 'compliance'
          and go.source_signal_id = ms.id
          and go.deleted_at is null
      )
    order by ms.captured_at desc
    limit 5
  )
  insert into public.governance_objectives
    (org_id, plan_id, objective, timeline, priority, status, category, source,
     source_signal_id, owner_specialist, ai_recommendation)
  select _org,
         _plan,
         case
           when fresh.source in ('edgar-form-adv', 'form-adv')
             then 'Review Form ADV filing: ' || fresh.issuer
           else 'Follow up on Form D filing: ' || fresh.issuer
         end,
         'Within 10 days',
         'medium',
         'open',
         'compliance',
         'signal',
         fresh.id,
         _adrian,
         _seed_tag || ' signal :: Adrian flagged a ' || fresh.form_type
           || ' filing (' || fresh.issuer || '). Confirm it does not implicate your filings or counterparties.'
  from fresh;
  get diagnostics _drafted = row_count;

  _touched := _aged + _drafted;
  return _touched;
end;
$$;

revoke all on function public.refresh_compliance_tier(uuid, integer) from public, anon;
grant execute on function public.refresh_compliance_tier(uuid, integer) to service_role, authenticated;
