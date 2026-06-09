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
