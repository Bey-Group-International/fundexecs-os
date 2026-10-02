-- Earn "Explain this" answer cache.
--
-- The first Explain on a record is saved per org and reused for 24 hours, so
-- the next member to open the same record sees it instantly at no credit cost
-- (with a Refresh to regenerate). One row per (org, record): a refresh
-- overwrites it.
--
-- No policies on purpose. A cached explanation can describe a record the
-- reader is not allowed to see (a private relationship, a meeting they did not
-- attend), so it is only ever served by /api/chat on the service role, and only
-- after that request has loaded the record under the caller's own permissions.

create table if not exists public.earn_explanations (
  id               uuid primary key default extensions.gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  record_type      text not null check (record_type in ('deal', 'investor', 'contact', 'document', 'pulse', 'asset', 'meeting')),
  -- Text, not uuid: meetings are addressed by room code.
  record_id        text not null,
  content          text not null,
  model            text,
  created_by       uuid references public.principals (id) on delete set null,
  created_at       timestamptz not null default now()
);

create unique index if not exists earn_explanations_org_record
  on public.earn_explanations (organization_id, record_type, record_id);

comment on table public.earn_explanations is
  'Org-wide 24h cache of Earn "Explain this" answers; service-role only (no RLS policies by design).';

alter table public.earn_explanations enable row level security;
