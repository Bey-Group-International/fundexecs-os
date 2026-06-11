-- =====================================================================
-- Mandates: the onboarding "Mandate Brief" the operator gives their team.
--
-- One mandate per org (the marching orders captured during onboarding):
-- role family, objective, vehicle, target size, and thesis (sectors/stage/geo).
-- Org-scoped RLS — active members read and write their org's mandate; the
-- service-role orchestrator may write too. Additive + idempotent.
-- =====================================================================

create table if not exists public.mandates (
  org_id          uuid primary key references public.organizations (id) on delete cascade,
  created_by      uuid references auth.users (id) on delete set null,
  principal       text check (principal is null or char_length(principal) <= 160),
  firm            text check (firm is null or char_length(firm) <= 160),
  investor_group  text not null default 'fund'
                    check (investor_group in ('fund', 'capital', 'service')),
  investor_role   text check (investor_role is null or char_length(investor_role) <= 80),
  experience      text check (experience is null or char_length(experience) <= 60),
  standing        text check (standing is null or char_length(standing) <= 60),
  objective       text check (objective is null or char_length(objective) <= 60),
  vehicle         text check (vehicle is null or char_length(vehicle) <= 60),
  size            text check (size is null or char_length(size) <= 60),
  sectors         text[] not null default '{}',
  stage           text check (stage is null or char_length(stage) <= 60),
  geo             text check (geo is null or char_length(geo) <= 60),
  created_at      timestamp with time zone not null default now(),
  updated_at      timestamp with time zone not null default now()
);

alter table public.mandates enable row level security;

revoke all on table public.mandates from anon;
grant select, insert, update on table public.mandates to authenticated;
grant all on table public.mandates to service_role;

-- Keep updated_at fresh (reuses the shared set_updated_at trigger fn).
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_updated_at' and tgrelid = 'public.mandates'::regclass
  ) then
    create trigger set_updated_at
      before update on public.mandates
      for each row execute function public.set_updated_at();
  end if;
end$$;

-- Active members of the org may read the mandate.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'mandates'
      and policyname = 'members read own org mandate'
  ) then
    create policy "members read own org mandate"
      on public.mandates
      for select to authenticated
      using (
        exists (
          select 1 from public.org_members om
          where om.org_id = mandates.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'mandates'
      and policyname = 'members write own org mandate'
  ) then
    create policy "members write own org mandate"
      on public.mandates
      for all to authenticated
      using (
        exists (
          select 1 from public.org_members om
          where om.org_id = mandates.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      )
      with check (
        exists (
          select 1 from public.org_members om
          where om.org_id = mandates.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'mandates'
      and policyname = 'service_role writes mandates'
  ) then
    create policy "service_role writes mandates"
      on public.mandates
      for all to service_role
      using (true)
      with check (true);
  end if;
end$$;
