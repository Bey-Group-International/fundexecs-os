-- =====================================================================
-- Lead Engine (Source hub interior): post-acquisition customer leads.
--
-- One engine per closed acquisition: `leads` rows belong to a deal (the
-- portfolio company) and move New → Qualified → Contacted → Meeting
-- through the approve loop. Org-scoped RLS — active members read and
-- write their org's leads; service_role (Vivian/Camille's generators)
-- may write too. Additive + idempotent.
-- =====================================================================

create table if not exists public.leads (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  deal_id     uuid references public.deals (id) on delete cascade,
  name        text not null check (length(btrim(name)) > 0),
  segment     text,
  intent      integer check (intent is null or (intent >= 0 and intent <= 100)),
  stage       text not null default 'new'
                check (stage in ('new', 'qualified', 'contacted', 'meeting')),
  est_value   numeric check (est_value is null or est_value >= 0),
  signal      text,
  source      text,
  created_at  timestamp with time zone not null default now(),
  updated_at  timestamp with time zone not null default now()
);

create index if not exists leads_org_idx on public.leads (org_id);
create index if not exists leads_org_deal_idx on public.leads (org_id, deal_id);
create index if not exists leads_org_stage_idx on public.leads (org_id, stage);

alter table public.leads enable row level security;

revoke all on table public.leads from anon;
grant select, insert, update on table public.leads to authenticated;
grant all on table public.leads to service_role;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_updated_at' and tgrelid = 'public.leads'::regclass
  ) then
    create trigger set_updated_at
      before update on public.leads
      for each row execute function public.set_updated_at();
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'leads'
      and policyname = 'members read own org leads'
  ) then
    create policy "members read own org leads"
      on public.leads
      for select to authenticated
      using (
        exists (
          select 1 from public.org_members om
          where om.org_id = leads.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'leads'
      and policyname = 'members write own org leads'
  ) then
    create policy "members write own org leads"
      on public.leads
      for all to authenticated
      using (
        exists (
          select 1 from public.org_members om
          where om.org_id = leads.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      )
      with check (
        exists (
          select 1 from public.org_members om
          where om.org_id = leads.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'leads'
      and policyname = 'service_role writes leads'
  ) then
    create policy "service_role writes leads"
      on public.leads
      for all to service_role
      using (true)
      with check (true);
  end if;
end$$;
