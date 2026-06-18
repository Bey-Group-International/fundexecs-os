-- 0010_rls.sql
-- Row-Level Security. The tenancy boundary is `organization_id`. A principal
-- sees and mutates rows only for organizations they belong to; `viewer` members
-- get read-only access. The global agent catalog is world-readable to
-- authenticated users. The service role bypasses RLS for server-side work.

-- ---------------------------------------------------------------------------
-- Additional membership helpers
-- ---------------------------------------------------------------------------

-- True if the current principal can write in the org (owner/admin/member).
create or replace function public.is_org_writer(target_org uuid)
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
      and role in ('owner', 'admin', 'member')
  );
$$;

-- Add the creating principal as the organization owner. SECURITY DEFINER so it
-- can insert the first membership row before any membership-based policy passes.
create or replace function public.handle_new_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.organization_members (organization_id, principal_id, role)
  values (new.id, auth.uid(), 'owner')
  on conflict (organization_id, principal_id) do nothing;
  return new;
end;
$$;

create trigger on_organization_created
  after insert on public.organizations
  for each row
  when (auth.uid() is not null)
  execute function public.handle_new_organization();

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
alter table public.principals            enable row level security;
alter table public.organizations         enable row level security;
alter table public.organization_members  enable row level security;
alter table public.investment_theses     enable row level security;
alter table public.track_records         enable row level security;
alter table public.investors             enable row level security;
alter table public.funds                 enable row level security;
alter table public.commitments           enable row level security;
alter table public.capital_events        enable row level security;
alter table public.deals                 enable row level security;
alter table public.assets                enable row level security;
alter table public.documents             enable row level security;
alter table public.underwritings         enable row level security;
alter table public.diligence_items       enable row level security;
alter table public.relationships         enable row level security;
alter table public.ai_agents             enable row level security;
alter table public.prompts               enable row level security;
alter table public.tasks                 enable row level security;
alter table public.task_handoffs         enable row level security;
alter table public.approvals             enable row level security;
alter table public.task_events           enable row level security;
alter table public.marketplace_listings  enable row level security;
alter table public.audit_log             enable row level security;

-- ---------------------------------------------------------------------------
-- principals
-- ---------------------------------------------------------------------------
create policy principals_select on public.principals
  for select using (
    id = auth.uid()
    or id in (
      select principal_id from public.organization_members
      where organization_id in (select public.current_principal_org_ids())
    )
  );

create policy principals_update_self on public.principals
  for update using (id = auth.uid()) with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
create policy organizations_select on public.organizations
  for select using (id in (select public.current_principal_org_ids()));

create policy organizations_insert on public.organizations
  for insert with check (auth.uid() is not null and created_by = auth.uid());

create policy organizations_update on public.organizations
  for update using (public.is_org_admin(id)) with check (public.is_org_admin(id));

create policy organizations_delete on public.organizations
  for delete using (public.is_org_admin(id));

-- ---------------------------------------------------------------------------
-- organization_members
-- ---------------------------------------------------------------------------
create policy members_select on public.organization_members
  for select using (organization_id in (select public.current_principal_org_ids()));

create policy members_insert on public.organization_members
  for insert with check (public.is_org_admin(organization_id));

create policy members_update on public.organization_members
  for update using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

create policy members_delete on public.organization_members
  for delete using (public.is_org_admin(organization_id));

-- ---------------------------------------------------------------------------
-- Org-scoped domain tables: shared read-for-members / write-for-writers pattern.
-- One block per table (Postgres has no policy templating).
-- ---------------------------------------------------------------------------

-- investment_theses
create policy theses_select on public.investment_theses
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy theses_write on public.investment_theses
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- track_records
create policy track_select on public.track_records
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy track_write on public.track_records
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- investors
create policy investors_select on public.investors
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy investors_write on public.investors
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- funds
create policy funds_select on public.funds
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy funds_write on public.funds
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- commitments
create policy commitments_select on public.commitments
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy commitments_write on public.commitments
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- capital_events
create policy capital_events_select on public.capital_events
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy capital_events_write on public.capital_events
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- deals
create policy deals_select on public.deals
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy deals_write on public.deals
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- assets
create policy assets_select on public.assets
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy assets_write on public.assets
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- documents
create policy documents_select on public.documents
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy documents_write on public.documents
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- underwritings
create policy underwritings_select on public.underwritings
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy underwritings_write on public.underwritings
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- diligence_items
create policy diligence_select on public.diligence_items
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy diligence_write on public.diligence_items
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- relationships
create policy relationships_select on public.relationships
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy relationships_write on public.relationships
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- prompts
create policy prompts_select on public.prompts
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy prompts_write on public.prompts
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- tasks
create policy tasks_select on public.tasks
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy tasks_write on public.tasks
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- task_handoffs
create policy handoffs_select on public.task_handoffs
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy handoffs_write on public.task_handoffs
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- approvals (humans decide; writers may also create the request)
create policy approvals_select on public.approvals
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy approvals_write on public.approvals
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- task_events
create policy task_events_select on public.task_events
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy task_events_write on public.task_events
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- ---------------------------------------------------------------------------
-- ai_agents — global catalog, read-only for all authenticated principals.
-- ---------------------------------------------------------------------------
create policy agents_select on public.ai_agents
  for select using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- marketplace_listings — org members see their own; everyone sees public ones.
-- ---------------------------------------------------------------------------
create policy marketplace_select on public.marketplace_listings
  for select using (
    organization_id in (select public.current_principal_org_ids())
    or (is_public = true and status = 'listed')
  );
create policy marketplace_write on public.marketplace_listings
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- ---------------------------------------------------------------------------
-- audit_log — admins read; inserts are service-role only (no client policy).
-- ---------------------------------------------------------------------------
create policy audit_select on public.audit_log
  for select using (
    organization_id is not null and public.is_org_admin(organization_id)
  );
