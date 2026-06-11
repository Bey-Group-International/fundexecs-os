-- =====================================================================
-- Profile & Brand (Build hub interior).
--
-- One brand-studio document per org: the operator's published brand
-- assets (bio / brand kit / website specs), presence setups, and the
-- credentials flag — a single jsonb document, like fund_formations,
-- because the studio edits one coherent record.
--
-- Org-scoped RLS — active members read and write their org's brand;
-- the service-role orchestrator may write too. Additive + idempotent.
-- =====================================================================

create table if not exists public.brand_studio (
  org_id      uuid primary key references public.organizations (id) on delete cascade,
  created_by  uuid references auth.users (id) on delete set null,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamp with time zone not null default now(),
  updated_at  timestamp with time zone not null default now()
);

alter table public.brand_studio enable row level security;

revoke all on table public.brand_studio from anon;
grant select, insert, update on table public.brand_studio to authenticated;
grant all on table public.brand_studio to service_role;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_updated_at' and tgrelid = 'public.brand_studio'::regclass
  ) then
    create trigger set_updated_at
      before update on public.brand_studio
      for each row execute function public.set_updated_at();
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'brand_studio'
      and policyname = 'members read own org brand studio'
  ) then
    create policy "members read own org brand studio"
      on public.brand_studio
      for select to authenticated
      using (
        exists (
          select 1 from public.org_members om
          where om.org_id = brand_studio.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'brand_studio'
      and policyname = 'members write own org brand studio'
  ) then
    create policy "members write own org brand studio"
      on public.brand_studio
      for all to authenticated
      using (
        exists (
          select 1 from public.org_members om
          where om.org_id = brand_studio.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      )
      with check (
        exists (
          select 1 from public.org_members om
          where om.org_id = brand_studio.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'brand_studio'
      and policyname = 'service_role writes brand_studio'
  ) then
    create policy "service_role writes brand_studio"
      on public.brand_studio
      for all to service_role
      using (true)
      with check (true);
  end if;
end$$;
