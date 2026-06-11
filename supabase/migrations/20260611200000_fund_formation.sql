-- =====================================================================
-- Fund Formation: the Build hub's copiloted formation walkthrough.
--
-- One formation per org. `fund_formations.data` holds the operator's working
-- FormationData document (story, entity, terms, PPM choices, …) — the flow
-- edits one shared document across steps, so it lives on the parent row
-- rather than per step. `formation_steps` records which of the seven steps
-- have been completed ("filed" in product copy — illustrative until counsel
-- signs off; no real filing happens here).
--
-- Org-scoped RLS — active members read and write their org's formation; the
-- service-role orchestrator may write too. Additive + idempotent.
-- =====================================================================

create table if not exists public.fund_formations (
  org_id      uuid primary key references public.organizations (id) on delete cascade,
  created_by  uuid references auth.users (id) on delete set null,
  status      text not null default 'in_progress'
                check (status in ('in_progress', 'formed')),
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamp with time zone not null default now(),
  updated_at  timestamp with time zone not null default now()
);

create table if not exists public.formation_steps (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  kind        text not null
                check (kind in ('story', 'structure', 'terms', 'ppm',
                                'subscription', 'regulatory', 'bank')),
  status      text not null default 'filed' check (status in ('filed')),
  filed_by    uuid references auth.users (id) on delete set null,
  filed_at    timestamp with time zone not null default now(),
  created_at  timestamp with time zone not null default now(),
  unique (org_id, kind)
);

create index if not exists formation_steps_org_idx on public.formation_steps (org_id);

alter table public.fund_formations enable row level security;
alter table public.formation_steps enable row level security;

revoke all on table public.fund_formations from anon;
revoke all on table public.formation_steps from anon;
grant select, insert, update on table public.fund_formations to authenticated;
grant select, insert, update on table public.formation_steps to authenticated;
grant all on table public.fund_formations to service_role;
grant all on table public.formation_steps to service_role;

-- Keep updated_at fresh (reuses the shared set_updated_at trigger fn).
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_updated_at' and tgrelid = 'public.fund_formations'::regclass
  ) then
    create trigger set_updated_at
      before update on public.fund_formations
      for each row execute function public.set_updated_at();
  end if;
end$$;

-- Active members of the org may read + write their formation.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'fund_formations'
      and policyname = 'members read own org formation'
  ) then
    create policy "members read own org formation"
      on public.fund_formations
      for select to authenticated
      using (
        exists (
          select 1 from public.org_members om
          where om.org_id = fund_formations.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'fund_formations'
      and policyname = 'members write own org formation'
  ) then
    create policy "members write own org formation"
      on public.fund_formations
      for all to authenticated
      using (
        exists (
          select 1 from public.org_members om
          where om.org_id = fund_formations.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      )
      with check (
        exists (
          select 1 from public.org_members om
          where om.org_id = fund_formations.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'fund_formations'
      and policyname = 'service_role writes fund_formations'
  ) then
    create policy "service_role writes fund_formations"
      on public.fund_formations
      for all to service_role
      using (true)
      with check (true);
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'formation_steps'
      and policyname = 'members read own org formation steps'
  ) then
    create policy "members read own org formation steps"
      on public.formation_steps
      for select to authenticated
      using (
        exists (
          select 1 from public.org_members om
          where om.org_id = formation_steps.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'formation_steps'
      and policyname = 'members write own org formation steps'
  ) then
    create policy "members write own org formation steps"
      on public.formation_steps
      for all to authenticated
      using (
        exists (
          select 1 from public.org_members om
          where om.org_id = formation_steps.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      )
      with check (
        exists (
          select 1 from public.org_members om
          where om.org_id = formation_steps.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'formation_steps'
      and policyname = 'service_role writes formation_steps'
  ) then
    create policy "service_role writes formation_steps"
      on public.formation_steps
      for all to service_role
      using (true)
      with check (true);
  end if;
end$$;
