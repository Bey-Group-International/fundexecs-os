-- 20260705000000_office_approval_enforcement.sql
--
-- Server-side enforcement for the AI Execution Floor's approval gates.
--
-- The office (dashboard/office) surfaces Tier 2 (external-facing) and Tier 3
-- (capital-binding) approval gates. Until now the role check lived only in the
-- client store — a UX guard, never a security control (see the SECURITY
-- BOUNDARY note in components/virtual-office/program/officeProgramStore.ts).
--
-- This migration makes the authorization real and server-enforced, keyed off
-- the TRUSTED organization membership role (organization_members.role), not any
-- client-supplied value:
--
--   external_facing (Tier 2) -> owner, admin, member
--   capital_binding (Tier 3) -> owner, admin        (never delegable to member/viewer)
--
-- Enforcement is layered (defense in depth): the RLS WITH CHECK on the decide
-- UPDATE rejects an unauthorized "approved" write at the database layer, and
-- the office_decide_approval() RPC raises a clean 42501 before it. The policy
-- mirrors lib/office/approvalAuthority.ts (memberRoleCanApprove) — keep the two
-- in lockstep.

-- ---------------------------------------------------------------------------
-- office_approvals — one row per workflow-scoped approval gate.
-- ---------------------------------------------------------------------------
create table public.office_approvals (
  id               uuid primary key default extensions.gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  -- Client gate identifier, unique within an org (workflow-scoped).
  gate_key         text not null,
  workflow_title   text not null,
  tier             text not null check (tier in ('external_facing', 'capital_binding')),
  decision         text not null default 'pending'
                     check (decision in ('pending', 'approved', 'rejected')),
  requested_by     uuid references public.principals (id) on delete set null,
  decided_by       uuid references public.principals (id) on delete set null,
  decided_at       timestamptz,
  created_at       timestamptz not null default now(),
  unique (organization_id, gate_key)
);

create index office_approvals_org_idx on public.office_approvals (organization_id);

-- ---------------------------------------------------------------------------
-- office_role_can_approve — the trusted authority check. SECURITY DEFINER so
-- RLS policies can call it without recursing into organization_members' policy
-- (mirrors is_org_admin in 0002_identity.sql).
-- ---------------------------------------------------------------------------
create or replace function public.office_role_can_approve(target_org uuid, target_tier text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members
    where principal_id = auth.uid()
      and organization_id = target_org
      and (
        (target_tier = 'external_facing' and role in ('owner', 'admin', 'member'))
        or (target_tier = 'capital_binding' and role in ('owner', 'admin'))
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS — org members read; anyone in the org may open a pending gate; deciding
-- an "approved" outcome requires tier authority.
-- ---------------------------------------------------------------------------
alter table public.office_approvals enable row level security;

create policy office_approvals_select on public.office_approvals
  for select to authenticated
  using (organization_id in (select public.current_principal_org_ids()));

create policy office_approvals_insert_pending on public.office_approvals
  for insert to authenticated
  with check (
    organization_id in (select public.current_principal_org_ids())
    and decision = 'pending'
    and requested_by = (select auth.uid())
  );

-- The security boundary: rejecting (halting) is open to any org member, but an
-- "approved" outcome is only permitted for a role authorized for the row's tier.
create policy office_approvals_decide on public.office_approvals
  for update to authenticated
  using (organization_id in (select public.current_principal_org_ids()))
  with check (
    organization_id in (select public.current_principal_org_ids())
    and (
      decision = 'rejected'
      or (decision = 'approved' and public.office_role_can_approve(organization_id, tier))
    )
  );

-- ---------------------------------------------------------------------------
-- office_decide_approval — atomic decision entry point. SECURITY INVOKER so the
-- RLS above still applies; raises a clean 42501 on an unauthorized approval so
-- the client gets a precise error instead of a policy violation.
-- ---------------------------------------------------------------------------
create or replace function public.office_decide_approval(
  p_org uuid,
  p_gate_key text,
  p_workflow_title text,
  p_tier text,
  p_decision text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_tier not in ('external_facing', 'capital_binding') then
    raise exception 'invalid approval tier: %', p_tier;
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid approval decision: %', p_decision;
  end if;

  -- Open the gate row if it does not exist yet (workflow-scoped gate_key).
  insert into public.office_approvals
    (organization_id, gate_key, workflow_title, tier, requested_by, decision)
  values
    (p_org, p_gate_key, p_workflow_title, p_tier, auth.uid(), 'pending')
  on conflict (organization_id, gate_key) do nothing;

  -- Authoritative role-by-tier check for approvals (rejections are always
  -- allowed to any org member). Raised before the UPDATE so the caller gets a
  -- precise permission error; the RLS WITH CHECK is the backstop.
  if p_decision = 'approved'
     and not public.office_role_can_approve(p_org, p_tier) then
    raise exception 'not authorized to approve % actions', p_tier
      using errcode = '42501';
  end if;

  update public.office_approvals
     set decision = p_decision,
         decided_by = auth.uid(),
         decided_at = now()
   where organization_id = p_org
     and gate_key = p_gate_key
     and decision = 'pending'
   returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'decision', p_decision,
    'authorized', true
  );
end;
$$;
