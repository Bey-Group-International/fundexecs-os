-- 0009_audit.sql
-- Audit logging (Security requirement). Append-only record of consequential
-- mutations. Written by the application/service-role; readable by org admins.

create table public.audit_log (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete set null,
  principal_id    uuid references public.principals (id) on delete set null,
  action          text not null,               -- 'task.approved', 'investor.created'...
  entity_type     text,
  entity_id       uuid,
  before_state    jsonb,
  after_state     jsonb,
  ip_address      inet,
  created_at      timestamptz not null default now()
);

create index audit_log_org_idx on public.audit_log (organization_id, created_at desc);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);
