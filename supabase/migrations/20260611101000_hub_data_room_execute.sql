-- ============================================================================
-- Hub data room + EXECUTE interior data model.
--
-- Additive + idempotent. Data-room links reference lp_room_documents because
-- this checkout has no generic public.documents table.
-- ============================================================================

create table if not exists public.data_room_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  document_id uuid references public.lp_room_documents (id) on delete set null,
  token text not null unique,
  vetting text not null default 'nda',
  expires_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create unique index if not exists data_room_links_id_org_unique
  on public.data_room_links (id, org_id);
create index if not exists data_room_links_org_id_idx
  on public.data_room_links (org_id);
create index if not exists data_room_links_document_id_idx
  on public.data_room_links (document_id);
create index if not exists data_room_links_expires_at_idx
  on public.data_room_links (expires_at);

create table if not exists public.data_room_views (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  link_id uuid not null,
  viewer text not null,
  verified_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  foreign key (link_id, org_id)
    references public.data_room_links (id, org_id)
    on delete cascade
);

create index if not exists data_room_views_link_created_idx
  on public.data_room_views (link_id, created_at desc);
create index if not exists data_room_views_org_created_idx
  on public.data_room_views (org_id, created_at desc);

create table if not exists public.closings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null,
  counterparty text,
  amount numeric,
  status text not null default 'open',
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create unique index if not exists closings_id_org_unique
  on public.closings (id, org_id);
create index if not exists closings_org_status_idx
  on public.closings (org_id, status);
create index if not exists closings_org_kind_idx
  on public.closings (org_id, kind);

create table if not exists public.closing_steps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  closing_id uuid not null,
  seq integer not null,
  name text not null,
  status text not null default 'pending',
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  foreign key (closing_id, org_id)
    references public.closings (id, org_id)
    on delete cascade
);

create unique index if not exists closing_steps_closing_seq_unique
  on public.closing_steps (closing_id, seq);
create index if not exists closing_steps_org_status_idx
  on public.closing_steps (org_id, status);

create table if not exists public.capital_calls (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  pct numeric,
  total numeric,
  due_at timestamp with time zone,
  status text not null default 'draft',
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create unique index if not exists capital_calls_id_org_unique
  on public.capital_calls (id, org_id);
create index if not exists capital_calls_org_status_idx
  on public.capital_calls (org_id, status);
create index if not exists capital_calls_due_at_idx
  on public.capital_calls (due_at);

create table if not exists public.call_lp_status (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  call_id uuid not null,
  lp_ref text not null,
  status text not null default 'notified',
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  foreign key (call_id, org_id)
    references public.capital_calls (id, org_id)
    on delete cascade
);

create unique index if not exists call_lp_status_call_lp_unique
  on public.call_lp_status (call_id, lp_ref);
create index if not exists call_lp_status_org_status_idx
  on public.call_lp_status (org_id, status);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.data_room_links'::regclass
      and conname = 'data_room_links_vetting_check'
  ) then
    alter table public.data_room_links
      add constraint data_room_links_vetting_check
      check (vetting in ('open', 'accreditation', 'nda'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.data_room_links'::regclass
      and conname = 'data_room_links_token_not_blank'
  ) then
    alter table public.data_room_links
      add constraint data_room_links_token_not_blank
      check (length(btrim(token)) > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.data_room_views'::regclass
      and conname = 'data_room_views_viewer_not_blank'
  ) then
    alter table public.data_room_views
      add constraint data_room_views_viewer_not_blank
      check (length(btrim(viewer)) > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.closings'::regclass
      and conname = 'closings_kind_check'
  ) then
    alter table public.closings
      add constraint closings_kind_check
      check (kind in ('lp_commitment', 'deal', 'engagement'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.closing_steps'::regclass
      and conname = 'closing_steps_seq_check'
  ) then
    alter table public.closing_steps
      add constraint closing_steps_seq_check
      check (seq > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.closing_steps'::regclass
      and conname = 'closing_steps_name_not_blank'
  ) then
    alter table public.closing_steps
      add constraint closing_steps_name_not_blank
      check (length(btrim(name)) > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.capital_calls'::regclass
      and conname = 'capital_calls_pct_check'
  ) then
    alter table public.capital_calls
      add constraint capital_calls_pct_check
      check (pct is null or (pct >= 0 and pct <= 100));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.capital_calls'::regclass
      and conname = 'capital_calls_total_check'
  ) then
    alter table public.capital_calls
      add constraint capital_calls_total_check
      check (total is null or total >= 0);
  end if;
end$$;

do $$
declare
  _table regclass;
begin
  foreach _table in array array[
    'public.data_room_links'::regclass,
    'public.data_room_views'::regclass,
    'public.closings'::regclass,
    'public.closing_steps'::regclass,
    'public.capital_calls'::regclass,
    'public.call_lp_status'::regclass
  ]
  loop
    if not exists (
      select 1
      from pg_trigger
      where tgname = 'set_updated_at'
        and tgrelid = _table
    ) then
      execute format(
        'create trigger set_updated_at before update on %s for each row execute function public.set_updated_at()',
        _table
      );
    end if;
  end loop;
end$$;

alter table public.data_room_links enable row level security;
alter table public.data_room_views enable row level security;
alter table public.closings enable row level security;
alter table public.closing_steps enable row level security;
alter table public.capital_calls enable row level security;
alter table public.call_lp_status enable row level security;

revoke all on table public.data_room_links from anon, authenticated;
revoke all on table public.data_room_views from anon, authenticated;
revoke all on table public.closings from anon, authenticated;
revoke all on table public.closing_steps from anon, authenticated;
revoke all on table public.capital_calls from anon, authenticated;
revoke all on table public.call_lp_status from anon, authenticated;

grant select on table public.data_room_links to authenticated;
grant select on table public.data_room_views to authenticated;
grant select on table public.closings to authenticated;
grant select on table public.closing_steps to authenticated;
grant select on table public.capital_calls to authenticated;
grant select on table public.call_lp_status to authenticated;

grant select, insert, update, delete on table public.data_room_links to service_role;
grant select, insert, update, delete on table public.data_room_views to service_role;
grant select, insert, update, delete on table public.closings to service_role;
grant select, insert, update, delete on table public.closing_steps to service_role;
grant select, insert, update, delete on table public.capital_calls to service_role;
grant select, insert, update, delete on table public.call_lp_status to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'data_room_links'
      and policyname = 'members read data_room_links'
  ) then
    create policy "members read data_room_links" on public.data_room_links
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'data_room_views'
      and policyname = 'members read data_room_views'
  ) then
    create policy "members read data_room_views" on public.data_room_views
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'closings'
      and policyname = 'members read closings'
  ) then
    create policy "members read closings" on public.closings
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'closing_steps'
      and policyname = 'members read closing_steps'
  ) then
    create policy "members read closing_steps" on public.closing_steps
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'capital_calls'
      and policyname = 'members read capital_calls'
  ) then
    create policy "members read capital_calls" on public.capital_calls
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'call_lp_status'
      and policyname = 'members read call_lp_status'
  ) then
    create policy "members read call_lp_status" on public.call_lp_status
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'data_room_links'
      and policyname = 'service_role manage data_room_links'
  ) then
    create policy "service_role manage data_room_links" on public.data_room_links
      for all to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'data_room_views'
      and policyname = 'service_role manage data_room_views'
  ) then
    create policy "service_role manage data_room_views" on public.data_room_views
      for all to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'closings'
      and policyname = 'service_role manage closings'
  ) then
    create policy "service_role manage closings" on public.closings
      for all to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'closing_steps'
      and policyname = 'service_role manage closing_steps'
  ) then
    create policy "service_role manage closing_steps" on public.closing_steps
      for all to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'capital_calls'
      and policyname = 'service_role manage capital_calls'
  ) then
    create policy "service_role manage capital_calls" on public.capital_calls
      for all to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'call_lp_status'
      and policyname = 'service_role manage call_lp_status'
  ) then
    create policy "service_role manage call_lp_status" on public.call_lp_status
      for all to service_role
      using (true)
      with check (true);
  end if;
end$$;

comment on table public.data_room_links is
  'Vetted data-room share links for lp_room_documents.';
comment on table public.data_room_views is
  'Appendable view log for vetted data-room links.';
comment on table public.closings is
  'EXECUTE hub commitment-to-close records.';
comment on table public.closing_steps is
  'EXECUTE hub strict-gating steps for a closing.';
comment on table public.capital_calls is
  'Illustrative capital-call records pending counsel-approved workflow.';
comment on table public.call_lp_status is
  'Per-LP delivery state for a capital call.';
