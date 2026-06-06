-- =====================================================================
-- Phase 6: Diligence Intelligence Layer
--
-- Backend/data rails only. Additive + idempotent:
--   1. Org-scoped diligence runs, documents, findings, and chunks.
--   2. Private Supabase Storage bucket `diligence`.
--   3. Service-role-only ingestion and retrieval RPCs.
--
-- Storage convention:
--   bucket_id: diligence
--   object name: {org_id}/{run_id}/{file}
--   full path for app metadata: diligence/{org_id}/{run_id}/{file}
-- =====================================================================

create extension if not exists vector with schema extensions;

-- 1. Diligence tables --------------------------------------------------
create table if not exists public.diligence_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  deal_id uuid references public.deals (id) on delete set null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  status text not null default 'queued',
  conviction integer,
  summary text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (id, org_id)
);

create table if not exists public.diligence_documents (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  kind text not null default 'other',
  created_at timestamp with time zone not null default now(),
  unique (id, org_id),
  foreign key (run_id, org_id)
    references public.diligence_runs (id, org_id)
    on delete cascade
);

create table if not exists public.diligence_findings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  agent text not null,
  score integer,
  summary text not null,
  detail text,
  citations jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone not null default now(),
  foreign key (run_id, org_id)
    references public.diligence_runs (id, org_id)
    on delete cascade
);

create table if not exists public.diligence_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  content text not null,
  embedding extensions.vector(1024),
  created_at timestamp with time zone not null default now(),
  foreign key (document_id, org_id)
    references public.diligence_documents (id, org_id)
    on delete cascade
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'diligence_runs_status_check') then
    alter table public.diligence_runs
      add constraint diligence_runs_status_check
      check (status in ('queued', 'running', 'complete', 'error'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'diligence_runs_conviction_check') then
    alter table public.diligence_runs
      add constraint diligence_runs_conviction_check
      check (conviction is null or conviction between 0 and 100);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'diligence_documents_kind_check') then
    alter table public.diligence_documents
      add constraint diligence_documents_kind_check
      check (kind in ('deck', 'cim', 'ppm', 'ddq', 'financials', 'notes', 'other'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'diligence_findings_agent_check') then
    alter table public.diligence_findings
      add constraint diligence_findings_agent_check
      check (agent in (
        'market_size',
        'competitive',
        'customer_demand',
        'unit_economics',
        'stress_test',
        'red_flags',
        'synthesis'
      ));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'diligence_findings_score_check') then
    alter table public.diligence_findings
      add constraint diligence_findings_score_check
      check (score is null or score between 0 and 100);
  end if;
end$$;

create index if not exists diligence_runs_org_id_idx
  on public.diligence_runs (org_id, created_at desc);
create index if not exists diligence_runs_deal_id_idx
  on public.diligence_runs (deal_id);

create index if not exists diligence_documents_run_id_idx
  on public.diligence_documents (run_id, created_at desc);
create index if not exists diligence_documents_org_id_idx
  on public.diligence_documents (org_id);

create index if not exists diligence_findings_run_id_idx
  on public.diligence_findings (run_id, agent);
create index if not exists diligence_findings_org_id_idx
  on public.diligence_findings (org_id);

create index if not exists diligence_chunks_document_id_idx
  on public.diligence_chunks (document_id);
create index if not exists diligence_chunks_org_id_idx
  on public.diligence_chunks (org_id);
create index if not exists diligence_chunks_embedding_idx
  on public.diligence_chunks using hnsw (embedding extensions.vector_cosine_ops);

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_updated_at'
      and tgrelid = 'public.diligence_runs'::regclass
  ) then
    create trigger set_updated_at
      before update on public.diligence_runs
      for each row execute function public.set_updated_at();
  end if;
end$$;

alter table public.diligence_runs enable row level security;
alter table public.diligence_documents enable row level security;
alter table public.diligence_findings enable row level security;
alter table public.diligence_chunks enable row level security;

revoke all on table public.diligence_runs from anon, authenticated;
revoke all on table public.diligence_documents from anon, authenticated;
revoke all on table public.diligence_findings from anon, authenticated;
revoke all on table public.diligence_chunks from anon, authenticated;

grant select on table public.diligence_runs to authenticated;
grant select on table public.diligence_documents to authenticated;
grant select on table public.diligence_findings to authenticated;
grant select on table public.diligence_chunks to authenticated;

grant select, insert, update, delete on table public.diligence_runs to service_role;
grant select, insert, update, delete on table public.diligence_documents to service_role;
grant select, insert, update, delete on table public.diligence_findings to service_role;
grant select, insert, update, delete on table public.diligence_chunks to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'diligence_runs' and policyname = 'members read diligence_runs'
  ) then
    create policy "members read diligence_runs" on public.diligence_runs
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'diligence_runs' and policyname = 'service_role insert diligence_runs'
  ) then
    create policy "service_role insert diligence_runs" on public.diligence_runs
      for insert to service_role
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'diligence_runs' and policyname = 'service_role update diligence_runs'
  ) then
    create policy "service_role update diligence_runs" on public.diligence_runs
      for update to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'diligence_documents' and policyname = 'members read diligence_documents'
  ) then
    create policy "members read diligence_documents" on public.diligence_documents
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'diligence_documents' and policyname = 'service_role insert diligence_documents'
  ) then
    create policy "service_role insert diligence_documents" on public.diligence_documents
      for insert to service_role
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'diligence_documents' and policyname = 'service_role update diligence_documents'
  ) then
    create policy "service_role update diligence_documents" on public.diligence_documents
      for update to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'diligence_findings' and policyname = 'members read diligence_findings'
  ) then
    create policy "members read diligence_findings" on public.diligence_findings
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'diligence_findings' and policyname = 'service_role insert diligence_findings'
  ) then
    create policy "service_role insert diligence_findings" on public.diligence_findings
      for insert to service_role
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'diligence_findings' and policyname = 'service_role update diligence_findings'
  ) then
    create policy "service_role update diligence_findings" on public.diligence_findings
      for update to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'diligence_chunks' and policyname = 'members read diligence_chunks'
  ) then
    create policy "members read diligence_chunks" on public.diligence_chunks
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'diligence_chunks' and policyname = 'service_role insert diligence_chunks'
  ) then
    create policy "service_role insert diligence_chunks" on public.diligence_chunks
      for insert to service_role
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'diligence_chunks' and policyname = 'service_role update diligence_chunks'
  ) then
    create policy "service_role update diligence_chunks" on public.diligence_chunks
      for update to service_role
      using (true)
      with check (true);
  end if;
end$$;

-- 2. Storage bucket ---------------------------------------------------
insert into storage.buckets (id, name, public)
values ('diligence', 'diligence', false)
on conflict (id) do update set public = false;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'diligence members read'
  ) then
    create policy "diligence members read" on storage.objects
      for select to authenticated
      using (
        bucket_id = 'diligence'
        and (
          case
            when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then ((storage.foldername(name))[1])::uuid
            else null
          end
        ) in (
          select om.org_id
          from public.org_members om
          where om.user_id = (select auth.uid())
            and om.status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'diligence service upload'
  ) then
    create policy "diligence service upload" on storage.objects
      for insert to service_role
      with check (bucket_id = 'diligence');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'diligence service update'
  ) then
    create policy "diligence service update" on storage.objects
      for update to service_role
      using (bucket_id = 'diligence')
      with check (bucket_id = 'diligence');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'diligence service delete'
  ) then
    create policy "diligence service delete" on storage.objects
      for delete to service_role
      using (bucket_id = 'diligence');
  end if;
end$$;

-- 3. Service-role RPCs -----------------------------------------------
create or replace function public.store_diligence_chunks(
  _document_id uuid,
  _chunks jsonb
) returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  _org_id uuid;
  _inserted integer;
begin
  if coalesce(jsonb_typeof(_chunks), '') <> 'array' then
    raise exception 'chunks must be a JSON array';
  end if;

  select d.org_id into _org_id
  from public.diligence_documents d
  where d.id = _document_id;

  if _org_id is null then
    raise exception 'diligence document % not found', _document_id;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(_chunks) as chunk(value)
    where nullif(btrim(chunk.value ->> 'content'), '') is null
      or chunk.value -> 'embedding' is null
  ) then
    raise exception 'each chunk must include non-empty content and an embedding';
  end if;

  insert into public.diligence_chunks (document_id, org_id, content, embedding)
  select
    _document_id,
    _org_id,
    chunk.value ->> 'content',
    (chunk.value ->> 'embedding')::extensions.vector(1024)
  from jsonb_array_elements(_chunks) as chunk(value);

  get diagnostics _inserted = row_count;
  return _inserted;
end;
$$;

create or replace function public.match_diligence_chunks(
  run_id uuid,
  query_embedding extensions.vector(1024),
  match_count int default 8
)
returns table (
  id uuid,
  document_id uuid,
  file_name text,
  storage_path text,
  content text,
  similarity double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    c.id,
    c.document_id,
    d.file_name,
    d.storage_path,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.diligence_chunks c
  join public.diligence_documents d
    on d.id = c.document_id
   and d.org_id = c.org_id
  join public.diligence_runs r
    on r.id = d.run_id
   and r.org_id = d.org_id
  where r.id = match_diligence_chunks.run_id
    and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit least(greatest(coalesce(match_count, 8), 1), 50);
$$;

revoke all on function public.store_diligence_chunks(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.match_diligence_chunks(uuid, extensions.vector, int)
  from public, anon, authenticated;
grant execute on function public.store_diligence_chunks(uuid, jsonb)
  to service_role;
grant execute on function public.match_diligence_chunks(uuid, extensions.vector, int)
  to service_role;
