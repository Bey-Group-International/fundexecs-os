-- 20260718200000_terminal_core.sql
-- The Private Markets Intelligence Terminal — persistence foundation (Release 1).
--
-- Four org-scoped tables backing the configurable multi-pane workspace and the
-- command language. Everything is additive and gated behind TERMINAL_ENABLED in the
-- app; with the flag off nothing reads or writes these tables. Same tenancy as the
-- rest of the domain: member-read / writer-write RLS via the canonical helpers,
-- updated_at triggers, idempotent so a preview-branch replay is a no-op.
--
--   terminal_workspaces — a named workspace preset owned by a user in an org.
--   terminal_layouts    — the serialized pane tree (sizes/docking/tabs) for a workspace.
--   saved_commands      — a user's saved + recently-used commands.
--   command_runs        — an append-only ledger of every command dispatched
--                         (verb, resolved side-effect level + gate tier, status),
--                         the terminal's observability spine (mirrors skill_runs /
--                         inference_runs).

-- ---------------------------------------------------------------------------
-- terminal_workspaces
-- ---------------------------------------------------------------------------
create table if not exists public.terminal_workspaces (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  owner_principal_id uuid references public.principals (id) on delete set null,
  name              text not null,
  -- One of the default presets (deal_underwriting, fundraising, investor_relations,
  -- portfolio_monitoring, diligence, market_intelligence, fund_operations,
  -- capital_formation, credit_monitoring, executive_brief) or 'custom'.
  preset_key        text not null default 'custom',
  -- Shared workspaces are visible to the whole org; private to the owner otherwise.
  is_shared         boolean not null default false,
  last_opened_at    timestamptz,
  deleted_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists terminal_workspaces_org_idx
  on public.terminal_workspaces (organization_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- terminal_layouts — serialized pane tree for a workspace (versioned jsonb)
-- ---------------------------------------------------------------------------
create table if not exists public.terminal_layouts (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  workspace_id      uuid not null references public.terminal_workspaces (id) on delete cascade,
  -- The pane tree: split directions, sizes, docking, tabs, per-pane type + entity
  -- binding + settings. jsonb so the layout schema can evolve without a migration;
  -- `layout_version` guards deserialization.
  layout            jsonb not null default '{}'::jsonb,
  layout_version    integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists terminal_layouts_workspace_idx
  on public.terminal_layouts (workspace_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- saved_commands — a user's saved + recent commands
-- ---------------------------------------------------------------------------
create table if not exists public.saved_commands (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  principal_id      uuid references public.principals (id) on delete set null,
  -- The raw command text ("DEAL Maple Street") + the resolved verb for grouping.
  command           text not null,
  verb              text,
  label             text,
  is_saved          boolean not null default false,   -- false = recent-only
  use_count         integer not null default 0,
  last_used_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists saved_commands_org_principal_idx
  on public.saved_commands (organization_id, principal_id, last_used_at desc);

-- ---------------------------------------------------------------------------
-- command_runs — append-only command execution ledger (observability)
-- ---------------------------------------------------------------------------
create table if not exists public.command_runs (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  principal_id      uuid references public.principals (id) on delete set null,
  workspace_id      uuid references public.terminal_workspaces (id) on delete set null,
  session_id        uuid references public.sessions (id) on delete set null,
  verb              text not null,
  raw               text not null,
  -- The resolved side-effect level + the gate tier it maps to (lib/terminal/
  -- action-contract.ts + lib/gates.ts). Records HOW the command was authorized.
  side_effect_level text not null,
  gate_tier         integer not null default 1 check (gate_tier between 1 and 3),
  dry_run           boolean not null default false,
  status            text not null default 'succeeded'
                      check (status in ('succeeded', 'failed', 'rejected', 'pending_approval')),
  error             text,
  created_at        timestamptz not null default now()
);
-- No updated_at: an execution record is immutable (like dispatch_log).

create index if not exists command_runs_org_created_idx
  on public.command_runs (organization_id, created_at desc);
create index if not exists command_runs_org_verb_idx
  on public.command_runs (organization_id, verb);

-- ---------------------------------------------------------------------------
-- updated_at triggers (the mutable tables only)
-- ---------------------------------------------------------------------------
drop trigger if exists terminal_workspaces_set_updated_at on public.terminal_workspaces;
create trigger terminal_workspaces_set_updated_at
  before update on public.terminal_workspaces
  for each row execute function public.set_updated_at();

drop trigger if exists terminal_layouts_set_updated_at on public.terminal_layouts;
create trigger terminal_layouts_set_updated_at
  before update on public.terminal_layouts
  for each row execute function public.set_updated_at();

drop trigger if exists saved_commands_set_updated_at on public.saved_commands;
create trigger saved_commands_set_updated_at
  before update on public.saved_commands
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — member-read / writer-write org tenancy, as elsewhere.
-- ---------------------------------------------------------------------------
alter table public.terminal_workspaces enable row level security;
alter table public.terminal_layouts    enable row level security;
alter table public.saved_commands      enable row level security;
alter table public.command_runs        enable row level security;

drop policy if exists terminal_workspaces_select on public.terminal_workspaces;
create policy terminal_workspaces_select on public.terminal_workspaces
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists terminal_workspaces_write on public.terminal_workspaces;
create policy terminal_workspaces_write on public.terminal_workspaces
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

drop policy if exists terminal_layouts_select on public.terminal_layouts;
create policy terminal_layouts_select on public.terminal_layouts
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists terminal_layouts_write on public.terminal_layouts;
create policy terminal_layouts_write on public.terminal_layouts
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

drop policy if exists saved_commands_select on public.saved_commands;
create policy saved_commands_select on public.saved_commands
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists saved_commands_write on public.saved_commands;
create policy saved_commands_write on public.saved_commands
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

drop policy if exists command_runs_select on public.command_runs;
create policy command_runs_select on public.command_runs
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists command_runs_write on public.command_runs;
create policy command_runs_write on public.command_runs
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
