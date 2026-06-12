-- =====================================================================
-- Structure & Governance — fortification: owner/admin writes + audit trail.
--
-- Two changes, both additive + idempotent:
--
-- 1. Re-gate the member-write RLS on governance_bodies / governance_policies
--    to owners and admins only. Governance is the institutional spine an LP
--    diligences; adopting a policy or seating a committee is a privileged act,
--    so regular members keep read access but can no longer mutate it. (The
--    server actions enforce the same check; this is defense in depth.)
--
-- 2. Add governance_events — an append-only audit log of every governance act
--    (policy drafted/adopted, body member seated): who, what, when, and the
--    decision/member metadata. Mirrors the loop_events pattern. No UPDATE or
--    DELETE is ever granted, so the record is immutable; an owner/admin may
--    only insert events attributed to themselves, members may read.
-- =====================================================================

-- 1. ── owner/admin write gating ─────────────────────────────────────────────

do $$
begin
  -- governance_bodies: replace the any-active-member write with owner/admin.
  drop policy if exists "members write own org governance bodies"
    on public.governance_bodies;
  create policy "owners and admins write own org governance bodies"
    on public.governance_bodies
    for all to authenticated
    using (
      exists (
        select 1 from public.org_members om
        where om.org_id = governance_bodies.org_id
          and om.user_id = auth.uid()
          and om.status = 'active'
          and om.role in ('owner', 'admin')
      )
    )
    with check (
      exists (
        select 1 from public.org_members om
        where om.org_id = governance_bodies.org_id
          and om.user_id = auth.uid()
          and om.status = 'active'
          and om.role in ('owner', 'admin')
      )
    );

  -- governance_policies: same re-gating.
  drop policy if exists "members write own org governance policies"
    on public.governance_policies;
  create policy "owners and admins write own org governance policies"
    on public.governance_policies
    for all to authenticated
    using (
      exists (
        select 1 from public.org_members om
        where om.org_id = governance_policies.org_id
          and om.user_id = auth.uid()
          and om.status = 'active'
          and om.role in ('owner', 'admin')
      )
    )
    with check (
      exists (
        select 1 from public.org_members om
        where om.org_id = governance_policies.org_id
          and om.user_id = auth.uid()
          and om.status = 'active'
          and om.role in ('owner', 'admin')
      )
    );
end$$;

-- 2. ── the append-only audit log ────────────────────────────────────────────

create table if not exists public.governance_events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  actor_id    uuid references public.profiles (id) on delete set null,
  event_type  text not null
                check (event_type in ('policy_drafted', 'policy_adopted', 'body_member_added')),
  entity_type text not null check (entity_type in ('policy', 'governance_body')),
  entity_id   text not null check (char_length(entity_id) between 1 and 64),
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamp with time zone not null default now()
);

create index if not exists governance_events_org_idx
  on public.governance_events (org_id, created_at desc);

alter table public.governance_events enable row level security;

revoke all on table public.governance_events from anon;
-- Append-only: select + insert only, never update or delete.
grant select, insert on table public.governance_events to authenticated;
grant all on table public.governance_events to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'governance_events'
      and policyname = 'members read own org governance events'
  ) then
    create policy "members read own org governance events"
      on public.governance_events
      for select to authenticated
      using (
        exists (
          select 1 from public.org_members om
          where om.org_id = governance_events.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'governance_events'
      and policyname = 'owners and admins log own org governance events'
  ) then
    -- Insert only: an owner/admin may write events attributed to themselves.
    create policy "owners and admins log own org governance events"
      on public.governance_events
      for insert to authenticated
      with check (
        actor_id = auth.uid()
        and exists (
          select 1 from public.org_members om
          where om.org_id = governance_events.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
            and om.role in ('owner', 'admin')
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'governance_events'
      and policyname = 'service_role writes governance_events'
  ) then
    create policy "service_role writes governance_events"
      on public.governance_events
      for all to service_role
      using (true)
      with check (true);
  end if;
end$$;
