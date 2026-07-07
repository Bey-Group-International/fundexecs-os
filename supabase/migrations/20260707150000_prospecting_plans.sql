-- Persist prospecting plans for history — so an operator can revisit and
-- compare past sourcing runs, not just the live one. Each generated plan is
-- saved as a compact record (goal + counts + the full plan JSON). Org-scoped
-- with the same member-manage RLS as the rest of the relationship engine.

create table if not exists prospecting_plans (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  created_by       uuid references auth.users(id),

  goal_text        text not null,
  goal_key         text,
  persona          text,
  routed_agent     text,
  sequence_key     text,

  prospect_count   integer not null default 0,
  ready_count      integer not null default 0,
  held_count       integer not null default 0,

  -- The full ProspectingPlan (lib/relationship/prospecting-copilot.ts) so a
  -- past run can be re-rendered without re-sourcing.
  plan             jsonb not null default '{}'::jsonb,

  created_at       timestamptz not null default now()
);

create index if not exists prospecting_plans_org_idx
  on prospecting_plans (organization_id, created_at desc);

alter table prospecting_plans enable row level security;

create policy "org members can manage their prospecting plans"
  on prospecting_plans
  for all
  using (
    organization_id in (
      select organization_id from organization_members where principal_id = auth.uid()
    )
  );
