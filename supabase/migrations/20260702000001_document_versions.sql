-- Document version history: snapshot content on every save.
-- Keeps up to 20 versions per document (older ones pruned by trigger).

create table if not exists public.document_versions (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references public.documents(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  content         text,
  name            text not null,
  saved_by        uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

alter table public.document_versions enable row level security;

create policy "org members can read their own document versions"
  on public.document_versions for select
  using (
    organization_id in (
      select organization_id from public.organization_members
      where principal_id in (
        select id from public.principals where id = auth.uid()
      )
    )
  );

create policy "org members can insert document versions"
  on public.document_versions for insert
  with check (
    organization_id in (
      select organization_id from public.organization_members
      where principal_id in (
        select id from public.principals where id = auth.uid()
      )
    )
  );

-- Prune to 20 most recent versions per document after each insert.
create or replace function public.prune_document_versions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.document_versions
  where document_id = new.document_id
    and id not in (
      select id from public.document_versions
      where document_id = new.document_id
      order by created_at desc
      limit 20
    );
  return null;
end;
$$;

drop trigger if exists trg_prune_document_versions on public.document_versions;
create trigger trg_prune_document_versions
  after insert on public.document_versions
  for each row execute function public.prune_document_versions();

create index if not exists idx_document_versions_document_id
  on public.document_versions(document_id, created_at desc);
