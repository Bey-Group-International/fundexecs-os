-- 0030_dispatch_log.sql
-- Dispatch log — the audit trail for the integration dispatch layer. Every time
-- a Tier-1 action is dispatched through lib/integrations (`dispatchAction`), the
-- structured DispatchResult is recorded here as one append-only row. This is the
-- operator-facing record of what Earn actually sent (or mocked) on their behalf.
--
-- `dispatchAction` itself stays pure (no DB) so it remains unit-testable; the
-- write happens at the call site (app/(app)/capital-map/actions.ts) via
-- lib/integrations/log.ts. Rows are never updated or deleted by the app — this
-- is an append-only ledger, so there is no `updated_at`/trigger.

create table public.dispatch_log (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- the task whose dispatch this records. Nullable so a dispatch can be logged
  -- without a task, and set null if the task is later removed.
  task_id         uuid references public.tasks (id) on delete set null,
  -- the ActionKind dispatched (lib/gates.ts) and the channel that handled it
  -- ("gmail", "docusign", "mock", …) — mirror of DispatchResult.channel.
  action          text not null,
  channel         text not null,
  -- true only when a real external call was made; mock/queued results are false.
  live            boolean not null default false,
  -- the dispatch outcome and its human-readable detail, straight from the result.
  ok              boolean not null default true,
  detail          text,
  -- external reference (message id, envelope id, booking url) when one exists.
  reference       text,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index dispatch_log_org_idx on public.dispatch_log (organization_id);
-- The Outbox reads the org's most-recent dispatches with this index.
create index dispatch_log_org_created_idx on public.dispatch_log (organization_id, created_at desc);

-- RLS: same member-read / writer-write org tenancy as the rest of the domain.
alter table public.dispatch_log enable row level security;

create policy dispatch_log_select on public.dispatch_log
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy dispatch_log_write on public.dispatch_log
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
