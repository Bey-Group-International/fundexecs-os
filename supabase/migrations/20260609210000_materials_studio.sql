-- ============================================================================
-- Capital Materials Studio
--
-- Additive + idempotent. Org-scoped persisted materials and append-only
-- versions. Server actions write through RLS; service role is not required.
-- ============================================================================

create table if not exists public.capital_materials (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  kind text not null default 'pitch_deck',
  audience text not null default 'institutional_lp',
  title text not null,
  status text not null default 'draft',
  last_generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.capital_material_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  material_id uuid not null,
  version_number integer not null,
  title text not null,
  body text not null,
  source text not null default 'deterministic_template',
  source_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists capital_materials_id_org_unique
  on public.capital_materials (id, org_id);

create index if not exists capital_materials_org_updated_idx
  on public.capital_materials (org_id, updated_at desc);

create index if not exists capital_materials_org_status_idx
  on public.capital_materials (org_id, status);

create unique index if not exists capital_material_versions_material_version_unique
  on public.capital_material_versions (material_id, version_number);

create index if not exists capital_material_versions_material_created_idx
  on public.capital_material_versions (material_id, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.capital_materials'::regclass
      and conname = 'capital_materials_kind_check'
  ) then
    alter table public.capital_materials
      add constraint capital_materials_kind_check
      check (kind in ('pitch_deck', 'lp_one_pager', 'ic_memo', 'data_room_index'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.capital_materials'::regclass
      and conname = 'capital_materials_audience_check'
  ) then
    alter table public.capital_materials
      add constraint capital_materials_audience_check
      check (audience in ('institutional_lp', 'family_office', 'co_investor', 'internal_ic'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.capital_materials'::regclass
      and conname = 'capital_materials_status_check'
  ) then
    alter table public.capital_materials
      add constraint capital_materials_status_check
      check (status in ('draft', 'ready', 'archived'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.capital_material_versions'::regclass
      and conname = 'capital_material_versions_version_number_check'
  ) then
    alter table public.capital_material_versions
      add constraint capital_material_versions_version_number_check
      check (version_number > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.capital_material_versions'::regclass
      and conname = 'capital_material_versions_source_check'
  ) then
    alter table public.capital_material_versions
      add constraint capital_material_versions_source_check
      check (source in ('deterministic_template', 'manual_edit', 'ai_generator'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.capital_material_versions'::regclass
      and conname = 'capital_material_versions_material_org_fkey'
  ) then
    alter table public.capital_material_versions
      add constraint capital_material_versions_material_org_fkey
      foreign key (material_id, org_id)
      references public.capital_materials (id, org_id)
      on delete cascade;
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_updated_at'
      and tgrelid = 'public.capital_materials'::regclass
  ) then
    create trigger set_updated_at
      before update on public.capital_materials
      for each row execute function public.set_updated_at();
  end if;
end$$;

alter table public.capital_materials enable row level security;
alter table public.capital_material_versions enable row level security;

revoke all on table public.capital_materials from anon, authenticated;
revoke all on table public.capital_material_versions from anon, authenticated;

grant select, insert, update on table public.capital_materials to authenticated;
grant select, insert on table public.capital_material_versions to authenticated;

grant select, insert, update, delete on table public.capital_materials to service_role;
grant select, insert, update, delete on table public.capital_material_versions to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'capital_materials'
      and policyname = 'members read capital_materials'
  ) then
    create policy "members read capital_materials" on public.capital_materials
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'capital_materials'
      and policyname = 'members insert capital_materials'
  ) then
    create policy "members insert capital_materials" on public.capital_materials
      for insert to authenticated
      with check (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'capital_materials'
      and policyname = 'members update capital_materials'
  ) then
    create policy "members update capital_materials" on public.capital_materials
      for update to authenticated
      using (private.is_org_member(org_id))
      with check (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'capital_material_versions'
      and policyname = 'members read capital_material_versions'
  ) then
    create policy "members read capital_material_versions" on public.capital_material_versions
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'capital_material_versions'
      and policyname = 'members insert capital_material_versions'
  ) then
    create policy "members insert capital_material_versions" on public.capital_material_versions
      for insert to authenticated
      with check (
        private.is_org_member(org_id)
        and exists (
          select 1
          from public.capital_materials m
          where m.id = capital_material_versions.material_id
            and m.org_id = capital_material_versions.org_id
            and private.is_org_member(m.org_id)
        )
      );
  end if;
end$$;

comment on table public.capital_materials is
  'Capital Materials Studio records: deck, LP one-pager, IC memo, and data-room index.';
comment on table public.capital_material_versions is
  'Append-only generated or manually saved text versions for a capital material.';
