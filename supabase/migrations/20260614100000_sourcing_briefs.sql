-- Sourcing briefs (Phase 1, P1-B) — a standing thesis the sourcing desk works.
--
-- One brief per org. The scheduled intelligence cron raises a `deal-sourcer`
-- "scout targets" proposal into the Action Queue for each ACTIVE brief; on
-- approval the sourcing executor runs target discovery against the brief's
-- thesis and stages the top candidates as routed follow-up tasks. Nothing here
-- executes on its own — the brief only seeds proposals the operator approves.
--
-- RLS mirrors public.task_runs: org members read/insert/update their org's
-- brief; admins may delete. Helpers live in the non-exposed `private` schema.

create table if not exists public.sourcing_briefs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  thesis text not null,
  filters jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One standing brief per org (lets the actions upsert on org_id).
  constraint sourcing_briefs_one_per_org unique (org_id)
);

-- Cron lookup: orgs with an active brief.
create index if not exists sourcing_briefs_active_idx
  on public.sourcing_briefs (org_id)
  where active;

drop trigger if exists set_updated_at on public.sourcing_briefs;
create trigger set_updated_at before update on public.sourcing_briefs
  for each row execute function public.set_updated_at();

alter table public.sourcing_briefs enable row level security;

drop policy if exists "members read sourcing_briefs" on public.sourcing_briefs;
create policy "members read sourcing_briefs" on public.sourcing_briefs
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists "members insert sourcing_briefs" on public.sourcing_briefs;
create policy "members insert sourcing_briefs" on public.sourcing_briefs
  for insert to authenticated with check (private.is_org_member(org_id));

drop policy if exists "members update sourcing_briefs" on public.sourcing_briefs;
create policy "members update sourcing_briefs" on public.sourcing_briefs
  for update to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

drop policy if exists "admins delete sourcing_briefs" on public.sourcing_briefs;
create policy "admins delete sourcing_briefs" on public.sourcing_briefs
  for delete to authenticated using (private.is_org_admin(org_id));
