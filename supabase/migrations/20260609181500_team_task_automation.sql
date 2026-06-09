-- Team-task automation (Phase 1)
-- Let a task be owned by an AI specialist (agent_slug), carry a priority, and
-- store a structured result. RLS is unchanged: the existing org-member
-- read/insert/update policies on public.tasks already cover these columns.

alter table public.tasks
  add column if not exists agent_slug text,
  add column if not exists priority smallint not null default 0,
  add column if not exists result jsonb;

-- Fast lookups for the Team-tasks dashboard surface (per org, per specialist).
create index if not exists tasks_org_agent_status_idx
  on public.tasks (org_id, agent_slug, status);

-- Enforce the canonical specialist set at the table boundary so a direct write
-- (under the org-member INSERT/UPDATE policies) can't persist an off-roster
-- slug. Mirrors the brain roster in lib/team; assignTask() also validates.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tasks_agent_slug_check'
  ) then
    alter table public.tasks
      add constraint tasks_agent_slug_check check (
        agent_slug is null or agent_slug in (
          'earnest-fundmaker', 'master-workflow', 'automater', 'executive-advisor',
          'rainmaker', 'deal-sourcer', 'capital-connector', 'legal-admin',
          'pr-director', 'seo-disruptor', 'lead-generator', 'event-curator',
          'investor-relations', 'capital-raiser', 'workflow-instructor'
        )
      );
  end if;
end $$;

